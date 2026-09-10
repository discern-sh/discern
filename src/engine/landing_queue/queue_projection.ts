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
import { displayBranch } from "../../shared/result_markdown_values.ts";
import type { StatusQueueRow } from "../../shared/result_schemas.ts";
import type { CompletionObservation } from "../completion/protocol.ts";
import { commitIsMerged } from "../worktree/git.ts";
import { observeExternalIntegration } from "./external_integration.ts";
import type { QueueEntry } from "./model.ts";
import { orderedEntries } from "./model.ts";
import { observedRecords, observeQueue } from "./repository.ts";

/** The facts one row's waiting sentence is derived from. */
export interface QueueRowFacts {
  /** The recorded source head is already reachable from the trunk. */
  readonly onTrunk: boolean;
  /** An exact proven candidate for that source is recognised on the trunk,
   * so reconciliation (not withdrawal) is the offered next command. */
  readonly reconcilable: boolean;
  /** The trunk's branch name, for the stale-entry sentence. */
  readonly trunk: string;
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
    return { readiness: "landing" };
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
        reason:
          "The trunk moved; run discern update in its worktree, then discern done.",
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
        reason:
          "The queue order changed around it; retry discern accept to reassess it.",
      };
    case "predecessor-changed":
      return {
        readiness: "waiting",
        reason:
          "Work ahead of it changed; retry discern accept to reassess it.",
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
  if (entry.authority_id === null) {
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
  return { readiness: "ready" };
}

/** Resolve one entry's trunk-reachability facts with bounded Git reads.
 * `siblings` supplies the queue's other entries so a recorded, still-unlanded
 * source dependency can be named. */
export async function queueRowFacts(
  root: string,
  observation: CompletionObservation,
  entry: QueueEntry,
  trunk: string,
  siblings: readonly QueueEntry[] = [],
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
    return { onTrunk: false, reconcilable: false, trunk, ...dependency };
  }
  const integrated = await observeExternalIntegration(
    root,
    observation,
    entry.source.branch,
    entry.source.head,
  );
  return {
    onTrunk: true,
    reconcilable: !("kind" in integrated),
    trunk,
    ...dependency,
  };
}

/** Status's read-only view of the queue: the projection, or nothing when the
 * trunk or record store cannot be read — orientation colour never fails the
 * observation that reports it. */
export async function statusQueueRows(
  root: string,
  trunk: string,
): Promise<StatusQueueRow[]> {
  try {
    return await queueOrderProjection(root, trunk);
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
): Promise<StatusQueueRow[]> {
  const observation = await observeQueue(root, trunk);
  const queue = observedRecords(observation).find((record) =>
    record.kind === "queue"
  );
  if (queue?.kind !== "queue") return [];
  const rows: StatusQueueRow[] = [];
  for (const entry of orderedEntries(queue.data, { includeHeld: true })) {
    const facts = await queueRowFacts(
      root,
      observation,
      entry,
      trunk,
      queue.data.entries,
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
