# lockdrift

Lockfile drift auditor for npm projects. lockdrift compares the dependency
ranges declared in `package.json` against the versions actually resolved in
`package-lock.json`, and reports where the two have drifted apart:

- a declared dependency with no entry in the lockfile (`LOCK-MISSING`, high)
- a locked version that does not satisfy its declared range
  (`RANGE-VIOLATED`, high, with evidence such as
  `declared ^1.2.0, locked 2.0.0`)
- a locked top-level package that nothing declares and nothing depends on
  (`EXTRANEOUS`, low)
- a declared range in a form lockdrift does not evaluate
  (`RANGE-UNSUPPORTED`, info): counted as unchecked, never as violated

The report verdict is `IN-SYNC` when there are no high findings and `DRIFT`
otherwise. Extraneous (low) and unsupported (info) findings alone do not
change the verdict. Every report carries counts: declared, locked, missing,
violated, extraneous, and unchecked. Output is deterministic, with no
timestamps.

Monorepos: when the root `package.json` declares `workspaces`, or a
`packages/` directory holds package.json files, each workspace package.json
is also checked against the root lockfile. Workspace globs such as
`packages/*` are expanded one level. Patterns in other shapes are reported
with a `WORKSPACES-NOTED` info finding and are not silently treated as
checked.

## Install

```sh
npx @reneturcios/lockdrift check .
```

Or install it as a dependency or a global tool:

```sh
npm install @reneturcios/lockdrift
```

## CLI

```sh
lockdrift check [path] [--json]
lockdrift mcp
lockdrift --version
```

- `check` audits the target directory (default: the current directory).
  Add `--json` for the machine-readable report. Exit code 0 when the
  verdict is `IN-SYNC`, 1 for `DRIFT`, 2 for a usage or input error (for
  example a missing `package.json` or `package-lock.json`, which is a
  clear thrown error, not a report).
- `mcp` runs the MCP server over stdio.
- `--version` prints the version.

## MCP

The MCP server exposes one tool:

- `check_lockfile`, with a `path` argument: runs the same check as the CLI
  and returns the full JSON report (tool name, version, target, verdict,
  counts, findings, and summary).

## Supported range forms

A locked version satisfies a declared range when one of these forms says
so:

- exact: `1.2.3`
- caret: `^1.2.3` (same major; the 0.x rules apply, so `^0.2.3` means
  `>=0.2.3 <0.3.0` and `^0.0.3` means exactly `0.0.3`)
- tilde: `~1.2.3` (means `>=1.2.3 <1.3.0`)
- simple comparators: `>=1.2.3`, `>1.2.3`, `<1.2.3`, `<=1.2.3`
- space-separated AND pairs of comparators, such as `>=1.0.0 <2.0.0`
- `*`, `latest`, and an empty range: always satisfied

Versions with a prerelease or build suffix (such as `1.2.3-beta.1`) are
compared on their numeric core only; the suffix is ignored.

Everything else is unsupported and returns "unchecked" rather than a
guess: URLs, git references, `file:` and other protocol ranges,
`workspace:` ranges, `npm:` aliases, `||` unions, hyphen ranges, and
partial versions such as `^1` or `^1.2`.

## How extraneous is decided

An entry is only evaluated for the extraneous rule at the top level of
`node_modules/`. A top-level locked package is extraneous when it is not
declared in any checked package.json, is not a local workspace package,
and no lock entry lists it in its `dependencies`, `peerDependencies`, or
`optionalDependencies`. That reference set is the v0.1 approximation of
transitivity: it does not walk the graph package by package. Nested
copies under another package's `node_modules/` are not evaluated, only
the top-level entry for each name.

## Limits

- npm lockfiles only. lockdrift reads the lockfile v3 `packages` map
  from `package-lock.json`. There is no yarn or pnpm lockfile support
  in v0.1.
- Unsupported ranges are reported as unchecked, never guessed and never
  flagged as violated.
- Static analysis only. Nothing in a checked repo is installed or
  executed.
- The root lock entry (the empty-string key in the `packages` map)
  mirrors `package.json` and is not itself treated as a locked package.

## Development

```sh
npm install
npm run build
npm test
```
