/**
 * Build the no-argument `discern map` overview from the map itself.
 *
 * Regions are the public top-level subtrees already discovered by `docs.ts`.
 * Their descriptions come from each subtree's README; their staleness signal is
 * deliberately coarse and explainable: Markdown links from that region to
 * tracked paths outside the map define the code it covers, and Git counts code
 * commits after the region's most recent page commit. No links or no usable Git
 * history produces `unknown` rather than an invented relationship.
 */

import { dirname, isAbsolute, relative, resolve, SEPARATOR } from "@std/path";
import { runGit } from "../shared/subprocess.ts";
import { inlineToPlain } from "./markdown.ts";
import type { DocEntry, DocsTree } from "./docs.ts";

/** The Git-only freshness signal for one map region. */
export interface MapRegionStaleness {
  status: "current" | "behind" | "unknown";
  pages_changed_at?: string;
  code_changes_since?: number;
  code_paths: string[];
}

/** One public top-level subtree in the map overview. */
export interface MapRegion {
  name: string;
  title: string;
  description: string;
  page_count: number;
  staleness: MapRegionStaleness;
}

/** True when `candidate` is `root` itself or nested below it. */
function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel));
}

/** First prose paragraph after the README title, flattened to one plain line. */
export function readmeDescription(markdown: string, fallback: string): string {
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

/** Local Markdown link destinations, without fragments or external schemes. */
function localLinks(markdown: string): string[] {
  const links: string[] = [];
  const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const raw = match[1];
    if (
      raw === undefined || raw.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(raw)
    ) {
      continue;
    }
    const target = raw.split("#", 1)[0];
    if (target) links.push(target);
  }
  return links;
}

/** Resolve the tracked paths outside the map that a region's pages link to. */
async function linkedCodePaths(
  tree: DocsTree,
  entries: readonly DocEntry[],
  sources: ReadonlyMap<string, string>,
): Promise<string[]> {
  const candidates = new Set<string>();
  for (const entry of entries) {
    const source = sources.get(entry.path) ?? "";
    for (const link of localLinks(source)) {
      const abs = resolve(dirname(entry.absPath), link);
      if (!within(tree.root, abs) || within(tree.docsDir, abs)) continue;
      const rel = relative(tree.root, abs).replaceAll(SEPARATOR, "/");
      if (rel) candidates.add(rel);
    }
  }
  if (candidates.size === 0) return [];

  const listed = await runGit(
    ["ls-files", "-z", "--", ...candidates],
    { cwd: tree.root },
  );
  if (!listed.success) return [];
  const tracked = listed.stdout.split("\0").filter(Boolean);
  return [...candidates].filter((candidate) =>
    tracked.some((path) =>
      path === candidate || path.startsWith(`${candidate}/`)
    )
  ).sort();
}

/** Compute the Git signal for a region; every failure is honestly `unknown`. */
async function regionStaleness(
  tree: DocsTree,
  entries: readonly DocEntry[],
  codePaths: string[],
): Promise<MapRegionStaleness> {
  if (codePaths.length === 0) {
    return { status: "unknown", code_paths: [] };
  }
  const regionPath = relative(
    tree.root,
    resolve(tree.docsDir, entries[0]?.section ?? ""),
  )
    .replaceAll(SEPARATOR, "/");
  const pageCommit = await runGit(
    ["log", "-1", "--format=%H%x00%cI", "--", regionPath],
    { cwd: tree.root },
  );
  if (!pageCommit.success || pageCommit.stdout.trim() === "") {
    return { status: "unknown", code_paths: codePaths };
  }
  const [commit, changedAt] = pageCommit.stdout.trim().split("\0");
  if (!commit || !changedAt) {
    return { status: "unknown", code_paths: codePaths };
  }
  const changes = await runGit(
    ["rev-list", "--count", `${commit}..HEAD`, "--", ...codePaths],
    { cwd: tree.root },
  );
  const count = Number.parseInt(changes.stdout.trim(), 10);
  if (!changes.success || !Number.isFinite(count)) {
    return { status: "unknown", code_paths: codePaths };
  }
  return {
    status: count > 0 ? "behind" : "current",
    pages_changed_at: changedAt,
    code_changes_since: count,
    code_paths: codePaths,
  };
}

/** Build every public top-level map region in deterministic reading order. */
export async function buildMapOverview(tree: DocsTree): Promise<MapRegion[]> {
  const bySection = new Map<string, DocEntry[]>();
  for (const entry of tree.entries) {
    if (!entry.section || entry.section.startsWith("_")) continue;
    const group = bySection.get(entry.section) ?? [];
    group.push(entry);
    bySection.set(entry.section, group);
  }

  const regions: MapRegion[] = [];
  for (const [name, entries] of bySection) {
    const sources = new Map<string, string>();
    for (const entry of entries) {
      try {
        sources.set(entry.path, await Deno.readTextFile(entry.absPath));
      } catch {
        sources.set(entry.path, "");
      }
    }
    const readme = entries.find((entry) =>
      entry.slug.toLowerCase() === "readme"
    ) ??
      entries[0];
    if (readme === undefined) continue;
    const title = readme.title;
    const description = readmeDescription(
      sources.get(readme.path) ?? "",
      title,
    );
    const codePaths = await linkedCodePaths(tree, entries, sources);
    regions.push({
      name,
      title,
      description,
      page_count: entries.length,
      staleness: await regionStaleness(tree, entries, codePaths),
    });
  }
  return regions;
}

/** Human age wording; exact timestamps remain available in JSON. */
export function ageSince(iso: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - Date.parse(iso));
  const minute = 60_000;
  const units: Array<[number, string]> = [
    [365 * 24 * 60 * minute, "year"],
    [30 * 24 * 60 * minute, "month"],
    [7 * 24 * 60 * minute, "week"],
    [24 * 60 * minute, "day"],
    [60 * minute, "hour"],
    [minute, "minute"],
  ];
  for (const [size, label] of units) {
    const value = Math.floor(elapsed / size);
    if (value >= 1) return `${value} ${label}${value === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
