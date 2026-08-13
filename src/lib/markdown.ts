/**
 * A small, dependency-light Markdown → terminal renderer.
 *
 * The map tree discern scaffolds is CommonMark-ish prose: headings, paragraphs,
 * fenced code, lists, blockquotes, GFM tables, and inline emphasis / code /
 * links. This module renders that subset to a styled string for a terminal — it
 * is deliberately NOT a spec-complete parser. The goal is a *readable* viewer
 * for `discern map`, not round-trip fidelity.
 *
 * Two design choices matter:
 *
 *  - **Wrapping is computed on plain text, styling is applied after.** Inline
 *    parsing yields styleless segments; those flatten to a styled-character
 *    stream that is word-wrapped on visible width (no ANSI in the measurement),
 *    and only then painted. So coloured output and `--no-color` output wrap
 *    identically, and a link's escape codes never throw off a line length.
 *  - **Underscores are treated conservatively.** These docs are full of
 *    `snake_case` identifiers (`main_branch`, `schema_version`). A naive
 *    `_emphasis_` parser would mangle them, so `_`/`__` only open/close on word
 *    boundaries (CommonMark's flanking rule), and inline code is parsed first so
 *    anything in backticks is never reinterpreted.
 *
 * The single entry point is {@link renderMarkdown}. Everything else is private.
 */

import {
  renderCodeListingCli,
  renderDividerCli,
  renderHeadingCli,
  renderTableCli,
  type TerminalTextStyle,
} from "discern-design-system/cli";
import {
  type TerminalContext,
  terminalContextWithColor,
  terminalPresentationContext,
} from "./terminal.ts";
import { displayWidth, wrapText } from "./text.ts";

/** How to render: wrap width and whether to emit ANSI styling. */
export interface RenderOptions {
  /** Column width to wrap prose to. Clamped to a sane minimum. Default 80. */
  width?: number;
  /** Apply ANSI colour/style. When false, output is clean plain text. */
  color?: boolean;
  /** Explicit package presentation facts supplied by the command boundary. */
  terminal?: TerminalContext;
}

/** The style flags an inline span can carry. `href` makes the span a link. */
interface Style {
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  strike?: boolean | undefined;
  code?: boolean | undefined;
  href?: string | undefined;
}

/** A run of text with one uniform style. */
interface Seg extends Style {
  text: string;
}

/** OSC-8 terminal hyperlink: clickable in modern terminals, inert elsewhere. */
function osc8(url: string, text: string): string {
  const ESC = "\x1b";
  return `${ESC}]8;;${url}${ESC}\\${text}${ESC}]8;;${ESC}\\`;
}

/** True for an ASCII alphanumeric — `snake_case` uses it to keep `_` out. */
function isAlnum(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

/** ASCII punctuation that a backslash may escape (CommonMark's set, abridged). */
function isEscapable(ch: string | undefined): boolean {
  return ch !== undefined && /[\\`*_{}\[\]()#+\-.!~>|]/.test(ch);
}

// ── inline parsing ─────────────────────────────────────────────────────────

/**
 * Parse one logical line of inline Markdown into styled segments. `base` carries
 * the enclosing style inward, so emphasis and links nest (a bold link keeps both
 * flags). Code spans are matched first and never reparsed, so `` `a_b` `` stays
 * literal.
 */
function parseInline(src: string, base: Style = {}): Seg[] {
  const out: Seg[] = [];
  let plain = "";
  let i = 0;

  const flush = () => {
    if (plain) {
      out.push({ ...base, text: plain });
      plain = "";
    }
  };

  while (i < src.length) {
    const c = src[i];

    // Backslash escape: the next punctuation char is taken literally.
    if (c === "\\" && i + 1 < src.length && isEscapable(src[i + 1])) {
      plain += src[i + 1];
      i += 2;
      continue;
    }

    // Inline code span: a run of N backticks closed by the next run of N.
    if (c === "`") {
      let n = 0;
      while (src[i + n] === "`") n++;
      const close = src.indexOf("`".repeat(n), i + n);
      const runsOn = src[close + n] === "`"; // longer run — not our closer
      if (close !== -1 && !runsOn) {
        flush();
        let code = src.slice(i + n, close);
        // CommonMark: strip one space each side when both are present.
        if (code.startsWith(" ") && code.endsWith(" ") && code.trim() !== "") {
          code = code.slice(1, -1);
        }
        out.push({ ...base, code: true, text: code });
        i = close + n;
        continue;
      }
    }

    // Image: render the alt text only (terminals can't show the image).
    if (c === "!" && src[i + 1] === "[") {
      const m = matchLink(src, i + 1);
      if (m) {
        flush();
        out.push(...parseInline(m.text, base));
        i = i + 1 + m.length;
        continue;
      }
    }

    // Link: [text](href). The text is parsed inline with href threaded in.
    if (c === "[") {
      const m = matchLink(src, i);
      if (m) {
        flush();
        out.push(...parseInline(m.text, { ...base, href: m.href }));
        i += m.length;
        continue;
      }
    }

    // Autolink: <https://…>.
    if (c === "<") {
      const close = src.indexOf(">", i + 1);
      if (close !== -1) {
        const url = src.slice(i + 1, close);
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^mailto:/i.test(url)) {
          flush();
          out.push({ ...base, href: url, text: url });
          i = close + 1;
          continue;
        }
      }
    }

    // Strikethrough: ~~text~~.
    if (c === "~" && src[i + 1] === "~") {
      const close = findClose(src, i + 2, "~~");
      if (close !== -1) {
        flush();
        out.push(
          ...parseInline(src.slice(i + 2, close), { ...base, strike: true }),
        );
        i = close + 2;
        continue;
      }
    }

    // Strong / emphasis with * or _. Underscore obeys the word-boundary rule so
    // identifiers survive; both obey simple flanking (no space just inside).
    if (c === "*" || c === "_") {
      const double = src[i + 1] === c;
      const len = double ? 2 : 1;
      const close = findEmphasis(src, i, c, len);
      if (close !== -1) {
        flush();
        const inner = src.slice(i + len, close);
        const style = double ? { bold: true } : { italic: true };
        out.push(...parseInline(inner, { ...base, ...style }));
        i = close + len;
        continue;
      }
    }

    plain += c;
    i++;
  }

  flush();
  return out;
}

/** Locate `[text](href)` at `start`; returns its parts and total length. */
function matchLink(
  src: string,
  start: number,
): { text: string; href: string; length: number } | undefined {
  if (src[start] !== "[") return undefined;
  // Find the matching ] allowing one level of nested brackets in the label.
  let depth = 0;
  let j = start;
  for (; j < src.length; j++) {
    if (src[j] === "[") depth++;
    else if (src[j] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (j >= src.length || src[j + 1] !== "(") return undefined;
  const close = src.indexOf(")", j + 2);
  if (close === -1) return undefined;
  const text = src.slice(start + 1, j);
  // A link target may carry a "title" after the URL: (url "title"). Drop it.
  const target = src.slice(j + 2, close).trim();
  const href = target.split(/\s+/, 1)[0] ?? target;
  return { text, href, length: close + 1 - start };
}

/** Index of the next literal `marker` at or after `from`, else -1. */
function findClose(src: string, from: number, marker: string): number {
  const idx = src.indexOf(marker, from);
  return idx;
}

/**
 * Find the closing run for an emphasis span opened at `open` with `len` copies
 * of `marker`. Enforces: the opener is not followed by whitespace; the closer is
 * not preceded by whitespace; and for `_`, neither boundary sits inside a word.
 */
function findEmphasis(
  src: string,
  open: number,
  marker: string,
  len: number,
): number {
  const after = src[open + len];
  if (after === undefined || /\s/.test(after)) return -1;
  if (marker === "_" && isAlnum(src[open - 1])) return -1;

  let j = open + len;
  while (j < src.length) {
    if (
      src[j] === marker &&
      src.slice(j, j + len) === marker.repeat(len) &&
      src[j + len] !== marker
    ) {
      const before = src[j - 1];
      const wordInside = marker === "_" && isAlnum(src[j + len]);
      if (before !== undefined && !/\s/.test(before) && !wordInside) {
        return j;
      }
    }
    j++;
  }
  return -1;
}

// ── styling ──────────────────────────────────────────────────────────────--

/** True when two styles are identical across every field (for run-merging). */
function sameStyle(a: Style, b: Style): boolean {
  return a.bold === b.bold && a.italic === b.italic &&
    a.strike === b.strike && a.code === b.code && a.href === b.href;
}

/** Paint one uniformly-styled run from package Token facts. */
function styleRun(
  text: string,
  style: Style,
  terminal: TerminalContext,
): string {
  if (!terminal.color) {
    // Keep just enough markup that structure survives without colour.
    if (style.code) return `\`${text}\``;
    return text;
  }
  const tokenStyle: TerminalTextStyle = {
    ...(style.code ? terminal.theme.typography.annotation : {}),
    ...(style.bold === true ? { bold: true } : {}),
    ...(style.italic === true ? { italic: true } : {}),
    ...(style.strike === true ? { strikethrough: true } : {}),
    ...(style.href === undefined ? {} : {
      underline: true,
      color: terminal.themeColor("--discern-color-accent-700"),
    }),
    ...(style.code !== true ? {} : {
      color: terminal.themeColor("--discern-color-warning-deep"),
    }),
  };
  const painted = terminal.style(text, tokenStyle);
  return style.href === undefined ? painted : osc8(style.href, painted);
}

/**
 * In plain mode a link can't be clickable, so append its URL once — after the
 * whole link, not per styled run. Returns segments with `href` cleared and a
 * trailing `(url)` inserted at each link's end.
 */
function annotateLinksForPlain(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const [i, seg] of segs.entries()) {
    if (!seg.href) {
      out.push(seg);
      continue;
    }
    const href = seg.href;
    out.push({ ...seg, href: undefined });
    const next = segs[i + 1];
    const last = next === undefined || next.href !== href;
    // A bare autolink already shows its URL; don't echo it twice.
    if (last && seg.text !== href) out.push({ text: ` (${href})` });
  }
  return out;
}

// ── wrapping ───────────────────────────────────────────────────────────────

/** Collapse inline whitespace without losing the style of any visible run. */
function normalizedSegments(segments: readonly Seg[]): Seg[] {
  const normalized: Seg[] = [];
  let pendingSpace = false;
  for (const segment of segments) {
    for (const part of segment.text.split(/(\s+)/u)) {
      if (part === "") continue;
      if (/^\s+$/u.test(part)) {
        pendingSpace = normalized.length > 0;
        continue;
      }
      if (pendingSpace) normalized.push({ text: " " });
      normalized.push({ ...segment, text: part });
      pendingSpace = false;
    }
  }
  return normalized;
}

/** Project package-owned plain line breaks back onto the parsed inline styles. */
function wrapSegments(segments: readonly Seg[], width: number): Seg[][] {
  const normalized = normalizedSegments(segments);
  const plain = normalized.map((segment) => segment.text).join("");
  const lines = wrapText(plain, width);
  if (lines.length === 0) return [[]];
  let segmentIndex = 0;
  let segmentOffset = 0;

  const consume = (length: number): Seg[] => {
    const consumed: Seg[] = [];
    let remaining = length;
    while (remaining > 0) {
      const source = normalized[segmentIndex];
      if (source === undefined) {
        throw new TypeError("package wrapping exceeded parsed inline text");
      }
      const available = source.text.length - segmentOffset;
      const take = Math.min(remaining, available);
      consumed.push({
        ...source,
        text: source.text.slice(segmentOffset, segmentOffset + take),
      });
      segmentOffset += take;
      remaining -= take;
      if (segmentOffset === source.text.length) {
        segmentIndex += 1;
        segmentOffset = 0;
      }
    }
    return consumed;
  };
  const nextText = (): string => {
    const source = normalized[segmentIndex];
    return source?.text.slice(segmentOffset) ?? "";
  };

  return lines.map((line, index) => {
    const styled = consume(line.length);
    const renderedPlain = styled.map((segment) => segment.text).join("");
    if (renderedPlain !== line) {
      throw new TypeError("package wrapping changed parsed inline text");
    }
    if (index < lines.length - 1 && nextText().startsWith(" ")) consume(1);
    return styled;
  });
}

/** Paint one package-wrapped line, merging adjacent same-style runs. */
function emitSegments(
  segments: readonly Seg[],
  terminal: TerminalContext,
): string {
  let out = "";
  let k = 0;
  while (k < segments.length) {
    const current = segments[k];
    if (current === undefined) break;
    let m = k;
    while (m < segments.length) {
      const candidate = segments[m];
      if (candidate === undefined || !sameStyle(candidate, current)) break;
      m++;
    }
    const text = segments.slice(k, m).map((segment) => segment.text).join("");
    out += styleRun(text, current, terminal);
    k = m;
  }
  return out;
}

/** Render inline Markdown, wrapped to `width`, each line prefixed with `indent`. */
function renderInlineBlock(
  text: string,
  width: number,
  terminal: TerminalContext,
  indent = "",
  hanging = indent,
): string[] {
  let segs = parseInline(text);
  if (!terminal.color) segs = annotateLinksForPlain(segs);
  const avail = Math.max(1, width - displayWidth(indent));
  const lines = wrapSegments(segs, avail);
  return lines.map((ln, idx) =>
    (idx === 0 ? indent : hanging) + emitSegments(ln, terminal)
  );
}

/** Flatten inline Markdown to plain text (for table cells and titles). */
export function inlineToPlain(text: string): string {
  return parseInline(text).map((s) => s.text).join("");
}

// ── block rendering ──────────────────────────────────────────────────────--

/** A delimiter row like `|---|:--:|` that marks the line above as a table head. */
export function isTableDelimiter(line: string): boolean {
  return /\|/.test(line) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) &&
    /-/.test(line);
}

/** Split a `|`-delimited row into trimmed cells, honouring `\|` escapes — the
 * one definition of a table row's cells, shared by the renderers here and the
 * table-integrity scanner (table_integrity.ts). */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** Render a GFM table through the published width-aware Table Component. */
function renderTable(
  rows: string[][],
  width: number,
  terminal: TerminalContext,
): string[] {
  const visibleCell = (value: string | undefined): string => {
    const plain = inlineToPlain(value ?? "");
    return plain === "" ? " " : plain;
  };
  const header = (rows[0] ?? [""]).map(visibleCell);
  const body = rows.slice(1).map((row) =>
    header.map((_, index) => visibleCell(row[index]))
  );
  const minimumWidth = header.length * 4 + 1;
  const props = width >= minimumWidth
    ? {
      columns: header.map((value) => ({ header: value })),
      rows: body,
      striped: true,
      theme: terminal.themeVariant,
      width,
    }
    : {
      // A terminal too narrow for N framed columns still delegates geometry to
      // Table: project each source row into one labelled column rather than
      // inventing a second local cell-layout algorithm.
      columns: [{ header: header.join(" · ") }],
      rows: body.map((row) => [row.join(" · ")]),
      striped: true,
      theme: terminal.themeVariant,
      width,
    };
  return renderTableCli(props, terminal.capabilities).split("\n");
}

/** Style an ATX heading by level (or keep the `#` markers in plain mode). */
function renderHeading(
  level: number,
  text: string,
  width: number,
  terminal: TerminalContext,
): string[] {
  if (!terminal.color) {
    return ["#".repeat(level) + " " + inlineToPlain(text)];
  }
  const headingLevel = Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6;
  return [renderHeadingCli(
    {
      text: inlineToPlain(text),
      level: headingLevel,
      theme: terminal.themeVariant,
      maxWidth: width,
    },
    terminal.capabilities,
  )];
}

/** Render a fenced code block: a bordered, labelled box (fences kept in plain). */
function renderCode(
  lang: string,
  lines: string[],
  width: number,
  terminal: TerminalContext,
): string[] {
  if (!terminal.color) {
    return ["```" + lang, ...lines, "```"];
  }
  return renderCodeListingCli(
    {
      code: lines.join("\n"),
      ...(lang === "" ? {} : { language: lang }),
      theme: terminal.themeVariant,
      maxWidth: width,
    },
    terminal.capabilities,
  ).split("\n");
}

/** One parsed list item: nesting depth, its marker, and the inline text. */
interface ListItem {
  depth: number;
  marker: string;
  text: string;
}

/** Render a contiguous list block (ordered, unordered, and `[ ]` task items). */
function renderList(
  items: ListItem[],
  width: number,
  terminal: TerminalContext,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    const pad = "  ".repeat(item.depth);
    let bullet = item.marker;
    let text = item.text;
    let completedTask = false;

    // GFM task list: a leading [ ] / [x] becomes a checkbox glyph.
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      const mark = task[1];
      const rest = task[2];
      if (mark !== undefined && rest !== undefined) {
        completedTask = mark.toLowerCase() === "x";
        bullet = completedTask
          ? (terminal.capabilities.unicode ? "☑" : "[x]")
          : (terminal.capabilities.unicode ? "☐" : "[ ]");
        text = rest;
      }
    }
    if (!terminal.capabilities.unicode && bullet === "•") bullet = "-";

    const paintedBullet = terminal.color
      ? (task
        ? (completedTask
          ? terminal.tone(bullet, "success")
          : terminal.role(bullet, "muted"))
        : terminal.tone(bullet, "accent"))
      : bullet;
    const prefix = `${pad}${paintedBullet} `;
    // The hanging indent aligns continuation lines under the text, not the
    // bullet — measured on the *visible* prefix width, ignoring colour.
    const visiblePrefixLen = displayWidth(pad) + displayWidth(bullet) + 1;
    const hanging = " ".repeat(visiblePrefixLen);
    const wrapped = renderInlineBlock(
      text,
      width,
      terminal,
      prefix,
      hanging,
    );
    out.push(...wrapped);
  }
  return out;
}

/** Match a list-item line; returns its indent, marker text, and content. */
function matchListItem(
  line: string,
): { indent: number; ordered: boolean; content: string } | undefined {
  const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  if (!m) return undefined;
  const [, indent, marker, content] = m;
  if (indent === undefined || marker === undefined || content === undefined) {
    return undefined;
  }
  return {
    indent: indent.length,
    ordered: /\d/.test(marker),
    content,
  };
}

/** True when a line begins some block construct (so a paragraph must stop). */
function isBlockStart(line: string): boolean {
  return line.trim() === "" ||
    /^\s*(```|~~~)/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(line) ||
    matchListItem(line) !== undefined;
}

/**
 * Render a Markdown string to a terminal-ready string.
 *
 * Output is wrapped to `options.width` (default 80) and styled with ANSI when
 * `options.color` is true. HTML comments are stripped (they are author notes,
 * not reader content). Blocks are separated by a single blank line.
 */
export function renderMarkdown(
  md: string,
  options: RenderOptions = {},
): string {
  const width = Math.max(20, Math.floor(options.width ?? 80));
  const color = options.color ?? false;
  const baseTerminal = options.terminal ?? terminalPresentationContext(color);
  const coloredTerminal = terminalContextWithColor(baseTerminal, color);
  const terminal: TerminalContext = {
    ...coloredTerminal,
    capabilities: { ...coloredTerminal.capabilities, columns: width },
    size: { ...coloredTerminal.size, columns: width },
  };

  const src = md
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "");
  const lines = src.split("\n");
  const out: string[] = [];
  const pushBlock = (block: string[]) => {
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push(...block);
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^(\s*)(```|~~~)\s*([^\s`~]*)/);
    const fenceMarker = fence?.[2];
    if (fence && fenceMarker !== undefined) {
      const lang = fence[3] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length) {
        const cur = lines[i];
        if (cur === undefined || cur.trim().startsWith(fenceMarker)) break;
        code.push(cur);
        i++;
      }
      i++; // consume the closing fence
      pushBlock(renderCode(lang, code, width, terminal));
      continue;
    }

    // ATX heading.
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const hashes = heading[1];
      const headingText = heading[2];
      if (hashes !== undefined && headingText !== undefined) {
        pushBlock(renderHeading(hashes.length, headingText, width, terminal));
        i++;
        continue;
      }
    }

    // Horizontal rule.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      pushBlock([
        terminal.color
          ? renderDividerCli(
            {
              treatment: "rule",
              theme: terminal.themeVariant,
              width,
            },
            terminal.capabilities,
          )
          : (terminal.capabilities.unicode ? "─" : "-").repeat(width),
      ]);
      i++;
      continue;
    }

    // Blockquote: collect the run, strip markers, render recursively, prefix.
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (cur === undefined || !/^\s*>/.test(cur)) break;
        inner.push(cur.replace(/^\s*>\s?/, ""));
        i++;
      }
      const rendered = renderMarkdown(inner.join("\n"), {
        width: Math.max(20, width - 2),
        color: terminal.color,
        terminal,
      }).split("\n");
      const marker = terminal.capabilities.unicode ? "│ " : "| ";
      const bar = terminal.color ? terminal.role(marker, "muted") : marker;
      pushBlock(rendered.map((ln) => bar + ln));
      continue;
    }

    // GFM table: a header row followed by a delimiter row.
    const delimiter = lines[i + 1];
    if (
      /\|/.test(line) && delimiter !== undefined && isTableDelimiter(delimiter)
    ) {
      const rows: string[][] = [splitRow(line)];
      i += 2; // skip header + delimiter
      while (i < lines.length) {
        const cur = lines[i];
        if (cur === undefined || !/\|/.test(cur) || cur.trim() === "") break;
        rows.push(splitRow(cur));
        i++;
      }
      pushBlock(renderTable(rows, width, terminal));
      continue;
    }

    // List block: collect consecutive item lines and their continuations.
    if (matchListItem(line)) {
      const items: ListItem[] = [];
      let baseIndent = -1;
      while (i < lines.length) {
        const cur = lines[i];
        if (cur === undefined) break;
        const item = matchListItem(cur);
        if (item) {
          if (baseIndent === -1) baseIndent = item.indent;
          const depth = Math.max(
            0,
            Math.round((item.indent - baseIndent) / 2),
          );
          const ordinal = cur.trim().match(/^\d+[.)]/)?.[0];
          items.push({
            depth,
            marker: item.ordered && ordinal !== undefined ? ordinal : "•",
            text: item.content,
          });
          i++;
        } else if (
          cur.trim() !== "" && /^\s+/.test(cur) && items.length
        ) {
          // A continuation line: fold it into the current item.
          const lastItem = items[items.length - 1];
          if (lastItem) lastItem.text += " " + cur.trim();
          i++;
        } else {
          break;
        }
      }
      pushBlock(renderList(items, width, terminal));
      continue;
    }

    // Paragraph: gather until the next block construct, then wrap.
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const cur = lines[i];
      if (cur === undefined || isBlockStart(cur)) break;
      para.push(cur);
      i++;
    }
    pushBlock(renderInlineBlock(para.join(" "), width, terminal));
  }

  return out.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

// ── HTML rendering ─────────────────────────────────────────────────────────
//
// The second emitter over the same parse: the block scanner and parseInline
// above, emitting HTML instead of ANSI. One markdown model serves both the
// terminal (`discern map`/`help`) and any HTML surface, so the two can never
// disagree about what a doc contains.

/** One rendered heading, with the anchor id the HTML carries. */
export interface HtmlHeading {
  depth: number;
  id: string;
  text: string;
}

/** The HTML edition of a doc: markup plus its heading outline. */
export interface MarkdownHtml {
  html: string;
  headings: HtmlHeading[];
}

/**
 * Optional rendering hook for unstyled prose text. The callback receives raw
 * text and returns trusted HTML; links, code, emphasis, and headings bypass it
 * so their existing semantics cannot be replaced accidentally.
 */
export interface MarkdownHtmlOptions {
  renderProseText?: (text: string) => string;
}

/** Escape text content for HTML (attribute-safe). */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** GitHub-compatible heading slug: lowercase; drop punctuation (underscores
 * and hyphens survive); EVERY whitespace character becomes one dash, runs
 * uncollapsed — so "Files & dirs" is `files--dirs`, exactly the anchor GitHub
 * mints for the same heading. Authors write anchors against that de-facto
 * algorithm, and the tree is read on GitHub as well as through this renderer,
 * so the two must agree; the map's link-integrity guard validates fragments
 * against these ids. */
function slugify(text: string, taken: Set<string>): string {
  const base = text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-") || "section";
  let slug = base;
  for (let n = 1; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

/** Emit one styled segment as nested inline HTML. */
function segToHtml(seg: Seg, options: MarkdownHtmlOptions): string {
  const isPlain = seg.code !== true && seg.href === undefined &&
    seg.italic !== true && seg.bold !== true && seg.strike !== true;
  let html = isPlain && options.renderProseText !== undefined
    ? options.renderProseText(seg.text)
    : escapeHtml(seg.text);
  if (seg.code) html = `<code>${html}</code>`;
  if (seg.italic) html = `<em>${html}</em>`;
  if (seg.bold) html = `<strong>${html}</strong>`;
  if (seg.strike) html = `<del>${html}</del>`;
  if (seg.href !== undefined) {
    html = `<a href="${escapeHtml(seg.href)}">${html}</a>`;
  }
  return html;
}

/** Parse one logical line of inline Markdown straight to HTML. */
function inlineToHtml(
  text: string,
  options: MarkdownHtmlOptions = {},
): string {
  return parseInline(text).map((segment) => segToHtml(segment, options)).join(
    "",
  );
}

/** Render one Markdown inline run to escaped HTML without a block wrapper. */
export function renderMarkdownInlineHtml(text: string): string {
  return inlineToHtml(text);
}

interface HtmlListNode {
  marker: string;
  text: string;
  children: HtmlListNode[];
}

/** Choose an unordered or ordered HTML container from the parsed marker. */
function htmlListTag(item: Pick<HtmlListNode, "marker">): "ul" | "ol" {
  return item.marker === "•" ? "ul" : "ol";
}

/** Emit nested list nodes while grouping adjacent siblings by container type. */
function renderHtmlListNodes(
  nodes: HtmlListNode[],
  out: string[],
  options: MarkdownHtmlOptions,
): void {
  let index = 0;
  while (index < nodes.length) {
    const first = nodes[index];
    if (first === undefined) break;
    const tag = htmlListTag(first);
    out.push(`<${tag}>`);
    while (index < nodes.length) {
      const node = nodes[index];
      if (node === undefined || htmlListTag(node) !== tag) break;
      if (node.children.length === 0) {
        out.push(`<li>${inlineToHtml(node.text, options)}</li>`);
      } else {
        out.push(`<li>${inlineToHtml(node.text, options)}`);
        renderHtmlListNodes(node.children, out, options);
        out.push("</li>");
      }
      index++;
    }
    out.push(`</${tag}>`);
  }
}

/** Rebuild the flat depth-annotated items into a tree before emitting HTML. */
function listToHtml(
  items: ListItem[],
  out: string[],
  options: MarkdownHtmlOptions,
): void {
  const roots: HtmlListNode[] = [];
  const ancestors: HtmlListNode[] = [];
  for (const item of items) {
    const node: HtmlListNode = {
      marker: item.marker,
      text: item.text,
      children: [],
    };
    const depth = Math.min(item.depth, ancestors.length);
    if (depth === 0) {
      roots.push(node);
    } else {
      ancestors[depth - 1]?.children.push(node);
    }
    ancestors[depth] = node;
    ancestors.length = depth + 1;
  }
  renderHtmlListNodes(roots, out, options);
}

/** Emit the first row as a table head and the remaining rows as its body. */
function tableToHtml(
  rows: string[][],
  out: string[],
  options: MarkdownHtmlOptions,
): void {
  const [head, ...body] = rows;
  if (head === undefined) return;
  out.push("<table>");
  out.push("<thead><tr>");
  for (const cell of head) {
    out.push(`<th>${inlineToHtml(cell, options)}</th>`);
  }
  out.push("</tr></thead>");
  if (body.length > 0) {
    out.push("<tbody>");
    for (const row of body) {
      out.push("<tr>");
      for (const cell of row) {
        out.push(`<td>${inlineToHtml(cell, options)}</td>`);
      }
      out.push("</tr>");
    }
    out.push("</tbody>");
  }
  out.push("</table>");
}

/**
 * Render a Markdown string to HTML. The same block scanner and inline parser
 * as {@link renderMarkdown}; all raw HTML in the source is escaped, so the
 * output is safe to serve as-is. Headings come back with the anchor ids the
 * markup carries, ready for a table of contents.
 */
export function renderMarkdownHtml(
  md: string,
  options: MarkdownHtmlOptions = {},
): MarkdownHtml {
  const src = md
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "");
  const lines = src.split("\n");
  const out: string[] = [];
  const headings: HtmlHeading[] = [];
  const slugs = new Set<string>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^(\s*)(```|~~~)\s*([^\s`~]*)/);
    const fenceMarker = fence?.[2];
    if (fence && fenceMarker !== undefined) {
      const lang = fence[3] ?? "";
      const code: string[] = [];
      i++;
      while (i < lines.length) {
        const cur = lines[i];
        if (cur === undefined || cur.trim().startsWith(fenceMarker)) break;
        code.push(cur);
        i++;
      }
      i++; // consume the closing fence
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // ATX heading.
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const hashes = heading[1];
      const headingText = heading[2];
      if (hashes !== undefined && headingText !== undefined) {
        const depth = hashes.length;
        const text = inlineToPlain(headingText).trim();
        const id = slugify(text, slugs);
        headings.push({ depth, id, text });
        out.push(
          `<h${depth} id="${id}">${inlineToHtml(headingText)}</h${depth}>`,
        );
        i++;
        continue;
      }
    }

    // Horizontal rule.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    // Blockquote: collect the run, strip markers, render recursively.
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        if (cur === undefined || !/^\s*>/.test(cur)) break;
        inner.push(cur.replace(/^\s*>\s?/, ""));
        i++;
      }
      const nested = renderMarkdownHtml(inner.join("\n"), options);
      out.push(`<blockquote>${nested.html}</blockquote>`);
      continue;
    }

    // GFM table: a header row followed by a delimiter row.
    const delimiter = lines[i + 1];
    if (
      /\|/.test(line) && delimiter !== undefined && isTableDelimiter(delimiter)
    ) {
      const rows: string[][] = [splitRow(line)];
      i += 2; // skip header + delimiter
      while (i < lines.length) {
        const cur = lines[i];
        if (cur === undefined || !/\|/.test(cur) || cur.trim() === "") break;
        rows.push(splitRow(cur));
        i++;
      }
      tableToHtml(rows, out, options);
      continue;
    }

    // List block: collect consecutive item lines and their continuations.
    if (matchListItem(line)) {
      const items: ListItem[] = [];
      let baseIndent = -1;
      while (i < lines.length) {
        const cur = lines[i];
        if (cur === undefined) break;
        const item = matchListItem(cur);
        if (item) {
          if (baseIndent === -1) baseIndent = item.indent;
          const depth = Math.max(
            0,
            Math.round((item.indent - baseIndent) / 2),
          );
          const ordinal = cur.trim().match(/^\d+[.)]/)?.[0];
          items.push({
            depth,
            marker: item.ordered && ordinal !== undefined ? ordinal : "•",
            text: item.content,
          });
          i++;
        } else if (
          cur.trim() !== "" && /^\s+/.test(cur) && items.length
        ) {
          const lastItem = items[items.length - 1];
          if (lastItem) lastItem.text += " " + cur.trim();
          i++;
        } else {
          break;
        }
      }
      listToHtml(items, out, options);
      continue;
    }

    // Paragraph: gather until the next block construct.
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const cur = lines[i];
      if (cur === undefined || isBlockStart(cur)) break;
      para.push(cur);
      i++;
    }
    out.push(`<p>${inlineToHtml(para.join(" "), options)}</p>`);
  }

  return { html: out.join("\n"), headings };
}
