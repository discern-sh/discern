/**
 * The command-reference representation and its two surface renderings —
 * the rendering fixtures for a flagged command, a multi-word verb, and a
 * shell-only verb, on both surfaces, plus the token-grammar invariants the
 * registry guards lean on.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type CommandReference,
  containsCommandRefTokens,
  discernCommand,
  endOfFlags,
  extractCommandRefs,
  flag,
  type McpToolLookup,
  ownerDiscernCommand,
  positional,
  renderCommandRefsCli,
  renderCommandRefsMcp,
  stripCommandRefs,
} from "../src/shared/command_reference.ts";

/** A stand-in for the MCP boundary's TOOLS-derived lookup. */
const TOOL_LOOKUP: McpToolLookup = (words) =>
  ["start", "update", "done", "map", "await"].includes(words)
    ? `discern_${words}`
    : undefined;

Deno.test("a flagged command renders CLI flags and MCP parameters", () => {
  const text = `Run ${
    discernCommand("start", flag("name", '"<task>"'))
  } from the main checkout.`;
  assertEquals(
    renderCommandRefsCli(text),
    'Run `discern start --name "<task>"` from the main checkout.',
  );
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    'Run `discern_start` (name: "<task>") from the main checkout.',
  );
});

Deno.test("a multi-word verb keeps its word path on the CLI and falls back to the shell over MCP", () => {
  const text = `Then run ${discernCommand("setup begin")}.`;
  assertEquals(renderCommandRefsCli(text), "Then run `discern setup begin`.");
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    "Then run `discern setup begin` (in a shell).",
  );
});

Deno.test("a shell-only verb renders the explicit shell instruction over MCP", () => {
  const text = `Use ${discernCommand("desk")} to review.`;
  assertEquals(renderCommandRefsCli(text), "Use `discern desk` to review.");
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    "Use `discern desk` (in a shell) to review.",
  );
});

Deno.test("a bare tool-backed reference renders the tool name alone", () => {
  const text = `Re-run ${discernCommand("done")} on the clean HEAD.`;
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    "Re-run `discern_done` on the clean HEAD.",
  );
});

Deno.test("boolean flags become true-valued parameters; json drops from the tool spelling", () => {
  const text = `${discernCommand("done", flag("confirmed"))} probes; ${
    discernCommand("map", positional("target", "70-reference/cli"), flag("json"))
  } reads.`;
  assertEquals(
    renderCommandRefsCli(text),
    "`discern done --confirmed` probes; `discern map 70-reference/cli --json` reads.",
  );
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    '`discern_done` (confirmed: true) probes; `discern_map` (target: "70-reference/cli") reads.',
  );
});

Deno.test("numeric and pre-quoted values render verbatim as MCP parameters", () => {
  const text = `e.g. ${
    discernCommand("await", flag("green", "agent/upload-retry"), flag("timeout", "180"))
  }.`;
  assertEquals(
    renderCommandRefsCli(text),
    "e.g. `discern await --green agent/upload-retry --timeout 180`.",
  );
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    'e.g. `discern_await` (green: "agent/upload-retry", timeout: 180).',
  );
});

Deno.test("multi-word flag names map to underscored MCP parameters", () => {
  const text = `${discernCommand("start", flag("dry-run"))}`;
  assertEquals(renderCommandRefsCli(text), "`discern start --dry-run`");
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    "`discern_start` (dry_run: true)",
  );
});

Deno.test("the end-of-flags separator renders on the CLI and drops from the tool spelling", () => {
  const text = `${
    discernCommand("map", flag("json"), endOfFlags(), positional("target", "-dashed"))
  }`;
  assertEquals(renderCommandRefsCli(text), "`discern map --json -- -dashed`");
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    '`discern_map` (target: "-dashed")',
  );
});

Deno.test("an owner-executed reference keeps the CLI spelling on every surface", () => {
  const text = `your owner pulls it with ${
    ownerDiscernCommand("status", flag("verbose"))
  }.`;
  const cli = "your owner pulls it with `discern status --verbose`.";
  assertEquals(renderCommandRefsCli(text), cli);
  assertEquals(renderCommandRefsMcp(text, TOOL_LOOKUP), cli);
});

Deno.test("a root reference renders its flag form and never resolves to a tool", () => {
  const text = `or ${discernCommand("", flag("help"))} to list the commands.`;
  assertEquals(
    renderCommandRefsCli(text),
    "or `discern --help` to list the commands.",
  );
  assertEquals(
    renderCommandRefsMcp(text, TOOL_LOOKUP),
    "or `discern --help` (in a shell) to list the commands.",
  );
});

Deno.test("construction refuses an unknown verb, a bare root, and delimiter-carrying parts", () => {
  assertThrows(() => discernCommand("frobnicate"), Error, "unknown verb");
  assertThrows(() => discernCommand(""), Error, "root command reference");
  assertThrows(
    () => discernCommand("start", flag("name", "a⟧b")),
    Error,
    "delimiter",
  );
  assertThrows(
    () => discernCommand("start", flag("name", "a`b")),
    Error,
    "delimiter",
  );
  assertThrows(() => discernCommand("update\nnow"), Error, "delimiter");
});

Deno.test("tokens are detectable, extractable, and strippable for the guards", () => {
  const ref = discernCommand("update", flag("from", "<branch>"));
  const text = `Resume with ${ref}, or delete it.`;
  assert(containsCommandRefTokens(text));
  assert(!containsCommandRefTokens(renderCommandRefsCli(text)));
  assertEquals(stripCommandRefs(text), "Resume with , or delete it.");
  const extracted: CommandReference[] = extractCommandRefs(text);
  assertEquals(extracted, [
    {
      words: "update",
      args: [{ flag: "from", value: "<branch>" }],
      executor: "caller",
    },
  ]);
});

Deno.test("text without tokens passes through every renderer unchanged, same reference", () => {
  const text = "Run `git status` and read the diff.";
  assertEquals(renderCommandRefsCli(text), text);
  assertEquals(renderCommandRefsMcp(text, TOOL_LOOKUP), text);
});
