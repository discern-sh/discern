/**
 * The checkpoint **pre-flight** — everything `discern done` settles before the
 * unchanged-tree rerun guard and before any job or fixer:
 *
 *   1. load the GOVERNING policy (the merge-base config — never the branch's
 *      own edits) and evaluate every checkpoint's trigger against the effort
 *      diff, running `when` conditions under their fixed budget;
 *   2. reconcile open questions for fired `stop` checkpoints and earlier active
 *      open questions — create idempotently, reopen on a definition- or
 *      subject-fingerprint change, carry a declaration that still binds;
 *   3. record this invocation's declarations (`--met` / `--unmet --why`),
 *      validating every id and the rationale BEFORE any write — an invalid
 *      invocation records nothing;
 *   4. report what still lacks a current conclusion (the refusal set), what is
 *      currently declared met and unmet (the Proof's agent-evidence rows), the
 *      fired `advise` checkpoints (served, never blocking), and the
 *      declaration-evidence identity the gate markers bind to.
 *
 * Everything here FAILS OPEN on uncertainty — an unreadable diff, a subject
 * that cannot be computed, a store that cannot be written — with a
 * plain-language advisory instead of a refusal: an interlock must never wedge
 * an effort on a question nobody asked.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import {
  CHECKPOINT_WHEN_INPUT_VERSION,
  type CheckpointMode,
} from "../../shared/checkpoints.ts";
import {
  type CheckpointDrop,
  entryCheckpointDrop,
  type EntryCheckpointDropReason,
  type GateMode,
  policyCheckpointDrop,
  type PolicyCheckpointDropReason,
} from "../../shared/checkpoint_drops.ts";
import {
  type CheckpointDeclarationObservation,
  observeCheckpointActivity,
} from "../../shared/result_capture.ts";
import {
  type OpenQuestion,
  reconcileOpenQuestion,
  recordDeclaration,
  validateUnmetRationale,
} from "./open_questions.ts";
import { declarationEvidenceIdentity } from "./evidence.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import {
  activeOpenQuestionState,
  inspectCheckpointObligations,
} from "./inspection.ts";
import { checkpointDefinitionHash, computeSubject } from "./subject.ts";
import { resolveTriggerOutcome } from "./triggers.ts";
import type {
  RelatedCheckpointPath,
  ResolvedCheckpoint,
  StructuralTriggerOutcome,
  WhenOutcome,
} from "./types.ts";
import { type CheckpointWhenInput, runWhenCommand } from "./when.ts";

/** One checkpoint as served to the agent: the judgment and its evidence. */
export interface ServedCheckpoint {
  id: string;
  mode: CheckpointMode;
  /** The judgment prose the agent evaluates. */
  question: string;
  /** Governing repository path that supplied `question`, when file-backed. */
  questionFile?: string;
  /** Optional lesson prose carried into renderings. */
  teach?: string;
  /** Optional reference material carried into renderings. */
  reference?: string;
  /** The matched paths behind the trigger — the subject's evidence. */
  matched: readonly string[];
  /** Typed existing-path evidence related to matched changed paths. */
  related: readonly RelatedCheckpointPath[];
}

/** One current declared-met conclusion among the governing active set. */
export interface DeclaredMetConclusion {
  id: string;
  question: string;
  questionFile?: string;
  teach?: string;
  reference?: string;
  declaredAt: string;
  matched: readonly string[];
  related: readonly RelatedCheckpointPath[];
}

/** One current declared-unmet conclusion among the governing active set. */
export interface DeclaredUnmetConclusion {
  id: string;
  question: string;
  questionFile?: string;
  teach?: string;
  reference?: string;
  /** The validated rationale — opaque evidence, rendered only through
   * escaping boundaries, never interpolated into a command. */
  why: string;
  declaredAt: string;
  matched: readonly string[];
  related: readonly RelatedCheckpointPath[];
}

/** What the pre-flight settled for this run. */
export interface CheckpointPreflight {
  /** Strict interlock or explicit CI report lane. */
  mode: GateMode;
  /** The policy identity (the merge-base commit), when it resolved. */
  policyCommit?: string;
  /** Typed durable evidence behind every fail-open account. */
  drops: CheckpointDrop[];
  /** Fired `stop` checkpoints with NO current conclusion — the refusal set. */
  outstanding: ServedCheckpoint[];
  /** Fired `stop` checkpoints whose current conclusion is declared met. */
  declaredMet: DeclaredMetConclusion[];
  /** Fired `stop` checkpoints whose current conclusion is declared unmet. */
  declaredUnmet: DeclaredUnmetConclusion[];
  /** Fired `advise` checkpoints — served through the advisory channel only. */
  advise: ServedCheckpoint[];
  /** Stop questions reported without declarations in report mode. */
  unreviewed: ServedCheckpoint[];
  /** Checkpoint ids this invocation newly recorded conclusions for. */
  recorded: string[];
  /** The declaration-evidence identity after every write, for the gate
   * markers; absent when the store was unavailable (consumers fail open). */
  evidence?: string;
}

/** Construct entry-scoped drop evidence from a resolved checkpoint. */
function preflightDrop(
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

/** Construct policy-scoped drop evidence before entries are knowable. */
function preflightPolicyDrop(
  policyCommit: string | undefined,
  reason: PolicyCheckpointDropReason,
  account: string,
): CheckpointDrop {
  return policyCheckpointDrop(reason, account, policyCommit);
}

/** The declarations one `done` invocation carries. */
export interface DeclarationRequest {
  /** `--met <id>`, repeatable. */
  met: readonly string[];
  /** `--unmet <id> --why "<rationale>"` — at most one per invocation. */
  unmet?: { id: string; why: string };
}

/** The pre-flight's outcome: an invalid declaring invocation (nothing was
 * recorded), or the settled state (which may still carry a refusal set). */
export type CheckpointPreflightOutcome =
  | { kind: "invalid"; message: string }
  | { kind: "ready"; preflight: CheckpointPreflight };

/** Whether any declaration was requested. */
export function hasDeclarations(request: DeclarationRequest): boolean {
  return request.met.length > 0 || request.unmet !== undefined;
}

/**
 * Evaluate checkpoints for the explicit CI report lane. This uses the same
 * governing inspection and `when` protocol as strict execution, but performs
 * no reconciliation, declaration, observation, or checkpoint-state write.
 */
export async function runCheckpointReport(
  root: string,
  config: DiscernConfig,
  signal?: AbortSignal,
): Promise<CheckpointPreflight> {
  const inspection = await inspectCheckpointObligations(root, config);
  const drops: CheckpointDrop[] = [...inspection.drops];
  const report: CheckpointPreflight = {
    mode: "report",
    ...(inspection.policyCommit === undefined
      ? {}
      : { policyCommit: inspection.policyCommit }),
    drops,
    outstanding: [],
    declaredMet: [],
    declaredUnmet: [],
    advise: [],
    unreviewed: [],
    recorded: [],
  };
  for (
    const { definition, outcome: structural, obligation } of inspection.entries
  ) {
    let final = structural === undefined ||
        (structural.holds && structural.whenPending)
      ? undefined
      : resolveTriggerOutcome(structural);
    if (structural?.holds && structural.whenPending) {
      const when = await runWhenCommand(
        root,
        definition.id,
        definition.when ?? "",
        {
          input: checkpointWhenInput(
            definition,
            inspection.policyCommit ?? "",
            structural,
          ),
          ...(signal === undefined ? {} : { signal }),
        },
      );
      final = resolveTriggerOutcome(structural, when);
      if (when.kind === "error") {
        if (inspection.policyCommit === undefined) {
          continue;
        }
        drops.push(preflightDrop(
          definition,
          inspection.policyCommit,
          when.reason,
          when.advisory,
        ));
      }
    }
    if (definition.mode === "advise") {
      if (final?.fired) {
        report.advise.push(served(
          definition,
          final.matched,
          final.related,
        ));
      }
      continue;
    }
    const active = obligation.state === "will_open" ||
      obligation.state === "awaiting_declaration" ||
      obligation.state === "reopened" ||
      obligation.state === "declared_met" ||
      obligation.state === "declared_unmet";
    if (final?.fired || active) {
      report.unreviewed.push(served(
        definition,
        final?.fired ? final.matched : obligation.matched,
        final?.fired ? final.related : obligation.related,
      ));
    }
  }
  return report;
}

/** Project a resolved definition onto its served form. */
function served(
  def: ResolvedCheckpoint,
  matched: readonly string[],
  related: readonly RelatedCheckpointPath[] = [],
): ServedCheckpoint {
  return {
    id: def.id,
    mode: def.mode,
    question: def.question,
    ...(def.questionFile === undefined
      ? {}
      : { questionFile: def.questionFile }),
    ...(def.teach === undefined ? {} : { teach: def.teach }),
    ...(def.reference === undefined ? {} : { reference: def.reference }),
    matched,
    related,
  };
}

/** Project the holding structural plan onto the versioned public input. Pure:
 * the executor owns the temporary file and environment. */
export function checkpointWhenInput(
  definition: ResolvedCheckpoint,
  policyCommit: string,
  structural: Extract<
    StructuralTriggerOutcome,
    { holds: true }
  >,
): CheckpointWhenInput {
  const changedFiles = [...structural.changed].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ).map((file) => {
    if (file.binary === "unknown") {
      throw new Error("when input received an unavailable binary fact");
    }
    return {
      path: file.path,
      kind: file.kind,
      insertions: file.insertions,
      deletions: file.deletions,
      binary: file.binary,
    };
  });
  return {
    version: CHECKPOINT_WHEN_INPUT_VERSION,
    checkpoint: { id: definition.id, mode: definition.mode },
    policy_commit: policyCommit,
    changed_files: changedFiles,
    ...(structural.history === undefined ? {} : {
      history: {
        count: structural.history.count,
        fingerprint: structural.history.fingerprint,
      },
    }),
  };
}

/** Render the active declarable set for an invalid-id message. */
function activeSetClause(active: readonly string[]): string {
  return active.length === 0
    ? "no checkpoint has an active open question here — run `discern done` and it " +
      "will serve any checkpoint this change makes relevant"
    : `the active set is: ${active.join(", ")}`;
}

/**
 * Run the checkpoint pre-flight at `root` with the LIVE `config` (it
 * contributes the trunk name; the governing tables come from the merge-base).
 * `now` exists for deterministic tests.
 */
export async function runCheckpointPreflight(
  root: string,
  config: DiscernConfig,
  request: DeclarationRequest,
  now?: string,
  signal?: AbortSignal,
): Promise<CheckpointPreflightOutcome> {
  const at = now ?? wallTimeIso(SYSTEM_CLOCK.wallNow());
  const inspection = await inspectCheckpointObligations(root, config);
  const drops: CheckpointDrop[] = [...inspection.drops];
  const preflight: CheckpointPreflight = {
    mode: "strict",
    ...(inspection.policyCommit === undefined
      ? {}
      : { policyCommit: inspection.policyCommit }),
    drops,
    outstanding: [],
    declaredMet: [],
    declaredUnmet: [],
    advise: [],
    unreviewed: [],
    recorded: [],
  };

  // The governing stop set is the only set a declaration can name.
  const stopIds = new Set(
    inspection.checkpoints.filter((c) => c.mode === "stop").map((c) => c.id),
  );

  // The canonical inspection already loaded every readable persisted question.
  // A trigger opens one; it never owns its lifetime, so this set outranks a
  // later veto or passing `when` throughout the mutating reconciliation below.
  const storedOpenQuestions: Record<string, OpenQuestion> = {
    ...inspection.openQuestions,
  };

  // Resolve only the executable half the read inspection deliberately leaves
  // pending. Readable active open questions still interlock whether the final
  // trigger fires or not.
  const fired = new Map<string, ServedCheckpoint>();
  for (const { definition, outcome: structural } of inspection.entries) {
    if (structural === undefined) {
      continue;
    }
    let when: WhenOutcome | undefined;
    if (structural.holds && structural.whenPending) {
      when = await runWhenCommand(
        root,
        definition.id,
        definition.when ?? "",
        {
          input: checkpointWhenInput(
            definition,
            inspection.policyCommit ?? "",
            structural,
          ),
          ...(signal === undefined ? {} : { signal }),
        },
      );
    }
    const outcome = resolveTriggerOutcome(structural, when);
    if (!outcome.fired) {
      if (outcome.advisory !== undefined) {
        if (inspection.policyCommit === undefined) {
          continue;
        }
        drops.push(preflightDrop(
          definition,
          inspection.policyCommit,
          when?.kind === "error" ? when.reason : "when_invalid_exit",
          outcome.advisory,
        ));
      }
      continue;
    }
    fired.set(
      definition.id,
      served(definition, outcome.matched, outcome.related),
    );
  }

  // Reconcile open questions for every fired stop checkpoint and every earlier
  // active open question still governed as a stop. Subject or store trouble drops
  // the checkpoint from the interlock with an advisory — a declaration must
  // never bind to a subject the engine only guessed at.
  const openQuestions = new Map<string, OpenQuestion>();
  const interlocked: ServedCheckpoint[] = [];
  // The serving each checkpoint's next declaration responds to: how this run's
  // reconciliation concluded, and when that subject was served — observation
  // facts the logbook records beside the interlock, never inputs to it.
  const servings = new Map<
    string,
    { outcome: "opened" | "reopened" | "carried"; servedAt: string }
  >();
  for (const def of inspection.checkpoints) {
    const id = def.id;
    let serving = fired.get(id);
    if (def.mode === "advise") {
      if (serving === undefined) {
        continue;
      }
      preflight.advise.push(serving);
      // Advise servings write no open question; the serving itself is the recorded
      // observation, so their firings still feed the observed economics.
      observeCheckpointActivity({ advise: [{ id }] });
      continue;
    }
    if (
      def.minCommits !== undefined &&
      inspection.history?.status !== "available"
    ) {
      // Ordered history is part of this definition's subject identity. Without
      // it, even a persisted serving cannot be reconciled or interlocked
      // truthfully; inspection already retained the question and typed drop.
      continue;
    }
    if (serving === undefined) {
      const earlier = storedOpenQuestions[id];
      if (earlier === undefined) {
        continue;
      }
      serving = served(def, earlier.matchedPaths, earlier.relatedPaths);
    }
    const policyCommit = inspection.policyCommit;
    if (policyCommit === undefined) {
      continue;
    }
    const definitionHash = await checkpointDefinitionHash(def);
    const subject = await computeSubject(
      root,
      definitionHash,
      serving.matched,
      policyCommit,
      serving.related,
      def.minCommits === undefined || inspection.history?.status !== "available"
        ? undefined
        : inspection.history.fingerprint,
    );
    if ("error" in subject) {
      drops.push(preflightDrop(
        def,
        policyCommit,
        "subject_unavailable",
        `checkpoint '${id}': its subject could not be computed (${subject.error}); it does not interlock this run.`,
      ));
      continue;
    }
    const reconciled = await reconcileOpenQuestion(
      root,
      {
        checkpoint: id,
        definitionHash,
        subject: subject.subject.fingerprint,
        matchedPaths: serving.matched,
        relatedPaths: serving.related,
      },
      at,
    );
    if (!reconciled.ok) {
      drops.push(preflightDrop(
        def,
        policyCommit,
        "open_question_store_write_failed",
        `checkpoint '${id}': its open question could not be recorded (${reconciled.reason}); it does not interlock this run.`,
      ));
      continue;
    }
    if (reconciled.recovered) {
      drops.push(preflightDrop(
        def,
        policyCommit,
        "open_question_store_rebuilt",
        `checkpoint '${id}': the open-question record was rebuilt after invalid content; earlier conclusions must be declared again.`,
      ));
    }
    const observed = {
      id,
      definition: definitionHash,
      subject: subject.subject.fingerprint,
    };
    switch (reconciled.outcome) {
      case "opened":
        observeCheckpointActivity({ fired: [observed] });
        servings.set(id, {
          outcome: "opened",
          servedAt: reconciled.openQuestion.openedAt,
        });
        break;
      case "reopened":
        observeCheckpointActivity({ reopened: [observed] });
        servings.set(id, {
          outcome: "reopened",
          // The serving the agent actually responded to is the one this
          // reconciliation replaced; the reopened open question's own reopen time is
          // this very instant.
          servedAt: reconciled.previousServedAt ??
            reconciled.openQuestion.reopenedAt ??
            reconciled.openQuestion.openedAt,
        });
        break;
      case "carried":
        servings.set(id, {
          outcome: "carried",
          servedAt: reconciled.openQuestion.reopenedAt ??
            reconciled.openQuestion.openedAt,
        });
        break;
    }
    openQuestions.set(id, reconciled.openQuestion);
    interlocked.push(serving);
  }

  // Declarations are valid only against ACTIVE open questions of governing stop
  // checkpoints. Validate the whole invocation BEFORE any write, so an error
  // records nothing.
  if (hasDeclarations(request)) {
    // A subject/store failure may have kept an earlier open question out of this
    // run's interlock. Its persisted subject is still exact, so it remains
    // declarable even though the current run cannot refresh it.
    const active = new Map<string, OpenQuestion>(openQuestions);
    for (const [id, openQuestion] of Object.entries(storedOpenQuestions)) {
      if (stopIds.has(id) && !active.has(id)) {
        active.set(id, openQuestion);
      }
    }
    const activeIds = [...active.keys()].sort();
    const requested = [
      ...request.met.map((id) => ({ id, conclusion: "met" as const })),
      ...(request.unmet === undefined
        ? []
        : [{ id: request.unmet.id, conclusion: "unmet" as const }]),
    ];
    const seen = new Set<string>();
    for (const { id } of requested) {
      if (seen.has(id)) {
        return {
          kind: "invalid",
          message:
            `checkpoint '${id}' was named more than once; declare one conclusion per checkpoint.`,
        };
      }
      seen.add(id);
      if (!active.has(id)) {
        return {
          kind: "invalid",
          message: `'${id}' is not a checkpoint awaiting a conclusion here; ${
            activeSetClause(activeIds)
          }.`,
        };
      }
    }
    if (request.unmet !== undefined) {
      const validated = validateUnmetRationale(request.unmet.why);
      if (!validated.ok) {
        return { kind: "invalid", message: validated.reason };
      }
    }
    for (const { id, conclusion } of requested) {
      const openQuestion = active.get(id);
      if (openQuestion === undefined) {
        continue; // validated present above
      }
      const evidence = conclusion === "met"
        ? {
          conclusion,
          definitionHash: openQuestion.definitionHash,
          subject: openQuestion.subject,
        }
        : {
          conclusion,
          why: request.unmet?.why ?? "",
          definitionHash: openQuestion.definitionHash,
          subject: openQuestion.subject,
        };
      const recorded = await recordDeclaration(root, evidence, id, at);
      if (!recorded.ok) {
        return { kind: "invalid", message: recorded.reason };
      }
      if (recorded.changed) {
        // Observation only, and metadata only: the conclusion, whether this
        // same invocation reopened the subject first (a relevant revision
        // preceded the declaration), the fingerprints, and the elapsed time
        // since the serving. The unmet rationale never leaves the open question
        // store and the Proof.
        const serving = servings.get(id);
        const servedAt = serving?.servedAt ??
          openQuestion.reopenedAt ?? openQuestion.openedAt;
        const declaration: CheckpointDeclarationObservation = {
          id,
          conclusion,
          revised: serving?.outcome === "reopened",
          definition: openQuestion.definitionHash,
          subject: openQuestion.subject,
        };
        const servedMs = Date.parse(servedAt);
        const declaredMs = Date.parse(at);
        if (Number.isFinite(servedMs) && Number.isFinite(declaredMs)) {
          declaration.elapsed_ms = Math.max(
            0,
            Math.round(declaredMs - servedMs),
          );
        }
        observeCheckpointActivity({ declared: [declaration] });
      }
      openQuestions.set(id, recorded.openQuestion);
      preflight.recorded.push(id);
    }
  }

  // What still lacks a current conclusion, and what the current conclusions
  // are, among the governing active checkpoints interlocking this run.
  for (const serving of interlocked) {
    const openQuestion = openQuestions.get(serving.id);
    if (openQuestion === undefined) {
      continue;
    }
    const state = activeOpenQuestionState(openQuestion);
    switch (state) {
      case "awaiting_declaration":
      case "reopened":
        preflight.outstanding.push(serving);
        break;
      case "declared_met": {
        const declaration = openQuestion.declaration;
        if (declaration?.conclusion === "met") {
          preflight.declaredMet.push({
            id: serving.id,
            question: serving.question,
            ...(serving.questionFile === undefined
              ? {}
              : { questionFile: serving.questionFile }),
            ...(serving.teach === undefined ? {} : { teach: serving.teach }),
            ...(serving.reference === undefined
              ? {}
              : { reference: serving.reference }),
            declaredAt: declaration.declaredAt,
            matched: serving.matched,
            related: serving.related,
          });
        }
        break;
      }
      case "declared_unmet": {
        const declaration = openQuestion.declaration;
        if (declaration?.conclusion === "unmet") {
          preflight.declaredUnmet.push({
            id: serving.id,
            question: serving.question,
            ...(serving.questionFile === undefined
              ? {}
              : { questionFile: serving.questionFile }),
            ...(serving.teach === undefined ? {} : { teach: serving.teach }),
            ...(serving.reference === undefined
              ? {}
              : { reference: serving.reference }),
            why: declaration.why,
            declaredAt: declaration.declaredAt,
            matched: serving.matched,
            related: serving.related,
          });
        }
        break;
      }
    }
  }

  const evidence = await declarationEvidenceIdentity(root);
  if (evidence.status === "ok") {
    preflight.evidence = evidence.identity;
  } else {
    drops.push(preflightPolicyDrop(
      inspection.policyCommit,
      "declaration_evidence_unavailable",
      `checkpoint declaration evidence could not be read (${evidence.reason}); Proof currency failed open.`,
    ));
  }
  return { kind: "ready", preflight };
}
