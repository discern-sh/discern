/**
 * Every step a plan can show has human words for people watching it run.
 * `STEP_HUMAN_LABELS` is keyed exactly like `BUILT_IN_STEP_LABELS`, so a new
 * built-in operation, including every one a Desk effect plan can reach,
 * cannot ship without its phrase; `STEP_KIND_PHRASES` is keyed by every
 * step kind, so a project's own step (a job, an ensure command, a resource)
 * never reads as a bare configuration key. This guard holds both to one
 * shape.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { BUILT_IN_STEP_LABELS, STEP_KINDS } from "../src/shared/result.ts";
import {
  humanStepLabel,
  STEP_HUMAN_LABELS,
  STEP_KIND_PHRASES,
  stepWords,
} from "../src/shared/step_labels.ts";

Deno.test("every built-in step label has one human phrase", () => {
  assertEquals(
    Object.keys(STEP_HUMAN_LABELS).sort(),
    Object.keys(BUILT_IN_STEP_LABELS).sort(),
  );
  const phrases: string[] = [];
  for (const [key, label] of Object.entries(BUILT_IN_STEP_LABELS)) {
    const human = humanStepLabel(label, "develop");
    assert(human !== undefined, `${key}: ${label} has no human phrase`);
    phrases.push(human);
    assert(/^[A-Z]/u.test(human), `${key}: "${human}" starts with a capital`);
    assert(!/[.:;]$/u.test(human), `${key}: "${human}" ends without stops`);
    assert(!/\b[a-z]+-[a-z]+-[a-z]+\b/u.test(human), `${key}: kebab-case`);
    assert(human.length <= 48, `${key}: "${human}" fits one progress row`);
    assert(
      !/\bmain\b(?! checkout)/iu.test(human),
      `${key}: "${human}" names the configured trunk, never main`,
    );
  }
  assertEquals(
    phrases.filter((phrase, index) => phrases.indexOf(phrase) !== index),
    [],
    "two operations share one phrase",
  );
  assertEquals(humanStepLabel("deno task test", "develop"), undefined);
});

Deno.test("every step kind reads a project's own label in plain words", () => {
  assertEquals(
    Object.keys(STEP_KIND_PHRASES).sort(),
    [...STEP_KINDS].sort(),
  );
  // A configured command, a configured name, and a runtime phrase.
  for (const label of ["build-site", "deno task test --quiet", "smoke"]) {
    for (const kind of STEP_KINDS) {
      const words = stepWords({ kind, label }, "develop");
      assert(
        /^[A-Z]/u.test(words),
        `${kind}: "${words}" starts with a capital`,
      );
      assert(!/[.:;]$/u.test(words), `${kind}: "${words}" ends without stops`);
      assert(words !== label, `${kind}: "${words}" is more than its label`);
      // The configured spelling survives word for word, past its first
      // letter when the label is itself the phrase.
      assertStringIncludes(words.toLowerCase(), label.toLowerCase());
      assert(
        words.length <= label.length + 16,
        `${kind}: "${words}" adds a short phrase, no more`,
      );
    }
  }
  // A built-in label keeps its own phrase whatever kind carries it.
  assertEquals(
    stepWords(
      { kind: "git", label: BUILT_IN_STEP_LABELS.fastForwardTrunk },
      "develop",
    ),
    "Move develop to this branch",
  );
  assertEquals(
    stepWords({ kind: "repository-ensure", label: "build-site" }, "develop"),
    "Run build-site",
  );
  assertEquals(
    stepWords(
      { kind: "git", label: "record landing pre-authorization" },
      "develop",
    ),
    "Record landing pre-authorization",
  );
});
