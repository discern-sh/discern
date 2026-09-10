/**
 * A real native executor the owning test can pause at an observed boundary and
 * kill, leaving the durable claim behind. Shared by the process-death recovery
 * tests and the doctor observation tests so each interruption is arranged once.
 */
import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { engineEnv, repoSourceRunArgs } from "../engine_helpers.ts";
import {
  processAllowance,
  settlePending,
  waitForPendingCondition,
} from "../waiting.ts";
import { observedRecords } from "../../src/engine/landing_queue/repository.ts";
import { observeCompletionRecords } from "../../src/engine/validation/runtime.ts";

const HARNESS = fromFileUrl(
  new URL("./completion_death_harness.ts", import.meta.url),
);

/** A borrowed declaration whose procedures never fail, so the death boundary is the only fault. */
export const DEATH_DECLARATION = `
[gate]
timeout = 14400
[execution.local]
kind = 'borrowed'
reusable = true
capacity = 1
inputs = ['**']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`;

/** Preserve subprocess diagnostics while the parent controls the exact death boundary. */
export async function pausedExecutor(
  path: string,
  marker: string,
  boundary: string,
  environmentId?: string,
): Promise<{
  readonly stop: () => Promise<void>;
}> {
  const allowance = processAllowance();
  const child = new Deno.Command(Deno.execPath(), {
    args: repoSourceRunArgs(HARNESS, [
      boundary,
      marker,
      ...(environmentId === undefined ? [] : [environmentId]),
    ]),
    cwd: path,
    env: await engineEnv(),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = child.output();
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      child.kill("SIGKILL");
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await child.stdin.close();
    await settlePending(output, "killed native executor to exit", {
      allowance,
    });
  };
  try {
    await waitForPendingCondition(
      output,
      () => exists(marker),
      "native executor barrier",
      {
        allowance,
        settledError: (result) =>
          new Error(new TextDecoder().decode(result.stderr)),
      },
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return { stop };
}

/** The fixture owns exactly one environment, including a reservation before its first claim. */
export async function environmentId(path: string): Promise<string> {
  const environments = observedRecords(await observeCompletionRecords(path))
    .filter((record) => record.kind === "environment");
  assertEquals(environments.length, 1);
  const environment = environments[0];
  assert(environment !== undefined);
  return environment.id;
}
