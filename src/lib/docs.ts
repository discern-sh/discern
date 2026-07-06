/**
 * Discover and resolve the project's documentation tree.
 *
 * `discern docs` browses the install's own `docs/` directory — the tree
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
import { RawConfig } from "../shared/config_read.ts";
import { normalizeDocsDir } from "../shared/docs_path.ts";
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
}

/** The indexed docs tree for one project. */
export interface DocsTree {
  /** The docs dir's parent (paths in `entries` are relative to this). */
  root: string;
  /** Absolute path to the docs directory itself. */
  docsDir: string;
  /** Every `.md` file found, in reading order. */
  entries: DocEntry[];
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

/** The text of the first Markdown heading in `md`, flattened to plain text. */
export function extractTitle(md: string): string | undefined {
  for (const raw of md.split(/\r?\n/)) {
    const m = raw.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    const heading = m?.[2];
    if (heading !== undefined) {
      const text = inlineToPlain(heading).trim();
      if (text) return text;
    }
  }
  return undefined;
}

/** Turn a slug into a readable title when a doc has no heading of its own. */
function humanise(slug: string): string {
  const words = slug.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A sort key that yields reading order: within any directory `README.md` comes
 * first, `_`-prefixed directories come after public directories, and all other
 * entries fall in path order. Compared lexicographically.
 */
function sortKey(relPath: string): string {
  const segs = relPath.split("/");
  return segs
    .map((seg, idx) =>
      idx === segs.length - 1 && seg.toLowerCase() === "readme.md"
        ? "\x00"
        : idx < segs.length - 1 && seg.startsWith("_")
        ? `\uffff${seg.toLowerCase()}`
        : seg.toLowerCase()
    )
    .join("/");
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
    const candidate = join(cwd, "docs");
    return (await isDir(candidate))
      ? { docsDir: candidate, root: dirname(candidate) }
      : undefined;
  }
  const raw = await RawConfig.load(root);
  const candidate = join(
    root,
    normalizeDocsDir(raw.get("docs.dir", SOURCE_PATHS.docs.defaultPath)),
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
 * Index the project's docs tree. Returns undefined when no docs directory
 * exists (the caller turns that into a friendly "nothing to browse" message).
 * `dir` overrides the default `[docs].dir` location.
 *
 * Internal/reference subtrees in `_`-prefixed directories (`_adr`, `_internal`)
 * are excluded by default — the browser shows only the user-facing tree.
 * `includeInternal` widens that: `true` indexes every internal subtree (full-tree
 * export), and a string[] allowlist indexes ONLY the named ones (e.g. `["_adr"]`
 * for `help --adr`, which reveals the ADRs without ever exposing `_internal` /
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

    let title: string;
    try {
      title = extractTitle(await Deno.readTextFile(absPath)) ?? humanise(slug);
    } catch {
      title = humanise(slug);
    }

    entries.push({ path, absPath, relToDocs, section, slug, title });
  }

  entries.sort((a, b) => {
    const ka = sortKey(a.relToDocs);
    const kb = sortKey(b.relToDocs);
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

/** The lowercase strings that should resolve to `entry`. */
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
