/**
 * Scanners behind the map's integrity guards: the links a rendered page
 * carries, the heading anchors it exposes, the fenced `discern …` examples it
 * quotes, the skill citations it recommends, and the validation of one such
 * example against the live command model. The shipped gate preflight
 * (map_integrity.ts) applies them to every project's map and instructions; the
 * gate tests (tests/docs_integrity_test.ts, tests/map_integrity_test.ts)
 * prove they bite and hold this repo's own corpus to them.
 *
 * Links and anchors are read off {@link renderMarkdownHtml}, the React-free
 * website renderer whose link and heading contracts the guard protects. A link
 * inside a code span or an HTML comment is not a link, and an anchor is
 * precisely the id the browser stamps on the heading. Source line numbers are
 * recovered afterwards, best-effort, for readable diagnostics.
 */

import { parseFrontmatter } from "./frontmatter.ts";
import { renderMarkdownHtml } from "./markdown.ts";
import type { CliCommand } from "../shared/cli_reference_codegen.ts";
import {
  IMPLICIT_COMMAND_FLAGS,
  IMPLICIT_ROOT_FLAGS,
} from "../shared/cli_reference_codegen.ts";

/** One link target a rendered doc carries. `line` is the 1-based source line
 * (0 when the occurrence cannot be located, e.g. a wrapped autolink). */
export interface DocLinkRef {
  target: string;
  line: number;
}

/** The inverse of the renderer's HTML escaping, applied to extracted hrefs. */
function unescapeHtml(text: string): string {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Assign a source line to each extracted occurrence of `needle`, in order. */
function occurrenceLines(source: string, needle: string): number[] {
  const lines: number[] = [];
  source.split("\n").forEach((text, idx) => {
    for (let at = text.indexOf(needle); at !== -1;) {
      lines.push(idx + 1);
      at = text.indexOf(needle, at + 1);
    }
  });
  return lines;
}

/**
 * Every link target the rendered browser page carries, in document order.
 * Driven off the website renderer, so only real links count — `[x](y)` inside a fenced
 * block, a code span, or a comment never surfaces here, exactly as it never
 * surfaces to a reader.
 */
export function extractDocLinks(md: string): DocLinkRef[] {
  const { body } = parseFrontmatter(md);
  const { html } = renderMarkdownHtml(body);
  const targets: string[] = [];
  for (const m of html.matchAll(/<a href="([^"]*)">/g)) {
    targets.push(unescapeHtml(m[1] ?? ""));
  }
  // Recover source lines: the nth extraction of a target maps to its nth
  // occurrence in the source text.
  const seen = new Map<string, number>();
  return targets.map((target) => {
    const nth = seen.get(target) ?? 0;
    seen.set(target, nth + 1);
    return { target, line: occurrenceLines(md, target)[nth] ?? 0 };
  });
}

/** The heading anchor ids a doc exposes — precisely the ids the renderer
 * stamps, duplicate-suffixing included. */
export function headingAnchors(md: string): Set<string> {
  const { body } = parseFrontmatter(md);
  return new Set(renderMarkdownHtml(body).headings.map((h) => h.id));
}

/** One fenced `discern …` example, with its 1-based source line. */
export interface FencedCommand {
  line: number;
  command: string;
}

/** One fenced code block, as the renderer sees it. */
export interface FencedBlock {
  /** The info string after the opening marker, trimmed (empty when absent). */
  info: string;
  /** 1-based source line of the block's FIRST body line. */
  startLine: number;
  /** The body lines, verbatim — the fence markers themselves excluded. */
  lines: string[];
}

/**
 * Every fenced code block in a doc (the fence grammar mirrors the renderer's:
 * a ``` or ~~~ opener, closed by a matching marker; an unclosed fence runs to
 * the end of the document).
 */
export function fencedBlocks(md: string): FencedBlock[] {
  const out: FencedBlock[] = [];
  const lines = md.split("\n");
  let fence: string | undefined;
  let block: FencedBlock | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const open = line.match(/^\s*(```|~~~)/)?.[1];
    if (fence === undefined || block === undefined) {
      if (open !== undefined) {
        fence = open;
        block = {
          info: line.trim().slice(open.length).trim(),
          startLine: i + 2,
          lines: [],
        };
      }
      continue;
    }
    if (open !== undefined && line.trim().startsWith(fence)) {
      out.push(block);
      fence = undefined;
      block = undefined;
      continue;
    }
    block.lines.push(line);
  }
  if (block !== undefined) out.push(block);
  return out;
}

/** A line inside a fenced block that IS a `discern` invocation (an optional
 * `$ ` shell prefix, then the word). Output transcripts quoting discern mid-line
 * don't match. */
const COMMAND_LINE = /^\s*(?:\$\s+)?(discern(?:\s.*)?)$/;

/**
 * Every fenced `discern …` command in a doc, fence-aware (via
 * {@link fencedBlocks}) and `\`-continuation-aware. Anything else in a block
 * — output lines, other tools — is left alone.
 */
export function extractFencedCommands(md: string): FencedCommand[] {
  const out: FencedCommand[] = [];
  for (const block of fencedBlocks(md)) {
    for (let i = 0; i < block.lines.length; i += 1) {
      const command = (block.lines[i] ?? "").match(COMMAND_LINE)?.[1];
      if (command === undefined) continue;
      const startLine = block.startLine + i;
      let joined = command;
      while (joined.endsWith("\\") && i + 1 < block.lines.length) {
        i += 1;
        joined = `${joined.slice(0, -1).trimEnd()} ${
          (block.lines[i] ?? "").trim()
        }`;
      }
      out.push({ line: startLine, command: joined.trim() });
    }
  }
  return out;
}

/** The citation grammar core: `discern-` then two or more lowercase segments
 * (the bundled naming convention — imperative verb + object). A single-segment
 * token (`discern-results`, an artifact filename) is a spelling, never a
 * citation. The ONE definition every citation scan derives its regex from. */
const SKILL_CITATION_CORE = "discern-[a-z]+(?:-[a-z]+)+";

/** A whole token matching the citation grammar — the span form. */
export const SKILL_CITATION_TOKEN: RegExp = new RegExp(
  `^${SKILL_CITATION_CORE}$`,
);

/** The citation grammar loose in running text, for bare-token sweeps. The
 * lookbehind drops tokens reached mid-word: dotfile/path/scoped-package
 * namespaces (`.discern-bundled-docs`, `/tmp/discern-job-lint.log`) and
 * slug fragments (`0119-bare-discern-opens-…`) are spellings, not citations. */
export const SKILL_CITATION_BARE: RegExp = new RegExp(
  `(?<![\\w@/.-])${SKILL_CITATION_CORE}\\b`,
  "g",
);

/** One skill citation a doc carries, with its 1-based source line. */
export interface SkillCitationRef {
  line: number;
  name: string;
}

/**
 * Every skill CITATION in a doc: an inline code span consisting solely of one
 * citation-shaped token (`` `discern-<verb>-<object>` `` — the convention
 * every bundled surface uses to recommend a skill by name), outside fenced
 * blocks. Deliberately precision-first for arbitrary prose: a span carrying
 * more than the bare token (`` `discern-marker: <reason>` ``), a token inside
 * a fenced example, and an unbackticked mention are all left alone — a false
 * "unknown skill" on a project's own vocabulary would be worse than a missed
 * citation.
 */
export function extractSkillCitations(md: string): SkillCitationRef[] {
  const fencedLines = new Set<number>();
  for (const block of fencedBlocks(md)) {
    for (let i = 0; i < block.lines.length; i += 1) {
      fencedLines.add(block.startLine + i);
    }
  }
  const out: SkillCitationRef[] = [];
  md.split("\n").forEach((text, idx) => {
    if (fencedLines.has(idx + 1)) return;
    for (const m of text.matchAll(/`([^`\r\n]+)`/g)) {
      const span = (m[1] ?? "").trim();
      if (SKILL_CITATION_TOKEN.test(span)) {
        out.push({ line: idx + 1, name: span });
      }
    }
  });
  return out;
}

/** Split a command line into shell-ish words (quote-aware; quotes dropped). */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  for (
    const m of command.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)
  ) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

/** A `<placeholder>` (or ellipsis) standing in for a real value in an example. */
function isPlaceholder(token: string): boolean {
  return token.includes("<") || token === "..." || token === "…";
}

/** A shell operator that ends the `discern` invocation on the line. */
function isTerminator(token: string): boolean {
  return token === "&&" || token === "||" || token === ";" || token === "|" ||
    token.startsWith("#");
}

/** The flag spellings `node` accepts: its declared options (inherited globals
 * included — Cliffy resolves them per command) plus the implicit help flags,
 * and the version flags at the root. */
function acceptedFlags(node: CliCommand, isRoot: boolean): Set<string> {
  const flags = new Set(node.options.flatMap((o) => o.flags));
  for (const f of IMPLICIT_COMMAND_FLAGS) flags.add(f);
  if (isRoot) { for (const f of IMPLICIT_ROOT_FLAGS) flags.add(f); }
  return flags;
}

/**
 * Validate one fenced `discern …` example against the live command model:
 * the verb path must exist (aliases count), and every `--flag` token must be a
 * flag that command declares. Returns the failure reason, or undefined when
 * the example is valid.
 *
 * Documentation conventions are honoured, not flagged: `<placeholders>` are
 * skipped (a placeholder in verb position skips the whole line), `[optional]`
 * brackets and `a|b` alternations are unwrapped before flags are checked, `--`
 * ends flag scanning, and a shell operator (`&&`, `|`, `#`, …) ends the
 * invocation. `extraVerbs` admits project-script names, which dispatch as
 * first-class verbs.
 */
export function validateFencedCommand(
  command: string,
  root: CliCommand,
  extraVerbs: ReadonlySet<string> = new Set(),
): string | undefined {
  const tokens = tokenize(command);
  if (tokens[0] !== "discern") return undefined;

  // Walk the subcommand path.
  let node = root;
  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i] ?? "";
    if (isTerminator(token)) return undefined;
    if (isPlaceholder(token)) {
      // A placeholder verb (`discern <command>`) makes the line a template,
      // not an example — nothing to validate.
      if (node === root) return undefined;
      break;
    }
    if (token.startsWith("-")) break;
    const child = node.children.find((c) =>
      c.path.at(-1) === token || c.aliases.includes(token)
    );
    if (child !== undefined) {
      node = child;
      i += 1;
      continue;
    }
    if (node === root) {
      if (extraVerbs.has(token)) return undefined;
      return `unknown command "discern ${token}"`;
    }
    // A command-shaped word aimed at a pure command GROUP (subcommands, no
    // positionals) can only be a stale subcommand. Anything else — a value
    // for a declared positional, a glob, prose flow — ends the walk.
    if (
      /^[a-z][a-z0-9_-]*$/.test(token) && node.children.length > 0 &&
      node.args.length === 0
    ) {
      return `"discern ${node.path.join(" ")}" has no subcommand "${token}"`;
    }
    break; // a positional argument value — flags may still follow
  }

  // Validate every flag token against the resolved command.
  const accepted = acceptedFlags(node, node === root);
  for (; i < tokens.length; i += 1) {
    const token = tokens[i] ?? "";
    if (isTerminator(token)) break;
    if (token === "--") break;
    // Unwrap `[--optional <v>]` brackets and `--a|--b` alternations.
    for (const piece of token.replace(/^\[+|\]+$/g, "").split("|")) {
      if (!/^--?[A-Za-z]/.test(piece)) continue;
      const name = piece.split("=", 1)[0] ?? piece;
      if (isPlaceholder(name)) continue;
      if (!accepted.has(name)) {
        const at = node.path.length === 0
          ? "discern"
          : `discern ${node.path.join(" ")}`;
        return `"${at}" has no flag "${name}"`;
      }
    }
  }
  return undefined;
}
