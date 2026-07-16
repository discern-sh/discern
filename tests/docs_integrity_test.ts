/**
 * Unit proof that each docs-integrity scanner BITES — every guard in
 * tests/map_integrity_test.ts must fail on a bad fixture here before it is
 * trusted to pass on the live tree. Covers the extraction semantics too:
 * links and anchors follow the shared renderer (code spans, fences, and
 * comments are not links), and command validation honours the documentation
 * conventions (placeholders, optional brackets, alternation, terminators).
 */

import { assert, assertEquals } from "@std/assert";
import type { Command } from "@cliffy/command";
import { buildCli } from "../src/main.ts";
import { cliCommandModel } from "../src/shared/cli_reference_codegen.ts";
import {
  extractDocLinks,
  extractFencedCommands,
  headingAnchors,
  validateFencedCommand,
} from "../src/lib/docs_integrity.ts";

const model = cliCommandModel(buildCli(false) as unknown as Command);

// ── link extraction follows the renderer ──────────────────────────────────────

Deno.test("extractDocLinks finds rendered links with their source lines", () => {
  const md = [
    "# Title",
    "",
    "See [the gate](../20-quality-gate/README.md) and",
    "[worktrees](../30-worktrees/README.md#lifecycle).",
  ].join("\n");
  assertEquals(extractDocLinks(md), [
    { target: "../20-quality-gate/README.md", line: 3 },
    { target: "../30-worktrees/README.md#lifecycle", line: 4 },
  ]);
});

Deno.test("extractDocLinks ignores link syntax that never renders as a link", () => {
  const md = [
    "---",
    "redirect_from:",
    "  - /docs/old-route",
    "---",
    "",
    "# Title",
    "",
    "Write links as `[some module](../../src/path/Thing.ext)`.",
    "",
    "```md",
    "[fenced](dead.md)",
    "```",
    "",
    "<!-- [commented](gone.md) -->",
    "",
    "A real [link](real.md), twice: [link](real.md).",
  ].join("\n");
  assertEquals(extractDocLinks(md), [
    { target: "real.md", line: 16 },
    { target: "real.md", line: 16 },
  ]);
});

Deno.test("headingAnchors are the renderer's ids, duplicate-suffixed and GitHub-compatible", () => {
  const md = [
    "# The gate!",
    "## Running it",
    "## Running it",
    "### `discern done` — the bar",
    "### Files & dirs",
  ].join("\n");
  assertEquals(
    headingAnchors(md),
    new Set([
      "the-gate",
      "running-it",
      "running-it-1",
      // Dropped punctuation leaves both spaces behind, each becoming a dash —
      // the same anchor GitHub mints, so links work on both surfaces.
      "discern-done--the-bar",
      "files--dirs",
    ]),
  );
});

// ── fenced-command extraction ─────────────────────────────────────────────────

Deno.test("extractFencedCommands finds commands only inside fences, joining continuations", () => {
  const md = [
    "Run discern done from the root.", // prose mention: not fenced, not found
    "",
    "```sh",
    "$ discern status --json",
    "ok: true", // output line: not a command
    "discern start \\",
    "  --name demo",
    "```",
    "",
    "~~~",
    "discern done   # the bar",
    "~~~",
  ].join("\n");
  assertEquals(extractFencedCommands(md), [
    { line: 4, command: "discern status --json" },
    { line: 6, command: "discern start --name demo" },
    { line: 11, command: "discern done   # the bar" },
  ]);
});

// ── command validation bites ──────────────────────────────────────────────────

Deno.test("a bogus verb fails validation (the guard bites)", () => {
  const reason = validateFencedCommand("discern frobnicate", model);
  assert(reason !== undefined && reason.includes("frobnicate"), reason);
});

Deno.test("a removed or misspelled flag fails validation (the guard bites)", () => {
  const reason = validateFencedCommand("discern done --no-such-flag", model);
  assert(reason !== undefined && reason.includes("--no-such-flag"), reason);
  const sub = validateFencedCommand(
    "discern worktree drop demo --confirmed",
    model,
  );
  assert(sub !== undefined && sub.includes("--confirmed"), sub);
});

Deno.test("a stale subcommand fails validation (the guard bites)", () => {
  // `set-slot` was a real `config` subcommand once — the retired spelling must
  // fail even with no flag on the line, because `config` is a pure command
  // group (subcommands, no positionals).
  const reason = validateFencedCommand(
    "discern config set-slot gate",
    model,
  );
  assert(reason !== undefined && reason.includes("set-slot"), reason);
});

Deno.test("real commands from the map's conventions validate", () => {
  const fine = [
    "discern",
    "discern --help",
    "discern --version",
    "discern status",
    "discern done --json",
    "discern done     # or: deno task gate",
    "discern improvement --min-score 70",
    "discern help --adr --json",
    "discern worktree drop <id> --force",
    "discern config set <dotted.key> <value> [--number | --bool | --string]",
    "discern config set-standard <name> --limit <n> [--metric <m>] [--direction up|down]",
    "discern skills list",
    "discern setup begin --config - --confirmed",
    "discern <command> --json",
    "discern map -- --weird-positional",
    "discern done --json && echo landed",
    "discern status --json | head -3",
  ];
  for (const command of fine) {
    assertEquals(
      validateFencedCommand(command, model),
      undefined,
      `expected valid: ${command}`,
    );
  }
});

Deno.test("project-script names validate only when enrolled as extra verbs", () => {
  assert(validateFencedCommand("discern self-audit", model) !== undefined);
  assertEquals(
    validateFencedCommand(
      "discern self-audit",
      model,
      new Set(["self-audit"]),
    ),
    undefined,
  );
});
