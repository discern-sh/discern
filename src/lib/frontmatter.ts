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
 * what a block means. Three policies share one parse and one set of per-key
 * shape rules:
 *
 *  - {@link parseFrontmatter} reads LENIENTLY — a block that does not parse as
 *    a YAML mapping is treated as content, so reading never fails and never
 *    loses document text, and a value the shape rules reject is skipped.
 *  - {@link frontmatterShapeIssues} is the DOMAIN-NEUTRAL validation every
 *    project's gate applies: exactly the mistakes the lenient reader would
 *    otherwise swallow silently — a block that opens with `---` but is broken
 *    (unterminated, invalid YAML, not a mapping), and a recognised key whose
 *    value the reader would drop. Unknown keys are tolerated: projects
 *    legitimately carry third-party frontmatter beside discern's keys.
 *  - {@link validateFrontmatter} is the STRICT schema — the shapes plus
 *    unknown-key rejection, length bounds, and list-content rules. This
 *    repository holds its own map to it; it is not part of the shipped gate.
 * `SKILL.md` identity blocks share {@link readFrontmatterBlock} and
 * {@link parseFrontmatterMapping} through `skillFrontmatterIssues`
 * (src/lib/skills.ts). Markdown WRITERS share {@link frontmatterParseIssue}:
 * before rewriting a document they ask the same strict question the gate asks,
 * and refuse the file when its block does not parse — rewriting a document
 * around a broken metadata block can only restructure it into a differently
 * broken one.
 */

import { parse as parseYaml } from "@std/yaml";
import { isManualKind, type ManualKind } from "../shared/manual.ts";

/** The recognised override keys, the single source the validator checks against. */
export const DOC_META_KEYS = [
  "id",
  "title",
  "description",
  "order",
  "publish",
  "redirect_from",
  "aliases",
  "kind",
] as const;

/** The recognised override keys. Unknown keys are ignored when reading. */
export interface DocMeta {
  /** Stable corpus identity. Optional for neutral document trees; required by
   * the repository manual policy. */
  id?: string | undefined;
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
  /** Editorial purpose. Optional in neutral trees; required by the manual. */
  kind?: ManualKind | undefined;
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

/** The issue a `---` opener with no closing fence reports, shared by every
 * strict reader so the failure is phrased one way everywhere. */
export const UNTERMINATED_FRONTMATTER_ISSUE =
  "unterminated frontmatter fence (no closing '---')";

/**
 * The strict question a Markdown writer asks before it rewrites a document:
 * does the leading frontmatter parse? Returns undefined when the document
 * opens with no block at all, or with a valid YAML mapping; returns the issue
 * when the opening fence never closes or the block does not parse. A writer
 * refuses on an issue instead of formatting around the broken block.
 */
export function frontmatterParseIssue(md: string): string | undefined {
  if (md.split(/\r?\n/, 1)[0]?.trimEnd() !== "---") return undefined;
  const block = readFrontmatterBlock(md);
  if (block === undefined) return UNTERMINATED_FRONTMATTER_ISSUE;
  const parsed = parseFrontmatterMapping(block.raw);
  return "issue" in parsed ? parsed.issue : undefined;
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
  if (typeof attrs["id"] === "string") meta.id = attrs["id"];
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
  if (isManualKind(attrs["kind"])) meta.kind = attrs["kind"];
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

/** The outcome of reading a leading block for validation: no block at all,
 * a broken one (with the issues to report), or its parsed mapping. */
type BlockRead =
  | undefined
  | { issues: string[] }
  | { attrs: Record<string, unknown> };

/** Read a document's leading block for a validator: `undefined` when the
 * document opens with no `---` fence, the issue list when the block is broken
 * (unterminated, invalid YAML, not a mapping), else its parsed mapping. The
 * one preamble both validation tiers share. */
function readBlockForValidation(md: string): BlockRead {
  if (md.split(/\r?\n/, 1)[0]?.trimEnd() !== "---") return undefined;
  const block = readFrontmatterBlock(md);
  if (block === undefined) {
    return {
      issues: [
        "opens with a `---` fence that never closes — a broken frontmatter block" +
        " (or a thematic break, which no doc should open with)",
      ],
    };
  }
  const parsed = parseFrontmatterMapping(block.raw);
  if ("issue" in parsed) return { issues: [parsed.issue] };
  return { attrs: parsed.attrs };
}

/**
 * The DOMAIN-NEUTRAL shape rule for one recognised key — exactly the shape
 * {@link parseFrontmatter} requires before it reads the value at all, so a
 * violation here is a value the lenient reader silently drops. Returns the
 * problem, or undefined when the value is readable (or the key unrecognised —
 * unknown keys are a strict-tier concern only). One definition per key rule:
 * the strict tier layers its extras on top, never re-deciding the shape.
 */
function shapeIssue(key: string, value: unknown): string | undefined {
  switch (key) {
    case "id":
    case "title":
    case "description":
      return typeof value === "string"
        ? undefined
        : `must be text, not ${describeYamlValue(value)} — ${QUOTE_REMEDY}`;
    case "order":
      return typeof value === "number" && Number.isInteger(value) && value >= 0
        ? undefined
        : "must be a non-negative integer";
    case "publish":
      return typeof value === "boolean"
        ? undefined
        : "must be exactly true or false";
    case "redirect_from":
      return isStringArray(value)
        ? undefined
        : "must be a `- item` list of absolute routes";
    case "aliases":
      return isStringArray(value)
        ? undefined
        : "must be a `- item` list of search synonyms";
    case "kind":
      return isManualKind(value)
        ? undefined
        : "must be one of: tutorial, guide, explanation, reference, troubleshooting";
    default:
      return undefined;
  }
}

/**
 * Validate a document's frontmatter to the DOMAIN-NEUTRAL bar every project's
 * gate applies: a block that opens with `---` must parse (unterminated fence,
 * invalid YAML, and a non-mapping all fail — the lenient reader would treat
 * the whole block as content), and a recognised key's value must have the
 * shape the readers require (the lenient reader would drop it). Unknown keys
 * and out-of-BOUNDS values are deliberately tolerated — third-party keys
 * beside discern's are legitimate, and length bounds are a house style, not a
 * readability contract; the strict tier ({@link validateFrontmatter}) owns
 * both. Returns one message per problem; empty means readable everywhere.
 */
export function frontmatterShapeIssues(md: string): string[] {
  const read = readBlockForValidation(md);
  if (read === undefined) return [];
  if ("issues" in read) return read.issues;
  const issues: string[] = [];
  for (const [key, value] of Object.entries(read.attrs)) {
    const problem = shapeIssue(key, value);
    if (problem !== undefined) issue(issues, key, problem);
  }
  return issues;
}

/** The STRICT extras for one recognised, shape-valid value: length bounds and
 * list-content rules. Layered over {@link shapeIssue}, never replacing it. */
function strictIssues(key: string, value: unknown, issues: string[]): void {
  switch (key) {
    case "id": {
      if (
        typeof value === "string" &&
        !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value)
      ) {
        issue(
          issues,
          key,
          "must be a lowercase hyphenated identifier beginning with a letter",
        );
      }
      break;
    }
    case "title": {
      if (typeof value === "string" && value.length > TITLE_MAX_LENGTH) {
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
      if (
        typeof value === "string" &&
        (value.length < DESCRIPTION_MIN_LENGTH ||
          value.length > DESCRIPTION_MAX_LENGTH)
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
    case "redirect_from": {
      if (!isStringArray(value)) break;
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
      if (!isStringArray(value)) break;
      if (value.length === 0) issue(issues, key, "must not be an empty list");
      if (value.some((alias) => alias.trim() === "")) {
        issue(issues, key, "must not contain an empty alias");
      }
      if (new Set(value).size !== value.length) {
        issue(issues, key, "lists an alias twice");
      }
      break;
    }
  }
}

/** The recognised-key set, derived from the schema registry. */
const KNOWN_KEYS: ReadonlySet<string> = new Set<string>(DOC_META_KEYS);

/**
 * Validate a document's frontmatter against the STRICT schema — the
 * domain-neutral shapes ({@link frontmatterShapeIssues}) plus unknown-key
 * rejection, length bounds, and list-content rules. Returns one message per
 * problem; an empty array means the document is clean (including the common
 * case of no frontmatter at all). This repository's own map is held to it;
 * the shipped gate applies only the neutral tier.
 */
export function validateFrontmatter(md: string): string[] {
  const read = readBlockForValidation(md);
  if (read === undefined) return [];
  if ("issues" in read) return read.issues;
  const issues: string[] = [];
  for (const [key, value] of Object.entries(read.attrs)) {
    if (!KNOWN_KEYS.has(key)) {
      issue(
        issues,
        key,
        `unknown key — the schema allows exactly: ${DOC_META_KEYS.join(", ")}`,
      );
      continue;
    }
    const problem = shapeIssue(key, value);
    if (problem !== undefined) {
      issue(issues, key, problem);
      continue;
    }
    strictIssues(key, value, issues);
  }
  return issues;
}
