/**
 * The facts every surface shares about integration files a project's own
 * ignore rules exclude: their shape, the owner's choices, and one rendering.
 * The probe that finds them lives in `src/lib/ignored_integration_files.ts`;
 * this bottom layer lets setup's messages name them without importing it.
 */

import { RESULT_OPEN_VOCABULARIES } from "./result.ts";

/** One integration file an ignore rule matches. */
export interface IgnoredIntegrationFile {
  readonly path: string;
  /** The deciding rule as `<file>:<line>: <pattern>`. */
  readonly rule: string;
  /** Git tracks it already, so the rule does not apply to it, though
   * `git add` still needs `--force` while its folder is ignored. */
  readonly tracked: boolean;
}

/** The `setup begin` option carrying the owner's choice. */
export const IGNORED_INTEGRATION_FLAG = "ignored-integration-files";

/** The choices `setup begin` can apply. Changing the rule is the third
 * answer; it happens before setup, so it needs no option. */
export const IGNORED_INTEGRATION_CHOICES = RESULT_OPEN_VOCABULARIES[
  "x-discern-ignored-integration-choices"
].values;
export type IgnoredIntegrationChoice =
  typeof IGNORED_INTEGRATION_CHOICES[number];

/** The choice the setup decision recommends. */
export const RECOMMENDED_IGNORED_INTEGRATION_CHOICE: IgnoredIntegrationChoice =
  "track-anyway";

/** Narrow a raw option value to an owner choice. */
export function isIgnoredIntegrationChoice(
  value: string,
): value is IgnoredIntegrationChoice {
  return (IGNORED_INTEGRATION_CHOICES as readonly string[]).includes(value);
}

/** The matched files Git does not track: each needs the owner's decision. */
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
  return [...byRule].map(([rule, paths]) =>
    `${paths.map((path) => `\`${path}\``).join(", ")} (${rule})`
  ).join("; ");
}
