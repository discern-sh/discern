/**
 * Forcing-function guards for the canonical criterion vocabulary
 * (`src/shared/criteria.ts`) and its two memberships: the improvement catalog's
 * subjective rules and the built-in checkpoint seeds. Driven off the single
 * sources of truth — the CRITERIA registry, the improvement CATEGORIES, and
 * BUILT_IN_CHECKPOINTS — so a new criterion, subjective rule, or built-in
 * checkpoint auto-enrols:
 *
 *   - every membership reference resolves (no dangling criterion id);
 *   - every criterion is referenced by at least one membership (no orphan);
 *   - a membership serves the canonical prose verbatim (no drifting copy);
 *   - the conversion rule holds: only a criterion whose violations are
 *     introduced by diffs may join the checkpoint membership.
 */

import { assert, assertEquals } from "@std/assert";
import {
  CRITERIA,
  CRITERION_IDS,
  CRITERION_VIOLATION_MODES,
  criterionById,
  PLACEMENT_LADDER,
  placementLadderProse,
} from "../src/shared/criteria.ts";
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

Deno.test("criterion ids are unique and non-empty", () => {
  assertEquals(new Set(CRITERION_IDS).size, CRITERIA.length);
  for (const criterion of CRITERIA) {
    assert(criterion.id.trim() !== "", "a criterion needs an id");
    assert(
      criterion.criterion.trim() !== "",
      `criterion '${criterion.id}' needs judgment prose`,
    );
    assert(
      criterion.teach.trim() !== "",
      `criterion '${criterion.id}' needs a teach`,
    );
    assert(
      (CRITERION_VIOLATION_MODES as readonly string[]).includes(
        criterion.violations,
      ),
      `criterion '${criterion.id}' needs a violation mode from ${
        CRITERION_VIOLATION_MODES.join("/")
      }`,
    );
  }
});

Deno.test("the conversion rule holds on the checkpoint membership: only diff-introduced criteria", () => {
  // The stock-versus-flow line, machine-checked: a checkpoint serves its
  // criterion when a diff completes, so a criterion whose violations accrue by
  // time or absence has no moment to fire at — it stays audit-side. A future
  // built-in referencing an accrued criterion fails here; either the pairing is
  // wrong, or the criterion's violation mode was misjudged and the fix is a
  // conscious reclassification in src/shared/criteria.ts.
  for (const [id, seed] of Object.entries(BUILT_IN_CHECKPOINTS)) {
    const criterion = criterionById(seed.criterion);
    assert(
      criterion !== undefined,
      `built-in checkpoint '${id}' references unknown criterion '${seed.criterion}'`,
    );
    assertEquals(
      criterion.violations,
      "diff-introduced",
      `built-in checkpoint '${id}' pairs a trigger with '${criterion.id}', whose ` +
        `violations are ${criterion.violations} — the conversion rule keeps that ` +
        `criterion audit-side`,
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

Deno.test("every improvement subjective rule references a canonical criterion, verbatim", () => {
  const membership = improvementMembership();
  assert(membership.length > 0, "the improvement catalog has subjective rules");
  for (const rule of membership) {
    const criterion = criterionById(rule.id);
    assert(
      criterion !== undefined,
      `improvement rule '${rule.id}' references no canonical criterion — add it to CRITERIA in src/shared/criteria.ts`,
    );
    // The membership must serve the canonical prose, not a drifting copy.
    assertEquals(rule.ask, criterion.criterion, rule.id);
    assertEquals(rule.teach, criterion.teach, rule.id);
  }
});

Deno.test("every built-in checkpoint references a canonical criterion and a valid mode", () => {
  for (const [id, seed] of Object.entries(BUILT_IN_CHECKPOINTS)) {
    assert(
      criterionById(seed.criterion) !== undefined,
      `built-in checkpoint '${id}' references unknown criterion '${seed.criterion}' — add it to CRITERIA in src/shared/criteria.ts`,
    );
    if (seed.mode !== undefined) {
      assert(
        (CHECKPOINT_MODES as readonly string[]).includes(seed.mode),
        `built-in checkpoint '${id}' names an unknown mode '${seed.mode}'`,
      );
    }
  }
});

Deno.test("no criterion is orphaned by every membership", () => {
  const referenced = new Set<string>([
    ...improvementMembership().map((rule) => rule.id),
    ...Object.values(BUILT_IN_CHECKPOINTS).map((seed) => seed.criterion),
  ]);
  const orphans = CRITERION_IDS.filter((id) => !referenced.has(id));
  assertEquals(
    orphans,
    [],
    "every canonical criterion must be served by the improvement catalog or a " +
      "built-in checkpoint — remove the orphan or add its membership",
  );
});

Deno.test("shipped criterion prose keeps the reserved vocabulary", () => {
  // "attestation" is reserved for a planned supply-chain feature in its
  // term-of-art sense; no checkpoint surface may use it, the shipped judgment
  // prose included.
  for (const criterion of CRITERIA) {
    for (
      const text of [criterion.criterion, criterion.teach, criterion.reference]
    ) {
      assert(
        !/attestation/i.test(text ?? ""),
        `criterion '${criterion.id}' uses reserved vocabulary`,
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
