/**
 * Build the no-argument `discern map` overview from the map itself.
 *
 * Regions are the public top-level subtrees already discovered by `docs.ts`.
 * Their descriptions come from each subtree's README. Markdown links from that
 * region to specific tracked files outside the map define its freshness
 * coverage, and Git counts commits to those files after the region's most
 * recent page commit. Directory gestures never expand into coverage. No file
 * links or no usable Git history leaves the freshness facts absent.
 */

import { dirname, isAbsolute, relative, resolve, SEPARATOR } from "@std/path";
import { runGit } from "../shared/subprocess.ts";
import { leadParagraph } from "./markdown.ts";
import type { DocEntry, DocsTree } from "./docs.ts";

/** Git-only freshness facts for one map region, jointly absent when unknown. */
export interface MapRegionFreshness {
  pages_changed_at?: string;
  code_changes_since?: number;
}

/** One public top-level subtree in the map overview. */
export interface MapRegion extends MapRegionFreshness {
  name: string;
  title: string;
  description: string;
  page_count: number;
}

/** True when `candidate` is `root` itself or nested below it. */
function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${SEPARATOR}`) && !isAbsolute(rel));
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
  const trackedFiles = new Set(tracked);
  return [...candidates].filter((candidate) => trackedFiles.has(candidate))
    .sort();
}

/** Compute the Git facts for a region; every failure is honestly absent. */
async function regionFreshness(
  tree: DocsTree,
  entries: readonly DocEntry[],
  codePaths: string[],
): Promise<MapRegionFreshness> {
  if (codePaths.length === 0) {
    return {};
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
    return {};
  }
  const [commit, changedAt] = pageCommit.stdout.trim().split("\0");
  if (!commit || !changedAt) {
    return {};
  }
  const changes = await runGit(
    ["rev-list", "--count", `${commit}..HEAD`, "--", ...codePaths],
    { cwd: tree.root },
  );
  const count = Number.parseInt(changes.stdout.trim(), 10);
  if (!changes.success || !Number.isFinite(count)) {
    return {};
  }
  return {
    pages_changed_at: changedAt,
    code_changes_since: count,
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
    const description = leadParagraph(
      sources.get(readme.path) ?? "",
      title,
    );
    const codePaths = await linkedCodePaths(tree, entries, sources);
    const freshness = await regionFreshness(tree, entries, codePaths);
    regions.push({
      name,
      title,
      description,
      page_count: entries.length,
      ...freshness,
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
