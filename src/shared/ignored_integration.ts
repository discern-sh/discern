/**
 * The facts every surface shares about integration files an ignore rule
 * matches: their shape and one rendering. The Git probe that finds them lives
 * in `src/lib/ignored_integration_files.ts`; this bottom layer lets setup's
 * messages name them without importing it.
 */

/** One integration file an ignore rule matches. */
export interface IgnoredIntegrationFile {
  readonly path: string;
  /** The deciding rule as `<file>:<line>: <pattern>`. */
  readonly rule: string;
  /** The file holding the deciding rule, as Git names it. */
  readonly source: string;
  /** The deciding rule's 1-based line in that file. */
  readonly line: number;
  /** Git tracks it already, so the rule does not apply to it, though
   * `git add` still needs `--force` while its folder is ignored. */
  readonly tracked: boolean;
}

/** The matched files Git does not track. */
export function untrackedIgnoredFiles(
  files: readonly IgnoredIntegrationFile[],
): IgnoredIntegrationFile[] {
  return files.filter((file) => !file.tracked);
}

/** The files as one inline list, grouped under the rule that excludes them. */
export function describeIgnoredFiles(
  files: readonly Pick<IgnoredIntegrationFile, "path" | "rule">[],
): string {
  const byRule = new Map<string, string[]>();
  for (const file of files) {
    byRule.set(file.rule, [...byRule.get(file.rule) ?? [], file.path]);
  }
  return [...byRule].map(([rule, paths]) => `${describePaths(paths)} (${rule})`)
    .join("; ");
}

/** Paths as one inline list of code spans. */
export function describePaths(paths: readonly string[]): string {
  return paths.map((path) => `\`${path}\``).join(", ");
}
