/**
 * Every operation discern performs itself has human words for people
 * watching it run. `STEP_HUMAN_LABELS` is keyed exactly like
 * `BUILT_IN_STEP_LABELS`, so a new built-in operation, including every one a
 * Desk effect plan can reach, cannot ship without its phrase; this guard also
 * holds the phrases to one shape.
 */

import { assert, assertEquals } from "@std/assert";
import { BUILT_IN_STEP_LABELS } from "../src/shared/result.ts";
import {
  humanStepLabel,
  STEP_HUMAN_LABELS,
} from "../src/shared/step_labels.ts";

Deno.test("every built-in step label has one human phrase", () => {
  assertEquals(
    Object.keys(STEP_HUMAN_LABELS).sort(),
    Object.keys(BUILT_IN_STEP_LABELS).sort(),
  );
  const phrases: string[] = [];
  for (const [key, label] of Object.entries(BUILT_IN_STEP_LABELS)) {
    const human = humanStepLabel(label);
    assert(human !== undefined, `${key}: ${label} has no human phrase`);
    phrases.push(human);
    assert(/^[A-Z]/u.test(human), `${key}: "${human}" starts with a capital`);
    assert(!/[.:;]$/u.test(human), `${key}: "${human}" ends without stops`);
    assert(!/\b[a-z]+-[a-z]+-[a-z]+\b/u.test(human), `${key}: kebab-case`);
    assert(human.length <= 48, `${key}: "${human}" fits one progress row`);
  }
  assertEquals(
    phrases.filter((phrase, index) => phrases.indexOf(phrase) !== index),
    [],
    "two operations share one phrase",
  );
  assertEquals(humanStepLabel("deno task test"), undefined);
});
