/**
 * Building the gate's jobs for a stage from `discern.toml`.
 *
 *   known jobs    every known `[jobs]` name whose derived stage matches. A list
 *                 expands to one job per element (first labelled with the bare
 *                 name, later ones `name#2`, `name#3`). kind = "known".
 *   custom jobs   every `[jobs.<name>]` whose declared `stage` matches. Its
 *                 `run` list joins into one command. kind = "custom".
 *   generated     every `[generated.<name>]` command in the build stage,
 *                 labelled `generated:<name>`. kind = "generated".
 *
 * Empty and `:` no-op commands are skipped.
 */

import {
  commandTimeout,
  type DiscernConfig,
  toCommand,
  toCommandList,
} from "../../shared/config_schema.ts";
import { isKnownJob, jobStage, type Stage } from "../../shared/capabilities.ts";
import type { JobTimeout } from "../jobs/types.ts";
import { shellCommand } from "../../shared/subprocess.ts";
import { expandSourcePathReferences } from "../../shared/source_path_references.ts";
import { resolveGeneratedGroups } from "../../shared/generated_artifacts.ts";

/** The custom table shape after config validation. The key decides which arm of
 * the jobs union applies, but TypeScript cannot correlate an object entry's key
 * with its value, so preserve that invariant with a small runtime guard. */
function isCustomJobSpec(
  value: unknown,
): value is { stage: Stage; run: string | string[]; timeout?: number } {
  return typeof value === "object" && value !== null &&
    Object.hasOwn(value, "stage") && Object.hasOwn(value, "run");
}

/** One gate job with the metadata `done --json` reports. */
export interface StageJob {
  label: string;
  command: string;
  kind: "known" | "custom" | "generated";
  /** Per-job `timeout` override from the config value with its config key,
   * replacing the global `[gate].timeout` for this job only (`seconds: 0`
   * disables the bound for it). */
  timeout?: JobTimeout;
}

/** The declared jobs that run in `stage`, in config order. */
export function jobsInStage(config: DiscernConfig, stage: Stage): StageJob[] {
  const jobs: StageJob[] = [];

  for (const [name, value] of Object.entries(config.jobs)) {
    if (isKnownJob(name)) {
      if (value === undefined || jobStage(name) !== stage) {
        continue;
      }
      const timeoutS = commandTimeout(value);
      const timeout: JobTimeout | undefined = timeoutS === undefined
        ? undefined
        : { seconds: timeoutS, key: `[jobs.${name}].timeout` };
      toCommandList(value).forEach((command, i) => {
        jobs.push({
          label: i === 0 ? name : `${name}#${i + 1}`,
          command: expandSourcePathReferences(command, config),
          kind: "known",
          ...(timeout !== undefined ? { timeout } : {}),
        });
      });
      continue;
    }
    const spec = value;
    if (!isCustomJobSpec(spec)) {
      throw new Error(`custom job "${name}" has no stage-bearing table`);
    }
    if (spec.stage !== stage) {
      continue;
    }
    const run = expandSourcePathReferences(
      toCommand(spec.run),
      config,
    );
    if (run === "") {
      continue;
    }
    jobs.push({
      label: name,
      command: run,
      kind: "custom",
      ...(spec.timeout !== undefined
        ? {
          timeout: {
            seconds: spec.timeout,
            key: `[jobs.${name}].timeout`,
          },
        }
        : {}),
    });
  }

  if (stage === "build") {
    for (const group of resolveGeneratedGroups(config)) {
      jobs.push({
        label: `generated:${group.name}`,
        command: group.run,
        kind: "generated",
        ...(group.timeout !== undefined
          ? {
            timeout: {
              seconds: group.timeout,
              key: `[generated.${group.name}].timeout`,
            },
          }
          : {}),
      });
    }
  }

  return jobs;
}

/**
 * Join the commands of every job in a stage with ` && `, in jobsInStage order;
 * `:` when the stage has no real job (so a track is never empty). Used by the
 * prepare/test convenience commands and the no-op detection in done's tail.
 */
export function cmdsInStage(config: DiscernConfig, stage: Stage): string {
  const cmds = jobsInStage(config, stage).map((j) => j.command).filter((c) =>
    c.length > 0
  );
  return shellCommand(cmds.join(" && "));
}
