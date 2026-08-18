/**
 * The checkpoint **pre-flight** — everything `discern done` settles before the
 * unchanged-tree rerun guard and before any job or fixer:
 *
 *   1. load the GOVERNING policy (the merge-base config — never the branch's
 *      own edits) and evaluate every checkpoint's trigger against the effort
 *      diff, running `when` conditions under their fixed budget;
 *   2. reconcile episodes for the fired `stop` checkpoints — create
 *      idempotently, reopen on a definition- or subject-fingerprint change,
 *      carry a declaration that still binds;
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
import { collectEffortDiff } from "./diff.ts";
import {
  type CheckpointEpisode,
  declarationIsCurrent,
  readEpisodes,
  reconcileEpisode,
  recordDeclaration,
  validateUnmetRationale,
} from "./episodes.ts";
import { declarationEvidenceIdentity } from "./evidence.ts";
import { loadGoverningPolicy } from "./policy.ts";
import { checkpointDefinitionHash, computeSubject } from "./subject.ts";
import {
  evaluateStructuralTrigger,
  resolveTriggerOutcome,
} from "./triggers.ts";
import type { ResolvedCheckpoint, WhenOutcome } from "./types.ts";
import { runWhenCommand } from "./when.ts";

/** One checkpoint as served to the agent: the judgment and its evidence. */
export interface ServedCheckpoint {
  id: string;
  mode: CheckpointMode;
  /** The judgment prose the agent evaluates. */
  criterion: string;
  /** Optional lesson prose carried into renderings. */
  teach?: string;
  /** Optional reference material carried into renderings. */
  reference?: string;
  /** The matched paths behind the trigger — the subject's evidence. */
  matched: readonly string[];
}

/** One current declared-met conclusion among the governing fired set. */
export interface DeclaredMetConclusion {
  id: string;
  declaredAt: string;
}

/** One current declared-unmet conclusion among the governing fired set. */
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
    criterion: def.criterion,
    ...(def.teach === undefined ? {} : { teach: def.teach }),
    ...(def.reference === undefined ? {} : { reference: def.reference }),
    matched,
  };
}

/** Render the active declarable set for an invalid-id message. */
function activeSetClause(active: readonly string[]): string {
  return active.length === 0
    ? "no checkpoint has an active episode here — run `discern done` and it " +
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
): Promise<CheckpointPreflightOutcome> {
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

  // Trigger evaluation needs both a policy identity and a readable diff;
  // without either, nothing fires (fail open) and only declarations against
  // already-active episodes remain possible.
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

  // Reconcile episodes for the fired stop checkpoints. Subject or store
  // trouble drops the checkpoint from the interlock with an advisory — a
  // declaration must never bind to a subject the engine only guessed at.
  const episodes = new Map<string, CheckpointEpisode>();
  const interlocked: ServedCheckpoint[] = [];
  for (const [id, serving] of fired) {
    const def = policy.checkpoints.find((c) => c.id === id);
    if (def === undefined) {
      continue; // structurally impossible: `fired` is keyed from the policy
    }
    if (def.mode === "advise") {
      preflight.advise.push(serving);
      continue;
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
    const reconciled = await reconcileEpisode(
      root,
      {
        checkpoint: id,
        definitionHash,
        subject: subject.subject.fingerprint,
        matchedPaths: serving.matched,
      },
      now,
    );
    if (!reconciled.ok) {
      advisories.push(
        `checkpoint '${id}': its episode could not be recorded (${reconciled.reason}); it does not interlock this run.`,
      );
      continue;
    }
    if (reconciled.recovered) {
      advisories.push(
        "the checkpoint-episode record did not parse and was rebuilt; earlier conclusions must be declared again.",
      );
    }
    episodes.set(id, reconciled.episode);
    interlocked.push(serving);
  }

  // Declarations are valid only against ACTIVE episodes of governing stop
  // checkpoints. Validate the whole invocation BEFORE any write, so an error
  // records nothing.
  if (hasDeclarations(request)) {
    // Episodes may be active from an earlier run without firing now (an
    // unrelated revision, a fail-open `when`); read the store once to know
    // the full declarable set.
    const stored = await readEpisodes(root);
    const active = new Map<string, CheckpointEpisode>(episodes);
    if (stored.status === "ok") {
      for (const [id, episode] of Object.entries(stored.episodes)) {
        if (stopIds.has(id) && !active.has(id)) {
          active.set(id, episode);
        }
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
      const episode = active.get(id);
      if (episode === undefined) {
        continue; // validated present above
      }
      const evidence = conclusion === "met"
        ? {
          conclusion,
          definitionHash: episode.definitionHash,
          subject: episode.subject,
        }
        : {
          conclusion,
          why: request.unmet?.why ?? "",
          definitionHash: episode.definitionHash,
          subject: episode.subject,
        };
      const recorded = await recordDeclaration(root, evidence, id, now);
      if (!recorded.ok) {
        return { kind: "invalid", message: recorded.reason };
      }
      episodes.set(id, recorded.episode);
      preflight.recorded.push(id);
    }
  }

  // What still lacks a current conclusion, and what the current conclusions
  // are, among the checkpoints interlocking THIS run.
  for (const serving of interlocked) {
    const episode = episodes.get(serving.id);
    if (episode === undefined) {
      continue;
    }
    const declaration = episode.declaration;
    if (declaration === undefined || !declarationIsCurrent(episode)) {
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
