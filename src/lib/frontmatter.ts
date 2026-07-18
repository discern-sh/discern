/**
 * YAML frontmatter on documentation leaves.
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
 * The block is YAML, parsed by the standard parser (`@std/yaml`) — the same
 * format every external consumer of a shipped Markdown file applies (agent
 * runtimes, site generators, editors), so there is exactly ONE definition of
 * what a block means. Two readers share it with different policies: map docs
 * ({@link parseFrontmatter}) read leniently — a block that does not parse as a
 * YAML mapping is treated as content, so reading never fails and never loses
 * document text — while {@link validateFrontmatter} applies the strict schema
 * the gate enforces, so a typo'd key, an out-of-shape value, or a block YAML
 * cannot parse fails loudly at the gate instead of vanishing silently.
 * `SKILL.md` identity blocks share {@link readFrontmatterBlock} and
 * {@link parseFrontmatterMapping} through `skillFrontmatterIssues`
 * (src/lib/skills.ts).
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

/** A document's leading fenced block, split but not yet parsed. */
export interface FrontmatterBlock {
  /** The verbatim text between the fences. */
  raw: string;
  /** The document body after the closing fence. */
  body: string;
}

/**
 * Split off an optional leading frontmatter block. Returns undefined when the
 * document does not open with a `---` fence or the fence never closes — there
 * is no block at all, and the document is pure content.
 */
export function readFrontmatterBlock(md: string): FrontmatterBlock | undefined {
  const lines = md.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return undefined;
  for (let i = 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trimEnd() === "---") {
      return {
        raw: lines.slice(1, i).join("\n"),
        body: lines.slice(i + 1).join("\n").replace(/^\n/, ""),
      };
    }
  }
  return undefined;
}

/** The first line of the YAML parser's error, without its trailing context dump. */
function yamlErrorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n", 1)[0] ?? message;
}

/**
 * Parse a block's verbatim text as YAML. Returns the parsed mapping, or an
 * issue string when the block is not valid YAML or not a mapping of
 * `key: value` pairs. The one parse both the lenient readers (which treat an
 * issue as "not frontmatter") and the strict validators (which report it)
 * build on.
 */
export function parseFrontmatterMapping(
  raw: string,
): { attrs: Record<string, unknown> } | { issue: string } {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return {
      issue: `frontmatter is not valid YAML: ${yamlErrorSummary(error)}`,
    };
  }
  if (parsed === null || parsed === undefined) return { attrs: {} };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      issue: `frontmatter must be a YAML mapping of \`key: value\` pairs, ` +
        `not ${Array.isArray(parsed) ? "a list" : `a ${typeof parsed}`}`,
    };
  }
  return { attrs: parsed as Record<string, unknown> };
}

/** True when `value` is an array holding only strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * Parse an optional frontmatter block. Returns the input untouched (with empty
 * metadata) when the document does not open with a block YAML reads as a
 * mapping. Reading is LENIENT — unknown keys and out-of-shape values are
 * ignored, never fatal — so no reader of a map can lose a document to a
 * metadata mistake; the strict schema lives in {@link validateFrontmatter},
 * which the gate enforces.
 */
export function parseFrontmatter(md: string): FrontmatterResult {
  const none: FrontmatterResult = { meta: {}, body: md };
  const block = readFrontmatterBlock(md);
  if (block === undefined) return none;
  const parsed = parseFrontmatterMapping(block.raw);
  if ("issue" in parsed) return none;

  const { attrs } = parsed;
  const meta: DocMeta = {};
  if (typeof attrs["title"] === "string") meta.title = attrs["title"];
  if (typeof attrs["description"] === "string") {
    meta.description = attrs["description"];
  }
  if (typeof attrs["order"] === "number" && Number.isFinite(attrs["order"])) {
    meta.order = attrs["order"];
  }
  if (typeof attrs["publish"] === "boolean") meta.publish = attrs["publish"];
  if (isStringArray(attrs["redirect_from"])) {
    meta.redirect_from = attrs["redirect_from"];
  }
  if (isStringArray(attrs["aliases"])) meta.aliases = attrs["aliases"];
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

/** Render a parsed YAML value compactly for an issue message. */
export function describeYamlValue(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "an empty value";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "object") return "a nested mapping";
  const rendered = JSON.stringify(value) ?? String(value);
  return `the ${typeof value} ${
    rendered.length > 60 ? `${rendered.slice(0, 57)}…` : rendered
  }`;
}

/** The remedy a mis-typed scalar shares: YAML reads unquoted values by shape,
 * so text that looks like another type must be quoted. */
const QUOTE_REMEDY = "write the value as a quoted string";

/**
 * Validate a document's frontmatter against the strict schema. Returns one
 * message per problem; an empty array means the document is clean (including
 * the common case of no frontmatter at all). This is the gate's view of the
 * same block {@link parseFrontmatter} reads leniently: a block YAML cannot
 * parse, unknown keys, and out-of-shape or out-of-bounds values all fail here
 * so a metadata mistake surfaces at the gate, never as a silently-ignored
 * override.
 */
export function validateFrontmatter(md: string): string[] {
  if (md.split(/\r?\n/, 1)[0]?.trimEnd() !== "---") return [];
  const block = readFrontmatterBlock(md);
  if (block === undefined) {
    return [
      "opens with a `---` fence that never closes — a broken frontmatter block" +
      " (or a thematic break, which no doc should open with)",
    ];
  }
  const parsed = parseFrontmatterMapping(block.raw);
  if ("issue" in parsed) return [parsed.issue];

  const issues: string[] = [];
  for (const [key, value] of Object.entries(parsed.attrs)) {
    switch (key) {
      case "title": {
        if (typeof value !== "string") {
          issue(
            issues,
            key,
            `must be text, not ${describeYamlValue(value)} — ${QUOTE_REMEDY}`,
          );
        } else if (value.length > TITLE_MAX_LENGTH) {
          issue(
            issues,
            key,
            `is the short label (nav, breadcrumb, <title>) — keep it to ` +
              `${TITLE_MAX_LENGTH} characters (got ${value.length})`,
          );
        }
        break;
      }
      case "description": {
        if (typeof value !== "string") {
          issue(
            issues,
            key,
            `must be text, not ${describeYamlValue(value)} — ${QUOTE_REMEDY}`,
          );
        } else if (
          value.length < DESCRIPTION_MIN_LENGTH ||
          value.length > DESCRIPTION_MAX_LENGTH
        ) {
          issue(
            issues,
            key,
            `must be ${DESCRIPTION_MIN_LENGTH}–${DESCRIPTION_MAX_LENGTH} ` +
              `characters (got ${value.length})`,
          );
        }
        break;
      }
      case "order": {
        if (
          typeof value !== "number" || !Number.isInteger(value) || value < 0
        ) {
          issue(issues, key, "must be a non-negative integer");
        }
        break;
      }
      case "publish": {
        if (typeof value !== "boolean") {
          issue(issues, key, "must be exactly true or false");
        }
        break;
      }
      case "redirect_from": {
        if (!isStringArray(value)) {
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
        if (!isStringArray(value)) {
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
  return issues;
}
