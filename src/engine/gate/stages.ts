/**
 * Building the gate's jobs for a stage from `discern.toml`. The TS port of
 * the shell `jobs_in_stage` / `cmds_in_stage` (jobs.sh tail).
 *
 *   capabilities  every `[capabilities]` flat key that is known and whose derived
 *                 stage matches. An array-valued capability expands to one job
 *                 per element (first labelled with the bare name, later ones
 *                 `name#2`, `name#3`). kind = "capability".
 *   checks        every `[checks.<name>]` whose `stage` equals the stage; `run`
 *                 is a scalar. kind = "check".
 *
 * Empty and `:` no-op commands are skipped.
 */

import {
  type DiscernConfig,
  toCommand,
  toCommandList,
} from "../../shared/config_schema.ts";
import { capStage, type Stage } from "../../shared/capabilities.ts";

/** One gate job with the metadata `finish --json` reports. */
export interface StageJob {
  label: string;
  command: string;
  kind: "capability" | "check";
}

/** The jobs that run in `stage`, capabilities first then checks, in declared order. */
export function jobsInStage(config: DiscernConfig, stage: Stage): StageJob[] {
  const jobs: StageJob[] = [];

  // (a) capabilities — each declared capability, placed by its derived stage. An
  // array-valued capability expands to one job per element.
  for (const [cap, value] of Object.entries(config.capabilities)) {
    if (value === undefined || capStage(cap) !== stage) {
      continue;
    }
    // A scalar yields one job; a list yields one per element (empties/":" dropped).
    toCommandList(value).forEach((command, i) => {
      jobs.push({
        label: i === 0 ? cap : `${cap}#${i + 1}`,
        command,
        kind: "capability",
      });
    });
  }

  // (b) checks — explicit stage; a list run joins into one job command.
  for (const [chk, spec] of Object.entries(config.checks)) {
    if (spec.stage !== stage) {
      continue;
    }
    const run = toCommand(spec.run);
    if (run === "") {
      continue;
    }
    jobs.push({ label: chk, command: run, kind: "check" });
  }

  return jobs;
}

/**
 * Join the commands of every job in a stage with ` && `, in jobsInStage order;
 * `:` when the stage has no real job (so a track is never empty). Used by the
 * prepare/test convenience recipes and the no-op detection in finish's tail.
 */
export function cmdsInStage(config: DiscernConfig, stage: Stage): string {
  const cmds = jobsInStage(config, stage).map((j) => j.command).filter((c) =>
    c.length > 0
  );
  return cmds.length > 0 ? cmds.join(" && ") : ":";
}
