/**
 * Guards for the plain-register reading-grade measurement — the arithmetic
 * behind the `plain_reading_grade` standard. The controls prove the counter
 * discriminates (simple prose grades lower than dense prose), so the
 * standard cannot rot into a number that never moves.
 */

import { assert, assertEquals } from "@std/assert";
import {
  countProse,
  fleschKincaidGrade,
  plainReadingGrade,
  plainRegisterCorpus,
  syllables,
} from "../scripts/plain_reading_grade_lib.ts";

Deno.test("syllable heuristic: positive controls", () => {
  assertEquals(syllables("cat"), 1);
  assertEquals(syllables("check"), 1);
  assertEquals(syllables("table"), 2);
  assertEquals(syllables("before"), 2);
  assertEquals(syllables("quality"), 3);
  assertEquals(syllables("instruction"), 3);
  assertEquals(syllables("rhythm"), 1);
  assertEquals(syllables(""), 0);
});

Deno.test("prose counting reads code spans as names and splits sentences", () => {
  const counts = countProse(
    "Run `discern done` first. It checks the work.",
  );
  assertEquals(counts.sentences, 2);
  // "Run first It checks the work" — six readable words.
  assertEquals(counts.words, 6);
  assert(counts.syllables >= counts.words, "every word has a syllable");
});

Deno.test("the grade discriminates: plain prose grades lower than dense prose", () => {
  const plain = countProse(
    "The check runs every time. It names each failure. The fix starts at the cause.",
  );
  const dense = countProse(
    "Comprehensive verification methodologies systematically enumerate diagnostic irregularities, facilitating remediation prioritisation across heterogeneous organisational infrastructures.",
  );
  assert(
    fleschKincaidGrade(plain) < fleschKincaidGrade(dense),
    "simple sentences must grade lower than jargon-dense ones",
  );
});

Deno.test("the live plain register measures deterministically and non-trivially", () => {
  const corpus = plainRegisterCorpus();
  assert(corpus.length > 0, "the plain register is never empty");
  const first = plainReadingGrade();
  const second = plainReadingGrade();
  assertEquals(first, second, "the measurement is deterministic");
  assert(first > 0, "the corpus grades above zero");
  assert(first < 20, `implausible reading grade: ${first}`);
});
