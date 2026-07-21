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
import { logbookDir, MONTH_FILE_RE } from "./store.ts";
import { type LogbookEvent, parseLogbookLine } from "./schema.ts";

/** One whole logbook, read tolerantly. */
export interface LogbookStream {
  /** Every well-formed event, oldest first (ordered by `at`; ties keep file order). */
  events: LogbookEvent[];
  /** Torn or foreign lines skipped while reading — honesty for the report. */
  unparsed: number;
  /** The month files read, oldest first (`2026-06.jsonl`, …). */
  months: string[];
}

/** An empty stream — the absent-logbook state. */
function emptyStream(): LogbookStream {
  return { events: [], unparsed: 0, months: [] };
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
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && MONTH_FILE_RE.test(entry.name)) {
        months.push(entry.name);
      }
    }
  } catch {
    return emptyStream();
  }
  months.sort();
  const events: LogbookEvent[] = [];
  let unparsed = 0;
  for (const name of months) {
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, name));
    } catch {
      unparsed += 1; // an unreadable month counts as one skipped unit
      continue;
    }
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
  }
  // Stable sort: same-`at` events keep their file order.
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { events, unparsed, months };
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
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && MONTH_FILE_RE.test(entry.name)) {
        available.push(entry.name);
      }
    }
  } catch {
    return emptyStream();
  }
  available.sort().reverse();
  const months: string[] = [];
  const events: LogbookEvent[] = [];
  let unparsed = 0;
  for (const name of available) {
    months.push(name);
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, name));
    } catch {
      unparsed += 1;
      continue;
    }
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
    if (events.length >= maxEvents) {
      break;
    }
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  months.sort();
  return { events: events.slice(-maxEvents), unparsed, months };
}
