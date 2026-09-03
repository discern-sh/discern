/**
 * The stock-versus-flow loop between the improvement coach and the checkpoint
 * boundary (`src/engine/improve/checkpoint_loop.ts`). What must hold:
 *
 *   - marking: a configured checkpoint serving a canonical question verbatim
 *     marks that question boundary-guarded; an overridden question is an
 *     authored one and never claims the canonical mark;
 *   - audit parity: every configured checkpoint's question renders exactly
 *     once, with the id and prose the `checkpoints` verb reports — both sides
 *     project from the same resolver, and this suite proves the projection;
 *   - conversion-rule fidelity: an accrued question can never be the target
 *     of a graduation route, at construction or at build time;
 *   - evidence gating: no recommendation exists without the project-local
 *     observation it cites, and variance evidence keeps the declared-unmet
 *     conclusion — it never reads as the question having been met.
 *
 * Built-in seeds are injected synthetically here so the contract is provable
 * independently of the shipped set; a registry-driven loop then arms the same
 * assertions for every shipped seed.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import type { DiscernConfig } from "../src/shared/config_schema.ts";
import { BUILT_IN_CHECKPOINTS } from "../src/shared/checkpoints.ts";
import type { BuiltInCheckpointSeed } from "../src/shared/checkpoints.ts";
import { placementLadderProse, questionById } from "../src/shared/questions.ts";
import {
  resolveCheckpoints,
  structurallyDormant,
} from "../src/engine/checkpoints/policy.ts";
import { triggerSummary } from "../src/engine/checkpoints/report.ts";
import { variedObservation } from "../src/engine/logbook/checkpoint_economics.ts";
import type { CheckpointVarianceSummary } from "../src/engine/logbook/checkpoint_economics.ts";
import {
  boundaryGuardsByQuestion,
  boundaryLine,
  checkpointRecommendations,
  ESTATE_AUDIT_TEACH,
  estateReviews,
  GRADUATION_ROUTES,
  graduationRoute,
} from "../src/engine/improve/checkpoint_loop.ts";
import type { PatternsFinding } from "../src/shared/patterns_vocabulary.ts";

/** A parsed config; `checkpoints` entries are injected after parsing so a
 * synthetic seed reference is testable before the shipped registry fills. */
function config(
  toml: string,
  checkpoints: DiscernConfig["checkpoints"] = {},
): DiscernConfig {
  const parsed = parseConfigOrThrow(toml);
  return { ...parsed, checkpoints: { ...parsed.checkpoints, ...checkpoints } };
}

/** A synthetic shipped membership: one seed per canonical question named. */
function seedsFor(
  entries: Record<string, BuiltInCheckpointSeed>,
): Readonly<Record<string, BuiltInCheckpointSeed>> {
  return entries;
}

/** One qualifying variance summary. */
function varied(id: string): CheckpointVarianceSummary {
  return { id, landed: 4, variedLandings: 3, variances: 5 };
}

/** One minimal project-scope finding for `detector`. */
function finding(detector: string): PatternsFinding {
  return {
    detector,
    family: "behaviour",
    scope: "project",
    tone: "neutral",
    summary: "A recurring class of change repeats.",
    observed: `\`${detector}\` observed the class on 4 of 6 recent efforts.`,
    evidence: { efforts: 6, matched: 4 },
    strength: 4,
    next_step: "Decide where the rule belongs.",
  };
}

const AUTHORED = `
[checkpoints.api-review]
paths = ["src/api/**"]
question = "A changed interface is described before it lands."
`;

// ── the boundary marking ────────────────────────────────────────────────────

Deno.test("marking: a bare built-in reference guards its canonical question", () => {
  const seeds = seedsFor({
    "failure-memory-gate": {
      question: "setup.failure-memory",
      mode: "advise",
    },
  });
  const guards = boundaryGuardsByQuestion(
    config("", { "failure-memory-gate": {} }),
    seeds,
  );
  assertEquals(guards.get("setup.failure-memory"), [
    { checkpoint: "failure-memory-gate", mode: "advise" },
  ]);
});

Deno.test("marking: an entry's mode override wins over the seed's", () => {
  const seeds = seedsFor({
    "failure-memory-gate": {
      question: "setup.failure-memory",
      mode: "advise",
    },
  });
  const guards = boundaryGuardsByQuestion(
    config("", { "failure-memory-gate": { mode: "stop" } }),
    seeds,
  );
  assertEquals(guards.get("setup.failure-memory"), [
    { checkpoint: "failure-memory-gate", mode: "stop" },
  ]);
});

Deno.test("marking: an overridden question is authored — no canonical mark", () => {
  const seeds = seedsFor({
    "failure-memory-gate": { question: "setup.failure-memory" },
  });
  const guards = boundaryGuardsByQuestion(
    config("", {
      "failure-memory-gate": {
        question: "Entirely different judgment prose.",
      },
    }),
    seeds,
  );
  assertEquals(guards.size, 0);
});

Deno.test("marking: an authored checkpoint marks nothing canonical", () => {
  assertEquals(boundaryGuardsByQuestion(config(AUTHORED)).size, 0);
});

Deno.test("marking: a structurally dormant checkpoint claims no active boundary", () => {
  const seeds = seedsFor({
    "waiting-rule": {
      question: "setup.failure-memory",
      paths: ["${project.gotchas_doc}"],
    },
  });
  const dormant = config("", { "waiting-rule": {} });
  const resolved = resolveCheckpoints(dormant, seeds).checkpoints[0];
  assert(resolved !== undefined && structurallyDormant(resolved));
  assertEquals(boundaryGuardsByQuestion(dormant, seeds).size, 0);
  const row = estateReviews(dormant, new Set(), seeds)[0];
  assert(row !== undefined);
  assertEquals(row.boundary, undefined);
  assert(
    !row.teach.includes("guards the flow"),
    "a dormant selector must not claim to guard matching changes",
  );

  const armed = config(
    '[project]\ngotchas_doc = "notes/failures.md"\n',
    { "waiting-rule": {} },
  );
  assertEquals(
    boundaryGuardsByQuestion(armed, seeds).get("setup.failure-memory"),
    [{ checkpoint: "waiting-rule", mode: "stop" }],
  );
});

Deno.test("marking: the boundary line keeps stock and flow distinct", () => {
  const line = boundaryLine([{ checkpoint: "api-review", mode: "stop" }]);
  assert(line.includes("'api-review' (stop)"));
  assert(line.includes("audits what the boundary already tolerates"), line);
  const plural = boundaryLine([
    { checkpoint: "a", mode: "stop" },
    { checkpoint: "b", mode: "advise" },
  ]);
  assert(plural.includes("checkpoints 'a' (stop), 'b' (advise) serve"));
});

// ── the audit rows and their parity with the flow side ─────────────────────

Deno.test("audit: an authored checkpoint renders one improvement review row", () => {
  const cfg = config(AUTHORED);
  const rows = estateReviews(cfg, new Set());
  assertEquals(rows.length, 1);
  const row = rows[0];
  assert(row !== undefined);
  assertEquals(row.id, "api-review");
  assertEquals(row.ask, "A changed interface is described before it lands.");
  assertEquals(row.teach, ESTATE_AUDIT_TEACH);
  assertEquals(row.against?.source, "[checkpoints.api-review]");
  assertEquals(row.boundary, [{ checkpoint: "api-review", mode: "stop" }]);
});

Deno.test("audit: a checkpoint's own teach travels verbatim", () => {
  const cfg = config(`
[checkpoints.api-review]
paths = ["src/api/**"]
question = "A changed interface is described before it lands."
teach = "Describe the change where its callers will look."
`);
  assertEquals(
    estateReviews(cfg, new Set())[0]?.teach,
    "Describe the change where its callers will look.",
  );
});

Deno.test("audit: a covered canonical question defers to the marked catalog review", () => {
  const seeds = seedsFor({
    "failure-memory-gate": { question: "setup.failure-memory" },
  });
  const cfg = config("", { "failure-memory-gate": {} });
  // Covered by the catalog → the catalog row carries the mark; no audit row.
  assertEquals(
    estateReviews(cfg, new Set(["setup.failure-memory"]), seeds),
    [],
  );
  // Not covered → the audit row serves the canonical prose verbatim.
  const rows = estateReviews(cfg, new Set(), seeds);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]?.ask, questionById("setup.failure-memory")?.question);
});

Deno.test("audit parity: rows carry the resolver's id, prose, and trigger — the flow side's identity", () => {
  const seeds = seedsFor({
    "failure-memory-gate": {
      question: "setup.failure-memory",
      mode: "advise",
    },
  });
  const cfg = config(AUTHORED, { "failure-memory-gate": {} });
  const resolved = resolveCheckpoints(cfg, seeds).checkpoints;
  const rows = estateReviews(cfg, new Set(), seeds);
  assertEquals(
    rows.map((row) => row.id).sort(),
    resolved.map((def) => def.id).sort(),
    "every governing checkpoint renders in the improvement audit",
  );
  for (const def of resolved) {
    const row = rows.find((candidate) => candidate.id === def.id);
    assert(row !== undefined, def.id);
    assertEquals(row.ask, def.question, "question prose is byte-identical");
    if (def.teach !== undefined) {
      assertEquals(row.teach, def.teach, "teach prose is byte-identical");
    }
    assertEquals(
      row.against?.excerpt,
      `${def.mode} · ${triggerSummary(def)}`,
      "the trigger excerpt uses the flow side's summary function",
    );
    assertEquals(row.boundary, [{ checkpoint: def.id, mode: def.mode }]);
  }
});

Deno.test("audit: every shipped built-in auto-enrols the moment it exists", () => {
  // Registry-driven: vacuous while BUILT_IN_CHECKPOINTS is empty, armed for
  // every future seed. A bare `[checkpoints.<id>]` reference must render its
  // canonical question exactly once — marked on the catalog review when the
  // improvement membership covers it, as an audit row otherwise.
  for (const [id, seed] of Object.entries(BUILT_IN_CHECKPOINTS)) {
    // A seed naming a scope only governs where the project defines it; the
    // fixture supplies whatever scope the seed asks for, registry-driven.
    const cfg = config(
      seed.scope === undefined
        ? ""
        : `[scopes.${seed.scope}]\npaths = ["zz-fixture/**"]\n`,
      { [id]: {} },
    );
    const canonical = questionById(seed.question);
    assert(canonical !== undefined, id);
    const def = resolveCheckpoints(cfg).checkpoints.find((entry) =>
      entry.id === id
    );
    assert(def !== undefined, id);
    const dormant = structurallyDormant(def);
    const guards = boundaryGuardsByQuestion(cfg);
    assertEquals(
      guards.get(seed.question)?.[0]?.checkpoint,
      dormant ? undefined : id,
    );
    const uncovered = estateReviews(cfg, new Set());
    assertEquals(
      uncovered.filter((row) => row.id === id).length,
      1,
      `'${id}' must render as an audit row when no catalog review covers it`,
    );
    assertEquals(
      uncovered.find((row) => row.id === id)?.ask,
      canonical.question,
    );
    assertEquals(
      uncovered.find((row) => row.id === id)?.boundary,
      dormant ? undefined : [{ checkpoint: id, mode: def.mode }],
    );
    assertEquals(
      estateReviews(cfg, new Set([seed.question])).length,
      0,
      `'${id}' must defer to the marked catalog review when covered`,
    );
  }
});

// ── the conversion rule on graduation ───────────────────────────────────────

Deno.test("conversion fidelity: a route to an accrued question refuses construction", () => {
  assertThrows(
    () => graduationRoute({ detector: "docs-gap", question: "map.navigation" }),
    Error,
    "audit-side",
  );
  assertThrows(
    () => graduationRoute({ detector: "docs-gap", question: "no.such" }),
    Error,
    "no canonical question",
  );
  // A diff-introduced question constructs.
  assertEquals(
    graduationRoute({
      detector: "some-detector",
      question: "setup.failure-memory",
    }).question,
    "setup.failure-memory",
  );
});

Deno.test("conversion fidelity: shipped routes all pass the conversion rule", () => {
  for (const route of GRADUATION_ROUTES) {
    assertEquals(graduationRoute(route), route);
  }
});

Deno.test("conversion fidelity: an accrued route injected raw yields no recommendation", () => {
  const recommendations = checkpointRecommendations(
    config(""),
    { findings: [finding("docs-gap")], varied: [] },
    {},
    [{ detector: "docs-gap", question: "map.navigation" }],
  );
  assertEquals(recommendations, []);
});

// ── evidence gating on each recommendation ──────────────────────────────────

Deno.test("graduation fires only with its finding, and cites it", () => {
  const routes = [
    graduationRoute({
      detector: "recurring-class",
      question: "setup.failure-memory",
    }),
  ];
  const cfg = config("");
  const without = checkpointRecommendations(
    cfg,
    { findings: [], varied: [] },
    {},
    routes,
  );
  assertEquals(without, [], "no finding, no recommendation");

  const evidence = finding("recurring-class");
  const recommendations = checkpointRecommendations(
    cfg,
    { findings: [evidence], varied: [] },
    {},
    routes,
  );
  assertEquals(recommendations.length, 1);
  const graduate = recommendations[0];
  assert(graduate !== undefined);
  assertEquals(graduate.id, "checkpoints.graduate");
  assertEquals(graduate.subject, "setup.failure-memory");
  assertEquals(graduate.evidence.source, "logbook finding 'recurring-class'");
  assertEquals(graduate.evidence.excerpt, evidence.observed);
  assert(
    graduate.why.includes(placementLadderProse()),
    "the graduation teaches the placement ladder",
  );
  assert(
    graduate.action.includes("owner's decision"),
    "phrased as the owner's decision",
  );
});

Deno.test("graduation is suppressed once a configured checkpoint guards the question", () => {
  const seeds = seedsFor({
    "failure-memory-gate": { question: "setup.failure-memory" },
  });
  const routes = [
    graduationRoute({
      detector: "recurring-class",
      question: "setup.failure-memory",
    }),
  ];
  const recommendations = checkpointRecommendations(
    config("", { "failure-memory-gate": {} }),
    { findings: [finding("recurring-class")], varied: [] },
    seeds,
    routes,
  );
  assertEquals(
    recommendations,
    [],
    "post-adoption fit belongs to the hygiene detectors and the review recommendation",
  );
});

Deno.test("graduation is not suppressed by a dormant checkpoint", () => {
  const seeds = seedsFor({
    "waiting-rule": {
      question: "setup.failure-memory",
      paths: [""],
    },
  });
  const routes = [
    graduationRoute({
      detector: "recurring-class",
      question: "setup.failure-memory",
    }),
  ];
  const recommendations = checkpointRecommendations(
    config("", { "waiting-rule": {} }),
    { findings: [finding("recurring-class")], varied: [] },
    seeds,
    routes,
  );
  assertEquals(recommendations[0]?.id, "checkpoints.graduate");
});

Deno.test("a frequently-varied configured checkpoint earns a review recommendation", () => {
  const summary = varied("api-review");
  const recommendations = checkpointRecommendations(
    config(AUTHORED),
    { findings: [], varied: [summary] },
    {},
    [],
  );
  assertEquals(recommendations.length, 1);
  const review = recommendations[0];
  assert(review !== undefined);
  assertEquals(review.id, "checkpoints.review");
  assertEquals(review.subject, "api-review");
  assertEquals(review.evidence.excerpt, variedObservation(summary));
  assert(
    review.action.includes("trigger") && review.action.includes("mode"),
    "the review names what the owner may move",
  );
});

Deno.test("a varied checkpoint no longer configured earns no review", () => {
  assertEquals(
    checkpointRecommendations(
      config(""),
      { findings: [], varied: [varied("retired-rule")] },
      {},
      [],
    ),
    [],
  );
});

Deno.test("variance evidence preserves the declared-unmet conclusion", () => {
  const recommendations = checkpointRecommendations(
    config(AUTHORED),
    { findings: [], varied: [varied("api-review")] },
    {},
    [],
  );
  const review = recommendations[0];
  assert(review !== undefined);
  const rendered = [
    review.title,
    review.action,
    review.why,
    review.evidence.excerpt,
  ].join("\n");
  assert(
    review.why.includes("declared-unmet"),
    "the teaching names the declared-unmet conclusion",
  );
  assert(
    review.why.includes("never records the question as met"),
    "a variance is authorization, not a met conclusion",
  );
  // The vocabulary discipline: no surface may read as the question having
  // been met. Strip the declared-unmet phrase and the explicit negation, then
  // demand no bare met-claim survives.
  const stripped = rendered
    .replaceAll("declared-unmet", "")
    .replaceAll("never records the question as met", "");
  assert(
    !/\b(question|declared|conclusion)\s+met\b/i.test(stripped),
    `variance prose must never claim the question was met:\n${rendered}`,
  );
});

Deno.test("reviews of existing checkpoints lead the recommendation order", () => {
  const seeds = seedsFor({
    "failure-memory-gate": { question: "setup.failure-memory" },
  });
  const routes = [
    graduationRoute({
      detector: "recurring-class",
      question: "skills.executable",
    }),
  ];
  const recommendations = checkpointRecommendations(
    config(AUTHORED, {}),
    { findings: [finding("recurring-class")], varied: [varied("api-review")] },
    seeds,
    routes,
  );
  assertEquals(
    recommendations.map((recommendation) => recommendation.id),
    ["checkpoints.review", "checkpoints.graduate"],
  );
});
