#!/usr/bin/env node
/**
 * lockdrift CLI.
 *
 *   lockdrift check <package.json> <package-lock.json>
 *   lockdrift mcp
 *
 * Both arguments are file paths; the documents are read and
 * compared locally. Pure local computation: no network, no
 * configuration. Argument validation happens before any file
 * is read. Exit codes: 0 success, 1 runtime error (including an
 * unreadable or invalid file), 2 usage error.
 */
import { readFileSync } from "node:fs";
import { checkLockfileDrift, formatPayload, VERSION } from "./lockdrift.js";

function usage(): never {
  console.error(`Usage:
  lockdrift check <package.json> <package-lock.json>
  lockdrift mcp
  lockdrift --version`);
  process.exit(2);
}

function readFile(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(
      `error: cannot read ${label} file '${path}': ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (cmd !== "check" || rest.length !== 2) usage();

  const packageJson = readFile(rest[0], "package.json");
  const lockfileJson = readFile(rest[1], "package-lock.json");
  try {
    const out = checkLockfileDrift(packageJson, lockfileJson);
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
