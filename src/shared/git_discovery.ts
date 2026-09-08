/**
 * Operation-scoped Git discovery.
 *
 * Discovery answers where a checkout's Git administration lives, where the
 * shared common directory is, where a registered administrative artifact
 * resolves, how the project root sits inside its work tree, and what bytes a
 * content-addressed object holds. Those answers change only when a worktree is
 * added, moved, removed, pruned or repaired, and within one discern operation
 * the engine is the only actor doing so.
 *
 * The operation boundary opens a scope; discovery consumers declare the kind of
 * fact they need. A miss runs git (the two administration directories, and the
 * two work-tree positions, each batch into one spawn); a hit replays the exact
 * stdout git printed for the same query in the same directory, so discovery
 * never reinterprets git. Every hit is validated against the checkout's current
 * real path and the presence of its administration directory. Failures are
 * never retained. Lock acquisition and every topology-changing git invocation
 * mark the scope stale. Ordinary boundaries re-observe administration with Git.
 * Short publications may reuse an observation only when bounded routing bytes
 * and directory identities agree with a witness captured around fresh Git
 * discovery. Changed or uncertain routing falls back to Git. The scope ends with its operation.
 * Outside any scope a query runs fresh, exactly as before.
 */

import { AsyncLocalStorage } from "./module_loading.ts";
import {
  directoryExists,
  lstatIfExists,
  realPathIfExists,
} from "./fs_presence.ts";
import { dirname, join, resolve } from "@std/path";
import { readBoundedText } from "./bounded_file.ts";

/** The narrow result discovery replays or forwards from its runner. */
export interface GitDiscoveryResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** The caller-owned Git runner discovery forwards fresh queries to. */
export type GitDiscoveryRunner = (
  cwd: string,
  args: string[],
) => Promise<GitDiscoveryResult>;

/** The kinds of fact discovery may retain for one operation. */
export type GitDiscoveryQuery =
  | { readonly kind: "absolute-git-dir" }
  | { readonly kind: "common-dir" }
  | { readonly kind: "toplevel" }
  | { readonly kind: "prefix" }
  /** A registered administrative path; the registry resolver owns the argv. */
  | {
    readonly kind: "admin-path";
    readonly path: string;
    readonly args: readonly string[];
  }
  /** A content-addressed `<full object id>:<path>` read. */
  | { readonly kind: "object"; readonly spec: string };

/** Both administration directories, as git printed them. */
export interface GitDirLines {
  readonly absoluteGitDir: string;
  readonly commonGitDir: string;
}

/** Git subcommands after which retained discovery may be stale. */
export const GIT_TOPOLOGY_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "worktree",
  "init",
  "submodule",
  "clone",
]);

const ADMIN_DIR_ARGS = ["rev-parse", "--absolute-git-dir", "--git-common-dir"];
const POSITION_ARGS = ["rev-parse", "--show-toplevel", "--show-prefix"];
/** A full SHA-1 or SHA-256 object id followed by a path separator. */
const OBJECT_SPEC = /^(?:[0-9a-f]{40}|[0-9a-f]{64}):/u;

interface CheckoutDiscovery {
  /** Raw `--absolute-git-dir` and `--git-common-dir` lines. */
  dirs?: readonly [string, string] | undefined;
  /** Raw `--show-toplevel` and `--show-prefix` lines. */
  position?: readonly [string, string] | undefined;
  /** Exact stdout per registered administrative path. */
  readonly adminPaths: Map<string, string>;
  /** Exact stdout per content-addressed object spec. */
  readonly objects: Map<string, string>;
  /** Set by a boundary; the next query re-observes the directories. */
  stale: false | "publication" | "topology";
  /** Filesystem routing agreed on both sides of the last fresh Git observation. */
  routing?: string | undefined;
  /** An in-flight observation cannot clear a later topology invalidation. */
  revision: number;
}

interface GitDiscoveryScope {
  readonly parent: GitDiscoveryScope | undefined;
  /** Retained facts per canonical checkout path. */
  readonly checkouts: Map<string, CheckoutDiscovery>;
  closed: boolean;
}

const SCOPE = new AsyncLocalStorage<GitDiscoveryScope>();

/** Run one operation with its own discovery scope; nothing survives its return. */
export async function withGitDiscoveryScope<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const scope: GitDiscoveryScope = {
    parent: SCOPE.getStore(),
    checkouts: new Map(),
    closed: false,
  };
  try {
    return await SCOPE.run(scope, operation);
  } finally {
    scope.closed = true;
    scope.checkouts.clear();
  }
}

/** Reuse a live owning operation; standalone callers still close their own scope. */
export async function withinGitDiscoveryScope<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return liveScope() === undefined
    ? await withGitDiscoveryScope(operation)
    : await operation();
}

/**
 * Mark retained answers stale throughout the owning operation. A publication
 * cannot downgrade a pending topology re-observation into filesystem reuse.
 */
export function invalidateGitDiscovery(
  boundary: "topology" | "publication" = "topology",
): void {
  for (
    let scope = SCOPE.getStore();
    scope !== undefined;
    scope = scope.parent
  ) {
    for (const checkout of scope.checkouts.values()) {
      if (boundary === "topology") checkout.revision += 1;
      if (checkout.stale !== "topology") checkout.stale = boundary;
    }
  }
}

/** The scope a query may use: the current one, unless its operation ended. */
function liveScope(): GitDiscoveryScope | undefined {
  const scope = SCOPE.getStore();
  return scope === undefined || scope.closed ? undefined : scope;
}

/** The single-fact argv git would receive without a scope. */
function exactArgs(query: GitDiscoveryQuery): string[] {
  switch (query.kind) {
    case "absolute-git-dir":
      return ["rev-parse", "--absolute-git-dir"];
    case "common-dir":
      return ["rev-parse", "--git-common-dir"];
    case "toplevel":
      return ["rev-parse", "--show-toplevel"];
    case "prefix":
      return ["rev-parse", "--show-prefix"];
    case "admin-path":
      return [...query.args];
    case "object":
      return ["show", query.spec];
  }
}

/** Split a two-option `rev-parse` result into its two lines, or nothing on failure. */
function twoLines(
  result: GitDiscoveryResult,
): readonly [string, string] | undefined {
  if (!result.success) return undefined;
  const parts = result.stdout.split("\n");
  const [first, second, rest] = parts;
  if (
    parts.length !== 3 || first === undefined || second === undefined ||
    rest !== ""
  ) {
    return undefined;
  }
  return [first, second];
}

/** A retained single line, presented as the single-option query would print it. */
function replayLine(line: string): GitDiscoveryResult {
  return { success: true, stdout: `${line}\n`, stderr: "" };
}

/** Exact retained stdout, presented as the original successful query did. */
function replayOutput(stdout: string): GitDiscoveryResult {
  return { success: true, stdout, stderr: "" };
}

/** The retained record for a checkout that still exists, keyed by its real path. */
async function checkoutDiscovery(
  scope: GitDiscoveryScope,
  cwd: string,
): Promise<CheckoutDiscovery | undefined> {
  const key = await realPathIfExists(cwd);
  if (key === undefined) return undefined;
  let checkout = scope.checkouts.get(key);
  if (checkout === undefined) {
    checkout = {
      adminPaths: new Map(),
      objects: new Map(),
      stale: false,
      revision: 0,
    };
    scope.checkouts.set(key, checkout);
  }
  return checkout;
}

/** Drop every answer derived from a checkout's administration directories. */
function dropDerived(checkout: CheckoutDiscovery): void {
  checkout.position = undefined;
  checkout.adminPaths.clear();
  checkout.objects.clear();
}

/** Observe routing inputs without deriving Git's answers. Symlinks or unknown
 * file identities cannot authorize reuse. Directory contents and timestamps
 * are excluded: writing a receipt does not change repository routing. */
async function routingFingerprint(
  cwd: string,
  dirs: readonly [string, string],
): Promise<string | undefined> {
  const paths = new Set([resolve(cwd, dirs[0]), resolve(cwd, dirs[1])]);
  paths.add(join(resolve(cwd, dirs[0]), "commondir"));
  for (let ancestor = resolve(cwd);; ancestor = dirname(ancestor)) {
    paths.add(ancestor);
    paths.add(join(ancestor, ".git"));
    if (dirname(ancestor) === ancestor) break;
  }
  const facts: unknown[] = [];
  for (const path of paths) {
    try {
      const stat = await lstatIfExists(path);
      if (stat === undefined) {
        facts.push([path, null]);
        continue;
      }
      if (stat.isSymlink || stat.ino === null || stat.dev === null) {
        return undefined;
      }
      if (!stat.isDirectory && (!stat.isFile || stat.size > 65_536)) {
        return undefined;
      }
      facts.push([
        path,
        stat.dev,
        stat.ino,
        stat.isDirectory ? null : await readBoundedText(path, 65_536),
      ]);
    } catch (error) {
      if (
        error instanceof Deno.errors.NotCapable ||
        error instanceof Deno.errors.PermissionDenied
      ) return undefined;
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      facts.push([path, null]);
    }
  }
  return JSON.stringify(facts);
}

/**
 * Both administration directories, retained after one batched query. A
 * retained pair whose administration directory has since disappeared is
 * discarded together with everything derived from it. A stale pair is
 * re-observed with one query; the answers derived from it survive only when
 * the fresh observation is byte-identical.
 */
async function retainDirs(
  checkout: CheckoutDiscovery,
  cwd: string,
  run: GitDiscoveryRunner,
): Promise<readonly [string, string] | undefined> {
  if (checkout.dirs !== undefined && checkout.stale === false) {
    if (await directoryExists(checkout.dirs[0])) {
      if (checkout.stale === false) return checkout.dirs;
    } else {
      checkout.dirs = undefined;
      dropDerived(checkout);
    }
  }
  const revision = checkout.revision;
  const publication = checkout.stale === "publication";
  const before = !publication || checkout.dirs === undefined
    ? undefined
    : await routingFingerprint(cwd, checkout.dirs);
  if (
    checkout.stale === "publication" && before !== undefined &&
    before === checkout.routing && revision === checkout.revision
  ) {
    checkout.stale = false;
    return checkout.dirs;
  }
  const lines = twoLines(await run(cwd, [...ADMIN_DIR_ARGS]));
  const after = !publication || lines === undefined
    ? undefined
    : await routingFingerprint(cwd, lines);
  if (
    lines === undefined || checkout.dirs === undefined ||
    checkout.dirs[0] !== lines[0] || checkout.dirs[1] !== lines[1]
  ) {
    dropDerived(checkout);
  }
  checkout.dirs = lines;
  checkout.routing =
    revision === checkout.revision && before !== undefined && before === after
      ? after
      : undefined;
  if (revision === checkout.revision) checkout.stale = false;
  return lines;
}

/** Both work-tree positions, retained after one batched query. */
async function retainPosition(
  checkout: CheckoutDiscovery,
  cwd: string,
  run: GitDiscoveryRunner,
): Promise<readonly [string, string] | undefined> {
  if (checkout.position !== undefined) return checkout.position;
  const lines = twoLines(await run(cwd, [...POSITION_ARGS]));
  if (lines !== undefined) checkout.position = lines;
  return lines;
}

/** One exact query, retained verbatim after its first success. */
async function retainExact(
  retained: Map<string, string>,
  key: string,
  cwd: string,
  args: string[],
  run: GitDiscoveryRunner,
): Promise<GitDiscoveryResult> {
  const stdout = retained.get(key);
  if (stdout !== undefined) return replayOutput(stdout);
  const result = await run(cwd, args);
  if (result.success) retained.set(key, result.stdout);
  return result;
}

/** Answer one query from the validated checkout record, running git on a miss. */
async function retainedAnswer(
  checkout: CheckoutDiscovery,
  cwd: string,
  query: GitDiscoveryQuery,
  dirs: readonly [string, string],
  run: GitDiscoveryRunner,
): Promise<GitDiscoveryResult | undefined> {
  switch (query.kind) {
    case "absolute-git-dir":
      return replayLine(dirs[0]);
    case "common-dir":
      return replayLine(dirs[1]);
    case "toplevel": {
      const position = await retainPosition(checkout, cwd, run);
      return position === undefined ? undefined : replayLine(position[0]);
    }
    case "prefix": {
      const position = await retainPosition(checkout, cwd, run);
      return position === undefined ? undefined : replayLine(position[1]);
    }
    case "admin-path":
      return await retainExact(
        checkout.adminPaths,
        query.path,
        cwd,
        [...query.args],
        run,
      );
    case "object":
      return OBJECT_SPEC.test(query.spec)
        ? await retainExact(
          checkout.objects,
          query.spec,
          cwd,
          ["show", query.spec],
          run,
        )
        : undefined;
  }
}

/**
 * Resolve one discovery fact for `cwd`. Inside a live operation scope the
 * answer is retained and replayed; otherwise, or when the checkout is not a
 * repository, the exact single query runs through `run`.
 */
export async function discoverGit(
  cwd: string,
  query: GitDiscoveryQuery,
  run: GitDiscoveryRunner,
): Promise<GitDiscoveryResult> {
  const scope = liveScope();
  if (scope === undefined) return await run(cwd, exactArgs(query));
  const checkout = await checkoutDiscovery(scope, cwd);
  if (checkout === undefined) return await run(cwd, exactArgs(query));
  const dirs = await retainDirs(checkout, cwd, run);
  if (dirs === undefined) return await run(cwd, exactArgs(query));
  return await retainedAnswer(checkout, cwd, query, dirs, run) ??
    await run(cwd, exactArgs(query));
}

/**
 * Both administration directories with one spawn, retained inside a live
 * operation scope. Undefined outside a repository.
 */
export async function discoverGitDirs(
  cwd: string,
  run: GitDiscoveryRunner,
): Promise<GitDirLines | undefined> {
  const scope = liveScope();
  const checkout = scope === undefined
    ? undefined
    : await checkoutDiscovery(scope, cwd);
  const lines = checkout === undefined
    ? twoLines(await run(cwd, [...ADMIN_DIR_ARGS]))
    : await retainDirs(checkout, cwd, run);
  return lines === undefined
    ? undefined
    : { absoluteGitDir: lines[0], commonGitDir: lines[1] };
}
