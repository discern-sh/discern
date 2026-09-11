/** The one notice the daily commands share when configured early checking cannot run. */
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { provenContexts } from "../execution/probe_record.ts";
import { observableCompletionCheckout } from "../validation/runtime.ts";
import { completionCapacityFacts } from "./capacity_facts.ts";

/** The named contexts, each as a code span. */
function named(contexts: readonly string[]): string {
  return contexts.map((context) => `\`${context}\``).join(", ");
}

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
      return fire(HINTS["completion-early-validation-inert"], {
        lookahead: speculation.lookahead,
        because: `the environment declared for ${
          named(speculation.contexts)
        } has not been proven since it was declared or changed`,
        route: undefined,
      });
    case "undeclared":
      return fire(HINTS["completion-early-validation-inert"], {
        lookahead: speculation.lookahead,
        because: `no \`[execution.<context>]\` declaration exists for ${
          named(speculation.contexts)
        }`,
        route: "Declare the environment",
      });
    case "no-slot":
      return fire(HINTS["completion-early-validation-inert"], {
        lookahead: speculation.lookahead,
        because:
          "no validation slot is spare beyond the one reserved for the next effort to land",
        route:
          "Raise \`[completion].concurrency\` or the environment's \`capacity\`",
      });
    default:
      return undefined;
  }
}

/** The notices a green run carries; a failed run carries none. */
export async function greenRunNotices(
  root: string,
  config: DiscernConfig,
  failed: boolean,
): Promise<FiredHint[]> {
  if (failed) return [];
  const notice = await inertEarlyValidationHint(root, config);
  return notice === undefined ? [] : [notice];
}
