/**
 * lockdrift core: package.json vs package-lock.json drift.
 *
 *   checkLockfileDrift(packageJson, lockfileJson) -> result
 *
 * Both inputs are the documents themselves, as JSON strings.
 * The declared set is the manifest's `dependencies` plus
 * `devDependencies` (each entry remembers which section declared
 * it). The locked set comes from the lockfile: for lockfile
 * v2/v3, the root `packages[""]` entry's `dependencies` +
 * `devDependencies` (npm records the manifest ranges there); for
 * a v1 lockfile, the top-level `dependencies` map (whose values
 * carry the resolved `version`).
 *
 * Drift kinds:
 *   missing_from_lockfile — declared but absent from the lockfile
 *   version_mismatch      — present in both, range strings differ
 *   extra_in_lockfile     — locked but no longer declared
 *
 * The comparison is an exact string comparison of the recorded
 * ranges: this tool reports recorded drift, it does not resolve
 * semver. An input that is not a string, does not parse, or has
 * an unrecognised shape is an error naming the input — never a
 * fabricated "in sync".
 */
import type { DriftEntry, LockfileDriftResult } from "./types.js";

export const VERSION = "0.1.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInput(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "string") {
    throw new Error(`${label} is required and must be a JSON string`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    throw new Error(
      `${label} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function stringMap(value: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (isRecord(value)) {
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === "string") out.set(key, raw);
    }
  }
  return out;
}

/** Compare a package.json and a package-lock.json, both as JSON strings. */
export function checkLockfileDrift(packageJson: unknown, lockfileJson: unknown): LockfileDriftResult {
  const manifest = parseInput(packageJson, "package_json");
  const lockfile = parseInput(lockfileJson, "lockfile_json");

  const declared = new Map<string, { range: string; section: "dependencies" | "devDependencies" }>();
  for (const section of ["dependencies", "devDependencies"] as const) {
    for (const [name, range] of stringMap(manifest[section])) {
      declared.set(name, { range, section });
    }
  }

  const locked = new Map<string, string>();
  const packages = lockfile.packages;
  if (isRecord(packages) && isRecord(packages[""])) {
    const root = packages[""];
    for (const section of ["dependencies", "devDependencies"] as const) {
      for (const [name, range] of stringMap(root[section])) {
        locked.set(name, range);
      }
    }
  } else if (isRecord(lockfile.dependencies)) {
    for (const [name, entry] of Object.entries(lockfile.dependencies)) {
      if (isRecord(entry) && typeof entry.version === "string") {
        locked.set(name, entry.version);
      }
    }
  } else {
    throw new Error(
      "lockfile_json has an unrecognised shape: expected a packages[\"\"] root entry (lockfile v2/v3) or a top-level dependencies map (v1)",
    );
  }

  const drift: DriftEntry[] = [];
  for (const [name, { range, section }] of declared) {
    const lockedRange = locked.get(name);
    if (lockedRange === undefined) {
      drift.push({
        name,
        kind: "missing_from_lockfile",
        declared_in: section,
        package_json_range: range,
      });
    } else if (lockedRange !== range) {
      drift.push({
        name,
        kind: "version_mismatch",
        declared_in: section,
        package_json_range: range,
        lockfile_range: lockedRange,
      });
    }
  }
  for (const [name, range] of locked) {
    if (!declared.has(name)) {
      drift.push({ name, kind: "extra_in_lockfile", lockfile_range: range });
    }
  }
  drift.sort((a, b) => a.name.localeCompare(b.name));
  return { in_sync: drift.length === 0, drift_count: drift.length, drift };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
