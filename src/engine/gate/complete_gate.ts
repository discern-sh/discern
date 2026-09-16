/** Coordinate complete Proof around the gate; validation remains its own executor. */
import { loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult, FailedStage } from "../../shared/result.ts";
import type { GateData } from "../../shared/result_schemas.ts";
import type { CompletionProofPointer } from "../../shared/completion_proof.ts";
import {
  fire,
  firedHintsFromTexts,
  HINTS,
  hintTexts,
} from "../../shared/hints.ts";
import { discernCommand, positional } from "../../shared/command_reference.ts";
import { runGit } from "../../shared/subprocess.ts";
import { integrationBranch } from "../worktree/git.ts";
import {
  completionBlockerAccount,
  completionPendingData,
  completionProgressSentence,
  uniqueCompletionBlockers,
} from "../completion/progress_prose.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import {
  completeSourceTip,
  type CompletionRunValue,
  type CompletionSession,
} from "../completion/source_tip.ts";
import {
  describeDirtyPaths,
  pinValidatedTree,
  preflightAdminStateWrites,
} from "./proof.ts";

/** Completion needs a committed subject before judgment, selection, or producers. */
export async function completionTreeRefusal(
  root: string,
  standalone = false,
): Promise<DiscernResult<GateData> | undefined> {
  if (standalone) return undefined;
  const pin = await pinValidatedTree(root);
  if (pin.clean && pin.head !== undefined) return undefined;
  return {
    ok: false,
    verb: "done",
    error: "dirty_worktree",
    message: `Completion requires a clean, committed tree${
      describeDirtyPaths(pin.dirtyPaths)
    }. No candidate was selected and no producer ran.`,
    hints: hintTexts([fire(HINTS["completion-uncommitted"])]),
    data: {
      failed_stage: null,
      scopes_changed: [],
      gate_ran: false,
      producer_executions: {},
    },
  };
}

interface CompletionGateResult {
  result: DiscernResult<GateData>;
  failedStage: FailedStage | null;
  finalize: (pointer: CompletionProofPointer) => Promise<boolean>;
}

/** Publish the caller's clean gate result only after its complete Proof exists. */
export async function runCompleteGate<T extends CompletionGateResult>(
  root: string,
  options: Parameters<typeof completeSourceTip>[1] & {
    readonly standalone?: boolean;
  },
  run: (
    session: CompletionSession | undefined,
  ) => Promise<CompletionRunValue<T>>,
  unrun: (result: DiscernResult<GateData>) => Promise<T>,
): Promise<T> {
  const refusal = await completionTreeRefusal(root, options.standalone);
  if (refusal !== undefined) return await unrun(refusal);
  if (options.standalone) {
    return (await run(undefined)).value;
  }
  if (!(await preflightAdminStateWrites(root)).ok) {
    return (await run(undefined)).value;
  }
  const config = await loadConfig(root);
  const trunk = await runGit([
    "rev-parse",
    "--verify",
    `${integrationBranch(config.repository.trunk)}^{commit}`,
  ], { cwd: root });
  // The gate preflight owns the unreadable policy-base diagnostic.
  if (!trunk.success) return (await run(undefined)).value;
  const completed = await completeSourceTip(
    root,
    options,
    run,
    async (gate, pointer) => {
      return await gate.finalize(pointer) && gate.result.ok;
    },
  );
  if (completed.kind !== "completed") {
    // Every pending cause reaches the owner as the plain sentence its account
    // composes; a raw record shape is never the first paragraph.
    const account = completionBlockerAccount(completed);
    return await unrun({
      ok: false,
      verb: "done",
      error: "incomplete",
      message: completionProgressSentence(account),
      hints: hintTexts([
        fire(HINTS["completion-pending"], {
          action: completionNextAction(completed),
        }),
      ]),
      data: {
        failed_stage: null,
        scopes_changed: [],
        gate_ran: false,
        producer_executions: {},
        completion: {
          kind: "pending",
          pending_reasons: [account.reason],
          pending: [completionPendingData(completed)],
        },
      },
    });
  }
  const gate = completed.value;
  const blockers = uniqueCompletionBlockers(completed.blockers);
  if (gate.result.data !== undefined) {
    gate.result.data.completion = {
      kind: completed.proof_id === undefined ? "pending" : "complete",
      candidate_id: completed.candidate_id,
      ...(completed.proof_id === undefined
        ? {}
        : { proof_id: completed.proof_id }),
      pending: blockers.map(completionPendingData),
      pending_reasons: blockers.map((blocker) =>
        completionBlockerAccount(blocker).reason
      ),
    };
  }
  if (
    (completed.proof_id === undefined || blockers.length > 0) &&
    gate.result.ok
  ) {
    const causes = blockers.map((blocker) =>
      completionBlockerAccount(blocker).reason
    );
    gate.result = {
      ...gate.result,
      ok: false,
      error: "incomplete",
      message: causes.length === 0
        ? "The checks passed, but this run is not recorded as complete: its evidence is not assembled yet."
        : `The checks passed, but this run is not recorded as complete. ${
          causes.join(" ")
        }`,
    };
    gate.failedStage = "check/test";
  }
  const waitingOnly = blockers.length > 0 &&
    blockers.every((blocker) => blocker.kind === "waiting-for-operation");
  if (waitingOnly) {
    const account = completionBlockerAccount(blockers[0] as CompletionBlocker);
    gate.result = {
      ...gate.result,
      ok: false,
      error: "incomplete",
      message: completionProgressSentence(account),
    };
    if (gate.result.data !== undefined) {
      gate.result.data.failed_stage = null;
      gate.result.data.gate_ran = false;
    }
    gate.failedStage = null;
  }
  if (!gate.result.ok && blockers.length > 0) {
    gate.result.hints = hintTexts([
      ...[...new Set(blockers.map(completionNextAction))].map(
        (action) => fire(HINTS["completion-pending"], { action }),
      ),
      ...firedHintsFromTexts(gate.result.hints ?? []),
    ]);
  }
  return gate;
}

/** Keep distinct pending states attached to their next valid operation. */
function completionNextAction(blocker: CompletionBlocker): string {
  switch (blocker.kind) {
    case "stale-evidence":
      return "The source or the trunk changed. Run discern update when the branch is behind the trunk, then run discern done to establish complete current evidence.";
    case "missing-judgment":
      return "Resolve the served checkpoint judgment, then run discern done again.";
    case "unavailable":
      return "Resolve the reported condition, then run discern done again.";
    case "waiting-for-operation":
      return blocker.operation_handle === undefined
        ? "Wait for the running operation on this checkout to finish, then retry the requested command."
        : `Run ${
          discernCommand(
            "progress",
            positional("handle", blocker.operation_handle),
          )
        } to read the existing operation; after it finishes, run ${
          discernCommand("done")
        } again.`;
    case "report-only":
      return "Run discern done without --ci before acceptance.";
    case "validation-failed":
      return "Resolve the failed validation; use discern done --rerun for a deliberate retry of the unchanged subject.";
    default:
      return "Supply the missing or stale evidence, then run discern done again.";
  }
}
