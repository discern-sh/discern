/**
 * The Git command budget's journey: how many Git processes each verb of the
 * proven-worktree journey starts.
 *
 * Every Git process the engine spawns funnels through `runGit` and honours
 * `GIT_BIN`, so a counting stand-in observes exactly the engine's own spawns
 * while the real journey runs over a scaffolded project: `start`, `status`,
 * `done`, `accept`. The project's jobs do nothing, so each count is discern's
 * own: what the verb pays before, between, and after the project's commands.
 */

import { join } from "@std/path";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "../tests/engine_helpers.ts";
import { refreshScaffold } from "../tests/engine_done_fixture.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { withToolTempDir } from "./temp_dir.ts";

/** The verbs the journey measures, in the order it runs them. */
export const GIT_COMMAND_BUDGET_VERBS = [
  "start",
  "status",
  "done",
  "accept",
] as const;

/** One measured journey verb. */
export type GitCommandBudgetVerb = (typeof GIT_COMMAND_BUDGET_VERBS)[number];

/** The standard, and the metric, that holds one verb's Git process count. */
export function gitCommandStandard(verb: GitCommandBudgetVerb): string {
  return `git_calls_${verb}`;
}

/** One measured journey: each verb's count and every recorded argv. */
export interface GitCommandJourney {
  readonly counts: Readonly<Record<GitCommandBudgetVerb, number>>;
  readonly spawns: readonly string[];
}

/** One known job per gate stage, each a no-op. */
const FIXTURE_CONFIG = [
  "[project]",
  'slug = "git-command-budget"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'format = "true"',
  'build = "true"',
  'lint = "true"',
  'typecheck = "true"',
  'test = "true"',
  'smoke = "true"',
  "",
].join("\n");

/** The Git subcommand of one recorded argv: its first word that is not an option. */
export function gitSubcommand(argv: string): string {
  const words = argv.split(" ");
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    if (word === "-c" || word === "-C") {
      index += 1;
      continue;
    }
    if (!word.startsWith("-")) return word;
  }
  return "(none)";
}

/** The recorded argv lines so far. */
async function recordedSpawns(log: string): Promise<string[]> {
  return ((await readTextIfExists(log)) ?? "").split("\n").filter((line) =>
    line !== ""
  );
}

/**
 * Run the journey once in a throwaway project and count each verb's Git
 * processes. Throws, naming the verb and its output, when a verb fails: a
 * failed verb's count means nothing.
 */
export async function measureGitCommandJourney(): Promise<GitCommandJourney> {
  return await withToolTempDir("git-command-budget", async (home) => {
    const project = join(home, "project");
    await Deno.mkdir(project);
    await scaffoldEngine(project);
    await writeConfig(project, FIXTURE_CONFIG);
    await gitInit(project);
    await refreshScaffold(project);

    // The stand-in is not named `git` and sits outside PATH, so the `git` it
    // runs is the real one.
    const log = join(home, "git-spawns.log");
    const standIn = join(home, "counting-git");
    await writeExecutable(
      standIn,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> '${log}'`,
        'exec git "$@"',
        "",
      ].join("\n"),
    );
    // Each verb is one an owner starts from a shell. When this journey runs
    // inside a discern operation, the enclosing operation's lock delegation
    // and invocation id would otherwise reach the measured verb and change
    // what it asks Git.
    const env = {
      GIT_BIN: standIn,
      [DISCERN_ENVIRONMENT_VARIABLES.operationLockDelegation]: "",
      [DISCERN_ENVIRONMENT_VARIABLES.spawnedBy]: "",
    };
    const counts: Partial<Record<GitCommandBudgetVerb, number>> = {};
    const step = async (
      verb: GitCommandBudgetVerb,
      cwd: string,
      args: string[],
    ): Promise<string> => {
      const before = (await recordedSpawns(log)).length;
      const run = await runAgent(cwd, args, { env });
      if (run.code !== 0) {
        throw new Error(
          `The journey's ${verb} step failed, so no count was taken:\n${run.output}`,
        );
      }
      counts[verb] = (await recordedSpawns(log)).length - before;
      return run.stdout;
    };

    const started = await step("start", project, [
      "start",
      "--name",
      "budget",
      "--json",
    ]);
    const worktree = (JSON.parse(started) as { data?: { path?: unknown } }).data
      ?.path;
    if (typeof worktree !== "string") {
      throw new Error(
        `The journey's start step named no worktree:\n${started}`,
      );
    }
    await Deno.writeTextFile(join(worktree, "change.txt"), "one change\n");
    await git(worktree, "add", "-A");
    await git(
      worktree,
      "commit",
      "-q",
      "-m",
      "Add one change",
      "--no-gpg-sign",
    );
    await step("status", worktree, ["status", "--json"]);
    await step("done", worktree, ["done", "--json"]);
    await step("accept", worktree, ["accept", "--confirmed", "--json"]);

    return {
      counts: Object.fromEntries(
        GIT_COMMAND_BUDGET_VERBS.map((verb) => [verb, counts[verb] ?? 0]),
      ) as Record<GitCommandBudgetVerb, number>,
      spawns: await recordedSpawns(log),
    };
  });
}
