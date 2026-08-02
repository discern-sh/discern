/**
 * The one serialization boundary for every CLI and MCP result envelope.
 *
 * Kept separate from `result.ts` so wire policy can depend on the registered
 * hint vocabulary without making the base result vocabulary import its own
 * consumer (`hints.ts` already imports result types).
 */

import {
  hasFailureRecoveryEvidence,
  hasGenericFailureRecoveryHint,
  hasRegisteredActionableHint,
} from "./hints.ts";
import { containsCommandRefTokens } from "./command_reference.ts";
import { type DiscernResult, planToJson, stepResultToJson } from "./result.ts";

/**
 * Serialize a {@link DiscernResult} to the single object shared by `--json` and
 * MCP. Failed envelopes must already carry a registered `next-step` hint: the
 * boundary refuses silent or merely descriptive failures before either public
 * surface can emit one.
 */
export function serializeResult(r: DiscernResult): Record<string, unknown> {
  if (
    !r.ok && hasGenericFailureRecoveryHint(r.hints) &&
    !hasFailureRecoveryEvidence(r)
  ) {
    throw new Error(
      `internal result invariant: failed \`discern ${r.verb}\` result's generic failure-recovery hint requires a message or diagnostic`,
    );
  }
  if (!r.ok && !hasRegisteredActionableHint(r.hints)) {
    throw new Error(
      `internal result invariant: failed \`discern ${r.verb}\` result has no registered next-step hint`,
    );
  }
  if (r.hints !== undefined && r.hints.some(containsCommandRefTokens)) {
    throw new Error(
      `internal result invariant: \`discern ${r.verb}\` hints carry an unresolved command reference at the serialization boundary`,
    );
  }

  const out: Record<string, unknown> = { ok: r.ok, verb: r.verb };
  if (r.dry_run !== undefined) {
    out.dry_run = r.dry_run;
  }
  if (r.plan !== undefined) {
    out.plan = planToJson(r.plan);
  }
  if (r.steps !== undefined) {
    out.steps = r.steps.map(stepResultToJson);
  }
  if (r.waitedMs !== undefined) {
    out.waited_ms = r.waitedMs;
  }
  if (r.diagnostics !== undefined) {
    out.diagnostics = r.diagnostics;
  }
  if (r.data !== undefined) {
    out.data = r.data;
  }
  if (r.hints !== undefined && r.hints.length > 0) {
    out.hints = r.hints;
  }
  if (r.error !== undefined) {
    out.error = r.error;
  }
  if (r.message !== undefined) {
    out.message = r.message;
  }
  return out;
}
