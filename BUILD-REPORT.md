# lockdrift — Build Report

MCP Rebuild 1000 (Tranche #101+ Batch 10). **Original build**
from the program's own packages-100 plan
(`~/workspace/packages-100/100-packages-plan.md`, cluster B
#23: "lockfile vs package.json drift across a monorepo"), NOT a
rebuild of an external server. The tool surface is the
program's defined spec, recorded in
`harness/fixtures/lockdrift-tools-original.json` with its
`_source` labelled "program spec". Local build only — nothing
pushed or published.

Identity: repo `lockdrift`, npm `@reneturcios/lockdrift`,
MCP name `io.github.CloudCorpRecords/lockdrift`, version
`0.1.0`, bin `lockdrift` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Report drift
  between a package.json and its package-lock.json: missing,
  mismatched, extra.", ≤100 chars; npm entry carries
  `version: 0.1.0`; OCI entry `ghcr.io/cloudcorprecords/lockdrift:0.1.0`
  carries **no** `version` field), `Dockerfile` (node:20-alpine
  two-stage, label `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/lockdrift"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright (c)
  2026 Rene Turcios), `README.md` (fresh text), `CHANGELOG.md`
  (single 0.1.0 entry, 2026-10-27)
- `src/index.ts`, `src/cli.ts` (`check <package.json>
  <package-lock.json>`, `mcp`, `--version`; exit 2 usage / 1
  runtime error, argument validation before any file is read),
  `src/mcp.ts`, `src/types.ts`, `src/lockdrift.ts` (core,
  `VERSION = "0.1.0"`)
- `test/lockdrift.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`

## Tools implemented (1)

- `check_lockfile_drift` — `package_json`, `lockfile_json`
  (strings, required): the two documents as JSON strings.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals exactly matching the fixture, per the
  standing fleet rule; zod still validates every `tools/call`.
- Declared set = manifest `dependencies` + `devDependencies`
  (section recorded per entry). Locked set = lockfile v2/v3
  root `packages[""]` ranges, or v1 top-level `dependencies`
  versions. Comparison is an exact string comparison of the
  recorded ranges — recorded drift, not semver resolution —
  stated in the README and the core header. Results sorted by
  name for determinism.
- Pure local computation: no filesystem in the core (the CLI
  does the file reading), no network, no configuration.

## Verification (foreground, coordinator re-run)

- `tsc --noEmit` exit 0; `npm run build` exit 0 (`dist/cli.js`)
- `npm test`: **9 tests, 9 pass, 0 fail** — exact-agreement
  in-sync, v1 lockfile support, each drift kind with its
  recorded fields, combined sorted output, invalid JSON naming
  the input, non-string/non-object rejection, unrecognised
  lockfile shape rejection
- `dist/cli.js --version` → `0.1.0`
- Parity: `harness/parity.py` vs
  `harness/fixtures/lockdrift-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1** (program-spec
  fixture)

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp copy with
only `package.json`, offline `npm install --package-lock-only
--ignore-scripts --offline`), verified: parses, name
`@reneturcios/lockdrift`, **128 package entries**. Local
`node_modules` is a symlink to the sibling burnmeter tree;
gitignored.

## Gaps / honest notes

- Program-spec build: the plan's one-line description is the
  whole upstream spec; the tool surface and drift semantics are
  this program's definitions, recorded in the fixture's
  `_source`.
- The plan says "across a monorepo": this build compares one
  manifest/lockfile pair per call; multi-workspace aggregation
  is caller-side (one call per workspace). Recorded, not hidden.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.
