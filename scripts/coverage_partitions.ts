/** Process only coverage partitions whose owned writer group has settled. */
import { basename, join } from "@std/path";
import {
  type ProfileShardingSummary,
  pruneAndShardProfiles,
} from "./coverage_profiles.ts";
import type { CoveragePartitionObserver } from "./test_partitions.ts";

type ProfileCounts = {
  -readonly [Key in keyof Omit<ProfileShardingSummary, "shardDirs">]:
    ProfileShardingSummary[Key];
};

/** One active reducer; pending work retains only bounded partition identifiers. */
export class CoverageProfilePartitions implements CoveragePartitionObserver {
  private expected: number | undefined;
  private readonly admitted = new Set<number>();
  private readonly populated = new Set<string>();
  private readonly failures: unknown[] = [];
  private tail: Promise<void> = Promise.resolve();
  private completion: Promise<ProfileShardingSummary> | undefined;
  private stopped = false;
  private closed = false;
  private readonly counts: ProfileCounts = {
    input_files: 0,
    read_bytes: 0,
    enumeration_ms: 0,
    classification_ms: 0,
    compaction_ms: 0,
    weighted_parse_ms: 0,
    sharded: 0,
    pruned: 0,
    opaque: 0,
    compacted: 0,
  };

  constructor(
    private readonly options: {
      readonly raw: string;
      readonly reports: string;
      readonly prefix: string;
      readonly shards: number;
      readonly process?: typeof pruneAndShardProfiles;
    },
  ) {}

  /** Fix the complete admission set before admitting completed partitions. */
  started(count: number): void {
    if (
      this.closed || this.expected !== undefined ||
      !Number.isSafeInteger(count) || count < 1
    ) {
      this.rejectAdmission(
        "Coverage partitions need one positive expected count.",
      );
    }
    this.expected = count;
  }

  /** Admit a partition only after its native process and owned writers settle. */
  settled(index: number): void {
    if (this.stopped) return;
    if (
      this.closed || this.expected === undefined ||
      !Number.isSafeInteger(index) || index < 1 || index > this.expected ||
      this.admitted.has(index)
    ) {
      this.rejectAdmission(
        `Invalid or repeated settled coverage partition ${index}.`,
      );
    }
    this.admitted.add(index);
    this.tail = this.tail.then(async (): Promise<void> => {
      if (this.stopped || this.failures.length > 0) return;
      const directory = join(this.options.raw, `test-shard-${index}`);
      // An empty native selection may leave no coverage directory.
      await Deno.mkdir(directory, { recursive: true });
      await this.process(directory, `partition-${index}`);
    }).catch((error: unknown): void => {
      this.failures.push(error);
    });
  }

  /** Settle admitted work and preserve residual observations from the ended suite. */
  finish(completeSuite: boolean): Promise<ProfileShardingSummary> {
    this.closed = true;
    this.completion ??= this.complete(completeSuite);
    return this.completion.then((summary): ProfileShardingSummary => {
      this.verifyState(completeSuite);
      return summary;
    });
  }

  /** Stop admitting processor work when the producer is interrupted. */
  stop(): void {
    this.stopped = true;
  }

  /** Stop pending work and await all active IO before the caller removes scratch. */
  async stopAndWait(): Promise<void> {
    this.stop();
    await Promise.allSettled([
      this.tail,
      ...(this.completion === undefined ? [] : [this.completion]),
    ]);
  }

  private rejectAdmission(message: string): never {
    const error = new Error(message);
    this.failures.push(error);
    throw error;
  }

  private verifyState(completeSuite: boolean): void {
    if (this.stopped) {
      throw new DOMException("Coverage processing stopped.", "AbortError");
    }
    if (this.failures.length > 0) {
      throw new AggregateError(
        this.failures,
        "Coverage profile processing failed after active IO settled.",
      );
    }
    if (
      completeSuite && this.expected !== undefined &&
      this.admitted.size !== this.expected
    ) {
      throw new Error(
        `Only ${this.admitted.size}/${this.expected} coverage partitions settled; no complete coverage.`,
      );
    }
  }

  private async complete(
    completeSuite: boolean,
  ): Promise<ProfileShardingSummary> {
    await this.tail;
    this.verifyState(completeSuite);
    // Bulk fallback when no owned-partition observer ran; otherwise this also
    // preserves any residual raw inputs from a failed, fully settled suite.
    await this.process(this.options.raw, "remainder");
    return {
      ...this.counts,
      // An unknown header cannot establish module identity. Merge all inputs in
      // one native pass so it cannot split a module's range observations.
      shardDirs: this.counts.opaque > 0
        ? [this.options.reports]
        : [...this.populated].sort(),
    };
  }

  private async process(directory: string, label: string): Promise<void> {
    const summary = await (this.options.process ?? pruneAndShardProfiles)(
      directory,
      this.options.prefix,
      this.options.shards,
    );
    for (const dir of summary.shardDirs) {
      const target = join(this.options.reports, basename(dir));
      await Deno.mkdir(target, { recursive: true });
      await Deno.rename(dir, join(target, label));
      this.populated.add(target);
    }
    for (const key of Object.keys(this.counts) as (keyof ProfileCounts)[]) {
      this.counts[key] += summary[key];
    }
  }
}
