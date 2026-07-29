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
 * new known job auto-enrolls here the moment it joins that set. Commands that
 * invoke discern's own built-in vocabulary count for nothing (see
 * {@link isSelfSuppliedCommand}): the scaffold seeds `format = "discern tidy"`
 * into every install, so counting it would start every project at one enforced
 * job and make the floor verdict unreachable — an unearned green (ADR 0220).
 */

import { KNOWN_JOBS } from "./capabilities.ts";
import { type DiscernConfig, toCommandList } from "./config_schema.ts";
import { KNOWN_VERBS } from "./verbs.ts";

/**
 * How a known job stands relative to the gate:
 *  - `enforced` — a real, project-supplied command is wired; `discern done` runs it.
 *  - `deferred` — the job is PRESENT in `[jobs]` but counts for nothing: either a
 *    no-op (`:` or an empty string — the deliberate "I know about this, but it
 *    isn't running yet" signal, whose reason can travel as an inline `#` comment),
 *    or commands that are all discern self-invocations (the seeded
 *    `format = "discern tidy"`), marked `self_supplied` and rendered as
 *    housekeeping. The vocabulary is closed on the public result contract, so
 *    the self-supplied case rides an additive marker, not a new state.
 *  - `absent` — the job is omitted entirely; the project has no such command.
 */
export const KNOWN_JOB_STATES = ["enforced", "deferred", "absent"] as const;
export type KnownJobState = typeof KNOWN_JOB_STATES[number];

/** One known job's assurance: its name, its {@link KnownJobState}, for a
 * no-op `deferred` job the reason recorded as an inline comment on its config
 * line (when present), and for a `deferred` job whose commands are all discern
 * self-invocations the `self_supplied` marker. */
export interface KnownJobAssurance {
  name: string;
  state: KnownJobState;
  /** The deferral reason (an inline `#` comment), present only for a `deferred`
   * job that carries one. */
  reason?: string;
  /** Present only on a `deferred` job whose real commands are ALL discern
   * self-invocations ({@link isSelfSuppliedCommand}): discern's own upkeep
   * runs, but no check the project wired. Rendered as housekeeping. */
  self_supplied?: true;
}

/**
 * The overall coverage verdict, over the {@link KNOWN_JOBS} set:
 *  - `full` — every known job is enforced (the full recommended gate is active);
 *  - `partial` — at least one is enforced, but not all;
 *  - `minimal` — none is enforced (setup is complete, but the gate guards nothing
 *    of the project's own yet — even when discern's housekeeping still runs).
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
 * True when a command invokes discern's own built-in vocabulary — `discern`
 * followed by one of {@link KNOWN_VERBS} (`discern tidy`, with any arguments),
 * or bare `discern`. Such a command is SELF-SUPPLIED: discern maintaining its
 * own surfaces, present in essentially every install, so it is no evidence the
 * project wired a check of its own and counts for nothing in the assurance.
 * Driven off {@link KNOWN_VERBS} (the SSOT), so a new built-in verb auto-enrolls.
 * A Project Script invoked through the same namespace (`discern <script>`) IS
 * project-authored and never matches: its name is outside the built-in set.
 */
export function isSelfSuppliedCommand(command: string): boolean {
  const [program, verb] = command.trim().split(/\s+/);
  return program === "discern" && (verb === undefined || KNOWN_VERBS.has(verb));
}

/**
 * Classify ONE known job from the resolved config. `absent` when the key is
 * omitted, `enforced` only when at least one project-supplied command survives
 * no-op filtering (the same {@link toCommandList} the gate runs through) and
 * {@link isSelfSuppliedCommand}, `deferred` otherwise — a no-op, or nothing
 * beyond discern's own commands. The single decision the summary and any other
 * consumer (doctor's known-jobs warning) share.
 */
export function classifyKnownJob(
  config: DiscernConfig,
  name: keyof typeof KNOWN_JOBS,
): KnownJobState {
  const value = config.jobs[name];
  if (value === undefined) {
    return "absent";
  }
  return toCommandList(value).some((command) => !isSelfSuppliedCommand(command))
    ? "enforced"
    : "deferred";
}

/** True when a known job is present with real commands that are ALL discern
 * self-invocations — the housekeeping case {@link KnownJobAssurance} marks
 * `self_supplied`. Distinct from the `:`/empty no-op deferral, which carries a
 * reason instead. */
export function isSelfSuppliedOnly(
  config: DiscernConfig,
  name: keyof typeof KNOWN_JOBS,
): boolean {
  const value = config.jobs[name];
  if (value === undefined) {
    return false;
  }
  const commands = toCommandList(value);
  return commands.length > 0 && commands.every(isSelfSuppliedCommand);
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
 * about. When `rawToml` is supplied, a no-op `deferred` job's inline-
 * comment reason is attached (best-effort; omitted when there is none).
 */
export function assessSetupAssurance(
  config: DiscernConfig,
  rawToml?: string,
): SetupAssurance {
  const names = Object.keys(KNOWN_JOBS) as Array<keyof typeof KNOWN_JOBS>;
  const known_jobs: KnownJobAssurance[] = names.map((name) => {
    const state = classifyKnownJob(config, name);
    const selfSupplied = state === "deferred" &&
      isSelfSuppliedOnly(config, name);
    const reason = state === "deferred" && !selfSupplied &&
        rawToml !== undefined
      ? deferralReason(rawToml, name)
      : undefined;
    return {
      name,
      state,
      ...(reason !== undefined ? { reason } : {}),
      ...(selfSupplied ? { self_supplied: true as const } : {}),
    };
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
