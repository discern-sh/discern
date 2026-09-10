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
 * - **Shard**: kept profiles spread across shard directories by module-URL
 *   hash, one report pass each. Confining every module's profiles to one
 *   pass makes that pass's per-module range merge identical to the single
 *   merged pass — V8 range-tree merging is not per-line decomposable across
 *   partitions of one module's profiles, so URL-hash assignment is what
 *   keeps the sharded numbers exact. An opaque head routes by filename
 *   hash; the join's per-line union covers that degraded case.
 * Identical recognized profiles are weighted before reporting. A bounded
 * identity budget limits memory; overflow and unfamiliar formats remain raw.
 * Scratch cleanup belongs to the producer's awaited temporary-directory lifetime.
 */

import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import { type Clock, SYSTEM_CLOCK } from "../src/shared/clock.ts";

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
  /** Raw file inventory and bytes actually read, without a second filesystem pass. */
  readonly input_files: number;
  readonly read_bytes: number;
  /** Sequential elapsed phases; weighted parsing is a subset of compaction. */
  readonly enumeration_ms: number;
  readonly classification_ms: number;
  readonly compaction_ms: number;
  readonly weighted_parse_ms: number;

  /** Shard directories that received at least one profile, creation order. */
  readonly shardDirs: readonly string[];
  /** Profiles moved into a shard for a report pass. */
  readonly sharded: number;
  /** Profiles excluded from every report pass. */
  readonly pruned: number;
  /** Sharded profiles kept conservatively because their head was opaque. */
  readonly opaque: number;
  /** Repeated observations represented by weighted range counts. */
  readonly compacted: number;
}

/** UTF-8 identities preserve byte distinctions, including a leading BOM. */
const IDENTITY_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

/** The native single-script profile fields needed for exact count weighting. */
export const RawCoverageProfileSchema = z.looseObject({
  scriptId: z.string(),
  url: z.string(),
  functions: z.array(z.looseObject({
    functionName: z.string(),
    isBlockCoverage: z.boolean(),
    ranges: z.array(z.looseObject({
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      count: z.number().int().nonnegative(),
    })),
  })),
});

/** Unrecognized encodings stay independent inputs to the native reporter. */
function profileIdentity(bytes: Uint8Array): string | undefined {
  try {
    return IDENTITY_DECODER.decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

/** Replace repeated identical observations with their exact count sum.
 * Unknown formats and counts beyond exact integer arithmetic retain every
 * original observation for the native reporter instead of approximating. */
function weightedProfile(text: string, copies: number): string | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  const parsed = RawCoverageProfileSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  for (const fn of parsed.data.functions) {
    for (const range of fn.ranges) {
      const count = range.count * copies;
      if (!Number.isSafeInteger(count)) return undefined;
      range.count = count;
    }
  }
  return JSON.stringify(parsed.data);
}

interface ProfileGroup {
  readonly text: string;
  readonly target: string;
  readonly duplicates: number[];
}

/** Stop claiming work after failure and await every active IO owner. */
async function profileWorkers<T>(
  entries: readonly T[],
  concurrency: number,
  operation: (entry: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (failures.length === 0) {
      const index = cursor++;
      const entry = entries[index];
      if (entry === undefined) return;
      try {
        await operation(entry, index);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.max(1, Math.min(concurrency, entries.length)) },
    () => worker(),
  ));
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "profile processing failed after active workers settled",
    );
  }
}

/** Deterministic 32-bit FNV-1a hash for shard assignment. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Discover every raw input after all test partitions have become quiescent. */
async function rawProfileNames(profileDir: string): Promise<string[]> {
  const names: string[] = [];
  const pending = [""];
  for (const relative of pending) {
    for await (const entry of Deno.readDir(join(profileDir, relative))) {
      const name = join(relative, entry.name);
      if (entry.isDirectory) pending.push(name);
      else if (entry.isFile && entry.name.endsWith(".json")) names.push(name);
    }
  }
  names.sort();
  return names;
}

/**
 * Collect every raw input directory, prune profiles no report pass needs, and
 * move the rest into report subdirectories with collision-free filenames.
 *
 * The directory must be quiescent — the instrumented run that wrote it has
 * exited. Foreign inputs are removed during classification; repeated originals
 * are removed after their weighted representative is written. Each disposal is
 * awaited while processing owns the input metadata. Only shard directories are
 * handed to report passes. Any
 * filesystem failure throws: a measurement that cannot account for every
 * profile must fail loudly rather than undercount.
 */
export async function pruneAndShardProfiles(
  profileDir: string,
  srcUrlPrefix: string,
  shardTotal: number,
  concurrency = 256,
  maxIdentityBytes = 128 * 1024 * 1024,
  clock: Pick<Clock, "monotonicNow"> = SYSTEM_CLOCK,
): Promise<ProfileShardingSummary> {
  const started = clock.monotonicNow();
  const names = await rawProfileNames(profileDir);
  const enumerated = clock.monotonicNow();
  let readBytes = 0;
  let weightedParseMs = 0;
  const inputPath = (index: number): string => {
    const name = names[index];
    if (name === undefined) throw new Error(`Missing coverage input ${index}`);
    return join(profileDir, name);
  };
  const dirs = Array.from(
    { length: Math.max(1, shardTotal) },
    (_, index) => join(profileDir, `shard-${index}`),
  );
  for (const dir of dirs) await Deno.mkdir(dir);
  const counts = dirs.map(() => 0);
  const groups = new Map<string, ProfileGroup>();
  let identityBytes = 0;
  let sharded = 0;
  let pruned = 0;
  let opaque = 0;
  let compacted = 0;
  await profileWorkers(names, concurrency, async (name, index) => {
    const path = join(profileDir, name);
    const bytes = await Deno.readFile(path);
    readBytes += bytes.byteLength;
    const head = classifyRawProfileHead(
      HEAD_DECODER.decode(bytes.subarray(0, HEAD_BYTES)),
    );
    if (isPrunableProfile(head, srcUrlPrefix)) {
      await Deno.remove(path);
      pruned += 1;
      return;
    }
    if (head.kind === "opaque") opaque += 1;
    const slot = fnv1a(head.kind === "single-script" ? head.url : name) %
      dirs.length;
    const target = dirs[slot];
    if (target === undefined) {
      throw new Error(`profile shard slot ${slot} has no directory`);
    }
    const destination = join(target, `${index}.json`);
    const identity = head.kind === "single-script"
      ? profileIdentity(bytes)
      : undefined;
    if (identity !== undefined) {
      const group = groups.get(identity);
      if (group !== undefined) {
        group.duplicates.push(index);
        return;
      }
      // Bounded identity retention affects compression only; overflow reports raw inputs.
      const size = identity.length * 2;
      if (identityBytes + size <= maxIdentityBytes) {
        identityBytes += size;
        groups.set(identity, {
          text: identity,
          target: destination,
          duplicates: [],
        });
      }
    }
    sharded += 1;
    counts[slot] = (counts[slot] ?? 0) + 1;
    await Deno.rename(path, destination);
  });
  const classified = clock.monotonicNow();
  await profileWorkers([...groups.values()], concurrency, async (group) => {
    if (group.duplicates.length === 0) return;
    const parseStarted = clock.monotonicNow();
    const weighted = weightedProfile(group.text, group.duplicates.length + 1);
    weightedParseMs += clock.monotonicNow() - parseStarted;
    if (weighted === undefined) {
      for (const index of group.duplicates) {
        const path = inputPath(index);
        const destination = join(dirname(group.target), `${index}.json`);
        await Deno.rename(path, destination);
        sharded += 1;
      }
      return;
    }
    await Deno.writeTextFile(group.target, weighted);
    for (const index of group.duplicates) {
      await Deno.remove(inputPath(index));
    }
    compacted += group.duplicates.length;
  });
  return {
    input_files: names.length,
    read_bytes: readBytes,
    enumeration_ms: enumerated - started,
    classification_ms: classified - enumerated,
    compaction_ms: clock.monotonicNow() - classified,
    weighted_parse_ms: weightedParseMs,
    shardDirs: dirs.filter((_, index) => (counts[index] ?? 0) > 0),
    sharded,
    pruned,
    opaque,
    compacted,
  };
}
