import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkLockfileDrift } from "../src/lockdrift.js";

/**
 * All tests are pure local computation over inline JSON strings:
 * no filesystem, no network. Shapes mirror real npm output
 * (lockfile v3 root entry, and a v1 dependencies map).
 */

const MANIFEST = JSON.stringify({
  name: "@reneturcios/demo",
  version: "0.1.0",
  dependencies: { "@modelcontextprotocol/sdk": "^1", zod: "^3" },
  devDependencies: { typescript: "^5", tsx: "^4" },
});

function lockV3(rootDeps: Record<string, string>, rootDev: Record<string, string>): string {
  return JSON.stringify({
    name: "@reneturcios/demo",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "@reneturcios/demo",
        version: "0.1.0",
        dependencies: rootDeps,
        devDependencies: rootDev,
      },
      "node_modules/zod": { version: "3.25.76" },
    },
  });
}

describe("checkLockfileDrift — in sync", () => {
  it("reports in_sync when the records agree exactly", () => {
    const lock = lockV3(
      { "@modelcontextprotocol/sdk": "^1", zod: "^3" },
      { typescript: "^5", tsx: "^4" },
    );
    const out = checkLockfileDrift(MANIFEST, lock);
    assert.equal(out.in_sync, true);
    assert.equal(out.drift_count, 0);
    assert.deepEqual(out.drift, []);
  });

  it("supports a v1 lockfile (resolved versions in the dependencies map)", () => {
    const manifest = JSON.stringify({ dependencies: { leftpad: "1.3.0" } });
    const lock = JSON.stringify({
      lockfileVersion: 1,
      dependencies: { leftpad: { version: "1.3.0" } },
    });
    const out = checkLockfileDrift(manifest, lock);
    assert.equal(out.in_sync, true);
  });
});

describe("checkLockfileDrift — drift kinds", () => {
  it("reports a declared dependency missing from the lockfile, with its section", () => {
    const lock = lockV3({ "@modelcontextprotocol/sdk": "^1" }, { typescript: "^5", tsx: "^4" });
    const out = checkLockfileDrift(MANIFEST, lock);
    assert.equal(out.in_sync, false);
    assert.deepEqual(out.drift, [
      { name: "zod", kind: "missing_from_lockfile", declared_in: "dependencies", package_json_range: "^3" },
    ]);
  });

  it("reports a range mismatch with both ranges recorded", () => {
    const lock = lockV3(
      { "@modelcontextprotocol/sdk": "^1", zod: "^2" },
      { typescript: "^5", tsx: "^4" },
    );
    const out = checkLockfileDrift(MANIFEST, lock);
    assert.deepEqual(out.drift, [
      {
        name: "zod",
        kind: "version_mismatch",
        declared_in: "dependencies",
        package_json_range: "^3",
        lockfile_range: "^2",
      },
    ]);
  });

  it("reports a locked package the manifest no longer declares", () => {
    const lock = lockV3(
      { "@modelcontextprotocol/sdk": "^1", zod: "^3", leftover: "^9" },
      { typescript: "^5", tsx: "^4" },
    );
    const out = checkLockfileDrift(MANIFEST, lock);
    assert.deepEqual(out.drift, [
      { name: "leftover", kind: "extra_in_lockfile", lockfile_range: "^9" },
    ]);
  });

  it("combines all three kinds, sorted by name", () => {
    const lock = lockV3(
      { "@modelcontextprotocol/sdk": "^0", extra1: "1.0.0" },
      { typescript: "^5" },
    );
    const out = checkLockfileDrift(MANIFEST, lock);
    assert.equal(out.drift_count, 4);
    assert.deepEqual(
      out.drift.map((d) => d.name),
      ["@modelcontextprotocol/sdk", "extra1", "tsx", "zod"],
    );
    assert.deepEqual(
      out.drift.map((d) => d.kind),
      ["version_mismatch", "extra_in_lockfile", "missing_from_lockfile", "missing_from_lockfile"],
    );
  });
});

describe("checkLockfileDrift — input validation", () => {
  it("rejects invalid JSON, naming the input", () => {
    assert.throws(() => checkLockfileDrift("{nope", "{}"), /package_json is not valid JSON/);
    assert.throws(() => checkLockfileDrift("{}", "[1,"), /lockfile_json is not valid JSON/);
  });

  it("rejects non-string and non-object inputs", () => {
    assert.throws(() => checkLockfileDrift(undefined, "{}"), /package_json is required/);
    assert.throws(() => checkLockfileDrift("[]", "{}"), /package_json must be a JSON object/);
  });

  it("rejects a lockfile with neither a root packages entry nor a v1 dependencies map", () => {
    assert.throws(
      () => checkLockfileDrift("{}", JSON.stringify({ lockfileVersion: 3 })),
      /unrecognised shape/,
    );
  });
});
