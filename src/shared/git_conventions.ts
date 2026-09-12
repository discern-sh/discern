/**
 * Git-visible names discern writes into repositories and history.
 *
 * These literals are a v1 compatibility contract. Runtime code imports them;
 * the conventions manifest publishes them; and the deliberately hand-written
 * tripwire in `tests/git_footprint_contract_test.ts` makes an incompatible
 * change an explicit major-version event.
 */

import { DISCERN_NAME } from "./product_identity.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";

/** Git note carrying one accepted Proof. */
export const PROOF_NOTES_REF = "refs/notes/discern";
/** Short name accepted by `git notes --ref`. */
export const PROOF_NOTES_SHORT_REF = "discern";
/** Private namespace for one fetched remote's Proof notes. */
export const PROOF_NOTES_TRACKING_PREFIX = "refs/discern/remotes";
/** Local config key recording remotes whose Proof-note refspec discern owns. */
export const PROOF_NOTES_FETCH_MARKER_KEY = "discern.proofNotesFetchRemote";

/** Derive the private tracking ref for one remote's Proof notes. */
export function proofNotesFetchRef(remote: string): string {
  return `${PROOF_NOTES_TRACKING_PREFIX}/${remote}/notes`;
}

/** Render the wildcard refspec that fetches Proof notes when they exist. */
export function proofNotesFetchMapping(remote: string): string {
  return `+${PROOF_NOTES_REF}*:${proofNotesFetchRef(remote)}*`;
}

/** Namespace retaining branch tips after an explicitly requested drop. */
export const DROP_RECOVERY_REF_PREFIX = "refs/discern/recovery";
/** Maximum retained recovery refs per repository. */
export const DROP_RECOVERY_REF_LIMIT = 32;

/** Per-worktree marker coupled atomically to an acceptance transaction. */
export const ACCEPTANCE_TRANSACTION_MARKER_PREFIX =
  "refs/worktree/discern/acceptance-transactions";

/** Render the reflog action for a landing ref update or rollback. */
export function acceptanceReflogMessage(
  transactionId: string | undefined,
  action: "fast-forward" | "rollback",
  branch: string,
): string {
  return transactionId === undefined
    ? `discern accept: ${action} ${branch}`
    : `discern accept transaction ${transactionId}: ${action} ${branch}`;
}

/** Render the reflog action for one commit whose diff discern composed. */
export function discernAuthoredCommitReflogAction(uuid: string): string {
  return `discern authored commit/${uuid}`;
}

/** Clone-local config key enabling per-worktree configuration. */
export const WORKTREE_CONFIG_EXTENSION_KEY = "extensions.worktreeConfig";
/** Merge-driver name used by generated tracked artifacts. */
export const DISCERN_GENERATED_MERGE_DRIVER = "discern-generated";
/** Clone-local config key installing the generated-file merge driver. */
export const DISCERN_GENERATED_MERGE_DRIVER_CONFIG_KEY =
  `merge.${DISCERN_GENERATED_MERGE_DRIVER}.driver`;
/** Diff driver used for discern's Markdown surfaces. */
export const DISCERN_MARKDOWN_DIFF_DRIVER = "markdown";
/** GitHub Linguist attribute written for generated paths. */
export const LINGUIST_GENERATED_ATTRIBUTE = "linguist-generated";

/** Boundaries around discern's managed sections in shared Git files. */
export const DISCERN_MANAGED_BLOCK = Object.freeze(
  {
    begin: "# --- discern ---",
    end: "# --- /discern ---",
  } as const,
);

/** Opening shared by hash-comment generated-artifact markers. */
export const GENERATED_ARTIFACT_MARKER_PREFIX = "# Generated automatically ";

/** Temporary branch used by the staged setup journey. */
export const SETUP_BRANCH = "discern-setup";
/** Default namespace for agent-authored effort branches. */
export const DEFAULT_WORKTREE_BRANCH_PREFIX = "agent/";
/** Namespace for the disposable integration worktrees a landing composes a
 * moved trunk in. The name helps people recognize the copy; ownership and the
 * exact input identity live in the recorded integration state, never in the
 * branch name. */
export const INTEGRATION_BRANCH_NAMESPACE = "integration/";
/** Suffix used by the default sibling worktree directory. */
export const DEFAULT_WORKTREE_ROOT_SUFFIX = ".worktrees";
/** Detached-branch disambiguation template, before an optional counter. */
export const DETACHED_BRANCH_FALLBACK_TEMPLATE =
  "<branch>-<8-character-commit>";

/** Retention bounds for removed-worktree path evidence. */
export const RETIRED_WORKTREE_PATH_RETENTION_DAYS = 90;
export const RETIRED_WORKTREE_PATH_MAX_ENTRIES = 256;

/** Git identity used for discern-authored trailers and attributed notes. */
export const DISCERN_MACHINE = Object.freeze(
  {
    name: DISCERN_NAME,
    email: "done@discern.sh",
    trailer: `Co-authored-by: ${DISCERN_NAME} <done@discern.sh>`,
  } as const,
);

/** Complete effect matrix for a non-empty no-attribution override. */
export const NO_ATTRIBUTION_EFFECTS = Object.freeze(
  {
    trigger: {
      environment_variable: DISCERN_ENVIRONMENT_VARIABLES.noAttribution,
      active_when: "non-empty",
    },
    commit_trailer: { attributed: "included", unattributed: "omitted" },
    generated_marker: {
      attributed: "product-and-source",
      unattributed: "source-only",
    },
    proof_note_author: {
      attributed: "discern-machine",
      unattributed: "ambient-git-identity",
    },
    proof_record: { attributed: "recorded", unattributed: "recorded" },
  } as const,
);

/**
 * Value-only projection published by the frozen conventions manifest.
 * Runtime authorities above remain the source; this object merely names them
 * in one stable JSON-safe shape.
 */
export const GIT_CONVENTIONS = Object.freeze(
  {
    refs: {
      proof_notes: PROOF_NOTES_REF,
      proof_notes_transport_reservation: `${PROOF_NOTES_REF}*`,
      proof_notes_short: PROOF_NOTES_SHORT_REF,
      proof_notes_tracking_prefix: PROOF_NOTES_TRACKING_PREFIX,
      proof_notes_tracking_reservation:
        `${PROOF_NOTES_TRACKING_PREFIX}/<remote>/notes*`,
      drop_recovery_prefix: DROP_RECOVERY_REF_PREFIX,
      acceptance_transaction_prefix: ACCEPTANCE_TRANSACTION_MARKER_PREFIX,
    },
    refspec_templates: {
      proof_notes_fetch: proofNotesFetchMapping("<remote>"),
    },
    reflog_templates: {
      acceptance: "discern accept: <fast-forward|rollback> <branch>",
      acceptance_transaction:
        "discern accept transaction <id>: <fast-forward|rollback> <branch>",
      authored_commit: "discern authored commit/<uuid>",
    },
    config_keys: {
      proof_notes_fetch_remote: PROOF_NOTES_FETCH_MARKER_KEY,
      remote_fetch: "remote.<remote>.fetch",
      worktree_config_extension: WORKTREE_CONFIG_EXTENSION_KEY,
      generated_merge_driver: DISCERN_GENERATED_MERGE_DRIVER_CONFIG_KEY,
    },
    branches: {
      worktree_prefix_default: DEFAULT_WORKTREE_BRANCH_PREFIX,
      setup: SETUP_BRANCH,
      integration_namespace: INTEGRATION_BRANCH_NAMESPACE,
      detached_fallback: DETACHED_BRANCH_FALLBACK_TEMPLATE,
    },
    worktree_root: {
      default_suffix: DEFAULT_WORKTREE_ROOT_SUFFIX,
      default_template: `<repo>${DEFAULT_WORKTREE_ROOT_SUFFIX}/<name>`,
    },
    managed_block: DISCERN_MANAGED_BLOCK,
    generated_marker_prefix: GENERATED_ARTIFACT_MARKER_PREFIX,
    attributes: {
      generated_merge_driver: DISCERN_GENERATED_MERGE_DRIVER,
      generated_merge_assignment: `merge=${DISCERN_GENERATED_MERGE_DRIVER}`,
      markdown_diff_driver: DISCERN_MARKDOWN_DIFF_DRIVER,
      markdown_diff_assignment: `diff=${DISCERN_MARKDOWN_DIFF_DRIVER}`,
      linguist_generated: LINGUIST_GENERATED_ATTRIBUTE,
    },
    machine: DISCERN_MACHINE,
    no_attribution_effects: NO_ATTRIBUTION_EFFECTS,
    bounds: {
      drop_recovery_refs: DROP_RECOVERY_REF_LIMIT,
      retired_worktree_path_days: RETIRED_WORKTREE_PATH_RETENTION_DAYS,
      retired_worktree_path_entries: RETIRED_WORKTREE_PATH_MAX_ENTRIES,
    },
  } as const,
);
