/** Canonical inventory of Git configuration and refs discern may create. */

import { SETUP_BRANCH } from "../shared/setup_state.ts";
import { runGit } from "../shared/subprocess.ts";
import {
  GENERATED_MERGE_DRIVER_KEY,
  WORKTREE_CONFIG_EXTENSION_KEY,
} from "./generated_merge_driver.ts";
import {
  PROOF_NOTES_FETCH_MARKER_KEY,
  PROOF_NOTES_REF,
  PROOF_NOTES_TRACKING_PREFIX,
} from "./gate/proof_notes.ts";
import { ACCEPTANCE_TRANSACTION_MARKER_PREFIX } from "./worktree/git.ts";
import { DROP_RECOVERY_REF_PREFIX } from "./worktree/recovery_refs.ts";

export interface GitConfigFootprintEntry {
  readonly id: string;
  readonly key: string;
  readonly scope: "clone-local" | "remote-fetch";
  readonly writer: string;
  readonly uninstall: string;
}

export interface GitRefFootprintEntry {
  readonly id: string;
  readonly ref: string;
  readonly writer: string;
  readonly lifecycle: string;
  readonly uninstall: "retained";
  /** Refs in this private namespace may be offered as exact optional cleanup. */
  readonly optionalCleanup: boolean;
}

/** Every Git-config key or keyed pattern discern writes. */
export const DISCERN_GIT_CONFIG_FOOTPRINT = [
  {
    id: "generated-merge-driver",
    key: GENERATED_MERGE_DRIVER_KEY,
    scope: "clone-local",
    writer: "setup and refresh reconciliation",
    uninstall: "remove the common value and obsolete worktree-local copies",
  },
  {
    id: "worktree-config-extension",
    key: WORKTREE_CONFIG_EXTENSION_KEY,
    scope: "clone-local",
    writer: "pre-v1 generated-merge setup",
    uninstall:
      "remove only when no surviving checkout-specific configuration needs it",
  },
  {
    id: "proof-note-fetch-owner",
    key: PROOF_NOTES_FETCH_MARKER_KEY,
    scope: "clone-local",
    writer: "proof-note fetch reconciliation",
    uninstall: "remove each recorded ownership marker",
  },
  {
    id: "proof-note-fetch-mapping",
    key: "remote.<name>.fetch with one exact discern proof-note mapping",
    scope: "remote-fetch",
    writer: "proof-note fetch reconciliation",
    uninstall: "remove only mappings paired with discern's ownership marker",
  },
] as const satisfies readonly GitConfigFootprintEntry[];

/** Every ref or ref namespace discern directly creates or causes Git to create. */
export const DISCERN_GIT_REF_FOOTPRINT = [
  {
    id: "setup-branch",
    ref: `refs/heads/${SETUP_BRANCH}`,
    writer: "setup begin",
    lifecycle: "landed or retained as an ordinary local branch",
    uninstall: "retained",
    optionalCleanup: false,
  },
  {
    id: "task-branches",
    ref: "refs/heads/<repository.branch_prefix><worktree-id>",
    writer: "start",
    lifecycle: "deleted only with positive lifecycle ownership evidence",
    uninstall: "retained",
    optionalCleanup: false,
  },
  {
    id: "proof-notes",
    ref: PROOF_NOTES_REF,
    writer: "accept",
    lifecycle: "durable local landing evidence",
    uninstall: "retained",
    optionalCleanup: true,
  },
  {
    id: "proof-note-tracking",
    ref: `${PROOF_NOTES_TRACKING_PREFIX}/<remote>/notes`,
    writer: "an ordinary user-owned fetch after discern wires its mapping",
    lifecycle: "durable fetched landing evidence",
    uninstall: "retained",
    optionalCleanup: true,
  },
  {
    id: "drop-recovery",
    ref: `${DROP_RECOVERY_REF_PREFIX}/<timestamp>-<worktree-id>-<nonce>`,
    writer: "worktree drop",
    lifecycle: "bounded recovery evidence",
    uninstall: "retained",
    optionalCleanup: true,
  },
  {
    id: "acceptance-transaction",
    ref: `${ACCEPTANCE_TRANSACTION_MARKER_PREFIX}/<transaction-id>`,
    writer: "accept",
    lifecycle: "temporary compare-and-swap recovery evidence",
    uninstall: "retained",
    optionalCleanup: true,
  },
] as const satisfies readonly GitRefFootprintEntry[];

/** Combined member names for canonical-set enrollment and generated inventories. */
export const DISCERN_GIT_FOOTPRINT = [
  ...DISCERN_GIT_CONFIG_FOOTPRINT.map((entry) => `config:${entry.key}`),
  ...DISCERN_GIT_REF_FOOTPRINT.map((entry) => `ref:${entry.ref}`),
] as const;

/** Private ref roots whose concrete members uninstall reports but never removes. */
export const DISCERN_OPTIONAL_REF_CLEANUP_ROOTS = [
  PROOF_NOTES_REF,
  `${PROOF_NOTES_TRACKING_PREFIX}/`,
  `${DROP_RECOVERY_REF_PREFIX}/`,
  `${ACCEPTANCE_TRANSACTION_MARKER_PREFIX}/`,
] as const;

/** Whether a concrete ref is one of the private refs uninstall may name. */
export function isDiscernOptionalCleanupRef(ref: string): boolean {
  return DISCERN_OPTIONAL_REF_CLEANUP_ROOTS.some((root) =>
    root.endsWith("/") ? ref.startsWith(root) : ref === root
  );
}

/** List the concrete private refs uninstall retains. */
export async function retainedDiscernRefs(root: string): Promise<string[]> {
  const listed = await runGit([
    "for-each-ref",
    "--format=%(refname)",
    ...DISCERN_OPTIONAL_REF_CLEANUP_ROOTS,
  ], { cwd: root });
  if (!listed.success) {
    const detail = listed.stderr.trim() || listed.stdout.trim() ||
      `git exited with status ${listed.code}`;
    throw new Error(`could not inventory retained discern refs: ${detail}`);
  }
  return [
    ...new Set(
      listed.stdout.split(/\r?\n/u).filter(isDiscernOptionalCleanupRef),
    ),
  ].sort();
}

/** One copyable, exact cleanup command for a concrete retained ref. */
export function optionalRefCleanupCommand(ref: string): string {
  if (!isDiscernOptionalCleanupRef(ref)) {
    throw new Error(
      `ref is outside discern's optional cleanup inventory: ${ref}`,
    );
  }
  return `git update-ref -d '${ref.replaceAll("'", `'\\''`)}'`;
}
