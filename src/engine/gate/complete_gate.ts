/** Coordinate candidate admission around the gate; validation remains its own executor. */
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
import { runGit } from "../../shared/subprocess.ts";
import { integrationBranch } from "../worktree/git.ts";
import {
  type CompletionRunValue,
  type CompletionSession,
  withPublicCompletion,
} from "../landing_queue/public_completion.ts";
import { acceptancePending } from "../landing_queue/public_result.ts";
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

/** Publish the caller's clean gate result only after complete evidence and environment return. */
export async function runCompleteGate<T extends CompletionGateResult>(
  root: string,
  options: Parameters<typeof withPublicCompletion>[1] & {
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
  const context = options.context;
  const completed = await withPublicCompletion(
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
    const reason = completed.kind === "replan"
      ? "The queue changed while this run was starting. Run discern done again."
      : acceptancePending(completed).reason;
    return await unrun({
      ok: false,
      verb: "done",
      error: "incomplete",
      message: `Completion is pending: ${reason}`,
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
          context,
          pending_reasons: [reason],
          pending: [{ kind: completed.kind, reason }],
        },
      },
    });
  }
  const gate = completed.value;
  if (gate.result.data !== undefined) {
    gate.result.data.completion = {
      kind: completed.proof_id === undefined ? "pending" : "complete",
      context,
      candidate_id: completed.candidate_id,
      ...(completed.proof_id === undefined
        ? {}
        : { proof_id: completed.proof_id }),
      pending: completed.blockers.map((blocker) => ({
        kind: blocker.kind,
        reason: acceptancePending(blocker).reason,
      })),
      pending_reasons: completed.blockers.map((blocker) =>
        acceptancePending(blocker).reason
      ),
    };
  }
  if (
    (completed.proof_id === undefined || completed.blockers.length > 0) &&
    gate.result.ok
  ) {
    gate.result = {
      ...gate.result,
      ok: false,
      error: "incomplete",
      message:
        "Validation finished; complete evidence or environment recovery is still pending.",
    };
    gate.failedStage = "check/test";
  }
  if (!gate.result.ok && completed.blockers.length > 0) {
    gate.result.hints = hintTexts([
      ...firedHintsFromTexts(gate.result.hints ?? []),
      ...[...new Set(completed.blockers.map(completionNextAction))].map(
        (action) => fire(HINTS["completion-pending"], { action }),
      ),
    ]);
  }
  return gate;
}

/** Keep distinct pending states attached to their next valid operation. */
function completionNextAction(blocker: { readonly kind: string }): string {
  switch (blocker.kind) {
    case "missing-authority":
      return "Review the candidate with discern accept --dry-run and obtain a recorded grant covering that exact source before accepting.";
    case "stale-evidence":
      return "The candidate or its predecessor changed. Run discern update when the source is behind trunk, then run discern done to establish complete current evidence.";
    case "missing-judgment":
      return "Resolve the served checkpoint or composition judgment, then run discern done again.";
    case "environment-unavailable":
      return "Make an eligible declared execution environment available, or run discern update to bring the source to the current trunk before running discern done.";
    case "recovery-incomplete":
      return "Preserve the retained execution state and reconcile the reported recovery before any new validation or retirement.";
    case "waiting-for-operation":
      return "Allow the owning operation to return its environment, then retry the requested command.";
    case "report-only":
      return "Run discern done in strict mode in every required context before acceptance.";
    case "validation-failed":
      return "Resolve the failed validation; use discern done --rerun for a deliberate retry of the unchanged subject.";
    default:
      return "Supply the missing or stale evidence in its declared execution context, then run discern done again.";
  }
}
