/**
 * lockdrift types.
 *
 * lockdrift compares the dependency ranges a package.json
 * declares (dependencies + devDependencies) against the ranges
 * recorded in the lockfile's root entry (package-lock.json
 * `packages[""]` for lockfile v2/v3, or the top-level
 * `dependencies` map for v1) and reports the drift: declared
 * packages missing from the lockfile, ranges that disagree, and
 * locked packages the manifest no longer declares. It works on
 * the two documents given as strings — no filesystem, no
 * network, no registry.
 */

/** One drift entry. */
export interface DriftEntry {
  /** Dependency name. */
  name: string;
  kind: "missing_from_lockfile" | "version_mismatch" | "extra_in_lockfile";
  /** Where the package.json declares it, when it does. */
  declared_in?: "dependencies" | "devDependencies";
  /** The range in package.json, when declared. */
  package_json_range?: string;
  /** The range/version recorded in the lockfile, when present. */
  lockfile_range?: string;
}

/** The full drift report. */
export interface LockfileDriftResult {
  in_sync: boolean;
  drift_count: number;
  drift: DriftEntry[];
}
