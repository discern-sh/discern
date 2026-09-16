/** Read current-map source links for the governing checkpoint policy. */
import { join } from "@std/path";
import { isCurrentMapPage, mapSourcePaths } from "../../lib/map_sources.ts";
import { runGit } from "../../shared/subprocess.ts";
import type { EffortDiff, ResolvedCheckpoint } from "./types.ts";

/** Maximum Markdown bytes inspected per snapshot. */
const MAP_EVIDENCE_BYTES = 8 * 1024 * 1024;

/** Read immutable page bodies in one bounded Git batch. Missing objects and
 * non-blob objects leave evidence incomplete; no guessed text enters review. */
async function committedPages(
  root: string,
  commit: string,
  paths: readonly string[],
): Promise<Map<string, string> | undefined> {
  if (paths.length === 0) return new Map();
  if (paths.some((path) => /[\r\n]/.test(path))) return undefined;
  const result = await runGit(["cat-file", "--batch"], {
    cwd: root,
    stdin: paths.map((path) => `${commit}:./${path}`).join("\n") + "\n",
    maxOutputBytes: MAP_EVIDENCE_BYTES,
    timeoutMs: 30_000,
  });
  if (!result.success || result.stdoutBytes === undefined) return undefined;
  const bytes = result.stdoutBytes;
  const decoder = new TextDecoder();
  const pages = new Map<string, string>();
  let offset = 0;
  for (const path of paths) {
    const end = bytes.indexOf(10, offset);
    if (end < 0) return undefined;
    const header = decoder.decode(bytes.subarray(offset, end));
    const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (match?.[1] === undefined) return undefined;
    const size = Number(match[1]);
    offset = end + 1;
    if (
      !Number.isSafeInteger(size) || offset + size >= bytes.length ||
      bytes[offset + size] !== 10
    ) return undefined;
    pages.set(path, decoder.decode(bytes.subarray(offset, offset + size)));
    offset += size + 1;
  }
  return offset === bytes.length ? pages : undefined;
}

/** Enrich the diff once. Unchanged pages are read only from the current view;
 * changed/deleted pages also contribute base links, preventing evasion by edit.
 * Generated pages, decision history and private notes do not claim coverage. */
export async function collectMapSources(
  root: string,
  base: string,
  diff: EffortDiff,
  definitions: readonly ResolvedCheckpoint[],
  currentCommit?: string,
): Promise<EffortDiff> {
  const directories = [
    ...new Set(
      definitions.flatMap((def) =>
        def.mapReview?.kind === "drift" ? [def.mapReview.directory] : []
      ),
    ),
  ];
  if (directories.length === 0) return diff;
  const admitted = (path: string): boolean =>
    directories.some((dir) => isCurrentMapPage(path, dir));
  const basePages = diff.baseFiles.filter((file) =>
    !file.generated && admitted(file.path)
  ).map((file) => file.path);
  const changedPages = diff.files.filter((file) =>
    !file.generated && admitted(file.path)
  );
  const deleted = new Set(
    changedPages.filter((file) => file.kind === "deleted").map((file) =>
      file.path
    ),
  );
  const currentPaths = [
    ...new Set([...basePages, ...changedPages.map((file) => file.path)]),
  ].filter((path) => !deleted.has(path));
  let complete = true;
  let current: Map<string, string>;
  if (currentCommit !== undefined) {
    const read = await committedPages(root, currentCommit, currentPaths);
    current = read ?? new Map();
    complete = read !== undefined;
  } else {
    current = new Map();
    let bytes = 0;
    for (const path of currentPaths) {
      try {
        const info = await Deno.lstat(join(root, path));
        bytes += info.size;
        if (!info.isFile || info.isSymlink || bytes > MAP_EVIDENCE_BYTES) {
          complete = false;
          continue;
        }
        current.set(path, await Deno.readTextFile(join(root, path)));
      } catch (error) {
        if (
          !(error instanceof Deno.errors.NotFound) &&
          !(error instanceof Deno.errors.PermissionDenied)
        ) throw error;
        complete = false;
      }
    }
  }
  const changed = new Set(changedPages.map((file) => file.path));
  const previous = await committedPages(
    root,
    base,
    basePages.filter((path) => changed.has(path)),
  );
  if (previous === undefined) complete = false;
  const byPage = new Map<string, Set<string>>();
  for (const [path, text] of [...current, ...(previous ?? [])]) {
    const directory = directories.find((dir) => isCurrentMapPage(path, dir));
    if (directory === undefined) continue;
    const sources = byPage.get(path) ?? new Set<string>();
    for (const source of mapSourcePaths(root, directory, path, text)) {
      sources.add(source);
    }
    byPage.set(path, sources);
  }
  return {
    ...diff,
    mapSources: {
      complete,
      pages: [...byPage].sort(([a], [b]) => a.localeCompare(b)).map((
        [path, sources],
      ) => ({ path, sources: [...sources].sort() })),
    },
  };
}
