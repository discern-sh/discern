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
 * The replacement: keep the citation, move it to a code comment beside the
 * string (or to `docs/`), and let the shipped copy carry only the explanation
 * users can act on.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");
const TEMPLATES = join(REPO_ROOT, "templates");
const MAP = join(REPO_ROOT, "map");
const ADRS = join(MAP, "_adr");
const MOCKUPS = join(REPO_ROOT, "mockups");
const RECIPES = join(REPO_ROOT, "recipes");
const SKILLS = join(REPO_ROOT, "skills");
const TEMPLATE_FIXTURES = join(REPO_ROOT, "tests", "fixtures", "templates");

/** A numbered citation of an internal decision: "ADR 0034", "adr-12", "ADR0101". */
const ADR_CITATION = /\bADR[\s-]?\d+/gi;
/** A numbered ADR file path; the shipped skeleton's 0000-template is the one legal number. */
const ADR_PATH = /_adr\/(?!0000-template)\d/gi;
/** Retired product-category wording; one README category phrase remains searchable. */
const HARNESS_WORD = /\bharness(?:es|ing)?\b/gi;
/** Retired human-facing name for the shared branch; user copy calls it the trunk. */
const INTEGRATION_BRANCH = /\bintegration branch\b/gi;
/** Callable/config/artifact pointers that are legal only in reviewed history. */
const RETIRED_ADR_POINTER =
  /\b(?:discern|agent)[ _](?:finish|graduate|integrate|scopes|docs|improve|ratchets)\b|\[(?:ratchets|docs)(?:\.|\])|\$\{docs\.|\bsetup land\b|discern-gate-pass|(?<!DISCERN_)\bMAIN_BRANCH\b|# --- \/?discern harness ---|\b[Qq]uality [Rr]atchet\b|\b[Rr]atchet feature\b|\b[Tt]he harness\b|\b[Hh]arness's\b/g;
const RETIRED_ACTIVE_ADR_PATH =
  /(?:-ratchets?|-graduate|-integrate|-improve-|docs-browser|setup-land|doctree)/i;
const ADR_0120_AMENDMENT =
  "Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md))";

type Literal = { text: string; line: number };

/**
 * Extract every string-literal chunk from TypeScript source, with the line it
 * starts on. Skips line and block comments; descends into template-literal
 * interpolations (whose code can itself hold strings and comments); consumes
 * regex literals so a quote inside one (e.g. `/["']/`) can't desync the scan.
 */
function stringLiterals(source: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let line = 1;
  const n = source.length;

  if (source.startsWith("#!")) {
    while (i < n && source.charAt(i) !== "\n") i++;
  }

  /** The last non-whitespace char seen in code position, for the regex/division call. */
  let prev = "";
  /** Template-interpolation nesting: brace depth per open `${ … }` frame. */
  const frames: number[] = [];

  const step = (): void => {
    if (source.charAt(i) === "\n") line++;
    i++;
  };

  const consumeQuoted = (quote: string): void => {
    const start = line;
    step(); // opening quote
    let text = "";
    while (i < n) {
      const ch = source.charAt(i);
      if (ch === "\\") {
        step();
        if (i < n) {
          text += source.charAt(i);
          step();
        }
        continue;
      }
      if (ch === quote) {
        step();
        break;
      }
      if (ch === "\n" && quote !== "`") break; // unterminated — bail on the line
      if (quote === "`" && ch === "$" && source.charAt(i + 1) === "{") {
        out.push({ text, line: start });
        text = "";
        step();
        step();
        frames.push(0);
        scan(); // interpolation code runs until its `}` pops the frame
        continue;
      }
      text += ch;
      step();
    }
    out.push({ text, line: start });
    prev = quote; // a closed literal is an operand — `/` after it is division
  };

  const consumeRegex = (): void => {
    step(); // opening slash
    let inClass = false;
    while (i < n) {
      const ch = source.charAt(i);
      if (ch === "\\") {
        step();
        step();
        continue;
      }
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) {
        step();
        break;
      } else if (ch === "\n") break; // not a regex after all — resync
      step();
    }
    prev = "/";
  };

  /** True when a `/` here starts a regex literal rather than division. */
  const regexPosition = (): boolean =>
    prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev);

  const scan = (): void => {
    const frame = frames.length - 1;
    while (i < n) {
      const ch = source.charAt(i);
      if (ch === "/" && source.charAt(i + 1) === "/") {
        while (i < n && source.charAt(i) !== "\n") i++;
        continue;
      }
      if (ch === "/" && source.charAt(i + 1) === "*") {
        step();
        step();
        while (
          i < n && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")
        ) step();
        step();
        step();
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        consumeQuoted(ch);
        continue;
      }
      if (ch === "/" && regexPosition()) {
        consumeRegex();
        continue;
      }
      if (frame >= 0) {
        if (ch === "{") frames[frame] = (frames[frame] ?? 0) + 1;
        if (ch === "}") {
          if ((frames[frame] ?? 0) === 0) {
            frames.pop();
            step();
            return; // interpolation over — back to the template literal
          }
          frames[frame] = (frames[frame] ?? 0) - 1;
        }
      }
      if (!/\s/.test(ch)) prev = ch;
      step();
    }
  };

  scan();
  return out;
}

function citationsIn(text: string): string[] {
  return [
    ...(text.match(ADR_CITATION) ?? []),
    ...(text.match(ADR_PATH) ?? []),
  ];
}

/** Visible Markdown text: link destinations are addresses, not rendered prose. */
function visibleMarkdown(text: string): string {
  return text.replace(/\]\([^)]*\)/g, "]");
}

/** Human-readable line findings for a retired word in a text artifact. */
function harnessLines(rel: string, text: string): string[] {
  const findings: string[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    const hits = line.match(HARNESS_WORD) ?? [];
    for (const hit of hits) {
      findings.push(`${rel}:${index + 1} contains "${hit}"`);
    }
  }
  return findings;
}

/** Human-readable line findings for the retired shared-branch label. */
function integrationBranchLines(rel: string, text: string): string[] {
  const findings: string[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    for (const hit of line.match(INTEGRATION_BRANCH) ?? []) {
      findings.push(`${rel}:${index + 1} contains "${hit}"`);
    }
  }
  return findings;
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
    for (const hit of citationsIn(text)) {
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

Deno.test("user-facing source strings never use the retired harness category", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })
  ) {
    const source = await Deno.readTextFile(entry.path);
    const rel = relative(REPO_ROOT, entry.path);
    for (const { text, line } of stringLiterals(source)) {
      for (const hit of text.match(HARNESS_WORD) ?? []) {
        offenders.push(`${rel}:${line} string contains "${hit}"`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `retired harness wording leaked into a user-facing source string:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("shipped templates, template fixtures, skills, recipes, and public map prose never use the retired harness category", async () => {
  const offenders: string[] = [];
  for (
    const root of [TEMPLATES, TEMPLATE_FIXTURES, SKILLS, RECIPES, MAP]
  ) {
    for await (const entry of walk(root, { includeDirs: false })) {
      const rel = relative(REPO_ROOT, entry.path);
      if (
        rel.startsWith("map/_adr/") || rel.startsWith("map/_private/")
      ) continue;
      let contents: string;
      try {
        contents = await Deno.readTextFile(entry.path);
      } catch {
        continue;
      }
      offenders.push(...harnessLines(rel, visibleMarkdown(contents)));
    }
  }
  assertEquals(
    offenders,
    [],
    `retired harness wording leaked into shipped or public map prose:\n  ${
      offenders.join("\n  ")
    }`,
  );
});

Deno.test("root guidance, config, and landing mockups retire harness; README keeps one category phrase", async () => {
  const offenders: string[] = [];
  for (const rel of ["CONTRIBUTING.md", "guidance.md", "discern.toml"]) {
    offenders.push(
      ...harnessLines(
        rel,
        visibleMarkdown(await Deno.readTextFile(join(REPO_ROOT, rel))),
      ),
    );
  }
  for await (const entry of walk(MOCKUPS, { includeDirs: false })) {
    const rel = relative(REPO_ROOT, entry.path);
    offenders.push(...harnessLines(rel, await Deno.readTextFile(entry.path)));
  }
  assertEquals(
    offenders,
    [],
    `retired harness wording leaked outside the README category exception:\n  ${
      offenders.join("\n  ")
    }`,
  );

  const readme = visibleMarkdown(
    await Deno.readTextFile(join(REPO_ROOT, "README.md")),
  );
  assertEquals(
    readme.match(HARNESS_WORD) ?? [],
    ["harness"],
    "README.md keeps exactly one searchable category use",
  );
  assert(
    /\bquality harness\b/i.test(readme),
    'README.md\'s sole category use must read "quality harness"',
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

Deno.test("user-facing output consistently calls the shared branch the trunk", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })
  ) {
    const source = await Deno.readTextFile(entry.path);
    const rel = relative(REPO_ROOT, entry.path);
    for (const { text, line } of stringLiterals(source)) {
      for (const hit of text.match(INTEGRATION_BRANCH) ?? []) {
        offenders.push(`${rel}:${line} string contains "${hit}"`);
      }
    }
  }

  for (const root of [TEMPLATES, RECIPES, MAP, MOCKUPS]) {
    for await (const entry of walk(root, { includeDirs: false })) {
      const rel = relative(REPO_ROOT, entry.path);
      if (rel.startsWith("map/_adr/") || rel.startsWith("map/_private/")) {
        continue;
      }
      let contents: string;
      try {
        contents = await Deno.readTextFile(entry.path);
      } catch {
        continue;
      }
      offenders.push(
        ...integrationBranchLines(rel, visibleMarkdown(contents)),
      );
    }
  }

  for (
    const rel of [
      "README.md",
      "CONTRIBUTING.md",
      "guidance.md",
      "discern.toml",
    ]
  ) {
    offenders.push(
      ...integrationBranchLines(
        rel,
        visibleMarkdown(await Deno.readTextFile(join(REPO_ROOT, rel))),
      ),
    );
  }

  assertEquals(
    offenders,
    [],
    `retired shared-branch wording leaked into user-facing output:\n  ${
      offenders.join("\n  ")
    }`,
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

Deno.test("adr guard: template interpolation and regex hazards don't desync the lexer", () => {
  const tricky =
    "const re = /[\"`]/; const t = `x ${a ? `${b}` : '(ADR 0042)'} y`;";
  const hits = stringLiterals(tricky).flatMap((l) => citationsIn(l.text));
  assert(hits.includes("ADR 0042"), `expected the nested leak, got: ${hits}`);
});
