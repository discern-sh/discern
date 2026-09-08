/** Local landing status binds cleanup facts to the invoking committed source. */
import { loadModule } from "../../shared/module_loading.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { runGit } from "../../shared/subprocess.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { observedRecords } from "../landing_queue/repository.ts";

export interface CheckoutLandingStatus {
  readonly sourceHead: string;
  readonly message: string;
}

/** Observe one effort without turning historical cleanup into current work. */
export async function checkoutLandingStatus(
  root: string,
  identity: { readonly id: string; readonly branch: string },
): Promise<CheckoutLandingStatus | undefined> {
  const head = await runGit(["rev-parse", "HEAD"], { cwd: root });
  if (!head.success) return undefined;
  const sourceHead = head.stdout.trim();
  const records = observedRecords(
    await observeCompletionRecords(
      root,
      SYSTEM_CLOCK,
      ["landing", "retirement", "environment"],
    ),
  );
  const landing = records.find((record) =>
    record.kind === "landing" &&
    record.data.outcome.kind === "landed" &&
    record.data.source.effort_id === identity.id &&
    record.data.source.branch === "refs/heads/" + identity.branch &&
    record.data.source.head === sourceHead
  );
  if (landing?.kind !== "landing") return undefined;
  const { planQueueRetirement } = await loadModule(
    () => import("../landing_queue/retirement.ts"),
  );
  const { retainedCheckoutExplanation } = await loadModule(
    () => import("../landing_queue/public_result.ts"),
  );
  const plan = planQueueRetirement(landing, records);
  const outcome = plan.kind === "settled"
    ? plan.outcome
    : plan.kind === "resume"
    ? plan.record.data.outcome
    : undefined;
  const cleanup = outcome?.kind === "retained"
    ? retainedCheckoutExplanation(outcome.reason)
    : outcome?.kind === "retired"
    ? "Checkout cleanup is recorded as complete."
    : outcome?.kind === "recovery"
    ? "Checkout cleanup requires recovery: " + outcome.recovery.reason +
      " Preserve its retained state and retry discern accept from the main checkout."
    : "Checkout cleanup remains pending. Retry discern accept from the main checkout; it rechecks ownership before cleanup.";
  return {
    sourceHead,
    message: "Committed source " + sourceHead + " from " + identity.branch +
      " has landed. " + cleanup,
  };
}
