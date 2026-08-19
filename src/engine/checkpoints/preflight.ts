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
import type { CheckpointMode } from "../../shared/checkpoints.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import {
  type CheckpointDeclarationObservation,
  observeCheckpointActivity,
} from "../../shared/result_capture.ts";
import { collectEffortDiff } from "./diff.ts";
import {
  declarationIsCurrent,
  type OpenQuestion,
  readOpenQuestions,
  reconcileOpenQuestion,
  recordDeclaration,
  validateUnmetRationale,
} from "./open_questions.ts";
import { declarationEvidenceIdentity } from "./evidence.ts";
import { loadGoverningPolicy } from "./policy.ts";
import { checkpointDefinitionHash, computeSubject } from "./subject.ts";
import {
  evaluateStructuralTrigger,
  resolveTriggerOutcome,
} from "./triggers.ts";
import type {
  ResolvedCheckpoint,
  StructuralTriggerOutcome,
  WhenOutcome,
} from "./types.ts";
import { runWhenCommand } from "./when.ts";

/** One checkpoint as served to the agent: the judgment and its evidence. */
export interface ServedCheckpoint {
  id: string;
  mode: CheckpointMode;
  /** The judgment prose the agent evaluates. */
  question: string;
  /** Optional lesson prose carried into renderings. */
  teach?: string;
  /** Optional reference material carried into renderings. */
  reference?: string;
  /** The matched paths behind the trigger — the subject's evidence. */
  matched: readonly string[];
}

/** One current declared-met conclusion among the governing active set. */
export interface DeclaredMetConclusion {
  id: string;
  declaredAt: string;
}

/** One current declared-unmet conclusion among the governing active set. */
export interface DeclaredUnmetConclusion {
  id: string;
  /** The validated rationale — opaque evidence, rendered only through
   * escaping boundaries, never interpolated into a command. */
  why: string;
  declaredAt: string;
}

/** What the pre-flight settled for this run. */
export interface CheckpointPreflight {
  /** The policy identity (the merge-base commit), when it resolved. */
  policyCommit?: string;
  /** Plain-language fail-open accounts to surface as advisories. */
  advisories: string[];
  /** Fired `stop` checkpoints with NO current conclusion — the refusal set. */
  outstanding: ServedCheckpoint[];
  /** Fired `stop` checkpoints whose current conclusion is declared met. */
  declaredMet: DeclaredMetConclusion[];
  /** Fired `stop` checkpoints whose current conclusion is declared unmet. */
  declaredUnmet: DeclaredUnmetConclusion[];
  /** Fired `advise` checkpoints — served through the advisory channel only. */
  advise: ServedCheckpoint[];
  /** Checkpoint ids this invocation newly recorded conclusions for. */
  recorded: string[];
  /** The declaration-evidence identity after every write, for the gate
   * markers; absent when the store was unavailable (consumers fail open). */
  evidence?: string;
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

/** Project a resolved definition onto its served form. */
function served(
  def: ResolvedCheckpoint,
  matched: readonly string[],
): ServedCheckpoint {
  return {
    id: def.id,
    mode: def.mode,
    question: def.question,
    ...(def.teach === undefined ? {} : { teach: def.teach }),
    ...(def.reference === undefined ? {} : { reference: def.reference }),
    matched,
  };
}

/** Render the active declarable set for an invalid-id message. */
function activeSetClause(active: readonly string[]): string {
  return active.length === 0
    ? "no checkpoint has an active open question here — run `discern done` and it " +
      "will serve any checkpoint this change makes relevant"
    : `the active set is: ${active.join(", ")}`;
}

/** One governing checkpoint's structural preview against the current diff:
 * the resolved definition beside its trigger outcome. */
export interface CheckpointPreviewEntry {
  definition: ResolvedCheckpoint;
  outcome: StructuralTriggerOutcome;
}

/**
 * The structural checkpoint preview every previewing surface projects from —
 * `done --dry-run`, `prepare`, `status`, and the `checkpoints` verb all
 * consume this one shape, so they can never disagree about what would fire.
 */
export interface CheckpointPreview {
  /** The policy identity (the merge-base commit), when it resolved. */
  policyCommit?: string;
  /** The governing checkpoints, resolved. */
  checkpoints: readonly ResolvedCheckpoint[];
  /** Plain-language fail-open accounts (policy or diff trouble). */
  advisories: string[];
  /** One entry per governing checkpoint; absent entirely when the effort
   * diff could not be read (nothing can fire on unknowable state). */
  entries?: CheckpointPreviewEntry[];
}

/**
 * The read-only preview of the checkpoint gate: which governing checkpoints
 * STRUCTURALLY hold against the current diff, without running any `when`
 * command and without touching the open question store — a preview must change
 * nothing and spawn nothing. A checkpoint whose `when` condition is still
 * pending is reported honestly as "may require".
 */
export async function previewCheckpoints(
  root: string,
  config: DiscernConfig,
): Promise<CheckpointPreview> {
  const policy = await loadGoverningPolicy(root, config);
  const preview: CheckpointPreview = {
    ...(policy.policyCommit === undefined
      ? {}
      : { policyCommit: policy.policyCommit }),
    checkpoints: policy.checkpoints,
    advisories: [...policy.advisories],
  };
  if (policy.policyCommit === undefined || policy.checkpoints.length === 0) {
    return preview;
  }
  const diff = await collectEffortDiff(root, policy.policyCommit);
  if (diff === undefined) {
    preview.advisories.push(
      "the effort diff could not be read; no checkpoint fires.",
    );
    return preview;
  }
  preview.entries = policy.checkpoints.map((def) => ({
    definition: def,
    outcome: evaluateStructuralTrigger(def, diff),
  }));
  return preview;
}

/** The preview's holding entries — what would fire (or, `when` pending, may). */
export function previewHoldingEntries(
  preview: CheckpointPreview,
): (CheckpointPreviewEntry & { outcome: { holds: true } })[] {
  return (preview.entries ?? []).filter(
    (entry): entry is CheckpointPreviewEntry & { outcome: { holds: true } } =>
      entry.outcome.holds,
  );
}

/** Project a preview onto the gate plan's note strings (`done --dry-run`). */
export function checkpointPreviewNotes(preview: CheckpointPreview): string[] {
  const notes = preview.advisories.map(
    (advisory) => `Checkpoint advisory: ${advisory}`,
  );
  for (const { definition, outcome } of previewHoldingEntries(preview)) {
    const claim = definition.mode === "advise"
      ? "its advisory will be served"
      : "a declared conclusion will be required";
    const qualifier = outcome.whenPending
      ? ` if its when command fires (${outcome.matched.length} matched)`
      : ` (${outcome.matched.length} matched)`;
    notes.push(
      `Checkpoint '${definition.id}' (${definition.mode}): ${claim} at done${qualifier}.`,
    );
  }
  return notes;
}

/** Compute and project the preview in one call — the `done --dry-run` seam. */
export async function previewCheckpointNotes(
  root: string,
  config: DiscernConfig,
): Promise<string[]> {
  return checkpointPreviewNotes(await previewCheckpoints(root, config));
}

/**
 * Project a preview onto the advisory hint channel — the `prepare` and
 * `status` seam. A holding `stop` trigger serves its question early ("will
 * require a declared conclusion at done"; "may require" while a `when`
 * command still decides); a holding `advise` trigger whose firing is already
 * settled serves the same advisory it would at `done` (one still awaiting its
 * `when` command stays silent — a preview spawns nothing, so it cannot know);
 * fail-open accounts ride as notices. A checkpoint-free effort projects to
 * nothing, keeping these surfaces exactly as quiet as before.
 */
export function checkpointPreviewHints(
  preview: CheckpointPreview,
): FiredHint[] {
  const hints: FiredHint[] = preview.advisories.map((advisory) =>
    fire(HINTS["checkpoint-advisory"], { advisory })
  );
  for (const { definition, outcome } of previewHoldingEntries(preview)) {
    if (definition.mode === "advise") {
      if (!outcome.whenPending) {
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
    hints.push(
      fire(HINTS["checkpoint-preview"], {
        id: definition.id,
        question: definition.question.trim(),
        matched: [...outcome.matched],
        whenPending: outcome.whenPending,
      }),
    );
  }
  return hints;
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
): Promise<CheckpointPreflightOutcome> {
  const at = now ?? new Date().toISOString();
  const policy = await loadGoverningPolicy(root, config);
  const advisories = [...policy.advisories];
  const preflight: CheckpointPreflight = {
    ...(policy.policyCommit === undefined
      ? {}
      : { policyCommit: policy.policyCommit }),
    advisories,
    outstanding: [],
    declaredMet: [],
    declaredUnmet: [],
    advise: [],
    recorded: [],
  };

  // The governing stop set is the only set a declaration can name.
  const stopIds = new Set(
    policy.checkpoints.filter((c) => c.mode === "stop").map((c) => c.id),
  );

  // A trigger opens an open question; it does not own that open question's lifetime.
  // Load earlier governing stop open questions before evaluating this run so a
  // later veto or passing `when` cannot retract a question already served.
  // Unreadable state fails open, with the missing interlock stated plainly.
  let storedOpenQuestions: Record<string, OpenQuestion> = {};
  if (stopIds.size > 0) {
    const stored = await readOpenQuestions(root);
    if (stored.status === "ok") {
      storedOpenQuestions = stored.openQuestions;
    } else if (stored.status === "invalid") {
      advisories.push(
        "the checkpoint open-question record did not parse; earlier active open questions cannot interlock this run and must be served again before they can receive declarations.",
      );
    } else if (stored.status === "unavailable") {
      advisories.push(
        `the checkpoint open-question record could not be read (${stored.reason}); earlier active open questions cannot interlock this run.`,
      );
    }
  }

  // Trigger evaluation needs both a policy identity and a readable diff;
  // without either, nothing new fires (fail open). Readable active open questions
  // still interlock and remain declarable.
  const fired = new Map<string, ServedCheckpoint>();
  if (policy.policyCommit !== undefined && policy.checkpoints.length > 0) {
    const diff = await collectEffortDiff(root, policy.policyCommit);
    if (diff === undefined) {
      advisories.push(
        "the effort diff could not be read; no checkpoint fires on this run.",
      );
    } else {
      for (const def of policy.checkpoints) {
        const structural = evaluateStructuralTrigger(def, diff);
        let when: WhenOutcome | undefined;
        if (structural.holds && structural.whenPending) {
          when = await runWhenCommand(
            root,
            def.id,
            def.when ?? "",
          );
        }
        const outcome = resolveTriggerOutcome(structural, when);
        if (!outcome.fired) {
          if (outcome.advisory !== undefined) {
            advisories.push(outcome.advisory);
          }
          continue;
        }
        fired.set(def.id, served(def, outcome.matched));
      }
    }
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
  for (const def of policy.checkpoints) {
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
    if (serving === undefined) {
      const earlier = storedOpenQuestions[id];
      if (earlier === undefined) {
        continue;
      }
      serving = served(def, earlier.matchedPaths);
    }
    const definitionHash = await checkpointDefinitionHash(def);
    const subject = await computeSubject(
      root,
      definitionHash,
      serving.matched,
      policy.policyCommit ?? "",
    );
    if ("error" in subject) {
      advisories.push(
        `checkpoint '${id}': its subject could not be computed (${subject.error}); it does not interlock this run.`,
      );
      continue;
    }
    const reconciled = await reconcileOpenQuestion(
      root,
      {
        checkpoint: id,
        definitionHash,
        subject: subject.subject.fingerprint,
        matchedPaths: serving.matched,
      },
      at,
    );
    if (!reconciled.ok) {
      advisories.push(
        `checkpoint '${id}': its openQuestion could not be recorded (${reconciled.reason}); it does not interlock this run.`,
      );
      continue;
    }
    if (reconciled.recovered) {
      advisories.push(
        "the checkpoint open-question record did not parse and was rebuilt; earlier conclusions must be declared again.",
      );
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
    const declaration = openQuestion.declaration;
    if (declaration === undefined || !declarationIsCurrent(openQuestion)) {
      preflight.outstanding.push(serving);
      continue;
    }
    if (declaration.conclusion === "met") {
      preflight.declaredMet.push({
        id: serving.id,
        declaredAt: declaration.declaredAt,
      });
    } else {
      preflight.declaredUnmet.push({
        id: serving.id,
        why: declaration.why,
        declaredAt: declaration.declaredAt,
      });
    }
  }

  const evidence = await declarationEvidenceIdentity(root);
  if (evidence.status === "ok") {
    preflight.evidence = evidence.identity;
  }
  return { kind: "ready", preflight };
}
