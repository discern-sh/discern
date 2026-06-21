/**
 * A surgical, comment-preserving editor for the `icculus.toml` subset.
 *
 * `icculus.toml` is heavily commented (every slot carries a `# e.g.` hint; every
 * section a paragraph of guidance). A parse→stringify round-trip through a normal
 * TOML library strips all of that. So this editor operates on the raw text as
 * lines and only ever rewrites the *value* of a targeted key — preserving the
 * key, its `=` alignment, and every comment elsewhere.
 *
 * It targets exactly the shape `toml.awk` reads (see ADR 0005): `[section]` and
 * `[section.sub]` headers, and single-line `key = scalar|array` assignments. It
 * is NOT a general TOML writer — multi-line arrays and inline tables are out of
 * scope (the kit doesn't use them).
 */

import { renderTomlStringList } from "./toml_render.ts";

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True for a blank (whitespace-only) line. */
function isBlankLine(line: string): boolean {
  return line.trim() === "";
}

/** Render a string as a double-quoted TOML value (escaping `\` and `"`). */
export function tomlString(value: string): string {
  if (value.includes("\n")) {
    throw new Error("a TOML value cannot contain a newline");
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Render a number (or numeric string) as a TOML value, preserving its form. */
export function tomlNumber(value: number | string): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`not a finite number: ${value}`);
    }
    return String(value);
  }
  const trimmed = value.trim();
  if (trimmed === "" || !Number.isFinite(Number(trimmed))) {
    throw new Error(`not a number: ${JSON.stringify(value)}`);
  }
  return trimmed; // preserve the written form, e.g. "0.0" or "500000"
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

/**
 * Edits the `icculus.toml` subset in place, preserving comments and layout.
 * Mutating methods return `this` for chaining; `toString()` yields the result.
 */
export class TomlEditor {
  private lines: string[];
  /** Whether the original text ended with a newline (so we restore it). */
  private trailingNewline: boolean;

  constructor(text: string) {
    this.trailingNewline = text.endsWith("\n");
    // Split into lines without a trailing empty element from the final newline.
    const body = this.trailingNewline ? text.slice(0, -1) : text;
    this.lines = body.length === 0 ? [] : body.split("\n");
  }

  /**
   * Set a dotted key (`section[.sub].key`) to a pre-rendered TOML value literal.
   * Replaces the value of an existing key (preserving its `=` alignment and
   * dropping only that line's inline comment), inserts the key after its section
   * header if the key is absent, or appends a new section at EOF if the section
   * is absent.
   */
  setLiteral(dottedKey: string, literal: string): this {
    const segments = dottedKey.split(".");
    if (segments.length < 2) {
      throw new Error(
        `config key must be section.key (got "${dottedKey}")`,
      );
    }
    const key = segments[segments.length - 1]!;
    const section = segments.slice(0, -1).join(".");

    const span = this.findSection(section);
    const keyLine = `${key} = ${literal}`;

    if (span === null) {
      // No such section: append it at EOF, with a blank-line separator.
      if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== "") {
        this.lines.push("");
      }
      this.lines.push(`[${section}]`, keyLine);
      return this;
    }

    // Look for the key inside the section body. A commented-out line starts with
    // `#`, so the anchored regex never matches it — we then insert a real key.
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    for (let i = span.headerIdx + 1; i < span.bodyEnd; i++) {
      const m = this.lines[i]!.match(keyRe);
      if (m) {
        this.lines[i] = `${m[1]}${key}${m[2]}${literal}`;
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
    if (segments.length < 2) {
      return false;
    }
    const key = segments[segments.length - 1]!;
    const section = segments.slice(0, -1).join(".");
    const span = this.findSection(section);
    if (span === null) {
      return false;
    }
    const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}(\\s*=\\s*).*$`);
    for (let i = span.headerIdx + 1; i < span.bodyEnd; i++) {
      if (keyRe.test(this.lines[i]!)) {
        this.lines.splice(i, 1);
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
    const blockLines = block.split("\n");
    const span = this.findSection(anchor);
    if (span === null) {
      return this.appendSectionBlock(blockLines);
    }
    // Insert right after the anchor's last content line: step back over the
    // blank lines trailing its body so our own gap controls the spacing.
    let at = span.bodyEnd;
    while (at - 1 > span.headerIdx && isBlankLine(this.lines[at - 1]!)) {
      at--;
    }
    this.lines.splice(at, 0, "", "", ...blockLines);
    return this;
  }

  /**
   * Insert a section block at the top of the file — after any leading comment
   * preamble, before the first section header — with a blank-line gap before the
   * first section. Used to place a freshly-added, documented `[meta]` first, the
   * way a fresh init has it. Falls back to an EOF append when there is no section
   * header yet.
   */
  insertSectionBlockAtTop(block: string): this {
    const blockLines = block.split("\n");
    const firstHeader = this.lines.findIndex((l) => HEADER_RE.test(l));
    if (firstHeader === -1) {
      return this.appendSectionBlock(blockLines);
    }
    this.lines.splice(firstHeader, 0, ...blockLines, "", "");
    return this;
  }

  /** Append a section block at EOF, separated from existing content by a gap. */
  private appendSectionBlock(blockLines: string[]): this {
    while (
      this.lines.length > 0 && isBlankLine(this.lines[this.lines.length - 1]!)
    ) {
      this.lines.pop();
    }
    if (this.lines.length > 0) {
      this.lines.push("", "");
    }
    this.lines.push(...blockLines);
    return this;
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

  /** The edited text, with the original trailing-newline convention restored. */
  toString(): string {
    const body = this.lines.join("\n");
    return this.trailingNewline ? `${body}\n` : body;
  }

  /**
   * Locate a section: the index of its `[header]` line and the exclusive end of
   * its body (the next header line, or EOF). Returns null when absent.
   */
  private findSection(
    section: string,
  ): { headerIdx: number; bodyEnd: number } | null {
    for (let i = 0; i < this.lines.length; i++) {
      const m = this.lines[i]!.match(HEADER_RE);
      if (m && m[1]!.trim() === section) {
        let end = i + 1;
        for (; end < this.lines.length; end++) {
          if (HEADER_RE.test(this.lines[end]!)) {
            break;
          }
        }
        return { headerIdx: i, bodyEnd: end };
      }
    }
    return null;
  }
}
