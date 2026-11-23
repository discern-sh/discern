/**
 * Measure the Git command budget as discern standards.
 *
 * Usage: `deno task git-command-budget`. The command runs the proven-worktree
 * journey once, tallies the Git subcommands on stderr, and prints one
 * `DISCERN_METRIC git_calls_<verb> <count>` line per journey verb on stdout.
 */

import {
  GIT_COMMAND_BUDGET_VERBS,
  gitCommandStandard,
  gitSubcommand,
  measureGitCommandJourney,
} from "./git_command_budget_lib.ts";

const journey = await measureGitCommandJourney();
const tally = new Map<string, number>();
for (const argv of journey.spawns) {
  const name = gitSubcommand(argv);
  tally.set(name, (tally.get(name) ?? 0) + 1);
}
for (
  const [name, count] of [...tally.entries()].sort((a, b) =>
    b[1] - a[1] || a[0].localeCompare(b[0])
  )
) {
  console.error(`${String(count).padStart(4)} git ${name}`);
}
console.error(
  `${journey.spawns.length} Git processes across ${
    GIT_COMMAND_BUDGET_VERBS.join(", ")
  } over a project whose jobs do nothing. ` +
    "Take a fact the operation already holds from Git discovery instead of asking Git again.",
);
for (const verb of GIT_COMMAND_BUDGET_VERBS) {
  console.log(
    `DISCERN_METRIC ${gitCommandStandard(verb)} ${journey.counts[verb]}`,
  );
}
