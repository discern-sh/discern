/**
 * The **stock-versus-flow loop** between the improvement coach and the
 * checkpoint boundary. Checkpoints guard the flow: a configured trigger serves
 * a question as a matching change completes, so new violations meet a
 * judgment before they land. The coach audits the stock: the estate of what
 * already exists, including the violations a boundary tolerates because they
 * predate it. This module keeps the two speaking one vocabulary:
 *
 *   - {@link boundaryGuardsByQuestion} marks catalog reviews whose canonical
 *     question an active configured checkpoint also serves, so the owner
 *     sees which questions have flow protection and which are audit-only;
 *   - {@link estateReviews} renders every other configured checkpoint's
 *     question as an estate review row — identical id and prose to what the
 *     `checkpoints` verb reports, both projected from the same resolver;
 *   - {@link checkpointRecommendations} turns project-local evidence into
 *     owner decisions: review a frequently-varied checkpoint, or graduate a
 *     recurring finding class into one. Every recommendation carries the
 *     observation it stands on; without evidence the coach recommends nothing.
 *
 * The conversion rule gates graduation structurally: a {@link graduationRoute}
 * must target a question whose violations are diff-introduced — an accrued
 * question (staleness, absence) throws at construction and is skipped at
 * build time, so it can never be recommended for the boundary.
 */

import {
  BUILT_IN_CHECKPOINTS,
  type BuiltInCheckpointSeed,
} from "../../shared/checkpoints.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { placementLadderProse, questionById } from "../../shared/questions.ts";
import type { PatternsFinding } from "../../shared/patterns_vocabulary.ts";
import {
  resolveCheckpoints,
  structurallyDormant,
} from "../checkpoints/policy.ts";
import { triggerSummary } from "../checkpoints/report.ts";
import {
  type CheckpointVarianceSummary,
  variedObservation,
} from "../logbook/checkpoint_economics.ts";
import type {
  BoundaryGuard,
  CheckpointRecommendation,
  ReviewResult,
} from "./types.ts";

// ── the boundary marking ────────────────────────────────────────────────────

/** The canonical question a configured entry serves, or undefined when the
 * entry authors its own prose (an override IS an authored question — the
 * canonical mark would claim protection the boundary does not give). */
function servedCanonicalQuestion(
  entryQuestion: string | undefined,
  seed: BuiltInCheckpointSeed | undefined,
): string | undefined {
  if (seed === undefined) {
    return undefined;
  }
  return entryQuestion !== undefined && entryQuestion.trim() !== ""
    ? undefined
    : seed.question;
}

/**
 * Canonical question id → the configured checkpoints serving it verbatim.
 * Resolution (seed merging, mode defaulting) stays with the one resolver the
 * gate uses, so the marking can never disagree with the flow side.
 */
export function boundaryGuardsByQuestion(
  config: DiscernConfig,
  seeds: Readonly<Record<string, BuiltInCheckpointSeed>> = BUILT_IN_CHECKPOINTS,
): Map<string, BoundaryGuard[]> {
  const guards = new Map<string, BoundaryGuard[]>();
  for (const def of resolveCheckpoints(config, seeds).checkpoints) {
    if (structurallyDormant(def)) {
      continue;
    }
    const canonical = servedCanonicalQuestion(
      config.checkpoints[def.id]?.question,
      seeds[def.id],
    );
    if (canonical === undefined) {
      continue;
    }
    const existing = guards.get(canonical) ?? [];
    existing.push({ checkpoint: def.id, mode: def.mode });
    guards.set(canonical, existing);
  }
  return guards;
}

/** One human line for a marked review: the flow is guarded; this is the stock. */
export function boundaryLine(guards: readonly BoundaryGuard[]): string {
  const list = guards
    .map((guard) => `'${guard.checkpoint}' (${guard.mode})`)
    .join(", ");
  const noun = guards.length === 1 ? "checkpoint" : "checkpoints";
  return `Boundary: ${noun} ${list} ${
    guards.length === 1 ? "serves" : "serve"
  } this question as a matching change completes — new violations meet the ` +
    `gate there; this review audits the estate the boundary already tolerates.`;
}

// ── the estate audit rows ───────────────────────────────────────────────────

/** The estate framing for an active checkpoint whose definition has no teach. */
export const ESTATE_AUDIT_TEACH =
  "A checkpoint guards the flow: it serves this question as a matching " +
  "change completes, so new violations meet a judgment before they land. The " +
  "stock is this review's half — audit what already exists against the same " +
  "question, and decide whether to clear it or keep tolerating it.";

/** The estate framing for a dormant checkpoint whose definition has no teach. */
const DORMANT_ESTATE_AUDIT_TEACH =
  "This checkpoint's selector currently expands to no matchable path, so it " +
  "serves no flow judgment. Audit what already exists against this question. " +
  "Configure a matchable selector if new violations should meet the Gate.";

/**
 * The configured checkpoints whose question the improvement catalog does not
 * already review, each as one estate review row. `covered` is the catalog's
 * question-id set; a checkpoint serving a covered canonical question is
 * skipped because that catalog review carries the boundary mark instead —
 * every checkpoint-member question renders exactly once. A structurally
 * dormant checkpoint still contributes its question to the estate audit but
 * claims no boundary until its selector can match.
 *
 * Identity parity with the `checkpoints` verb is by construction: id,
 * question, and teach are field copies of the same resolver's output, and
 * the trigger excerpt uses the same summary function.
 */
export function estateReviews(
  config: DiscernConfig,
  covered: ReadonlySet<string>,
  seeds: Readonly<Record<string, BuiltInCheckpointSeed>> = BUILT_IN_CHECKPOINTS,
): ReviewResult[] {
  const rows: ReviewResult[] = [];
  for (const def of resolveCheckpoints(config, seeds).checkpoints) {
    const dormant = structurallyDormant(def);
    const canonical = servedCanonicalQuestion(
      config.checkpoints[def.id]?.question,
      seeds[def.id],
    );
    if (canonical !== undefined && covered.has(canonical)) {
      continue;
    }
    rows.push({
      id: def.id,
      title: `The estate behind checkpoint '${def.id}'`,
      ask: def.question,
      teach: def.teach ??
        (dormant ? DORMANT_ESTATE_AUDIT_TEACH : ESTATE_AUDIT_TEACH),
      against: {
        source: `[checkpoints.${def.id}]`,
        excerpt: `${def.mode} · ${triggerSummary(def)}`,
      },
      ...(dormant
        ? {}
        : { boundary: [{ checkpoint: def.id, mode: def.mode }] }),
    });
  }
  return rows;
}

// ── the graduation loop ─────────────────────────────────────────────────────

/** One graduation route: which detector's recurring findings evidence which
 * diff-introduced question class. */
export interface GraduationRoute {
  /** The logbook detector whose findings are the project-local evidence. */
  detector: string;
  /** The canonical question the recurring class converts into. */
  question: string;
}

/** Whether a route passes the conversion rule against the live vocabulary. */
function routeConverts(route: GraduationRoute): boolean {
  return questionById(route.question)?.violations === "diff-introduced";
}

/**
 * Construct one graduation route, refusing a route the conversion rule
 * forbids: the question must exist and its violations must be introduced by
 * diffs. An accrued question (staleness, navigability, missing discovery)
 * has no change moment for a trigger to catch — it stays audit-side, and a
 * route claiming otherwise is a defect worth failing loudly at construction.
 */
export function graduationRoute(route: GraduationRoute): GraduationRoute {
  const question = questionById(route.question);
  if (question === undefined) {
    throw new Error(
      `graduation route '${route.detector}' references no canonical question '${route.question}'`,
    );
  }
  if (question.violations !== "diff-introduced") {
    throw new Error(
      `graduation route '${route.detector}' targets '${route.question}', whose ` +
        `violations are ${question.violations} — the conversion rule keeps that ` +
        `question audit-side`,
    );
  }
  return route;
}

/**
 * The shipped graduation routes. Each entry is built with
 * {@link graduationRoute}, so the conversion rule is checked the moment it is
 * added, and the recommendation builder below picks it up with no further
 * wiring. A route must be HONEST: its detector's findings must be recurring
 * instances of exactly the class its question names.
 */
export const GRADUATION_ROUTES: readonly GraduationRoute[] = [
  // Single giant-commit landings are recurring evidence of exactly the class
  // `change.commit-story` guards: a large change landing without a narrated
  // history. Wherever that question is already boundary-guarded (the shipped
  // `commit-story` default), the builder suppresses the recommendation — so
  // this route speaks only to projects that disabled or never enabled it.
  graduationRoute({
    detector: "giant-commit-landing",
    question: "change.commit-story",
  }),
];

// ── the recommendations ─────────────────────────────────────────────────────

/** The project-local evidence the recommendation builder reads. */
export interface CheckpointLoopEvidence {
  /** Ranked project-scope logbook findings (the improvement history). */
  findings: readonly PatternsFinding[];
  /** Checkpoints clearing the shared frequently-varied bar. */
  varied: readonly CheckpointVarianceSummary[];
}

/** The one review-recommendation teaching: what a variance is, and is not. */
const VARIANCE_WHY =
  "A variance is the owner's authorization to land one declared-unmet " +
  "conclusion; it never records the question as met. Repeated variances are " +
  "evidence about the checkpoint's fit, not evidence that the estate " +
  "satisfies the question.";

/**
 * Turn evidence into owner decisions. Reviews of existing checkpoints lead
 * (a misfiring boundary rule beats adding another), then graduations. Every
 * recommendation cites its observation; no qualifying evidence, no
 * recommendation — the coach never issues a generic exhortation.
 */
export function checkpointRecommendations(
  config: DiscernConfig,
  evidence: CheckpointLoopEvidence,
  seeds: Readonly<Record<string, BuiltInCheckpointSeed>> = BUILT_IN_CHECKPOINTS,
  routes: readonly GraduationRoute[] = GRADUATION_ROUTES,
): CheckpointRecommendation[] {
  const recommendations: CheckpointRecommendation[] = [];

  for (const summary of evidence.varied) {
    if (config.checkpoints[summary.id] === undefined) {
      // Only a configured checkpoint earns a review; an absent one's history
      // stays readable under `discern patterns`.
      continue;
    }
    recommendations.push({
      id: "checkpoints.review",
      subject: summary.id,
      title: `Checkpoint '${summary.id}' often lands under a variance`,
      action:
        `Review checkpoint '${summary.id}' with the owner: decide whether its ` +
        `trigger, its question wording, or its mode should move — or whether ` +
        `the checkpoint still earns its place at the boundary.`,
      why: VARIANCE_WHY,
      evidence: {
        source: "checkpoint observations in the local logbook",
        excerpt: variedObservation(summary),
      },
    });
  }

  const guarded = boundaryGuardsByQuestion(config, seeds);
  for (const route of routes) {
    if (!routeConverts(route)) {
      // A shipped route is validated at construction; an invalid injected one
      // fails open into silence — the coach never gates on a defect.
      continue;
    }
    if (guarded.has(route.question)) {
      // Already at the boundary; post-adoption fit is the hygiene detectors'
      // and the review recommendation's territory.
      continue;
    }
    const finding = evidence.findings.find(
      (candidate) => candidate.detector === route.detector,
    );
    if (finding === undefined) {
      continue;
    }
    recommendations.push({
      id: "checkpoints.graduate",
      subject: route.question,
      title: `Recurring findings match question '${route.question}'`,
      action: `Decide whether to capture this as a checkpoint: pair the ` +
        `'${route.question}' question with a deterministic trigger under ` +
        `[checkpoints.<id>], so the judgment is served as a matching change ` +
        `completes. The finding is evidence for the owner's decision, not a ` +
        `verdict.`,
      why:
        `Violations of this question arrive with a diff, so the conversion ` +
        `rule allows a boundary trigger. The placement ladder: ${placementLadderProse()}.`,
      evidence: {
        source: `logbook finding '${finding.detector}'`,
        excerpt: finding.observed,
      },
    });
  }

  return recommendations;
}
