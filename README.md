# lockdrift

Has the lockfile drifted from the manifest? lockdrift compares
the dependency ranges a `package.json` declares against the
ranges recorded in `package-lock.json` and reports every
difference, sorted by name:

- `missing_from_lockfile` — declared in the manifest, absent
  from the lockfile (someone edited package.json and never
  reinstalled)
- `version_mismatch` — present in both, but the recorded ranges
  disagree
- `extra_in_lockfile` — recorded in the lockfile but no longer
  declared

Lockfile v2/v3 (the root `packages[""]` entry) and v1 (the
top-level `dependencies` map) are both supported. The comparison
is of the *recorded ranges* — lockdrift reports recorded drift;
it does not resolve semver or talk to a registry. Pure local
computation: no network, no configuration.

## CLI

```bash
npx @reneturcios/lockdrift check package.json package-lock.json
npx @reneturcios/lockdrift --version
```

Output is the report as JSON, e.g.
`{"in_sync": false, "drift_count": 1, "drift": [{"name": "zod", "kind": "version_mismatch", "declared_in": "dependencies", "package_json_range": "^3", "lockfile_range": "^2"}]}`.

Exit codes: `0` on success (drift is a *result*, not an error),
`1` on a runtime error (unreadable or invalid file), `2` on a
usage error.

## MCP server

```bash
npx -y @reneturcios/lockdrift mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "lockdrift": {
      "command": "npx",
      "args": ["-y", "@reneturcios/lockdrift", "mcp"]
    }
  }
}
```

### Tools

- `check_lockfile_drift` — Compare a package.json against its
  package-lock.json and report drift.
  - `package_json` (string, required) — the package.json
    document, as a JSON string
  - `lockfile_json` (string, required) — the package-lock.json
    document, as a JSON string

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/lockdrift
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/lockdrift check /w/package.json /w/package-lock.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
