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
 *    meeting an unknown major skips the line rather than misreading it.
 *  - **Metadata, never payloads.** No code, no prompts, no command output, no
 *    message bodies. Every field here must be safe to read aloud: verb names,
 *    branch names, timings, outcomes, rule ids, file paths at most. A field that
 *    could embarrass someone read aloud does not belong in this schema.
 *  - **Readers tolerate the unknown.** The object schemas are LOOSE (unknown
 *    fields pass through), and {@link parseLogbookLine} classifies rather than
 *    throws — a torn line (a crashed append) or a foreign line (a future schema)
 *    is skipped and counted, never fatal.
 *
 * Three event kinds:
 *  - `verb` — one verb invocation completed (the everyday event);
 *  - `config-change` — the config-epoch fingerprint moved between consecutive
 *    events on a branch, naming which sections moved (names only, never values);
 *  - `prune` — rotation removed the oldest month files (pruning is loud, never
 *    silent).
 */

import { z } from "@zod/zod";

/** The event-format major this build writes; readers skip unknown majors. */
export const LOGBOOK_SCHEMA_VERSION = 1;

/** The surfaces a verb invocation arrives through. */
export const LOGBOOK_SURFACES = ["cli", "mcp"] as const;
/** One invocation surface ({@link LOGBOOK_SURFACES}). */
export type LogbookSurface = (typeof LOGBOOK_SURFACES)[number];

/** One per-step timing lifted from the result envelope's `steps[]` — the label,
 * kind, and outcome the gate already reports, plus the duration the job runner
 * already measured. The recorder re-measures nothing. Loose: a future field
 * passes through unharmed. */
const stepTimingSchema = z.looseObject({
  label: z.string(),
  kind: z.string(),
  outcome: z.string(),
  duration_s: z.number().optional(),
});
/** One recorded step timing. */
export type StepTiming = z.infer<typeof stepTimingSchema>;

/** One diagnostic CLASS — the rule id, tool, and file path at most, per the
 * metadata-only bar. Deliberately narrower than the envelope's `Diagnostic`:
 * the message body, captured output, and reproduce command never land here. */
const diagnosticClassSchema = z.looseObject({
  tool: z.string(),
  rule: z.string().optional(),
  file: z.string().optional(),
});
/** One recorded diagnostic class. */
export type DiagnosticClass = z.infer<typeof diagnosticClassSchema>;

/** The fields every event kind carries. */
const eventBase = {
  /** The event-format major ({@link LOGBOOK_SCHEMA_VERSION}). */
  schema: z.number().int(),
  /** ISO 8601 UTC timestamp of the event. */
  at: z.string(),
} as const;

/**
 * One completed verb invocation. Git context is nullable rather than optional so
 * a line reads honestly (`"branch": null` outside a commit, not a silent
 * absence). Attribution is by BRANCH NAME, never the worktree path — the branch
 * survives `accept` removing the worktree.
 */
export const verbEventSchema = z.looseObject({
  ...eventBase,
  kind: z.literal("verb"),
  /** The invoked verb in display form ("done", "worktree drop", "config set"). */
  verb: z.string(),
  surface: z.enum(LOGBOOK_SURFACES),
  /** Branch name at invocation ("HEAD" when detached; null when unresolvable). */
  branch: z.string().nullable(),
  /** Short commit hash at invocation, or null when unresolvable. */
  head: z.string().nullable(),
  /** Whether the working tree was clean at invocation (null when unknown). */
  clean: z.boolean().nullable(),
  /** How the invocation ended: exit 0 / `ok: true` → "ok", anything else → "failed". */
  outcome: z.enum(["ok", "failed"]),
  /** The envelope's machine-stable error slug, when the verb refused/aborted. */
  error: z.string().optional(),
  /** True when the invocation was a preview (`--dry-run`) — nothing was applied. */
  dry_run: z.boolean().optional(),
  /** Wall-clock duration of the whole invocation, in milliseconds. */
  duration_ms: z.number(),
  /** Per-step timings lifted from the result envelope, when the verb emitted one. */
  steps: z.array(stepTimingSchema).optional(),
  /** Diagnostic classes lifted from the result envelope, when the verb emitted one. */
  diagnostics: z.array(diagnosticClassSchema).optional(),
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

/** Rotation removed the oldest month files — the loud pruning note. */
export const pruneEventSchema = z.looseObject({
  ...eventBase,
  kind: z.literal("prune"),
  /** The month-file names rotation removed, oldest first. */
  removed: z.array(z.string()),
});
/** One prune event. */
export type PruneEvent = z.infer<typeof pruneEventSchema>;

/** Every event kind the logbook records, discriminated on `kind`. */
export const logbookEventSchema = z.discriminatedUnion("kind", [
  verbEventSchema,
  configChangeEventSchema,
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
