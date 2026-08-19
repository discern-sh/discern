/**
 * ADR-citation guards — the net that keeps internal decision numbers out of
 * anything an end user (or their agent) sees.
 *
 * This repo cites its own ADRs constantly — in comments, docs, and commit
 * messages — and that's the sanctioned home for them. But a citation inside a
 * *shipped* surface is a leak: an "(ADR 0034)" in an upgrade note, an error
 * message, or a template reads as noise to every other project's users and
 * agents, who can't act on a number that indexes decisions made here.
 *
 * The law: no numbered ADR reference in any string literal under `src/`
 * (user-facing copy lives in strings — help text, notes, diagnostics, MCP
 * descriptions) or anywhere under `templates/` (shipped verbatim). The word
 * "ADR" alone stays legal everywhere — discern ships an ADR discipline, so its
 * copy must talk about ADRs as a concept — and so does the skeleton's
 * `_adr/0000-template.md`, which is part of that shipped discipline.
 *
 * One numbered citation is sanctioned: the skeletons seed the adopting
 * project's first record, `0001-adopt-discern.md`, and that file cites its
 * own number in its title. The exemption is that file citing THAT number —
 * a foreign number pasted into it is still a leak.
 *
 * The replacement: keep the citation, move it to a code comment beside the
 * string (or to `docs/`), and let the shipped copy carry only the explanation
 * users can act on.
 *
 * Retired *vocabulary* (a phrase the canon replaced) is a different law with a
 * different source of truth: the term registry declares each retired synonym,
 * and `tests/vocab_drift_test.ts` polices the whole set from that data.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { stringLiterals } from "./vocab_scan.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { QUESTIONS } from "../src/shared/questions.ts";
import { BUILT_IN_CHECKPOINTS } from "../src/shared/checkpoints.ts";

const SRC = join(REPO_ROOT, "src");
const TEMPLATES = join(REPO_ROOT, "templates");
const ADRS = join(REPO_AUTHORED_PATHS.map, "_adr");

/** A numbered citation of an internal decision: "ADR 0034", "adr-12", "ADR0101". */
const ADR_CITATION = /\bADR[\s-]?\d+/gi;
/** A numbered ADR file path; the two records the skeletons themselves ship
 * (0000-template, the seeded 0001-adopt-discern) are the only legal numbers. */
const ADR_PATH = /_adr\/(?!0000-template|0001-adopt-discern)\d/gi;
/** Callable/config/artifact pointers that are legal only in reviewed history. */
const RETIRED_ADR_POINTER =
  /\b(?:discern|agent)[\s_](?:finish|graduate|integrate|scopes|improve|ratchets)\b|\[(?:ratchets|docs)(?:\.|\])|\$\{docs\.|\bsetup\s+land\b|discern-gate-pass|(?<!DISCERN_)\bMAIN_BRANCH\b|# --- \/?discern harness ---|\b[Qq]uality\s+[Rr]atchet\b|\b[Rr]atchet\s+feature\b|\b[Tt]he\s+harness\b|\b[Hh]arness's\b/g;
const RETIRED_ACTIVE_ADR_PATH =
  /(?:-ratchets?|-graduate|-integrate|-improve-|docs-browser|setup-land|doctree)/i;
const ADR_0120_AMENDMENT =
  "Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md))";
const ADR_0137_AMENDMENT =
  "[ADR 0137](0137-project-scripts-live-under-the-script-command.md)";

/** Collect both numbered ADR citations and internal ADR path references from shipped text. */
function citationsIn(text: string): string[] {
  return [
    ...(text.match(ADR_CITATION) ?? []),
    ...(text.match(ADR_PATH) ?? []),
  ];
}

/** The seeded first record both shipped skeletons carry. */
const SEEDED_ADR_BASENAME = "0001-adopt-discern.md";

/** True for the one sanctioned self-reference: the seeded record's own number. */
function isSeededSelfCitation(hit: string): boolean {
  return hit.replace(/[\s-]/g, "").toLowerCase() === "adr0001";
}

/** Citations that leak from a shipped file — the seeded record may cite its
 * own number (its title does); every other numbered reference is a leak. */
function shippedOffendersIn(rel: string, text: string): string[] {
  const hits = citationsIn(text);
  if (!rel.endsWith(`/${SEEDED_ADR_BASENAME}`)) return hits;
  return hits.filter((hit) => !isSeededSelfCitation(hit));
}

Deno.test("src/ string literals never cite ADR numbers", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })
  ) {
    const source = await Deno.readTextFile(entry.path);
    const rel = relative(REPO_ROOT, entry.path);
    for (const { text, line } of stringLiterals(source)) {
      for (const hit of citationsIn(text)) {
        offenders.push(`${rel}:${line} string contains "${hit}"`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "internal ADR citations leaked into user-facing strings — move each " +
      `citation to a code comment (or docs/) and reword the copy:\n  ${
        offenders.join("\n  ")
      }`,
  );
});

Deno.test("shipped templates/ never cite ADR numbers", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(TEMPLATES, { includeDirs: false })) {
    let text: string;
    try {
      text = await Deno.readTextFile(entry.path);
    } catch {
      continue; // non-text / unreadable → nothing to leak
    }
    const rel = relative(REPO_ROOT, entry.path);
    for (const hit of shippedOffendersIn(rel, text)) {
      offenders.push(`${rel} contains "${hit}"`);
    }
  }
  assertEquals(
    offenders,
    [],
    "internal ADR citations leaked into the shipped surface — the copy must " +
      `stand alone for other projects:\n  ${offenders.join("\n  ")}`,
  );
});

Deno.test("active ADRs either speak the canon or carry an ADR 0120 amendment", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(ADRS, { includeDirs: false, maxDepth: 1 })) {
    const rel = relative(REPO_ROOT, entry.path);
    if (
      !rel.endsWith(".md") ||
      rel.endsWith("/0000-template.md") ||
      rel.endsWith("/README.md") ||
      rel.endsWith("/0120-launch-verb-canon.md")
    ) continue;
    const contents = await Deno.readTextFile(entry.path);
    const retired = contents.match(RETIRED_ADR_POINTER) ?? [];
    if (retired.length > 0 && !contents.includes(ADR_0120_AMENDMENT)) {
      offenders.push(
        `${rel} retains ${
          JSON.stringify(retired[0])
        } without an ADR 0120 amendment`,
      );
    }
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (RETIRED_ACTIVE_ADR_PATH.test(name)) {
      offenders.push(`${rel} retains retired vocabulary in its active path`);
    }
  }
  assertEquals(
    offenders,
    [],
    `untriaged launch vocabulary remains in the active ADR set:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("active ADRs that retain Recipe history carry an ADR 0137 amendment", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(ADRS, { includeDirs: false, maxDepth: 1 })) {
    const rel = relative(REPO_ROOT, entry.path);
    if (
      !rel.endsWith(".md") ||
      rel.endsWith("/0000-template.md") ||
      rel.endsWith("/README.md") ||
      rel.endsWith("/0137-project-scripts-live-under-the-script-command.md")
    ) continue;
    const contents = await Deno.readTextFile(entry.path);
    if (
      /\brecipes?\b/iu.test(contents) && !contents.includes(ADR_0137_AMENDMENT)
    ) {
      offenders.push(
        `${rel} retains Recipe history without an ADR 0137 amendment`,
      );
    }
  }
  assertEquals(
    offenders,
    [],
    `untriaged project script vocabulary remains in the active ADR set:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("shipped question vocabulary and checkpoint seeds carry no ADR citations", () => {
  // The src/ literal scan above already covers both registry modules; this
  // guard reads the registry VALUES, so interpolated prose is covered too,
  // and the shipped judgment text stays in the guard's scan set even if a
  // registry is ever relocated or its prose assembled at runtime.
  const offenders: string[] = [];
  for (const question of QUESTIONS) {
    const texts = [question.question, question.teach, question.reference];
    for (const text of texts) {
      for (const hit of citationsIn(text ?? "")) {
        offenders.push(`question '${question.id}' carries "${hit}"`);
      }
    }
  }
  for (const [id, seed] of Object.entries(BUILT_IN_CHECKPOINTS)) {
    const values = [
      seed.question,
      seed.scope,
      ...(seed.paths ?? []),
      ...(seed.unless_changed ?? []),
    ];
    for (const value of values) {
      for (const hit of citationsIn(value ?? "")) {
        offenders.push(`built-in checkpoint '${id}' carries "${hit}"`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "shipped question text must stand alone for other projects:\n  " +
      offenders.join("\n  "),
  );
});

// Positive controls: prove the detector detects, so the guard can't rot into
// a test that passes because it sees nothing.

Deno.test("adr guard: the lexer finds citations in strings but not comments", () => {
  const seeded = [
    'const a = "kept for compatibility (ADR 0034)"; // ADR 0035 is fine here',
    "/* ADR 0036 is fine here too */ const b = `see adr-12 for why ${x} holds`;",
    "const c = 'docs/_adr/0110-landing.md';",
  ].join("\n");
  const hits = stringLiterals(seeded).flatMap((l) => citationsIn(l.text));
  assertEquals(hits, ["ADR 0034", "adr-12", "_adr/0"]);
});

Deno.test("adr guard: sanctioned forms stay legal", () => {
  const legal = [
    'const a = "Record decisions as ADRs under docs/_adr/.";',
    'const b = "Copy _adr/0000-template.md to start a new record.";',
    "const re = /[\"']quadrant/; const c = 'ADR discipline';",
  ].join("\n");
  const hits = stringLiterals(legal).flatMap((l) => citationsIn(l.text));
  assertEquals(hits, []);
});

Deno.test("adr guard: the seeded record may cite its own number, nothing else, nowhere else", () => {
  const seeded = "templates/setup/skeleton/docs/_adr/0001-adopt-discern.md";
  assertEquals(
    shippedOffendersIn(seeded, "# ADR 0001: Adopt discern as the practice"),
    [],
  );
  assertEquals(
    shippedOffendersIn(seeded, "kept for parity (ADR 0034)"),
    ["ADR 0034"],
  );
  assertEquals(
    shippedOffendersIn("templates/instructions/base.md", "see ADR 0001"),
    ["ADR 0001"],
  );
  // The seeded record's path is referenceable anywhere; other numbers stay leaks.
  assertEquals(
    citationsIn("complete docs/_adr/0001-adopt-discern.md first"),
    [],
  );
  assertEquals(citationsIn("see docs/_adr/0002-example.md"), ["_adr/0"]);
});

Deno.test("adr guard: template interpolation and regex hazards don't desync the lexer", () => {
  const tricky =
    "const re = /[\"`]/; const t = `x ${a ? `${b}` : '(ADR 0042)'} y`;";
  const hits = stringLiterals(tricky).flatMap((l) => citationsIn(l.text));
  assert(hits.includes("ADR 0042"), `expected the nested leak, got: ${hits}`);
});

Deno.test("adr guard: a retired pointer wrapped across a line break still matches", () => {
  assertEquals(
    ("call setup\nland now").match(RETIRED_ADR_POINTER),
    ["setup\nland"],
  );
});
