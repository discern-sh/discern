/**
 * Comment-currency guard — the gate net that keeps `src/` comments describing
 * what the code does NOW, not how it once did it.
 *
 * A code comment should explain present behaviour. When a comment instead
 * rationalises the current code by narrating a superseded state of the codebase
 * — "it works this way because it USED to work that way" — it strands a
 * reference a future reader can't resolve: the thing it points at is gone. The
 * project's instructions asks for current-behaviour comments and for history to live
 * in docs/ADRs instead; this test makes that a checkable property rather than a
 * plea, so a backward-looking comment fails the gate the moment it lands —
 * including in code written later by someone who never read the instructions.
 *
 * The detector is a predicate over PROSE, tuned for precision: it flags a curated
 * set of retrospective markers that, inside a comment, usually narrate the past.
 * It leans strict — `no longer` is banned because it nearly always marks a change
 * ("X no longer does Y"), even though a few uses describe live state; those carry
 * the escape hatch below. It deliberately does NOT ban the words that are
 * overwhelmingly live-state or structural — "legacy <path>" (a compat layer the
 * code still reads) or "before the loop" (ordering) — where a ban would be pure
 * noise. The cost is recall: a backward-looking comment using none of the markers
 * slips through; that residual buys a guard trusted enough to stay.
 *
 * Escape hatch — when a reference to the past is genuinely load-bearing and
 * current (rare), annotate the comment with
 *   discern-allow-retrospective: <reason>
 * and the detector suppresses that comment's retrospective markers. The reason
 * is mandatory and lands in the diff. An annotation that masks no marker, or a
 * second annotation on the same comment, fails as unused. Every exception is
 * therefore visible, justified, and kept necessary. Reach for it sparingly; the
 * default is to reword.
 *
 * Scope: every authored TypeScript tree, plus the `#`-comment surface of the
 * shipped config (`templates/discern.toml.tmpl`, the gitignore fragment) and
 * this repo's own root `discern.toml` — the places a stale reference reaches
 * a reader with no context for discern's internal history. Out of scope by
 * design: `tests/` (they legitimately narrate the past they guard), and `docs/`
 * prose plus `templates/` instructions/skills (where documenting history, ADR
 * lifecycle, and troubleshooting symptoms is the correct thing to do), and ADRs.
 * The scan set derives from the authored-paths registry and the config files
 * are listed here, so a new source file auto-enrols with nothing to remember.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { extractSourceComments } from "../scripts/source_comments.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

/** TypeScript scanned for backward-looking `//` and block comments: the
 * authored universe minus `tests/`, the one documented exclusion above. */
const TS_FILES = AUTHORED_TS_FILES.filter((rel) => !rel.startsWith("tests/"));

/**
 * `#`-commented files scanned the same way — the shipped config surface every
 * install receives, plus this repo's own config: the places a stale reference
 * reaches a reader with no context for discern's internal history.
 */
const HASH_FILES = [
  "templates/discern.toml.tmpl",
  "templates/.gitignore.fragment",
  "discern.toml",
];

/** The inline annotation that exempts one comment, with a mandatory reason. */
const SUPPRESS = "discern-allow-retrospective:";

/**
 * General, domain-neutral retrospective markers — phrases that, in a comment,
 * narrate a past state of the code rather than its present behaviour. These
 * catch the pattern in any project, in any domain, including code written long
 * after this guard.
 */
const RETROSPECTIVE_MARKERS: RegExp[] = [
  /\bused to\b/i,
  /\bused-to\b/i,
  /\bpreviously\b/i,
  /\bformerly\b/i,
  /\bin the past\b/i,
  /\bhistorical(ly)?\b/i,
  /\bback when\b/i,
  /\boriginally\b/i,
  /\bno longer\b/i,
  /\bthe old\b/i,
  /\bonce (lived|did|was|were|had)\b/i,
  /\b(replaces?|replacing|replaced|mirrors?|mirroring) the (old|shell|former|previous)\b/i,
];

/**
 * Names of retired discern subsystems — concrete things the codebase no longer
 * contains. A comment that mentions one is narrating history by definition. This
 * is discern-specific vocabulary (the project is its own user), the comment-side
 * analogue of the retired command tokens in `dev_vocab_guard_test.ts`; it lives
 * in this repo's own tests, never in the generic shipped surface.
 */
const RETIRED_ARCHITECTURE: RegExp[] = [
  /\bshell (engine|dispatcher|harness|librar(y|ies)|one-liners?|config_|jq|step)/i,
  /\btwo-program\b/i,
  /\bsingle-binary refactor\b/i,
  /\bpre-(refactor|cutover)\b/i,
  /\bthe cutover\b/i,
  /\bmanaged-file machinery\b/i,
  /\bts port\b/i,
  // "the shell `output.sh`" / "shell `identity`" — the dead shell engine
  // named via a file or command. The backtick keeps runtime senses ("shell
  // command", "via `sh -c`") out.
  /\bshell [`]/i,
  // "matching the shell" / "like the shell's date math" — parity-with-the-dead-
  // shell provenance. The verbs keep the runtime shell ("a shell command") out.
  /\b(matching|matches|mirror\w*|like|unlike|preserv\w*|per|as) the shell\b/i,
];

const MARKERS: ReadonlyArray<RegExp> = [
  ...RETROSPECTIVE_MARKERS,
  ...RETIRED_ARCHITECTURE,
];

/** Comment prose consumed by the currency detector. */
interface CommentUnit {
  startLine: number;
  lines: string[];
}

interface SuppressionAnnotation {
  line: number;
  text: string;
  hasReason: boolean;
}

/** Every suppression annotation in one comment, valid or malformed. */
function suppressionAnnotations(unit: CommentUnit): SuppressionAnnotation[] {
  const out: SuppressionAnnotation[] = [];
  for (let i = 0; i < unit.lines.length; i++) {
    const text = unit.lines[i] ?? "";
    const lower = text.toLowerCase();
    let from = 0;
    while (from < text.length) {
      const at = lower.indexOf(SUPPRESS, from);
      if (at === -1) break;
      const next = lower.indexOf(SUPPRESS, at + SUPPRESS.length);
      const reasonEnd = next === -1 ? text.length : next;
      out.push({
        line: unit.startLine + i,
        text: undecorate(text).trim(),
        hasReason:
          text.slice(at + SUPPRESS.length, reasonEnd).trim().length > 0,
      });
      from = at + SUPPRESS.length;
    }
  }
  return out;
}

/** Remove annotation metadata before deciding whether its exemption is needed. */
function withoutSuppressionMetadata(unit: CommentUnit): CommentUnit {
  return {
    startLine: unit.startLine,
    lines: unit.lines.map((line) => {
      const at = line.toLowerCase().indexOf(SUPPRESS);
      return at === -1 ? line : line.slice(0, at);
    }),
  };
}

export type CommentViolationRule =
  | "retrospective"
  | "unused-suppression"
  | "suppression-requires-reason";

export interface CommentViolation {
  line: number;
  rule: CommentViolationRule;
  marker: string;
  text: string;
}

/** Strip a JSDoc line's ` * ` decoration so a marker reads as running prose. */
function undecorate(line: string): string {
  return line.replace(/^\s*\*?\s?/, "");
}

/**
 * Pull `#`-style comments out of a TOML / gitignore file, skipping a `#` that
 * sits inside a quoted string so `key = "a#b"` is not read as a comment. A run
 * of consecutive comment lines becomes one unit, so a marker that wraps across
 * the break is still caught — the same contract as the TypeScript extractor.
 */
export function extractHashComments(src: string): CommentUnit[] {
  const out: CommentUnit[] = [];
  const rows = src.split("\n");
  let lines: string[] | null = null;
  let startLine = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const comment = hashCommentText(rows[idx] ?? "");
    if (comment === null) {
      if (lines) {
        out.push({ startLine: startLine + 1, lines });
        lines = null;
      }
      continue;
    }
    if (lines === null) {
      lines = [];
      startLine = idx;
    }
    lines.push(comment);
  }
  if (lines !== null) out.push({ startLine: startLine + 1, lines });
  return out;
}

/** The text after the first unquoted `#` on a line, or null when there is none. */
function hashCommentText(line: string): string | null {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#") return line.slice(i + 1);
  }
  return null;
}

/** Retrospective markers in one comment, with suppression metadata removed. */
function retrospectiveViolations(unit: CommentUnit): CommentViolation[] {
  const out: CommentViolation[] = [];
  const seen = new Set<string>();
  const lines = unit.lines.map(undecorate);
  for (let i = 0; i < lines.length; i++) {
    const here = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    const pair = next === "" ? here : `${here} ${next}`;
    for (const m of MARKERS) {
      const intra = m.test(here);
      // A wrap match spans this line into the next: the pair matches but the
      // next line alone does not, so the phrase must start here.
      const wraps = !intra && next !== "" && m.test(pair) && !m.test(next);
      if (!intra && !wraps) continue;
      const line = unit.startLine + i;
      const key = `${line}|${m.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        line,
        rule: "retrospective",
        marker: m.source,
        text: (intra ? here : pair).trim(),
      });
    }
  }
  return out;
}

/** Project a malformed or unused suppression annotation into the common violation shape. */
function suppressionViolation(
  annotation: SuppressionAnnotation,
  rule: Exclude<CommentViolationRule, "retrospective">,
): CommentViolation {
  return {
    line: annotation.line,
    rule,
    marker: SUPPRESS,
    text: annotation.text,
  };
}

/**
 * Every comment-currency violation across a set of comment units. A suppression
 * exempts one unit only when it has a reason and masks a retrospective marker;
 * malformed, unused, and duplicate suppressions are violations of their own.
 */
export function scanUnits(units: CommentUnit[]): CommentViolation[] {
  const out: CommentViolation[] = [];
  for (const unit of units) {
    const annotations = suppressionAnnotations(unit);
    const retrospective = retrospectiveViolations(
      withoutSuppressionMetadata(unit),
    );
    if (annotations.length === 0) {
      out.push(...retrospective);
      continue;
    }

    const valid = annotations.filter((annotation) => annotation.hasReason);
    out.push(
      ...annotations
        .filter((annotation) => !annotation.hasReason)
        .map((annotation) =>
          suppressionViolation(annotation, "suppression-requires-reason")
        ),
    );
    if (valid.length === 0) continue;

    const unused = retrospective.length === 0 ? valid : valid.slice(1);
    out.push(
      ...unused.map((annotation) =>
        suppressionViolation(annotation, "unused-suppression")
      ),
    );
  }
  return out;
}

/** Backward-looking comments in TypeScript source (`//` and block comments). */
export function scanSource(src: string): CommentViolation[] {
  return scanUnits(extractSourceComments(src));
}

/** Backward-looking comments in a `#`-commented config file. */
export function scanHashSource(src: string): CommentViolation[] {
  return scanUnits(extractHashComments(src));
}

/** Render a located violation with the corrective action specific to its rule. */
function renderViolation(rel: string, violation: CommentViolation): string {
  const label = violation.rule === "retrospective"
    ? `${violation.rule}:${violation.marker}`
    : violation.rule;
  const fix = (() => {
    switch (violation.rule) {
      case "retrospective":
        return `Describe current behavior, move the history to docs/ADRs, or add "${SUPPRESS} <reason>" when the reference remains necessary.`;
      case "unused-suppression":
        return "Remove the suppression; this comment has no marker for it to mask.";
      case "suppression-requires-reason":
        return `Add a reason after "${SUPPRESS}", or remove the annotation.`;
    }
  })();
  return `${rel}:${violation.line}  [${label}]  ${violation.text}\n` +
    `    Fix: ${fix}`;
}

Deno.test("comments describe current behaviour, not the codebase's past", async () => {
  const offenders: string[] = [];
  for (const rel of TS_FILES) {
    for (const v of scanSource(await Deno.readTextFile(join(REPO_ROOT, rel)))) {
      offenders.push(renderViolation(rel, v));
    }
  }
  for (const rel of HASH_FILES) {
    const src = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const v of scanHashSource(src)) {
      offenders.push(renderViolation(rel, v));
    }
  }
  assertEquals(
    offenders,
    [],
    `Comment-currency violations found. Each row carries its fix.\n\n` +
      `This guard scans every authored TypeScript tree except tests/, plus the ` +
      `shipped config (discern.toml*, the gitignore fragment). It does not scan ` +
      `tests/ or Markdown prose. Fix matching prose outside the scan in the ` +
      `same sweep.\n\n  ` +
      `${offenders.join("\n  ")}`,
  );
});

// --- self-tests: the detector's own contract -------------------------------

Deno.test("detector flags a backward-looking comment", () => {
  const v = scanSource(`// it used to live in manifest.json\nconst x = 1;\n`);
  assertEquals(v.length, 1);
  assert(v[0]?.text.includes("used to"));
});

Deno.test("detector ignores markers inside string literals", () => {
  // A user-facing message may legitimately contain these words.
  assertEquals(scanSource(`const msg = "this previously failed";\n`), []);
  assertEquals(scanSource(`const url = "https://x/the old/y";\n`), []);
});

Deno.test("detector flags `no longer` — it usually marks a change", () => {
  assertEquals(
    scanSource(`// the nudge no longer fires from main\n`).length,
    1,
  );
});

Deno.test("detector does not ban genuinely live-state / structural words", () => {
  assertEquals(
    scanSource(`// fall back to a legacy .discern/config.toml\n`),
    [],
  );
  assertEquals(scanSource(`// test BEFORE the trailing-slash kind\n`), []);
});

Deno.test("suppression with a reason exempts a comment", () => {
  const src =
    `/**\n * Mirrors the shell port_for_id.\n * discern-allow-retrospective: pins a byte-compat invariant\n */\n`;
  assertEquals(scanSource(src), []);
});

Deno.test("suppression without a matching marker is rejected", () => {
  const src =
    `// Describes the current behavior.\n// discern-allow-retrospective: mistaken exemption\n`;
  assertEquals(scanSource(src).map((v) => v.rule), ["unused-suppression"]);
});

Deno.test("a marker in the suppression reason does not justify it", () => {
  const src =
    `// Describes the current behavior.\n// discern-allow-retrospective: "no longer matching" is live drift\n`;
  assertEquals(scanSource(src).map((v) => v.rule), ["unused-suppression"]);
});

Deno.test("suppression without a reason does NOT exempt", () => {
  const src = `// it used to be eager. discern-allow-retrospective:\n`;
  assertEquals(scanSource(src).map((v) => v.rule), [
    "suppression-requires-reason",
  ]);
});

Deno.test("suppression without a reason is rejected on a current comment", () => {
  const src = `// current behavior. discern-allow-retrospective:\n`;
  assertEquals(scanSource(src).map((v) => v.rule), [
    "suppression-requires-reason",
  ]);
});

Deno.test("each extra suppression on one comment is rejected", () => {
  const src =
    `// it used to be eager.\n// discern-allow-retrospective: needed\n// discern-allow-retrospective: redundant\n`;
  assertEquals(scanSource(src).map((v) => v.rule), ["unused-suppression"]);
});

Deno.test("comments after a backtick regex remain enrolled", () => {
  const src =
    "const fence = /^```/;\n// current behavior. discern-allow-retrospective: mistaken exemption\n";
  assertEquals(scanSource(src).map((v) => v.rule), ["unused-suppression"]);
});

Deno.test("a run of // lines reads as one comment, catching a wrapped marker", () => {
  const src =
    `// an install carried a committed shell\n// engine tree no fresh one has\nconst x = 1;\n`;
  assertEquals(scanSource(src).length, 1);
});

Deno.test("hash scan flags a backward-looking config comment", () => {
  assertEquals(scanHashSource(`root = ""  # the old default\n`).length, 1);
});

Deno.test("hash scan reads the comment, not the quoted value", () => {
  // "the old" sits in the value and the # inside it is not a comment opener.
  assertEquals(scanHashSource(`name = "the old value"  # current\n`), []);
});

Deno.test("hash scan reads a run of # lines as one comment (wrap)", () => {
  const src = `# the worktree used\n# to live nested in the repo\n`;
  assertEquals(scanHashSource(src).length, 1);
});

Deno.test("hash scan rejects a suppression without a matching marker", () => {
  const src =
    `# Describes the current behavior.\n# discern-allow-retrospective: mistaken exemption\n`;
  assertEquals(scanHashSource(src).map((v) => v.rule), [
    "unused-suppression",
  ]);
});
