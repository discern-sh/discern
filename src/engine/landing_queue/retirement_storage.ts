/** Reclamation is scoped to named, completed retirements; it supplies no authority. */
import type { AcceptData } from "../../shared/result_schemas.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { observedRecords } from "./repository.ts";
import { reclaimExecutionStorage } from "../execution/reclamation.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { mainRepoPath } from "../worktree/git.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import { sameSource } from "./model.ts";

/** Use only retirements completed by this acceptance, or explicitly selected for retry. */
export async function reclaimRetirementStorage(
  root: string,
  retirementIds: readonly string[],
  dryRun = false,
  signal?: AbortSignal,
): Promise<NonNullable<AcceptData["storage_cleanup"]>> {
  let removed = 0;
  try {
    const selected = retirementIds.map((id) => RecordIdSchema.parse(id));
    const records = observedRecords(await observeCompletionRecords(root));
    const environments = new Set<string>();
    for (const id of selected) {
      const retirement = records.find((record) =>
        record.kind === "retirement" && record.id === id
      );
      if (
        retirement?.kind !== "retirement" ||
        retirement.data.outcome.kind !== "retired"
      ) {
        throw new Error(
          `Retirement ${id} is not settled; preserve its storage and finish its reported recovery.`,
        );
      }
      const landing = records.find((record) =>
        record.kind === "landing" && record.id === retirement.data.landing_id
      );
      const integration = records.find((record) =>
        record.kind === "integration" &&
        record.id === retirement.data.external_integration_id &&
        sameSource(record.data.source, retirement.data.source)
      );
      const environment = records.find((record) =>
        record.kind === "environment" &&
        record.id === retirement.data.environment_id
      );
      if (
        !(landing?.kind === "landing" &&
            landing.data.outcome.kind === "landed" &&
            landing.data.authority_settlement === "consumed" &&
            sameSource(landing.data.source, retirement.data.source) ||
          integration?.kind === "integration") ||
        environment?.kind !== "environment" ||
        environment.data.state.kind !== "disposed"
      ) {
        throw new Error(
          `Retirement ${id} lacks its matching settled integration or a disposed enrollment; no reclamation is authorized.`,
        );
      }
      environments.add(environment.id);
    }
    const attempts = records.filter((record) => record.kind === "attempt")
      .filter((record) =>
        record.data.environment_id !== null &&
        environments.has(record.data.environment_id) &&
        record.data.state.kind === "finished"
      )
      .map((record) => record.id);
    if (attempts.length === 0) {
      return { state: "settled", removed_files: 0, retirement_ids: selected };
    }
    while (true) {
      signal?.throwIfAborted();
      // The canonical graph protects every retained record revision and other
      // attempt. Only these finished attempts enroll manifest deletion.
      const plan = await reclaimExecutionStorage(root, attempts, dryRun);
      const count = plan.manifests.length + plan.payloads.length +
        (plan.staging?.length ?? 0);
      if (dryRun) {
        return {
          state: "planned",
          planned_files: count,
          retirement_ids: selected,
        };
      }
      removed += count;
      if (plan.deferred?.includes("batch-limit")) continue;
      if (plan.deferred?.includes("unfinished-execution")) {
        throw new Error(
          "An unfinished execution still protects recovery storage. Finish that operation or its reported recovery before retrying.",
        );
      }
      return {
        state: "settled",
        removed_files: removed,
        retirement_ids: selected,
      };
    }
  } catch (error) {
    return {
      state: "retained",
      removed_files: removed,
      retirement_ids: [...retirementIds],
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Explicit storage retry cannot select, validate, land, or retire a source. */
export async function reclaimRetirementResult(
  cwd: string,
  id: string,
  dryRun = false,
  signal?: AbortSignal,
): Promise<DiscernResult<AcceptData>> {
  const root = await mainRepoPath(cwd);
  if (
    root === undefined || await Deno.realPath(root) !== await Deno.realPath(cwd)
  ) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message: "Run the storage retry from the surviving main checkout.",
    };
  }
  const storage = await reclaimRetirementStorage(root, [id], dryRun, signal);
  return {
    verb: "accept",
    ...(storage.state === "retained"
      ? { ok: false as const, error: "incomplete" as const }
      : { ok: true as const }),
    ...(dryRun ? { dry_run: true } : {}),
    message: storage.state === "retained"
      ? `Recovery artifacts retained: ${storage.reason} Resolve this condition, then retry the same discern accept --reclaim command. No landing or checkout removal ran.`
      : `${
        dryRun ? "Planned" : "Completed"
      } artifact cleanup for the selected retirement. No validation, landing, or checkout removal ran.`,
    hints: hintTexts([
      fire(HINTS["completion-pending"], {
        action:
          "Preserve retained artifacts and resolve the reported storage condition before retrying this exact retirement with discern accept --reclaim from the main checkout.",
      }),
    ]),
    data: {
      root,
      queue: [],
      pending: [],
      storage_cleanup: storage,
      landing: {
        recovery_performed: false,
        trunk_landed: false,
        worktree_removed: false,
        branch_deleted: false,
      },
    },
  };
}
