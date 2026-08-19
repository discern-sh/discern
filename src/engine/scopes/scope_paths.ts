/**
 * The ONE spelling of "a scope's effective globs" — live config references
 * resolved over a scope's path list — shared by the scope classifier and the
 * checkpoint policy resolver, whose scope selectors must mean exactly what
 * scope classification means.
 *
 * A deliberate LEAF: the checkpoint policy resolver sits in the logbook's
 * statically-walked module graph (the patterns hygiene candidates), and that
 * graph is held network-free by `tests/logbook_no_network_test.ts`, so this
 * shared spelling must not drag the classifier's verb machinery with it.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { expandSourcePathReferences } from "../../shared/source_path_references.ts";

/** Resolve live config references in one scope's path list. */
export function resolvedScopePaths(
  config: DiscernConfig,
  scope: string,
): string[] {
  return (config.scopes[scope]?.paths ?? []).map((path) =>
    expandSourcePathReferences(path, config)
  );
}
