/**
 * `discern map` and `discern docs` — browse and read a documentation tree.
 *
 * The two verbs share every line of this file through a {@link DocsVerb}
 * descriptor (ADR 0039); only the tree they read differs: `map` serves the
 * project's agent-maintained map (resolved from the project root), `docs` serves
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

import {
  renderDocsHeaderCli,
  renderSectionCli,
} from "discern-design-system/cli";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  SEPARATOR,
} from "@std/path";
import { Logger } from "../lib/log.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import { displayWidth, padDisplayEnd, wrapText } from "../lib/text.ts";
import {
  type TerminalContext,
  terminalContext,
  terminalContextWithColor,
  terminalLine,
  terminalMultiline,
} from "../lib/terminal.ts";
import {
  browserOpenFailureMessage,
  openInBrowser,
} from "../lib/open_browser.ts";
import {
  canonicalDocTarget,
  discoverDocs,
  type DocEntry,
  type DocsTree,
  filterDocsByGroups,
  findProjectRoot,
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
import { pathMatchesPattern } from "../engine/scopes/glob.ts";
import { loadConfig } from "../shared/config_schema.ts";
import { expandMapDirReference } from "../shared/map_path.ts";
import { observeVerbTarget } from "../shared/result_capture.ts";
import {
  DOCS_ADR_DOC_DIR,
  isBundledDocEntry,
  resolveBundledDocsDir,
} from "../lib/paths.ts";
import {
  type DiscernResult,
  type ErrorSlug,
  type HumanOutputGroup,
  renderHumanOutputGroups,
} from "../shared/result.ts";
import {
  failureRecoveryHintTexts,
  fire,
  HINTS,
  hintTexts,
} from "../shared/hints.ts";
import type {
  DocRecord,
  DocsData,
  DocSearchResult,
} from "../shared/result_schemas.ts";
import {
  canPrompt,
  checkboxPrompt,
  groupedSelectOptions,
  isPromptCancellation,
  selectPrompt,
} from "../lib/prompts.ts";
import {
  ageSince,
  buildMapOverview,
  type MapRegion,
} from "../lib/map_overview.ts";
import { DISCERN_DOCS_URL } from "../shared/brand.ts";

/** The built-in concatenated Markdown export scopes. */
type DocsExportScope = "public" | "all" | "select";

const READ_DOCS_ONLINE = "\x00read-docs-online";
const QUIT_BROWSE = "\x00quit";

/** Navigation actions for the interactive tree browser. Only discern's own
 * manual has an equivalent online home; a project's map stays local. */
export function docsBrowseNavigationChoices(
  verb: "map" | "docs",
  _color: boolean,
): Array<{ name: string; value: string }> {
  return [
    ...(verb === "docs"
      ? [{ name: "Read the docs online", value: READ_DOCS_ONLINE }]
      : []),
    {
      name: "Quit",
      value: QUIT_BROWSE,
    },
  ];
}

/**
 * A resolved `--export` value: a built-in projection, or — on the `map` verb —
 * a configured `[scopes.<name>]` acting as a curated reading list. A configured
 * scope decides both WHICH map documents export and their ORDER: documents
 * concatenate by the scope's declared `paths` sequence (a pattern matching
 * several documents keeps their map reading order; a document matched twice
 * keeps its first position). Built-in names win over a configured scope of the
 * same name.
 */
type ExportSelection =
  | { kind: "builtin"; scope: DocsExportScope }
  | { kind: "configured"; name: string; patterns: string[] };

/** A failed `--export` resolution; `message` names every accepted value. */
interface ExportUnknown {
  kind: "unknown";
  message: string;
}

/**
 * The project's configured `[scopes.<name>]` tables as export candidates:
 * scope name → its `paths` with `${map.dir}` expanded. Read best-effort — no
 * project root, or a missing/invalid discern.toml, leaves only the built-in
 * export scopes rather than failing a browse-adjacent command.
 */
async function configuredExportScopes(
  cwd: string,
): Promise<Map<string, string[]>> {
  const root = await findProjectRoot(cwd);
  if (root === undefined) return new Map();
  try {
    const config = await loadConfig(root);
    return new Map(
      Object.entries(config.scopes).map(([name, scope]) => [
        name,
        scope.paths.map((path) => expandMapDirReference(path, config.map.dir)),
      ]),
    );
  } catch {
    return new Map();
  }
}

/**
 * Parse an `--export` value: the verb's built-in scopes first, then — for the
 * project-owned `map` tree only — the configured `[scopes.<name>]` tables.
 * `docs` serves discern's fixed bundled manual, which no project scope
 * describes, so it never consults the config.
 */
async function resolveExportSelection(
  desc: DocsVerb,
  value: string,
  cwd: string,
): Promise<ExportSelection | ExportUnknown> {
  const builtin = exportScope(value, desc.exportScopes);
  if (builtin !== undefined) return { kind: "builtin", scope: builtin };
  const configured = desc.verb === "map"
    ? await configuredExportScopes(cwd)
    : new Map<string, string[]>();
  const patterns = configured.get(value);
  if (patterns !== undefined) {
    return { kind: "configured", name: value, patterns };
  }
  const names = [...configured.keys()];
  const alternatives = names.length > 0
    ? `, or a configured scope (${names.join(", ")})`
    : "";
  return {
    kind: "unknown",
    message: `unknown export scope "${value}"; expected ${
      listScopes(desc.exportScopes)
    }${alternatives}.`,
  };
}

/**
 * How `discern map` (the project's agent-maintained documentation tree) and `discern docs`
 * (discern's OWN bundled documentation) differ. Everything else — the
 * interactive browser, the renderer, target resolution, `--list`, `--json`, and
 * export — operates on a resolved {@link DocsTree} + {@link DocsOptions} and is
 * shared verbatim (ADR 0039). Only three things vary: which directory is read,
 * the verb label carried in results/messages, and the wording when the tree is
 * missing.
 */
interface DocsVerb {
  /** The label in every {@link DiscernResult} and user-facing message. */
  verb: "map" | "docs";
  /** Machine-stable error slug when the tree is absent (`no_map` / `no_docs`). */
  missingError: ErrorSlug;
  /**
   * Resolve the directory to hand {@link discoverDocs}. `map` passes a user
   * `--dir` through (and `undefined` keeps discovery's project-root default);
   * `docs` resolves discern's bundled tree and reports `missing` when a binary
   * was built without it (it must NEVER fall back to a project's `docs/`).
   */
  resolveDir(opts: { dir?: string | undefined }): Promise<DirResolution>;
  /** The human message when no tree is found (verb-specific wording). */
  missingTree(opts: { dir?: string | undefined }): string;
  /** Export scopes this verb accepts (`docs` is public-only — no internal tree). */
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

/** `discern docs` — discern's OWN documentation, bundled into every install. */
const DOCS_VERB: DocsVerb = {
  verb: "docs",
  missingError: "no_docs",
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
 * The internal-subtree policy for a browse. In a source checkout, `docs --adr`
 * reveals the decision tree — and only that — never `_internal` / `_private`.
 * Installed binaries do not contain the tree and point readers to its public
 * homes instead.
 */
function internalScope(
  desc: DocsVerb,
  options: DocsOptions,
): boolean | readonly string[] {
  return desc.verb === "docs" && options.adr ? [DOCS_ADR_DOC_DIR] : false;
}

/**
 * Whether a browse target explicitly names the decision-record subtree — an
 * `_adr` segment in any target form the resolvers accept (`_adr`,
 * `_adr/<slug>`, a `…/_adr/….md` path). Naming it IS the opt-in `--adr`
 * spells, on every surface including MCP: the records are public (the site
 * publishes them), only tucked out of the default browse, so a caller who
 * already spells the buried segment is never refused for omitting the flag.
 * `_internal` / `_private` carry a real audience boundary and are never
 * widened this way.
 */
function targetNamesAdrSubtree(target: string | undefined): boolean {
  return target !== undefined &&
    target.split("/").some((seg) => seg === DOCS_ADR_DOC_DIR);
}

/** Widen an internal-subtree policy with the subtree the target names. */
function widenInternalForTarget(
  internal: boolean | readonly string[],
  target: string | undefined,
): boolean | readonly string[] {
  if (internal === true || !targetNamesAdrSubtree(target)) {
    return internal;
  }
  const list = internal === false ? [] : internal;
  return list.includes(DOCS_ADR_DOC_DIR) ? list : [...list, DOCS_ADR_DOC_DIR];
}

/** Whether the resolved source tree actually carries the checkout-only records. */
async function hasDecisionRecords(dir: string | undefined): Promise<boolean> {
  if (dir === undefined) return false;
  try {
    return (await Deno.stat(join(dir, DOCS_ADR_DOC_DIR))).isDirectory;
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

/** Whether a checkout-only docs subtree was explicitly opened for this view. */
function docsInternalAllowed(
  entry: DocEntry,
  internal: boolean | readonly string[] | undefined,
): boolean {
  return Array.isArray(internal) && internal.includes(docTopLevel(entry));
}

/**
 * Apply both publication axes to a public projection. Page publication comes
 * from `isPublicDoc` through {@link publicDocs}; discern docs additionally
 * applies the manual's default-deny section registry. Enforcing both at view
 * time keeps source checkouts, test overrides, and pre-curated binary stages
 * behaviorally identical.
 */
function publicVerbTree(desc: DocsVerb, tree: DocsTree): DocsTree {
  const entries = publicDocs(tree.entries);
  return desc.verb === "docs"
    ? {
      ...tree,
      entries: entries.filter((entry) => isBundledDocEntry(docTopLevel(entry))),
    }
    : { ...tree, entries };
}

/**
 * Apply the verb's browse policy to a discovered tree. `docs` is the published
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
    docsInternalAllowed(entry, internal)
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
 * output (its values travel as structured fields), and `docs` — prose humans
 * read — additionally loses inline ADR citations. `map` content keeps its
 * citations: its readers are agents, who navigate by them. RAW surfaces
 * (`--raw`, `.md` editions) bypass this entirely — pristine bytes by contract.
 */
function renderableBody(desc: DocsVerb, content: string): string {
  const { body } = parseFrontmatter(content);
  return desc.verb === "docs" ? stripAdrCitations(body) : body;
}

/** Add a human terminal footer without changing JSON, export, or raw bodies. */
function terminalBody(
  desc: DocsVerb,
  entry: DocEntry,
  content: string,
): string {
  const body = renderableBody(desc, content);
  if (desc.verb !== "docs" || entry.citedAdrs.length === 0) return body;
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
  /** `docs` only: also surface the bundled ADR subtree (hidden by default). */
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

/** Index payload; `docs` deliberately omits a local map_dir path. */
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

/** Compact names for nearest-match guidance. Each label leads with the
 * canonical target so retrying the suggestion verbatim resolves — a bare slug
 * would refuse for a buried entry (`_adr/…`) whose section is the opt-in. */
function suggestionLabels(suggestions: readonly DocEntry[]): string[] {
  return suggestions.map((entry) =>
    entry.slug === "README"
      ? entry.path
      : `${canonicalDocTarget(entry)} (${entry.path})`
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
function invalidOptions(
  log: Logger,
  verb: DocsVerb["verb"],
  message: string,
): number {
  if (log.json) {
    log.result({
      ok: false,
      verb,
      error: "invalid_arguments",
      message,
      hints: failureRecoveryHintTexts(verb),
    });
  } else {
    log.error(terminalLine(message));
  }
  return 1;
}

/**
 * Resolve the wrap width: an explicit `--width` wins; otherwise the terminal
 * width (or `$COLUMNS`), capped to a readable maximum with a small margin, and
 * falling back to 80 off a TTY.
 */
function resolveWidth(
  explicit: number | undefined,
  terminal: TerminalContext,
): number {
  if (explicit && explicit > 0) return Math.floor(explicit);
  const cols = terminal.capabilities.columns;
  return Math.max(20, Math.min(cols - 2, 100));
}

/** Apply the command's explicit no-colour decision to the active CLI context. */
function docsTerminal(noColor: boolean): TerminalContext {
  const base = terminalContext();
  return terminalContextWithColor(base, base.color && !noColor);
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

/** The semantic picker label; prompt rendering owns selection-state styling. */
function optionLabel(e: DocEntry): string {
  return terminalLine(`${e.relToDocs}  —  ${e.title}`);
}

/** The one-line corpus fact kept plain for the interactive prompt seam. */
function docsHeaderFact(
  verb: string,
  count: number,
  directory: string,
): string {
  return terminalLine(
    `discern ${verb} — ${count} documents in ${directory}`,
  );
}

/** Render one exact corpus fact through the package Docs Header Component. */
export function renderDocsCorpusHeader(
  verb: string,
  count: number,
  directory: string,
  width: number,
  terminal: TerminalContext,
): string {
  const fact = docsHeaderFact(verb, count, directory);
  if (!terminal.stdoutIsTerminal) return fact;
  const safeDirectory = terminalLine(directory);
  return renderDocsHeaderCli(
    {
      brand: terminalLine(`discern ${verb}`),
      middle: terminalLine(`— ${count} documents in ${safeDirectory}`),
      theme: terminal.themeVariant,
      maxWidth: width,
    },
    { ...terminal.capabilities, columns: width },
  );
}

/** Adapt a discovered tree to the pure corpus-header renderer. */
function docsHeader(
  verb: string,
  tree: DocsTree,
  cwd: string,
  width: number,
  terminal: TerminalContext,
): string {
  return renderDocsCorpusHeader(
    verb,
    tree.entries.length,
    display(tree.docsDir, cwd),
    width,
    terminal,
  );
}

/** The interactive browse loop: pick a doc, view it, repeat until quit. */
async function browse(
  desc: DocsVerb,
  tree: DocsTree,
  options: DocsOptions,
  cwd: string,
  terminal: TerminalContext,
): Promise<number> {
  const verb = desc.verb;
  const width = resolveWidth(options.width, terminal);
  const choices = tree.entries.map((e) => ({
    name: optionLabel(e),
    value: e.path,
  }));
  // Keep the corpus context visible across every re-render of the picker (it
  // redraws each iteration), so the reader always knows which tree they are
  // filtering and how large it is — the same line the static `--list` TOC leads with.
  const message = terminalLine(
    `${
      docsHeaderFact(verb, tree.entries.length, display(tree.docsDir, cwd))
    }  ·  type to filter`,
  );
  while (true) {
    let choice: string;
    try {
      choice = await selectPrompt({
        message,
        options: groupedSelectOptions([
          {
            id: "documents",
            label: "Documents",
            items: choices,
          },
          {
            id: "browse-navigation",
            label: "Browse",
            items: docsBrowseNavigationChoices(verb, terminal.color),
          },
        ]),
        search: true,
        maxRows: 14,
      });
    } catch (error) {
      if (!isPromptCancellation(error)) throw error;
      // Ctrl-C or end-of-input leaves the browser without changing anything.
      return 0;
    }
    if (choice === QUIT_BROWSE) return 0;
    if (choice === READ_DOCS_ONLINE) {
      const opened = await openInBrowser(DISCERN_DOCS_URL);
      if (opened.status !== "opened") {
        console.error(
          terminalLine(
            browserOpenFailureMessage("the docs", DISCERN_DOCS_URL, opened),
          ),
        );
      }
      continue;
    }
    const entry = tree.entries.find((e) => e.path === choice);
    if (!entry) continue;
    observeVerbTarget(canonicalDocTarget(entry));
    const content = terminalBody(
      desc,
      entry,
      await Deno.readTextFile(entry.absPath),
    );
    await present(
      renderMarkdown(content, {
        width,
        color: terminal.color,
        terminal,
      }),
      options.noPager,
    );
  }
}

/** Print a grouped, plain table of contents to stdout. */
function printToc(
  verb: string,
  tree: DocsTree,
  cwd: string,
  terminal: TerminalContext,
  width: number,
): void {
  const labelOf = (e: DocEntry) =>
    terminalLine(
      e.section ? e.relToDocs.slice(e.section.length + 1) : e.relToDocs,
    );

  const groups: HumanOutputGroup<string>[] = [{
    id: "contents-summary",
    items: [docsHeader(verb, tree, cwd, width, terminal)],
  }];
  const sections = new Map<string, DocEntry[]>();
  for (const e of tree.entries) {
    const section = e.section || "root";
    const entries = sections.get(section) ?? [];
    entries.push(e);
    sections.set(section, entries);
  }
  const capabilities = { ...terminal.capabilities, columns: width };
  for (const [section, entries] of sections) {
    const safeSection = terminalLine(section);
    const colWidth = Math.min(
      32,
      Math.max(...entries.map((entry) => displayWidth(labelOf(entry)))),
    );
    const rows = entries.map((entry) => {
      const label = labelOf(entry);
      const title = terminalLine(entry.title);
      const aligned = `  ${padDisplayEnd(label, colWidth)}  ${title}`;
      if (terminal.stdoutIsTerminal || displayWidth(aligned) <= width) {
        return aligned;
      }
      return wrapText(
        `${label}  ${title}`,
        Math.max(1, width - 2),
        "",
        { breakLongWords: true },
      ).map((line) => `  ${line}`).join("\n");
    });
    const title = `${safeSection === "root" ? "(root)" : safeSection}/`;
    const body = terminal.stdoutIsTerminal
      ? renderSectionCli(
        {
          title: terminalLine(title),
          body: terminalMultiline(rows.join("\n")),
          treatment: "rule",
          spacing: "sm",
          theme: terminal.themeVariant,
          width,
        },
        capabilities,
      )
      : [
        title,
        ...rows,
      ].join("\n");
    groups.push({
      id: `contents:${section}`,
      items: [body],
    });
  }
  console.log(renderHumanOutputGroups(groups));
}

/** Render the map's top-level regions and their Git-only freshness facts. */
function printMapOverview(
  tree: DocsTree,
  cwd: string,
  regions: readonly MapRegion[],
  terminal: TerminalContext,
  width: number,
): void {
  const capabilities = { ...terminal.capabilities, columns: width };
  const directory = terminalLine(display(tree.docsDir, cwd));
  const summary = terminalLine(
    `discern map — ${regions.length} region${
      regions.length === 1 ? "" : "s"
    } in ${directory}`,
  );
  const groups: HumanOutputGroup<string>[] = [{
    id: "map-summary",
    items: [
      terminal.stdoutIsTerminal
        ? renderDocsHeaderCli(
          {
            brand: "discern map",
            middle: terminalLine(
              `— ${regions.length} region${
                regions.length === 1 ? "" : "s"
              } in ${directory}`,
            ),
            theme: terminal.themeVariant,
            maxWidth: width,
          },
          capabilities,
        )
        : summary,
    ],
  }];
  for (const [index, region] of regions.entries()) {
    const name = terminalLine(region.name);
    const details: string[] = [terminalMultiline(region.description)];
    if (
      region.pages_changed_at === undefined ||
      region.code_changes_since === undefined
    ) {
      details.push(
        "freshness unknown — no specific file links or usable Git history",
      );
    } else {
      const changes = region.code_changes_since;
      details.push(
        `pages last changed ${
          ageSince(region.pages_changed_at)
        }; linked code changed ${changes} time${
          changes === 1 ? "" : "s"
        } since`,
      );
    }
    const safeDetails = terminalMultiline(details.join("\n"));
    const body = terminal.stdoutIsTerminal
      ? renderSectionCli(
        {
          title: terminalLine(name),
          body: terminalMultiline(safeDetails),
          treatment: "rule",
          spacing: "sm",
          theme: terminal.themeVariant,
          width,
        },
        capabilities,
      )
      : `${name}  ${safeDetails.replaceAll("\n", "\n  ")}`;
    groups.push({
      id: `map-region:${index}`,
      items: [body],
    });
  }
  console.log(renderHumanOutputGroups(groups));
}

/** Print compact ranked hits with their reusable targets and context. */
function printSearchResults(
  verb: string,
  data: DocsData,
  terminal: TerminalContext,
  width: number,
): void {
  const capabilities = { ...terminal.capabilities, columns: width };
  const query = terminalLine(data.query ?? "");
  const results = data.results ?? [];
  const scope = data.scope === undefined
    ? ""
    : ` in ${terminalLine(data.scope)}`;
  if (results.length === 0) {
    console.log(terminalLine(`No ${verb} docs matched "${query}"${scope}.`));
    return;
  }
  const count = data.count ?? results.length;
  const groups: HumanOutputGroup<string>[] = [{
    id: "search-summary",
    items: [
      terminal.stdoutIsTerminal
        ? renderDocsHeaderCli(
          {
            brand: terminalLine(
              `${count} result${count === 1 ? "" : "s"}`,
            ),
            middle: terminalLine(`for "${query}"${scope}`),
            theme: terminal.themeVariant,
            maxWidth: width,
          },
          capabilities,
        )
        : `${count} result${count === 1 ? "" : "s"} for "${query}"${scope}`,
    ],
  }];
  for (const [index, result] of results.entries()) {
    const heading = result.heading === undefined
      ? ""
      : ` · ${terminalLine(result.heading)}`;
    const match = result.match === "complete"
      ? ""
      : result.match === "partial"
      ? " · partial match"
      : " · title or alias match";
    const items: string[] = [
      terminalLine(`${terminalLine(result.title)}${heading}${match}`),
    ];
    if (result.snippet !== "") {
      items.push(terminalMultiline(result.snippet));
    }
    const target = terminalLine(result.target);
    groups.push({
      id: `search-result:${index}`,
      items: [
        terminal.stdoutIsTerminal
          ? renderSectionCli(
            {
              body: terminalMultiline([target, ...items].join("\n")),
              surface: "sunken",
              spacing: "sm",
              theme: terminal.themeVariant,
              width,
            },
            capabilities,
          )
          : [
            `${target}  ${items[0] ?? ""}`,
            ...items.slice(1).map((item) => `  ${item}`),
          ].join("\n"),
      ],
    });
  }
  if (data.truncated === true) {
    groups.push({
      id: "search-truncation",
      items: [
        terminal.stdoutIsTerminal
          ? terminal.role(
            `Showing the first ${results.length} results.`,
            "muted",
          )
          : `Showing the first ${results.length} results.`,
      ],
    });
  }
  console.log(renderHumanOutputGroups(groups));
}

/**
 * Concatenate a selected docs scope and emit it atomically from the command's
 * point of view: every source is read before stdout or the output file changes.
 * A configured scope concatenates in its declared `paths` order.
 */
async function exportDocs(
  desc: DocsVerb,
  options: DocsOptions,
  selection: ExportSelection,
  log: Logger,
  cwd: string,
): Promise<number> {
  const resolved = await desc.resolveDir(options);
  // A configured scope names exactly the documents it wants — spelling a
  // `_`-buried path IS its opt-in, so discovery admits the whole tree and the
  // scope's own patterns decide (the same width `--export all` already has).
  const includeInternal = selection.kind === "configured" ||
    selection.scope !== "public";
  const discovered = resolved.kind === "missing"
    ? undefined
    : await discoverDocs({
      cwd,
      dir: resolved.dir,
      includeInternal,
    });
  if (!discovered) {
    log.error(terminalLine(desc.missingTree(options)));
    return 1;
  }
  // `--export public` is an explicitly-published projection for either verb;
  // the wider scopes (`all`, `select`, a configured scope) keep everything,
  // like the map itself.
  const tree = selection.kind === "builtin" && selection.scope === "public"
    ? publicVerbTree(desc, discovered)
    : discovered;

  let outputPath: string | undefined;
  if (options.output) {
    outputPath = resolve(cwd, options.output);
    // The within-tree guard protects a project's editable docs/ from being
    // clobbered by its own export. `docs`' tree is discern's read-only bundled
    // documentation (a binary's embedded copy), so there is nothing to protect —
    // and probing it with realPath would be meaningless.
    if (desc.verb === "map") {
      const docsDir = await Deno.realPath(tree.docsDir);
      const canonicalOutput = await canonicalOutputPath(outputPath);
      if (pathIsWithin(docsDir, canonicalOutput)) {
        log.error(terminalLine(
          `refusing to write an export inside ${
            display(tree.docsDir, cwd)
          }; choose a path outside the source documentation tree.`,
        ));
        return 1;
      }
    }
  }

  let entries = tree.entries;
  if (selection.kind === "configured") {
    const seen = new Set<string>();
    const ordered: DocEntry[] = [];
    for (const pattern of selection.patterns) {
      const matches = tree.entries.filter((entry) =>
        pathMatchesPattern(entry.path, pattern)
      );
      if (matches.length === 0) {
        log.warn(terminalLine(
          `scope "${selection.name}" path "${pattern}" matches no map documents.`,
        ));
      }
      for (const match of matches) {
        if (!seen.has(match.path)) {
          seen.add(match.path);
          ordered.push(match);
        }
      }
    }
    entries = ordered;
  } else if (selection.scope === "select") {
    const groups = groupDocs(entries);
    if (groups.length === 0) {
      log.warn(terminalLine(
        `no Markdown files under ${display(tree.docsDir, cwd)}.`,
      ));
      return 0;
    }

    let selected: string[];
    try {
      selected = await checkboxPrompt<string>({
        message: "Include documentation sections",
        options: groups.map((group) => ({
          name: terminalLine(`${group.name} (${group.entries.length})`),
          value: group.name,
          checked: !group.internal,
        })),
        minOptions: 1,
      });
    } catch (error) {
      if (!isPromptCancellation(error)) throw error;
      // Cancellation does not create or overwrite the output file.
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
    log.terminalSafeMultilineError(
      terminalMultiline(
        `could not read every documentation source: ${message}`,
      ),
    );
    return 1;
  }

  if (outputPath) {
    try {
      await Deno.writeTextFile(outputPath, markdown);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.terminalSafeMultilineError(
        terminalMultiline(
          `could not write "${options.output}": ${message}`,
        ),
      );
      return 1;
    }
    log.ok(terminalLine(
      `Exported ${entries.length} document${
        entries.length === 1 ? "" : "s"
      } to ${display(outputPath, cwd)}.`,
    ));
    return 0;
  }

  await Deno.stdout.write(new TextEncoder().encode(markdown));
  return 0;
}

/**
 * Compute a map or docs {@link DiscernResult} — the machine-readable index, or a
 * single doc's record + content when `target` is given. The ONE source the CLI's
 * `--json` paths and the MCP server both render; the human, raw, and interactive
 * renderings live in {@link runTree} / {@link viewTarget}. Mirrors the human
 * resolution exactly: no tree, empty tree, target not-found / ambiguous / found,
 * or the full index. The `desc` selects the project tree (`map`) or discern's
 * bundled tree (`docs`); the shape is otherwise identical.
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
    desc.verb === "docs" &&
    (opts.adr === true || targetNamesAdrSubtree(opts.target)) &&
    resolved.kind === "ok" && !(await hasDecisionRecords(resolved.dir))
  ) {
    return {
      ok: true,
      verb: desc.verb,
      message: EXTERNAL_DECISIONS_MESSAGE,
    };
  }
  const internal = widenInternalForTarget(opts.internal ?? false, opts.target);
  const discovered = resolved.kind === "missing"
    ? undefined
    : await discoverDocs({
      cwd,
      dir: resolved.dir,
      includeInternal: internal,
    });
  const tree = discovered === undefined
    ? undefined
    : verbTree(desc, discovered, internal);
  if (!tree) {
    return {
      ok: false,
      verb: desc.verb,
      error: desc.missingError,
      message: desc.missingTree(opts),
      hints: failureRecoveryHintTexts(desc.verb),
    };
  }
  if (opts.search !== undefined && opts.search.trim() === "") {
    return {
      ok: false,
      verb: desc.verb,
      error: "invalid_arguments",
      message: "`search` must contain at least one non-space character.",
      hints: failureRecoveryHintTexts(desc.verb),
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
          hints: hintTexts([fire(HINTS["docs-find-target"])]),
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
          hints: hintTexts([fire(HINTS["docs-find-target"])]),
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
          hints: hintTexts([fire(HINTS["docs-choose-candidate"])]),
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
        hints: hintTexts([fire(HINTS["docs-find-target"])]),
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
        hints: hintTexts([fire(HINTS["docs-choose-candidate"])]),
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
          target: canonicalDocTarget(res.entry),
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
 * The `docs` result core — {@link treeResult} over discern's OWN bundled docs.
 * The single shape the `discern_docs` MCP tool and the CLI's `--json` path
 * both render, mirroring {@link mapResult}. (No `--dir`: the doc set is fixed.)
 */
export function docsResult(
  cwd: string,
  opts: { target?: string | undefined; search?: string | undefined } = {},
): Promise<DiscernResult<DocsData>> {
  return treeResult(DOCS_VERB, cwd, opts);
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
  terminal: TerminalContext,
): Promise<number> {
  const verb = desc.verb;
  const res = resolveDoc(tree, target, cwd);

  if (res.kind === "none") {
    const suggestions = suggestDocs(tree, target).map((item) => item.entry);
    log.error(terminalLine(notFoundMessage(target, suggestions)));
    for (const label of suggestionLabels(suggestions)) {
      log.detail(terminalLine(label));
    }
    log.detail(`list what's available: discern ${verb} --list`);
    return 1;
  }

  if (res.kind === "ambiguous") {
    log.error(terminalLine(
      `"${target}" matches ${res.entries.length} docs. Qualify it with a section or path:`,
    ));
    for (const e of res.entries) log.detail(terminalLine(e.path));
    return 1;
  }

  observeVerbTarget(canonicalDocTarget(res.entry));
  const content = await Deno.readTextFile(res.entry.absPath);
  if (options.raw) {
    // Pristine source — exactly the file's bytes, no added newline. The RAW
    // contract: frontmatter and citations included, always.
    await Deno.stdout.write(new TextEncoder().encode(content));
    return 0;
  }
  const rendered = renderMarkdown(terminalBody(desc, res.entry, content), {
    width: resolveWidth(options.width, terminal),
    color: terminal.color,
    terminal,
  });
  await present(rendered, options.noPager);
  return 0;
}

/**
 * Run a map or docs browse. Returns a process exit code. The `desc` selects the
 * tree (`map` → the project's map; `docs` → discern's bundled docs); the
 * argument dispatch, export pipeline, `--json` surface, interactive browser, and
 * pager are shared verbatim.
 */
async function runTree(desc: DocsVerb, options: DocsOptions): Promise<number> {
  const log = new Logger(options);
  const cwd = Deno.cwd();
  const terminal = docsTerminal(options.noColor);
  const width = resolveWidth(options.width, terminal);

  if (options.output && !options.export) {
    return invalidOptions(log, desc.verb, "--output requires --export.");
  }

  if (options.export) {
    const selection = await resolveExportSelection(desc, options.export, cwd);
    if (selection.kind === "unknown") {
      return invalidOptions(log, desc.verb, selection.message);
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

    if (selection.kind === "configured" && options.dir !== undefined) {
      return invalidOptions(
        log,
        desc.verb,
        `--export ${selection.name} reads the configured [scopes.${selection.name}] paths, which are anchored to the project's [map].dir; it cannot be combined with --dir.`,
      );
    }

    if (selection.kind === "builtin" && selection.scope === "select") {
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

    return await exportDocs(desc, options, selection, log, cwd);
  }

  // `docs --adr` widens discovery to the bundled ADR subtree, and a target that
  // itself names `_adr/…` widens the same way on every verb and surface; the
  // remaining browses stay public-only.
  const internal = widenInternalForTarget(
    internalScope(desc, options),
    options.target,
  );

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
    desc.verb === "docs" &&
    (options.adr === true || targetNamesAdrSubtree(options.target)) &&
    resolved.kind === "ok" && !(await hasDecisionRecords(resolved.dir))
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
    log.error(terminalLine(desc.missingTree(options)));
    return 1;
  }
  if (options.search !== undefined && options.search.trim() === "") {
    log.error("--search must contain at least one non-space character.");
    return 1;
  }
  if (tree.entries.length === 0) {
    if (options.search !== undefined) {
      if (options.target !== undefined && options.target !== "") {
        log.error(terminalLine(notFoundMessage(options.target, [])));
        return 1;
      }
      printSearchResults(
        desc.verb,
        await searchData(desc, tree, options.search),
        terminal,
        width,
      );
      return 0;
    }
    log.warn(terminalLine(
      `no Markdown files under ${display(tree.docsDir, cwd)}.`,
    ));
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
        log.error(
          terminalLine(notFoundMessage(options.target, suggestions)),
        );
        return 1;
      }
      if (resolvedScope.kind === "ambiguous") {
        log.error(terminalLine(
          `"${options.target}" matches ${resolvedScope.entries.length} docs. ` +
            "Qualify it with a section or path.",
        ));
        return 1;
      }
      searchTree = resolvedScope.tree;
      scope = resolvedScope.target;
    }
    printSearchResults(
      desc.verb,
      await searchData(desc, searchTree, options.search, scope),
      terminal,
      width,
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
        terminal,
        width,
      );
      return 0;
    }
  }

  // 2. A specific doc was named → render / raw-dump just that one.
  if (options.target !== undefined && options.target !== "") {
    return await viewTarget(
      desc,
      tree,
      options,
      log,
      cwd,
      options.target,
      terminal,
    );
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
      terminal,
      width,
    );
    if (!interactive) return 0;
  }

  // 4. A real terminal and no `--list` → the interactive browser.
  if (interactive) {
    return await browse(desc, tree, options, cwd, terminal);
  }

  // 5. Otherwise (docs off a TTY, or explicit `--list`) → a plain TOC.
  printToc(desc.verb, tree, cwd, terminal, width);
  return 0;
}

/** Run `discern map` — browse the project's agent-maintained documentation tree. */
export function runMap(options: DocsOptions): Promise<number> {
  return runTree(MAP_VERB, options);
}

/** Run `discern docs` — browse discern's OWN bundled documentation. */
export function runDocs(options: DocsOptions): Promise<number> {
  return runTree(DOCS_VERB, options);
}
