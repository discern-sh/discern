/**
 * The gotchas trap matcher (ADR 0189): parsing `gotcha-match` blocks out of a
 * gotchas doc, and matching a gate failure against them. Malformed blocks must
 * become NAMED problems (never a traceless skip), the matcher block must never
 * leak into the inlined body, and matching is first-in-document-order with
 * every present field required to hold.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  matchTrap,
  parseGotchasDoc,
} from "../src/engine/gate/gotcha_match.ts";

const DOC = [
  "# Gate gotchas",
  "",
  "Intro prose.",
  "",
  "## Stack-independent traps",
  "",
  "### Stage-keyed trap",
  "",
  "**Fix.** Commit the gate's output.",
  "",
  "```gotcha-match",
  'stage = "tree_drift"',
  "```",
  "",
  "### Evidence-keyed trap",
  "",
  "**Fix.** Wire the single-run form.",
  "",
  "```gotcha-match",
  "evidence = 'timed out after \\d+s'",
  "```",
  "",
  "### Both-keys trap",
  "",
  "**Fix.** Reinstall dependencies.",
  "",
  "```gotcha-match",
  'stage = "check/test"',
  "evidence = 'MODULE_NOT_FOUND'",
  "```",
  "",
  "### Matcherless trap",
  "",
  "Prose only. A ``` fence-free``` entry.",
  "",
  "## Project-specific traps",
  "",
  "### Project trap",
  "",
  "**Fix.** Regenerate the index.",
  "",
  "```gotcha-match",
  "evidence = 'index out of date'",
  "```",
].join("\n");

Deno.test("parse: every ### entry becomes a trap; matchers attach; bodies drop the block", () => {
  const parsed = parseGotchasDoc(DOC);
  assertEquals(parsed.problems, []);
  assertEquals(
    parsed.traps.map((t) => t.title),
    [
      "Stage-keyed trap",
      "Evidence-keyed trap",
      "Both-keys trap",
      "Matcherless trap",
      "Project trap",
    ],
  );
  const [stageTrap, evidenceTrap, bothTrap, bare, project] = parsed.traps;
  assertEquals(stageTrap?.matcher?.stage, "tree_drift");
  assertEquals(stageTrap?.matcher?.evidence, undefined);
  assert(evidenceTrap?.matcher?.evidence instanceof RegExp);
  assertEquals(bothTrap?.matcher?.stage, "check/test");
  assert(bothTrap?.matcher?.evidence instanceof RegExp);
  assertEquals(bare?.matcher, undefined);
  assert(project?.matcher !== undefined, "project-specific traps parse too");
  for (const trap of parsed.traps) {
    assert(
      !trap.body.includes("gotcha-match"),
      `the matcher block must not leak into the body: ${trap.body}`,
    );
  }
  assertStringIncludes(stageTrap?.body ?? "", "Commit the gate's output.");
});

Deno.test("parse: heading-shaped lines inside fences do not open entries", () => {
  const doc = [
    "### Real trap",
    "",
    "```",
    "### not a heading",
    "gotcha-match is just text here",
    "```",
    "",
    "```gotcha-match",
    "evidence = 'X'",
    "```",
  ].join("\n");
  const parsed = parseGotchasDoc(doc);
  assertEquals(parsed.problems, []);
  assertEquals(parsed.traps.map((t) => t.title), ["Real trap"]);
  assert(parsed.traps[0]?.matcher?.evidence instanceof RegExp);
});

Deno.test("parse: each malformed block is a named problem, and the rest still parse", () => {
  const doc = [
    "### Bad TOML",
    "",
    "```gotcha-match",
    "stage = tree_drift",
    "```",
    "",
    "### Unknown key",
    "",
    "```gotcha-match",
    "evidnece = 'typo'",
    "```",
    "",
    "### Unknown stage",
    "",
    "```gotcha-match",
    'stage = "timeout"',
    "```",
    "",
    "### Bad regex",
    "",
    "```gotcha-match",
    "evidence = '('",
    "```",
    "",
    "### Empty block",
    "",
    "```gotcha-match",
    "```",
    "",
    "### Two blocks",
    "",
    "```gotcha-match",
    "evidence = 'ok'",
    "```",
    "",
    "```gotcha-match",
    "evidence = 'second'",
    "```",
    "",
    "### Non-string stage",
    "",
    "```gotcha-match",
    "stage = 3",
    "```",
    "",
    "### Still valid",
    "",
    "```gotcha-match",
    "evidence = 'VALID'",
    "```",
  ].join("\n");
  const parsed = parseGotchasDoc(doc);
  const byEntry = new Map(parsed.problems.map((p) => [p.entry, p.problem]));
  assertStringIncludes(byEntry.get("Bad TOML") ?? "", "not valid TOML");
  assertStringIncludes(byEntry.get("Unknown key") ?? "", "`evidnece`");
  assertStringIncludes(byEntry.get("Unknown stage") ?? "", '"timeout"');
  assertStringIncludes(
    byEntry.get("Bad regex") ?? "",
    "not a valid regular expression",
  );
  assertStringIncludes(
    byEntry.get("Empty block") ?? "",
    "neither `stage` nor `evidence`",
  );
  assertStringIncludes(
    byEntry.get("Two blocks") ?? "",
    "more than one `gotcha-match` block",
  );
  assertStringIncludes(byEntry.get("Non-string stage") ?? "", "`stage`");
  assertEquals(parsed.problems.length, 7);
  const valid = parsed.traps.find((t) => t.title === "Still valid");
  assert(valid?.matcher !== undefined, "later valid matchers still parse");
  const malformed = parsed.traps.find((t) => t.title === "Bad TOML");
  assertEquals(malformed?.matcher, undefined);
});

Deno.test("parse: a matcher block above the first entry is a named problem", () => {
  const doc = [
    "```gotcha-match",
    "evidence = 'stray'",
    "```",
    "",
    "### A trap",
    "",
    "Prose.",
  ].join("\n");
  const parsed = parseGotchasDoc(doc);
  assertEquals(parsed.problems.length, 1);
  assertEquals(parsed.problems[0]?.entry, "(outside any trap entry)");
});

Deno.test("match: first matching entry in document order wins; all present fields must hold", () => {
  const { traps } = parseGotchasDoc(DOC);
  // Stage alone.
  assertEquals(
    matchTrap(traps, { failedStage: "tree_drift", diagnostics: [] })?.title,
    "Stage-keyed trap",
  );
  // Evidence over the diagnostic message.
  assertEquals(
    matchTrap(traps, {
      failedStage: "check/test",
      diagnostics: [{
        message: "test timed out after 600s and was killed",
      }],
    })?.title,
    "Evidence-keyed trap",
  );
  // Evidence over the captured output, not just the message.
  assertEquals(
    matchTrap(traps, {
      failedStage: "check/test",
      diagnostics: [{
        message: "test failed (exit 1)",
        output: "Error: index out of date",
      }],
    })?.title,
    "Project trap",
  );
  // Both keys: the right stage with the wrong evidence does not match.
  assertEquals(
    matchTrap(traps, {
      failedStage: "check/test",
      diagnostics: [{ message: "something else" }],
    }),
    undefined,
  );
  // Both keys: evidence without the stage does not match either.
  assertEquals(
    matchTrap(traps, {
      failedStage: "build",
      diagnostics: [{ message: "MODULE_NOT_FOUND" }],
    }),
    undefined,
  );
  // Both keys held → the both-keys trap, and document order breaks no tie here.
  assertEquals(
    matchTrap(traps, {
      failedStage: "check/test",
      diagnostics: [{ message: "Error: MODULE_NOT_FOUND at import" }],
    })?.title,
    "Both-keys trap",
  );
});
