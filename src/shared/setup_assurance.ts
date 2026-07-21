/**
 * Setup **quality-coverage assurance** — the honest, per-known-job account
 * `discern setup done` reports at completion (A12).
 *
 * A setup can pass green with only some of the recommended gate active: a project
 * might wire format/lint/typecheck but legitimately have no test suite wired yet, or
 * no build step at all. That is correct — but "the gate is proven" must not read to a
 * novice as "every protection is running." So at `done` we classify each known
 * job into one of three honest states and roll them into an overall verdict,
 * which the human output and the `--json` envelope both render. This keeps
 * "setup is complete" cleanly distinct from "the full recommended gate is active."
 *
 * The classification is DERIVED from the known names under `[jobs]` — unfakeable
 * and free of any self-report — and iterates {@link KNOWN_JOBS} (the SSOT), so a
 * new known job auto-enrolls here the moment it joins that set.
 */

import { KNOWN_JOBS } from "./capabilities.ts";
import { type DiscernConfig, toCommandList } from "./config_schema.ts";

/**
 * How a known job stands relative to the gate:
 *  - `enforced` — a real command is wired; `discern done` runs it.
 *  - `deferred` — the job is PRESENT in `[jobs]` but set to a no-op
 *    (`:` or an empty string), the deliberate "I know about this, but it isn't
 *    running yet" signal. Distinct from a silent omission, and the place a reason
 *    can travel (an inline `#` comment on the line).
 *  - `absent` — the job is omitted entirely; the project has no such command.
 */
export const KNOWN_JOB_STATES = ["enforced", "deferred", "absent"] as const;
export type KnownJobState = typeof KNOWN_JOB_STATES[number];

/** One known job's assurance: its name, its {@link KnownJobState}, and — for a
 * `deferred` one — the reason recorded as an inline comment on its config line, when
 * present. */
export interface KnownJobAssurance {
  name: string;
  state: KnownJobState;
  /** The deferral reason (an inline `#` comment), present only for a `deferred`
   * job that carries one. */
  reason?: string;
}

/**
 * The overall coverage verdict, over the {@link KNOWN_JOBS} set:
 *  - `full` — every known job is enforced (the full recommended gate is active);
 *  - `partial` — at least one is enforced, but not all;
 *  - `minimal` — none is enforced (setup is complete, but the gate guards nothing yet).
 */
export const ASSURANCE_VERDICTS = ["full", "partial", "minimal"] as const;
export type AssuranceVerdict = typeof ASSURANCE_VERDICTS[number];

/** The complete assurance summary `setup done` reports. */
export interface SetupAssurance {
  /** Each known job, in {@link KNOWN_JOBS} order, with its state. */
  known_jobs: KnownJobAssurance[];
  /** How many known jobs are `enforced`. */
  enforced: number;
  /** The total number of known jobs considered. */
  total: number;
  /** The rolled-up {@link AssuranceVerdict}. */
  verdict: AssuranceVerdict;
}

/**
 * Classify ONE known job from the resolved config. `enforced` when a real command
 * survives no-op filtering (the same {@link toCommandList} the gate runs through),
 * `absent` when the key is omitted, `deferred` when it is present but a `:`/empty
 * no-op. The single decision the summary and any other consumer share.
 */
export function classifyKnownJob(
  config: DiscernConfig,
  name: keyof typeof KNOWN_JOBS,
): KnownJobState {
  const value = config.jobs[name];
  if (value === undefined) {
    return "absent";
  }
  return toCommandList(value).length > 0 ? "enforced" : "deferred";
}

/**
 * Extract the inline `#` comment on a known job's line in raw `discern.toml`, or
 * undefined when there is none. Scans only within `[jobs]` so an identically-named
 * key elsewhere can't match. Surfaces a `deferred` job's
 * recorded reason ("with reason if known"); a no-op value (`:`/`""`) never itself
 * contains a `#`, so the match is unambiguous.
 */
export function deferralReason(
  rawToml: string,
  name: string,
): string | undefined {
  let inJobs = false;
  for (const line of rawToml.split("\n")) {
    const header = line.match(/^\s*\[([^\]]+)\]/);
    if (header !== null) {
      inJobs = header[1]?.trim() === "jobs";
      continue;
    }
    if (!inJobs) {
      continue;
    }
    // `name = "<value>"  # reason` — the value is a quoted string or a bare token,
    // optionally followed by a comment. Capture the comment body.
    const m = line.match(
      new RegExp(
        `^\\s*${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|\\S+)\\s*#\\s*(.+?)\\s*$`,
      ),
    );
    if (m !== null) {
      return m[1];
    }
  }
  return undefined;
}

/**
 * Assess the full {@link SetupAssurance} for a project — the per-known-job states
 * and the overall verdict — from its resolved config. Iterates
 * {@link KNOWN_JOBS} so the summary can never omit a known job the gate knows
 * about. When `rawToml` is supplied, a `deferred` job's inline-
 * comment reason is attached (best-effort; omitted when there is none).
 */
export function assessSetupAssurance(
  config: DiscernConfig,
  rawToml?: string,
): SetupAssurance {
  const names = Object.keys(KNOWN_JOBS) as Array<keyof typeof KNOWN_JOBS>;
  const known_jobs: KnownJobAssurance[] = names.map((name) => {
    const state = classifyKnownJob(config, name);
    const reason = state === "deferred" && rawToml !== undefined
      ? deferralReason(rawToml, name)
      : undefined;
    return reason !== undefined ? { name, state, reason } : { name, state };
  });
  const enforced = known_jobs.filter((job) => job.state === "enforced").length;
  const total = known_jobs.length;
  const verdict: AssuranceVerdict = enforced === total
    ? "full"
    : enforced === 0
    ? "minimal"
    : "partial";
  return { known_jobs, enforced, total, verdict };
}
