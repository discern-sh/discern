/**
 * Comment-currency guard — the gate net that keeps `src/` comments describing
 * what the code does NOW, not how it once did it.
 *
 * A code comment should explain present behaviour. When a comment instead
 * rationalises the current code by narrating a superseded state of the codebase
 * — "it works this way because it USED to work that way" — it strands a
 * reference a future reader can't resolve: the thing it points at is gone. The
 * project's guidance asks for current-behaviour comments and for history to live
 * in docs/ADRs instead; this test makes that a checkable property rather than a
 * plea, so a backward-looking comment fails the gate the moment it lands —
 * including in code written later by someone who never read the guidance.
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
 * and the detector skips that comment. The reason is mandatory and lands in the
 * diff, so every exception is visible and justified at review — the opposite of
 * a silent denylist. Reach for it sparingly; the default is to reword.
 *
 * Scope: the TypeScript under `src/` and `scripts/`, plus the `#`-comment surface
 * of the shipped config (`templates/discern.toml.tmpl`, the gitignore fragment)
 * and this repo's own root `discern.toml` — the places a stale reference reaches
 * a reader with no context for discern's internal history. Out of scope by
 * design: `tests/` (they legitimately narrate the past they guard), and `docs/`
 * prose plus `templates/` guidance/skills (where documenting history, ADR
 * lifecycle, and troubleshooting symptoms is the correct thing to do), and ADRs.
 * The trees are walked and the config files listed here, so a new source file
 * auto-enrols with nothing to remember.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

/** TypeScript trees scanned for backward-looking `//` and block comments. */
const TS_ROOTS = [join(REPO_ROOT, "src"), join(REPO_ROOT, "scripts")];

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

/** One comment unit: a `//` run or a block comment, with its start line. */
interface CommentUnit {
  startLine: number;
  lines: string[];
}

/**
 * Pull the comment units out of TypeScript source, skipping string and template
 * bodies so a `//` inside `"https://…"` (or `/*` inside a string) is never read
 * as a comment. A block comment yields one unit carrying its physical lines, so
 * a single suppression annotation covers the whole block.
 */
export function extractComments(src: string): CommentUnit[] {
  const out: CommentUnit[] = [];
  let i = 0;
  let line = 1;
  let startLine = 1;
  let lines: string[] = [];
  let buf = "";
  const n = src.length;
  type State = "code" | "line" | "block" | "single" | "double" | "template";
  let state: State = "code";
  const pushLine = () => {
    lines.push(buf);
    buf = "";
  };
  const emit = () => {
    if (lines.some((l) => l.trim().length > 0)) out.push({ startLine, lines });
    lines = [];
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") {
        state = "line";
        startLine = line;
        buf = "";
        lines = [];
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        state = "block";
        startLine = line;
        buf = "";
        lines = [];
        i += 2;
        continue;
      }
      if (c === '"') {
        state = "double";
        i++;
        continue;
      }
      if (c === "'") {
        state = "single";
        i++;
        continue;
      }
      if (c === "`") {
        state = "template";
        i++;
        continue;
      }
      if (c === "\n") line++;
      i++;
      continue;
    }
    if (state === "line") {
      if (c === "\n") {
        pushLine();
        line++;
        // Coalesce a run of consecutive `//` lines into one unit so a marker
        // that wraps across the break still reads as running prose.
        let j = i + 1;
        while (j < n && (src[j] === " " || src[j] === "\t")) j++;
        if (src[j] === "/" && src[j + 1] === "/") {
          i = j + 2;
          continue;
        }
        emit();
        state = "code";
        i++;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (state === "block") {
      if (c === "*" && d === "/") {
        pushLine();
        emit();
        state = "code";
        i += 2;
        continue;
      }
      if (c === "\n") {
        pushLine();
        line++;
        i++;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    // string / template states: consume until the matching quote, honouring escapes
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (state === "double" && c === '"') {
      state = "code";
      i++;
      continue;
    }
    if (state === "single" && c === "'") {
      state = "code";
      i++;
      continue;
    }
    if (state === "template" && c === "`") {
      state = "code";
      i++;
      continue;
    }
    if (c === "\n") line++;
    i++;
  }
  if (state === "line" || state === "block") {
    pushLine();
    emit();
  }
  return out;
}

/** True when a comment unit carries a non-empty suppression annotation. */
function isSuppressed(unit: CommentUnit): boolean {
  return unit.lines.some((l) => {
    const at = l.toLowerCase().indexOf(SUPPRESS);
    return at !== -1 && l.slice(at + SUPPRESS.length).trim().length > 0;
  });
}

export interface CommentViolation {
  line: number;
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

/**
 * Every backward-looking, un-suppressed comment line across a set of comment
 * units. A marker is caught whether it sits on one line or wraps across a line
 * break (`Mirrors\n * the shell …`), and is reported where it begins.
 */
export function scanUnits(units: CommentUnit[]): CommentViolation[] {
  const out: CommentViolation[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    if (isSuppressed(unit)) continue;
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
          marker: m.source,
          text: (intra ? here : pair).trim(),
        });
      }
    }
  }
  return out;
}

/** Backward-looking comments in TypeScript source (`//` and block comments). */
export function scanSource(src: string): CommentViolation[] {
  return scanUnits(extractComments(src));
}

/** Backward-looking comments in a `#`-commented config file. */
export function scanHashSource(src: string): CommentViolation[] {
  return scanUnits(extractHashComments(src));
}

Deno.test("comments describe current behaviour, not the codebase's past", async () => {
  const offenders: string[] = [];
  for (const root of TS_ROOTS) {
    for await (
      const entry of walk(root, { includeDirs: false, exts: [".ts"] })
    ) {
      const rel = relative(REPO_ROOT, entry.path);
      for (const v of scanSource(await Deno.readTextFile(entry.path))) {
        offenders.push(`${rel}:${v.line}  [${v.marker}]  ${v.text}`);
      }
    }
  }
  for (const rel of HASH_FILES) {
    const src = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const v of scanHashSource(src)) {
      offenders.push(`${rel}:${v.line}  [${v.marker}]  ${v.text}`);
    }
  }
  assertEquals(
    offenders,
    [],
    `backward-looking comment(s) found — describe what the code does now, move ` +
      `history to docs/ADRs, or annotate "${SUPPRESS} <reason>" if the ` +
      `reference is genuinely load-bearing.\n\n` +
      `This guard scans src/, scripts/, and the shipped config (discern.toml*, ` +
      `the gitignore fragment) — NOT docs/, tests/, or templates/ prose. If this ` +
      `change wrote the same backward-looking phrasing into one of those, the ` +
      `guard can't see it: fix those by hand in the same sweep.\n\n  ` +
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

Deno.test("suppression without a reason does NOT exempt", () => {
  const src = `// it used to be eager. discern-allow-retrospective:\n`;
  assertEquals(scanSource(src).length, 1);
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
