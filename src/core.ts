/**
 * lockdrift core: compare the dependency ranges declared in package.json
 * against the resolutions recorded in package-lock.json.
 *
 * Supported range forms are the ones listed in the README: exact, caret,
 * tilde, the simple comparators (>, >=, <, <=), space-separated AND pairs
 * of comparators, and the always-true forms ("*", "latest", ""). Anything
 * else (URLs, git, file:, workspace:, npm: aliases, || unions, hyphen
 * ranges, partial versions such as ^1) is reported as RANGE-UNSUPPORTED
 * and counted as unchecked. It is never guessed at and never flagged as
 * violated.
 *
 * Versions carrying a prerelease or build suffix (for example
 * 1.2.3-beta.1) are compared on their numeric core only: the suffix is
 * noted here and in the README, and ignored for the comparison itself.
 *
 * Only Node.js standard library APIs are used.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { Finding, Report } from "./types.js";

export const VERSION = "0.1.0";
export const CLEAN_VERDICT = "IN-SYNC";
const DRIFT_VERDICT = "DRIFT";

const DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/* ------------------------------------------------------------------ */
/* Small JSON helpers                                                  */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readJsonFile(path: string, label: string): Record<string, unknown> {
  if (!existsSync(path)) {
    throw new Error(`${label} not found at ${path}`);
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`${label} at ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new Error(`${label} at ${path} must contain a JSON object`);
  }
  return record;
}

/* ------------------------------------------------------------------ */
/* Semver core: versions and the supported range forms                 */
/* ------------------------------------------------------------------ */

type Core = [number, number, number];

const CORE_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse a version to its numeric core, ignoring any prerelease or build suffix. */
function parseVersionCore(input: string): Core | null {
  const m = CORE_RE.exec(input.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareCore(a: Core, b: Core): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

interface RangeToken {
  op: "any" | "=" | "^" | "~" | ">=" | ">" | "<" | "<=";
  core: Core | null;
}

function parseRangeToken(token: string): RangeToken | null {
  if (token === "*" || token === "x" || token === "X" || token === "latest") {
    return { op: "any", core: null };
  }
  const m = /^(\^|~|>=|<=|>|<|=)?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(token);
  if (!m) return null;
  const op = (m[1] ?? "=") as RangeToken["op"];
  return { op, core: [Number(m[2]), Number(m[3]), Number(m[4])] };
}

/**
 * Parse a range into AND-combined tokens, or return null when the range
 * uses a form lockdrift v0.1 does not support.
 */
function parseRange(range: string): RangeToken[] | null {
  const trimmed = range.trim();
  if (trimmed === "") return [{ op: "any", core: null }];
  // Unions, and every protocol or path form (URLs, git:, file:,
  // workspace:, npm:, portal:, catalog:), are unsupported. A colon or a
  // slash never appears in a supported semver range.
  if (trimmed.includes("||")) return null;
  if (trimmed.includes(":")) return null;
  if (trimmed.includes("/")) return null;
  // Allow a space between an operator and its version (">= 1.2.0").
  const normalized = trimmed.replace(/(>=|<=|>|<|=|\^|~)\s+(?=\d)/g, "$1");
  if (normalized === "*" || normalized === "latest") return [{ op: "any", core: null }];
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [{ op: "any", core: null }];
  const tokens: RangeToken[] = [];
  for (const part of parts) {
    // A bare "-" part is the separator of a hyphen range, which is
    // unsupported; parseRangeToken rejects it and every other
    // unsupported token shape.
    const token = parseRangeToken(part);
    if (!token) return null;
    tokens.push(token);
  }
  return tokens;
}

function evalToken(version: Core, token: RangeToken): boolean {
  if (token.op === "any" || token.core === null) return true;
  const target = token.core;
  const cmp = compareCore(version, target);
  switch (token.op) {
    case "=":
      return cmp === 0;
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case "~":
      // >= x.y.z and < x.(y+1).0
      return cmp >= 0 && compareCore(version, [target[0], target[1] + 1, 0]) < 0;
    case "^": {
      if (cmp < 0) return false;
      if (target[0] > 0) {
        // Same major: >= x.y.z and < (x+1).0.0
        return version[0] === target[0];
      }
      if (target[1] > 0) {
        // ^0.2.3 means >= 0.2.3 and < 0.3.0
        return version[0] === 0 && version[1] === target[1];
      }
      // ^0.0.3 means exactly 0.0.3
      return cmp === 0;
    }
  }
  // Unreachable: every operator case above returns. Present so the
  // function has an explicit return on every path.
  return false;
}

/**
 * Does `version` satisfy `range`? Returns null when the range form is
 * unsupported (or the version itself does not parse as a numeric
 * x.y.z core), so callers can report the dependency as unchecked
 * instead of guessing.
 */
export function satisfiesRange(version: string, range: string): boolean | null {
  const versionCore = parseVersionCore(version);
  if (!versionCore) return null;
  const tokens = parseRange(range);
  if (!tokens) return null;
  return tokens.every((token) => evalToken(versionCore, token));
}

function isSupportedRange(range: string): boolean {
  return parseRange(range) !== null;
}

/* ------------------------------------------------------------------ */
/* Manifests and workspaces                                            */
/* ------------------------------------------------------------------ */

interface DeclaredDep {
  name: string;
  range: string;
  section: string;
}

function collectDeclarations(manifest: Record<string, unknown>): DeclaredDep[] {
  const out: DeclaredDep[] = [];
  const seen = new Set<string>();
  for (const section of DEP_SECTIONS) {
    const deps = asRecord(manifest[section]);
    if (!deps) continue;
    for (const name of Object.keys(deps).sort()) {
      if (seen.has(name)) continue;
      const value = deps[name];
      if (typeof value !== "string") continue;
      seen.add(name);
      out.push({ name, range: value, section });
    }
  }
  return out;
}

interface WorkspaceDiscovery {
  dirs: string[];
  noted: Finding[];
  packageNames: Set<string>;
}

function workspacePatterns(rootManifest: Record<string, unknown>): string[] | null {
  const ws = rootManifest["workspaces"];
  if (Array.isArray(ws)) {
    return ws.filter((p): p is string => typeof p === "string");
  }
  const record = asRecord(ws);
  if (record && Array.isArray(record["packages"])) {
    return record["packages"].filter((p): p is string => typeof p === "string");
  }
  return null;
}

/**
 * Expand workspace globs one level ("packages/*" means each direct
 * subdirectory of packages/). Patterns in any other shape are not
 * expanded; they produce a WORKSPACES-NOTED info finding and the root
 * package alone is checked for the packages they would have matched.
 */
function discoverWorkspaces(rootAbs: string, rootManifest: Record<string, unknown>): WorkspaceDiscovery {
  const noted: Finding[] = [];
  const dirs = new Set<string>();
  let patterns = workspacePatterns(rootManifest);
  let fromField = true;
  if (patterns === null) {
    const packagesDir = join(rootAbs, "packages");
    let isDir = false;
    try {
      isDir = statSync(packagesDir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) return { dirs: [], noted, packageNames: new Set() };
    patterns = ["packages/*"];
    fromField = false;
  }

  let unsupported = 0;
  for (const rawPattern of patterns) {
    const pattern = rawPattern.replace(/\/+$/, "");
    if (pattern === "") continue;
    const segments = pattern.split("/");
    const starIdx = segments.findIndex((s) => s === "*" || s === "**");
    if (starIdx === -1) {
      const abs = join(rootAbs, pattern);
      if (existsSync(join(abs, "package.json"))) dirs.add(abs);
      continue;
    }
    if (starIdx !== segments.length - 1 || segments[starIdx] === "**") {
      unsupported++;
      continue;
    }
    const baseAbs = join(rootAbs, ...segments.slice(0, starIdx));
    let entries: string[];
    try {
      entries = readdirSync(baseAbs).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      // Installed dependency trees and dot-directories are never
      // workspace packages, even when a broad glob would match them.
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const abs = join(baseAbs, entry);
      try {
        if (!statSync(abs).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(join(abs, "package.json"))) dirs.add(abs);
    }
  }

  if (unsupported > 0) {
    noted.push({
      rule: "WORKSPACES-NOTED",
      severity: "info",
      file: "package.json",
      message: `Workspaces noted: ${unsupported} workspace pattern(s) use a form lockdrift v0.1 does not expand (only one-level globs such as "packages/*" are supported). Packages matched only by those patterns were NOT checked; the root package was checked.`,
    });
  } else if (fromField && dirs.size === 0 && patterns.length > 0) {
    noted.push({
      rule: "WORKSPACES-NOTED",
      severity: "info",
      file: "package.json",
      message: `Workspaces noted: package.json declares ${patterns.length} workspace pattern(s) but no workspace package.json files were found under them. Only the root package was checked.`,
    });
  }

  // Sorting the directories here is what later gets sorted again by the
  // caller; the package name set is filled in by the caller once the
  // workspace manifests are read.
  return { dirs: [...dirs].sort(), noted, packageNames: new Set() };
}

/* ------------------------------------------------------------------ */
/* The check                                                           */
/* ------------------------------------------------------------------ */

interface LockEntry {
  name: string;
  path: string;
  version: string;
}

/** Direct "node_modules/<name>" entries only; nested copies are skipped. */
function collectTopLevelEntries(packages: Record<string, unknown>): Map<string, LockEntry> {
  const out = new Map<string, LockEntry>();
  for (const key of Object.keys(packages)) {
    if (!key.startsWith("node_modules/")) continue;
    const rest = key.slice("node_modules/".length);
    if (rest.includes("/node_modules/")) continue;
    const segments = rest.split("/");
    const isScoped = rest.startsWith("@");
    if (isScoped ? segments.length !== 2 : segments.length !== 1) continue;
    if (out.has(rest)) continue;
    const entry = asRecord(packages[key]);
    const version = entry && typeof entry["version"] === "string" ? entry["version"] : "";
    out.set(rest, { name: rest, path: key, version });
  }
  return out;
}

/** Every name any lock entry points at through its dependency maps. */
function collectReferencedNames(packages: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const value of Object.values(packages)) {
    const entry = asRecord(value);
    if (!entry) continue;
    for (const section of ["dependencies", "peerDependencies", "optionalDependencies"] as const) {
      const deps = asRecord(entry[section]);
      if (!deps) continue;
      for (const name of Object.keys(deps)) out.add(name);
    }
  }
  return out;
}

export function runCheck(target: string): Report {
  let rootAbs = resolve(target);
  // Accept a direct path to a package.json as well as a directory.
  try {
    if (statSync(rootAbs).isFile() && basename(rootAbs) === "package.json") {
      rootAbs = dirname(rootAbs);
    }
  } catch {
    // A missing target falls through to the package.json error below.
  }

  const pkgPath = join(rootAbs, "package.json");
  const lockPath = join(rootAbs, "package-lock.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${rootAbs} (expected ${pkgPath})`);
  }
  if (!existsSync(lockPath)) {
    throw new Error(`package-lock.json not found in ${rootAbs} (expected ${lockPath})`);
  }
  const rootManifest = readJsonFile(pkgPath, "package.json");
  const lock = readJsonFile(lockPath, "package-lock.json");
  const packages = asRecord(lock["packages"]);
  if (!packages) {
    throw new Error(
      `package-lock.json at ${lockPath} does not contain a "packages" map. lockdrift v0.1 supports npm lockfileVersion 3 only.`,
    );
  }

  const findings: Finding[] = [];

  // Manifests to check: the root first, then each workspace package,
  // sorted by relative path for deterministic output.
  const discovery = discoverWorkspaces(rootAbs, rootManifest);
  findings.push(...discovery.noted);
  interface ManifestToCheck {
    relFile: string;
    manifest: Record<string, unknown>;
  }
  const manifests: ManifestToCheck[] = [{ relFile: "package.json", manifest: rootManifest }];
  for (const dir of discovery.dirs) {
    const wsPkgPath = join(dir, "package.json");
    const manifest = readJsonFile(wsPkgPath, "workspace package.json");
    const relFile = relative(rootAbs, wsPkgPath).split(sep).join("/");
    manifests.push({ relFile, manifest });
    const name = manifest["name"];
    if (typeof name === "string" && name !== "") discovery.packageNames.add(name);
  }

  const topLevel = collectTopLevelEntries(packages);
  const referenced = collectReferencedNames(packages);

  let declared = 0;
  let missing = 0;
  let violated = 0;
  let unchecked = 0;
  const declaredNames = new Set<string>();

  for (const { relFile, manifest } of manifests) {
    for (const dep of collectDeclarations(manifest)) {
      declared++;
      declaredNames.add(dep.name);
      const entry = topLevel.get(dep.name);
      if (!isSupportedRange(dep.range)) {
        unchecked++;
        findings.push({
          rule: "RANGE-UNSUPPORTED",
          severity: "info",
          file: relFile,
          message: `Dependency "${dep.name}" is declared in ${dep.section} of ${relFile} with a range lockdrift v0.1 does not evaluate. It is counted as unchecked and is never flagged as violated.`,
          evidence: entry ? `declared ${dep.range}, locked ${entry.version}` : `declared ${dep.range}, locked (missing)`,
        });
        continue;
      }
      if (!entry) {
        missing++;
        findings.push({
          rule: "LOCK-MISSING",
          severity: "high",
          file: relFile,
          message: `Dependency "${dep.name}" is declared in ${dep.section} of ${relFile} but has no "node_modules/${dep.name}" entry in package-lock.json.`,
          evidence: `declared ${dep.range}, locked (missing)`,
        });
        continue;
      }
      const ok = satisfiesRange(entry.version, dep.range);
      if (ok === null) {
        unchecked++;
        findings.push({
          rule: "RANGE-UNSUPPORTED",
          severity: "info",
          file: relFile,
          message: `Dependency "${dep.name}" is locked at "${entry.version}", which does not parse as a numeric x.y.z version, so the declared range in ${relFile} could not be evaluated. It is counted as unchecked.`,
          evidence: `declared ${dep.range}, locked ${entry.version}`,
        });
        continue;
      }
      if (!ok) {
        violated++;
        findings.push({
          rule: "RANGE-VIOLATED",
          severity: "high",
          file: relFile,
          message: `Dependency "${dep.name}" is declared in ${dep.section} of ${relFile} but the locked version does not satisfy the declared range.`,
          evidence: `declared ${dep.range}, locked ${entry.version}`,
        });
      }
    }
  }

  // Extraneous: top-level lock entries that are neither declared nor
  // referenced by any other lock entry (the v0.1 transitivity rule).
  // Workspace package names are local packages, never extraneous.
  let extraneous = 0;
  for (const name of [...topLevel.keys()].sort()) {
    if (declaredNames.has(name)) continue;
    if (discovery.packageNames.has(name)) continue;
    if (referenced.has(name)) continue;
    const entry = topLevel.get(name);
    if (!entry) continue;
    extraneous++;
    findings.push({
      rule: "EXTRANEOUS",
      severity: "low",
      file: "package-lock.json",
      message: `Locked package "${name}" (${entry.path}) is not declared in any checked package.json and no locked package lists it as a dependency. Only top-level node_modules entries are evaluated for this rule in v0.1; nested copies under another package's node_modules are not evaluated.`,
      evidence: `locked ${entry.version}`,
    });
  }

  const hasHigh = findings.some((f) => f.severity === "high");
  const verdict = hasHigh ? DRIFT_VERDICT : CLEAN_VERDICT;
  const counts: Record<string, number> = {
    declared,
    locked: topLevel.size,
    missing,
    violated,
    extraneous,
    unchecked,
    findings: findings.length,
  };
  const summary =
    verdict === CLEAN_VERDICT
      ? `Checked ${declared} declared dependencies against ${topLevel.size} top-level locked packages: no missing entries and no range violations. ${extraneous} extraneous, ${unchecked} unchecked.`
      : `Checked ${declared} declared dependencies against ${topLevel.size} top-level locked packages: ${missing} missing, ${violated} range violated, ${extraneous} extraneous, ${unchecked} unchecked.`;

  return {
    tool: "lockdrift",
    version: VERSION,
    target,
    verdict,
    counts,
    findings,
    summary,
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

export function renderReport(report: Report): string {
  const c = report.counts;
  const out: string[] = [];
  out.push(`lockdrift check ${report.target}: ${report.verdict}`);
  out.push(
    `  declared: ${c.declared ?? 0}, locked: ${c.locked ?? 0}, missing: ${c.missing ?? 0}, violated: ${c.violated ?? 0}, extraneous: ${c.extraneous ?? 0}, unchecked: ${c.unchecked ?? 0}`,
  );
  for (const f of report.findings) {
    const where = f.file ? ` ${f.file}` : "";
    const evidence = f.evidence ? ` (${f.evidence})` : "";
    out.push(`  [${f.severity.toUpperCase()}] ${f.rule}${where} ${f.message}${evidence}`);
  }
  out.push(`  ${report.summary}`);
  return out.join("\n");
}
