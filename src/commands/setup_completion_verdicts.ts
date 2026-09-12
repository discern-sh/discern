/**
 * The verdicts `discern setup done` reaches about its final tree beyond the
 * gate itself: whether the throwaway worktree proved the project viable and
 * why not. Setup's transaction stays in `setup.ts`; this module owns the
 * judgment text so each stage explains itself in one place.
 */

import type { DiscernConfig } from "../shared/config_schema.ts";
import type { WorktreeProbeOutcome } from "../engine/worktree/lifecycle.ts";
import { producerFacts } from "../engine/validation/producer_facts.ts";
import type { CompletionAssurance } from "../shared/completion_assurance.ts";
import type { Diagnostic, ErrorSlug } from "../shared/result.ts";
import type { SetupDoneCompletionStage } from "../shared/result_schemas.ts";

/** A completion stage that stopped, with the one supported next action. */
export interface FinalSetupFailure {
  readonly ok: false;
  readonly stage: SetupDoneCompletionStage;
  readonly detail: string;
  readonly diagnostics?: Diagnostic[] | undefined;
  readonly nextAction: string;
  readonly recovery: string;
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
  | (FinalSetupFailure & { readonly stage: "worktree_probe" })
  | { readonly ok: true };

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

/** Derive what the standards read and whose evidence is reused, from the same
 * authorities doctor reports. */
export async function completionAssurance(
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
  };
}

/** Grade the throwaway worktree's outcome: viable, or unfit for a copy and why. */
export function worktreeProbeVerdict(
  outcome: WorktreeProbeOutcome,
): WorktreeProbeProof {
  switch (outcome.kind) {
    case "probed":
      if (outcome.ok) {
        return { ok: true };
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
