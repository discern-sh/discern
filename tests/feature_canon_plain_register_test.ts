/**
 * PLAIN-REGISTER guard for the feature canon (ADR 0228) — the vocabulary
 * discipline applied to the canon's plain-language axis.
 *
 * Two contracts hold the register:
 *
 * 1. ENROLMENT — `plain` is a required field on every glossary entry
 *    (translated, or kept with a reason), so a NEW glossary term fails the
 *    typecheck until its plain-language rendering is decided in the same
 *    change — vocabulary at birth, held by the compiler. The type-level
 *    test below pins the field's required-ness so it cannot quietly become
 *    optional.
 *
 * 2. THE JARGON SCAN — no policed term (a translated glossary term, or a
 *    row of the general-jargon table) may appear in any node's plain
 *    strings outside a code span. Names are quoted, concepts are
 *    translated: backticked command names and config keys are always legal;
 *    the surrounding prose must use the term's plain rendering.
 *
 * The scan covers the authored register (plain title/what/why/agent). Node
 * ids in the coverage appendix and the renderer's fixed chrome are
 * cross-reference keys, not register prose, and stay out of scope.
 */

import { assert, assertEquals } from "@std/assert";
import {
  allFeatureNodes,
  type FeatureNode,
  PLAIN_GENERAL_JARGON,
  plainPolicedTerms,
  stripCodeSpans,
} from "../scripts/feature_registry.ts";
import { GLOSSARY, type GlossaryEntry } from "../scripts/glossary_registry.ts";

Deno.test("the plain rendering is a required field on every glossary entry", () => {
  // Compile-time pin: if `plain` ever became optional, `undefined` would
  // join its type and this assignment would stop typechecking — the
  // enrolment guarantee lives in the compiler, and this keeps it there.
  type PlainRequired = undefined extends GlossaryEntry["plain"] ? false : true;
  const required: PlainRequired = true;
  assert(
    required,
    "decide a term's plain rendering in the same change that adds it " +
      "(scripts/glossary_registry.ts, the entry's `plain` field)",
  );
});

Deno.test("every plain rendering carries substance", () => {
  for (const entry of GLOSSARY) {
    const rendering = entry.plain;
    if ("keep" in rendering) {
      assert(
        rendering.keep.trim().length > 0,
        `${entry.term}: a kept term carries the reason it is already plain`,
      );
    } else {
      assert(
        rendering.phrase.trim().length > 0,
        `${entry.term}: a translated term carries its plain phrase`,
      );
    }
  }
  for (const [name, entry] of Object.entries(PLAIN_GENERAL_JARGON)) {
    assert(
      entry.plain.trim().length > 0,
      `${name}: a general-jargon row carries its plain rendering`,
    );
    assert(
      entry.match.trim().length > 0,
      `${name}: a general-jargon row is always policed, so it needs a matcher`,
    );
  }
});

Deno.test("every policed matcher compiles and matches its own term (positive control)", () => {
  const policed = plainPolicedTerms();
  assert(policed.length > 0, "the register polices vocabulary by design");
  // Spot-check the derivations the guard depends on: a default glossary
  // matcher, a narrowed one, and a general-jargon inflection family.
  const byName = new Map(policed.map((t) => [t.name, t.matcher]));
  const worktree = byName.get("Worktree");
  assert(worktree !== undefined, "Worktree is policed");
  assert(worktree.test("the worktrees collided"), "plural form matches");
  const accept = byName.get("Accept");
  assert(accept !== undefined, "Accept is policed via its glossary matches");
  assert(
    accept.test("run discern  accept now"),
    "phrase matches across spaces",
  );
  assert(
    !accept.test("the owner may accept the work"),
    "bare verb stays legal",
  );
  const agent = byName.get("agent");
  assert(agent !== undefined, "bare 'agent' is policed");
  assert(agent.test("the agent decides"), "bare agent matches");
  assert(!agent.test("the coding agent decides"), "'coding agent' stays legal");
  assert(!agent.test("coding-agent programs"), "'coding-agent' stays legal");
  const standard = byName.get("Standard");
  assert(standard !== undefined, "Standard is policed");
  assert(standard.test("the standards held"), "the plural is policed");
  assert(
    !standard.test("the standard example"),
    "the ordinary-English singular stays legal",
  );
});

Deno.test("code spans are stripped before the scan (positive control)", () => {
  assertEquals(
    stripCodeSpans("run `discern accept` on the `[gate].timeout` key"),
    "run   on the   key",
  );
  assert(!/worktree/.test(stripCodeSpans("`discern worktree prune` cleans")));
});

/** Every policed-term hit across one node's plain strings. */
function scanNode(node: FeatureNode): string[] {
  const offenders: string[] = [];
  const fields: Array<[string, string | undefined]> = [
    ["plain.title", node.plain.title],
    ["plain.what", node.plain.what],
    ["plain.why", node.plain.why],
    ["plain.agent", node.plain.agent],
  ];
  for (const { name, matcher, plain } of plainPolicedTerms()) {
    for (const [field, text] of fields) {
      if (text === undefined) continue;
      const stripped = stripCodeSpans(text);
      matcher.lastIndex = 0;
      const hit = matcher.exec(stripped);
      if (hit !== null) {
        offenders.push(
          `${node.id} ${field}: "${
            hit[0]
          }" is jargon in the plain register — ` +
            `say "${plain}" instead (term: ${name})`,
        );
      }
    }
  }
  return offenders;
}

Deno.test("no policed jargon appears in any node's plain strings", () => {
  const offenders = allFeatureNodes().flatMap(({ node }) => scanNode(node));
  assertEquals(
    offenders,
    [],
    "the plain register translates concepts and quotes names — fix the " +
      `prose or the term's plain rendering, never by deleting the matcher:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("the jargon scan discriminates (positive controls)", () => {
  const jargon: FeatureNode = {
    id: "fixture",
    title: "Fixture",
    what: "A fixture.",
    plain: {
      title: "Fixture",
      what: "The worktree holds the standards until the gate passes.",
    },
  };
  const hits = scanNode(jargon);
  assert(
    hits.length >= 3,
    `expected worktree/standard/gate hits, got: ${hits}`,
  );
  const quoted: FeatureNode = {
    id: "fixture-quoted",
    title: "Fixture",
    what: "A fixture.",
    plain: {
      title: "Fixture",
      what:
        "`discern worktree prune` tidies the separate working copy's leftovers, and the coding agent passes the proof on.",
    },
  };
  assertEquals(scanNode(quoted), []);
});
