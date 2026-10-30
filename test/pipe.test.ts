/**
 * Pipe regression tests, following the fleet emit contract (see the
 * flowcheck pipe tests): Node stdout attached to a pipe is asynchronous,
 * so a report must be delivered whole through the pipe and an early
 * closing reader must never see a success exit.
 *
 * The fixture here is generated, not checked in: a package.json and
 * package-lock.json with 3000 violated dependencies, which pushes the
 * JSON report past 200 KiB.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runCheck, renderReport } from "../src/core.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEP_COUNT = 3000;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lockdrift-pipe-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 3000 declared deps, each locked outside its declared caret range. */
function writeBigRepo(root: string, count = DEP_COUNT): void {
  const declared: Record<string, string> = {};
  const locked: Record<string, unknown> = {
    "": { name: "big-repo", version: "1.0.0", dependencies: declared },
  };
  for (let i = 0; i < count; i++) {
    const name = `dep-${i}`;
    declared[name] = "^1.0.0";
    locked[`node_modules/${name}`] = { version: "2.0.0" };
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "big-repo", version: "1.0.0", dependencies: declared }, null, 2),
    "utf8",
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ name: "big-repo", version: "1.0.0", lockfileVersion: 3, requires: true, packages: locked }, null, 2),
    "utf8",
  );
}

interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], opts: { destroyStdoutOnFirstChunk?: boolean } = {}): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error("CLI timed out"));
    }, 90000);
    if (opts.destroyStdoutOnFirstChunk) {
      child.stdout.destroy();
    }
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
      if (opts.destroyStdoutOnFirstChunk) child.stdout.destroy();
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      rejectPromise(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout: out, stderr: err });
    });
  });
}

describe("emit contract: piped output is delivered whole", () => {
  it("piped --json check over 200 KiB parses and matches the in-process report", { timeout: 120000 }, async () => {
    writeBigRepo(dir);
    const direct = runCheck(dir);
    const directJson = JSON.stringify(direct, null, 2);
    assert.ok(directJson.length > 200_000, `fixture must exceed 200 KiB of JSON, got ${directJson.length}`);
    assert.equal(direct.counts.violated, DEP_COUNT);
    const res = await runCli(["check", dir, "--json"]);
    assert.equal(res.code, 1, `expected exit 1 (DRIFT), got ${res.code} (stderr: ${res.stderr.slice(0, 200)})`);
    assert.equal(res.stdout.length, directJson.length + 1, "piped bytes must equal the full report plus the trailing newline");
    const parsed = JSON.parse(res.stdout) as { counts: { violated: number }; verdict: string };
    assert.equal(parsed.counts.violated, direct.counts.violated);
    assert.equal(parsed.verdict, direct.verdict);
  });

  it("piped human check output is byte-identical to the in-process render", { timeout: 120000 }, async () => {
    writeBigRepo(dir);
    const expected = renderReport(runCheck(dir)) + "\n";
    assert.ok(expected.length > 65_536, `human fixture must exceed one pipe buffer, got ${expected.length}`);
    const res = await runCli(["check", dir]);
    assert.equal(res.code, 1);
    assert.equal(res.stdout, expected);
  });

  it("a reader that closes the pipe early never sees a success exit", { timeout: 120000 }, async () => {
    writeBigRepo(dir);
    const res = await runCli(["check", dir, "--json"], { destroyStdoutOnFirstChunk: true });
    assert.notEqual(res.code, 0, "exit 0 would report success for output that was never delivered");
    assert.ok(res.signal === "SIGPIPE" || res.code === 141, `expected SIGPIPE or exit 141, got code ${res.code} signal ${res.signal}`);
  });
});
