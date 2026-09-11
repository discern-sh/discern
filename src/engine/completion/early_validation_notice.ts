/** The one notice the daily commands share when configured early checking cannot run. */
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { provenContexts } from "../execution/probe_record.ts";
import { observableCompletionCheckout } from "../validation/runtime.ts";
import { completionCapacityFacts } from "./capacity_facts.ts";

/**
 * A declared `[completion].lookahead` that cannot take effect, read the way
 * doctor and setup read it: the same capacity facts over the same proof
 * records. Undefined when early checking is off by configuration or runs.
 */
export async function inertEarlyValidationHint(
  root: string,
  config: DiscernConfig,
): Promise<FiredHint | undefined> {
  if (!await observableCompletionCheckout(root)) return undefined;
  const speculation = completionCapacityFacts(
    config,
    2,
    await provenContexts(root, config),
  ).speculation;
  switch (speculation.kind) {
    case "unproven":
    case "undeclared":
      return fire(HINTS["completion-early-validation-inert"], {
        lookahead: speculation.lookahead,
        contexts: speculation.contexts,
        cause: speculation.kind,
      });
    case "no-slot":
      return fire(HINTS["completion-early-validation-inert"], {
        lookahead: speculation.lookahead,
        contexts: config.completion.required_contexts,
        cause: "no-slot",
      });
    default:
      return undefined;
  }
}
