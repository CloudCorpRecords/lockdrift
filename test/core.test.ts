/**
 * lockdrift core tests: the satisfiesRange unit table and the fixture
 * repos under test/fixtures.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck, renderReport, satisfiesRange, CLEAN_VERDICT, VERSION } from "../src/core.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

function rules(report: ReturnType<typeof runCheck>): string[] {
  return report.findings.map((f) => f.rule);
}

describe("satisfiesRange unit table", () => {
  const cases: Array<[string, string, boolean | null]> = [
    // exact
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    // caret, major >= 1
    ["1.2.0", "^1.2.0", true],
    ["1.5.0", "^1.2.0", true],
    ["2.0.0", "^1.2.0", false],
    ["1.1.9", "^1.2.0", false],
    // caret, 0.x rules
    ["0.2.3", "^0.2.3", true],
    ["0.2.9", "^0.2.3", true],
    ["0.3.0", "^0.2.3", false],
    ["0.2.2", "^0.2.3", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["0.1.0", "^0.0.3", false],
    // tilde
    ["1.2.3", "~1.2.3", true],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.2.2", "~1.2.3", false],
    ["0.2.9", "~0.2.3", true],
    ["0.3.0", "~0.2.3", false],
    // comparators
    ["2.0.0", ">=1.2.0", true],
    ["1.1.0", ">=1.2.0", false],
    ["1.2.4", ">1.2.3", true],
    ["1.2.3", ">1.2.3", false],
    ["1.2.3", "<=1.2.3", true],
    ["1.2.4", "<=1.2.3", false],
    ["1.2.2", "<1.2.3", true],
    ["1.2.3", "<1.2.3", false],
    // space-separated AND pairs
    ["1.5.0", ">=1.0.0 <2.0.0", true],
    ["2.5.0", ">=1.0.0 <2.0.0", false],
    ["0.9.0", ">=1.0.0 <2.0.0", false],
    ["3.1.0", ">=3.0.0 <4.0.0", true],
    // always-true forms
    ["9.9.9", "*", true],
    ["1.0.0", "latest", true],
    ["1.0.0", "", true],
    // prerelease suffix: numeric core only
    ["1.2.3-beta.1", "^1.2.0", true],
    ["2.0.0-alpha", "^1.2.0", false],
    ["1.2.3", "^1.2.3-alpha", true],
    // unsupported forms return null
    ["1.2.3", "workspace:*", null],
    ["1.2.3", "file:../foo", null],
    ["1.2.3", "https://example.com/foo.tgz", null],
    ["1.2.3", "git+https://github.com/example/foo.git", null],
    ["1.2.3", "npm:foo@1.0.0", null],
    ["1.2.3", "^1.0.0 || ^2.0.0", null],
    ["1.2.3", "1.0.0 - 2.0.0", null],
    ["1.2.3", "^1", null],
    ["1.2.3", "^1.2", null],
  ];
  for (const [version, range, expected] of cases) {
    it(`satisfiesRange(${JSON.stringify(version)}, ${JSON.stringify(range)}) is ${String(expected)}`, () => {
      assert.equal(satisfiesRange(version, range), expected);
    });
  }
});

describe("fixture repos", () => {
  it("repo-insync verdicts IN-SYNC with zero findings, and a referenced transitive dep is not extraneous", () => {
    const r = runCheck(fixture("repo-insync"));
    assert.equal(r.version, VERSION);
    assert.equal(r.tool, "lockdrift");
    assert.equal(r.verdict, CLEAN_VERDICT);
    assert.equal(r.findings.length, 0, JSON.stringify(r.findings, null, 2));
    assert.deepEqual(
      {
        declared: r.counts.declared,
        locked: r.counts.locked,
        missing: r.counts.missing,
        violated: r.counts.violated,
        extraneous: r.counts.extraneous,
        unchecked: r.counts.unchecked,
      },
      { declared: 3, locked: 4, missing: 0, violated: 0, extraneous: 0, unchecked: 0 },
    );
  });

  it("repo-missing flags the dep with no lock entry as LOCK-MISSING (high) and verdicts DRIFT", () => {
    const r = runCheck(fixture("repo-missing"));
    assert.equal(r.verdict, "DRIFT");
    assert.equal(r.counts.missing, 1);
    assert.equal(r.counts.violated, 0);
    const f = r.findings.find((x) => x.rule === "LOCK-MISSING");
    assert.ok(f);
    assert.equal(f.severity, "high");
    assert.match(f.message, /"ghost"/);
    assert.equal(f.evidence, "declared ^1.0.0, locked (missing)");
  });

  it("repo-violated flags a caret violation and a tilde violation with exact evidence", () => {
    const r = runCheck(fixture("repo-violated"));
    assert.equal(r.verdict, "DRIFT");
    assert.equal(r.counts.violated, 2);
    const byEvidence = r.findings.filter((x) => x.rule === "RANGE-VIOLATED").map((x) => x.evidence);
    assert.ok(byEvidence.includes("declared ^1.2.0, locked 2.0.0"), byEvidence.join(" | "));
    assert.ok(byEvidence.includes("declared ~1.2.3, locked 1.3.0"), byEvidence.join(" | "));
    assert.ok(r.findings.every((x) => x.severity === "high"));
  });

  it("repo-extraneous flags only the unreferenced top-level stray, as low, and stays IN-SYNC", () => {
    const r = runCheck(fixture("repo-extraneous"));
    assert.equal(r.counts.extraneous, 1);
    const extra = r.findings.filter((x) => x.rule === "EXTRANEOUS");
    assert.equal(extra.length, 1);
    assert.match(extra[0].message, /"stray"/);
    assert.equal(extra[0].severity, "low");
    // The nested copy under alpha and the referenced transitive dep
    // delta must not be flagged.
    assert.ok(!extra[0].message.includes("nested-copy"));
    assert.ok(!extra[0].message.includes('"delta"'));
    // A low finding alone is not drift: the verdict rule is no highs.
    assert.equal(r.verdict, CLEAN_VERDICT);
  });

  it("repo-unsupported counts the workspace: dep as unchecked, never violated", () => {
    const r = runCheck(fixture("repo-unsupported"));
    assert.equal(r.counts.unchecked, 1);
    assert.equal(r.counts.violated, 0);
    assert.equal(r.counts.missing, 0);
    assert.ok(rules(r).includes("RANGE-UNSUPPORTED"));
    const f = r.findings.find((x) => x.rule === "RANGE-UNSUPPORTED");
    assert.ok(f);
    assert.equal(f.severity, "info");
    assert.equal(f.evidence, "declared workspace:*, locked 1.0.0");
    assert.equal(r.verdict, CLEAN_VERDICT);
  });

  it("repo-workspaces checks workspace package.json files against the root lock", () => {
    const r = runCheck(fixture("repo-workspaces"));
    assert.equal(r.verdict, "DRIFT");
    assert.equal(r.counts.declared, 2);
    assert.equal(r.counts.violated, 1);
    // The workspace package itself (a link entry in the lock) is not
    // extraneous.
    assert.equal(r.counts.extraneous, 0);
    const f = r.findings.find((x) => x.rule === "RANGE-VIOLATED");
    assert.ok(f);
    assert.equal(f.file, "packages/widget/package.json");
    assert.equal(f.evidence, "declared ^3.0.0, locked 4.0.0");
  });
});

describe("missing inputs", () => {
  it("a target with no package.json throws a clear error", () => {
    const dir = mkdtempSync(join(tmpdir(), "lockdrift-empty-"));
    try {
      assert.throws(() => runCheck(dir), /package\.json not found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a target with a package.json but no lockfile throws a clear error", () => {
    const dir = mkdtempSync(join(tmpdir(), "lockdrift-nolock-"));
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }), "utf8");
      assert.throws(() => runCheck(dir), /package-lock\.json not found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("rendering", () => {
  it("renderReport is deterministic and carries the verdict and counts", () => {
    const r = runCheck(fixture("repo-violated"));
    const a = renderReport(r);
    const b = renderReport(runCheck(fixture("repo-violated")));
    assert.equal(a, b);
    assert.match(a, /lockdrift check/);
    assert.match(a, /DRIFT/);
    assert.match(a, /violated: 2/);
    assert.match(a, /RANGE-VIOLATED/);
  });
});
