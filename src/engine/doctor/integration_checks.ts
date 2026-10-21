/**
 * Integration-file diagnostics for `discern doctor`, read-only.
 *
 * discern expects Git to track each configured agent's Shared integration
 * files, so fresh clones and cloud agents carry its wiring. When the project's
 * own ignore rules exclude one Git does not track yet, refresh keeps
 * regenerating a copy only this checkout has. That is fine when the owner
 * chose it, recorded in `[project].local_integration_files`; otherwise the
 * owner has a decision to make, the same one setup's preflight serves.
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
const KEPT_LOCAL_KEY = "[project].local_integration_files";

/** One check comparing Git's ignore verdicts on the configured agents'
 * integration files with the recorded keep-local choice; empty when those
 * agents write none, or outside a Git repository, where Git cannot answer. */
export async function integrationFileChecks(
  root: string,
  config: DiscernConfig,
): Promise<DoctorDraftCheck[]> {
  const agents = resolveConfiguredAgents(config);
  const total = trackedSharedProviderPaths(agents).length;
  if (total === 0) return [];
  const matched = await ignoredIntegrationFiles(root, agents);
  if (matched === undefined) return [];
  const listed = new Set(config.project.local_integration_files);
  const untracked = untrackedIgnoredFiles(matched);
  const undecided = untracked.filter((file) => !listed.has(file.path));
  const keptLocal = untracked.filter((file) => listed.has(file.path));
  const keptPaths = new Set(keptLocal.map((file) => file.path));
  const stale = [...listed].filter((path) => !keptPaths.has(path));

  const problems: string[] = [];
  const fixes: string[] = [];
  if (undecided.length > 0) {
    const paths = undecided.map((file) => file.path).join(" ");
    problems.push(
      `the project's ignore rules exclude ${
        describeIgnoredFiles(undecided)
      }, and Git doesn't track ${
        undecided.length === 1 ? "it" : "them"
      }, so fresh clones and cloud agents lack discern's wiring there`,
    );
    fixes.push(
      `ask the owner, then either commit ${
        undecided.length === 1 ? "it" : "them"
      } anyway (\`git add --force -- ${paths}\`, then commit), keep ${
        undecided.length === 1 ? "it" : "them"
      } local by listing ${
        undecided.length === 1 ? "it" : "them"
      } in ${KEPT_LOCAL_KEY}, or narrow the rule so it no longer matches`,
    );
  }
  if (stale.length > 0) {
    problems.push(
      `${KEPT_LOCAL_KEY} lists ${
        stale.map((path) => `\`${path}\``).join(", ")
      }, which ${
        stale.length === 1 ? "isn't" : "aren't"
      } an ignored, untracked integration file of a configured agent`,
    );
    fixes.push(`remove the stale entries from ${KEPT_LOCAL_KEY}`);
  }
  if (problems.length > 0) {
    return [{
      name: INTEGRATION_FILES,
      ok: true,
      warn: true,
      detail: problems.join("; "),
      fix: fixes.join("; "),
    }];
  }
  return [{
    name: INTEGRATION_FILES,
    ok: true,
    detail: keptLocal.length === 0
      ? `Git can track all ${total} integration file(s) of the configured agents`
      : `${keptLocal.length} of ${total} integration file(s) kept out of Git by ${KEPT_LOCAL_KEY}; fresh clones and cloud agents lack them until discern runs there`,
  }];
}
