/**
 * The ordered landing queue as an owner reads it — one row per unlanded
 * effort, eligible efforts in landing order, then provisional ones, each with
 * its readiness and the single reason it waits. `status` carries the whole
 * list and `accept --dry-run` derives the reasons for efforts its walk does
 * not assess from the same functions, so the two surfaces agree.
 *
 * Read-only: no assessment, producer, mutation, or repair runs here.
 */

import { quoteCommandWord } from "../../shared/command_evidence.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { displayBranch } from "../../shared/result_markdown_values.ts";
import type { StatusQueueRow } from "../../shared/result_schemas.ts";
import type { CompletionObservation } from "../completion/protocol.ts";
import { declarationProofStates } from "../execution/probe_record.ts";
import { runGit } from "../../shared/subprocess.ts";
import { readEffortGrant } from "../worktree/effort_grant.ts";
import { commitIsMerged, worktreePathForBranch } from "../worktree/git.ts";
import { observeExternalIntegration } from "./external_integration.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import type { QueueEntry } from "./model.ts";
import { orderedEntries } from "./model.ts";
import { observedRecords, observeQueue } from "./repository.ts";

/** The facts one row's waiting sentence is derived from. */
export interface QueueRowFacts {
  /** The recorded source head is already reachable from the trunk. */
  readonly onTrunk: boolean;
  /** The branch tip is no longer the recorded head: new commits await their
   * own `done`, so the entry is not a stale one to withdraw. */
  readonly movedOn: boolean;
  /** A desk grant covers this exact source, so acceptance lands it without
   * another decision even though no authority record exists yet. */
  readonly approved: boolean;
  /** An exact proven candidate for that source is recognised on the trunk,
   * so reconciliation (not withdrawal) is the offered next command. */
  readonly reconcilable: boolean;
  /** The trunk's branch name, for the stale-entry sentence. */
  readonly trunk: string;
  /** Acceptance can compose and re-check a candidate whose predecessor
   * changed: every required context declares an environment setup has
   * proved. Without that, the only route after the trunk moves is the
   * author's own `update`, then `done`. */
  readonly composable: boolean;
  /** The first RECORDED source dependency still unlanded, by display branch —
   * a fact the effort declared, never an inference from Git ancestry. */
  readonly blockedOn?: string;
}

/** One derivation of a queue entry's readiness and single waiting reason. */
export function queueEntryReadiness(
  entry: QueueEntry,
  facts: QueueRowFacts,
): Pick<StatusQueueRow, "readiness" | "reason"> {
  const target = quoteCommandWord(entry.source.effort_id);
  if (entry.state === "active") {
    return {
      readiness: "landing",
      reason:
        "Its checks are running now; it lands in turn once they pass and the owner approves it.",
    };
  }
  if (facts.onTrunk && facts.movedOn) {
    return {
      readiness: "waiting",
      reason:
        `Its checked work is already on ${facts.trunk} and its branch has moved on; run discern done from its worktree for the new work.`,
    };
  }
  if (facts.onTrunk) {
    return {
      readiness: "waiting",
      reason: facts.reconcilable
        ? `Its work is already on ${facts.trunk}; record the outside integration with discern accept --reconcile --target ${target}.`
        : `Its work is already on ${facts.trunk}; withdraw the entry with discern accept withdraw --target ${target}.`,
    };
  }
  if (entry.held === true) {
    return {
      readiness: "waiting",
      reason:
        `The owner put it on hold; discern accept resume --target ${target} resumes it.`,
    };
  }
  if (entry.state === "failed" || entry.invalidation === "candidate-failed") {
    return {
      readiness: "waiting",
      reason: "Its checks failed; rerun discern done from its worktree.",
    };
  }
  // Only a project whose environments setup has proved can have acceptance
  // re-check a candidate whose predecessor changed; elsewhere the author
  // brings the source forward and checks it again.
  const forward = "run discern update in its worktree, then discern done.";
  switch (entry.invalidation) {
    case "source-replaced":
      return {
        readiness: "waiting",
        reason:
          "Its source changed after its checks passed; rerun discern done from its worktree.",
      };
    case "external-trunk":
      return {
        readiness: "waiting",
        reason: `The trunk moved; ${forward}`,
      };
    case "authority-revoked":
      return {
        readiness: "waiting",
        reason:
          "The owner revoked its approval; a fresh approval re-enrols it.",
      };
    case "reprioritized":
      return {
        readiness: "waiting",
        reason: facts.composable
          ? "The queue order changed around it; retry discern accept to reassess it."
          : `The queue order changed around it; ${forward}`,
      };
    case "predecessor-changed":
      return {
        readiness: "waiting",
        reason: facts.composable
          ? "Work ahead of it changed; retry discern accept to reassess it."
          : `Work ahead of it changed; ${forward}`,
      };
    case "claim-lost":
      return {
        readiness: "waiting",
        reason:
          "A previous acceptance was interrupted; retry discern accept for it.",
      };
    case null:
      break;
    default:
      return {
        readiness: "waiting",
        reason:
          "Its evidence is stale; rerun discern done from its worktree, then retry acceptance.",
      };
  }
  if (entry.candidate_id === null) {
    return {
      readiness: "waiting",
      reason:
        "It has no Proof yet; run discern done from its clean committed worktree.",
    };
  }
  if (entry.authority_id === null && !facts.approved) {
    return {
      readiness: "waiting",
      reason: "Waiting for the owner's approval.",
    };
  }
  if (facts.blockedOn !== undefined) {
    return {
      readiness: "waiting",
      reason:
        `It builds on ${facts.blockedOn}, which lands first — a recorded source dependency.`,
    };
  }
  return {
    readiness: "ready",
    reason: "Approved; discern accept from its worktree lands it.",
  };
}

/** Whether a desk grant recorded in the effort's own worktree covers this
 * exact source. Read-only; a missing worktree or grant is simply not approved. */
async function deskApproved(
  root: string,
  entry: QueueEntry,
): Promise<boolean> {
  const path = await worktreePathForBranch(
    root,
    entry.source.branch.replace(/^refs\/heads\//, ""),
  );
  if (path === undefined) return false;
  const grant = await readEffortGrant(path);
  return grant.status === "granted" &&
    grant.grant.source.head === entry.source.head;
}

/** Whether acceptance can compose and re-check candidates in this project:
 * every required context declares an environment, and setup has proved each
 * one as it stands (an isolated declaration needs no rehearsal). */
export async function queueComposable(
  root: string,
  config: DiscernConfig,
): Promise<boolean> {
  const contexts = config.completion.required_contexts;
  if (contexts.some((context) => config.execution[context] === undefined)) {
    return false;
  }
  const states = await declarationProofStates(root, config);
  return contexts.every((context) => {
    const state = states.get(context)?.state;
    return state === "proven" || state === "not-rehearsed";
  });
}

/** Resolve one entry's trunk-reachability facts with bounded Git reads.
 * `siblings` supplies the queue's other entries so a recorded, still-unlanded
 * source dependency can be named; `observe` supplies the trunk-bound
 * observation lazily — only an entry already on the trunk needs it. */
export async function queueRowFacts(
  root: string,
  observe: () => Promise<CompletionObservation>,
  entry: QueueEntry,
  trunk: string,
  siblings: readonly QueueEntry[] = [],
  composable = false,
): Promise<QueueRowFacts> {
  const unlanded = entry.dependencies.find((dependency) =>
    siblings.some((sibling) =>
      sibling.source.effort_id === dependency && sibling.state !== "landed" &&
      sibling.state !== "withdrawn"
    )
  );
  const blocked = unlanded === undefined ? undefined : siblings.find((
    sibling,
  ) => sibling.source.effort_id === unlanded);
  const dependency = blocked === undefined
    ? {}
    : { blockedOn: displayBranch(blocked.source.branch) };
  const onTrunk = entry.state !== "active" &&
    await commitIsMerged(root, entry.source.head, trunk);
  if (!onTrunk) {
    return {
      onTrunk: false,
      movedOn: false,
      reconcilable: false,
      trunk,
      composable,
      approved: entry.authority_id === null && entry.candidate_id !== null &&
        await deskApproved(root, entry),
      ...dependency,
    };
  }
  const tip = await runGit(["rev-parse", "--verify", entry.source.branch], {
    cwd: root,
  });
  const movedOn = tip.success && tip.stdout.trim() !== entry.source.head;
  const integrated = await observeExternalIntegration(
    root,
    await observe(),
    entry.source.branch,
    entry.source.head,
  );
  return {
    onTrunk: true,
    movedOn,
    reconcilable: !("kind" in integrated),
    trunk,
    composable,
    approved: false,
    ...dependency,
  };
}

/** Status's read-only view of the queue: the projection, or nothing when the
 * trunk or record store cannot be read — orientation color never fails the
 * observation that reports it. */
export async function statusQueueRows(
  root: string,
  trunk: string,
  composable: boolean,
): Promise<StatusQueueRow[]> {
  try {
    return await queueOrderProjection(root, trunk, composable);
  } catch {
    // discern-best-effort: status-queue-projection-fallback
    return [];
  }
}

/**
 * Project the queue in the order landing would take it, held efforts shown in
 * place. Returns an empty list when no queue exists or every entry settled.
 */
export async function queueOrderProjection(
  root: string,
  trunk: string,
  composable: boolean,
): Promise<StatusQueueRow[]> {
  const queue = observedRecords(await observeCompletionRecords(root)).find(
    (record) => record.kind === "queue",
  );
  if (queue?.kind !== "queue") return [];
  // The trunk-bound observation costs a Git read; only an entry whose work is
  // already on the trunk consumes it, so it resolves lazily, once.
  let observed: Promise<CompletionObservation> | undefined;
  const observe = (): Promise<CompletionObservation> =>
    observed ??= observeQueue(root, trunk);
  const rows: StatusQueueRow[] = [];
  for (const entry of orderedEntries(queue.data, { includeHeld: true })) {
    const facts = await queueRowFacts(
      root,
      observe,
      entry,
      trunk,
      queue.data.entries,
      composable,
    );
    rows.push({
      effort: entry.source.effort_id,
      branch: entry.source.branch,
      position: rows.length + 1,
      state: entry.state === "provisional" || entry.state === "eligible" ||
          entry.state === "active" || entry.state === "failed"
        ? entry.state
        : "provisional",
      held: entry.held === true,
      ...queueEntryReadiness(entry, facts),
      ...(facts.onTrunk ? { on_trunk: true } : {}),
    });
  }
  return rows;
}
