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

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Command } from "@cliffy/command";
import { measureText, stripAnsi } from "discern-design-system/cli";
import { DISCERN_TRIANGLE_GLYPHS } from "../art/terminal/triangle.ts";
import { buildCli, KNOWN_VERBS } from "../src/main.ts";
import {
  cliCommandModel,
  walkCliCommands,
} from "../src/shared/cli_reference_codegen.ts";
import { HIDDEN_VERBS, hiddenVerbNames } from "../src/shared/hidden_verbs.ts";
import {
  COMMAND_GROUPS,
  groupedCommandNames,
  operatorHelp,
} from "../src/cli_help.ts";
import {
  resolveTerminalContext,
  type TerminalContext,
} from "../src/lib/terminal.ts";
import { fakeEnv } from "./helpers.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/** Compare parser facts independently of presentation whitespace. */
function compact(s: string): string {
  return s.replace(/\s+/gu, "");
}

/** Strip ANSI through the published terminal-text authority. */
function plain(s: string): string {
  return stripAnsi(s);
}

/** Resolve deterministic package capabilities for width/degradation proofs. */
function helpTerminal(columns: number, unicode = true): TerminalContext {
  return resolveTerminalContext({
    noColor: false,
    env: fakeEnv({
      TERM: "xterm-256color",
      ...(unicode ? { LANG: "en_GB.UTF-8" } : { LC_ALL: "C" }),
    }),
    isTerminal: () => true,
    consoleSize: () => ({ columns, rows: 24 }),
  });
}

/** The full root with `setup` shown — the maximal set of
 * commands that can ever appear in `discern --help`. */
function fullRoot(): Command {
  return buildCli(false) as unknown as Command;
}

/** Resolve a named command including hidden children and fail with its missing name. */
function child(parent: Command, name: string): Command {
  const found = parent.getCommands(true).find((command) =>
    command.getName() === name
  );
  assert(found !== undefined, `missing command ${name}`);
  return found;
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

Deno.test("operator help renders the groups in order, the human's desk first", () => {
  const help = plain(operatorHelp(fullRoot()));

  // Every group heading appears, in COMMAND_GROUPS order (strictly increasing
  // position catches both a missing heading — indexOf -1 — and a reorder).
  let prev = -1;
  for (const group of COMMAND_GROUPS) {
    const at = help.indexOf(group.name.toUpperCase());
    assert(
      at > prev,
      `the "${group.name}" group heading is missing or out of order in the help`,
    );
    prev = at;
  }

  // The daily loop must lead the setup/maintenance verbs (the operator-first promise).
  assert(
    help.indexOf("AGENTIC LOOP") < help.indexOf("SETUP & MAINTENANCE"),
    "the daily-loop group must precede setup/maintenance in the help",
  );

  // The operator affordances are present: the usage shape and the drill-in pointer.
  assert(help.includes("<command> [options]"), "the usage shape is missing");
  assert(
    help.includes("discern <command> --help"),
    "the per-command --help footer is missing",
  );
});

Deno.test("operator help retains every public Cliffy root fact modulo layout and ANSI", () => {
  const root = fullRoot();
  const rendered = plain(operatorHelp(root, { width: 48, color: false }));
  const facts = compact(rendered);

  assertStringIncludes(
    facts,
    compact(`${root.getPath()} ${root.getUsage()}`),
    "the public usage path or placeholder was lost",
  );
  assertStringIncludes(
    facts,
    compact(root.getDescription()),
    "the public root description was lost",
  );

  // operatorHelp's getHelp() registration must enroll Cliffy's built-in options
  // exactly once alongside the root globals, without using generated help bytes.
  const options = root.getOptions(false);
  assertEquals(
    options.filter((option) => option.flags.includes("--help")).length,
    1,
  );
  assertEquals(
    options.filter((option) => option.flags.includes("--version")).length,
    1,
  );
  for (const option of options) {
    assertStringIncludes(facts, compact(option.flags.join(", ")));
    assertStringIncludes(facts, compact(option.description));
  }

  for (const command of root.getCommands(false)) {
    assertStringIncludes(facts, compact(command.getName()));
    assertStringIncludes(facts, compact(command.getShortDescription()));
  }

  let previousExample = -1;
  for (const example of root.getExamples()) {
    const at = facts.indexOf(
      compact(`${example.name}${example.description}`),
    );
    assert(
      at > previousExample,
      `example ${JSON.stringify(example.name)} was lost or reordered`,
    );
    previousExample = at;
  }

  operatorHelp(root, { width: 48, color: false });
  assertEquals(
    root.getOptions(false).filter((option) => option.flags.includes("--help"))
      .length,
    1,
    "repeated rendering duplicated Cliffy's built-in help option",
  );
});

Deno.test("command help defines the core vocabulary and routes the three update operations", () => {
  const root = fullRoot();
  assertStringIncludes(root.getShortDescription(), "full quality check");
  assertStringIncludes(
    root.getShortDescription(),
    "separate checkout and branch",
  );

  const done = child(root, "done").getShortDescription();
  for (
    const term of [
      "clean, committed",
      "may change files",
      "format",
      "lint",
      "type-check",
      "tests",
    ]
  ) {
    assertStringIncludes(done, term);
  }
  assertStringIncludes(
    child(root, "standards").getShortDescription(),
    "numbers that can never get worse",
  );
  assertStringIncludes(
    child(root, "impact").getShortDescription(),
    "named regions of the repository",
  );
  assertStringIncludes(
    child(root, "identity").getShortDescription(),
    "branch, development host, port, database, and external resources",
  );

  const routes: Record<string, readonly string[]> = {
    update: ["discern upgrade", "discern refresh"],
    upgrade: ["discern update", "discern refresh"],
    refresh: ["discern update", "discern upgrade"],
  };
  for (const [name, peers] of Object.entries(routes)) {
    const description = child(root, name).getShortDescription();
    for (const peer of peers) assertStringIncludes(description, peer);
  }
});

Deno.test("command help contains no retired compatibility prose", () => {
  const residue = /\b(?:compatibility alias|deprecated|existing callers)\b/iu;
  const model = cliCommandModel(fullRoot());
  const offenders: string[] = [];
  for (const command of walkCliCommands(model)) {
    if (residue.test(command.description)) {
      offenders.push(`${command.path.join(" ") || "discern"}: description`);
    }
    for (const option of command.options) {
      if (residue.test(option.description)) {
        offenders.push(
          `${command.path.join(" ") || "discern"}: ${option.flags.join("/")}`,
        );
      }
    }
  }
  assertEquals(offenders, []);
});

Deno.test("worktree help renders the configured trunk name, never a hard-coded default", () => {
  const root = buildCli(false, "master") as unknown as Command;
  for (const name of ["start", "accept", "update"]) {
    const description = child(root, name).getShortDescription();
    assertStringIncludes(description, "trunk");
    assertStringIncludes(description, "`master`");
    assertStringIncludes(description, "shared landing branch");
    assert(!description.includes("`main`"));
  }
  assertStringIncludes(
    child(root, "update").getShortDescription(),
    "trunk's latest (`master`) into this branch",
  );
  const setupAccept = child(child(root, "setup"), "accept")
    .getShortDescription();
  assertStringIncludes(setupAccept, "trunk (`master`)");
  assert(!setupAccept.includes("`main`"));
});

Deno.test("hidden top-level commands stay registered, enrolled with reasons, and never greet the help reader", () => {
  // The class: a command deliberately kept OUT of the operator help (an empty
  // mechanism like a provider hook, or setup once the project is bootstrapped) must
  // stay dispatchable — hidden, never removed — and must carry a recorded
  // reason in the hidden-verb registry, because hiding also drops the verb
  // from the generated CLI reference and every surface downstream of it.
  // Both bootstrap states are held EQUAL to the registry, so a verb can
  // neither hide unenrolled nor stay enrolled after it returns to the listing.
  for (const bootstrapped of [false, true]) {
    const root = buildCli(bootstrapped) as unknown as Command;
    const visible = new Set(root.getCommands(false).map((c) => c.getName()));
    const hidden = root.getCommands(true)
      .map((c) => c.getName())
      .filter((name) => !visible.has(name));
    assertEquals(
      sorted(hidden),
      sorted(hiddenVerbNames(bootstrapped)),
      `the live hidden set must match the hidden-verb registry (bootstrapped: ${bootstrapped})`,
    );

    const helpLines = plain(operatorHelp(root)).split("\n");
    for (const name of hidden) {
      assert(
        root.getCommand(name, true) !== undefined,
        `hidden command ${name} must stay dispatchable`,
      );
      assert(
        !helpLines.some((line) =>
          new RegExp(`^\\s{4}${name}(\\s|$)`).test(line)
        ),
        `hidden command ${name} leaked a row into the top-level help`,
      );
    }
  }

  for (const [name, entry] of Object.entries(HIDDEN_VERBS)) {
    assert(KNOWN_VERBS.has(name), `hidden-verb entry ${name} names no verb`);
    assert(entry.reason.length > 0, `${name} needs a recorded reason`);
    assert(
      entry.revival.length > 0,
      `${name} needs a recorded revival condition`,
    );
  }
});

Deno.test("worktree help hides the provider-hook namespace while keeping it callable", () => {
  const worktree = child(fullRoot(), "worktree");
  const visible = worktree.getCommands(false).map((command) =>
    command.getName()
  );
  const registered = worktree.getCommands(true).map((command) =>
    command.getName()
  );
  assert(
    registered.includes("hook"),
    "the hook namespace must stay dispatchable",
  );
  assert(
    !visible.includes("hook"),
    "the hook namespace leaked into user help",
  );
  const hook = child(worktree, "hook");
  for (const entry of ["create", "remove"]) {
    assert(
      hook.getCommands(true).map((command) => command.getName()).includes(
        entry,
      ),
      `${entry} hook entry point must stay callable`,
    );
  }
});

Deno.test("the complete root help word-wraps with stable hanging indents", () => {
  // Inject the layout width directly: tests can run under a real PTY, so the
  // physical terminal and its inherited $COLUMNS must not affect this contract.
  // 80 is wide enough that no single description token overflows on its own, so
  // every command line should fit.
  const WIDTH = 80;
  const lines = plain(
    operatorHelp(fullRoot(), { width: WIDTH }),
  ).split("\n");
  for (const line of lines) {
    assert(
      measureText(line) <= WIDTH,
      `root help overflowed ${WIDTH} cols: ${JSON.stringify(line)}`,
    );
  }

  // The grouped command descriptions retain their established hanging indent.
  const start = lines.findIndex((l) => l.trimEnd() === "Commands:");
  const endRaw = lines.findIndex((l, i) =>
    i > start && l.trimEnd() === "Examples:"
  );
  const body = lines.slice(start + 1, endRaw === -1 ? undefined : endRaw);

  // No command line overflows the width — UNLESS it is a single unbreakable
  // token (a long `a/b/c` path with no spaces), which wrapText leaves whole by
  // design rather than splitting mid-token. That is exactly wrapText's contract.
  for (const l of body) {
    const breakable = l.trimStart().includes(" ");
    assert(
      measureText(l) <= WIDTH || !breakable,
      `a wrappable command line overflowed ${WIDTH} cols: ${JSON.stringify(l)}`,
    );
  }

  // A long description wrapped onto a continuation line that hang-indents to the
  // description column (≥10 leading spaces), rather than wrapping back to col 0
  // and shredding the alignment — the regression this guards.
  assert(
    body.some((l) => /^ {10,}\S/.test(l)),
    "no hang-indented continuation line — descriptions did not wrap cleanly",
  );

  // Options and examples align their wrapped bodies to a stable continuation
  // column when the terminal has room for side-by-side labels.
  const plainOption = lines.findIndex((line) => line.includes("--plain"));
  assert(plainOption !== -1, "the --plain option row is missing");
  assert(
    /^ {10,}\S/.test(lines[plainOption + 1] ?? ""),
    "the --plain continuation lost its hanging indent",
  );
  const mainExample = lines.findIndex((line) =>
    line.includes("Agent in the main checkout?")
  );
  assert(mainExample !== -1, "the main-checkout example label is missing");
  assert(
    /^ {20,}\S/.test(lines[mainExample + 1] ?? ""),
    "the example continuation lost its aligned hanging indent",
  );
});

Deno.test("the complete root help follows narrow, wide, and ASCII package capabilities", () => {
  for (const width of [42, 48, 80, 120]) {
    const rendered = operatorHelp(fullRoot(), {
      terminal: helpTerminal(width),
    });
    const lines = rendered.split("\n");
    for (const rawLine of lines) {
      const line = plain(rawLine);
      assert(
        measureText(line) <= width,
        `${width}-column root help overflowed: ${JSON.stringify(line)}`,
      );
      assertEquals(
        line,
        line.trimEnd(),
        `${width}-column root help retained trailing display whitespace`,
      );
    }
    for (const group of COMMAND_GROUPS) {
      assertStringIncludes(plain(rendered), group.name.toUpperCase());
    }
  }

  const ascii = plain(operatorHelp(fullRoot(), {
    terminal: helpTerminal(72, false),
    color: false,
  }));
  for (const glyph of Object.values(DISCERN_TRIANGLE_GLYPHS)) {
    assert(!ascii.includes(glyph), `Unicode package glyph leaked: ${glyph}`);
  }
  assertStringIncludes(ascii, "YOUR DESK");
  assertStringIncludes(ascii, "discern <command> --help");
});

Deno.test("root help makes hostile Cliffy facts inert and keeps long graphemes bounded", () => {
  const controls = "esc\u001b[31m bell\u0007 c1\u0085 bidi\u202e";
  const graphemeToken = "e\u0301".repeat(64);
  const fixture = new Command()
    .name("fixture")
    .version("1.2.3")
    .usage("<value:string> [options]")
    .description(`Description ${controls}\r\n${graphemeToken}`)
    .option(
      "-x, --xray <value:string>",
      `Option ${controls} ${graphemeToken}`,
    )
    .example("Hostile example", `Example ${controls}\r\n${graphemeToken}`);
  const width = 42;
  const rendered = operatorHelp(fixture as unknown as Command, {
    terminal: helpTerminal(width),
    color: false,
  });

  assert(!rendered.includes("\u001b"), "an injected ESC reached root help");
  assert(!rendered.includes("\u0007"), "an injected C0 reached root help");
  assert(!rendered.includes("\u0085"), "an injected C1 reached root help");
  assert(
    !rendered.includes("\u202e"),
    "an injected bidi control reached root help",
  );
  assert(
    !rendered.includes("\r"),
    "CRLF was not normalized at the terminal edge",
  );
  for (const visible of ["␛", "␇", "<U+0085>", "<U+202E>", graphemeToken]) {
    assertStringIncludes(compact(rendered), compact(visible));
  }
  for (const line of rendered.split("\n")) {
    assert(
      measureText(line) <= width,
      `hostile fixture overflowed: ${JSON.stringify(line)}`,
    );
    assertEquals(line, line.trimEnd());
  }

  // The configured trunk is repository-derived and enters several live command
  // descriptions; those facts cross the same safe-text boundary before styling.
  const hostileTrunk = `ma\u001b[31m\u0007\u0085\u202ein`;
  const trunkHelp = operatorHelp(
    buildCli(false, hostileTrunk) as unknown as Command,
    { terminal: helpTerminal(48), color: false },
  );
  for (const control of ["\u001b", "\u0007", "\u0085", "\u202e"]) {
    assert(
      !trunkHelp.includes(control),
      "hostile trunk control reached output",
    );
  }
  for (const visible of ["␛", "␇", "<U+0085>", "<U+202E>"]) {
    assertStringIncludes(trunkHelp, visible);
  }
  for (const line of trunkHelp.split("\n")) {
    assert(measureText(line) <= 48, `hostile trunk overflowed: ${line}`);
  }
});
