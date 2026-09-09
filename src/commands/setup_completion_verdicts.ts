/**
 * The verdicts `discern setup done` reaches about its final tree beyond the
 * gate itself: what the environment probe established, whether completion
 * awaits another required context, and how a kept marker is reported. Setup's
 * transaction stays in `setup.ts`; this module owns the judgment text so each
 * stage explains itself in one place.
 */

import type { DiscernConfig } from "../shared/config_schema.ts";
import type { EnvironmentProbeReport } from "../engine/execution/probe.ts";
import type { WorktreeProbeOutcome } from "../engine/worktree/lifecycle.ts";
import type { EnvironmentProbeSummary } from "../shared/environment_probe.ts";
import { provenContexts } from "../engine/execution/probe_record.ts";
import { completionCapacityFacts } from "../engine/completion/capacity_facts.ts";
import { producerFacts } from "../engine/validation/producer_facts.ts";
import type { CompletionAssurance } from "../shared/completion_assurance.ts";
import { fire, HINTS, hintTexts } from "../shared/hints.ts";
import type { Diagnostic, DiscernResult, ErrorSlug } from "../shared/result.ts";
import type {
  GateData,
  SetupDoneCompletionStage,
} from "../shared/result_schemas.ts";

/** A completion stage that stopped, with the one supported next action. */
export interface FinalSetupFailure {
  readonly ok: false;
  readonly stage: SetupDoneCompletionStage;
  readonly detail: string;
  readonly diagnostics?: Diagnostic[] | undefined;
  readonly nextAction: string;
  readonly recovery: string;
  /** The marker commit must survive: another required context has to
   * validate this exact commit before completion can be recorded. */
  readonly retainMarker?: true;
  readonly error?: ErrorSlug;
}

/** The fields a failed `setup done` result projects beside its stage. */
export interface SetupDoneFailureProjection {
  readonly error?: ErrorSlug | undefined;
  readonly hints?: string[] | undefined;
  readonly state: string;
  readonly nextAction: string;
  readonly recovery: string;
  readonly diagnostics?: Diagnostic[] | undefined;
}

/** The structural linked-worktree leg has no durable Proof of its own; the
 * throwaway worktree is removed after returning this bounded outcome. */
export type WorktreeProbeProof =
  | (FinalSetupFailure & {
    readonly stage: "worktree_probe" | "environment_probe";
  })
  | { readonly ok: true; readonly environment: EnvironmentProbeSummary };

/** Render a file-specific correction from a nested structured diagnostic. */
export function nestedDiagnosticRecovery(
  diagnostics: readonly Diagnostic[],
): { nextAction: string; recovery: string } | undefined {
  const actionable = diagnostics.find((diagnostic) =>
    diagnostic.file !== undefined || diagnostic.rule !== undefined
  );
  if (actionable === undefined) return undefined;
  const location = actionable.file === undefined
    ? "the reported source"
    : `${actionable.file}${
      actionable.line === undefined ? "" : `:${actionable.line}`
    }`;
  const rule = actionable.rule === undefined ? "" : ` (${actionable.rule})`;
  return {
    nextAction: actionable.reproduce_cmd,
    recovery:
      `Fix ${location}${rule}: ${actionable.message}. Run \`${actionable.reproduce_cmd}\` to verify the content correction, then run \`discern setup done\` again.`,
  };
}

/**
 * A green local gate whose completion still awaits evidence from another
 * required context is not a failure of this tree. Every retry would mint a
 * new marker commit that the other context could never bind to, so the marker
 * stays and the other context is asked to validate exactly it.
 */
export function pendingContextsVerdict(
  gate: DiscernResult<GateData>,
  cfg: DiscernConfig,
  markerHead: string,
): FinalSetupFailure | undefined {
  const pending = gate.data?.completion;
  if (
    pending?.kind !== "pending" || pending.pending === undefined ||
    pending.pending.length === 0 ||
    !pending.pending.every((entry) => entry.kind === "missing-evidence")
  ) return undefined;
  const awaited = cfg.completion.required_contexts.filter((context) =>
    context !== pending.context
  );
  const named = awaited.map((context) => `\`${context}\``).join(", ");
  const first = awaited[0] ?? "<context>";
  return {
    ok: false,
    stage: "contexts",
    error: "incomplete",
    detail:
      `this checkout validated the marker commit for \`${pending.context}\`, and completion still needs evidence from ${named} for the same commit`,
    nextAction: `discern done --context ${first}`,
    recovery: `Keep this commit (${
      markerHead.slice(0, 12)
    }). Run \`discern done --context ${first}\` on exactly this commit where that context validates${
      awaited.length > 1 ? ", and likewise for each other named context" : ""
    }. When every required context has supplied its evidence, run \`discern setup done\` again: it validates the existing marker without another marker commit and records completion.`,
    retainMarker: true,
  };
}

/** The projection for a stage that keeps the marker commit on purpose. */
export function retainedMarkerProjection(
  completion: FinalSetupFailure,
  markerHead: string,
  existing: boolean,
): SetupDoneFailureProjection {
  const head = markerHead.slice(0, 12);
  return {
    error: completion.error,
    hints: hintTexts([
      fire(HINTS["completion-pending"], { action: completion.recovery }),
    ]),
    state: existing
      ? `The existing completion marker ${head} remains the exact commit the remaining context must validate; no marker commit was attempted.`
      : `The completion marker commit ${head} is kept: it is the exact commit the remaining context must validate.`,
    nextAction: completion.nextAction,
    recovery: completion.recovery,
    diagnostics: completion.diagnostics,
  };
}

/** The probe callback's verdict once the declared environments have run. */
export function environmentProbeOutcome(
  environment: EnvironmentProbeReport,
):
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly detail: string;
    readonly remedy: "environment";
    readonly retain: boolean;
  } {
  const failed = environment.outcomes.find((entry) => entry.kind === "failed");
  if (failed === undefined || failed.kind !== "failed") return { ok: true };
  return {
    ok: false,
    detail:
      `the declared environment for \`${failed.context}\` did not prove its return procedure (stopped at ${failed.stage}): ${failed.detail}`,
    remedy: "environment",
    // An unfinished return keeps the probe worktree and its record.
    retain: failed.retained !== undefined,
  };
}

/** The `environment_probe` stage failure, naming the recovery when a copy was kept. */
export function environmentProbeVerdict(
  environment: EnvironmentProbeReport,
  detail: string | undefined,
): FinalSetupFailure & { readonly stage: "environment_probe" } {
  const retained = environment.outcomes.find((entry) =>
    entry.kind === "failed" && entry.retained !== undefined
  );
  const recover = retained?.kind === "failed" ? retained.retained : undefined;
  return {
    ok: false,
    stage: "environment_probe",
    detail: detail ?? "the declared environment is not proven",
    nextAction: recover?.recover ?? "discern doctor",
    recovery: recover === undefined
      ? "Fix the named `[execution.<context>]` prepare or restore procedure so the copy returns to its exact source, branch, index, and declared ignored output, then retry `discern setup done`. To keep ordering-only behavior for now, remove the declaration and set `[completion].lookahead = 0`."
      : `The throwaway copy at ${recover.path} was kept because its checkout has not returned. Make the frozen restore procedure able to run, run \`${recover.recover}\` from that copy to return it, then discard the copy with \`discern worktree drop --force ${recover.path}\` (it holds the rolled-back marker commit). Fix the named \`[execution.<context>]\` restore procedure and retry \`discern setup done\`; to keep ordering-only behavior for now, remove the declaration and set \`[completion].lookahead = 0\` instead.`,
  };
}

/** Derive what the standards read, whose evidence is reused, and how efforts
 * coordinate, from the same authorities doctor reports. */
export async function completionAssurance(
  root: string,
  cfg: DiscernConfig,
): Promise<CompletionAssurance> {
  const producers = await producerFacts(cfg);
  return {
    standards: [...producers.standards],
    shared: producers.shared.map((entry) => ({
      producer: entry.producer,
      standards: [...entry.standards],
    })),
    candidate_bound: [...producers.candidate_bound],
    declared: producers.producers.filter((producer) =>
      producer.closure === "declared"
    ).map((producer) => producer.label),
    speculation:
      completionCapacityFacts(cfg, 2, await provenContexts(root, cfg))
        .speculation.kind,
  };
}

/** Grade the throwaway worktree's outcome: viable, unfit for a copy, or unproven environment. */
export function worktreeProbeVerdict(
  outcome: WorktreeProbeOutcome,
  environment: EnvironmentProbeReport,
): WorktreeProbeProof {
  switch (outcome.kind) {
    case "probed":
      if (outcome.ok) {
        return { ok: true, environment };
      }
      if (outcome.remedy === "environment") {
        return environmentProbeVerdict(environment, outcome.detail);
      }
      if (outcome.remedy === "content") {
        const correction = nestedDiagnosticRecovery(outcome.diagnostics ?? []);
        return {
          ok: false,
          stage: "worktree_probe",
          detail:
            `the gate found a content or integrity error inside the fresh worktree: ${
              outcome.detail ?? "the copy is not viable"
            }`,
          ...(outcome.diagnostics === undefined
            ? {}
            : { diagnostics: outcome.diagnostics }),
          nextAction: correction?.nextAction ?? "discern setup done",
          recovery: correction?.recovery ??
            "Correct the source content named by the nested diagnostic, run its reproduce command, then retry `discern setup done`.",
        };
      }
      return {
        ok: false,
        stage: "worktree_probe",
        detail: `the gate is not green inside a fresh worktree: ${
          outcome.detail ?? "the copy is not viable"
        }`,
        ...(outcome.diagnostics === undefined
          ? {}
          : { diagnostics: outcome.diagnostics }),
        nextAction: "discern worktree setup",
        recovery:
          "Something the project needs does not survive into a copy. Use `[repository].ensure` for shared dependencies, `[worktree.setup]` for copy-specific convergence, or `[worktree.resources]` for external lifecycle state, then retry `discern setup done`.",
      };
    case "setup_failed":
      return {
        ok: false,
        stage: "worktree_probe",
        detail:
          `the project could not set itself up in a fresh worktree: ${outcome.reason}`,
        ...(outcome.diagnostics === undefined
          ? {}
          : { diagnostics: outcome.diagnostics }),
        nextAction: outcome.diagnostics?.[0]?.reproduce_cmd ===
            "discern worktree prune"
          ? "discern worktree prune"
          : "discern worktree setup",
        recovery: outcome.reason.toLocaleLowerCase().includes("resource")
          ? "Fix the named `[worktree.resources]` create or destroy command and its prerequisites. Run `discern worktree prune` when retained resource cleanup is named, then retry `discern setup done`."
          : "Fix the named `[repository].ensure` or `[worktree.setup]` command and its prerequisites, then retry `discern setup done`.",
      };
    case "uncreatable":
      return {
        ok: false,
        stage: "worktree_probe",
        detail:
          `discern could not create the required linked-worktree probe: ${outcome.reason}`,
        nextAction: "discern setup done",
        recovery:
          "Restore a normal committed branch and writable configured worktree root. The next call creates and retires one owned probe through the production lifecycle.",
      };
  }
}
