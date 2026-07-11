/**
 * A surgical, comment-preserving editor for the `discern.toml` subset.
 *
 * `discern.toml` is heavily commented (every slot carries a `# e.g.` hint; every
 * section a paragraph of guidance). A parse→stringify round-trip through a normal
 * TOML library strips all of that. So this editor operates on the raw text as
 * lines and only ever rewrites the *value* of a targeted key — preserving the
 * key, its `=` alignment, and every comment elsewhere.
 *
 * It targets exactly the shape `toml.awk` reads (see ADR 0005): `[section]` and
 * `[section.sub]` headers, and single-line `key = scalar|array` assignments — plus
 * ROOT-level keys (a `key = value` before any header), which `discern.toml` itself
 * has none of but a co-managed foreign file does (Codex's `environment.toml`
 * `version` / `name` — see {@link TomlEditor.setRootLiteral}). It is NOT a general
 * TOML writer — it renders scalar and single-line array assignments; multi-line
 * arrays are only recognized as spans so replacements/deletions do not leave
 * orphaned lines behind.
 */

import { parse as parseToml } from "@std/toml";
import { renderTomlString, renderTomlStringList } from "./toml_render.ts";

type LineEnding = "\n" | "\r\n" | "\r";

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True for a blank (whitespace-only) line. */
function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

/** True for a TOML comment line. */
function isCommentLine(line: string): boolean {
  return line.trimStart().startsWith("#");
}

/** The first newline sequence in a file, falling back to LF for new files. */
function detectLineEnding(text: string): LineEnding {
  return (text.match(/\r\n|\n|\r/u)?.[0] as LineEnding | undefined) ?? "\n";
}

/** Whether `text` ended with any newline sequence. */
function hasTrailingLineEnding(text: string): boolean {
  return /\r\n$|\n$|\r$/u.test(text);
}

/** Remove one final newline sequence before splitting into logical lines. */
function withoutTrailingLineEnding(text: string): string {
  if (text.endsWith("\r\n")) {
    return text.slice(0, -2);
  }
  if (text.endsWith("\n") || text.endsWith("\r")) {
    return text.slice(0, -1);
  }
  return text;
}

/** Split text into logical lines without carrying raw line-ending bytes. */
function splitTomlLines(text: string): string[] {
  return text.length === 0 ? [] : text.split(/\r\n|\n|\r/u);
}

/**
 * Return a line's trailing inline comment, including the whitespace before `#`.
 * Hashes inside single- or double-quoted TOML strings are value content.
 */
function inlineCommentSuffix(line: string, valueStart: number): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let i = valueStart; i < line.length; i++) {
    const char = line[i];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#") {
      let suffixStart = i;
      while (
        suffixStart > valueStart &&
        /\s/.test(line[suffixStart - 1] ?? "")
      ) {
        suffixStart--;
      }
      return line.slice(suffixStart);
    }
  }
  return "";
}

/** Replace one matched assignment's value while retaining its layout and comment. */
function replaceLiteralValue(
  line: string,
  key: string,
  match: RegExpMatchArray,
  literal: string,
): string {
  const prefix = `${match[1] ?? ""}${key}${match[2] ?? ""}`;
  return `${prefix}${literal}${inlineCommentSuffix(line, prefix.length)}`;
}

/** Whether a line's TOML array value is closed on that same line. */
function arrayClosedOnLine(line: string, valueStart: number): boolean {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;
  let sawArray = false;
  let sawClose = false;

  for (let i = valueStart; i < line.length; i++) {
    const char = line[i];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === "#") {
      break;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[") {
      depth++;
      sawArray = true;
    } else if (char === "]") {
      sawClose = true;
      depth--;
      if (depth <= 0) {
        return true;
      }
    }
  }
  return sawArray ? depth <= 0 : sawClose;
}

/** Render a string as a double-quoted TOML value (escaping `\` and `"`). */
export function tomlString(value: string): string {
  return renderTomlString(value);
}

/**
 * Whether `literal` is a value @std/toml — the same parser that later reads the
 * file back — accepts as one finite number. The prefilter rejects characters a
 * TOML number can never contain (whitespace, `#`), so structural payloads (a
 * trailing comment, a second line) can't ride through a probe that would
 * otherwise happily parse them.
 */
function isTomlNumberLiteral(literal: string): boolean {
  if (literal === "" || /[\s#]/u.test(literal)) {
    return false;
  }
  try {
    const parsed = parseToml(`v = ${literal}`) as { v?: unknown };
    return typeof parsed.v === "number" && Number.isFinite(parsed.v);
  } catch {
    return false;
  }
}

/**
 * Render a number (or numeric string) as a TOML value. A written form the TOML
 * grammar already accepts is preserved (`"0.0"`, `"1_000"`); a JS-numeric form
 * it forbids (`".5"`, `"5."`, `"007"`, `"1.e3"`) is normalized to its canonical
 * rendering — JS `Number()` is looser than the TOML grammar, and emitting such
 * a form verbatim would corrupt the whole file into unparseable TOML.
 */
export function tomlNumber(value: number | string): string {
  let literal: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`not a finite number: ${value}`);
    }
    literal = String(value);
  } else {
    const trimmed = value.trim();
    if (isTomlNumberLiteral(trimmed)) {
      literal = trimmed; // preserve the written form, e.g. "0.0" or "500000"
    } else if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
      literal = String(Number(trimmed)); // e.g. ".5" → "0.5", "007" → "7"
    } else {
      throw new Error(`not a number: ${JSON.stringify(value)}`);
    }
  }
  if (!isTomlNumberLiteral(literal)) {
    // Unreachable by construction; the postcondition stands anyway so no code
    // path can ever hand back a literal the config parser rejects.
    throw new Error(`not a TOML number: ${JSON.stringify(value)}`);
  }
  return literal;
}

/** Render a boolean as a TOML value. */
export function tomlBool(value: boolean): string {
  return value ? "true" : "false";
}

/** Render a string list as a single-line TOML array: `["a", "b"]`. */
export function tomlStringArray(items: string[]): string {
  return `[${renderTomlStringList(items)}]`;
}

/** Matches a section header line, capturing the section path inside the brackets. */
const HEADER_RE = /^\s*\[([^\]]+)\]/;

type SectionSpan = { headerIdx: number; bodyEnd: number };

/**
 * Edits the `discern.toml` subset in place, preserving comments and layout.
 * Mutating methods return `this` for chaining; `toString()` yields the result.
 */
export class TomlEditor {
  private lines: string[];
  /** Whether the original text ended with a newline (so we restore it). */
  private trailingNewline: boolean;
  /** The newline convention detected from the input, reused for inserted lines. */
  private lineEnding: LineEnding;

  constructor(text: string) {
    this.lineEnding = detectLineEnding(text);
    this.trailingNewline = hasTrailingLineEnding(text);
    // Split into lines without a trailing empty element from the final newline.
    const body = withoutTrailingLineEnding(text);
    this.lines = splitTomlLines(body);
  }

  /**
   * Set a dotted key (`section[.sub].key`) to a pre-rendered TOML value literal.
   * Replaces the value of an existing key (preserving its `=` alignment and
   * inline comment), inserts the key after its section header if the key is
   * absent, or — if the section itself is absent — creates it: right after the
   * last sibling in its dotted family if one exists (e.g. a new
   * `[scopes.assets]` lands beside an existing `[scopes.docs]`), otherwise
   * appended at EOF.
   */
  setLiteral(dottedKey: string, literal: string): this {
    const segments = dottedKey.split(".");
    const key = segments.at(-1);
    if (segments.length < 2 || key === undefined) {
      throw new Error(
        `config key must be section.key (got "${dottedKey}")`,
      );
    }
    const section = segments.slice(0, -1).join(".");

    const span = this.findSection(section);
    const keyLine = `${key} = ${literal}`;

    if (span === null) {
      // No such section. If a sibling already exists in this section's dotted
      // family (e.g. [scopes.docs] when we're creating [scopes.assets]),
      // insert right after the LAST such sibling — keeping the family
      // contiguous instead of scattering a new [scopes.*] far from the rest
      // of [scopes.*]. Only with no family member at all do we fall back to
      // an EOF append, with a blank-line separator.
      const sibling = this.lastSiblingSection(section);
      if (sibling === null) {
        if (
          this.lines.length > 0 && this.lines[this.lines.length - 1] !== ""
        ) {
          this.lines.push("");
        }
        this.lines.push(`[${section}]`, keyLine);
        return this;
      }
      this.lines.splice(
        this.bodyInsertionPoint(sibling),
        0,
        "",
        `[${section}]`,
        keyLine,
      );
      return this;
    }

    // Look for the key inside the section body. A commented-out line starts with
    // `#`, so the anchored regex never matches it — we then insert a real key.
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    for (let i = span.headerIdx + 1; i < span.bodyEnd; i++) {
      const lineText = this.lines[i];
      if (lineText === undefined) continue;
      const m = lineText.match(keyRe);
      if (m) {
        const prefix = `${m[1] ?? ""}${key}${m[2] ?? ""}`;
        const end = this.valueEnd(i, prefix.length);
        this.lines[i] = replaceLiteralValue(lineText, key, m, literal);
        if (end > i + 1) {
          this.lines.splice(i + 1, end - i - 1);
        }
        return this;
      }
    }
    // Key absent: insert immediately after the section header.
    this.lines.splice(span.headerIdx + 1, 0, keyLine);
    return this;
  }

  /**
   * Remove a dotted key's line if present. Returns true when a line was removed.
   * Only the `key = …` line goes; the section header and comments stay.
   */
  deleteKey(dottedKey: string): boolean {
    const segments = dottedKey.split(".");
    const key = segments.at(-1);
    if (segments.length < 2 || key === undefined) {
      return false;
    }
    const section = segments.slice(0, -1).join(".");
    const span = this.findSection(section);
    if (span === null) {
      return false;
    }
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    for (let i = span.headerIdx + 1; i < span.bodyEnd; i++) {
      const lineText = this.lines[i];
      if (lineText !== undefined && keyRe.test(lineText)) {
        const m = lineText.match(keyRe);
        const prefix = m === null ? "" : `${m[1] ?? ""}${key}${m[2] ?? ""}`;
        const end = this.valueEnd(i, prefix.length);
        this.lines.splice(i, end - i);
        return true;
      }
    }
    return false;
  }

  /**
   * Remove an entire section — its `[header]` line and its body, up to the next
   * header (or EOF). Returns true when a section was removed. Used by migrations
   * that restructure the config (e.g. dropping `[slots.*]` or `[evidence]`). A
   * comment block that *precedes* the header is not part of the section, so it is
   * left in place (a migrated seed may carry a stale comment — harmless).
   */
  deleteSection(section: string): boolean {
    const span = this.findSection(section);
    if (span === null) {
      return false;
    }
    this.lines.splice(span.headerIdx, span.bodyEnd - span.headerIdx);
    return true;
  }

  /** True when the section exists (its `[header]` line is present). */
  hasSection(section: string): boolean {
    return this.findSection(section) !== null;
  }

  /**
   * Insert a pre-rendered multi-line section block — its doc-comment paragraph,
   * `[header]`, and body — immediately after the `anchor` section, with a
   * blank-line gap matching the file's section spacing. Falls back to an EOF
   * append when `anchor` is absent. `block` must carry no surrounding blank lines
   * (use {@link sectionBlockFromTemplate} to produce one). Unlike `setLiteral`'s
   * bare-key EOF append, this places a section, documented, at a chosen position
   * — so a migration can give an evolving config the layout a fresh init has.
   */
  insertSectionBlockAfter(anchor: string, block: string): this {
    const blockLines = splitTomlLines(block);
    const span = this.findSection(anchor);
    if (span === null) {
      return this.appendSectionBlock(blockLines);
    }
    this.lines.splice(this.bodyInsertionPoint(span), 0, "", "", ...blockLines);
    return this;
  }

  /**
   * Insert a section block at the top of the file — after any leading comment
   * preamble, before the first section header — with a blank-line gap before the
   * first section, placing a freshly-added, documented `[meta]` first, the
   * way a fresh init has it. Falls back to an EOF append when there is no section
   * header yet.
   */
  insertSectionBlockAtTop(block: string): this {
    const blockLines = splitTomlLines(block);
    const firstHeader = this.lines.findIndex((l) => HEADER_RE.test(l));
    if (firstHeader === -1) {
      return this.appendSectionBlock(blockLines);
    }
    this.lines.splice(firstHeader, 0, ...blockLines, "", "");
    return this;
  }

  /**
   * Insert a documented key block inside an existing section, ordered relative to
   * the section's canonical keys. A no-op when the section is absent or the key
   * already exists. `block` is usually from `keyBlockFromTemplate`: it may start
   * with a blank separator, followed by comments and one assignment line.
   */
  insertKeyBlock(
    section: string,
    key: string,
    block: string,
    keyOrder: string[],
  ): boolean {
    const span = this.findSection(section);
    if (span === null) {
      return false;
    }
    if (this.assignmentLine(span, key) !== undefined) {
      return false;
    }

    const keyIndex = keyOrder.indexOf(key);
    const blockLines = splitTomlLines(block);
    if (keyIndex !== -1) {
      for (let i = keyIndex + 1; i < keyOrder.length; i++) {
        const next = this.assignmentLine(span, keyOrder[i] ?? "");
        if (next !== undefined) {
          this.lines.splice(this.keyBlockStart(span, next), 0, ...blockLines);
          return true;
        }
      }
      for (let i = keyIndex - 1; i >= 0; i--) {
        const previous = this.assignmentLine(span, keyOrder[i] ?? "");
        if (previous !== undefined) {
          this.lines.splice(
            this.assignmentEnd(previous.index, previous.key),
            0,
            ...blockLines,
          );
          return true;
        }
      }
    }

    this.lines.splice(span.headerIdx + 1, 0, ...blockLines);
    return true;
  }

  /** Append a section block at EOF, separated from existing content by a gap. */
  private appendSectionBlock(blockLines: string[]): this {
    while (this.lines.length > 0) {
      const last = this.lines.at(-1);
      if (last === undefined || !isBlankLine(last)) break;
      this.lines.pop();
    }
    if (this.lines.length > 0) {
      this.lines.push("", "");
    }
    this.lines.push(...blockLines);
    return this;
  }

  /** Return one assignment line inside a section, if present. */
  private assignmentLine(
    span: SectionSpan,
    key: string,
  ): { index: number; key: string } | undefined {
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    for (let i = span.headerIdx + 1; i < span.bodyEnd; i++) {
      const line = this.lines[i];
      if (line !== undefined && keyRe.test(line)) {
        return { index: i, key };
      }
    }
    return undefined;
  }

  /** Start of the comment block directly attached to `assignment`. */
  private keyBlockStart(
    span: SectionSpan,
    assignment: { index: number },
  ): number {
    let start = assignment.index;
    while (
      start - 1 > span.headerIdx &&
      isCommentLine(this.lines[start - 1] ?? "")
    ) {
      start--;
    }
    if (
      start - 1 > span.headerIdx &&
      isBlankLine(this.lines[start - 1] ?? "")
    ) {
      start--;
    }
    return start;
  }

  /** Exclusive end of an assignment's value span, including multi-line arrays. */
  private assignmentEnd(index: number, key: string): number {
    const line = this.lines[index] ?? "";
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    const match = line.match(keyRe);
    const prefix = match === null
      ? ""
      : `${match[1] ?? ""}${key}${match[2] ?? ""}`;
    return this.valueEnd(index, prefix.length);
  }

  /** Set a string-valued key. */
  setString(dottedKey: string, value: string): this {
    return this.setLiteral(dottedKey, tomlString(value));
  }

  /** Set a number-valued key (string preserves its written form). */
  setNumber(dottedKey: string, value: number | string): this {
    return this.setLiteral(dottedKey, tomlNumber(value));
  }

  /** Set a boolean-valued key. */
  setBool(dottedKey: string, value: boolean): this {
    return this.setLiteral(dottedKey, tomlBool(value));
  }

  /** Set a string-array-valued key. */
  setStringArray(dottedKey: string, items: string[]): this {
    return this.setLiteral(dottedKey, tomlStringArray(items));
  }

  /**
   * The exclusive end of the document's ROOT region — the index of the first
   * `[section]` header, or EOF when the file has none. A TOML `key = value` written
   * before any header (a "root key", e.g. Codex's `environment.toml` `version` /
   * `name`) lives in `[0, rootEnd)`. The `discern.toml` subset has no root keys, but
   * a co-managed foreign file does, so the editor handles them too.
   */
  private rootEnd(): number {
    const idx = this.lines.findIndex((l) => HEADER_RE.test(l));
    return idx === -1 ? this.lines.length : idx;
  }

  /** True when a ROOT-level (pre-section) `key = …` assignment is present — the
   * root-region analogue of {@link hasSection}, so a caller can set-if-absent. */
  hasRootKey(key: string): boolean {
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    const end = this.rootEnd();
    for (let i = 0; i < end; i++) {
      const line = this.lines[i];
      if (line !== undefined && keyRe.test(line)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Set a ROOT-level (pre-section) key to a pre-rendered TOML value literal —
   * replacing an existing root key's value (preserving its `=` alignment and
   * inline comment), or inserting it at the end of the root region
   * (just before the first section header, or at EOF). The root-region counterpart
   * to {@link setLiteral}; the key must be a bare name, not dotted.
   */
  setRootLiteral(key: string, literal: string): this {
    if (key.includes(".")) {
      throw new Error(`root key must be a bare name (got "${key}")`);
    }
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    const end = this.rootEnd();
    for (let i = 0; i < end; i++) {
      const line = this.lines[i];
      if (line === undefined) continue;
      const m = line.match(keyRe);
      if (m) {
        this.lines[i] = replaceLiteralValue(line, key, m, literal);
        return this;
      }
    }
    this.lines.splice(end, 0, `${key} = ${literal}`);
    return this;
  }

  /** Set a root-level string key. */
  setRootString(key: string, value: string): this {
    return this.setRootLiteral(key, tomlString(value));
  }

  /** Set a root-level number key (a string preserves its written form). */
  setRootNumber(key: string, value: number | string): this {
    return this.setRootLiteral(key, tomlNumber(value));
  }

  /**
   * Remove a ROOT-level (pre-section) `key = …` assignment if present, returning
   * true when a line was removed. The root-region counterpart to {@link deleteKey}
   * (which addresses only `section.key` assignments); it strips a foreign
   * co-managed file's discern-seeded root keys on uninstall (Codex's
   * `environment.toml` `version` / `name`). The key must be a bare name.
   */
  deleteRootKey(key: string): boolean {
    if (key.includes(".")) {
      throw new Error(`root key must be a bare name (got "${key}")`);
    }
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    const end = this.rootEnd();
    for (let i = 0; i < end; i++) {
      const lineText = this.lines[i];
      if (lineText === undefined) {
        continue;
      }
      const m = lineText.match(keyRe);
      if (m) {
        const prefix = `${m[1] ?? ""}${key}${m[2] ?? ""}`;
        const valueEnd = this.valueEnd(i, prefix.length);
        this.lines.splice(i, valueEnd - i);
        return true;
      }
    }
    return false;
  }

  /** The edited text, with the original trailing-newline convention restored. */
  toString(): string {
    const body = this.lines.join(this.lineEnding);
    return this.trailingNewline ? `${body}${this.lineEnding}` : body;
  }

  /**
   * Locate a section: the index of its `[header]` line and the exclusive end of
   * its body (the next header line, or EOF). Returns null when absent.
   */
  private findSection(
    section: string,
  ): { headerIdx: number; bodyEnd: number } | null {
    for (let i = 0; i < this.lines.length; i++) {
      const lineText = this.lines[i];
      const path = lineText?.match(HEADER_RE)?.[1];
      if (path !== undefined && path.trim() === section) {
        let end = i + 1;
        for (; end < this.lines.length; end++) {
          const endLine = this.lines[end];
          if (endLine !== undefined && HEADER_RE.test(endLine)) {
            break;
          }
        }
        return { headerIdx: i, bodyEnd: end };
      }
    }
    return null;
  }

  /**
   * The line index right after `span`'s last real content line — its
   * `bodyEnd`, stepped back over any blank lines trailing the body, so a
   * caller's own gap controls the spacing instead of compounding with one
   * already there.
   */
  private bodyInsertionPoint(
    span: { headerIdx: number; bodyEnd: number },
  ): number {
    let at = span.bodyEnd;
    while (at - 1 > span.headerIdx) {
      const prev = this.lines[at - 1];
      if (prev === undefined || !isBlankLine(prev)) break;
      at--;
    }
    return at;
  }

  /** The exclusive end line for a key's value, spanning a multi-line array. */
  private valueEnd(lineIdx: number, valueStart: number): number {
    const first = this.lines[lineIdx];
    if (first === undefined || first.slice(valueStart).trimStart()[0] !== "[") {
      return lineIdx + 1;
    }
    if (arrayClosedOnLine(first, valueStart)) {
      return lineIdx + 1;
    }
    for (let i = lineIdx + 1; i < this.lines.length; i++) {
      const line = this.lines[i];
      if (line === undefined) continue;
      if (arrayClosedOnLine(line, 0)) {
        return i + 1;
      }
    }
    return lineIdx + 1;
  }

  /**
   * The LAST existing section sharing `section`'s dotted family — its parent
   * group, i.e. the path with its final segment dropped (`scopes.assets`'s
   * group is `scopes`, so an existing `[scopes.docs]` is a sibling). Returns
   * null when `section` has no parent group (a single bare segment, e.g.
   * `recipes`) or no family member exists yet, so callers can fall back to an
   * EOF append exactly as before this method existed.
   */
  private lastSiblingSection(
    section: string,
  ): { headerIdx: number; bodyEnd: number } | null {
    const lastDot = section.lastIndexOf(".");
    if (lastDot === -1) {
      return null;
    }
    const group = section.slice(0, lastDot);
    let found: { headerIdx: number; bodyEnd: number } | null = null;
    for (let i = 0; i < this.lines.length; i++) {
      const lineText = this.lines[i];
      const path = lineText?.match(HEADER_RE)?.[1]?.trim();
      if (
        path === undefined || (path !== group && !path.startsWith(`${group}.`))
      ) {
        continue;
      }
      let end = i + 1;
      for (; end < this.lines.length; end++) {
        const endLine = this.lines[end];
        if (endLine !== undefined && HEADER_RE.test(endLine)) {
          break;
        }
      }
      found = { headerIdx: i, bodyEnd: end };
    }
    return found;
  }
}
