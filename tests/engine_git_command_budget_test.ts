/**
 * Enrolment in the Git command budget.
 *
 * The budget itself is a set of standards: the journey in
 * `scripts/git_command_budget_lib.ts` counts the Git processes each of its
 * verbs starts, and one falling ceiling per verb holds that count. This file
 * keeps the population honest. Every engine verb is either measured by the
 * journey or a named exception, so a new verb must enrol one way or the other,
 * and every measured verb has its standard, so a count cannot be measured and
 * then held by nothing.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { KNOWN_ENGINE_VERBS } from "../src/shared/verbs.ts";
import {
  GIT_COMMAND_BUDGET_VERBS,
  gitCommandStandard,
  gitSubcommand,
} from "../scripts/git_command_budget_lib.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** Engine verbs the journey does not exercise, each with the reason. */
const UNBUDGETED_ENGINE_VERBS: ReadonlyMap<string, string> = new Map([
  ["prepare", "its fixers and refresh rewrite the fixture between steps"],
  ["test", "runs the project's own test command, not a git workload"],
  ["queue", "schedules test processes; its git use is fleet observation"],
  ["await", "waits on other efforts; a bounded journey has none"],
  ["improvement", "reads the logbook rather than the repository"],
  ["standards", "measures the project's standards, not a git workload"],
  ["checkpoints", "reads checkpoint state written by done"],
  [
    "progress",
    "reads the operation journal written by done; one branch-name read",
  ],
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

Deno.test("every engine verb is budgeted or a named exception", () => {
  for (const verb of GIT_COMMAND_BUDGET_VERBS) {
    assert(
      !UNBUDGETED_ENGINE_VERBS.has(verb),
      `${verb} is both budgeted and excepted`,
    );
  }
  assertEquals(
    [...GIT_COMMAND_BUDGET_VERBS, ...UNBUDGETED_ENGINE_VERBS.keys()].sort(),
    [...KNOWN_ENGINE_VERBS].sort(),
    "measure the new verb in the Git command journey or give it a named exception",
  );
});

Deno.test("every budgeted verb is held by a falling standard the journey produces", async () => {
  const config = parseToml(
    await Deno.readTextFile(join(REPO_ROOT, "discern.toml")),
  ) as { standards?: Record<string, Record<string, unknown>> };
  const standards = config.standards ?? {};
  const producers = new Set<string>();
  for (const verb of GIT_COMMAND_BUDGET_VERBS) {
    const name = gitCommandStandard(verb);
    const standard = standards[name];
    assert(
      standard !== undefined,
      `add [standards.${name}] so the journey's ${verb} count is held`,
    );
    assertEquals(standard.direction, "down", `${name} must be a ceiling`);
    assertEquals(
      standard.margin,
      undefined,
      `${name} is an exact count; a margin would let it grow unnoticed`,
    );
    producers.add(
      typeof standard.producer === "string"
        ? standard.producer
        : `standards.${name}`,
    );
  }
  assertEquals(
    producers.size,
    1,
    "one journey run must supply every verb's reading",
  );
  const [producer] = [...producers];
  const run = standards[producer?.replace(/^standards\./, "") ?? ""]?.run;
  assertEquals(
    run,
    "deno task git-command-budget",
    "the shared producer must be the journey's own command",
  );
});

Deno.test("a recorded argv's subcommand is its first word that is not an option", () => {
  assertEquals(gitSubcommand("status --porcelain -z"), "status");
  assertEquals(
    gitSubcommand("-c alias.rev-parse= rev-parse --git-common-dir"),
    "rev-parse",
  );
  assertEquals(gitSubcommand("-C nested -c core.quotePath=false diff"), "diff");
  assertEquals(gitSubcommand("--version"), "(none)");
});
