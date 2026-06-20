/**
 * Building the gate's jobs for a stage from `.icculus/config.toml`. The TS port of
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

import type { Config } from "../../shared/config_read.ts";
import {
  capStage,
  isKnownCapability,
  type Stage,
} from "../../shared/capabilities.ts";

/** One gate job with the metadata `finish --json` reports. */
export interface StageJob {
  label: string;
  command: string;
  kind: "capability" | "check";
}

/** The jobs that run in `stage`, capabilities first then checks, in declared order. */
export function jobsInStage(config: Config, stage: Stage): StageJob[] {
  const jobs: StageJob[] = [];

  // (a) capabilities — flat keys of [capabilities], placed by their derived stage.
  for (const cap of config.keys("capabilities")) {
    if (!isKnownCapability(cap)) {
      continue; // unknown key: skip (doctor errors on it)
    }
    if (capStage(cap) !== stage) {
      continue;
    }
    // config.array yields one item for a scalar, N for an array (empties/":" dropped).
    config.array(`capabilities.${cap}`).forEach((command, i) => {
      jobs.push({
        label: i === 0 ? cap : `${cap}#${i + 1}`,
        command,
        kind: "capability",
      });
    });
  }

  // (b) checks — explicit stage; run is a scalar.
  for (const chk of config.subsections("checks")) {
    if (config.get(`checks.${chk}.stage`) !== stage) {
      continue;
    }
    const run = config.get(`checks.${chk}.run`, "");
    if (run === "" || run === ":") {
      continue;
    }
    jobs.push({ label: chk, command: run, kind: "check" });
  }

  return jobs;
}

/**
 * Join the commands of every job in a stage with ` && `, in jobsInStage order;
 * `:` when the stage has no real job (so a track is never empty). Used by the
 * tidy/test convenience recipes and the no-op detection in finish's tail.
 */
export function cmdsInStage(config: Config, stage: Stage): string {
  const cmds = jobsInStage(config, stage).map((j) => j.command).filter((c) =>
    c.length > 0
  );
  return cmds.length > 0 ? cmds.join(" && ") : ":";
}
