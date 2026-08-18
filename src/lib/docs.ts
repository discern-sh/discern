/**
 * Discover and resolve the project's documentation tree.
 *
 * `discern map` browses the install's configured map directory — the tree
 * `discern setup` seeds and the agent fills, not anything under `templates/`. This
 * module finds that tree, indexes every Markdown file (path, section, slug, and
 * the title pulled from its first heading), orders it the way a reader expects
 * (root `README` first, numbered subtrees in order, `_`-prefixed reference dirs
 * last), and resolves a free-form target (`concepts`, `00-orientation/concepts`,
 * `docs/00-orientation/concepts.md`, …) to a single doc.
 *
 * It is pure discovery: it reads the filesystem and returns plain data. The
 * command layer decides how to present it (interactive list, rendered view,
 * JSON, raw).
 *
 * This module is also the DOCUMENT MODEL every publishing surface consumes —
 * no renderer rediscovers, filters, orders, or titles documents on its own:
 *
 *  - {@link isPublicDoc} is the one page-level publication predicate.
 *    `publish: false` in a doc's frontmatter is the SOLE page-level withhold,
 *    honoured identically by every published surface (site, terminal docs,
 *    MCP docs, exports, staging). Which SUBTREES a surface ships is a separate,
 *    tier-level axis (`BUNDLED_PUBLIC_DOC_DIRS` in paths.ts).
 *  - Frontmatter is metadata, not content: rendered surfaces strip it (its
 *    values travel as structured fields on {@link DocEntry}). RAW editions
 *    stay pristine by contract — `--raw`, and any surface serving a doc's
 *    literal bytes, must return exactly the file's content, frontmatter and
 *    ADR citations included, because their consumers are agents and tooling
 *    that want full fidelity.
 *  - ADR citations are collected per entry ({@link DocEntry.citedAdrs}) so
 *    human-rendered surfaces can strip the inline groups (adr_citations.ts)
 *    and still surface the decisions separately.
 */

import { walk } from "@std/fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";
import { inlineToPlain } from "./markdown.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { type AdrCitation, collectAdrCitations } from "./adr_citations.ts";
import { RawConfig } from "../shared/config_read.ts";
import { normalizeMapDir } from "../shared/map_path.ts";
import { SOURCE_PATHS } from "../shared/paths_registry.ts";
import { resolveConfigPath } from "./paths.ts";

/** One indexed documentation file. */
export interface DocEntry {
  /** Path relative to the docs dir's parent, e.g. `docs/00-orientation/concepts.md`. */
  path: string;
  /** Absolute path on disk. */
  absPath: string;
  /** Path relative to the docs dir, e.g. `00-orientation/concepts.md`. */
  relToDocs: string;
  /** Immediate subdirectory under the docs dir (`""` for a top-level file). */
  section: string;
  /** Filename without the `.md` extension, e.g. `concepts`. */
  slug: string;
  /** Title from the first Markdown heading, or a humanised slug as a fallback. */
  title: string;
  /** One-line description: the lead paragraph, or `""` when the doc has none. */
  description: string;
  /** False when frontmatter withholds the doc from published surfaces. */
  publish: boolean;
  /** Sibling order: explicit frontmatter first, otherwise README curation. */
  order?: number | undefined;
  /** Search synonyms from frontmatter (`aliases:`), `[]` when none. */
  aliases: string[];
  /** Retired absolute routes that redirect here (`redirect_from:`). */
  redirectFrom: string[];
  /** Decisions the doc cites, in citation order, for related-decision surfaces. */
  citedAdrs: AdrCitation[];
}

/** An indexed tree of Markdown documents — the project map, or discern's own
 * bundled manual (`docs` browses with the same machinery). */
export interface DocsTree {
  /** The docs dir's parent (paths in `entries` are relative to this). */
  root: string;
  /** Absolute path to the docs directory itself. */
  docsDir: string;
  /** Every `.md` file found, in reading order. */
  entries: DocEntry[];
}

/** One numbered Architecture Decision Record projected from the map. */
export interface AdrRecord {
  entry: DocEntry;
  /** The stable four-digit record number. */
  number: string;
  /** True when the record lives under the ADR archive. */
  superseded: boolean;
}

/** One top-level section offered by the interactive export picker. */
export interface DocGroup {
  /** Top-level directory, or `(root)` for files directly under the docs dir. */
  name: string;
  /** Whether the group is an internal/reference `_`-prefixed subtree. */
  internal: boolean;
  /** Entries in their existing deterministic reading order. */
  entries: DocEntry[];
}

/** One title-first document choice in the interactive browser projection. */
export interface DocBrowseItem {
  /** Stable indexed document carried back from the picker. */
  entry: DocEntry;
  /** Document heading shown as the primary choice label. */
  label: string;
  /** Filename or section-relative path shown as secondary text. */
  description: string;
}

/** One canonical top-level group in the interactive browser projection. */
export interface DocBrowseGroup {
  /** Stable top-level directory identity, including `(root)`. */
  id: string;
  /** Section front-door title, or the bounded root-documents label. */
  label: string;
  /** Top-level directory shown as secondary text when one exists. */
  description?: string;
  /** Documents in discovery's existing reading order. */
  items: DocBrowseItem[];
}

/** Bounded label for documents stored directly at the documentation root. */
export const ROOT_DOC_BROWSE_LABEL = "Overview";

/** One non-internal top-level documentation subtree and its entries. */
export interface DocRegion {
  /** Exact region target, such as `20-quality-gate`. */
  name: string;
  /** Title from the region README, or its first page when no README exists. */
  title: string;
  /** One-line description from that same front-door page. */
  description: string;
  /** Number of pages in the region. */
  page_count: number;
  /** Pages in their existing deterministic reading order. */
  entries: DocEntry[];
}

/** One fully-read source file ready for concatenated Markdown export. */
export interface DocSource {
  entry: DocEntry;
  content: string;
}

/** The outcome of resolving a free-form target to a doc. */
export type ResolveResult =
  | { kind: "found"; entry: DocEntry }
  | { kind: "ambiguous"; entries: DocEntry[] }
  | { kind: "none" };

/** One fuzzy target suggestion, ordered by closest first. */
export interface DocSuggestion {
  entry: DocEntry;
  score: number;
}

/** True when `path` is an existing directory. */
async function isDir(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

/**
 * Walk up from `start` to the nearest ancestor that is a discern install — the
 * project root, the same anchor the `agent` dispatcher uses. Returns undefined
 * if none is found before the filesystem root.
 */
export async function findProjectRoot(
  start: string,
): Promise<string | undefined> {
  let dir = resolve(start);
  while (true) {
    if ((await resolveConfigPath(dir)) !== undefined) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Whether one indexed doc belongs on published surfaces. `publish: false` in a
 * doc's frontmatter is the SOLE page-level withhold (there is no second flag,
 * list, or naming convention), and this predicate is the one place it is read:
 * every surface that projects the tree to an audience — the site, terminal and
 * MCP `docs`, `--export public`, llms/search/sitemap derivations, binary
 * docs staging — filters through here, so no surface can drift. Agent surfaces
 * of the PROJECT map (`discern map`, the tree on disk) deliberately do not
 * filter: agents keep everything.
 */
export function isPublicDoc(entry: Pick<DocEntry, "publish">): boolean {
  return entry.publish;
}

/** The published subset of a tree, in unchanged reading order. */
export function publicDocs(entries: readonly DocEntry[]): DocEntry[] {
  return entries.filter(isPublicDoc);
}

/**
 * Project numbered ADR files from a discovered ADR tree, preserving the
 * document model's reading order. README and the 0000 authoring template do
 * not match the record shape, so callers never maintain a second exclusion
 * list. The directory is the canonical set: a new `NNNN-*.md` file enrols
 * automatically, including records retained under `_superseded/`.
 */
export function adrRecords(entries: readonly DocEntry[]): AdrRecord[] {
  const records: AdrRecord[] = [];
  for (const entry of entries) {
    const match = /^(?:(?:_superseded)\/)?(\d{4})-[^/]+\.md$/.exec(
      entry.relToDocs,
    );
    const number = match?.[1];
    if (number === undefined || number === "0000") continue;
    records.push({
      entry,
      number,
      superseded: entry.relToDocs.startsWith("_superseded/"),
    });
  }
  return records;
}

/** Markers delimiting the generated record lists in the authored ADR README. */
export const ADR_CURRENT_RECORDS_START =
  "<!-- BEGIN GENERATED: current ADR records -->";
export const ADR_CURRENT_RECORDS_END =
  "<!-- END GENERATED: current ADR records -->";
export const ADR_SUPERSEDED_RECORDS_START =
  "<!-- BEGIN GENERATED: superseded ADR records -->";
export const ADR_SUPERSEDED_RECORDS_END =
  "<!-- END GENERATED: superseded ADR records -->";

/** The two generated blocks kept inside the authored ADR README. */
export interface AdrIndexBlocks {
  current: string;
  superseded: string;
}

/** Extract the text of the first ATX heading, tolerating closing markers. */
function firstMarkdownHeading(markdown: string): string | undefined {
  for (const raw of markdown.split(/\r?\n/)) {
    const match = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    const heading = match?.[2]?.trim();
    if (heading) return heading;
  }
  return undefined;
}

/** A record file whose first heading defeats the index's title derivation.
 * The remedy is editing that record, so consumers phrase it apart from a
 * document-shape problem ({@link AdrIndexMarkerError}). */
export class AdrRecordTitleError extends Error {
  /** The offending record, relative to the ADR directory. */
  readonly record: string;
  constructor(record: string, message: string) {
    super(message);
    this.name = "AdrRecordTitleError";
    this.record = record;
  }
}

/** An index marker pair the README mangled: a start marker whose end marker
 * is missing (or precedes it). The remedy is repairing the README's markers —
 * every record file may be fine. */
export class AdrIndexMarkerError extends Error {
  readonly startMarker: string;
  readonly endMarker: string;
  constructor(startMarker: string, endMarker: string) {
    super(
      `the index block beginning with ${startMarker} has no matching ` +
        `${endMarker} after it`,
    );
    this.name = "AdrIndexMarkerError";
    this.startMarker = startMarker;
    this.endMarker = endMarker;
  }
}

/** Read and validate an ADR heading before deriving its index label. */
async function adrRecordTitle(record: AdrRecord): Promise<string> {
  const heading = firstMarkdownHeading(
    await Deno.readTextFile(record.entry.absPath),
  );
  const prefix = `ADR ${record.number}: `;
  if (heading === undefined || !heading.startsWith(prefix)) {
    throw new AdrRecordTitleError(
      record.entry.relToDocs,
      `${record.entry.relToDocs}: the first heading must start with ` +
        `"${prefix}" so the ADR index can derive its title`,
    );
  }
  const title = heading.slice(prefix.length).trim();
  if (title.length === 0) {
    throw new AdrRecordTitleError(
      record.entry.relToDocs,
      `${record.entry.relToDocs}: the ADR heading needs a title after ` +
        `"${prefix}"`,
    );
  }
  return title;
}

/** Render one generated record list between its authored marker pair. */
async function renderAdrIndexBlock(
  records: readonly AdrRecord[],
  superseded: boolean,
  start: string,
  end: string,
): Promise<string> {
  const selected = records.filter((record) => record.superseded === superseded);
  const lines = await Promise.all(
    selected.map(async (record) =>
      `- [${record.number} — ${await adrRecordTitle(
        record,
      )}](${record.entry.relToDocs})`
    ),
  );
  // An empty list keeps a single separating blank line, so the rendered block
  // is a fixed point of Markdown formatters (which collapse doubled blanks) and
  // the fresh skeleton's empty index is born current.
  const body = lines.length === 0 ? [""] : ["", ...lines, ""];
  return [
    start,
    "<!-- Generated by `discern refresh` from the ADR headings on disk. -->",
    ...body,
    end,
  ].join("\n");
}

/** Render both registry-derived record lists for the ADR README. */
export async function renderAdrIndexBlocks(
  records: readonly AdrRecord[],
): Promise<AdrIndexBlocks> {
  const [current, superseded] = await Promise.all([
    renderAdrIndexBlock(
      records,
      false,
      ADR_CURRENT_RECORDS_START,
      ADR_CURRENT_RECORDS_END,
    ),
    renderAdrIndexBlock(
      records,
      true,
      ADR_SUPERSEDED_RECORDS_START,
      ADR_SUPERSEDED_RECORDS_END,
    ),
  ]);
  return {
    current,
    superseded,
  };
}

/** Replace a complete marker-delimited list or reject a mangled pair. */
function replaceAdrIndexBlock(
  document: string,
  startMarker: string,
  endMarker: string,
  rendered: string,
): string {
  const start = document.indexOf(startMarker);
  const end = document.indexOf(endMarker);
  if (start < 0 || end < start) {
    throw new AdrIndexMarkerError(startMarker, endMarker);
  }
  const after = end + endMarker.length;
  return `${document.slice(0, start)}${rendered}${document.slice(after)}`;
}

/** A maintained ADR README: every present marker pair's list regenerated. */
export interface AdrIndexMaintenance {
  /** The document with each present pair's block replaced by its rendering. */
  text: string;
  /** How many marker pairs were present (0 = the index is not adopted). */
  pairs: number;
}

/**
 * Regenerate the record lists between any marker pairs the document carries,
 * without changing the authored framing. Each pair is independent — a README
 * carrying only the current-records markers keeps only that list — and a
 * document with no markers is returned unchanged with `pairs: 0`: the index is
 * opt-in by construction. A start marker without its end marker throws, so a
 * mangled pair is surfaced rather than silently skipped.
 */
export function maintainAdrIndexDocument(
  document: string,
  blocks: AdrIndexBlocks,
): AdrIndexMaintenance {
  let text = document;
  let pairs = 0;
  const pairSpecs: ReadonlyArray<[string, string, string]> = [
    [ADR_CURRENT_RECORDS_START, ADR_CURRENT_RECORDS_END, blocks.current],
    [
      ADR_SUPERSEDED_RECORDS_START,
      ADR_SUPERSEDED_RECORDS_END,
      blocks.superseded,
    ],
  ];
  for (const [start, end, rendered] of pairSpecs) {
    if (!text.includes(start)) {
      continue;
    }
    text = replaceAdrIndexBlock(text, start, end, rendered);
    pairs += 1;
  }
  return { text, pairs };
}

/** One surface enrolled with the publication predicate. */
export interface PublicDocSurface {
  name: string;
  /** Repo-relative source module that applies {@link isPublicDoc}. */
  source: string;
  /** How the predicate reaches the surface. */
  via: string;
}

/**
 * The registry of PUBLISHED surfaces — the projection matrix, in code. Every
 * surface that projects a doc tree to an audience is listed here, and the
 * parity guard (tests/public_doc_parity_test.ts) reconciles the list against
 * the sources: an enrolled surface must consume {@link isPublicDoc}, and no
 * other module may re-derive page-level publication by hand. Building a new
 * public surface? Filter through the predicate and add the entry — the guard
 * fails until you do.
 */
export const PUBLIC_DOC_SURFACES: readonly PublicDocSurface[] = [
  {
    name: "site",
    source: "site/docs.ts",
    via:
      "buildDocsSite filters the landing and instructions through isPublicDoc " +
      "and decision records through publicDocs; search and llms derive from " +
      "instructions, while the sitemap and raw .md editions derive from both families",
  },
  {
    name: "docs",
    source: "src/commands/docs.ts",
    via: "publicVerbTree applies publicDocs and the manual section registry " +
      "to terminal browse, TOC, JSON/MCP results, targets, and public export",
  },
  {
    name: "export-public",
    source: "src/commands/docs.ts",
    via: "exportDocs filters the public scope through publicDocs",
  },
  {
    name: "docs-staging",
    source: "scripts/build.ts",
    via: "stageBundledDocs copies only entries admitted by isPublicDoc",
  },
];

/**
 * Surfaces that MUST enrol when their wiring lands (a later brief owns each).
 * The parity guard asserts these do NOT yet consume the predicate — the day
 * one does, it must move to {@link PUBLIC_DOC_SURFACES} or the guard fails.
 */
export const PUBLIC_DOC_SURFACES_PENDING: readonly PublicDocSurface[] = [];

/** One page a redirect registry is built over: its live route and the
 * retired routes its frontmatter claims (`redirect_from:`). */
export interface RedirectPage {
  route: string;
  redirectFrom: readonly string[];
}

/** A validated redirect table: source route → live target route. */
export interface RedirectRegistry {
  redirects: Map<string, string>;
  /** Problems that would break serving; an empty list means the table is safe. */
  issues: string[];
}

/**
 * Build the redirect table from destination-owned `redirect_from` claims.
 * Every target exists by construction (a source maps to the route of the page
 * that declared it), and the two checks here make chains and cycles impossible
 * rather than merely absent: a source may not BE a live route (so no redirect
 * can point onward through another redirect's source), and no two pages may
 * claim the same source. The serving layer can follow any entry in one hop.
 */
export function buildRedirectRegistry(
  pages: readonly RedirectPage[],
): RedirectRegistry {
  const live = new Set(pages.map((p) => p.route));
  const redirects = new Map<string, string>();
  const claimedBy = new Map<string, string>();
  const issues: string[] = [];
  for (const page of pages) {
    for (const source of page.redirectFrom) {
      if (live.has(source)) {
        issues.push(
          `${page.route} claims redirect_from ${source}, which is a live ` +
            "route — a page and a redirect cannot share an address",
        );
        continue;
      }
      const other = claimedBy.get(source);
      if (other !== undefined && other !== page.route) {
        issues.push(
          `redirect_from ${source} is claimed by both ${other} and ` +
            `${page.route} — one historical route cannot point two ways`,
        );
        continue;
      }
      claimedBy.set(source, page.route);
      redirects.set(source, page.route);
    }
  }
  return { redirects, issues };
}

/** The text of the first Markdown heading in `md`, flattened to plain text. */
export function extractTitle(md: string): string | undefined {
  const heading = firstMarkdownHeading(md);
  if (heading === undefined) return undefined;
  const text = inlineToPlain(heading).trim();
  return text || undefined;
}

/**
 * First prose paragraph after the document's title heading, flattened to one
 * plain line. The shared derivation behind every doc description — map-overview
 * regions and per-leaf listings alike — so a doc's one-liner always reads the
 * same wherever it surfaces. Co-located with {@link extractTitle}: the two are
 * the model's only content-derived fields.
 */
export function leadParagraph(markdown: string, fallback: string): string {
  const lines = markdown.split(/\r?\n/);
  let sawTitle = false;
  const paragraph: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!sawTitle && /^#{1,6}\s+/.test(line)) {
      sawTitle = true;
      continue;
    }
    if (!sawTitle || line === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^(#{1,6}\s+|---+$|```|>)/.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line);
  }
  const plain = inlineToPlain(paragraph.join(" ")).trim();
  return plain || fallback;
}

/** Turn a slug into a readable title when a doc has no heading of its own. */
function humanise(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A sort key that yields reading order: within any directory `README.md` comes
 * first, then leaves with a frontmatter `order` (ascending, ties by name), then
 * the rest in name order; `_`-prefixed directories come after public
 * directories. Compared lexicographically.
 */
function sortKey(relPath: string, order?: number): string {
  const segs = relPath.split("/");
  return segs
    .map((seg, idx) => {
      const last = idx === segs.length - 1;
      if (last && seg.toLowerCase() === "readme.md") return "\x00";
      if (!last && seg.startsWith("_")) return `\uffff${seg.toLowerCase()}`;
      if (last && order !== undefined) {
        const rank = String(Math.max(0, Math.trunc(order))).padStart(9, "0");
        return `\x01${rank}~${seg.toLowerCase()}`;
      }
      return seg.toLowerCase();
    })
    .join("/");
}

/**
 * Collect link destinations from structured Markdown lines: table rows, list
 * items, and a link-led line immediately following an H2. README curation and
 * the corpus-parity guard share this grammar so a new table shape cannot join
 * one projection without joining the other.
 */
export function structuredLinkDestinations(markdown: string): string[] {
  const destinations: string[] = [];
  let afterHeading = false;
  for (const line of markdown.split("\n")) {
    if (/^##\s+/.test(line)) {
      afterHeading = true;
      continue;
    }
    if (line.trim() === "") continue;
    const structured = /^\s*(?:\||-\s+)/.test(line);
    const headingLead = afterHeading && /^\s*\[/.test(line);
    afterHeading = false;
    if (!structured && !headingLead) continue;
    for (const match of line.matchAll(/\]\(([^()\s]+)\)/g)) {
      destinations.push(match[1] ?? "");
    }
  }
  return destinations;
}

/** Remove maintained ADR index bodies before README links influence authored
 * sibling order. Generated output is a projection of the record set, never
 * curation input for the next projection. */
function withoutGeneratedAdrIndexBlocks(markdown: string): string {
  let authored = markdown;
  for (
    const [startMarker, endMarker] of [
      [ADR_CURRENT_RECORDS_START, ADR_CURRENT_RECORDS_END],
      [ADR_SUPERSEDED_RECORDS_START, ADR_SUPERSEDED_RECORDS_END],
    ] as const
  ) {
    const start = authored.indexOf(startMarker);
    const end = authored.indexOf(endMarker, start + startMarker.length);
    if (start >= 0 && end >= start) {
      authored = `${authored.slice(0, start)}${
        authored.slice(end + endMarker.length)
      }`;
    }
  }
  return authored;
}

/**
 * Fill missing sibling orders from the section README's authored link order.
 * `order:` remains authoritative; this fallback preserves the curation already
 * encoded in README tables/lists until (or unless) a leaf states it explicitly.
 * Only direct sibling Markdown links count, so source links and cross-section
 * "see also" lists cannot influence the section reading order.
 */
function applyReadmeCuration(
  entries: readonly DocEntry[],
  bodies: ReadonlyMap<string, string>,
): void {
  const byRel = new Map(entries.map((entry) => [entry.relToDocs, entry]));
  for (const readme of entries) {
    if (readme.slug.toLowerCase() !== "readme") continue;
    const body = bodies.get(readme.relToDocs);
    if (body === undefined) continue;
    const parent = dirname(readme.relToDocs);
    const dir = parent === "." ? "" : parent;
    const seen = new Set<string>();
    let position = 0;
    for (
      const authoredDest of structuredLinkDestinations(
        withoutGeneratedAdrIndexBlocks(body),
      )
    ) {
      const dest = authoredDest.replace(/#.*$/, "");
      if (!dest.toLowerCase().endsWith(".md")) continue;
      const targetRel = join(dir, dest).replaceAll(SEPARATOR, "/");
      const target = byRel.get(targetRel);
      if (
        target === undefined ||
        target.slug.toLowerCase() === "readme" ||
        dirname(target.relToDocs) !== (dir || ".") ||
        seen.has(target.relToDocs)
      ) {
        continue;
      }
      seen.add(target.relToDocs);
      position += 1;
      target.order ??= position * 10;
    }
  }
}

/** Resolve which directory to index, honouring an explicit `dir` override. */
async function resolveDocsDir(
  cwd: string,
  dir: string | undefined,
): Promise<{ docsDir: string; root: string } | undefined> {
  if (dir) {
    const abs = isAbsolute(dir) ? dir : resolve(cwd, dir);
    return (await isDir(abs))
      ? { docsDir: abs, root: dirname(abs) }
      : undefined;
  }
  const root = await findProjectRoot(cwd);
  if (root === undefined) {
    const candidate = join(cwd, SOURCE_PATHS.map.defaultPath);
    return (await isDir(candidate))
      ? { docsDir: candidate, root: dirname(candidate) }
      : undefined;
  }
  const raw = await RawConfig.load(root);
  const candidate = join(
    root,
    normalizeMapDir(raw.get("map.dir", SOURCE_PATHS.map.defaultPath)),
  );
  return (await isDir(candidate)) ? { docsDir: candidate, root } : undefined;
}

/** Whether a doc buried under one or more `_`-prefixed segments is admitted, given
 * the `includeInternal` policy: `true` admits all, a list admits a doc only when
 * EVERY one of its buried segments is named in it (so an `["_adr"]` allowlist
 * surfaces `_adr/…` but never `_internal/…`), and `false`/absent admits none. */
function internalAdmits(
  includeInternal: boolean | readonly string[] | undefined,
  buriedSegs: readonly string[],
): boolean {
  if (includeInternal === true) return true;
  if (!includeInternal) return false;
  return buriedSegs.every((seg) => includeInternal.includes(seg));
}

/**
 * Index a documentation tree — the project map by default. Returns undefined
 * when no such directory exists (the caller turns that into a friendly
 * "nothing to browse" message). `dir` overrides the default `[map].dir` location.
 *
 * Internal/reference subtrees in `_`-prefixed directories (`_adr`, `_internal`)
 * are excluded by default — the browser shows only the user-facing tree.
 * `includeInternal` widens that: `true` indexes every internal subtree (full-tree
 * export), and a string[] allowlist indexes ONLY the named ones (e.g. `["_adr"]`
 * for `docs --adr`, which reveals the ADRs without ever exposing `_internal` /
 * `_private`). Point `--dir` at one (`--dir docs/_adr`) to browse it directly,
 * where it is no longer nested under an underscore.
 * discern-allow-retrospective: describes the live layout under `--dir`.
 */
export async function discoverDocs(opts: {
  cwd: string;
  dir?: string | undefined;
  includeInternal?: boolean | readonly string[] | undefined;
}): Promise<DocsTree | undefined> {
  const resolved = await resolveDocsDir(opts.cwd, opts.dir);
  if (!resolved) return undefined;
  const { docsDir, root } = resolved;
  const entries: DocEntry[] = [];
  const bodies = new Map<string, string>();

  for await (
    const entry of walk(docsDir, { exts: [".md"], includeDirs: false })
  ) {
    const absPath = entry.path;
    const path = relative(root, absPath).replaceAll(SEPARATOR, "/");
    const relToDocs = relative(docsDir, absPath).replaceAll(SEPARATOR, "/");
    const parts = relToDocs.split("/");
    // Skip internal/reference subtrees: any doc whose path has a leading-
    // underscore directory segment (_adr, _internal, …). The browser exposes
    // only the user-facing tree unless `includeInternal` admits it (all, or a
    // named allowlist). Tested in tests/docs_test.ts.
    const buriedSegs = parts.slice(0, -1).filter((seg) => seg.startsWith("_"));
    if (
      buriedSegs.length > 0 &&
      !internalAdmits(opts.includeInternal, buriedSegs)
    ) {
      continue;
    }
    const section = parts.length > 1 ? (parts[0] ?? "") : "";
    const slug = basename(absPath).replace(/\.md$/i, "");

    let title = humanise(slug);
    let description = "";
    let publish = true;
    let order: number | undefined;
    let aliases: string[] = [];
    let redirectFrom: string[] = [];
    let citedAdrs: AdrCitation[] = [];
    try {
      const { meta, body } = parseFrontmatter(await Deno.readTextFile(absPath));
      bodies.set(relToDocs, body);
      title = meta.title ?? extractTitle(body) ?? title;
      description = meta.description ?? leadParagraph(body, "");
      publish = meta.publish ?? true;
      order = meta.order;
      aliases = meta.aliases ?? [];
      redirectFrom = meta.redirect_from ?? [];
      citedAdrs = collectAdrCitations(body);
    } catch {
      // An unreadable file keeps the humanised-slug fallback.
    }

    entries.push({
      path,
      absPath,
      relToDocs,
      section,
      slug,
      title,
      description,
      publish,
      order,
      aliases,
      redirectFrom,
      citedAdrs,
    });
  }

  applyReadmeCuration(entries, bodies);
  entries.sort((a, b) => {
    const ka = sortKey(a.relToDocs, a.order);
    const kb = sortKey(b.relToDocs, b.order);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { root, docsDir, entries };
}

/**
 * Group entries by their top-level docs section for the interactive export
 * picker. Group order and entry order both follow discovery's reading order.
 */
export function groupDocs(entries: readonly DocEntry[]): DocGroup[] {
  const groups = new Map<string, DocGroup>();
  for (const entry of entries) {
    const name = docGroupName(entry);
    let group = groups.get(name);
    if (!group) {
      group = {
        name,
        internal: name.startsWith("_"),
        entries: [],
      };
      groups.set(name, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

/**
 * Project the canonical documentation tree into title-first browse groups.
 * Group and document order both remain the discovery order, so new sections
 * and nested pages enroll without another section registry.
 */
export function docBrowseGroups(
  entries: readonly DocEntry[],
): DocBrowseGroup[] {
  return groupDocs(entries).flatMap((group) => {
    const frontDoor = group.entries.find((entry) =>
      entry.slug.toLowerCase() === "readme"
    ) ?? group.entries[0];
    if (frontDoor === undefined) return [];
    const root = group.name === "(root)";
    return [{
      id: group.name,
      label: root ? ROOT_DOC_BROWSE_LABEL : frontDoor.title,
      ...(root ? {} : { description: `${group.name}/` }),
      items: group.entries.map((entry) => ({
        entry,
        label: entry.title,
        description: root
          ? entry.relToDocs
          : entry.relToDocs.slice(group.name.length + 1),
      })),
    }];
  });
}

/**
 * Project the non-internal top-level regions from a discovered tree. Root files and
 * underscore-prefixed internal subtrees are not regions. This is the single
 * source for map overviews, region targets, and generated agent instructions, so a
 * new top-level directory enrolls everywhere without a copied list.
 */
export function docRegions(entries: readonly DocEntry[]): DocRegion[] {
  const bySection = new Map<string, DocEntry[]>();
  for (const entry of entries) {
    if (!entry.section || entry.section.startsWith("_")) continue;
    const group = bySection.get(entry.section) ?? [];
    group.push(entry);
    bySection.set(entry.section, group);
  }

  const regions: DocRegion[] = [];
  for (const [name, regionEntries] of bySection) {
    const frontDoor = regionEntries.find((entry) =>
      entry.slug.toLowerCase() === "readme"
    ) ?? regionEntries[0];
    if (frontDoor === undefined) continue;
    regions.push({
      name,
      title: frontDoor.title,
      description: frontDoor.description || frontDoor.title,
      page_count: regionEntries.length,
      entries: regionEntries,
    });
  }
  return regions;
}

/** Resolve an exact region name or directory path to its indexed subtree. */
export function resolveDocRegion(
  tree: DocsTree,
  target: string,
  cwd: string = Deno.cwd(),
): DocRegion | undefined {
  const needle = target.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!needle) return undefined;
  const lower = needle.toLowerCase();
  const asAbs = isAbsolute(needle) ? needle : resolve(cwd, needle);
  const docsName = basename(tree.docsDir).toLowerCase();
  return docRegions(tree.entries).find((region) =>
    region.name.toLowerCase() === lower ||
    `${docsName}/${region.name.toLowerCase()}` === lower ||
    resolve(tree.docsDir, region.name) === asAbs
  );
}

/** Turn one docs-root-relative Markdown path into the stable target both
 * documentation verbs accept. This is the target grammar's serialization
 * boundary: producers use it instead of independently trimming paths. */
export function canonicalDocTargetFromPath(relToDocs: string): string {
  return relToDocs.replace(/\.md$/i, "");
}

/** Stable target an agent can pass back to either docs command to read one result. */
export function canonicalDocTarget(entry: DocEntry): string {
  return canonicalDocTargetFromPath(entry.relToDocs);
}

/** Keep only picker-selected groups without disturbing global reading order. */
export function filterDocsByGroups(
  entries: readonly DocEntry[],
  selectedGroups: readonly string[],
): DocEntry[] {
  const selected = new Set(selectedGroups);
  return entries.filter((entry) => selected.has(docGroupName(entry)));
}

/** The top-level picker group for one entry. */
function docGroupName(entry: DocEntry): string {
  const parts = entry.relToDocs.split("/");
  return parts.length === 1 ? "(root)" : (parts[0] ?? "(root)");
}

/**
 * Concatenate fully-read docs into one Markdown stream. Source bytes remain
 * untouched; only the begin/end comments and separator newlines are added.
 */
export function formatDocsExport(sources: readonly DocSource[]): string {
  if (sources.length === 0) return "";
  return sources.map(({ entry, content }) => {
    const source = content.endsWith("\n") ? content : `${content}\n`;
    return `<!-- BEGIN SOURCE: ${entry.path} -->\n\n${source}\n` +
      `<!-- END SOURCE: ${entry.path} -->`;
  }).join("\n\n") + "\n";
}

/** The lowercase strings that should resolve to `entry`: its path spellings
 * plus the frontmatter `aliases:` — the same synonyms the published site's
 * search boosts, so a name that finds a page there finds it here too. */
function aliases(entry: DocEntry): string[] {
  const noExt = (s: string) => s.replace(/\.md$/i, "");
  const base = basename(entry.path);
  return [
    entry.path,
    noExt(entry.path),
    entry.relToDocs,
    noExt(entry.relToDocs),
    base,
    entry.slug,
    ...entry.aliases,
  ].map((s) => s.toLowerCase());
}

/** Normalize a free-form doc target for fuzzy comparison. */
function fuzzyKey(value: string): string {
  return value.toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Classic Levenshtein distance over short doc aliases. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    prev = curr;
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

/** Score one normalized query against one normalized alias. */
function fuzzyScore(query: string, alias: string): number | undefined {
  if (!query || !alias) return undefined;
  if (alias === query) return 0;
  if (alias.startsWith(query)) return 1;
  if (alias.includes(query)) return 4;

  const distance = editDistance(query, alias);
  const limit = Math.max(
    2,
    Math.floor(Math.max(query.length, alias.length) / 3),
  );
  return distance <= limit ? 10 + distance : undefined;
}

/**
 * Suggest docs for a target that did not resolve exactly. Suggestions are driven
 * from the indexed tree, so every newly-added doc automatically participates.
 */
export function suggestDocs(
  tree: DocsTree,
  target: string,
  limit = 5,
): DocSuggestion[] {
  const query = fuzzyKey(target);
  if (!query) return [];

  const suggestions: DocSuggestion[] = [];
  for (const entry of tree.entries) {
    const candidates = [...aliases(entry), entry.title].map(fuzzyKey);
    const scores = candidates
      .map((candidate) => fuzzyScore(query, candidate))
      .filter((score): score is number => score !== undefined);
    const score = scores.length > 0 ? Math.min(...scores) : undefined;
    if (score !== undefined) suggestions.push({ entry, score });
  }

  return suggestions
    .sort((a, b) =>
      a.score - b.score || a.entry.relToDocs.localeCompare(b.entry.relToDocs)
    )
    .slice(0, limit);
}

/**
 * Resolve a free-form `target` to a single doc. Matches an exact path (relative
 * to the project, to the docs dir, or absolute), a `section/slug`, a bare slug,
 * or a filename — case-insensitively. Several matches (e.g. a bare `README` that
 * exists in many subtrees) return `ambiguous` so the caller can list them.
 */
export function resolveDoc(
  tree: DocsTree,
  target: string,
  cwd: string = Deno.cwd(),
): ResolveResult {
  const needle = target.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!needle) return { kind: "none" };
  const lower = needle.toLowerCase();
  const asAbs = isAbsolute(needle) ? needle : resolve(cwd, needle);

  const matches = tree.entries.filter((e) =>
    aliases(e).includes(lower) || e.absPath === asAbs
  );

  const only = matches.at(0);
  if (matches.length === 1 && only !== undefined) {
    return { kind: "found", entry: only };
  }
  if (matches.length > 1) return { kind: "ambiguous", entries: matches };
  return { kind: "none" };
}
