/**
 * The stack-neutral producer progress protocol.
 *
 * A producer command may report its own progress by printing lines of the form
 * `DISCERN_PROGRESS <json>` on stdout or stderr, one JSON object per line. The
 * engine turns each valid line into advisory progress facts for every consumer
 * (terminal, JSON, MCP, the operation journal); the line changes nothing about
 * scheduling, verdicts, or evidence. Every field is optional: an absent fact is
 * unknown, and an unknown total is representable (`"total": null`). A line
 * either validates completely or is ignored — partial acceptance would present
 * a producer's malformed report as a smaller true one.
 */

import { z } from "@zod/zod";
import { decodeUnknown } from "../../shared/runtime_decode.ts";

/** Ignore pathological lines instead of buffering them. */
const PROGRESS_LINE_MAX_BYTES = 16 * 1024;
/** Bound retained failure text; the full transcript stays with the producer's capture. */
const FAILURE_MESSAGE_MAX_CHARS = 4096;

const PROGRESS_TOKEN = "DISCERN_PROGRESS";
const TOKEN_PATTERN = /(?:^|\s)DISCERN_PROGRESS[ \t]+(\{.*\})\s*$/u;

/** One failure the producer has already established, actionable without a rerun. */
export interface ProducerProgressFailure {
  readonly name: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  /** Focused reproduction carrying the producer's recorded seed and instrumentation. */
  readonly reproduce?: string;
}

/** One validated report from a producer's own progress line. */
export interface ProducerProgressReport {
  readonly units?: {
    readonly kind: string;
    readonly completed: number;
    readonly total: number | null;
  };
  /** Only counts the producer actually reported; an absent count is unknown. */
  readonly results?: {
    readonly passed?: number;
    readonly failed?: number;
    readonly skipped?: number;
  };
  readonly active?: readonly string[];
  readonly elapsed_ms?: number;
  /** True when the reported counts cover only part of the completed units. */
  readonly partial?: boolean;
  readonly failure?: ProducerProgressFailure;
}

/** A count is a non-negative integer fact; anything else is not a count. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Accept a non-empty string, truncating past the cap instead of rejecting. */
function shortText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}…`;
}

/** Validate a reported unit count; an absent or null total stays unknown. */
function readUnits(
  value: unknown,
): ProducerProgressReport["units"] | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return "invalid";
  const raw = value as Record<string, unknown>;
  const kind = shortText(raw.kind, 64);
  const completed = count(raw.completed);
  const total = raw.total === null || raw.total === undefined
    ? null
    : count(raw.total);
  if (kind === undefined || completed === undefined || total === undefined) {
    return "invalid";
  }
  return { kind, completed, total };
}

/**
 * Validate reported result counts, keeping only the counts actually given. An
 * empty object is the same unknown fact as an absent one: the producer has
 * established no count yet, and the rest of its line still stands.
 */
function readResults(
  value: unknown,
): ProducerProgressReport["results"] | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return "invalid";
  const raw = value as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const name of ["passed", "failed", "skipped"] as const) {
    if (raw[name] === undefined) continue;
    const reported = count(raw[name]);
    if (reported === undefined) return "invalid";
    counts[name] = reported;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

/** Validate the bounded list of currently running work labels. */
function readActive(
  value: unknown,
): ProducerProgressReport["active"] | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) return "invalid";
  const labels: string[] = [];
  for (const entry of value) {
    const label = shortText(entry, 256);
    if (label === undefined) return "invalid";
    labels.push(label);
  }
  return labels;
}

/** Validate one already-established failure and its optional location facts. */
function readFailure(
  value: unknown,
): ProducerProgressFailure | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return "invalid";
  const raw = value as Record<string, unknown>;
  const name = shortText(raw.name, 512);
  const message = shortText(raw.message, FAILURE_MESSAGE_MAX_CHARS);
  if (name === undefined || message === undefined) return "invalid";
  const file = shortText(raw.file, 1024);
  const line = raw.line === undefined ? undefined : count(raw.line);
  if (raw.line !== undefined && line === undefined) return "invalid";
  const reproduce = shortText(raw.reproduce, 2048);
  return {
    name,
    message,
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    ...(reproduce === undefined ? {} : { reproduce }),
  };
}

/**
 * Parse one output line. Returns the validated report, or undefined for any
 * line that is not a complete, valid progress line — including a line whose
 * JSON parses but whose known fields fail validation, so a malformed report
 * can never present as a smaller true one.
 */
export function parseProducerProgressLine(
  line: string,
): ProducerProgressReport | undefined {
  if (!line.includes(PROGRESS_TOKEN) || line.length > PROGRESS_LINE_MAX_BYTES) {
    return undefined;
  }
  const match = TOKEN_PATTERN.exec(line);
  if (match?.[1] === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const raw = decodeUnknown(
    z.record(z.string(), z.unknown()),
    parsed,
    "producer progress line",
  );
  const units = readUnits(raw.units);
  const results = readResults(raw.results);
  const active = readActive(raw.active);
  const failure = readFailure(raw.failure);
  const elapsed = raw.elapsed_ms === undefined
    ? undefined
    : count(raw.elapsed_ms);
  if (
    units === "invalid" || results === "invalid" || active === "invalid" ||
    failure === "invalid" ||
    (raw.elapsed_ms !== undefined && elapsed === undefined) ||
    (raw.partial !== undefined && typeof raw.partial !== "boolean")
  ) {
    return undefined;
  }
  const report: ProducerProgressReport = {
    ...(units === undefined ? {} : { units }),
    ...(results === undefined ? {} : { results }),
    ...(active === undefined ? {} : { active }),
    ...(elapsed === undefined ? {} : { elapsed_ms: elapsed }),
    ...(raw.partial === true ? { partial: true } : {}),
    ...(failure === undefined ? {} : { failure }),
  };
  return Object.keys(report).length > 0 ? report : undefined;
}

/**
 * Format one protocol line. The emitting and parsing halves share this module
 * so a runner and the engine cannot drift apart; round-tripping a report
 * through {@link parseProducerProgressLine} preserves it.
 */
export function formatProducerProgressLine(
  report: ProducerProgressReport,
): string {
  return `${PROGRESS_TOKEN} ${JSON.stringify(report)}`;
}
