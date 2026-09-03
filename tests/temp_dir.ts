/** Declared ownership capabilities for test and executable-fixture directories. */

import { waitUntil } from "./waiting.ts";

/** The policy every supported test temp-directory lifetime must declare. */
export interface TempDirOwnershipPolicy {
  /** The event after which the capability removes the owned directory. */
  readonly cleanupBoundary: string;
  /** Why this lifetime exists instead of using the ordinary callback scope. */
  readonly reason: string;
}

/**
 * The complete set of supported test temp-directory ownership modes.
 *
 * Adding a mode means declaring both its cleanup boundary and why the existing
 * modes cannot own that lifetime.
 */
export const TEMP_DIR_OWNERSHIP_POLICIES = {
  closure: {
    cleanupBoundary: "callback settlement",
    reason:
      "Ordinary tests and executable fixtures own their directory for one callback.",
  },
  suite: {
    cleanupBoundary: "process unload, then the registered temp-artifact reaper",
    reason:
      "The injected engine TMPDIR must outlive every callback in one test module.",
  },
} as const satisfies Record<string, TempDirOwnershipPolicy>;

/** Options for one callback-owned test directory. */
export interface WithTempDirOptions {
  /** Parent directory when the fixture must live on a particular filesystem. */
  readonly parent?: string;
  /** Name prefix; defaults to the registered `discern-test-` family. */
  readonly prefix?: string;
  /**
   * Compute an exact replacement path when fixture geometry requires a rename.
   * The capability performs the rename and owns the replacement path.
   */
  readonly renamedPath?: (createdDir: string) => string | Promise<string>;
}

/** Filesystem path forms every lifecycle must support end to end. */
export const PATH_SHAPES = [
  { id: "space", label: "repository with spaces" },
  { id: "non-ascii", label: "répertoire-東京" },
  { id: "symlink-parent", label: "symlinked parent" },
] as const;

export type PathShape = (typeof PATH_SHAPES)[number];

type TempTreeRemover = (dir: string) => Promise<void>;

const DEFAULT_PREFIX = "discern-test-";
const SUITE_PREFIX = "discern-test-tmp-";

/** Remove one directory tree through Deno's recursive filesystem primitive. */
async function removeTree(dir: string): Promise<void> {
  await Deno.remove(dir, { recursive: true });
}

/**
 * Remove a directory tree, retrying the teardown race where a finishing child
 * process creates one last entry while recursive removal is in progress.
 */
export async function removeTempTree(
  dir: string,
  remove: TempTreeRemover = removeTree,
): Promise<void> {
  let attempt = 0;
  await waitUntil(
    async () => {
      try {
        await remove(dir);
        return true;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return true;
        attempt++;
        if (attempt >= 5) throw error;
        return false;
      }
    },
    `temporary tree ${dir} to be removable`,
    {
      timeoutMs: 1_000,
      intervalMs: 50,
    },
  );
}

/** Remove the owned path and its sibling worktree root. */
async function removeOwnedTempDir(dir: string): Promise<void> {
  await removeTempTree(dir);
  await removeTempTree(`${dir}.worktrees`).catch(() => {});
}

/**
 * Run `fn` with a callback-owned temp directory and return its value, removing
 * the directory and any sibling worktree root after the callback settles.
 */
export async function withTempDir<T>(
  fn: (dir: string) => T | Promise<T>,
  options: WithTempDirOptions = {},
): Promise<T> {
  const created = await Deno.makeTempDir({
    ...(options.parent === undefined ? {} : { dir: options.parent }),
    prefix: options.prefix ?? DEFAULT_PREFIX,
  });
  let owned = created;
  try {
    if (options.renamedPath !== undefined) {
      const renamed = await options.renamedPath(created);
      await Deno.rename(created, renamed);
      owned = renamed;
    }
    return await fn(owned);
  } finally {
    await removeOwnedTempDir(owned);
    if (owned !== created) {
      await removeOwnedTempDir(created).catch(() => {});
    }
  }
}

/** Run one callback in a repository directory with the selected path shape. */
export async function withPathShapeTempDir<T>(
  shape: PathShape,
  fn: (dir: string) => T | Promise<T>,
): Promise<T> {
  if (shape.id === "symlink-parent") {
    return await withTempDir(async (outer) => {
      const realParent = `${outer}/real-parent`;
      const linkedParent = `${outer}/linked-parent`;
      await Deno.mkdir(realParent);
      await Deno.symlink(realParent, linkedParent);
      const repository = `${linkedParent}/repository`;
      await Deno.mkdir(repository);
      return await fn(repository);
    });
  }
  return await withTempDir(fn, {
    renamedPath: (created) => `${created}-${shape.label}`,
  });
}

let suiteTempPromise: Promise<string> | undefined;

/**
 * Return the module-scoped temp home injected as every spawned engine's
 * `TMPDIR`. It is removed on process unload; a killed process leaves a member
 * of the registered `discern-test-` family for the engine reaper.
 */
export function suiteTempDir(): Promise<string> {
  suiteTempPromise ??= (async (): Promise<string> => {
    const dir = await Deno.makeTempDir({ prefix: SUITE_PREFIX });
    globalThis.addEventListener("unload", () => {
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch {
        // Best-effort: the registered artifact reaper collects what unload cannot.
      }
    });
    return dir;
  })();
  return suiteTempPromise;
}
