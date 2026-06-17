/**
 * Discover and resolve the project's documentation tree.
 *
 * `icculus docs` browses the install's own `docs/` directory — the seed tree
 * `init` scaffolds and `/bootstrap` fills, not anything under `templates/`. This
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

/** The outcome of resolving a free-form target to a doc. */
export type ResolveResult =
  | { kind: "found"; entry: DocEntry }
  | { kind: "ambiguous"; entries: DocEntry[] }
  | { kind: "none" };

/** True when `path` is an existing directory. */
async function isDir(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

/**
 * Walk up from `start` to the nearest ancestor containing `icculus.toml` — the
 * project root, the same anchor `bin/agent` uses. Returns undefined if none is
 * found before the filesystem root.
 */
export async function findProjectRoot(
  start: string,
): Promise<string | undefined> {
  let dir = resolve(start);
  while (true) {
    try {
      if ((await Deno.stat(join(dir, "icculus.toml"))).isFile) {
        return dir;
      }
    } catch {
      // not here; keep walking up.
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
    if (m) {
      const text = inlineToPlain(m[2]).trim();
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
 * first, and `_`-prefixed directories (`_adr`, `_internal`) sort after the
 * numbered subtrees. Compared lexicographically against other keys.
 */
function sortKey(relPath: string): string {
  const segs = relPath.split("/");
  return segs
    .map((seg, idx) => {
      if (idx === segs.length - 1) {
        return seg.toLowerCase() === "readme.md" ? "\x00" : seg.toLowerCase();
      }
      // High prefix pushes reference dirs (_adr, _internal) to the end.
      return (seg.startsWith("_") ? "￿" : "") + seg.toLowerCase();
    })
    .join("/");
}

/** Resolve which directory to index, honouring an explicit `dir` override. */
async function resolveDocsDir(
  cwd: string,
  dir: string | undefined,
): Promise<string | undefined> {
  if (dir) {
    const abs = isAbsolute(dir) ? dir : resolve(cwd, dir);
    return (await isDir(abs)) ? abs : undefined;
  }
  const root = await findProjectRoot(cwd);
  const candidate = join(root ?? cwd, "docs");
  return (await isDir(candidate)) ? candidate : undefined;
}

/**
 * Index the project's docs tree. Returns undefined when no docs directory
 * exists (the caller turns that into a friendly "nothing to browse" message).
 * `dir` overrides the default `<project root>/docs` location.
 */
export async function discoverDocs(opts: {
  cwd: string;
  dir?: string;
}): Promise<DocsTree | undefined> {
  const docsDir = await resolveDocsDir(opts.cwd, opts.dir);
  if (!docsDir) return undefined;

  const root = dirname(docsDir);
  const entries: DocEntry[] = [];

  for await (
    const entry of walk(docsDir, { exts: [".md"], includeDirs: false })
  ) {
    const absPath = entry.path;
    const path = relative(root, absPath).replaceAll(SEPARATOR, "/");
    const relToDocs = relative(docsDir, absPath).replaceAll(SEPARATOR, "/");
    const parts = relToDocs.split("/");
    const section = parts.length > 1 ? parts[0] : "";
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
    const ka = sortKey(a.path);
    const kb = sortKey(b.path);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { root, docsDir, entries };
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

  if (matches.length === 1) return { kind: "found", entry: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", entries: matches };
  return { kind: "none" };
}
