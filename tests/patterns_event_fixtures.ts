/** Registration-free event constructors shared by registry and validation reader guards. */
import { assert } from "@std/assert";
import { type Detector, DETECTORS } from "../src/engine/logbook/detectors.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import type { MergeAttempt } from "../src/shared/merge_observation.ts";

/** Complete observations with independent revisions and unrelated authored filenames. */
export function mergeAttempt(
  index: number,
  overrides: Partial<MergeAttempt> = {},
): MergeAttempt {
  return {
    effort: `agent/effort-${index % 2}`,
    route: "update",
    head: index.toString(16).padStart(40, "0"),
    incoming: "f".repeat(40),
    outcome: "conflict",
    conflicts: [{ path: "records/pending.md", generated: false }],
    paths_omitted: 0,
    ...overrides,
  };
}

/** A deterministic timestamp `n` hours after the fixture epoch. */
export function t(hours: number): string {
  return new Date(Date.parse("2026-07-01T00:00:00.000Z") + hours * 3_600_000)
    .toISOString();
}

/** One synthetic analyzable CLI event with non-interactive defaults. */
export function verb(over: Partial<VerbEvent>): VerbEvent {
  return {
    schema: LOGBOOK_SCHEMA_VERSION,
    at: t(0),
    kind: "verb",
    verb: "done",
    surface: "cli",
    writer: "9.9.9",
    driver: { session: "cli:1", json: true, tty: false, ci: false },
    branch: "agent/task",
    head: "abc1234",
    clean: true,
    outcome: "ok",
    duration_ms: 1_000,
    epoch: "e1",
    ...over,
  };
}

/** An observed full completion with explicit wait accounting and a durable invocation. */
export function timedEvents(events: LogbookEvent[]): LogbookEvent[] {
  return events.map((event, i) =>
    event.kind !== "verb" ? event : {
      gate_ran: true,
      waited_ms: 0,
      invocation: `duration-${i}`,
      change: { files: 3, insertions: 30, deletions: 5, commits: 2 },
      ...event,
    }
  );
}

/** A known executed timing series for tests that vary its measured conditions. */
export function timedRun(overrides: Partial<VerbEvent>[]): LogbookEvent[] {
  return timedEvents(run(overrides));
}

/** A sequence of verb events, one per override, timestamped an hour apart. */
export function run(overrides: Partial<VerbEvent>[]): LogbookEvent[] {
  return overrides.map((over, i) => verb({ at: t(i), ...over }));
}

/** A red `done` whose failure reached the tests. */
export function redDone(over: Partial<VerbEvent> = {}): Partial<VerbEvent> {
  return {
    verb: "done",
    outcome: "failed",
    failed_stage: "check/test",
    ...over,
  };
}

/** One identified full-test failure beside an explicitly successful canary. */
export function canaryMiss(
  index: number,
  file = "tests/hot_test.ts",
): Partial<VerbEvent> {
  return redDone({
    invocation: `canary-miss-${index}`,
    steps: [step("canary", 0.1, "Check"), {
      ...step("test", 1, "Test"),
      outcome: "failed",
    }],
    diagnostics: [{ tool: "test", file, count: 100 }],
  });
}

/** A timed gate step. */
export function step(
  label: string,
  durationS: number,
  group = "Check & test",
): NonNullable<VerbEvent["steps"]>[number] {
  return {
    label,
    kind: "job",
    outcome: "ok",
    disposition: "run",
    group,
    duration_s: durationS,
  };
}

/** Resolve a detector from the canonical registry and fail with its missing identifier. */
export function detector(id: string): Detector {
  const found = DETECTORS.find((entry) => entry.id === id);
  assert(found !== undefined, `no detector ${id}`);
  return found;
}

interface ValidationFixtureJob {
  id: string;
  outcome: "passed" | "failed" | "skipped" | "cancelled" | "unavailable";
  stage?: string;
  kind?: string;
  definition?: string;
  concurrent?: boolean;
}

export interface ValidationFixtureOptions {
  digest?: string;
  complete?: boolean;
  executionComplete?: boolean;
  mode?: "full-gate" | "standalone-test";
  config?: string;
  setup?: string;
  writer?: string;
  job?: string;
  definition?: string;
  concurrent?: boolean;
  siblings?: ValidationFixtureJob[];
  version?: number;
}

/** One validation record whose job list is the detector fixture's enrollment source. */
export function validation(
  outcome: "passed" | "failed" | "skipped" | "cancelled" | "unavailable",
  over: ValidationFixtureOptions = {},
): NonNullable<VerbEvent["validation"]> {
  const complete = over.complete ?? true;
  const version = over.version ?? 1;
  return {
    version,
    state: {
      version,
      complete,
      capture: over.mode === "full-gate"
        ? "after-fix-build"
        : "before-test-group",
      elapsed_ms: 1,
      ...(complete ? { digest: over.digest ?? "state-a" } : {}),
      components: {},
      counts: {
        index_entries: 1,
        tracked_paths: 0,
        untracked_paths: 0,
        submodules: 0,
      },
      bytes: {
        index_manifest: 40,
        tracked_content: 0,
        untracked_content: 0,
      },
      ...(!complete
        ? { incomplete: [{ category: "budget", reason: "byte-limit" }] }
        : {}),
      exclusions: [],
    },
    execution: {
      version,
      complete: over.executionComplete ?? true,
      mode: over.mode ?? "standalone-test",
      writer: over.writer ?? "9.9.9",
      config_digest: over.config ?? "config-a",
      setup_digest: over.setup ?? "setup-a",
      jobs: [
        {
          id: over.job ?? "test",
          stage: "test",
          kind: "known",
          definition_digest: over.definition ?? "job-a",
          outcome,
          concurrent_siblings: over.concurrent ?? false,
        },
        ...(over.siblings ?? []).map((job) => ({
          id: job.id,
          stage: job.stage ?? "test",
          kind: job.kind ?? "known",
          definition_digest: job.definition ?? `definition-${job.id}`,
          outcome: job.outcome,
          concurrent_siblings: job.concurrent ?? false,
        })),
      ],
    },
  } as NonNullable<VerbEvent["validation"]>;
}

/** A completed validation repeat with explicit evidence, independent of caller identity. */
export function repeatedGreenRuns(): LogbookEvent[] {
  return run(Array.from({ length: 3 }, (_, i) => ({
    invocation: `repeated-${i}`,
    gate_ran: true,
    validation: validation("passed", { mode: "full-gate" }),
  })));
}

/** Failed validation iterations followed by a completed invocation. */
export function failedValidationCycle(): LogbookEvent[] {
  return run([redDone(), redDone(), redDone(), { verb: "done" }]);
}
