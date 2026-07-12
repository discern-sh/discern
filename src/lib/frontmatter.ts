/**
 * Optional YAML-style frontmatter on documentation leaves.
 *
 * A leaf in the map may open with a fenced metadata block:
 *
 * ```
 * ---
 * description: One line shown in listings and indexes.
 * order: 2
 * ---
 * ```
 *
 * Discovery derives every field it needs from the document itself — the title
 * from the first heading, the description from the lead paragraph — so
 * frontmatter is never required; it exists only to OVERRIDE a derived value
 * when the derivation reads poorly. That keeps the metadata surface impossible
 * to leave stale by omission: an absent block means "derive everything".
 *
 * The grammar is deliberately restricted to what the four known keys need —
 * scalar `key: value` lines, blank lines, and `#` comments between `---`
 * fences at the very top of the file. Anything else (nested maps, lists,
 * multi-line strings) means the block is NOT treated as frontmatter and the
 * document passes through untouched, so a leaf that merely opens with a
 * thematic break can never lose content to a lax parser.
 */

/** The recognised override keys. Unknown keys are ignored, reserved for later. */
export interface DocMeta {
  /** Overrides the title derived from the first heading. */
  title?: string | undefined;
  /** Overrides the description derived from the lead paragraph. */
  description?: string | undefined;
  /**
   * Sorts the leaf among its siblings: ordered leaves come first (ascending),
   * unordered siblings follow in name order. `README.md` stays first regardless.
   */
  order?: number | undefined;
  /** `false` withholds the leaf from published/exported surfaces. */
  publish?: boolean | undefined;
}

/** A parsed document: its metadata and the content with the block removed. */
export interface FrontmatterResult {
  meta: DocMeta;
  /** The document body. Identical to the input when no block was parsed. */
  body: string;
}

/** One `key: value` line. Values may be bare or single/double quoted. */
const SCALAR_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;

/** Strip one layer of matching quotes from a scalar value. */
function unquote(value: string): string {
  const m = value.match(/^(['"])(.*)\1$/);
  return m?.[2] ?? value;
}

/**
 * Parse an optional frontmatter block. Returns the input untouched (with empty
 * metadata) when the document does not open with a well-formed block.
 */
export function parseFrontmatter(md: string): FrontmatterResult {
  const none: FrontmatterResult = { meta: {}, body: md };
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return none;

  const meta: DocMeta = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trimEnd();
    if (line === "---") {
      return { meta, body: lines.slice(i + 1).join("\n").replace(/^\n/, "") };
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const m = line.match(SCALAR_LINE);
    const value = m?.[2];
    if (m === null || value === undefined || value === "") return none;
    switch (m[1]) {
      case "title":
        meta.title = unquote(value.trim());
        break;
      case "description":
        meta.description = unquote(value.trim());
        break;
      case "order": {
        const n = Number(value.trim());
        if (Number.isFinite(n)) meta.order = n;
        break;
      }
      case "publish":
        if (value.trim() === "true") meta.publish = true;
        else if (value.trim() === "false") meta.publish = false;
        break;
      default:
        // Unknown scalar keys parse fine and are ignored.
        break;
    }
  }
  // No closing fence: the leading `---` was a thematic break, not frontmatter.
  return none;
}
