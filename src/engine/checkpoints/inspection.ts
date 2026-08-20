/**
 * The canonical READ-ONLY checkpoint inspection. It joins the governing
 * policy, current structural outcomes, persisted open questions, projected
 * subject currency, and declarations into the strict obligation `done` would
 * act on now.
 *
 * A structural trigger only opens a question; it does not own that question's
 * lifetime. Consequently a readable, governed persisted open question
 * outranks a later idle trigger. Read surfaces run no `when` command and write
 * no state. Uncertainty is explicit and fails open rather than being guessed
 * into either a conclusion or a refusal.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { CheckpointObligationState } from "../../shared/checkpoints.ts";
import {
  type CheckpointDrop,
  checkpointDropAccounts,
  entryCheckpointDrop,
  type EntryCheckpointDropReason,
  type GateMode,
  policyCheckpointDrop,
  type PolicyCheckpointDropReason,
} from "../../shared/checkpoint_drops.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { collectEffortDiff } from "./diff.ts";
import {
  declarationIsCurrent,
  type OpenQuestion,
  readOpenQuestions,
} from "./open_questions.ts";
import { loadGoverningPolicy } from "./policy.ts";
import { checkpointDefinitionHash, computeSubject } from "./subject.ts";
import { evaluateStructuralTrigger } from "./triggers.ts";
import type { ResolvedCheckpoint, StructuralTriggerOutcome } from "./types.ts";

/** Why a read inspection cannot settle one checkpoint's strict obligation. */
export type CheckpointObligationUnknown =
  | "when_pending"
  | "diff_unavailable"
  | "store_unavailable"
  | "subject_unavailable";

/** One checkpoint's strict obligation, with the paths behind the projected
 * serving. `matched` is empty only when no serving exists or state is unknown
 * before a matched set can be trusted. */
export interface CheckpointObligation {
  state: CheckpointObligationState;
  matched: readonly string[];
  unknown?: CheckpointObligationUnknown;
}

/** One governing checkpoint in the canonical inspection. */
export interface CheckpointInspectionEntry {
  definition: ResolvedCheckpoint;
  /** Absent when the effort diff could not be read. */
  outcome?: StructuralTriggerOutcome;
  /** The persisted record, when one was readable for this id. */
  openQuestion?: OpenQuestion;
  /** The strict decision projected from every fact above. */
  obligation: CheckpointObligation;
}

/** The complete read model all checkpoint-aware surfaces consume. */
export interface CheckpointInspection {
  /** The policy identity (the merge-base commit), when it resolved. */
  policyCommit?: string;
  /** The governing checkpoints, resolved. */
  checkpoints: readonly ResolvedCheckpoint[];
  /** One entry per governing checkpoint. */
  entries: readonly CheckpointInspectionEntry[];
  /** Every readable persisted question, including ungoverned history. */
  openQuestions: Readonly<Record<string, OpenQuestion>>;
  /** Whether absence from `openQuestions` is trustworthy. */
  storeReadable: boolean;
  /** Typed fail-open evidence; human accounts derive from these records. */
  drops: CheckpointDrop[];
}

/** Describe one report-mode stop obligation without claiming more certainty
 * than the read-only inspection established. */
function reportStopNote(
  definition: ResolvedCheckpoint,
  obligation: CheckpointObligation,
): string | undefined {
  switch (obligation.state) {
    case "none":
      return undefined;
    case "will_open":
    case "awaiting_declaration":
    case "reopened":
    case "declared_met":
    case "declared_unmet":
      return `Checkpoint '${definition.id}' (stop): its question will be reported; review will not be enforced.`;
    case "unknown":
      return obligation.unknown === "when_pending"
        ? `Checkpoint '${definition.id}' (stop): its question may be reported if its when command fires; review will not be enforced.`
        : `Checkpoint '${definition.id}' (stop): enforcement is unknown and failed open; this preview cannot promise a reported question.`;
  }
}

/** Construct entry-scoped inspection evidence from a resolved checkpoint. */
function entryDrop(
  definition: ResolvedCheckpoint,
  policyCommit: string,
  reason: EntryCheckpointDropReason,
  account: string,
): CheckpointDrop {
  return entryCheckpointDrop(
    definition.id,
    definition.mode,
    policyCommit,
    reason,
    account,
  );
}

/** Construct policy-scoped inspection evidence before entries are knowable. */
function policyDrop(
  policyCommit: string | undefined,
  reason: PolicyCheckpointDropReason,
  account: string,
): CheckpointDrop {
  return policyCheckpointDrop(reason, account, policyCommit);
}

/** The active state of a reconciled open question. This is the smallest pure
 * lifecycle vocabulary shared by inspection and the mutating preflight. */
export function activeOpenQuestionState(
  openQuestion: OpenQuestion,
): Extract<
  CheckpointObligationState,
  | "awaiting_declaration"
  | "reopened"
  | "declared_met"
  | "declared_unmet"
> {
  const declaration = openQuestion.declaration;
  if (declaration === undefined) {
    return "awaiting_declaration";
  }
  if (!declarationIsCurrent(openQuestion)) {
    return "reopened";
  }
  return declaration.conclusion === "met" ? "declared_met" : "declared_unmet";
}

/** Project a stored question onto the binding strict preflight would reconcile
 * without writing it, then classify it through the shared lifecycle state. */
function projectedOpenQuestionState(
  openQuestion: OpenQuestion,
  binding: {
    definitionHash: string;
    subject: string;
    matched: readonly string[];
  },
): ReturnType<typeof activeOpenQuestionState> {
  if (
    openQuestion.definitionHash === binding.definitionHash &&
    openQuestion.subject === binding.subject
  ) {
    return activeOpenQuestionState(openQuestion);
  }
  return activeOpenQuestionState({
    ...openQuestion,
    definitionHash: binding.definitionHash,
    subject: binding.subject,
    matchedPaths: [...binding.matched],
  });
}

/** Read every input to the strict checkpoint decision exactly once and project
 * one obligation per governing checkpoint. No command runs and no byte is
 * written. */
export async function inspectCheckpointObligations(
  root: string,
  config: DiscernConfig,
): Promise<CheckpointInspection> {
  const policy = await loadGoverningPolicy(root, config);
  const drops: CheckpointDrop[] = [...policy.drops];

  let outcomes: ReadonlyMap<string, StructuralTriggerOutcome> = new Map();
  if (policy.policyCommit !== undefined && policy.checkpoints.length > 0) {
    const diff = await collectEffortDiff(root, policy.policyCommit);
    if (diff === undefined) {
      for (const definition of policy.checkpoints) {
        drops.push(entryDrop(
          definition,
          policy.policyCommit,
          "effort_diff_unreadable",
          `checkpoint '${definition.id}': the effort diff could not be read; it does not enforce this run.`,
        ));
      }
    } else {
      outcomes = new Map(
        policy.checkpoints.map((definition) => [
          definition.id,
          evaluateStructuralTrigger(definition, diff),
        ]),
      );
    }
  }

  const stored = await readOpenQuestions(root);
  const openQuestions = stored.status === "ok" ? stored.openQuestions : {};
  const storeReadable = stored.status === "ok" || stored.status === "missing";
  if (stored.status === "invalid") {
    drops.push(policyDrop(
      policy.policyCommit,
      "open_question_store_corrupt",
      "the checkpoint open-question record did not parse; earlier active questions are unknown.",
    ));
  } else if (stored.status === "unavailable") {
    drops.push(policyDrop(
      policy.policyCommit,
      "open_question_store_unreadable",
      `the checkpoint open-question record could not be read (${stored.reason}); earlier active questions are unknown.`,
    ));
  }

  const entries: CheckpointInspectionEntry[] = [];
  for (const definition of policy.checkpoints) {
    const outcome = outcomes.get(definition.id);
    const openQuestion = openQuestions[definition.id];
    const persistedState = openQuestion === undefined
      ? undefined
      : activeOpenQuestionState(openQuestion);
    let obligation: CheckpointObligation;

    if (definition.mode === "advise") {
      obligation = { state: "none", matched: [] };
    } else if (!storeReadable) {
      obligation = {
        state: "unknown",
        matched: outcome?.holds ? [...outcome.matched] : [],
        unknown: "store_unavailable",
      };
    } else if (openQuestion === undefined) {
      if (outcome === undefined || (outcome.holds && outcome.whenPending)) {
        obligation = {
          state: "unknown",
          matched: outcome?.holds ? [...outcome.matched] : [],
          ...(outcome?.holds && outcome.whenPending
            ? { unknown: "when_pending" as const }
            : { unknown: "diff_unavailable" as const }),
        };
      } else if (!outcome.holds) {
        obligation = { state: "none", matched: [] };
      } else {
        obligation = { state: "will_open", matched: [...outcome.matched] };
      }
    } else if (
      outcome?.holds && outcome.whenPending &&
      persistedState !== "awaiting_declaration" &&
      persistedState !== "reopened"
    ) {
      // The persisted question still exists, but a pending `when` may narrow
      // its subject and unbind a currently standing conclusion. A read cannot
      // decide which without running project code.
      obligation = {
        state: "unknown",
        matched: [...openQuestion.matchedPaths],
        unknown: "when_pending",
      };
    } else {
      const matched = outcome?.holds && !outcome.whenPending
        ? outcome.matched
        : openQuestion.matchedPaths;
      const policyCommit = policy.policyCommit;
      if (policyCommit === undefined) {
        obligation = {
          state: "unknown",
          matched: [...matched],
          unknown: "diff_unavailable",
        };
        entries.push({ definition, openQuestion, obligation });
        continue;
      }
      const definitionHash = await checkpointDefinitionHash(definition);
      const subject = await computeSubject(
        root,
        definitionHash,
        matched,
        policyCommit,
      );
      if ("error" in subject) {
        drops.push(entryDrop(
          definition,
          policyCommit,
          "subject_unavailable",
          `checkpoint '${definition.id}': its current subject could not be computed (${subject.error}); its strict obligation is unknown.`,
        ));
        obligation = {
          state: "unknown",
          matched: [...matched],
          unknown: "subject_unavailable",
        };
      } else {
        obligation = {
          state: projectedOpenQuestionState(openQuestion, {
            definitionHash,
            subject: subject.subject.fingerprint,
            matched,
          }),
          matched: [...matched],
        };
      }
    }

    entries.push({
      definition,
      ...(outcome === undefined ? {} : { outcome }),
      ...(openQuestion === undefined ? {} : { openQuestion }),
      obligation,
    });
  }

  return {
    ...(policy.policyCommit === undefined
      ? {}
      : { policyCommit: policy.policyCommit }),
    checkpoints: policy.checkpoints,
    entries,
    openQuestions,
    storeReadable,
    drops,
  };
}

/** Project the canonical inspection onto the gate plan's note strings. */
export function checkpointInspectionNotes(
  inspection: CheckpointInspection,
  mode: GateMode = "strict",
): string[] {
  const notes = checkpointDropAccounts(inspection.drops).map(
    (advisory) => `Checkpoint advisory: ${advisory}`,
  );
  for (const { definition, outcome, obligation } of inspection.entries) {
    if (definition.mode === "advise") {
      if (outcome?.holds && !outcome.whenPending) {
        notes.push(
          `Checkpoint '${definition.id}' (advise): its advisory will be served at done (${outcome.matched.length} matched).`,
        );
      }
      continue;
    }
    if (mode === "report") {
      const note = reportStopNote(definition, obligation);
      if (note !== undefined) notes.push(note);
      continue;
    }
    switch (obligation.state) {
      case "will_open":
        notes.push(
          `Checkpoint '${definition.id}' (stop): a declared conclusion will be required at done (${obligation.matched.length} matched).`,
        );
        break;
      case "awaiting_declaration":
        notes.push(
          `Checkpoint '${definition.id}' (stop): its open question already requires a declared conclusion before gate jobs run (${obligation.matched.length} matched).`,
        );
        break;
      case "reopened":
        notes.push(
          `Checkpoint '${definition.id}' (stop): its open question reopened and requires a fresh declared conclusion before gate jobs run (${obligation.matched.length} matched).`,
        );
        break;
      case "declared_met":
        notes.push(
          `Checkpoint '${definition.id}' (stop): its current declared-met conclusion lets done proceed.`,
        );
        break;
      case "declared_unmet":
        notes.push(
          `Checkpoint '${definition.id}' (stop): its current declared-unmet conclusion lets done proceed; landing requires an owner variance.`,
        );
        break;
      case "unknown":
        notes.push(
          obligation.unknown === "when_pending"
            ? `Checkpoint '${definition.id}' (stop): a declared conclusion may be required if its when command fires (${obligation.matched.length} matched).`
            : `Checkpoint '${definition.id}' (stop): its strict obligation is unknown and fails open rather than being guessed.`,
        );
        break;
      case "none":
        break;
    }
  }
  return notes;
}

/** Compute and project the inspection in one call — the `done --dry-run`
 * seam shared by both full-gate entry points. */
export async function inspectCheckpointNotes(
  root: string,
  config: DiscernConfig,
  mode: GateMode = "strict",
): Promise<string[]> {
  return checkpointInspectionNotes(
    await inspectCheckpointObligations(root, config),
    mode,
  );
}

/** Project the canonical inspection onto the advisory hint channel used by
 * `prepare` and `status`. */
export function checkpointInspectionHints(
  inspection: CheckpointInspection,
): FiredHint[] {
  const hints: FiredHint[] = checkpointDropAccounts(inspection.drops).map((
    advisory,
  ) => fire(HINTS["checkpoint-advisory"], { advisory }));
  for (const { definition, outcome, obligation } of inspection.entries) {
    if (definition.mode === "advise") {
      if (outcome?.holds && !outcome.whenPending) {
        hints.push(
          fire(HINTS["checkpoint-advise"], {
            id: definition.id,
            question: definition.question.trim(),
            matched: [...outcome.matched],
          }),
        );
      }
      continue;
    }
    if (
      obligation.state === "will_open" ||
      obligation.state === "awaiting_declaration" ||
      obligation.state === "reopened"
    ) {
      hints.push(
        fire(HINTS["checkpoint-preview"], {
          id: definition.id,
          question: definition.question.trim(),
          matched: [...obligation.matched],
          whenPending: false,
        }),
      );
    } else if (
      obligation.state === "unknown" &&
      obligation.unknown === "when_pending"
    ) {
      hints.push(
        fire(HINTS["checkpoint-preview"], {
          id: definition.id,
          question: definition.question.trim(),
          matched: [...obligation.matched],
          whenPending: true,
        }),
      );
    }
  }
  return hints;
}
