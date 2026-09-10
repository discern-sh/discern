/**
 * The native git command budget of the proven-worktree journey.
 *
 * Every git process the engine spawns funnels through `runGit` and honours
 * `GIT_BIN`, so a recording shim observes exactly the engine's own spawns while
 * the real journey runs: `start`, `status`, `done`, `accept`. Each verb holds a
 * ceiling set at its measured cost plus a small margin, so a change that
 * spawns more git processes fails here before it lands; a change that spawns
 * fewer earns a lower ceiling. Verbs the journey does not exercise are named
 * exceptions, so a new verb must enrol one way or the other.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { KNOWN_ENGINE_VERBS } from "../src/shared/verbs.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { git, gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./temp_dir.ts";

/** Ceiling on git processes per journey verb: measured cost plus a small margin. */
const GIT_COMMAND_BUDGET: Readonly<Record<string, number>> = {
  start: 58,
  status: 60,
  done: 365,
  accept: 400,
};

/** Ceiling on the whole journey. */
const JOURNEY_BUDGET = 860;

/** Engine verbs the journey does not exercise, each with the reason. */
const UNBUDGETED_ENGINE_VERBS: ReadonlyMap<string, string> = new Map([
  ["prepare", "its fixers and refresh rewrite the fixture between steps"],
  ["test", "runs the project's own test command, not a git workload"],
  ["queue", "schedules test processes; its git use is fleet observation"],
  ["await", "waits on other efforts; a bounded journey has none"],
  ["improvement", "reads the logbook rather than the repository"],
  ["standards", "measures the project's standards, not a git workload"],
  ["checkpoints", "reads checkpoint state written by done"],
  ["refresh", "regenerates agent files; exercised inside start and done"],
  ["tidy", "formats the config; no repository walk"],
  ["impact", "a read-only report over the current diff"],
  ["coupling", "a read-only report over the logbook"],
  ["patterns", "a read-only report over the logbook"],
  ["desk", "an interactive surface composed of budgeted verbs"],
  ["enter", "a shell launcher for the desk"],
  ["update", "needs a moved trunk; measured by its own summary tests"],
  ["worktree", "administrative subcommands outside the proven journey"],
  ["identity", "prints resolved identity; exercised inside start and done"],
  ["skills", "materializes skills; no repository walk"],
  ["scripts", "runs project scripts; their git use belongs to the project"],
  ["mcp", "a long-lived server whose tool calls run the budgeted verbs"],
]);

/** A `GIT_BIN` shim that records each spawn's subcommand, then runs real git. */
async function recordingGitShim(dir: string, log: string): Promise<string> {
  const shim = join(dir, "recording-git");
  await Deno.writeTextFile(
    shim,
    [
      "#!/bin/sh",
      'first=""; second=""; skip=0',
      'for arg in "$@"; do',
      '  if [ "$skip" -gt 0 ]; then skip=$((skip - 1)); continue; fi',
      '  if [ "$arg" = "-c" ]; then skip=1; continue; fi',
      '  if [ -z "$first" ]; then first="$arg"',
      '  elif [ -z "$second" ]; then second="$arg"; break; fi',
      "done",
      `printf '%s %s\\n' "$first" "$second" >> '${log}'`,
      'exec git "$@"',
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
  return shim;
}

/** The recorded spawns so far, one line each. */
async function recordedSpawns(log: string): Promise<string[]> {
  return ((await readTextIfExists(log)) ?? "").split("\n").filter((line) =>
    line !== ""
  );
}

/** The most frequent recorded commands, for a diagnosable failure. */
function histogram(lines: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([command, count]) => `${count} ${command}`)
    .join(", ");
}

/** The worktree path a successful `start --json` reports. */
function startedPath(stdout: string): string {
  const result = decodeCliResult(stdout, "start");
  assertResultDataKey(result, "path");
  return result.data.path;
}

Deno.test("the proven-worktree journey stays within its git command budget", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const log = join(dir, "git-spawns.log");
    const env = { GIT_BIN: await recordingGitShim(dir, log) };
    const measured: Record<string, number> = {};
    const step = async (
      verb: string,
      cwd: string,
      args: string[],
    ): Promise<string> => {
      const before = (await recordedSpawns(log)).length;
      const run = await runAgent(cwd, args, { env });
      assertEquals(run.code, 0, run.output);
      measured[verb] = (await recordedSpawns(log)).length - before;
      return run.stdout;
    };

    const worktree = startedPath(
      await step("start", dir, ["start", "--name", "budget", "--json"]),
    );
    await Deno.writeTextFile(join(worktree, "feature.txt"), "work\n");
    await git(worktree, "add", "-A");
    await git(worktree, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    await step("status", worktree, ["status", "--json"]);
    await step("done", worktree, ["done", "--json"]);
    await step("accept", worktree, ["accept", "--confirmed", "--json"]);

    const lines = await recordedSpawns(log);
    const report = `measured ${JSON.stringify(measured)}; top commands: ${
      histogram(lines)
    }`;
    console.log(`git command budget: ${report}`);
    for (const [verb, ceiling] of Object.entries(GIT_COMMAND_BUDGET)) {
      const count = measured[verb];
      assert(count !== undefined, `${verb} did not run`);
      assert(
        count <= ceiling,
        `${verb} spawned ${count} git processes against a budget of ${ceiling}. ${report}`,
      );
    }
    assert(
      lines.length <= JOURNEY_BUDGET,
      `the journey spawned ${lines.length} git processes against a budget of ${JOURNEY_BUDGET}. ${report}`,
    );
  });
});

Deno.test("every engine verb is budgeted or a named exception", () => {
  const budgeted = Object.keys(GIT_COMMAND_BUDGET);
  for (const verb of budgeted) {
    assert(
      !UNBUDGETED_ENGINE_VERBS.has(verb),
      `${verb} is both budgeted and excepted`,
    );
  }
  assertEquals(
    [...budgeted, ...UNBUDGETED_ENGINE_VERBS.keys()].sort(),
    [...KNOWN_ENGINE_VERBS].sort(),
    "give the new verb a budget in GIT_COMMAND_BUDGET or a named exception",
  );
});
