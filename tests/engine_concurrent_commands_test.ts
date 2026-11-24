/**
 * Engine tests for the concurrent-commands runtime override: a gate run that
 * sets it starts at most that many commands at a time on each path the gate
 * launches commands through, and any value that is not a limit stops the run
 * before a command starts.
 *
 * The gate launches commands through two paths: the job runner (`prepare`'s
 * stages) and validation (`done`, `test`, `standards`). Each path is driven
 * here through the real CLI with a limit of one, where a second command
 * starting early is directly observable.
 *
 * A command under test records its start, holds on a file this test writes,
 * and records its end. The test releases a command only after its start is
 * recorded, so the recorded order depends on the limit alone and never on how
 * long anything took.
 *
 * One scaffolded project serves every case: each run needs only its own
 * environment and a cleared record, so nothing here scaffolds twice.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { CONCURRENT_COMMANDS_VARIABLE } from "../src/engine/jobs/command_limit.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { refreshScaffold } from "./engine_done_fixture.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { shellAwaitFile } from "./shell_hold.ts";
import { waitForPendingCondition } from "./waiting.ts";

const ORDER_LOG = "order.log";

/** A command that records its start, holds until released, then records its end. */
function held(label: string): string {
  return [
    `echo start ${label} >> ${ORDER_LOG}`,
    shellAwaitFile(`release-${label}`),
    `echo end ${label} >> ${ORDER_LOG}`,
  ].join("; ");
}

/** The commands whose start is recorded, in the order they started. */
async function recordedStarts(dir: string): Promise<string[]> {
  const log = await readTextIfExists(join(dir, ORDER_LOG)) ?? "";
  return log.split("\n").filter((line) => line.startsWith("start ")).map((
    line,
  ) => line.slice("start ".length));
}

/** Release each held command as its start is recorded, until `count` have run. */
async function releaseAsStarted<T>(
  dir: string,
  pending: Promise<T>,
  count: number,
): Promise<void> {
  const released = new Set<string>();
  while (released.size < count) {
    let next: string | undefined;
    await waitForPendingCondition(
      pending,
      async () => {
        next = (await recordedStarts(dir)).find((label) =>
          !released.has(label)
        );
        return next !== undefined;
      },
      `held command ${released.size + 1} of ${count} to start`,
      { intervalMs: 25 },
    );
    if (next === undefined) throw new Error("no held command started");
    released.add(next);
    await Deno.writeTextFile(join(dir, `release-${next}`), "");
  }
}

/** Keep the fixture's own coordination files out of the candidate. */
async function ignoreCoordinationFiles(dir: string): Promise<void> {
  await Deno.writeTextFile(
    join(dir, ".gitignore"),
    `\n${ORDER_LOG}\nrelease-*\n`,
    { append: true },
  );
}

/** Clear one run's record and releases so the next run starts unobserved. */
async function clearCoordinationFiles(dir: string): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === ORDER_LOG || entry.name.startsWith("release-")) {
      await Deno.remove(join(dir, entry.name));
    }
  }
}

/** The recorded lines of one finished run. */
async function recordedOrder(dir: string): Promise<string[]> {
  return (await Deno.readTextFile(join(dir, ORDER_LOG))).trim().split("\n");
}

/** Each verb that runs gate commands, as its CLI arguments. */
const GATE_COMMAND_VERBS = [
  ["prepare"],
  ["test"],
  ["done", "--standalone"],
  ["standards", "--force"],
] as const;

Deno.test("the concurrent-commands override limits each launch path, and only a positive whole number is a limit", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[gate]",
        "timeout = 120",
        "",
        "[jobs]",
        `test = { run = '${held("test")}', timeout = 600 }`,
        "",
        "[jobs.alpha]",
        'stage = "check"',
        `run = '${held("alpha")}'`,
        "",
        "[jobs.gamma]",
        'stage = "check"',
        `run = '${held("gamma")}'`,
        "timeout = 600",
        "",
        "[standards.beta]",
        'direction = "down"',
        "limit = 10",
        `run = '${held("beta")}; echo DISCERN_METRIC beta 1'`,
        "",
      ].join("\n"),
    );
    await ignoreCoordinationFiles(dir);
    await gitInit(dir);
    await refreshScaffold(dir);

    await t.step(
      "validation runs its commands one at a time",
      async () => {
        const pending = runAgent(dir, ["done", "--standalone", "--json"], {
          env: { [CONCURRENT_COMMANDS_VARIABLE]: "1" },
        });
        await releaseAsStarted(dir, pending, 4);
        const run = await pending;

        assertEquals(decodeCliResult(run, "done").ok, true, run.output);
        const log = await recordedOrder(dir);
        const order = await recordedStarts(dir);
        assertEquals([...order].sort(), ["alpha", "beta", "gamma", "test"]);
        // No command started while another was still running.
        assertEquals(
          log,
          order.flatMap((label) => [`start ${label}`, `end ${label}`]),
        );
      },
    );

    await clearCoordinationFiles(dir);
    await t.step(
      "the job runner runs a stage one job at a time, longest time limit first, and the result says so",
      async () => {
        const pending = runAgent(dir, ["prepare", "--json"], {
          env: { [CONCURRENT_COMMANDS_VARIABLE]: "1" },
        });
        await releaseAsStarted(dir, pending, 2);
        const run = await pending;

        const result = decodeCliResult(run, "prepare");
        assertEquals(result.ok, true, run.output);
        // A stage's jobs ask for their places together, so the first place
        // already follows the waiting order: gamma's longer time limit starts
        // it ahead of alpha, which is declared first.
        assertEquals(await recordedOrder(dir), [
          "start gamma",
          "end gamma",
          "start alpha",
          "end alpha",
        ]);
        const notice = (result.hints ?? []).find((hint) =>
          hint.includes(CONCURRENT_COMMANDS_VARIABLE)
        );
        assert(notice !== undefined, run.output);
        assertStringIncludes(notice, "at most 1 command at a time");
        assertStringIncludes(notice, "so 1 command waited to start");
      },
    );

    await clearCoordinationFiles(dir);
    await t.step(
      "a value that is not a limit stops every gate verb before a command starts",
      async () => {
        for (const args of GATE_COMMAND_VERBS) {
          const run = await runAgent(dir, [...args, "--json"], {
            env: { [CONCURRENT_COMMANDS_VARIABLE]: "two" },
          });
          const result = decodeCliResult(run, args[0]);
          assertEquals(result.ok, false, `${args.join(" ")}: ${run.output}`);
          assertEquals(result.error, "invalid_value", run.output);
          assertStringIncludes(
            result.message ?? "",
            CONCURRENT_COMMANDS_VARIABLE,
          );
          assertStringIncludes(result.message ?? "", '"two"');
          assertEquals(run.code, 1, run.output);
        }
        assertEquals(await readTextIfExists(join(dir, ORDER_LOG)), undefined);
      },
    );

    await t.step("an unset or empty value limits nothing", async () => {
      for (const env of [{}, { [CONCURRENT_COMMANDS_VARIABLE]: "" }]) {
        await clearCoordinationFiles(dir);
        const pending = runAgent(dir, ["prepare", "--json"], { env });
        await releaseAsStarted(dir, pending, 2);
        const run = await pending;
        const result = decodeCliResult(run, "prepare");
        assertEquals(result.ok, true, run.output);
        assertEquals(
          (result.hints ?? []).filter((hint) =>
            hint.includes(CONCURRENT_COMMANDS_VARIABLE)
          ),
          [],
        );
      }
    });
  }, { prefix: "discern-concurrent-commands-" });
});
