/**
 * Shared scanners for the repository's vocabulary guards: the string-literal
 * lexer that isolates user-facing copy inside TypeScript source, the
 * visible-Markdown filter, and the line-finder the retired-phrase scans
 * report through. Consumed by `adr_vocab_guard_test.ts` (ADR-citation law)
 * and `vocab_drift_test.ts` (registry-driven retired vocabulary).
 */

export { runningMarkdownProse } from "../scripts/markdown_prose.ts";

export type Literal = { text: string; line: number };

/**
 * Extract every string-literal chunk from TypeScript source, with the line it
 * starts on. Skips line and block comments; descends into template-literal
 * interpolations (whose code can itself hold strings and comments); consumes
 * regex literals so a quote inside one (e.g. `/["']/`) can't desync the scan.
 */
export function stringLiterals(source: string): Literal[] {
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

/** Visible Markdown text: link destinations are addresses, not rendered prose. */
export function visibleMarkdown(text: string): string {
  return text.replace(/\]\([^)]*\)/g, "]");
}

/**
 * Human-readable line findings for a banned pattern in a text artifact. Scans
 * the whole text, not line by line, so a phrase wrapped across a line break
 * still matches; findings carry the line the match starts on, with the hit's
 * whitespace collapsed for display.
 */
export function bannedPhraseLines(
  rel: string,
  text: string,
  pattern: RegExp,
): string[] {
  const findings: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const line = text.slice(0, match.index).split("\n").length;
    const hit = match[0].replace(/\s+/g, " ");
    findings.push(`${rel}:${line} contains "${hit}"`);
  }
  return findings;
}
