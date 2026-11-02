# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `check_lockfile_drift` MCP tool and `check`
  CLI command comparing a package.json with its package-lock.json
  (lockfile v3 root entry, or v1 dependencies map).
- Reports `missing_from_lockfile`, `version_mismatch`, and
  `extra_in_lockfile` entries, sorted by name, with an `in_sync`
  verdict.
