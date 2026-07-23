/**
 * `discern map` and `discern help` — browse and read a documentation tree.
 *
 * The two verbs share every line of this file through a {@link DocsVerb}
 * descriptor (ADR 0039); only the tree they read differs: `map` serves the
 * project's agent-maintained map (resolved from the project root), `help` serves
 * discern's OWN documentation, bundled into every install. Both serve two
 * audiences, decided by how the verb is invoked:
 *
 *  - **A human at a terminal** gets an interactive, searchable picker (Cliffy's
 *    `Select`, with type-to-filter) and a rendered, paged view of whatever they
 *    pick. The tree is growing, so search is the primary way in.
 *  - **An agent or a script** gets non-interactive surfaces it can consume: a
 *    target to render straight to stdout, `--raw` for the pristine Markdown
 *    source, `--json` for a machine-readable index (or a single doc's record),
 *    `--list` for a plain table of contents, and `--export` for one concatenated
 *    Markdown stream. It never blocks on a prompt when stdin/stdout are not a
 *    TTY.
 *
 * Rendering is handled by {@link renderMarkdown}; discovery and resolution by
 * {@link discoverDocs} / {@link resolveDoc}. This file is the glue: argument
 * dispatch, the interactive loop, and the pager.
 */

import { Select } from "@cliffy/prompt";
import { colors } from "@cliffy/ansi/colors";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";
import { colourEnabled, Logger } from "../lib/log.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { terminalWidth } from "../lib/text.ts";
import {
  canonicalDocTarget,
  discoverDocs,
  type DocEntry,
  type DocsTree,
  filterDocsByGroups,
  formatDocsExport,
  groupDocs,
  publicDocs,
  resolveDoc,
  resolveDocRegion,
  suggestDocs,
} from "../lib/docs.ts";
import {
  searchAgentPages,
  searchPageFromMarkdown,
} from "../lib/docs_search.ts";
import { parseFrontmatter } from "../lib/frontmatter.ts";
import { stripAdrCitations } from "../lib/adr_citations.ts";
import {
  HELP_ADR_DOC_DIR,
  isBundledDocEntry,
  resolveBundledDocsDir,
} from "../lib/paths.ts";
import type { DiscernResult } from "../shared/result.ts";
import type {
  DocRecord,
  DocsData,
  DocSearchResult,
} from "../shared/result_schemas.ts";
import { canPrompt, checkboxPrompt, selectPrompt } from "../lib/prompts.ts";
import {
  ageSince,
  buildMapOverview,
  type MapRegion,
} from "../lib/map_overview.ts";

/** Supported concatenated Markdown export scopes. */
type DocsExportScope = "public" | "all" | "select";

/**
 * How `discern map` (the project's agent-maintained documentation tree) and `discern help`
 * (discern's OWN bundled documentation) differ. Everything else — the
 * interactive browser, the renderer, target resolution, `--list`, `--json`, and
 * export — operates on a resolved {@link DocsTree} + {@link DocsOptions} and is
 * shared verbatim (ADR 0039). Only three things vary: which directory is read,
 * the verb label carried in results/messages, and the wording when the tree is
 * missing.
 */
interface DocsVerb {
  /** The label in every {@link DiscernResult} and user-facing message. */
  verb: "map" | "help";
  /** Machine-stable error slug when the tree is absent (`no_map` / `no_help`). */
  missingError: string;
  /**
   * Resolve the directory to hand {@link discoverDocs}. `map` passes a user
   * `--dir` through (and `undefined` keeps discovery's project-root default);
   * `help` resolves discern's bundled tree and reports `missing` when a binary
   * was built without it (it must NEVER fall back to a project's `docs/`).
   */
  resolveDir(opts: { dir?: string | undefined }): Promise<DirResolution>;
  /** The human message when no tree is found (verb-specific wording). */
  missingTree(opts: { dir?: string | undefined }): string;
  /** Export scopes this verb accepts (`help` is public-only — no internal tree). */
  exportScopes: readonly DocsExportScope[];
}

/**
 * The outcome of a verb's directory resolution. `ok` with an `undefined` dir is
 * meaningful for `map` (discovery resolves `[map].dir`); `missing`
 * means the tree cannot be located at all and the shared core must not probe a
 * project root in its place.
 */
type DirResolution =
  | { kind: "ok"; dir: string | undefined }
  | { kind: "missing" };

/** `discern map` — the project's agent-maintained documentation tree. */
const MAP_VERB: DocsVerb = {
  verb: "map",
  missingError: "no_map",
  resolveDir: (opts) => Promise.resolve({ kind: "ok", dir: opts.dir }),
  missingTree: (opts) =>
    opts.dir
      ? `no map directory at "${opts.dir}" — check the path or omit --dir to use [map].dir.`
      : "the project map is missing at the configured [map].dir — run `discern setup` to seed it, or set [map].dir to its existing location.",
  exportScopes: ["public", "all", "select"],
};

/** `discern help` — discern's OWN documentation, bundled into every install. */
const HELP_VERB: DocsVerb = {
  verb: "help",
  missingError: "no_help",
  resolveDir: async () => {
    const dir = await resolveBundledDocsDir();
    return dir ? { kind: "ok", dir } : { kind: "missing" };
  },
  missingTree: () =>
    "discern's bundled documentation is missing from this binary — this is a build defect; please report it.",
  exportScopes: ["public"],
};

/** The useful installed-binary response when its internal history is requested. */
const EXTERNAL_DECISIONS_MESSAGE =
  "discern's decision records are not bundled with installed binaries. " +
  "Read them at https://discern.sh/docs/decisions or in the source repository " +
  "at https://github.com/jackwh/discern/tree/main/project/map/_adr.";

/** Render an allowed-scope list for an error message ("public, all, or select"). */
function listScopes(scopes: readonly DocsExportScope[]): string {
  if (scopes.length <= 1) return scopes.join("");
  return `${scopes.slice(0, -1).join(", ")}, or ${scopes.at(-1) ?? ""}`;
}

/**
 * The internal-subtree policy for a browse. In a source checkout, `help --adr`
 * reveals the decision tree — and only that — never `_internal` / `_private`,
 * and never over MCP (the `helpResult` path passes nothing). Installed binaries
 * do not contain the tree and point readers to its public homes instead.
 */
function internalScope(
  desc: DocsVerb,
  options: DocsOptions,
): boolean | readonly string[] {
  return desc.verb === "help" && options.adr ? [HELP_ADR_DOC_DIR] : false;
}

/** Whether the resolved source tree actually carries the checkout-only records. */
async function hasDecisionRecords(dir: string | undefined): Promise<boolean> {
  if (dir === undefined) return false;
  try {
    return (await Deno.stat(join(dir, HELP_ADR_DOC_DIR))).isDirectory;
  } catch {
    return false;
  }
}

/**
 * The top-level section a documentation entry belongs to. Root Markdown files
 * keep their filename so {@link isBundledDocEntry} can admit the front door.
 */
function docTopLevel(entry: DocEntry): string {
  return entry.relToDocs.split("/")[0] ?? entry.relToDocs;
}

/** Whether a checkout-only help subtree was explicitly opened for this view. */
function helpInternalAllowed(
  entry: DocEntry,
  internal: boolean | readonly string[] | undefined,
): boolean {
  return Array.isArray(internal) && internal.includes(docTopLevel(entry));
}

/**
 * Apply both publication axes to a public projection. Page publication comes
 * from `isPublicDoc` through {@link publicDocs}; discern help additionally
 * applies the manual's default-deny section registry. Enforcing both at view
 * time keeps source checkouts, test overrides, and pre-curated binary stages
 * behaviorally identical.
 */
function publicVerbTree(desc: DocsVerb, tree: DocsTree): DocsTree {
  const entries = publicDocs(tree.entries);
  return desc.verb === "help"
    ? {
      ...tree,
      entries: entries.filter((entry) => isBundledDocEntry(docTopLevel(entry))),
    }
    : { ...tree, entries };
}

/**
 * Apply the verb's browse policy to a discovered tree. `help` is the published
 * product manual plus an explicitly requested checkout-only subtree such as
 * `--adr`; `map` is the agents' own tree and keeps everything.
 */
function verbTree(
  desc: DocsVerb,
  tree: DocsTree,
  internal?: boolean | readonly string[] | undefined,
): DocsTree {
  if (desc.verb === "map") return tree;
  const published = publicVerbTree(desc, tree);
  if (!Array.isArray(internal)) return published;
  const extras = publicDocs(tree.entries).filter((entry) =>
    helpInternalAllowed(entry, internal)
  );
  return {
    ...published,
    entries: [
      ...published.entries,
      ...extras.filter((entry) => !published.entries.includes(entry)),
    ],
  };
}

/**
 * A doc's content as rendered surfaces consume it: frontmatter never reaches
 * output (its values travel as structured fields), and `help` — prose humans
 * read — additionally loses inline ADR citations. `map` content keeps its
 * citations: its readers are agents, who navigate by them. RAW surfaces
 * (`--raw`, `.md` editions) bypass this entirely — pristine bytes by contract.
 */
function renderableBody(desc: DocsVerb, content: string): string {
  const { body } = parseFrontmatter(content);
  return desc.verb === "help" ? stripAdrCitations(body) : body;
}

/** Add a human terminal footer without changing JSON, export, or raw bodies. */
function terminalBody(
  desc: DocsVerb,
  entry: DocEntry,
  content: string,
): string {
  const body = renderableBody(desc, content);
  if (desc.verb !== "help" || entry.citedAdrs.length === 0) return body;
  const related = entry.citedAdrs.map((citation) =>
    `- [Decision ${citation.number}](` +
    `https://discern.sh/docs/decisions/${citation.number}-${citation.slug})`
  );
  return `${body.trimEnd()}\n\n## Related decisions\n\n${related.join("\n")}\n`;
}

/** Options accepted by the `map` command (global flags folded in). */
export interface DocsOptions {
  json: boolean;
  noColor: boolean;
  /** Print a doc's pristine Markdown source instead of rendering it. */
  raw: boolean;
  /** Print a plain table of contents and exit, even on a TTY. */
  list: boolean;
  /** Never page rendered output through `$PAGER`. */
  noPager: boolean;
  /** Override the map directory (default: the project's `[map].dir`). */
  dir?: string | undefined;
  /** Override the wrap width (default: the terminal width, capped). */
  width?: number | undefined;
  /** A specific doc to open (slug, `section/slug`, or path). */
  target?: string | undefined;
  /** Search the admitted tree, optionally within `target`. */
  search?: string | undefined;
  /** `help` only: also surface the bundled ADR subtree (hidden by default). */
  adr?: boolean | undefined;
  /** Concatenate docs to stdout or `output`. */
  export?: string | undefined;
  /** Write an export to this path instead of stdout. */
  output?: string | undefined;
}

/** Agent-facing search results stay compact even when the corpus is large. */
const SEARCH_RESULT_LIMIT = 5;

/** The machine-readable record for one doc (sans content). Frontmatter values
 * travel here as structured fields — never inside `content` — and only when
 * they say something: `publish` appears only when false (a `map` reader
 * seeing what publishing withholds), the rest only when present. */
function toRecord(e: DocEntry): DocRecord {
  return {
    path: e.path,
    section: e.section,
    slug: e.slug,
    title: e.title,
    description: e.description,
    ...(e.publish ? {} : { publish: false }),
    ...(e.order !== undefined ? { order: e.order } : {}),
    ...(e.aliases.length > 0 ? { aliases: e.aliases } : {}),
  };
}

/** Index payload; `help` deliberately omits a local map_dir path. */
async function indexData(
  desc: DocsVerb,
  tree: DocsTree,
  cwd: string,
): Promise<DocsData> {
  return {
    ...(desc.verb === "map" ? { map_dir: display(tree.docsDir, cwd) } : {}),
    count: tree.entries.length,
    docs: tree.entries.map(toRecord),
    ...(desc.verb === "map" ? { regions: await buildMapOverview(tree) } : {}),
  };
}

/** Compact human-readable names for nearest-match guidance. */
function suggestionLabels(suggestions: readonly DocEntry[]): string[] {
  return suggestions.map((entry) =>
    entry.slug === "README" ? entry.path : `${entry.slug} (${entry.path})`
  );
}

/** Not-found sentence with fuzzy nearest matches when any are close enough. */
function notFoundMessage(
  target: string,
  suggestions: readonly DocEntry[],
): string {
  const base = `no doc matches "${target}".`;
  if (suggestions.length === 0) return base;
  const labels = suggestionLabels(suggestions.slice(0, 3));
  return `${base} Closest match${labels.length === 1 ? "" : "es"}: ${
    labels.join(", ")
  }.`;
}

/** A tree narrowed to one region or one document for scoped search. */
type SearchScopeResolution =
  | { kind: "found"; tree: DocsTree; target: string }
  | { kind: "ambiguous"; entries: DocEntry[] }
  | { kind: "none" };

/** Resolve a search scope without treating the project-selecting `path` as one. */
function resolveSearchScope(
  tree: DocsTree,
  target: string,
  cwd: string,
): SearchScopeResolution {
  const region = resolveDocRegion(tree, target, cwd);
  if (region !== undefined) {
    return {
      kind: "found",
      tree: { ...tree, entries: region.entries },
      target: region.name,
    };
  }
  const doc = resolveDoc(tree, target, cwd);
  if (doc.kind === "found") {
    return {
      kind: "found",
      tree: { ...tree, entries: [doc.entry] },
      target: canonicalDocTarget(doc.entry),
    };
  }
  return doc;
}

/** Project one ranked hit without exposing its internal score. */
function toSearchResult(
  entry: DocEntry,
  match: DocSearchResult["match"],
  snippet: string,
  heading?: string | undefined,
): DocSearchResult {
  return {
    target: canonicalDocTarget(entry),
    path: entry.path,
    section: entry.section,
    title: entry.title,
    description: entry.description,
    match,
    ...(heading !== undefined ? { heading } : {}),
    snippet,
  };
}

/** Build a ranked search payload over one already-admitted tree. */
async function searchData(
  desc: DocsVerb,
  tree: DocsTree,
  query: string,
  scope?: string | undefined,
): Promise<DocsData> {
  const entriesByTarget = new Map(
    tree.entries.map((entry) => [canonicalDocTarget(entry), entry]),
  );
  const pages = await Promise.all(tree.entries.map(async (entry) => {
    let source = "";
    try {
      source = await Deno.readTextFile(entry.absPath);
    } catch {
      // Discovery keeps an unreadable leaf in the index with metadata fallbacks.
      // Search preserves that contract: metadata can still find it, while its
      // unavailable body contributes no full-text terms.
    }
    const content = renderableBody(desc, source);
    return searchPageFromMarkdown({
      route: canonicalDocTarget(entry),
      section: entry.section,
      entry,
    }, content);
  }));
  const ranked = searchAgentPages(pages, query, SEARCH_RESULT_LIMIT);
  let results: DocSearchResult[];
  if (ranked.length > 0) {
    results = ranked.flatMap((match) => {
      const entry = entriesByTarget.get(match.page.route);
      return entry === undefined ? [] : [toSearchResult(
        entry,
        match.match,
        match.snippet,
        match.heading?.text,
      )];
    });
  } else {
    // Full-text misses get the document model's typo-tolerant metadata fallback.
    // Short lexical queries do not carry enough edit-distance evidence: "AI"
    // must not become a suggestion for "Fail".
    const suggestions = [...query.trim()].length >= 4
      ? suggestDocs(tree, query, tree.entries.length)
      : [];
    results = suggestions.map(({ entry }) =>
      toSearchResult(entry, "metadata", entry.description)
    );
  }
  return {
    query: query.trim(),
    ...(scope !== undefined ? { scope } : {}),
    count: results.length,
    truncated: results.length > SEARCH_RESULT_LIMIT,
    results: results.slice(0, SEARCH_RESULT_LIMIT),
  };
}

/** Path of `abs` relative to `cwd`, for display (falls back to `abs`). */
function display(abs: string, cwd: string): string {
  const rel = relative(cwd, abs);
  return rel && !rel.startsWith("..") ? rel : abs;
}

/** True when `candidate` is `root` itself or lexically nested beneath it. */
function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel));
}

/**
 * Resolve symlinks for an existing output, or for its existing parent when the
 * output is new. This prevents `--output` escaping the lexical safety check via
 * a symlinked file or directory.
 */
async function canonicalOutputPath(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    try {
      return resolve(await Deno.realPath(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

/** Parse an export scope against the verb's allowed set (no silent typos). */
function exportScope(
  value: string,
  allowed: readonly DocsExportScope[],
): DocsExportScope | undefined {
  return (allowed as readonly string[]).includes(value)
    ? value as DocsExportScope
    : undefined;
}

/** Report a command-usage failure in the active human/JSON presentation mode. */
function invalidOptions(log: Logger, verb: string, message: string): number {
  if (log.json) {
    log.result({
      ok: false,
      verb,
      error: "invalid_options",
      message,
    });
  } else {
    log.error(message);
  }
  return 1;
}

/**
 * Resolve the wrap width: an explicit `--width` wins; otherwise the terminal
 * width (or `$COLUMNS`), capped to a readable maximum with a small margin, and
 * falling back to 80 off a TTY.
 */
function resolveWidth(explicit: number | undefined): number {
  if (explicit && explicit > 0) return Math.floor(explicit);
  const cols = terminalWidth();
  if (!cols) return 80;
  return Math.max(40, Math.min(cols - 2, 100));
}

/**
 * Page `text` through the user's pager so long docs scroll (and keep ANSI
 * colour). Honours `$PAGER`, defaulting to `less -R`. Returns false if no pager
 * could be spawned, so the caller can fall back to a plain print.
 */
async function pageThrough(text: string): Promise<boolean> {
  const pager = Deno.env.get("PAGER")?.trim();
  const cmd = pager ? "sh" : "less";
  const args = pager ? ["-c", pager] : ["-R"];
  try {
    const child = new Deno.Command(cmd, {
      args,
      stdin: "piped",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    const writer = child.stdin.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text + "\n"));
      await writer.close();
    } catch {
      // The pager exited before reading everything (e.g. the user pressed q on
      // a short doc) — a broken pipe here is expected, not an error.
    }
    await child.status;
    return true;
  } catch {
    return false;
  }
}

/** Show rendered text: paged on an interactive terminal, else straight to stdout. */
async function present(text: string, noPager: boolean): Promise<void> {
  if (!noPager && canPrompt(false)) {
    if (await pageThrough(text)) return;
  }
  console.log(text);
}

/** The picker label for a doc: its docs-relative path, then its title. */
function optionLabel(e: DocEntry, color: boolean): string {
  if (!color) return `${e.relToDocs}  —  ${e.title}`;
  return `${colors.cyan(e.relToDocs)}  ${colors.dim("· " + e.title)}`;
}

/** The one-line corpus header both the static TOC and the interactive picker
 * show: `discern <verb> — N documents in <dir>`. The single source for "which
 * tree am I in, and how big is it" so the two surfaces can never disagree. */
function docsHeader(
  verb: string,
  tree: DocsTree,
  cwd: string,
  color: boolean,
): string {
  const paint = (fn: (s: string) => string, s: string) => color ? fn(s) : s;
  return `${paint(colors.bold, `discern ${verb}`)} — ${tree.entries.length} ` +
    `documents in ${display(tree.docsDir, cwd)}`;
}

/** The interactive browse loop: pick a doc, view it, repeat until quit. */
async function browse(
  desc: DocsVerb,
  tree: DocsTree,
  options: DocsOptions,
  cwd: string,
): Promise<number> {
  const verb = desc.verb;
  const color = colourEnabled(options.noColor);
  const width = resolveWidth(options.width);
  const QUIT = "\x00quit";
  const choices = tree.entries.map((e) => ({
    name: optionLabel(e, color),
    value: e.path,
  }));
  // Keep the corpus context visible across every re-render of the picker (it
  // redraws each iteration), so the reader always knows which tree they are
  // filtering and how large it is — the same line the static `--list` TOC leads with.
  const message = `${docsHeader(verb, tree, cwd, color)}  ·  type to filter`;
  let last: string | undefined;

  while (true) {
    let choice: string;
    try {
      choice = await selectPrompt({
        message,
        options: [
          ...choices,
          Select.separator(color ? colors.dim("─────") : "─────"),
          { name: color ? colors.dim("Quit") : "Quit", value: QUIT },
        ],
        search: true,
        info: true,
        maxRows: 14,
        ...(last !== undefined ? { default: last } : {}),
      });
    } catch {
      // Cancelled (Ctrl-C / Esc) — a clean exit, not an error.
      return 0;
    }
    if (choice === QUIT) return 0;
    last = choice;
    const entry = tree.entries.find((e) => e.path === choice);
    if (!entry) continue;
    const content = terminalBody(
      desc,
      entry,
      await Deno.readTextFile(entry.absPath),
    );
    await present(renderMarkdown(content, { width, color }), options.noPager);
  }
}

/** Print a grouped, plain table of contents to stdout. */
function printToc(
  verb: string,
  tree: DocsTree,
  cwd: string,
  color: boolean,
): void {
  const paint = (fn: (s: string) => string, s: string) => color ? fn(s) : s;
  const labelOf = (e: DocEntry) =>
    e.section ? e.relToDocs.slice(e.section.length + 1) : e.relToDocs;
  const colWidth = Math.min(
    32,
    Math.max(...tree.entries.map((e) => labelOf(e).length)),
  );

  const lines: string[] = [docsHeader(verb, tree, cwd, color)];
  let section: string | null = null;
  for (const e of tree.entries) {
    if (e.section !== section) {
      section = e.section;
      lines.push("");
      lines.push(paint(colors.bold.cyan, (section || "(root)") + "/"));
    }
    const label = labelOf(e).padEnd(colWidth);
    lines.push(`  ${paint(colors.cyan, label)}  ${paint(colors.dim, e.title)}`);
  }
  console.log(lines.join("\n"));
}

/** Render the map's top-level regions and their Git-only freshness facts. */
function printMapOverview(
  tree: DocsTree,
  cwd: string,
  regions: readonly MapRegion[],
  color: boolean,
): void {
  const paint = (fn: (s: string) => string, s: string) => color ? fn(s) : s;
  const lines = [
    `${paint(colors.bold, "discern map")} — ${regions.length} region${
      regions.length === 1 ? "" : "s"
    } in ${display(tree.docsDir, cwd)}`,
  ];
  for (const region of regions) {
    lines.push("");
    lines.push(
      `${paint(colors.bold.cyan, region.name)}  ${region.description}`,
    );
    if (
      region.pages_changed_at === undefined ||
      region.code_changes_since === undefined
    ) {
      lines.push(
        paint(
          colors.dim,
          "  freshness unknown — no specific file links or usable Git history",
        ),
      );
    } else {
      const changes = region.code_changes_since;
      lines.push(
        paint(
          colors.dim,
          `  pages last changed ${
            ageSince(region.pages_changed_at)
          }; linked code changed ${changes} time${
            changes === 1 ? "" : "s"
          } since`,
        ),
      );
    }
  }
  console.log(lines.join("\n"));
}

/** Print compact ranked hits with their reusable targets and context. */
function printSearchResults(
  verb: string,
  data: DocsData,
  color: boolean,
): void {
  const paint = (fn: (s: string) => string, value: string) =>
    color ? fn(value) : value;
  const query = data.query ?? "";
  const results = data.results ?? [];
  const scope = data.scope === undefined ? "" : ` in ${data.scope}`;
  if (results.length === 0) {
    console.log(`No ${verb} docs matched "${query}"${scope}.`);
    return;
  }
  const count = data.count ?? results.length;
  const lines = [
    `${count} result${count === 1 ? "" : "s"} for "${query}"${scope}`,
  ];
  for (const result of results) {
    const heading = result.heading === undefined ? "" : ` · ${result.heading}`;
    const match = result.match === "complete"
      ? ""
      : result.match === "partial"
      ? " · partial match"
      : " · title or alias match";
    lines.push("");
    lines.push(
      `${
        paint(colors.bold.cyan, result.target)
      }  ${result.title}${heading}${match}`,
    );
    if (result.snippet !== "") {
      lines.push(`  ${paint(colors.dim, result.snippet)}`);
    }
  }
  if (data.truncated === true) {
    lines.push("");
    lines.push(
      paint(colors.dim, `Showing the first ${results.length} results.`),
    );
  }
  console.log(lines.join("\n"));
}

/**
 * Concatenate a selected docs scope and emit it atomically from the command's
 * point of view: every source is read before stdout or the output file changes.
 */
async function exportDocs(
  desc: DocsVerb,
  options: DocsOptions,
  scope: DocsExportScope,
  log: Logger,
  cwd: string,
): Promise<number> {
  const resolved = await desc.resolveDir(options);
  const discovered = resolved.kind === "missing"
    ? undefined
    : await discoverDocs({
      cwd,
      dir: resolved.dir,
      includeInternal: scope !== "public",
    });
  if (!discovered) {
    log.error(desc.missingTree(options));
    return 1;
  }
  // `--export public` is an explicitly-published projection for either verb;
  // the wider scopes (`all`, `select`) keep everything, like the map itself.
  const tree = scope === "public"
    ? publicVerbTree(desc, discovered)
    : discovered;

  let outputPath: string | undefined;
  if (options.output) {
    outputPath = resolve(cwd, options.output);
    // The within-tree guard protects a project's editable docs/ from being
    // clobbered by its own export. `help`'s tree is discern's read-only bundled
    // documentation (a binary's embedded copy), so there is nothing to protect —
    // and probing it with realPath would be meaningless.
    if (desc.verb === "map") {
      const docsDir = await Deno.realPath(tree.docsDir);
      const canonicalOutput = await canonicalOutputPath(outputPath);
      if (pathIsWithin(docsDir, canonicalOutput)) {
        log.error(
          `refusing to write an export inside ${
            display(tree.docsDir, cwd)
          }; choose a path outside the source documentation tree.`,
        );
        return 1;
      }
    }
  }

  let entries = tree.entries;
  if (scope === "select") {
    const groups = groupDocs(entries);
    if (groups.length === 0) {
      log.warn(`no Markdown files under ${display(tree.docsDir, cwd)}.`);
      return 0;
    }

    let selected: string[];
    try {
      selected = await checkboxPrompt<string>({
        message: "Include documentation sections",
        options: groups.map((group) => ({
          name: `${group.name} (${group.entries.length})`,
          value: group.name,
          checked: !group.internal,
        })),
        minOptions: 1,
      });
    } catch {
      // Cancelled (Ctrl-C / Esc) — do not create or overwrite the output file.
      return 0;
    }

    entries = filterDocsByGroups(entries, selected);
  }

  let markdown: string;
  try {
    // Frontmatter is metadata, not content: an export concatenates document
    // BODIES. (ADR citations stay — an export's consumers are agents.)
    const sources = await Promise.all(
      entries.map(async (entry) => ({
        entry,
        content: parseFrontmatter(await Deno.readTextFile(entry.absPath)).body,
      })),
    );
    markdown = formatDocsExport(sources);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`could not read every documentation source: ${message}`);
    return 1;
  }

  if (outputPath) {
    try {
      await Deno.writeTextFile(outputPath, markdown);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`could not write "${options.output}": ${message}`);
      return 1;
    }
    log.ok(
      `Exported ${entries.length} document${
        entries.length === 1 ? "" : "s"
      } to ${display(outputPath, cwd)}.`,
    );
    return 0;
  }

  await Deno.stdout.write(new TextEncoder().encode(markdown));
  return 0;
}

/**
 * Compute a map or help {@link DiscernResult} — the machine-readable index, or a
 * single doc's record + content when `target` is given. The ONE source the CLI's
 * `--json` paths and the MCP server both render; the human, raw, and interactive
 * renderings live in {@link runTree} / {@link viewTarget}. Mirrors the human
 * resolution exactly: no tree, empty tree, target not-found / ambiguous / found,
 * or the full index. The `desc` selects the project tree (`map`) or discern's
 * bundled tree (`help`); the shape is otherwise identical.
 */
async function treeResult(
  desc: DocsVerb,
  cwd: string,
  opts: {
    target?: string | undefined;
    search?: string | undefined;
    dir?: string | undefined;
    internal?: boolean | readonly string[] | undefined;
    adr?: boolean | undefined;
  } = {},
): Promise<DiscernResult<DocsData>> {
  const resolved = await desc.resolveDir(opts);
  if (
    desc.verb === "help" && opts.adr === true && resolved.kind === "ok" &&
    !(await hasDecisionRecords(resolved.dir))
  ) {
    return {
      ok: true,
      verb: desc.verb,
      message: EXTERNAL_DECISIONS_MESSAGE,
    };
  }
  const discovered = resolved.kind === "missing"
    ? undefined
    : await discoverDocs({
      cwd,
      dir: resolved.dir,
      includeInternal: opts.internal,
    });
  const tree = discovered === undefined
    ? undefined
    : verbTree(desc, discovered, opts.internal);
  if (!tree) {
    return {
      ok: false,
      verb: desc.verb,
      error: desc.missingError,
      message: desc.missingTree(opts),
    };
  }
  if (opts.search !== undefined && opts.search.trim() === "") {
    return {
      ok: false,
      verb: desc.verb,
      error: "invalid_arguments",
      message: "`search` must contain at least one non-space character.",
    };
  }
  if (tree.entries.length === 0) {
    if (opts.search !== undefined) {
      if (opts.target !== undefined && opts.target !== "") {
        return {
          ok: false,
          verb: desc.verb,
          error: "not_found",
          message: notFoundMessage(opts.target, []),
        };
      }
      return {
        ok: true,
        verb: desc.verb,
        data: await searchData(desc, tree, opts.search),
      };
    }
    return {
      ok: true,
      verb: desc.verb,
      data: await indexData(desc, tree, cwd),
    };
  }

  if (opts.search !== undefined) {
    let searchTree = tree;
    let scope: string | undefined;
    if (opts.target !== undefined && opts.target !== "") {
      const resolvedScope = resolveSearchScope(tree, opts.target, cwd);
      if (resolvedScope.kind === "none") {
        const suggestions = suggestDocs(tree, opts.target).map((item) =>
          item.entry
        );
        return {
          ok: false,
          verb: desc.verb,
          error: "not_found",
          message: notFoundMessage(opts.target, suggestions),
          ...(suggestions.length > 0
            ? {
              data: {
                suggestions: suggestions.map(toRecord),
              } satisfies DocsData,
            }
            : {}),
        };
      }
      if (resolvedScope.kind === "ambiguous") {
        return {
          ok: false,
          verb: desc.verb,
          error: "ambiguous",
          message:
            `"${opts.target}" matches ${resolvedScope.entries.length} docs.`,
          data: {
            candidates: resolvedScope.entries.map((entry) => entry.path),
          } satisfies DocsData,
        };
      }
      searchTree = resolvedScope.tree;
      scope = resolvedScope.target;
    }
    return {
      ok: true,
      verb: desc.verb,
      data: await searchData(desc, searchTree, opts.search, scope),
    };
  }

  // A region named → its compact, filtered index.
  if (opts.target !== undefined && opts.target !== "") {
    const region = resolveDocRegion(tree, opts.target, cwd);
    if (region !== undefined) {
      return {
        ok: true,
        verb: desc.verb,
        data: {
          ...await indexData(desc, { ...tree, entries: region.entries }, cwd),
          scope: region.name,
        },
      };
    }
  }

  // A specific doc named → that one's record + content.
  if (opts.target !== undefined && opts.target !== "") {
    const res = resolveDoc(tree, opts.target, cwd);
    if (res.kind === "none") {
      const suggestions = suggestDocs(tree, opts.target).map((item) =>
        item.entry
      );
      return {
        ok: false,
        verb: desc.verb,
        error: "not_found",
        message: notFoundMessage(opts.target, suggestions),
        ...(suggestions.length > 0
          ? {
            data: { suggestions: suggestions.map(toRecord) } satisfies DocsData,
          }
          : {}),
      };
    }
    if (res.kind === "ambiguous") {
      return {
        ok: false,
        verb: desc.verb,
        error: "ambiguous",
        message: `"${opts.target}" matches ${res.entries.length} docs.`,
        data: {
          candidates: res.entries.map((e) => e.path),
        } satisfies DocsData,
      };
    }
    // Structured meta + stripped content: the frontmatter's values are on the
    // record, never in `content`; a raw read is `--raw`'s job, not JSON's.
    const content = renderableBody(
      desc,
      await Deno.readTextFile(res.entry.absPath),
    );
    return {
      ok: true,
      verb: desc.verb,
      data: {
        doc: {
          ...toRecord(res.entry),
          content,
          ...(res.entry.citedAdrs.length > 0
            ? { cited_adrs: res.entry.citedAdrs }
            : {}),
        },
      } satisfies DocsData,
    };
  }

  // No target → the index.
  return {
    ok: true,
    verb: desc.verb,
    data: await indexData(desc, tree, cwd),
  };
}

/**
 * The `map` result core — {@link treeResult} over the project's agent-maintained
 * tree. Backs the CLI's `--json` path and the MCP `discern_map` tool.
 */
export function mapResult(
  cwd: string,
  opts: {
    target?: string | undefined;
    search?: string | undefined;
    dir?: string | undefined;
  } = {},
): Promise<DiscernResult<DocsData>> {
  return treeResult(MAP_VERB, cwd, opts);
}

/**
 * The `help` result core — {@link treeResult} over discern's OWN bundled docs.
 * The single shape a future `discern_help` MCP tool and the CLI's `--json` path
 * both render, mirroring {@link mapResult}. (No `--dir`: the doc set is fixed.)
 */
export function helpResult(
  cwd: string,
  opts: { target?: string | undefined; search?: string | undefined } = {},
): Promise<DiscernResult<DocsData>> {
  return treeResult(HELP_VERB, cwd, opts);
}

/** Resolve a `--target`, then render or raw-dump that single doc (human path;
 * `--json` goes through {@link treeResult}). */
async function viewTarget(
  desc: DocsVerb,
  tree: DocsTree,
  options: DocsOptions,
  log: Logger,
  cwd: string,
  target: string,
): Promise<number> {
  const verb = desc.verb;
  const res = resolveDoc(tree, target, cwd);

  if (res.kind === "none") {
    const suggestions = suggestDocs(tree, target).map((item) => item.entry);
    log.error(notFoundMessage(target, suggestions));
    for (const label of suggestionLabels(suggestions)) {
      log.detail(label);
    }
    log.detail(`list what's available: discern ${verb} --list`);
    return 1;
  }

  if (res.kind === "ambiguous") {
    log.error(
      `"${target}" matches ${res.entries.length} docs. Qualify it with a section or path:`,
    );
    for (const e of res.entries) log.detail(e.path);
    return 1;
  }

  const content = await Deno.readTextFile(res.entry.absPath);
  if (options.raw) {
    // Pristine source — exactly the file's bytes, no added newline. The RAW
    // contract: frontmatter and citations included, always.
    await Deno.stdout.write(new TextEncoder().encode(content));
    return 0;
  }
  const color = colourEnabled(options.noColor);
  const rendered = renderMarkdown(terminalBody(desc, res.entry, content), {
    width: resolveWidth(options.width),
    color,
  });
  await present(rendered, options.noPager);
  return 0;
}

/**
 * Run a map or help browse. Returns a process exit code. The `desc` selects the
 * tree (`map` → the project's map; `help` → discern's bundled docs); the
 * argument dispatch, export pipeline, `--json` surface, interactive browser, and
 * pager are shared verbatim.
 */
async function runTree(desc: DocsVerb, options: DocsOptions): Promise<number> {
  const log = new Logger(options);
  const cwd = Deno.cwd();

  if (options.output && !options.export) {
    return invalidOptions(log, desc.verb, "--output requires --export.");
  }

  if (options.export) {
    const scope = exportScope(options.export, desc.exportScopes);
    if (!scope) {
      return invalidOptions(
        log,
        desc.verb,
        `unknown export scope "${options.export}"; expected ${
          listScopes(desc.exportScopes)
        }.`,
      );
    }

    const conflicts = [
      options.target !== undefined ? "a target" : undefined,
      options.search !== undefined ? "--search" : undefined,
      options.json ? "--json" : undefined,
      options.raw ? "--raw" : undefined,
      options.list ? "--list" : undefined,
      options.adr ? "--adr" : undefined,
      options.width !== undefined ? "--width" : undefined,
      options.noPager ? "--no-pager" : undefined,
    ].filter((value): value is string => value !== undefined);
    if (conflicts.length > 0) {
      return invalidOptions(
        log,
        desc.verb,
        `--export cannot be combined with ${conflicts.join(", ")}.`,
      );
    }

    if (scope === "select") {
      if (!options.output) {
        return invalidOptions(
          log,
          desc.verb,
          "--export select requires --output <path>.",
        );
      }
      if (!canPrompt(false)) {
        return invalidOptions(
          log,
          desc.verb,
          "--export select requires an interactive terminal.",
        );
      }
    }

    return await exportDocs(desc, options, scope, log, cwd);
  }

  // `help --adr` widens discovery to the bundled ADR subtree; every other browse
  // (and every `map` browse, and the MCP path) stays public-only.
  const internal = internalScope(desc, options);

  if (options.search !== undefined && (options.raw || options.list)) {
    const conflicts = [
      options.raw ? "--raw" : undefined,
      options.list ? "--list" : undefined,
    ].filter((value): value is string => value !== undefined);
    return invalidOptions(
      log,
      desc.verb,
      `--search cannot be combined with ${conflicts.join(", ")}.`,
    );
  }

  // `--json`: the entire machine-readable surface (index, single doc, or error)
  // is {@link treeResult} — the one shape the MCP server also renders. The human,
  // raw, and interactive renderings below never run under `--json`.
  if (options.json) {
    const result = await treeResult(desc, cwd, {
      target: options.target,
      search: options.search,
      dir: options.dir,
      internal,
      adr: options.adr,
    });
    log.result(result);
    return result.ok ? 0 : 1;
  }

  const resolved = await desc.resolveDir(options);
  if (
    desc.verb === "help" && options.adr === true && resolved.kind === "ok" &&
    !(await hasDecisionRecords(resolved.dir))
  ) {
    log.line(EXTERNAL_DECISIONS_MESSAGE);
    return 0;
  }
  const discovered = resolved.kind === "missing"
    ? undefined
    : await discoverDocs({ cwd, dir: resolved.dir, includeInternal: internal });
  const tree = discovered === undefined
    ? undefined
    : verbTree(desc, discovered, internal);
  if (!tree) {
    log.error(desc.missingTree(options));
    return 1;
  }
  if (options.search !== undefined && options.search.trim() === "") {
    log.error("--search must contain at least one non-space character.");
    return 1;
  }
  if (tree.entries.length === 0) {
    if (options.search !== undefined) {
      if (options.target !== undefined && options.target !== "") {
        log.error(notFoundMessage(options.target, []));
        return 1;
      }
      printSearchResults(
        desc.verb,
        await searchData(desc, tree, options.search),
        colourEnabled(options.noColor),
      );
      return 0;
    }
    log.warn(`no Markdown files under ${display(tree.docsDir, cwd)}.`);
    return 0;
  }

  if (options.search !== undefined) {
    let searchTree = tree;
    let scope: string | undefined;
    if (options.target !== undefined && options.target !== "") {
      const resolvedScope = resolveSearchScope(
        tree,
        options.target,
        cwd,
      );
      if (resolvedScope.kind === "none") {
        const suggestions = suggestDocs(tree, options.target).map((item) =>
          item.entry
        );
        log.error(notFoundMessage(options.target, suggestions));
        return 1;
      }
      if (resolvedScope.kind === "ambiguous") {
        log.error(
          `"${options.target}" matches ${resolvedScope.entries.length} docs. ` +
            "Qualify it with a section or path.",
        );
        return 1;
      }
      searchTree = resolvedScope.tree;
      scope = resolvedScope.target;
    }
    printSearchResults(
      desc.verb,
      await searchData(desc, searchTree, options.search, scope),
      colourEnabled(options.noColor),
    );
    return 0;
  }

  // 1. A region was named → print its compact table of contents.
  if (options.target !== undefined && options.target !== "") {
    const region = resolveDocRegion(tree, options.target, cwd);
    if (region !== undefined) {
      printToc(
        desc.verb,
        { ...tree, entries: region.entries },
        cwd,
        colourEnabled(options.noColor),
      );
      return 0;
    }
  }

  // 2. A specific doc was named → render / raw-dump just that one.
  if (options.target !== undefined && options.target !== "") {
    return await viewTarget(desc, tree, options, log, cwd, options.target);
  }

  // 3. `map` earns its name with a region overview before any drill-in. A pipe
  // gets the overview alone; a TTY continues into the existing picker.
  const interactive = !options.list && canPrompt(false);
  if (desc.verb === "map" && !options.list) {
    const regions = await buildMapOverview(tree);
    printMapOverview(
      tree,
      cwd,
      regions,
      colourEnabled(options.noColor),
    );
    if (!interactive) return 0;
  }

  // 4. A real terminal and no `--list` → the interactive browser.
  if (interactive) {
    return await browse(desc, tree, options, cwd);
  }

  // 5. Otherwise (help off a TTY, or explicit `--list`) → a plain TOC.
  printToc(desc.verb, tree, cwd, colourEnabled(options.noColor));
  return 0;
}

/** Run `discern map` — browse the project's agent-maintained documentation tree. */
export function runMap(options: DocsOptions): Promise<number> {
  return runTree(MAP_VERB, options);
}

/** Run `discern help` — browse discern's OWN bundled documentation. */
export function runHelp(options: DocsOptions): Promise<number> {
  return runTree(HELP_VERB, options);
}
