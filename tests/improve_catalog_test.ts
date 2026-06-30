/**
 * Pure unit guards for the improve catalog and its scoring — fast, no subprocess.
 * Two jobs:
 *   1. catalog integrity: rule ids are unique and namespaced by their category,
 *      deterministic rules carry a fix + teach, subjective rules carry an ask +
 *      teach. These are the invariants a future rule addition must not break.
 *   2. scoring / ranking / feature-gating: `evaluateReport` over a synthetic
 *      context, so the weighted-score, weakest-first, and disabled-feature
 *      behaviours are pinned independent of any real project's files.
 *
 * The behavioural surface (the CLI, `--json`, the human report) is covered by
 * `engine_improve_test.ts`; this file pins the maths and the catalog shape.
 */

import { assert, assertEquals } from "@std/assert";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { CATEGORIES, CATEGORY_NAMES } from "../src/engine/improve/rules.ts";
import { evaluateReport } from "../src/engine/improve/improve.ts";
import {
  type ImprovementContext,
  RULE_STATUSES,
} from "../src/engine/improve/types.ts";
import { ruleResultSchema } from "../src/shared/result_schemas.ts";

/** Build a full {@link ImprovementContext} from config TOML plus fact overrides. */
function ctx(
  toml: string,
  facts: Partial<ImprovementContext> = {},
): ImprovementContext {
  return {
    root: "/tmp/demo",
    config: parseConfigOrThrow(toml),
    guidancePresent: false,
    guidanceText: "",
    guidanceChars: 0,
    guidancePlaceholder: false,
    gotchasDocSet: false,
    gotchasDocExists: false,
    docsTree: false,
    adrCount: 0,
    agentFilePresent: false,
    authoredSkills: 0,
    ...facts,
  };
}

/** A config + facts where every deterministic rule passes. */
function perfect(): ImprovementContext {
  return ctx(
    `
[meta]
bootstrapped = true
[project]
gotchas_doc = "docs/gotchas.md"
[capabilities]
format = "true"
lint = "true"
test = "true"
[worktree]
enabled = true
[ratchets.coverage]
limit = 1
run = "echo"
`,
    {
      guidancePresent: true,
      guidanceText: "x".repeat(1000),
      guidanceChars: 1000,
      gotchasDocSet: true,
      gotchasDocExists: true,
      docsTree: true,
      adrCount: 3,
      agentFilePresent: true,
      authoredSkills: 1,
    },
  );
}

Deno.test("improve wire schema's rule status enum equals the RuleStatus SSOT", () => {
  // ruleResultSchema lives in shared/result_schemas.ts, which can't import the engine
  // RuleStatus type — so this is a tie-by-test (not a compile-time derive): the wire
  // enum must list EXACTLY RULE_STATUSES. A status added to one but not the other (or
  // the enum weakened to z.string()) red-lights here.
  assertEquals(
    [...ruleResultSchema.shape.status.options].sort(),
    [...RULE_STATUSES].sort(),
  );
});

Deno.test("improve catalog: CATEGORY_NAMES is derived from the catalog, in order (SSOT)", () => {
  // The CLI help and the MCP tool's --category description interpolate this list,
  // so it must stay derived from CATEGORIES rather than hand-listed.
  assertEquals(CATEGORY_NAMES, CATEGORIES.map((c) => c.name));
  assert(CATEGORY_NAMES.length > 0);
});

Deno.test("improve catalog: rule ids are unique and namespaced by their category", () => {
  const seen = new Set<string>();
  const catNames = new Set<string>();
  for (const category of CATEGORIES) {
    assert(
      !catNames.has(category.name),
      `duplicate category '${category.name}'`,
    );
    catNames.add(category.name);
    assert(
      category.rules.length > 0,
      `category '${category.name}' has no rules`,
    );
    for (const rule of category.rules) {
      assert(!seen.has(rule.id), `duplicate rule id '${rule.id}'`);
      seen.add(rule.id);
      assertEquals(
        rule.id.split(".")[0],
        category.name,
        `rule '${rule.id}' should be namespaced by its category '${category.name}'`,
      );
      assert(rule.title.trim().length > 0, `rule '${rule.id}' needs a title`);
    }
  }
});

Deno.test("improve catalog: every rule carries the fields its kind needs", () => {
  for (const category of CATEGORIES) {
    for (const rule of category.rules) {
      assert(rule.teach.trim().length > 0, `${rule.id} needs a teach`);
      if (rule.kind === "deterministic") {
        assert(rule.weight > 0, `${rule.id} needs a positive weight`);
        assert(rule.fix.trim().length > 0, `${rule.id} needs a fix`);
      } else {
        assert(rule.ask.trim().length > 0, `${rule.id} needs an ask`);
      }
    }
  }
});

Deno.test("improve catalog: every category teaches beyond mechanically checked presence", () => {
  for (const category of CATEGORIES) {
    const reviews = category.rules.filter((rule) => rule.kind === "subjective");
    assert(
      reviews.length > 0,
      `${category.name} needs a qualitative review that teaches what good looks like`,
    );
  }
});

Deno.test("improve scoring: 100 baseline still prioritizes an open review", () => {
  const report = evaluateReport(perfect());
  assertEquals(report.score, 100);
  assertEquals(report.weak, 0);
  // Every subjective rule still surfaces as an open review even at a perfect score.
  assert(
    report.reviews > 0,
    "subjective rules are reviews regardless of score",
  );
  assertEquals(report.nextAction.kind, "review");
  assertEquals(report.nextAction.id, "gate.fast-feedback");
});

Deno.test("improve scoring: a bare project leads with the largest weighted gap", () => {
  const report = evaluateReport(ctx("")); // all defaults, all facts falsy
  assert(report.score < 25, `expected a low score, got ${report.score}`);
  assert(report.weak > 0);
  assertEquals(report.nextAction.kind, "fix");
  assertEquals(report.nextAction.id, "gate.test");
  // Weakest-first: the worst category leads. The gate (3 failing rules at score 0)
  // outranks the other score-0 categories on the weak-count tiebreak.
  assertEquals(report.categories[0]?.name, "gate");
  // Ranking is monotonic non-decreasing in score.
  for (let i = 1; i < report.categories.length; i++) {
    assert(
      (report.categories[i]?.score ?? 0) >=
        (report.categories[i - 1]?.score ?? 0),
      "categories must be sorted weakest-first",
    );
  }
});

Deno.test("improve scoring: partial credit moves the score between fail and pass", () => {
  // Only the gotchas doc differs: unset (fail) vs set-but-missing (partial) vs
  // set-and-present (pass). Restrict to `setup` to isolate the effect.
  const base = `[meta]\nbootstrapped = true\n[project]\n`;
  const fail = evaluateReport(ctx(base), "setup").categories[0]?.score ?? -1;
  const partial = evaluateReport(
    ctx(`${base}gotchas_doc = "x.md"\n`, { gotchasDocSet: true }),
    "setup",
  ).categories[0]?.score ?? -1;
  const pass = evaluateReport(
    ctx(`${base}gotchas_doc = "x.md"\n`, {
      gotchasDocSet: true,
      gotchasDocExists: true,
    }),
    "setup",
  ).categories[0]?.score ?? -1;
  assert(
    fail < partial && partial < pass,
    `expected fail<partial<pass, got ${fail},${partial},${pass}`,
  );
});

Deno.test("improve scoring: a disabled feature drops its whole category", () => {
  const report = evaluateReport(
    ctx(`[features]\nratchets = false\nskills = false\n`),
  );
  const names = report.categories.map((c) => c.name);
  assert(!names.includes("ratchets"), "ratchets category should be gated off");
  assert(!names.includes("skills"), "skills category should be gated off");
  // Core categories are never gated.
  assert(names.includes("gate") && names.includes("setup"));
});

Deno.test("improve scoring: `only` restricts evaluation to one category", () => {
  const report = evaluateReport(perfect(), "guidance");
  assertEquals(report.categories.length, 1);
  assertEquals(report.categories[0]?.name, "guidance");
});
