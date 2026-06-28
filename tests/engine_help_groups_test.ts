/**
 * Help-grouping guard — the forcing function that keeps every visible top-level
 * command in a named `discern --help` group.
 *
 * Cliffy cannot group commands itself (its `.group()` groups OPTIONS, and its
 * help generator renders commands flat — see `src/cli_help.ts`), so the grouping
 * lives in the `COMMAND_GROUPS` map and is applied by post-processing the help.
 * That map is a hand-maintained satellite of the command registry: without a
 * tie, a verb registered with no group entry would silently drop into the
 * defensive "Other" bucket instead of an operator-meaningful heading, and a
 * stale entry naming a removed verb would rot unnoticed.
 *
 * This test is that tie. It builds the FULL command tree (installer + engine
 * verbs, every feature on, `setup` shown — the maximal set that can appear in
 * help) and asserts the visible top-level commands are EXACTLY what
 * `COMMAND_GROUPS` covers. The fix when it fails is never to weaken the
 * assertion — it is to give the verb a home in `src/cli_help.ts`.
 */

import { assert, assertEquals } from "@std/assert";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import {
  COMMAND_GROUPS,
  groupedCommandNames,
  operatorHelp,
} from "../src/cli_help.ts";
import { FEATURES } from "../src/shared/features.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/** The ESC byte that opens every ANSI escape (built without a control-char regex). */
const ESC = String.fromCharCode(27);

/** Strip ANSI SGR colour sequences so substring checks see plain text. Cliffy
 * forces colour in `getHelp()` and highlights `<arg>`/`[arg]` per-token, so the
 * usage shape is only contiguous once the escapes are removed. */
function plain(s: string): string {
  return s
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.slice(part.indexOf("m") + 1)))
    .join("");
}

/** The full root with every feature on and `setup` shown — the maximal set of
 * commands that can ever appear in `discern --help`. */
function fullRoot(): Command {
  return buildCli(new Set(FEATURES), false) as unknown as Command;
}

Deno.test("every visible top-level command belongs to exactly one help group", () => {
  const visible = fullRoot().getCommands(false).map((c) => c.getName());

  // Coverage is bidirectional: the grouped set must EQUAL the visible command set.
  // A verb registered with no group entry lands in `visible` but not in the
  // grouped names; a stale group entry naming a removed verb does the reverse —
  // either way this red-lights.
  assertEquals(
    sorted(groupedCommandNames()),
    sorted(visible),
    "COMMAND_GROUPS has drifted from the registered top-level commands — give the " +
      "new verb a home in src/cli_help.ts (or drop the stale entry)",
  );

  // No verb is double-listed across groups.
  const flat = COMMAND_GROUPS.flatMap((g) => g.commands);
  assertEquals(
    flat.length,
    new Set(flat).size,
    "a command is listed in more than one help group",
  );
});

Deno.test("operator help renders the groups in order, daily loop first", () => {
  const help = plain(operatorHelp(fullRoot()));

  // Every group heading appears, in COMMAND_GROUPS order (strictly increasing
  // position catches both a missing heading — indexOf -1 — and a reorder).
  let prev = -1;
  for (const group of COMMAND_GROUPS) {
    const at = help.indexOf(group.name);
    assert(
      at > prev,
      `the "${group.name}" group heading is missing or out of order in the help`,
    );
    prev = at;
  }

  // The daily loop must lead the setup/maintenance verbs (the operator-first promise).
  assert(
    help.indexOf("Daily loop") < help.indexOf("Setup & maintenance"),
    "the daily-loop group must precede setup/maintenance in the help",
  );

  // The operator affordances are present: the usage shape and the drill-in pointer.
  assert(help.includes("<command> [options]"), "the usage shape is missing");
  assert(
    help.includes("discern <command> --help"),
    "the per-command --help footer is missing",
  );
});
