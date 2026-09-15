/**
 * Git transaction for setup completion.
 *
 * Completion owns one narrowly proven config commit. This module keeps the
 * staging, ownership, and rollback boundary together so the setup journey can
 * orchestrate it without accumulating Git protocol branches of its own.
 */

import { relative } from "@std/path";
import {
  type GateProofSnapshot,
  restoreGateProofAfterOwnedRollback,
} from "../engine/gate/proof.ts";
import { worktreeState } from "../lib/git.ts";
import { SCHEMA_VERSION } from "../lib/version.ts";
import type { ManagedVersionAdoption } from "../shared/managed_version.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
  type DiscernOwnedCommit,
  rollbackDiscernOwnedCommit,
} from "../shared/discern_commit.ts";
import { parsePorcelainZ } from "../shared/git_paths.ts";
import { runGit } from "../shared/subprocess.ts";

/** The config key recording that one-time setup is complete. */
export const BOOTSTRAPPED_KEY = "meta.bootstrapped";
/** The config key recording whether completion carried current Gate Proof. */
export const SETUP_COMPLETION_KEY = "meta.setup_completion";

/** The completion-marker commit's outcome. A committed marker carries the exact
 * resulting HEAD so every later completion check can be tied to that transaction. */
export type MarkerCommitOutcome =
  | {
    state: "committed";
    head: string;
    owned: DiscernOwnedCommit;
  }
  | { state: "skipped" }
  | { state: "failed"; detail: string }
  | { state: "no-git" };

/** The marker fact rendered for a completed state, whether new or replayed. */
export type CompletionMarkerView = MarkerCommitOutcome | {
  state: "existing";
  head: string;
};

/** How a failed final-tree transaction left its owned marker commit. */
export type MarkerRollbackOutcome =
  | { state: "owned_commit_removed"; detail?: string | undefined }
  | { state: "not_needed" }
  | { state: "retained"; detail: string };

/**
 * The one git stderr line worth relaying from a failed setup commit: the last
 * `fatal:`/`error:` line when present, then the first non-empty line.
 */
export function gitFailureLine(stderr: string): string {
  const lines = stderr.split("\n").map((line) => line.trim()).filter((line) =>
    line !== ""
  );
  const fatal = lines.findLast((line) =>
    line.startsWith("fatal:") || line.startsWith("error:")
  );
  return fatal ?? lines[0] ?? "git did not report a cause";
}

/** Commit only the completion metadata written by this setup invocation. */
export async function commitCompletionMarker(
  root: string,
  configPath: string,
  completion: "proven" | "unproven",
  previousCompletion: "proven" | "unproven" | undefined,
  schemaWasMissing: boolean,
  adoption?: ManagedVersionAdoption,
): Promise<MarkerCommitOutcome> {
  if ((await worktreeState(root)).kind === "not-a-repo") {
    return { state: "no-git" };
  }
  const configRel = relative(root, configPath);
  const diff = await runGit(["diff", "HEAD", "--", configRel], { cwd: root });
  if (!diff.success) {
    return { state: "failed", detail: gitFailureLine(diff.stderr) };
  }
  const body = diff.stdout.split("\n");
  const added = body.filter((line) =>
    line.startsWith("+") && !line.startsWith("+++")
  );
  const removed = body.filter((line) =>
    line.startsWith("-") && !line.startsWith("---")
  );
  const markerKey = BOOTSTRAPPED_KEY.split(".").pop();
  const evidenceKey = SETUP_COMPLETION_KEY.split(".").pop();
  const promoting = previousCompletion === "unproven" &&
    completion === "proven";
  const expectedAdded = new Set(
    promoting
      ? [`${evidenceKey} = "proven"`]
      : [`${markerKey} = true`, `${evidenceKey} = "${completion}"`],
  );
  if (!promoting && schemaWasMissing) {
    expectedAdded.add(`schema_version = ${SCHEMA_VERSION}`);
  }
  const allowedRemoved = new Set(
    promoting ? [`${evidenceKey} = "unproven"`] : [`${markerKey} = false`],
  );
  if (adoption !== undefined && adoption.previous !== adoption.adopted) {
    expectedAdded.add(`managed_version = "${adoption.adopted}"`);
    if (adoption.previous !== null) {
      allowedRemoved.add(`managed_version = "${adoption.previous}"`);
    }
  }
  const removedCountMatches = promoting
    ? removed.length === allowedRemoved.size
    : removed.length <= allowedRemoved.size;
  const onlyMarker = added.length === expectedAdded.size &&
    removedCountMatches &&
    added.every((line) => expectedAdded.has(line.slice(1).trim())) &&
    removed.every((line) => allowedRemoved.has(line.slice(1).trim()));
  if (!onlyMarker) return { state: "skipped" };

  const add = await runGit(["add", "--", configRel], { cwd: root });
  if (!add.success) {
    return { state: "failed", detail: gitFailureLine(add.stderr) };
  }
  const commit = await commitDiscernChanges({
    site: DISCERN_AUTHORED_COMMIT_SITES.setupCompletion,
    values: undefined,
    cwd: root,
    pathspecs: [configRel],
  });
  if (!commit.success) {
    return { state: "failed", detail: gitFailureLine(commit.stderr) };
  }
  if (commit.owned === undefined) {
    return {
      state: "failed",
      detail:
        "Git created the completion commit without returning discern ownership evidence",
    };
  }
  return {
    state: "committed",
    head: commit.owned.head,
    owned: commit.owned,
  };
}

/** Restore an uncommitted marker only while the sampled Git state still holds. */
export async function restorePendingCompletionMarker(
  root: string,
  configPath: string,
  originalConfig: string,
  predecessor: string,
): Promise<MarkerRollbackOutcome> {
  const current = await runGit(["rev-parse", "--verify", "HEAD"], {
    cwd: root,
  });
  if (!current.success || current.stdout.trim() !== predecessor) {
    return {
      state: "retained",
      detail:
        "HEAD moved after the marker write, so discern retained the exact branch and checkout state",
    };
  }
  const configRel = relative(root, configPath);
  const status = await runGit(["status", "--porcelain", "-z"], { cwd: root });
  if (!status.success) {
    return {
      state: "retained",
      detail: "Git could not prove which tracked paths changed",
    };
  }
  const changed = parsePorcelainZ(status.stdout);
  if (
    changed.some((entry) =>
      entry.path !== configRel || entry.origPath !== undefined
    )
  ) {
    return {
      state: "retained",
      detail:
        "the checkout changed outside discern.toml after the marker write",
    };
  }
  try {
    await Deno.writeTextFile(configPath, originalConfig);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      state: "retained",
      detail: `could not restore discern.toml (${detail})`,
    };
  }

  const unstaged = await runGit(
    ["restore", "--staged", "--", configRel],
    { cwd: root },
  );
  if (!unstaged.success) {
    return {
      state: "retained",
      detail: `discern.toml is restored, but Git could not restore its index (${
        gitFailureLine(unstaged.stderr)
      })`,
    };
  }
  const clean = await runGit(["status", "--porcelain", "-z"], { cwd: root });
  return clean.success && clean.stdout === "" ? { state: "not_needed" } : {
    state: "retained",
    detail:
      "discern.toml is restored, but the checkout no longer matches the sampled predecessor",
  };
}

/** Remove the exact marker commit this invocation owns and restore prior Proof. */
export async function rollbackCompletionMarker(
  marker: Extract<MarkerCommitOutcome, { state: "committed" }>,
  proofBefore: GateProofSnapshot,
): Promise<MarkerRollbackOutcome> {
  const rollback = await rollbackDiscernOwnedCommit(marker.owned);
  if (rollback.kind !== "rolled-back") {
    return { state: "retained", detail: rollback.detail };
  }
  const proof = await restoreGateProofAfterOwnedRollback(
    proofBefore,
    marker.head,
  );
  return proof.kind === "restored"
    ? { state: "owned_commit_removed" }
    : { state: "owned_commit_removed", detail: proof.detail };
}

/** Explain why a proven setup could not establish its final marker commit. */
export function markerCommitFailureDetail(
  outcome: MarkerCommitOutcome,
): string {
  switch (outcome.state) {
    case "failed":
      return `the completion marker could not be committed: ${outcome.detail}`;
    case "skipped":
      return "the discern.toml change included more than the completion marker, so discern refused to commit it";
    case "no-git":
      return "the project has no Git commit to bind Proof to; initialize the repository before completing setup";
    case "committed":
      return "the completion marker was committed";
  }
}
