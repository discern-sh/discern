/** Local landing status binds cleanup facts to the invoking committed source. */
import { loadModule } from "../../shared/module_loading.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { checkoutOutcomeSentence } from "../../shared/result_completion.ts";
import { runGit } from "../../shared/subprocess.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { observedRecords } from "../landing_queue/repository.ts";
import type { CompletionRecord } from "../completion/records.ts";

/** The record families a landing-and-cleanup reading consults. */
export const CHECKOUT_LANDING_FAMILIES = [
  "landing",
  "retirement",
  "environment",
] as const;

/** A fleet row's kept-checkout sentence: present when the row's committed
 * source has landed and the checkout can be read. */
export async function fleetLandedCheckout(
  entry: {
    readonly broken?: boolean | undefined;
    readonly git_unavailable?: boolean | undefined;
  },
  path: string,
  identity: { readonly id: string; readonly branch: string },
  records: readonly CompletionRecord[],
): Promise<{ message: string } | undefined> {
  if (entry.broken === true || entry.git_unavailable === true) return undefined;
  const landed = await checkoutLandingStatus(
    path,
    identity,
    "worktree",
    records,
  );
  return landed === undefined ? undefined : { message: landed.lead };
}

/** Read those families once for a fleet of checkouts. */
export async function checkoutLandingRecords(
  root: string,
): Promise<CompletionRecord[]> {
  return observedRecords(
    await observeCompletionRecords(root, SYSTEM_CLOCK, [
      ...CHECKOUT_LANDING_FAMILIES,
    ]),
  );
}

export interface CheckoutLandingStatus {
  readonly sourceHead: string;
  /** The branch and its checkout outcome: what every surface leads with. */
  readonly lead: string;
  /** The lead, then the landed commit, as one paragraph every surface can render. */
  readonly message: string;
}

/** Observe only the invoking source's landing and cleanup. */
export async function checkoutLandingStatus(
  root: string,
  identity: { readonly id: string; readonly branch: string } | null,
  location: "worktree" | "main",
  shared?: readonly CompletionRecord[],
): Promise<CheckoutLandingStatus | undefined> {
  if (location !== "worktree" || identity === null) return undefined;
  const head = await runGit(["rev-parse", "HEAD"], { cwd: root });
  if (!head.success) return undefined;
  const sourceHead = head.stdout.trim();
  const records = shared ?? await checkoutLandingRecords(root);
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
  const plan = planQueueRetirement(landing, records);
  const outcome = plan.kind === "settled"
    ? plan.outcome
    : plan.kind === "resume"
    ? plan.record.data.outcome
    : undefined;
  // The same checkout sentence the acceptance verdict carries, so every
  // surface says why the checkout stayed in the same words.
  const cleanup = outcome === undefined
    ? "Checkout cleanup remains pending. Retry discern accept from the main checkout; it rechecks ownership before cleanup."
    : checkoutOutcomeSentence({
      retirement: outcome.kind,
      ...(outcome.kind === "retained"
        ? { retirement_reason: outcome.reason }
        : outcome.kind === "recovery"
        ? { retirement_reason: outcome.recovery.reason }
        : {}),
    });
  const lead = `${identity.branch} has landed. ${cleanup}`;
  return {
    sourceHead,
    lead,
    message: `${lead} The landed commit is ${sourceHead}.`,
  };
}
