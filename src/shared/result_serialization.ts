/**
 * The one serialization boundary for every CLI and MCP result envelope.
 *
 * Kept separate from `result.ts` so wire policy can depend on the registered
 * hint vocabulary without making the base result vocabulary import its own
 * consumer (`hints.ts` already imports result types).
 */

import {
  failureRecoveryMode,
  hasFailureRecoveryEvidence,
  hasGenericFailureRecoveryHint,
  hasRegisteredActionableHint,
} from "./hints.ts";
import { containsCommandRefTokens } from "./command_reference.ts";
import { type DiscernResult, planToJson, stepResultToJson } from "./result.ts";
import { evaluateResultCompletion } from "./result_completion.ts";
import { resultWireProjectorForVerb } from "./result_wire.ts";
import {
  DIAGNOSTIC_SUMMARY_LIMIT,
  sampleDiagnostics,
} from "./diagnostic_summary.ts";

/**
 * Prepare a {@link DiscernResult} as the single compact object shared by
 * JSON, Markdown, and MCP. Failed envelopes must already carry a registered
 * `next-step` hint: the boundary refuses silent or merely descriptive failures
 * before any serialized result surface can emit one.
 */
export function serializeResult(input: DiscernResult): Record<string, unknown> {
  const r = evaluateResultCompletion(input);
  if (
    !r.ok && hasGenericFailureRecoveryHint(r.hints) &&
    failureRecoveryMode(r) !== "evidence"
  ) {
    throw new Error(
      `internal result invariant: failed \`discern ${r.verb}\` result's error family requires a tailored registered next-step hint`,
    );
  }
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
    if (
      r.diagnosticEvidence !== undefined &&
      r.diagnosticEvidence.raw === JSON.stringify(r.diagnostics)
    ) {
      const sample = sampleDiagnostics(r.diagnostics, DIAGNOSTIC_SUMMARY_LIMIT);
      out.diagnostics = sample.map(({ diagnostic }) => ({
        ...diagnostic,
        message: diagnostic.message.length > 900
          ? diagnostic.message.slice(0, 900) +
            "… (complete message in diagnostic evidence)"
          : diagnostic.message,
        ...(diagnostic.output === undefined ? {} : {
          output: diagnostic.output.length > 2400
            ? diagnostic.output.slice(0, 2400) +
              "… (complete output in diagnostic evidence)"
            : diagnostic.output,
        }),
      }));
      out.diagnostic_evidence = {
        path: r.diagnosticEvidence.path,
        digest: r.diagnosticEvidence.digest,
        bytes: r.diagnosticEvidence.bytes,
        total: r.diagnostics.length,
        shown: sample.length,
        repeats: sample.map((entry) => entry.count),
      };
    }
  }
  if (r.data !== undefined) {
    out.data = r.data;
  }
  if (r.hints !== undefined && r.hints.length > 0) {
    out.hints = r.hints;
  }
  if (r.advisories !== undefined && r.advisories.length > 0) {
    out.advisories = r.advisories;
  }
  if (r.error !== undefined) {
    out.error = r.error;
  }
  if (r.message !== undefined) {
    out.message = r.message;
  }
  return resultWireProjectorForVerb(r.verb)?.(out, r) ?? out;
}
