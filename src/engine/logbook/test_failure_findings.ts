/** Recorded test diagnostics identify review candidates, never defect counts or Proof. */
import type { VerbEvent } from "./schema.ts";
import {
  type ValidationJobOutcome,
  validationJobOutcome,
} from "./validation.ts";
import { verbInvocations } from "./validation_findings.ts";

/** Five identified failing invocations warrant reviewing early feedback placement. */
export const CANARY_REVIEW_FAILURE_RUNS = 5;

interface TestFailureFile {
  readonly file: string;
  readonly events: readonly VerbEvent[];
  readonly diagnostic_rows: number;
  readonly first_at: string;
  readonly last_at: string;
}

/** The explicit job observation wins over the enclosing invocation outcome.
 * Missing or multiply recorded jobs cannot establish a completed verdict. */
export function recordedJobOutcome(
  event: VerbEvent,
  id: string,
): ValidationJobOutcome {
  const jobs = event.validation?.execution.jobs;
  const observations = jobs === undefined
    ? event.steps?.filter((step) => step.kind === "job" && step.label === id) ??
      []
    : jobs.filter((job) => job.id === id);
  return observations.length === 1
    ? validationJobOutcome(observations[0])
    : "unavailable";
}

/** Count each identified invocation once per file. A collapsed diagnostic's
 * sampling count never creates additional failures or distinct defect classes. */
export function testFailureFiles(
  events: readonly VerbEvent[],
): TestFailureFile[] {
  const observations = verbInvocations(events);
  const files = new Map<string, { events: VerbEvent[]; rows: number }>();
  for (const event of observations.events) {
    if (event.invocation === undefined || observations.conflicts.has(event)) {
      continue;
    }
    const rows = new Map<string, number>();
    for (const diagnostic of event.diagnostics ?? []) {
      if (diagnostic.tool !== "test" || diagnostic.file === undefined) continue;
      rows.set(diagnostic.file, (rows.get(diagnostic.file) ?? 0) + 1);
    }
    for (const [file, count] of rows) {
      const entry = files.get(file) ?? { events: [], rows: 0 };
      entry.events.push(event);
      entry.rows += count;
      files.set(file, entry);
    }
  }
  return [...files].map(([file, entry]) => {
    const times = entry.events.map((event) => event.at).sort();
    return {
      file,
      events: entry.events,
      diagnostic_rows: entry.rows,
      first_at: times[0] ?? "",
      last_at: times.at(-1) ?? "",
    };
  }).sort((left, right) =>
    right.events.length - left.events.length ||
    left.file.localeCompare(right.file)
  );
}
