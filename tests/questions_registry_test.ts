/**
 * Forcing-function guards for the canonical question vocabulary
 * (`src/shared/questions.ts`) and its two memberships: the improvement catalog's
 * subjective rules and the built-in checkpoint seeds. Driven off the single
 * sources of truth — the QUESTIONS registry, the improvement CATEGORIES, and
 * BUILT_IN_CHECKPOINTS — so a new question, subjective rule, or built-in
 * checkpoint auto-enrols:
 *
 *   - every membership reference resolves (no dangling question id);
 *   - every question is referenced by at least one membership (no orphan);
 *   - a membership serves the canonical prose verbatim (no drifting copy);
 *   - the conversion rule holds: only a question whose violations are
 *     introduced by diffs may join the checkpoint membership.
 */

import { assert, assertEquals } from "@std/assert";
import {
  PLACEMENT_LADDER,
  placementLadderProse,
  QUESTION_IDS,
  QUESTION_VIOLATION_MODES,
  questionById,
  QUESTIONS,
} from "../src/shared/questions.ts";
import {
  BUILT_IN_CHECKPOINTS,
  CHECKPOINT_MODES,
} from "../src/shared/checkpoints.ts";
import { CATEGORIES } from "../src/engine/improve/rules.ts";
import { isSubjective } from "../src/engine/improve/rules.ts";
import type { SubjectiveRule } from "../src/engine/improve/types.ts";

/** Every subjective rule in the improvement catalog — the improvement membership. */
function improvementMembership(): SubjectiveRule[] {
  return CATEGORIES.flatMap((category) => category.rules.filter(isSubjective));
}

Deno.test("question ids are unique and non-empty", () => {
  assertEquals(new Set(QUESTION_IDS).size, QUESTIONS.length);
  for (const question of QUESTIONS) {
    assert(question.id.trim() !== "", "a question needs an id");
    assert(
      question.question.trim() !== "",
      `question '${question.id}' needs judgment prose`,
    );
    assert(
      question.teach.trim() !== "",
      `question '${question.id}' needs a teach`,
    );
    assert(
      (QUESTION_VIOLATION_MODES as readonly string[]).includes(
        question.violations,
      ),
      `question '${question.id}' needs a violation mode from ${
        QUESTION_VIOLATION_MODES.join("/")
      }`,
    );
  }
});

Deno.test("the conversion rule holds on the checkpoint membership: only diff-introduced questions", () => {
  // The stock-versus-flow line, machine-checked: a checkpoint serves its
  // question when a diff completes, so a question whose violations accrue by
  // time or absence has no moment to fire at — it stays audit-side. A future
  // built-in referencing an accrued question fails here; either the pairing is
  // wrong, or the question's violation mode was misjudged and the fix is a
  // conscious reclassification in src/shared/questions.ts.
  for (const [id, seed] of Object.entries(BUILT_IN_CHECKPOINTS)) {
    const question = questionById(seed.question);
    assert(
      question !== undefined,
      `built-in checkpoint '${id}' references unknown question '${seed.question}'`,
    );
    assertEquals(
      question.violations,
      "diff-introduced",
      `built-in checkpoint '${id}' pairs a trigger with '${question.id}', whose ` +
        `violations are ${question.violations} — the conversion rule keeps that ` +
        `question audit-side`,
    );
  }
});

Deno.test("the placement ladder is complete and projects into its prose", () => {
  // Five rungs, cheapest first — instructions, skill, checkpoint, gate, owner
  // authority — and one prose projection every teaching surface interpolates.
  assertEquals(PLACEMENT_LADDER.length, 5);
  const prose = placementLadderProse();
  for (const rung of PLACEMENT_LADDER) {
    assert(rung.home.trim() !== "" && rung.when.trim() !== "");
    assert(
      prose.includes(rung.home) && prose.includes(rung.when),
      `the ladder prose must carry the '${rung.home}' rung`,
    );
  }
});

Deno.test("every improvement subjective rule references a canonical question, verbatim", () => {
  const membership = improvementMembership();
  assert(membership.length > 0, "the improvement catalog has subjective rules");
  for (const rule of membership) {
    const question = questionById(rule.id);
    assert(
      question !== undefined,
      `improvement rule '${rule.id}' references no canonical question — add it to QUESTIONS in src/shared/questions.ts`,
    );
    // The membership must serve the canonical prose, not a drifting copy.
    assertEquals(rule.ask, question.question, rule.id);
    assertEquals(rule.teach, question.teach, rule.id);
  }
});

Deno.test("every built-in checkpoint references a canonical question and a valid mode", () => {
  for (const [id, seed] of Object.entries(BUILT_IN_CHECKPOINTS)) {
    assert(
      questionById(seed.question) !== undefined,
      `built-in checkpoint '${id}' references unknown question '${seed.question}' — add it to QUESTIONS in src/shared/questions.ts`,
    );
    if (seed.mode !== undefined) {
      assert(
        (CHECKPOINT_MODES as readonly string[]).includes(seed.mode),
        `built-in checkpoint '${id}' names an unknown mode '${seed.mode}'`,
      );
    }
  }
});

Deno.test("no question is orphaned by every membership", () => {
  const referenced = new Set<string>([
    ...improvementMembership().map((rule) => rule.id),
    ...Object.values(BUILT_IN_CHECKPOINTS).map((seed) => seed.question),
  ]);
  const orphans = QUESTION_IDS.filter((id) => !referenced.has(id));
  assertEquals(
    orphans,
    [],
    "every canonical question must be served by the improvement catalog or a " +
      "built-in checkpoint — remove the orphan or add its membership",
  );
});

Deno.test("shipped question prose keeps the reserved vocabulary", () => {
  // "attestation" is reserved for a planned supply-chain feature in its
  // term-of-art sense; no checkpoint surface may use it, the shipped judgment
  // prose included.
  for (const question of QUESTIONS) {
    for (
      const text of [question.question, question.teach, question.reference]
    ) {
      assert(
        !/attestation/i.test(text ?? ""),
        `question '${question.id}' uses reserved vocabulary`,
      );
    }
  }
});

Deno.test("the reserved word stays off every checkpoint-facing surface — tools, hints, contracts", async () => {
  // "attestation" is reserved for a planned supply-chain feature in its
  // term-of-art sense. Default-deny across the surfaces an agent or owner
  // reads at checkpoint moments; the consent feature's own pre-existing
  // `confirmed`-flag wording is the one vetted carrier, allowlisted
  // explicitly so anything NEW fails here until a human vets it.
  const reserved = /attestation/i;

  // MCP tool and parameter descriptions (runtime data, every tool).
  const { TOOLS } = await import("../src/engine/mcp/server.ts");
  for (const tool of TOOLS) {
    assert(
      !reserved.test(tool.description),
      `${tool.name}: tool description uses reserved vocabulary`,
    );
    for (const [param, schema] of Object.entries(tool.inputSchema)) {
      if (param === "confirmed") {
        continue; // the consent flag's vetted, pre-existing wording
      }
      const description = (schema as { description?: string }).description ??
        "";
      assert(
        !reserved.test(description),
        `${tool.name}.${param}: parameter description uses reserved vocabulary`,
      );
    }
  }

  // Hint templates and metadata: scan the module source so template
  // functions cannot hide an occurrence; every hit must be the vetted
  // consent hint's own line.
  const hintsSource = await Deno.readTextFile(
    new URL("../src/shared/hints.ts", import.meta.url),
  );
  for (const [index, line] of hintsSource.split("\n").entries()) {
    if (!reserved.test(line)) {
      continue;
    }
    assert(
      /conversation-consent attestation/.test(line),
      `hints.ts:${
        index + 1
      } uses reserved vocabulary outside the vetted consent hint`,
    );
  }

  // The declaration and variance contract module carries none at all.
  const contractsSource = await Deno.readTextFile(
    new URL("../src/shared/declarations.ts", import.meta.url),
  );
  assert(
    !reserved.test(contractsSource),
    "declarations.ts uses reserved vocabulary",
  );
});
