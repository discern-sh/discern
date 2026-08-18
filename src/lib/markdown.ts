/**
 * Markdown presentation boundaries.
 *
 * Terminal documents delegate completely to the published design-system
 * Markdown Component. The React-free HTML helpers remain here because the docs
 * site applies discern-owned Workflow and glossary projections that are not
 * part of the generic package API.
 */

import { renderMarkdownCli } from "discern-design-system/cli";
import {
  type TerminalContext,
  terminalContextWithColor,
  terminalPresentationContext,
} from "./terminal.ts";

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

/** Render Markdown through the package parser, model, and Component dispatcher. */
export function renderMarkdown(
  md: string,
  options: RenderOptions = {},
): string {
  const width = Math.max(20, Math.floor(options.width ?? 80));
  const color = options.color ?? false;
  const baseTerminal = options.terminal ?? terminalPresentationContext(color);
  const terminal = terminalContextWithColor(baseTerminal, color);
  return terminal.presenter.present(renderMarkdownCli, {
    source: md,
    maxWidth: width,
  });
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

    // Image: retain its alt text; this request-time emitter carries no media.
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

/** Flatten inline Markdown to plain text for metadata and HTML structure. */
export function inlineToPlain(text: string): string {
  return parseInline(text).map((s) => s.text).join("");
}

// ── browser block parsing ────────────────────────────────────────────────--

/** A delimiter row like `|---|:--:|` that marks the line above as a table head. */
export function isTableDelimiter(line: string): boolean {
  return /\|/.test(line) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) &&
    /-/.test(line);
}

/** Split a `|`-delimited row into trimmed cells, honouring `\|` escapes — the
 * one definition shared by the HTML emitter and the table-integrity scanner
 * (table_integrity.ts). */
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

/** One parsed list item: nesting depth, its marker, and the inline text. */
interface ListItem {
  depth: number;
  marker: string;
  text: string;
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

// ── HTML rendering ─────────────────────────────────────────────────────────
//
// The docs website retains this deliberately narrow, React-free emitter because
// its request-time Workflow and glossary projections need product-owned hooks.
// Terminal readers do not enter this parser.

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
 * Render a Markdown string to HTML for the docs website. Raw HTML in the source
 * is escaped, so the output is safe to serve as-is. Headings come back with the
 * anchor ids the markup carries, ready for a table of contents.
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
