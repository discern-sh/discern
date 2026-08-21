/** Structured config-validation evidence shared by the loader and result schemas. */

/** Config issue classifications whose recovery depends on more than a path. */
export const CONFIG_ISSUE_KINDS = ["unknown_root_section"] as const;
export type ConfigIssueKind = (typeof CONFIG_ISSUE_KINDS)[number];

/** One schema-validation problem in \`discern.toml\`. */
export interface ConfigIssue {
  /** Machine-readable classification for issue families with tailored recovery. */
  kind?: ConfigIssueKind;
  /** Dotted path to the offending value, or the exact root section name. */
  path: string;
  /** What is wrong, phrased for a person reading it next to the config. */
  message: string;
}

/** Exact root section names a strict running schema did not recognize. */
export function unknownRootSections(
  issues: readonly ConfigIssue[],
): string[] {
  return [
    ...new Set(
      issues.flatMap((issue) =>
        issue.kind === "unknown_root_section" ? [issue.path] : []
      ),
    ),
  ];
}
