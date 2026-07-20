/**
 * The logbook's **event vocabulary** — the versioned, compatibility-bearing shape
 * of every line discern's local logbook records, and the tolerant line parser
 * readers use.
 *
 * The logbook is discern's memory of its own use: one JSON Lines event per verb
 * invocation, appended under the git common dir (see `store.ts`) and never
 * leaving the machine. This module owns the schema three rules bind for the life
 * of the feature:
 *
 *  - **Versioned from the first event.** Every event carries `schema`; a reader
 *    meeting an unknown major skips the line rather than misreading it. Every
 *    event also carries `writer` — the discern version that wrote it — because
 *    a released reader must be able to segment history by the release that
 *    produced it (guidance and gate behaviour ship with the binary, so every
 *    release is an experiment whose before/after the logbook should preserve).
 *  - **Metadata, never payloads.** No code, no prompts, no command output, no
 *    message bodies. Every field here must be safe to read aloud: verb names,
 *    branch names, timings, counts, outcomes, rule ids, doc slugs, file paths
 *    at most. A field that could embarrass someone read aloud does not belong
 *    in this schema.
 *  - **Readers tolerate the unknown.** The object schemas are LOOSE (unknown
 *    fields pass through), and {@link parseLogbookLine} classifies rather than
 *    throws — a torn line (a crashed append) or a foreign line (a future schema)
 *    is skipped and counted, never fatal.
 *
 * The recorder stores **evidence, never inference**: raw driver signals rather
 * than a derived "was this an agent?" score, raw counts rather than judgments —
 * so a smarter future reader can re-interpret the whole accumulated history,
 * while a baked-in score would fossilize the heuristic of the day it shipped.
 *
 * Four event kinds:
 *  - `verb` — one verb invocation completed (the everyday event);
 *  - `config-change` — the config-epoch fingerprint moved between consecutive
 *    events on a branch, naming which sections moved (names only, never values);
 *  - `pin` — a `standards --pin` tightened one limit: the ratchet's trajectory,
 *    readable straight back out of the logbook;
 *  - `prune` — rotation removed the oldest month files, leaving a compact
 *    digest of what each held (pruning is loud, never silent — and coarse
 *    history survives it).
 */

import { z } from "@zod/zod";
import { AGENT_SIGNAL_SOURCES } from "../../shared/agent_catalogue.ts";

/** The event-format major this build writes; readers skip unknown majors. */
export const LOGBOOK_SCHEMA_VERSION = 1;

/** The surfaces a verb invocation arrives through. */
export const LOGBOOK_SURFACES = ["cli", "mcp"] as const;
/** One invocation surface ({@link LOGBOOK_SURFACES}). */
export type LogbookSurface = (typeof LOGBOOK_SURFACES)[number];

/**
 * How an invocation ended:
 *  - `ok` — exit 0 / `ok: true`;
 *  - `refused` — the verb declined to act and said why (the envelope carried a
 *    machine-stable `error` slug: a dirty tree, an unknown standard, a missing
 *    precondition). The work never ran;
 *  - `failed` — the work ran and came back red (a red gate, a failed script).
 *
 * The distinction is diagnostic gold for readers: an agent looping on `refused`
 * is fighting the workflow (a guidance gap); an agent looping on `failed` is
 * iterating toward green (the tool working as designed).
 */
export const LOGBOOK_OUTCOMES = ["ok", "failed", "refused"] as const;
/** One invocation outcome ({@link LOGBOOK_OUTCOMES}). */
export type LogbookOutcome = (typeof LOGBOOK_OUTCOMES)[number];

/** One per-step timing lifted from the result envelope's `steps[]` — the label,
 * kind, and outcome the gate already reports, plus the duration the job runner
 * already measured. The recorder re-measures nothing. `disposition` preserves
 * the plan's intent, so a reader can tell a deliberate skip (`"skip"` — scope
 * classified out) from fail-fast collateral (`"run"` that ended `"skipped"`).
 * `error_like_lines` is the runner's count of diagnostic-looking output lines —
 * a free "how red was it" magnitude. Loose: a future field passes through. */
const stepTimingSchema = z.looseObject({
  label: z.string(),
  kind: z.string(),
  outcome: z.string(),
  disposition: z.string().optional(),
  /** The plan's display grouping — for gate jobs, the stage ("Fix", "Build",
   * "Check & test") — so a reader can tell a fixer from a check without a
   * hand-kept label table. Absent on events written before it was lifted. */
  group: z.string().optional(),
  duration_s: z.number().optional(),
  error_like_lines: z.number().optional(),
});
/** One recorded step timing. */
export type StepTiming = z.infer<typeof stepTimingSchema>;

/** One diagnostic CLASS — the rule id, tool, and file path at most, per the
 * metadata-only bar. Deliberately narrower than the envelope's `Diagnostic`:
 * the message body, captured output, and reproduce command never land here.
 * Identical classes within one event collapse into a `count`, so "14 lint
 * errors under one rule" and "one" stay distinguishable without growing lines. */
const diagnosticClassSchema = z.looseObject({
  tool: z.string(),
  rule: z.string().optional(),
  file: z.string().optional(),
  count: z.number().optional(),
});
/** One recorded diagnostic class. */
export type DiagnosticClass = z.infer<typeof diagnosticClassSchema>;

/**
 * The raw **driver signals** — evidence for the "who drove this?" question
 * `surface` alone cannot answer (agents follow the guidance onto the CLI, so
 * `cli` never means human). Facts only, each independently honest; scoring
 * them into an inference is reader work, revisable over the whole history:
 *  - `session` — an opaque grouping hint: the MCP server instance for `mcp`
 *    events, the parent process id for `cli` events. Groups one conversation's
 *    invocations even when every task shares a branch; ids recycle across
 *    reboots, so readers group within a day, never globally;
 *  - `json` — machine output was requested (agents pass `--json` per the
 *    guidance; humans rarely do);
 *  - `tty` — stdout was an interactive terminal;
 *  - `ci` — the conventional CI environment marker was set, so automation
 *    noise is filterable from interactive history;
 *  - `agent_signals` — every advisory coding-agent match, separated by source
 *    and carrying marker names only. It is deliberately a set of evidence, not
 *    a winner or confidence score;
 *  - `mcp_client` — the bounded raw `clientInfo` declaration when the call came
 *    over MCP. It identifies the client implementation, not necessarily the
 *    model or agent behind it.
 */
const agentSignalSchema = z.looseObject({
  agent: z.string(),
  source: z.enum(AGENT_SIGNAL_SOURCES),
  markers: z.array(z.string()).min(1),
});

const mcpClientSchema = z.looseObject({
  name: z.string(),
  title: z.string().optional(),
  version: z.string(),
});

const driverSchema = z.looseObject({
  session: z.string().optional(),
  json: z.boolean().optional(),
  tty: z.boolean().optional(),
  ci: z.boolean().optional(),
  agent_signals: z.array(agentSignalSchema).optional(),
  mcp_client: mcpClientSchema.optional(),
});
/** One recorded driver-signal bundle. */
export type DriverFacts = z.infer<typeof driverSchema>;

/** The scale of the change the invocation acted on — counts of the working
 * tree against its merge-base with the trunk (untracked files not included).
 * The denominator every longitudinal reading needs: loops-to-green per unit of
 * change, cycle time versus size, gate duration versus what it checked. */
const changeScaleSchema = z.looseObject({
  files: z.number(),
  insertions: z.number(),
  deletions: z.number(),
  commits: z.number(),
});
/** One recorded change-scale reading. */
export type ChangeScale = z.infer<typeof changeScaleSchema>;

/** One standard's reading, lifted from the envelope where the gate already
 * measured it: the name, the limit it was held to, the measured value when one
 * exists, the verdict, and how the measurement happened (`measured` fresh,
 * `replayed` from the recorded baseline, `deferred` to on-demand, `skipped`).
 * The metric trajectory over time — the single richest longitudinal series the
 * logbook holds — reads straight out of these. */
const standardReadingSchema = z.looseObject({
  name: z.string(),
  direction: z.string().optional(),
  limit: z.number().optional(),
  value: z.number().optional(),
  verdict: z.string().optional(),
  measurement: z.string().optional(),
  replayed_from: z.string().optional(),
});
/** One recorded standard reading. */
export type StandardReading = z.infer<typeof standardReadingSchema>;

/** What an `update` brought in, in counts: how far behind the branch was, how
 * many files the integration landed, and how many of the branch's own files
 * overlap them — mergeability friction, trendable over time. */
const updateShapeSchema = z.looseObject({
  behind: z.number().optional(),
  files: z.number().optional(),
  overlap: z.number().optional(),
});
/** One recorded update shape. */
export type UpdateShape = z.infer<typeof updateShapeSchema>;

/** The fields every event kind carries. */
const eventBase = {
  /** The event-format major ({@link LOGBOOK_SCHEMA_VERSION}). */
  schema: z.number().int(),
  /** ISO 8601 UTC timestamp of the event. */
  at: z.string(),
  /** The discern version that wrote the event. */
  writer: z.string().optional(),
} as const;

/**
 * One completed verb invocation. Git context is nullable rather than optional so
 * a line reads honestly (`"branch": null` outside a commit, not a silent
 * absence). Attribution is by BRANCH NAME, never the worktree path — the branch
 * survives `accept` removing the worktree (and because `accept` fast-forwards
 * the trunk, an accept event's `head` IS the commit that landed).
 */
export const verbEventSchema = z.looseObject({
  ...eventBase,
  kind: z.literal("verb"),
  /** The invoked verb in display form ("done", "worktree drop", "config set"). */
  verb: z.string(),
  surface: z.enum(LOGBOOK_SURFACES),
  /** Raw driver signals for the who-drove-this question ({@link DriverFacts}). */
  driver: driverSchema.optional(),
  /** Branch name at invocation ("HEAD" when detached; null when unresolvable). */
  branch: z.string().nullable(),
  /** Short commit hash at invocation, or null when unresolvable. */
  head: z.string().nullable(),
  /** Whether the working tree was clean at invocation (null when unknown). */
  clean: z.boolean().nullable(),
  /** Fingerprint of the uncommitted diff, present only on a dirty tree: `head`
   * plus this identifies "the same exact tree" across runs, which is what a
   * flake reader needs (`clean` runs are identified by `head` alone). */
  tree: z.string().optional(),
  /** How the invocation ended ({@link LOGBOOK_OUTCOMES}). */
  outcome: z.enum(LOGBOOK_OUTCOMES),
  /** The envelope's machine-stable error slug, when the verb refused/aborted. */
  error: z.string().optional(),
  /** The gate stage that failed, from the envelope's closed vocabulary —
   * "merge" and "test" are different diagnoses wearing the same red. */
  failed_stage: z.string().optional(),
  /** True when the invocation was a preview (`--dry-run`) — nothing was applied. */
  dry_run: z.boolean().optional(),
  /** Wall-clock duration of the whole invocation, in milliseconds. */
  duration_ms: z.number(),
  /** The verb's object, when it has one: a `help` topic, a `map` page slug,
   * the branch a `start` created. What agents look up, mineable at last. */
  target: z.string().optional(),
  /** The ref a `start` forked from (composition below the trunk, recorded). */
  from: z.string().optional(),
  /** Flag NAMES the invocation passed (registry-shaped, never values; `--json`
   * and `--dry-run` ride their own fields). `--force` usage is a signal. */
  flags: z.array(z.string()).optional(),
  /** Scale of the change acted on ({@link ChangeScale}). */
  change: changeScaleSchema.optional(),
  /** The scopes the change touched, per the gate's classification — why steps
   * were skipped, and the docs-only/code split for free. */
  scopes: z.array(z.string()).optional(),
  /** Per-step timings lifted from the result envelope, when the verb emitted one. */
  steps: z.array(stepTimingSchema).optional(),
  /** Diagnostic classes lifted from the result envelope, when the verb emitted one. */
  diagnostics: z.array(diagnosticClassSchema).optional(),
  /** Per-standard readings lifted from the envelope ({@link StandardReading}). */
  standards: z.array(standardReadingSchema).optional(),
  /** What an `update` brought in ({@link UpdateShape}). */
  update: updateShapeSchema.optional(),
  /** The config-epoch fingerprint (see `epoch.ts`), or null when config was unreadable. */
  epoch: z.string().nullable(),
});
/** One verb event. */
export type VerbEvent = z.infer<typeof verbEventSchema>;

/**
 * The config-epoch fingerprint moved between consecutive events on this branch —
 * a REAL reconfiguration, not the standards ratchet (a pin is masked out of the
 * fingerprint). Carries section NAMES only, never values.
 */
export const configChangeEventSchema = z.looseObject({
  ...eventBase,
  kind: z.literal("config-change"),
  /** The branch whose config moved (epoch state is tracked per branch). */
  branch: z.string().nullable(),
  /** The top-level config sections whose masked hashes moved. */
  sections: z.array(z.string()),
  /** The new combined fingerprint. */
  epoch: z.string(),
});
/** One config-change event. */
export type ConfigChangeEvent = z.infer<typeof configChangeEventSchema>;

/**
 * A `standards --pin` tightened one limit — the ratchet, visible. One event per
 * pinned standard, so the limit trajectory over time reads straight back out of
 * the event stream (the epoch machinery deliberately masks limits, so pins are
 * invisible there — this event is where they live instead). Values here are
 * bare metric numbers, well inside the read-aloud bar.
 */
export const pinEventSchema = z.looseObject({
  ...eventBase,
  kind: z.literal("pin"),
  /** The branch the pin was committed on. */
  branch: z.string().nullable(),
  /** The pinned standard's name. */
  standard: z.string(),
  /** The limit before the pin. */
  from: z.number(),
  /** The limit after the pin. */
  to: z.number(),
  /** The measured value that justified the tightening. */
  measured: z.number(),
});
/** One pin event. */
export type PinEvent = z.infer<typeof pinEventSchema>;

/** The compact digest a prune leaves of one removed month file: totals by
 * outcome and by verb, so coarse trends survive rotation forever even though
 * the raw lines do not. `unparsed` counts torn/foreign lines the digest could
 * not read. */
const pruneDigestSchema = z.looseObject({
  /** The removed month-file name ("2026-07.jsonl"). */
  file: z.string(),
  /** Total lines the file held. */
  events: z.number(),
  ok: z.number().optional(),
  failed: z.number().optional(),
  refused: z.number().optional(),
  /** Verb-event counts by verb name. */
  by_verb: z.record(z.string(), z.number()).optional(),
  unparsed: z.number().optional(),
});
/** One removed month's digest. */
export type PruneDigest = z.infer<typeof pruneDigestSchema>;

/** Rotation removed the oldest month files — the loud pruning note, carrying
 * a digest of each removed month ({@link PruneDigest}), oldest first. */
export const pruneEventSchema = z.looseObject({
  ...eventBase,
  kind: z.literal("prune"),
  /** The removed months, oldest first, each with its digest. */
  removed: z.array(pruneDigestSchema),
});
/** One prune event. */
export type PruneEvent = z.infer<typeof pruneEventSchema>;

/** Every event kind the logbook records, discriminated on `kind`. */
export const logbookEventSchema = z.discriminatedUnion("kind", [
  verbEventSchema,
  configChangeEventSchema,
  pinEventSchema,
  pruneEventSchema,
]);
/** One logbook event of any kind. */
export type LogbookEvent = z.infer<typeof logbookEventSchema>;

/**
 * One classified logbook line. Concurrent appends share one file across
 * worktrees, and the atomic-single-write bet can still lose to a hard crash —
 * so a reader NEVER trusts a line before classifying it:
 *  - `event` — a well-formed event of a known schema major;
 *  - `foreign` — valid JSON, but an unknown schema major or an unrecognized
 *    shape (a future writer, or a hand-edit) — skipped, not misread;
 *  - `torn` — not JSON at all (a torn or interrupted append) — skipped.
 */
export type ParsedLogbookLine =
  | { kind: "event"; event: LogbookEvent }
  | { kind: "foreign" }
  | { kind: "torn" };

/** Classify one raw logbook line ({@link ParsedLogbookLine}). Never throws. */
export function parseLogbookLine(line: string): ParsedLogbookLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "torn" };
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    (parsed as { schema?: unknown }).schema !== LOGBOOK_SCHEMA_VERSION
  ) {
    return { kind: "foreign" };
  }
  const result = logbookEventSchema.safeParse(parsed);
  return result.success
    ? { kind: "event", event: result.data }
    : { kind: "foreign" };
}
