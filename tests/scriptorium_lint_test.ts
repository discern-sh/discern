/**
 * The as-you-type register lint: retired synonyms flag in every register but
 * never inside a code span, the plain register's jargon scan fires only for
 * plain fields, the per-field grade uses the standard's own arithmetic, and
 * the Vale tier runs the real toolchain over a register-true probe path.
 */

import { assert, assertEquals } from "@std/assert";
import {
  blankCodeSpans,
  lintFieldText,
  valeFindings,
  valeProbePath,
} from "../scripts/scriptorium/lint.ts";
import { buildSnapshot } from "../scripts/scriptorium/snapshot.ts";
import { REPO_ROOT } from "../scripts/scriptorium/root.ts";

const { lint } = await buildSnapshot();

Deno.test("code spans blank out with offsets intact", () => {
  const text = "keep `integration branch` quiet";
  const blanked = blankCodeSpans(text);
  assertEquals(blanked.length, text.length);
  assert(!blanked.includes("integration branch"));
});

Deno.test("retired synonyms flag in prose and stay legal in code spans", () => {
  const flagged = lintFieldText(
    lint,
    "technical",
    "Rebase onto the integration branch first.",
  );
  assert(
    flagged.findings.some((finding) => finding.rule === "retired-synonym"),
    "a retired phrase in live prose must flag",
  );
  const quoted = lintFieldText(
    lint,
    "technical",
    "The alias `integration branch` remains searchable.",
  );
  assertEquals(
    quoted.findings.filter((finding) => finding.rule === "retired-synonym")
      .length,
    0,
    "a code span is a name, not prose",
  );
});

Deno.test("the plain register's jargon scan fires only for plain fields", () => {
  // Some matchers police a longer phrase than the bare name; pick one whose
  // name alone trips its own pattern, so the fixture stays content-proof.
  const policed = lint.plainPoliced.find((pattern) =>
    new RegExp(pattern.source, pattern.flags).test(
      `The ${pattern.name} does the work here.`,
    )
  );
  assert(policed !== undefined, "the plain register polices at least one term");
  const sentence = `The ${policed.name} does the work here.`;
  const plain = lintFieldText(lint, "plain", sentence);
  assert(
    plain.findings.some((finding) => finding.rule === "plain-jargon"),
    `"${policed.name}" must flag in the plain register`,
  );
  assert(plain.grade !== undefined, "plain fields grade themselves");
  const technical = lintFieldText(lint, "technical", sentence);
  assertEquals(
    technical.findings.filter((finding) => finding.rule === "plain-jargon")
      .length,
    0,
    "the technical register speaks its own vocabulary",
  );
  assertEquals(technical.grade, undefined);
});

Deno.test("the Vale probe path routes each register to its real styles", () => {
  assert(valeProbePath("brand").includes("_internal/brand"));
  assert(!valeProbePath("plain").includes("_internal/brand"));
});

Deno.test("the Vale tier judges a draft through the real toolchain", async () => {
  const findings = await valeFindings(
    REPO_ROOT,
    "technical",
    "This is is a repeated word.",
  );
  assert(
    findings.some((finding) => finding.rule !== "vale"),
    `Vale should report the repetition; got ${JSON.stringify(findings)}`,
  );
});
