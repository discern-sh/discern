/** Map overview and page-specific Git evidence; neither judges the prose. */
import { relative, SEPARATOR } from "@std/path";
import { runGit } from "../shared/subprocess.ts";
import {
  canonicalDocTarget,
  type DocEntry,
  docRegions,
  type DocsTree,
} from "./docs.ts";
import { mapSourcePaths } from "./map_sources.ts";

/** Facts are absent when source links or usable page history are unavailable. */
export interface MapPageFreshness {
  target: string;
  path: string;
  source_paths: string[];
  page_changed_at?: string;
  code_changes_since?: number;
}

/** One non-internal top-level subtree, with evidence for each explanation. */
export interface MapRegion {
  name: string;
  title: string;
  description: string;
  page_count: number;
  pages: MapPageFreshness[];
  /** Oldest measured page commit, not the latest edit anywhere in the region. */
  pages_changed_at?: string;
  /** Distinct source commits newer than their respective linked pages. */
  code_changes_since?: number;
}

/** One page's source links and committed history, plus commits for deduplication. */
async function pageEvidence(
  root: string | undefined,
  tree: DocsTree,
  entry: DocEntry,
): Promise<{ page: MapPageFreshness; commits: string[] }> {
  const page: MapPageFreshness = {
    target: canonicalDocTarget(entry),
    path: entry.path,
    source_paths: [],
  };
  if (root === undefined) return { page, commits: [] };
  const source = await Deno.readTextFile(entry.absPath);
  const path = relative(root, await Deno.realPath(entry.absPath)).replaceAll(
    SEPARATOR,
    "/",
  );
  const candidates = mapSourcePaths(
    root,
    await Deno.realPath(tree.docsDir),
    path,
    source,
  );
  if (candidates.length === 0) return { page, commits: [] };
  const listed = await runGit([
    "--literal-pathspecs",
    "ls-files",
    "-z",
    "--",
    ...candidates,
  ], {
    cwd: root,
  });
  if (!listed.success) return { page, commits: [] };
  const tracked = new Set(listed.stdout.split("\0").filter(Boolean));
  page.source_paths = candidates.filter((candidate) => tracked.has(candidate));
  if (page.source_paths.length === 0) return { page, commits: [] };
  const logged = await runGit([
    "--literal-pathspecs",
    "log",
    "-1",
    "--format=%H%x00%cI",
    "--",
    path,
  ], {
    cwd: root,
  });
  const [commit, changedAt] = logged.stdout.trim().split("\0");
  if (!logged.success || !commit || !changedAt) return { page, commits: [] };
  const changes = await runGit([
    "--literal-pathspecs",
    "rev-list",
    `${commit}..HEAD`,
    "--",
    ...page.source_paths,
  ], { cwd: root });
  if (!changes.success) return { page, commits: [] };
  const commits = changes.stdout.trim().split("\n").filter(Boolean);
  page.page_changed_at = changedAt;
  page.code_changes_since = commits.length;
  return { page, commits };
}

/** Discover the Git root independently of a nested configured map directory. */
async function mapGitRoot(tree: DocsTree): Promise<string | undefined> {
  const result = await runGit(["rev-parse", "--show-toplevel"], {
    cwd: tree.root,
  });
  return result.success && result.stdout.trim() !== ""
    ? result.stdout.trim()
    : undefined;
}

/** Read evidence for a selected page, including a root-only project's map. */
export async function mapPageFreshness(
  tree: DocsTree,
  entry: DocEntry,
): Promise<MapPageFreshness> {
  return (await pageEvidence(await mapGitRoot(tree), tree, entry)).page;
}

/** Build every non-internal map region in deterministic reading order. */
export async function buildMapOverview(tree: DocsTree): Promise<MapRegion[]> {
  const root = await mapGitRoot(tree);
  const regions: MapRegion[] = [];
  for (const region of docRegions(tree.entries)) {
    const evidence = [];
    for (const entry of region.entries) {
      evidence.push(await pageEvidence(root, tree, entry));
    }
    const pages = evidence.map(({ page }) => page);
    const timestamps = pages.flatMap((page) =>
      page.page_changed_at ? [page.page_changed_at] : []
    ).sort();
    const oldest = timestamps[0];
    regions.push({
      name: region.name,
      title: region.title,
      description: region.description,
      page_count: region.page_count,
      pages,
      ...(oldest === undefined ? {} : {
        pages_changed_at: oldest,
        code_changes_since: new Set(evidence.flatMap(({ commits }) =>
          commits
        )).size,
      }),
    });
  }
  return regions;
}
