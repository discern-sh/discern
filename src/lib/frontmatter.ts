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
 * The grammar is deliberately restricted to what the known keys need — scalar
 * `key: value` lines, flat `- item` lists, blank lines, and `#` comments
 * between `---` fences at the very top of the file. Anything else (nested
 * maps, multi-line strings) means the block is NOT treated as frontmatter and
 * the document passes through untouched, so a leaf that merely opens with a
 * thematic break can never lose content to a lax parser.
 *
 * Two readers share {@link scanFrontmatterBlock}, with different policies:
 * map docs ({@link parseFrontmatter}) read leniently — reading never fails —
 * while {@link validateFrontmatter} applies the strict schema the gate
 * enforces, so a typo'd key or an out-of-shape value fails loudly at the gate
 * instead of vanishing silently. `SKILL.md` identity blocks read the same
 * scanner through `parseSkillFrontmatter` (src/lib/skills.ts).
 *
 * The strict validators additionally consult {@link parseYamlOracle}: a block
 * that ships must be valid YAML a REAL parser reads to the same values,
 * because external consumers (agent runtimes, site generators, editors) parse
 * frontmatter as YAML, never with the restricted grammar. The two-parser
 * agreement is what makes "passes the gate" mean "parses everywhere".
 */

import { parse as parseYaml } from "@std/yaml";

/** The recognised override keys, the single source the validator checks against. */
export const DOC_META_KEYS = [
  "title",
  "description",
  "order",
  "publish",
  "redirect_from",
  "aliases",
] as const;

/** The recognised override keys. Unknown keys are ignored when reading. */
export interface DocMeta {
  /** Short label for nav, pager, breadcrumb, and `<title>` — the H1 stays the
   * long-form canonical title on the page. */
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
  /** Retired absolute routes that redirect to this page. */
  redirect_from?: string[] | undefined;
  /** Search synonyms: renamed terms, CLI spellings. */
  aliases?: string[] | undefined;
}

/** A parsed document: its metadata and the content with the block removed. */
export interface FrontmatterResult {
  meta: DocMeta;
  /** The document body. Identical to the input when no block was parsed. */
  body: string;
}

/** One top-level field in a scanned block: a scalar or a flat list. */
export interface FrontmatterField {
  key: string;
  value: string | string[];
}

/** A scanned block: its fields in order, lines the restricted grammar does not
 * recognise, and the body after the closing fence. */
export interface FrontmatterBlock {
  fields: FrontmatterField[];
  /** Lines inside the fences that are neither a field, a list item, a blank
   * line, nor a comment (e.g. a nested map's members). */
  unparsed: string[];
  /** The verbatim text between the fences — what an external YAML parser reads. */
  raw: string;
  body: string;
}

/** One `key: value` line. Values may be bare or single/double quoted. */
const SCALAR_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;

/** One `- item` list line (indentation optional). */
const LIST_ITEM_LINE = /^\s*-\s+(.*)$/;

/** Strip one layer of matching quotes from a scalar value. */
export function unquoteScalar(value: string): string {
  const m = value.match(/^(['"])(.*)\1$/);
  return m?.[2] ?? value;
}

/**
 * Scan an optional frontmatter block into raw fields. Returns undefined when
 * the document does not open with a `---` fence or the fence never closes —
 * there is no block at all. Grammar policy is the caller's: lines the grammar
 * does not recognise are collected in `unparsed`, so a lenient reader can skip
 * them and a strict one can reject the block.
 */
export function scanFrontmatterBlock(md: string): FrontmatterBlock | undefined {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return undefined;

  const fields: FrontmatterField[] = [];
  const unparsed: string[] = [];
  let openList: string[] | undefined;
  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trimEnd();
    if (line === "---") {
      return {
        fields,
        unparsed,
        raw: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n").replace(/^\n/, ""),
      };
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    const scalar = line.match(SCALAR_LINE);
    if (scalar?.[1] !== undefined) {
      const value = scalar[2] ?? "";
      if (value === "") {
        // A bare `key:` opens a list; its `- item` lines follow.
        openList = [];
        fields.push({ key: scalar[1], value: openList });
      } else {
        openList = undefined;
        fields.push({ key: scalar[1], value: unquoteScalar(value.trim()) });
      }
      continue;
    }
    const item = openList !== undefined ? line.match(LIST_ITEM_LINE) : null;
    if (item?.[1] !== undefined) {
      openList?.push(unquoteScalar(item[1].trim()));
      continue;
    }
    unparsed.push(line);
  }
  // No closing fence: the leading `---` was a thematic break, not frontmatter.
  return undefined;
}

/** The scalar string of a field, or undefined when the field holds a list. */
function scalarOf(field: FrontmatterField): string | undefined {
  return typeof field.value === "string" ? field.value : undefined;
}

/**
 * Parse an optional frontmatter block. Returns the input untouched (with empty
 * metadata) when the document does not open with a well-formed block. Reading
 * is LENIENT — unknown keys and out-of-shape values are ignored, never fatal —
 * so no reader of a map can lose a document to a metadata mistake; the strict
 * schema lives in {@link validateFrontmatter}, which the gate enforces.
 */
export function parseFrontmatter(md: string): FrontmatterResult {
  const none: FrontmatterResult = { meta: {}, body: md };
  const block = scanFrontmatterBlock(md);
  if (block === undefined || block.unparsed.length > 0) return none;

  const meta: DocMeta = {};
  for (const field of block.fields) {
    switch (field.key) {
      case "title": {
        const value = scalarOf(field);
        if (value !== undefined) meta.title = value;
        break;
      }
      case "description": {
        const value = scalarOf(field);
        if (value !== undefined) meta.description = value;
        break;
      }
      case "order": {
        const n = Number(scalarOf(field));
        if (Number.isFinite(n)) meta.order = n;
        break;
      }
      case "publish": {
        const value = scalarOf(field);
        if (value === "true") meta.publish = true;
        else if (value === "false") meta.publish = false;
        break;
      }
      case "redirect_from":
        if (Array.isArray(field.value)) meta.redirect_from = field.value;
        break;
      case "aliases":
        if (Array.isArray(field.value)) meta.aliases = field.value;
        break;
      default:
        // Unknown keys parse fine and are ignored (the validator flags them).
        break;
    }
  }
  return { meta, body: block.body };
}

/** Ceiling for an explicit `title:` — it is the SHORT label (nav, pager,
 * breadcrumb, `<title>`), never the long-form H1. */
export const TITLE_MAX_LENGTH = 48;

/** Bounds for an explicit `description:` — long enough to inform a listing,
 * short enough for a search snippet and a `<meta name="description">`. */
export const DESCRIPTION_MIN_LENGTH = 50;
export const DESCRIPTION_MAX_LENGTH = 160;

/** Push `message` prefixed with its offending key, the shape every issue takes. */
function issue(issues: string[], key: string, message: string): void {
  issues.push(`${key}: ${message}`);
}

/** The first line of a YAML parser's error, without its trailing context dump. */
function yamlErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? message;
}

/**
 * Parse a block's verbatim text with a REAL YAML parser — the oracle every
 * external consumer of a shipped Markdown file applies (agent runtimes, site
 * generators, editors all read frontmatter as YAML, not as discern's restricted
 * grammar). Returns the parsed mapping, or an issue string when the block is
 * not valid YAML or not a flat mapping. A block the restricted grammar accepts
 * can still fail here (an unquoted value containing `: `, a stray `[`), and
 * that is exactly the class of file that ships fine past a lax check and then
 * breaks in the consumer's parser.
 */
export function parseYamlOracle(
  raw: string,
): { attrs: Record<string, unknown> } | { issue: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return {
      issue: `frontmatter is not valid YAML — external tools parse this ` +
        `block with a real YAML parser: ${yamlErrorSummary(error)}`,
    };
  }
  if (parsed === null || parsed === undefined) return { attrs: {} };
  if (
    typeof parsed !== "object" || Array.isArray(parsed)
  ) {
    return {
      issue:
        `frontmatter must be a YAML mapping of \`key: value\` pairs, but a ` +
        `real YAML parser reads this block as ${
          Array.isArray(parsed) ? "a list" : `a ${typeof parsed}`
        }`,
    };
  }
  return { attrs: parsed as Record<string, unknown> };
}

/** Render a YAML value compactly for an agreement-issue message. */
function describeYamlValue(value: unknown): string {
  if (value === undefined) return "nothing";
  const rendered = JSON.stringify(value) ?? String(value);
  return rendered.length > 60 ? `${rendered.slice(0, 57)}…` : rendered;
}

/**
 * The two-reader agreement check: for every schema key the restricted grammar
 * read, a real YAML parser must read the SAME value. Divergence means discern
 * and an external consumer would see two different documents — the failure mode
 * that ships a file every internal check passes and an external parser then
 * rejects or misreads. Only keys whose restricted shape was already valid are
 * compared, so a shape error is reported once, not twice.
 */
function yamlAgreementIssues(
  block: FrontmatterBlock,
  attrs: Record<string, unknown>,
): string[] {
  const issues: string[] = [];
  const disagree = (key: string, actual: unknown): void => {
    issue(
      issues,
      key,
      `a real YAML parser reads this value as ${describeYamlValue(actual)} — ` +
        `keep it a plain single-line value (quote it if it contains ` +
        `\`: \` or starts with a YAML symbol)`,
    );
  };
  for (const field of block.fields) {
    const yamlValue = attrs[field.key];
    switch (field.key) {
      case "title":
      case "description": {
        const expected = scalarOf(field);
        if (expected === undefined) break;
        if (yamlValue !== expected) disagree(field.key, yamlValue);
        break;
      }
      case "order": {
        const expected = Number(scalarOf(field));
        if (!Number.isInteger(expected)) break;
        if (yamlValue !== expected) disagree(field.key, yamlValue);
        break;
      }
      case "publish": {
        const scalar = scalarOf(field);
        if (scalar !== "true" && scalar !== "false") break;
        if (yamlValue !== (scalar === "true")) disagree(field.key, yamlValue);
        break;
      }
      case "redirect_from":
      case "aliases": {
        // An empty `key:` is already a shape issue; YAML reads it as null.
        if (!Array.isArray(field.value) || field.value.length === 0) break;
        const matches = Array.isArray(yamlValue) &&
          yamlValue.length === field.value.length &&
          field.value.every((item, i) => yamlValue[i] === item);
        if (!matches) disagree(field.key, yamlValue);
        break;
      }
      default:
        // Unknown keys are already schema failures; agreement adds nothing.
        break;
    }
  }
  return issues;
}

/**
 * Validate a document's frontmatter against the strict schema. Returns one
 * message per problem; an empty array means the document is clean (including
 * the common case of no frontmatter at all). This is the gate's view of the
 * same block {@link parseFrontmatter} reads leniently: unknown keys, duplicate
 * keys, and out-of-shape or out-of-bounds values all fail here so a metadata
 * mistake surfaces at the gate, never as a silently-ignored override.
 */
export function validateFrontmatter(md: string): string[] {
  if (md.split(/\r?\n/, 1)[0]?.trimEnd() !== "---") return [];
  const block = scanFrontmatterBlock(md);
  if (block === undefined) {
    return [
      "opens with a `---` fence that never closes — a broken frontmatter block" +
      " (or a thematic break, which no doc should open with)",
    ];
  }

  const issues: string[] = [];
  for (const line of block.unparsed) {
    issues.push(
      `unrecognised line ${JSON.stringify(line)} — frontmatter allows only` +
        " flat `key: value` scalars and `- item` lists",
    );
  }

  const seen = new Set<string>();
  for (const field of block.fields) {
    const { key, value } = field;
    if (seen.has(key)) issue(issues, key, "duplicate key");
    seen.add(key);

    switch (key) {
      case "title": {
        const scalar = scalarOf(field);
        if (scalar === undefined) issue(issues, key, "must be a single line");
        else if (scalar.length > TITLE_MAX_LENGTH) {
          issue(
            issues,
            key,
            `is the short label (nav, breadcrumb, <title>) — keep it to ` +
              `${TITLE_MAX_LENGTH} characters (got ${scalar.length})`,
          );
        }
        break;
      }
      case "description": {
        const scalar = scalarOf(field);
        if (scalar === undefined) issue(issues, key, "must be a single line");
        else if (
          scalar.length < DESCRIPTION_MIN_LENGTH ||
          scalar.length > DESCRIPTION_MAX_LENGTH
        ) {
          issue(
            issues,
            key,
            `must be ${DESCRIPTION_MIN_LENGTH}–${DESCRIPTION_MAX_LENGTH} ` +
              `characters (got ${scalar.length})`,
          );
        }
        break;
      }
      case "order": {
        const scalar = scalarOf(field);
        const n = scalar === undefined ? NaN : Number(scalar);
        if (!Number.isInteger(n) || n < 0) {
          issue(issues, key, "must be a non-negative integer");
        }
        break;
      }
      case "publish": {
        const scalar = scalarOf(field);
        if (scalar !== "true" && scalar !== "false") {
          issue(issues, key, "must be exactly true or false");
        }
        break;
      }
      case "redirect_from": {
        if (!Array.isArray(value)) {
          issue(issues, key, "must be a `- item` list of absolute routes");
          break;
        }
        if (value.length === 0) issue(issues, key, "must not be an empty list");
        for (const route of value) {
          if (!route.startsWith("/")) {
            issue(issues, key, `route "${route}" must be absolute (start /)`);
          } else if (route.length > 1 && route.endsWith("/")) {
            issue(
              issues,
              key,
              `route "${route}" must not end with a slash (canonical style)`,
            );
          } else if (/[#?]/.test(route)) {
            issue(
              issues,
              key,
              `route "${route}" must not carry a fragment or query`,
            );
          }
        }
        if (new Set(value).size !== value.length) {
          issue(issues, key, "lists a route twice");
        }
        break;
      }
      case "aliases": {
        if (!Array.isArray(value)) {
          issue(issues, key, "must be a `- item` list of search synonyms");
          break;
        }
        if (value.length === 0) issue(issues, key, "must not be an empty list");
        if (value.some((alias) => alias.trim() === "")) {
          issue(issues, key, "must not contain an empty alias");
        }
        if (new Set(value).size !== value.length) {
          issue(issues, key, "lists an alias twice");
        }
        break;
      }
      default:
        issue(
          issues,
          key,
          `unknown key — the schema allows exactly: ${
            DOC_META_KEYS.join(", ")
          }`,
        );
        break;
    }
  }

  // The YAML oracle: the block must ALSO be valid YAML that a real parser
  // reads to the same values, because every external consumer of a shipped
  // Markdown file (site generators, agent runtimes, editors) parses the block
  // as YAML — never with the restricted grammar above.
  const oracle = parseYamlOracle(block.raw);
  if ("issue" in oracle) {
    issues.push(oracle.issue);
  } else {
    issues.push(...yamlAgreementIssues(block, oracle.attrs));
  }
  return issues;
}
