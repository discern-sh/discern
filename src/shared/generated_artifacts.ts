/**
 * Pure access to `[generated.<name>]` declarations (ADR 0247). Consumers resolve
 * the config once, then use the same scope-glob matcher as scope classification
 * to attribute committed artifact paths to their owning generator.
 */

import { type DiscernConfig, toCommand } from "./config_schema.ts";
import { expandSourcePathReferences } from "./source_path_references.ts";
import { pathMatchesPattern } from "../engine/scopes/glob.ts";

/** One generated-artifact group ready for gate, update, and doctor consumers. */
export interface ResolvedGeneratedGroup {
  /** The `<name>` from `[generated.<name>]`. */
  readonly name: string;
  /** Root-relative ownership globs, with live source-path references expanded. */
  readonly paths: readonly string[];
  /** The declared command list normalized to one shell command. */
  readonly run: string;
  /** Whether GitHub Linguist should present this group as generated. */
  readonly linguistGenerated: boolean;
  /** Per-command time budget; absent means the global gate budget. */
  readonly timeout?: number;
}

/** Resolve every configured generated-artifact group. */
export function resolveGeneratedGroups(
  config: DiscernConfig,
): ResolvedGeneratedGroup[] {
  return Object.entries(config.generated).map(([name, group]) => ({
    name,
    paths: group.paths.map((path) => expandSourcePathReferences(path, config)),
    run: expandSourcePathReferences(toCommand(group.run), config),
    linguistGenerated: group.linguist_generated,
    ...(group.timeout === undefined ? {} : { timeout: group.timeout }),
  }));
}

/** The first resolved group whose ownership globs match `path`, if one does. */
export function generatedGroupForPath(
  groups: readonly ResolvedGeneratedGroup[],
  path: string,
): ResolvedGeneratedGroup | undefined {
  return groups.find((group) =>
    group.paths.some((pattern) => pathMatchesPattern(path, pattern))
  );
}
