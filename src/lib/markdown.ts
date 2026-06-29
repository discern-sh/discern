/**
 * A small, dependency-light Markdown → terminal renderer.
 *
 * The docs tree discern scaffolds is CommonMark-ish prose: headings, paragraphs,
 * fenced code, lists, blockquotes, GFM tables, and inline emphasis / code /
 * links. This module renders that subset to a styled string for a terminal — it
 * is deliberately NOT a spec-complete parser. The goal is a *readable* viewer
 * for `discern docs`, not round-trip fidelity.
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

import { Table } from "@cliffy/table";

/** How to render: wrap width and whether to emit ANSI styling. */
export interface RenderOptions {
  /** Column width to wrap prose to. Clamped to a sane minimum. Default 80. */
  width?: number;
  /** Apply ANSI colour/style. When false, output is clean plain text. */
  color?: boolean;
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

/** A single character carrying the style of the span it came from. */
interface SChar {
  ch: string;
  style: Style;
}

/**
 * Apply one SGR style unconditionally. `RenderOptions.color` is already the
 * caller's explicit policy, so inheriting @std/fmt's process-global NO_COLOR
 * switch here would make `{ color: true }` lie. Production callers resolve
 * NO_COLOR before invoking the renderer; this layer only obeys its argument.
 */
function sgr(text: string, open: number, close: number): string {
  const start = `\x1b[${open}m`;
  const end = `\x1b[${close}m`;
  return `${start}${text.replaceAll(end, start)}${end}`;
}

const bold = (text: string): string => sgr(text, 1, 22);
const dim = (text: string): string => sgr(text, 2, 22);
const italic = (text: string): string => sgr(text, 3, 23);
const underline = (text: string): string => sgr(text, 4, 24);
const strikethrough = (text: string): string => sgr(text, 9, 29);
const green = (text: string): string => sgr(text, 32, 39);
const yellow = (text: string): string => sgr(text, 33, 39);
const blue = (text: string): string => sgr(text, 34, 39);
const cyan = (text: string): string => sgr(text, 36, 39);
const brightBlack = (text: string): string => sgr(text, 90, 39);
const brightCyan = (text: string): string => sgr(text, 96, 39);

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

/** Paint one uniformly-styled run, or annotate it for plain (no-colour) output. */
function styleRun(text: string, style: Style, color: boolean): string {
  if (!color) {
    // Keep just enough markup that structure survives without colour.
    if (style.code) return `\`${text}\``;
    return text;
  }
  if (style.code) return yellow(text);
  // Compose styles as successive wrappers so combinations remain properly
  // nested and each style closes independently.
  let painted = text;
  if (style.strike) painted = strikethrough(painted);
  if (style.italic) painted = italic(painted);
  if (style.bold) painted = bold(painted);
  if (style.href) painted = osc8(style.href, blue(underline(painted)));
  return painted;
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

/** Explode segments into a styled-character stream for width-aware wrapping. */
function toChars(segs: Seg[]): SChar[] {
  const chars: SChar[] = [];
  for (const seg of segs) {
    const style: Style = {
      bold: seg.bold,
      italic: seg.italic,
      strike: seg.strike,
      code: seg.code,
      href: seg.href,
    };
    for (const ch of seg.text) chars.push({ ch, style });
  }
  return chars;
}

/** True when a styled char exists and carries whitespace (out-of-range → false). */
function isSpace(c: SChar | undefined): boolean {
  return c !== undefined && /\s/.test(c.ch);
}

/**
 * Greedy word-wrap a styled-character stream to `width`, breaking on spaces and
 * keeping words intact (a word longer than `width` overflows rather than being
 * cut). Whitespace runs collapse to a single break opportunity.
 */
function wrapChars(chars: SChar[], width: number): SChar[][] {
  const lines: SChar[][] = [];
  let line: SChar[] = [];
  let pendingSpace = false;
  let i = 0;

  while (i < chars.length) {
    if (isSpace(chars[i])) {
      let j = i;
      while (isSpace(chars[j])) j++;
      pendingSpace = line.length > 0;
      i = j;
      continue;
    }
    let j = i;
    while (j < chars.length && !isSpace(chars[j])) j++;
    const word = chars.slice(i, j);
    const sep = pendingSpace ? 1 : 0;
    if (line.length > 0 && line.length + sep + word.length > width) {
      lines.push(line);
      line = word.slice();
    } else {
      if (sep) line.push({ ch: " ", style: {} });
      for (const ch of word) line.push(ch);
    }
    pendingSpace = false;
    i = j;
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

/** Paint a wrapped line, merging adjacent same-style runs into one escape. */
function emitChars(chars: SChar[], color: boolean): string {
  let out = "";
  let k = 0;
  while (k < chars.length) {
    const ck = chars[k];
    if (ck === undefined) break;
    let m = k;
    while (m < chars.length) {
      const cm = chars[m];
      if (cm === undefined || !sameStyle(cm.style, ck.style)) break;
      m++;
    }
    const text = chars.slice(k, m).map((c) => c.ch).join("");
    out += styleRun(text, ck.style, color);
    k = m;
  }
  return out;
}

/** Render inline Markdown, wrapped to `width`, each line prefixed with `indent`. */
function renderInlineBlock(
  text: string,
  width: number,
  color: boolean,
  indent = "",
  hanging = indent,
): string[] {
  let segs = parseInline(text);
  if (!color) segs = annotateLinksForPlain(segs);
  const avail = Math.max(1, width - indent.length);
  const lines = wrapChars(toChars(segs), avail);
  return lines.map((ln, idx) =>
    (idx === 0 ? indent : hanging) + emitChars(ln, color)
  );
}

/** Flatten inline Markdown to plain text (for table cells and titles). */
export function inlineToPlain(text: string): string {
  return parseInline(text).map((s) => s.text).join("");
}

// ── block rendering ──────────────────────────────────────────────────────--

/** A delimiter row like `|---|:--:|` that marks the line above as a table head. */
function isTableDelimiter(line: string): boolean {
  return /\|/.test(line) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) &&
    /-/.test(line);
}

/** Split a `|`-delimited row into trimmed cells, honouring `\|` escapes. */
function splitRow(line: string): string[] {
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

/** Render a GFM table through Cliffy's Table, cells flattened to plain text. */
function renderTable(rows: string[][], width: number): string[] {
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  const cols = Math.max(1, header.length);
  // Leave room for borders/padding (~3 cells of chrome per column) so a wide
  // table wraps its cells instead of blowing past the terminal edge.
  const maxCol = Math.max(8, Math.floor((width - (cols * 3 + 1)) / cols));
  const table = new Table()
    .header(header.map(inlineToPlain))
    .body(body.map((r) => r.map(inlineToPlain)))
    .border(true)
    .padding(1)
    .maxColWidth(maxCol);
  return table.toString().split("\n");
}

/** Style an ATX heading by level (or keep the `#` markers in plain mode). */
function renderHeading(
  level: number,
  text: string,
  width: number,
  color: boolean,
): string[] {
  if (!color) {
    return ["#".repeat(level) + " " + inlineToPlain(text)];
  }
  const plainLen = inlineToPlain(text).length;
  const segs = parseInline(text);
  const chars = toChars(segs);
  if (level === 1) {
    const painted = brightCyan(bold(emitCharsPlainText(chars)));
    return [painted, brightCyan("─".repeat(Math.min(width, plainLen)))];
  }
  const plain = emitCharsPlainText(chars);
  if (level === 2) return [cyan(bold(plain))];
  if (level >= 4) return [brightBlack(bold(plain))];
  return [bold(plain)];
}

/** A heading's text, flattened (headings get one uniform style, not per-run). */
function emitCharsPlainText(chars: SChar[]): string {
  return chars.map((c) => c.ch).join("");
}

/** Render a fenced code block: a bordered, labelled box (fences kept in plain). */
function renderCode(lang: string, lines: string[], color: boolean): string[] {
  if (!color) {
    return ["```" + lang, ...lines, "```"];
  }
  const bar = brightBlack("│ ");
  const out: string[] = [];
  if (lang) out.push(brightBlack("┌─ ") + dim(lang));
  else out.push(brightBlack("┌─"));
  for (const ln of lines) out.push(bar + ln);
  out.push(brightBlack("└─"));
  return out;
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
  color: boolean,
): string[] {
  const out: string[] = [];
  for (const item of items) {
    const pad = "  ".repeat(item.depth);
    let bullet = item.marker;
    let text = item.text;

    // GFM task list: a leading [ ] / [x] becomes a checkbox glyph.
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      const mark = task[1];
      const rest = task[2];
      if (mark !== undefined && rest !== undefined) {
        bullet = mark.toLowerCase() === "x" ? "☑" : "☐";
        text = rest;
      }
    }

    const paintedBullet = color
      ? (task
        ? (bullet === "☑" ? green(bullet) : dim(bullet))
        : cyan(bullet))
      : bullet;
    const prefix = `${pad}${paintedBullet} `;
    // The hanging indent aligns continuation lines under the text, not the
    // bullet — measured on the *visible* prefix width, ignoring colour.
    const visiblePrefixLen = pad.length + bullet.length + 1;
    const hanging = " ".repeat(visiblePrefixLen);
    const wrapped = renderInlineBlock(text, width, color, prefix, hanging);
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
      pushBlock(renderCode(lang, code, color));
      continue;
    }

    // ATX heading.
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const hashes = heading[1];
      const headingText = heading[2];
      if (hashes !== undefined && headingText !== undefined) {
        pushBlock(renderHeading(hashes.length, headingText, width, color));
        i++;
        continue;
      }
    }

    // Horizontal rule.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      pushBlock([
        color ? brightBlack("─".repeat(width)) : "─".repeat(width),
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
        color,
      }).split("\n");
      const bar = color ? brightBlack("│ ") : "│ ";
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
      pushBlock(renderTable(rows, width));
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
      pushBlock(renderList(items, width, color));
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
    pushBlock(renderInlineBlock(para.join(" "), width, color));
  }

  return out.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}
