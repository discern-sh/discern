/**
 * The logbook **stream reader** — how a reader gets the whole recorded history
 * as one chronological event list, holding the substrate's tolerance contract
 * (see `schema.ts`): a torn or foreign line is skipped and COUNTED, never fatal,
 * and a missing logbook is an empty stream, not an error.
 *
 * Read-only by design: this module (and everything downstream of it — the
 * detectors, the `patterns` verb) never writes. The store (`store.ts`) remains
 * the subsystem's only write site, which is what the write-surface guard holds.
 */

import { join } from "@std/path";
import { readDirIfExists, readTextIfExists } from "../../shared/fs_presence.ts";
import { logbookDir, MONTH_FILE_RE } from "./store.ts";
import {
  type BeginEvent,
  executionDurationMs,
  type LogbookEvent,
  type LogbookOutcome,
  parseLogbookLine,
  type VerbEvent,
} from "./schema.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  operationEffectPolicy,
  type OperationLockBoundary,
} from "../../shared/operation_effects.ts";

/** The bounded event population a fleet survey inspects. */
export const FLEET_ACTIVITY_EVENT_LIMIT = 200;
/** An unmatched begin survives for at least this long as in-flight work. */
export const RUNNING_STALE_MIN_MS = 60 * 60 * 1000;
/** With a duration prior, this multiple bounds how long an unmatched begin runs. */
export const RUNNING_STALE_MULTIPLIER = 10;
/** Without a duration prior, unmatched work stops reading as running after 1 day. */
export const RUNNING_STALE_WITHOUT_PRIOR_MS = 24 * 60 * 60 * 1000;

/** The newest completed verb action on one branch. */
export interface LastCompletedAction {
  verb: string;
  outcome: LogbookOutcome;
  at: string;
  failedStage?: string;
}

/** One fresh begin event whose paired completion is absent. */
export interface InFlightAction {
  verb: string;
  started: string;
}

/** One verb's project-wide duration evidence from the bounded event tail. */
export interface DurationPrior {
  /** Median execution time, used where "typical" is the user-facing fact. */
  medianMs: number;
  /** Nearest-rank 90th percentile, used for an upper-bound wait. */
  p90Ms: number;
  /** Completed invocations behind both readings. */
  samples: number;
}

/** Logbook-derived activity for one branch. */
export interface BranchLogbookActivity {
  lastAction?: LastCompletedAction;
  /** Every fresh unmatched begin, oldest first. Consumers choose their view. */
  inFlight?: InFlightAction[];
  /** The newest in-flight action, retained as the compact fleet-row view. */
  running?: InFlightAction;
  /** The newest attributed event of any kind, including an unmatched begin. */
  lastEventAt?: string;
}

/** The fleet activity read: branch facts plus project-wide duration priors. */
export interface FleetLogbookActivity {
  byBranch: Map<string, BranchLogbookActivity>;
  durationPriors: Map<string, DurationPrior>;
}

/** One whole logbook, read tolerantly. */
export interface LogbookStream {
  /** Every well-formed event, oldest first (ordered by `at`; ties keep file order). */
  events: LogbookEvent[];
  /** Torn or foreign lines skipped while reading — honesty for the report. */
  unparsed: number;
  /** The month files read, oldest first (`2026-06.jsonl`, …). */
  months: string[];
}

/** Counts and date bounds shared by lifecycle plans and archive listings. */
export interface LogbookStreamSummary {
  events: number;
  unparsed: number;
  firstAt?: string;
  lastAt?: string;
}

/** One fresh unmatched invocation that can still be doing repository work. */
export interface FreshInFlightInvocation {
  invocation: string;
  verb: string;
  branch: string | null;
  started: string;
}

/** An empty stream — the absent-logbook state. */
function emptyStream(): LogbookStream {
  return { events: [], unparsed: 0, months: [] };
}

/** Summarize a tolerant stream without changing its population. */
export function summarizeLogbookStream(
  stream: LogbookStream,
): LogbookStreamSummary {
  const first = stream.events[0];
  const last = stream.events[stream.events.length - 1];
  return {
    events: stream.events.length,
    unparsed: stream.unparsed,
    ...(first !== undefined ? { firstAt: first.at } : {}),
    ...(last !== undefined ? { lastAt: last.at } : {}),
  };
}

/** Parse raw JSONL text with the Logbook's torn/foreign-line tolerance. */
function parseLogbookText(text: string): {
  events: LogbookEvent[];
  unparsed: number;
} {
  const events: LogbookEvent[] = [];
  let unparsed = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const parsed = parseLogbookLine(line);
    if (parsed.kind === "event") {
      events.push(parsed.event);
    } else {
      unparsed += 1;
    }
  }
  return { events, unparsed };
}

/** Order events chronologically while preserving file order for equal times. */
function sortEvents(events: LogbookEvent[]): void {
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Group branch-attributed values, dropping unresolvable branch names. */
export function byBranch<T extends { branch: string | null }>(
  events: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const event of events) {
    if (event.branch === null) {
      continue;
    }
    const group = groups.get(event.branch);
    if (group === undefined) {
      groups.set(event.branch, [event]);
    } else {
      group.push(event);
    }
  }
  return groups;
}

/** Median and P90 execution time, excluding any recorded slot wait. */
function durationPrior(
  events: readonly VerbEvent[],
): DurationPrior | undefined {
  if (events.length === 0) {
    return undefined;
  }
  const values = events.map(executionDurationMs).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const high = values[middle];
  if (high === undefined) {
    return undefined;
  }
  const low = values[middle - 1];
  const median = values.length % 2 === 1 || low === undefined
    ? high
    : (low + high) / 2;
  const p90Index = Math.max(0, Math.ceil(values.length * 0.9) - 1);
  const p90 = values[p90Index];
  if (p90 === undefined) {
    return undefined;
  }
  return {
    medianMs: Math.round(median),
    p90Ms: Math.round(p90),
    samples: values.length,
  };
}

/** The staleness horizon for one verb's unmatched begin event. */
function runningStaleAfter(prior: DurationPrior | undefined): number {
  return prior === undefined ? RUNNING_STALE_WITHOUT_PRIOR_MS : Math.max(
    RUNNING_STALE_MIN_MS,
    prior.medianMs * RUNNING_STALE_MULTIPLIER,
  );
}

/** Derive one current-first duration prior map from completed invocations. */
function durationPriorsFor(
  completions: readonly VerbEvent[],
  currentEpoch: string,
): Map<string, DurationPrior> {
  const completionsByVerb = new Map<string, VerbEvent[]>();
  for (const event of completions) {
    const group = completionsByVerb.get(event.verb);
    if (group === undefined) {
      completionsByVerb.set(event.verb, [event]);
    } else {
      group.push(event);
    }
  }
  const priors = new Map<string, DurationPrior>();
  for (const [verb, samples] of completionsByVerb) {
    const current = samples.filter((event) => event.epoch === currentEpoch);
    const prior = durationPrior(current.length > 0 ? current : samples);
    if (prior !== undefined) priors.set(verb, prior);
  }
  return priors;
}

/** Resolve one event's exclusion boundary. Its invocation-time answer wins;
 * an absent answer derives from current policy and retained invocation facts. */
function eventLockBoundary(
  event: BeginEvent | VerbEvent,
): OperationLockBoundary | undefined {
  if (event.lock_boundary !== undefined) return event.lock_boundary;
  return operationEffectPolicy(event.verb, {
    ...(event.flags === undefined ? {} : { flags: event.flags }),
    ...(event.dry_run === true ? { dryRun: true } : {}),
    ...(event.has_operands === undefined
      ? {}
      : { hasOperands: event.has_operands }),
  })?.lock;
}

/** Whether one boundary contains the repository-wide lock. */
function includesCommon(boundary: OperationLockBoundary): boolean {
  return boundary === "common" || boundary === "common-and-checkout";
}

/** Whether one boundary contains a checkout-local lock. */
function includesCheckout(boundary: OperationLockBoundary): boolean {
  return boundary === "checkout" || boundary === "common-and-checkout";
}

/** Whether one invocation belongs to an ancestor's recorded child chain. */
function invocationDescendsFrom(
  invocation: string,
  ancestor: string,
  parents: ReadonlyMap<string, string>,
): boolean {
  const visited = new Set<string>();
  let parent = parents.get(invocation);
  while (parent !== undefined && !visited.has(parent)) {
    if (parent === ancestor) return true;
    visited.add(parent);
    parent = parents.get(parent);
  }
  return false;
}

/** A later completion can disprove an older live claim only when it ran under
 * an exclusion boundary the older invocation would also have held. */
function completionSupersedesBegin(
  begin: BeginEvent,
  completedBegin: BeginEvent | undefined,
  completion: VerbEvent,
  parents: ReadonlyMap<string, string>,
): boolean {
  if (
    completedBegin === undefined || completion.outcome === "refused" ||
    completedBegin.at <= begin.at || completion.at < completedBegin.at
  ) {
    return false;
  }
  if (
    invocationDescendsFrom(
      completedBegin.invocation,
      begin.invocation,
      parents,
    )
  ) {
    return false;
  }
  const startedBoundary = eventLockBoundary(begin);
  const completedBoundary = eventLockBoundary(completedBegin);
  if (
    startedBoundary === undefined || completedBoundary === undefined ||
    startedBoundary === "none" || completedBoundary === "none"
  ) {
    return false;
  }
  if (includesCommon(startedBoundary) && includesCommon(completedBoundary)) {
    return true;
  }
  return includesCheckout(startedBoundary) &&
    includesCheckout(completedBoundary) &&
    begin.branch !== null && begin.branch === completedBegin.branch;
}

/** The shared fresh-unmatched population behind status and lifecycle safety. */
function freshUnmatchedBegins(
  events: readonly LogbookEvent[],
  completions: readonly VerbEvent[],
  priors: ReadonlyMap<string, DurationPrior>,
  nowMs: number,
): BeginEvent[] {
  const begins = events.filter((event): event is BeginEvent =>
    event.kind === "begin"
  );
  const beginsByInvocation = new Map(
    begins.map((event) => [event.invocation, event] as const),
  );
  const parents = new Map<string, string>();
  for (const event of events) {
    if (event.kind !== "begin" && event.kind !== "verb") continue;
    const invocation = event.invocation;
    const parent = event.driver?.spawned_by;
    if (invocation !== undefined && parent !== undefined) {
      parents.set(invocation, parent);
    }
  }
  const finished = new Set(
    completions.flatMap((event) =>
      event.invocation === undefined ? [] : [event.invocation]
    ),
  );
  return begins
    .filter((event) => !finished.has(event.invocation))
    .filter((begin) =>
      !completions.some((completion) =>
        completionSupersedesBegin(
          begin,
          completion.invocation === undefined
            ? undefined
            : beginsByInvocation.get(completion.invocation),
          completion,
          parents,
        )
      )
    )
    .filter((event) => {
      const started = Date.parse(event.at);
      if (Number.isNaN(started)) return false;
      return Math.max(0, nowMs - started) <=
        runningStaleAfter(priors.get(event.verb));
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Find every fresh begin whose completion is absent. This is the shared
 * liveness predicate behind fleet activity and lifecycle safety checks.
 */
export function freshInFlightInvocations(
  events: readonly LogbookEvent[],
  currentEpoch: string,
  nowMs: number = SYSTEM_CLOCK.wallNow(),
): FreshInFlightInvocation[] {
  const completions = events.filter((event): event is VerbEvent =>
    event.kind === "verb"
  );
  const priors = durationPriorsFor(completions, currentEpoch);
  return freshUnmatchedBegins(events, completions, priors, nowMs)
    .map((event) => ({
      invocation: event.invocation,
      verb: event.verb,
      branch: event.branch,
      started: event.at,
    }));
}

type BranchEvent = Exclude<LogbookEvent, { kind: "prune" }>;

/**
 * Derive fleet activity from one bounded, chronological event tail. Duration
 * priors use completed events from the current config epoch when any exist for
 * that verb, then fall back to every recent completion. A fresh unmatched begin
 * is running; after its verb-specific horizon it remains crash evidence and
 * last-activity evidence without claiming live work.
 */
export function deriveFleetLogbookActivity(
  events: readonly LogbookEvent[],
  currentEpoch: string,
  nowMs: number = SYSTEM_CLOCK.wallNow(),
): FleetLogbookActivity {
  const completions = events.filter((event): event is VerbEvent =>
    event.kind === "verb"
  );
  const durationPriors = durationPriorsFor(completions, currentEpoch);
  const freshBegins = byBranch(
    freshUnmatchedBegins(events, completions, durationPriors, nowMs),
  );
  const attributed = events.filter((event): event is BranchEvent =>
    event.kind !== "prune"
  );
  const activity = new Map<string, BranchLogbookActivity>();

  for (const [branch, branchEvents] of byBranch(attributed)) {
    const branchActivity: BranchLogbookActivity = {};
    for (const event of branchEvents) {
      if (
        branchActivity.lastEventAt === undefined ||
        event.at >= branchActivity.lastEventAt
      ) {
        branchActivity.lastEventAt = event.at;
      }
      if (
        event.kind === "verb" &&
        (branchActivity.lastAction === undefined ||
          event.at >= branchActivity.lastAction.at)
      ) {
        branchActivity.lastAction = {
          verb: event.verb,
          outcome: event.outcome,
          at: event.at,
          ...(event.failed_stage !== undefined
            ? { failedStage: event.failed_stage }
            : {}),
        };
      }
    }

    const inFlight = (freshBegins.get(branch) ?? [])
      .map((event): InFlightAction => ({
        verb: event.verb,
        started: event.at,
      }));
    const running = inFlight.at(-1);
    if (running !== undefined) {
      branchActivity.inFlight = inFlight;
      branchActivity.running = running;
    }
    activity.set(branch, branchActivity);
  }

  return { byBranch: activity, durationPriors };
}

/** Read and derive the bounded activity tail used by `status` fleet rows. */
export async function readFleetLogbookActivity(
  commonGitDir: string,
  currentEpoch: string,
  nowMs: number = SYSTEM_CLOCK.wallNow(),
): Promise<FleetLogbookActivity> {
  const stream = await readRecentLogbookStream(
    commonGitDir,
    FLEET_ACTIVITY_EVENT_LIMIT,
  );
  return deriveFleetLogbookActivity(stream.events, currentEpoch, nowMs);
}

/**
 * Read every month file under the logbook directory into one chronological
 * stream. Month files sort chronologically by name; events are then ordered by
 * their own `at` (concurrent worktrees can interleave appends out of order, and
 * ISO-8601 UTC strings compare lexicographically). Never throws for a missing
 * or unreadable logbook — that is an empty stream.
 */
export async function readLogbookStream(
  commonGitDir: string,
): Promise<LogbookStream> {
  const dir = logbookDir(commonGitDir);
  const months: string[] = [];
  let entries: Deno.DirEntry[] | undefined;
  try {
    entries = await readDirIfExists(dir);
  } catch {
    return { events: [], unparsed: 1, months: [] };
  }
  if (entries === undefined) return emptyStream();
  for (const entry of entries) {
    if (entry.isFile && MONTH_FILE_RE.test(entry.name)) {
      months.push(entry.name);
    }
  }
  months.sort();
  const events: LogbookEvent[] = [];
  let unparsed = 0;
  for (const name of months) {
    let text: string | undefined;
    try {
      text = await readTextIfExists(join(dir, name));
    } catch {
      // discern-best-effort: logbook-month-read-outcome
      unparsed += 1;
      continue;
    }
    if (text === undefined) {
      unparsed += 1; // an unreadable month counts as one skipped unit
      continue;
    }
    const parsed = parseLogbookText(text);
    events.push(...parsed.events);
    unparsed += parsed.unparsed;
  }
  // Stable sort: same-`at` events keep their file order.
  sortEvents(events);
  return { events, unparsed, months };
}

/**
 * Read one sealed archive file tolerantly. Unlike the active reader, a missing
 * or unreadable selected archive is an error for its caller to report.
 */
export async function readLogbookFile(
  path: string,
  filename: string,
): Promise<LogbookStream> {
  const parsed = parseLogbookText(await Deno.readTextFile(path));
  sortEvents(parsed.events);
  return {
    events: parsed.events,
    unparsed: parsed.unparsed,
    months: [filename],
  };
}

/**
 * Read a bounded tail for unsolicited inline detectors. Month files are visited
 * newest-first and reading stops as soon as the parsed population reaches the
 * cap; the returned events are then ordered oldest-first like the full reader.
 * A reader may parse more than `maxEvents` from the final month file, but only
 * the newest `maxEvents` enter detector analysis. Older months are never read.
 */
export async function readRecentLogbookStream(
  commonGitDir: string,
  maxEvents: number,
): Promise<LogbookStream> {
  if (!Number.isInteger(maxEvents) || maxEvents <= 0) {
    return emptyStream();
  }
  const dir = logbookDir(commonGitDir);
  const available: string[] = [];
  let entries: Deno.DirEntry[] | undefined;
  try {
    entries = await readDirIfExists(dir);
  } catch {
    return { events: [], unparsed: 1, months: [] };
  }
  if (entries === undefined) return emptyStream();
  for (const entry of entries) {
    if (entry.isFile && MONTH_FILE_RE.test(entry.name)) {
      available.push(entry.name);
    }
  }
  available.sort().reverse();
  const months: string[] = [];
  const events: LogbookEvent[] = [];
  let unparsed = 0;
  for (const name of available) {
    months.push(name);
    let text: string | undefined;
    try {
      text = await readTextIfExists(join(dir, name));
    } catch {
      // discern-best-effort: logbook-recent-month-read-outcome
      unparsed += 1;
      continue;
    }
    if (text === undefined) {
      unparsed += 1;
      continue;
    }
    const parsed = parseLogbookText(text);
    events.push(...parsed.events);
    unparsed += parsed.unparsed;
    if (events.length >= maxEvents) {
      break;
    }
  }
  sortEvents(events);
  months.sort();
  return { events: events.slice(-maxEvents), unparsed, months };
}
