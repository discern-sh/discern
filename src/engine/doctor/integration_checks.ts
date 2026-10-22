/**
 * Integration-file diagnostics for `discern doctor`, read-only.
 *
 * discern expects Git to track each configured agent's Shared integration
 * files, so fresh clones and cloud agents carry its wiring. discern's
 * `.gitignore` block re-includes the ones the project's root rules exclude
 * (ADR 0428), so an untracked integration file Git still ignores has one of
 * two causes, each with its own fix: a root rule refresh hasn't answered yet,
 * or a rule the block cannot override, such as this machine's global excludes
 * or a nested ignore file.
 */

import {
  type DiscernConfig,
  resolveConfiguredAgents,
} from "../../shared/config_schema.ts";
import { ignoredIntegrationFiles } from "../../lib/ignored_integration_files.ts";
import { trackedSharedProviderPaths } from "../../lib/artifact_ownership.ts";
import {
  describeIgnoredFiles,
  untrackedIgnoredFiles,
} from "../../shared/ignored_integration.ts";
import type { DoctorDraftCheck } from "./completion_checks.ts";

const INTEGRATION_FILES = "integration files";
const ROOT_IGNORE = ".gitignore";

/** One check that Git can track every configured agent's integration file;
 * empty when those agents write none, or outside a Git repository, where Git
 * cannot answer. */
export async function integrationFileChecks(
  root: string,
  config: DiscernConfig,
): Promise<DoctorDraftCheck[]> {
  const agents = resolveConfiguredAgents(config);
  const total = trackedSharedProviderPaths(agents).length;
  if (total === 0) return [];
  const matched = await ignoredIntegrationFiles(root, agents);
  if (matched === undefined) return [];
  const hidden = untrackedIgnoredFiles(matched);
  if (hidden.length === 0) {
    return [{
      name: INTEGRATION_FILES,
      ok: true,
      detail:
        `Git can track all ${total} integration file(s) of the configured agents`,
    }];
  }
  const rootRules = hidden.filter((file) => file.source === ROOT_IGNORE);
  const elsewhere = hidden.filter((file) => file.source !== ROOT_IGNORE);
  const fixes = [
    rootRules.length === 0
      ? undefined
      : `run \`discern refresh\` so discern's ${ROOT_IGNORE} block re-includes ${
        describeIgnoredFiles(rootRules)
      }`,
    elsewhere.length === 0
      ? undefined
      : `commit ${
        describeIgnoredFiles(elsewhere)
      } once with \`git add --force -- ${
        elsewhere.map((file) => file.path).join(" ")
      }\`, since no ignore rule applies to a tracked file`,
  ].filter((fix): fix is string => fix !== undefined);
  return [{
    name: INTEGRATION_FILES,
    ok: true,
    warn: true,
    detail: `Git ignores ${describeIgnoredFiles(hidden)} and doesn't track ${
      hidden.length === 1 ? "it" : "them"
    }, so fresh clones and cloud agents lack discern's wiring there`,
    fix: fixes.join("; "),
  }];
}
