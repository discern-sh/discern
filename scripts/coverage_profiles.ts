/**
 * Prune and shard raw V8 coverage profiles ahead of parallel report passes.
 *
 * An instrumented suite run leaves one profile per module per spawned
 * process, so the profile directory holds far more dependency and fixture
 * observations than product ones — and the report pass pays to parse every
 * file before its include filter can reject a module. This module removes
 * that waste up front and splits what remains for concurrency:
 *
 * - **Prune**: a profile positively identified as a single-script record for
 *   a URL outside the shared src prefix can never survive the report filter,
 *   so no report pass needs to parse it. Classification is conservative — an
 *   unrecognized head shards anyway and the report filter stays the judge —
 *   so pruning can only ever remove observations the report would discard.
 * - **Shard**: kept profiles spread round-robin across shard directories,
 *   one report pass each. Any assignment is correct because the join unions
 *   shard reports per line; round-robin merely balances the parse work.
 */

import { join } from "@std/path";

/** Leading bytes read from one raw profile for classification. */
const HEAD_BYTES = 512;

/** One decoder for every profile head; classification tolerates lossy tails. */
const HEAD_DECODER = new TextDecoder();

/**
 * The head of a raw single-script V8 coverage profile as Deno writes it:
 * one JSON object whose scriptId precedes the script URL.
 */
const SINGLE_SCRIPT_HEAD =
  /^\s*\{\s*"scriptId"\s*:\s*"[^"\\]*"\s*,\s*"url"\s*:\s*"([^"\\]*)"/;

/** Classification of one raw profile by its leading bytes. */
export type RawProfileHead =
  | { readonly kind: "single-script"; readonly url: string }
  | { readonly kind: "opaque" };

/** Classify one raw profile's leading text without parsing the whole file. */
export function classifyRawProfileHead(head: string): RawProfileHead {
  const url = SINGLE_SCRIPT_HEAD.exec(head)?.[1];
  return url === undefined
    ? { kind: "opaque" }
    : { kind: "single-script", url };
}

/**
 * Whether one classified profile can be excluded from every report pass.
 * Only a positively identified single-script profile outside the src prefix
 * qualifies; an opaque head must shard so the report filter decides.
 */
export function isPrunableProfile(
  head: RawProfileHead,
  srcUrlPrefix: string,
): boolean {
  return head.kind === "single-script" && !head.url.startsWith(srcUrlPrefix);
}

/**
 * How many report passes to run at once: the machine's cores less scheduler
 * headroom, never fewer than one.
 */
export function reportShardCount(cores: number): number {
  if (!Number.isFinite(cores) || cores < 1) return 1;
  return Math.max(1, Math.floor(cores) - 2);
}

/** What pruning and sharding did to one profile directory. */
export interface ProfileShardingSummary {
  /** Shard directories that received at least one profile, creation order. */
  readonly shardDirs: readonly string[];
  /** Profiles moved into a shard for a report pass. */
  readonly sharded: number;
  /** Profiles excluded from every report pass. */
  readonly pruned: number;
  /** Sharded profiles kept conservatively because their head was opaque. */
  readonly opaque: number;
}

/** Read up to {@link HEAD_BYTES} leading bytes of one file as text. */
async function readHead(path: string): Promise<string> {
  const file = await Deno.open(path, { read: true });
  try {
    const buffer = new Uint8Array(HEAD_BYTES);
    const read = await file.read(buffer);
    return HEAD_DECODER.decode(buffer.subarray(0, read ?? 0));
  } finally {
    file.close();
  }
}

/**
 * Prune the profiles no report pass needs and move the rest into shard
 * subdirectories of `profileDir`, ready for one report pass each.
 *
 * The directory must be quiescent — the instrumented run that wrote it has
 * exited. Pruned profiles stay in place untouched; only shard directories
 * are handed to report passes, so staying in place excludes them. Any
 * filesystem failure throws: a measurement that cannot account for every
 * profile must fail loudly rather than undercount.
 */
export async function pruneAndShardProfiles(
  profileDir: string,
  srcUrlPrefix: string,
  shardTotal: number,
  concurrency = 64,
): Promise<ProfileShardingSummary> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(profileDir)) {
    if (entry.isFile && entry.name.endsWith(".json")) names.push(entry.name);
  }
  names.sort();
  const dirs = Array.from(
    { length: Math.max(1, shardTotal) },
    (_, index) => join(profileDir, `shard-${index}`),
  );
  await Promise.all(dirs.map((dir) => Deno.mkdir(dir)));
  const counts = dirs.map(() => 0);
  let cursor = 0;
  let sharded = 0;
  let pruned = 0;
  let opaque = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      const name = names[index];
      if (name === undefined) return;
      const path = join(profileDir, name);
      const head = classifyRawProfileHead(await readHead(path));
      if (isPrunableProfile(head, srcUrlPrefix)) {
        pruned += 1;
        continue;
      }
      if (head.kind === "opaque") opaque += 1;
      const slot = sharded % dirs.length;
      sharded += 1;
      const target = dirs[slot];
      if (target === undefined) {
        throw new Error(`profile shard slot ${slot} has no directory`);
      }
      counts[slot] = (counts[slot] ?? 0) + 1;
      await Deno.rename(path, join(target, name));
    }
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, names.length)) },
    () => worker(),
  );
  await Promise.all(workers);
  return {
    shardDirs: dirs.filter((_, index) => (counts[index] ?? 0) > 0),
    sharded,
    pruned,
    opaque,
  };
}
