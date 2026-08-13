/**
 * Product-policy and deterministic package-adapter tests for prompts.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import type { TerminalCapabilities } from "discern-design-system/cli";
import type {
  TerminalIO,
  TerminalSize,
} from "discern-design-system/cli/interactive";
import {
  canPrompt,
  checkboxPrompt,
  groupedSelectOptions,
  inputPrompt,
  interactionAllowed,
  isPromptCancellation,
  promptAllowed,
  resolveBrief,
  resolveSetupConfig,
  selectPrompt,
  setJsonMode,
  setPlainMode,
} from "../src/lib/prompts.ts";
import { DEFAULTS } from "../src/lib/config.ts";
import { Logger } from "../src/lib/log.ts";
import { withTempDir } from "./helpers.ts";

const encoder = new TextEncoder();

/** Scripted package terminal that still runs the production prompt wrappers. */
class ScriptedTerminal implements TerminalIO {
  readonly writes: string[] = [];
  readonly rawTransitions: boolean[] = [];
  readonly #chunks: Uint8Array[];

  constructor(
    chunks: readonly string[],
    readonly facts: TerminalCapabilities = {
      colorDepth: "none",
      columns: 60,
      unicode: true,
    },
    readonly dimensions: TerminalSize = { columns: 60, rows: 24 },
  ) {
    this.#chunks = chunks.map((chunk) => encoder.encode(chunk));
  }

  isInteractive(): boolean {
    return true;
  }

  capabilities(): TerminalCapabilities {
    return this.facts;
  }

  size(): TerminalSize {
    return this.dimensions;
  }

  read(): Promise<Uint8Array | null> {
    return Promise.resolve(this.#chunks.shift() ?? null);
  }

  setRawMode(enabled: boolean): void {
    this.rawTransitions.push(enabled);
  }

  write(value: string): void {
    this.writes.push(value);
  }
}

/** Explicitly allow a scripted terminal while keeping production wrappers. */
function scriptedRuntime(io: TerminalIO): {
  readonly io: TerminalIO;
  readonly interactive: () => true;
} {
  return { io, interactive: () => true };
}

/** A real, colourless, non-JSON logger as the wizard receives one. */
function logger(): Logger {
  return new Logger({ json: false, noColor: true });
}

/**
 * Run `fn` with `console.error` replaced by a sink that records each line, then
 * always restore the original — so a warning can be asserted without leaking.
 */
async function captureStderr(
  fn: (lines: string[]) => Promise<void>,
): Promise<void> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await fn(lines);
  } finally {
    console.error = original;
  }
}

// ---- resolveBrief ----------------------------------------------------------

Deno.test("resolveBrief returns a literal string unchanged", async () => {
  assertEquals(await resolveBrief("a plain brief"), "a plain brief");
  // An empty literal is still a literal, not a file read.
  assertEquals(await resolveBrief(""), "");
});

Deno.test("resolveBrief reads an @path value from disk", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "brief.md");
    await Deno.writeTextFile(path, "from a file\n");
    assertEquals(await resolveBrief(`@${path}`), "from a file\n");
  });
});

Deno.test("resolveBrief throws a clear error for a missing @path", async () => {
  await withTempDir(async (dir) => {
    const missing = join(dir, "does-not-exist.md");
    await assertRejects(
      () => resolveBrief(`@${missing}`),
      Error,
      `could not read brief file "${missing}"`,
    );
  });
});

// ---- canPrompt -------------------------------------------------------------

Deno.test("canPrompt(true) is false — --yes always suppresses prompts", () => {
  // `--yes` short-circuits before any TTY check, so this holds in CI too.
  assertEquals(canPrompt(true), false);
});

Deno.test("interaction policy independently honors every prompt veto", () => {
  const env = (CI?: string) => ({
    get: (key: string) => key === "CI" ? CI : undefined,
  });
  const streams = (stdin: boolean, stdout: boolean) => () => ({
    stdin,
    stdout,
  });

  assertEquals(
    interactionAllowed(false, false, false, env(), streams(true, true)),
    true,
  );
  assertEquals(
    interactionAllowed(true, false, false, env(), streams(true, true)),
    false,
  );
  assertEquals(
    interactionAllowed(false, true, false, env(), streams(true, true)),
    false,
  );
  assertEquals(
    interactionAllowed(false, false, true, env(), streams(true, true)),
    false,
  );
  assertEquals(
    interactionAllowed(false, false, false, env("1"), streams(true, true)),
    false,
  );
  assertEquals(
    interactionAllowed(
      false,
      false,
      false,
      env("false"),
      streams(true, true),
    ),
    true,
  );
  assertEquals(
    interactionAllowed(false, false, false, env(), streams(false, true)),
    false,
  );
  assertEquals(
    interactionAllowed(false, false, false, env(), streams(true, false)),
    false,
  );
});

Deno.test("a veto refuses before constructing or touching terminal effects", async () => {
  let terminalEffects = 0;
  const io: TerminalIO = {
    isInteractive: () => {
      terminalEffects += 1;
      return true;
    },
    capabilities: () => {
      terminalEffects += 1;
      return { colorDepth: "none", columns: 40, unicode: true };
    },
    size: () => {
      terminalEffects += 1;
      return { columns: 40, rows: 20 };
    },
    read: () => {
      terminalEffects += 1;
      return Promise.resolve(null);
    },
    setRawMode: () => {
      terminalEffects += 1;
    },
    write: () => {
      terminalEffects += 1;
    },
  };
  await assertRejects(
    () =>
      selectPrompt({
        message: "Choose",
        options: [{ name: "One", value: "one" }],
      }, { io, interactive: () => false }),
    Error,
    "needs an interactive terminal",
  );
  assertEquals(terminalEffects, 0);
});

Deno.test("global JSON and plain vetoes outrank an injected interactive runtime", async () => {
  const io = new ScriptedTerminal(["\r"]);
  try {
    setJsonMode(true);
    await assertRejects(
      () =>
        selectPrompt({
          message: "Choose",
          options: [{ name: "One", value: "one" }],
        }, scriptedRuntime(io)),
      Error,
      "remove --plain and --json",
    );
    setJsonMode(false);
    setPlainMode(true);
    await assertRejects(
      () =>
        selectPrompt({
          message: "Choose",
          options: [{ name: "One", value: "one" }],
        }, scriptedRuntime(io)),
      Error,
      "remove --plain and --json",
    );
  } finally {
    setJsonMode(false);
    setPlainMode(false);
  }
  assertEquals(io.rawTransitions, []);
});

Deno.test("grouped select keeps headings structural and ids stable across reorder", async () => {
  const groups = groupedSelectOptions([
    {
      id: "first",
      label: "First group",
      items: [{ id: "alpha", name: "Duplicate label", value: "alpha" }],
    },
    {
      id: "second",
      label: "Second group",
      items: [{ id: "beta", name: "Duplicate label", value: "beta" }],
    },
  ]);
  const first = new ScriptedTerminal(["\r"]);
  assertEquals(
    await selectPrompt({
      message: "Choose",
      options: groups,
      default: "beta",
    }, scriptedRuntime(first)),
    "beta",
  );
  assertStringIncludes(first.writes.join(""), "First group");
  assertStringIncludes(first.writes.join(""), "Second group");

  const reordered = new ScriptedTerminal(["\r"]);
  assertEquals(
    await selectPrompt({
      message: "Choose",
      options: groupedSelectOptions([
        {
          id: "second",
          label: "Second group",
          items: [{ id: "beta", name: "Duplicate label", value: "beta" }],
        },
        {
          id: "first",
          label: "First group",
          items: [{ id: "alpha", name: "Duplicate label", value: "alpha" }],
        },
      ]),
      default: "beta",
    }, scriptedRuntime(reordered)),
    "beta",
  );
});

Deno.test("choice identity rejects duplicate values, ids, and implicit object ids", async () => {
  const cases: Array<
    readonly {
      readonly id?: string;
      readonly name: string;
      readonly value: unknown;
    }[]
  > = [
    [
      { name: "One", value: "same" },
      { name: "Two", value: "same" },
    ],
    [
      { id: "same", name: "One", value: "one" },
      { id: "same", name: "Two", value: "two" },
    ],
    [{ name: "Object", value: { id: "object" } }],
  ];
  for (const options of cases) {
    const io = new ScriptedTerminal(["\r"]);
    await assertRejects(
      () =>
        selectPrompt<unknown>(
          { message: "Choose", options },
          scriptedRuntime(io),
        ),
      TypeError,
    );
    assertEquals(io.rawTransitions, []);
  }
});

Deno.test("search preserves matching groups, order, identity, and returned value", async () => {
  const io = new ScriptedTerminal(["Beta", "\x1b[B", "\r"]);
  const value = await selectPrompt({
    message: "Browse",
    search: true,
    searchLabel: "filter",
    options: groupedSelectOptions([
      {
        id: "documents",
        label: "Documents",
        items: [
          { id: "alpha", name: "Alpha guide", value: "alpha" },
          { id: "beta", name: "Beta guide", value: "beta" },
        ],
      },
      {
        id: "browse",
        label: "Browse",
        items: [{ id: "quit", name: "Quit", value: "quit" }],
      },
    ]),
  }, scriptedRuntime(io));
  assertEquals(value, "beta");
  const transcript = io.writes.join("");
  assertStringIncludes(transcript, "Documents");
  assertStringIncludes(transcript, "Beta guide");
});

Deno.test("search rejects an initial selection the released API cannot restore", async () => {
  const io = new ScriptedTerminal(["\r"]);
  await assertRejects(
    () =>
      selectPrompt({
        message: "Browse",
        search: true,
        default: "alpha",
        options: [{ name: "Alpha", value: "alpha" }],
      }, scriptedRuntime(io)),
    TypeError,
    "cannot restore an initial selection",
  );
  assertEquals(io.rawTransitions, []);
});

Deno.test("unknown single- and multi-select defaults fail before raw mode", async () => {
  const single = new ScriptedTerminal(["\r"]);
  await assertRejects(
    () =>
      selectPrompt({
        message: "Choose",
        default: "missing",
        options: [{ name: "Present", value: "present" }],
      }, scriptedRuntime(single)),
    TypeError,
    "does not name a prompt choice",
  );
  assertEquals(single.rawTransitions, []);

  const multiple = new ScriptedTerminal(["\r"]);
  await assertRejects(
    () =>
      checkboxPrompt({
        message: "Choose",
        default: ["missing"],
        options: [{ name: "Present", value: "present" }],
      }, scriptedRuntime(multiple)),
    TypeError,
    "does not name a prompt choice",
  );
  assertEquals(multiple.rawTransitions, []);
});

Deno.test("component text is inert while submitted values remain exact", async () => {
  const rawValue = "\x1b[31mvalue";
  const io = new ScriptedTerminal(["\r"]);
  assertEquals(
    await selectPrompt({
      message: "Choose\x1bmessage",
      hint: "Hint\nnext",
      options: groupedSelectOptions([{
        id: "hostile-group",
        label: "Group\tname",
        items: [{
          id: "hostile-choice",
          name: "Choice\rname",
          value: rawValue,
        }],
      }]),
    }, scriptedRuntime(io)),
    rawValue,
  );
  const transcript = io.writes.join("");
  for (
    const visible of [
      "Choose␛message",
      "Hint␊next",
      "Group␉name",
      "Choice␍name",
    ]
  ) {
    assertStringIncludes(transcript, visible);
  }

  const text = new ScriptedTerminal([
    "bad\r",
    "\x7f\x7f\x7f",
    "good\r",
  ]);
  assertEquals(
    await inputPrompt({
      message: "Value\tlabel",
      hint: "Use\rletters",
      placeholder: "Type\nhere",
      validate: (value) => value === "good" || "Wrong\x1bvalue",
    }, scriptedRuntime(text)),
    "good",
  );
  const textTranscript = text.writes.join("");
  for (
    const visible of [
      "Value␉label",
      "Use␍letters",
      "Type␊here",
      "Wrong␛value",
    ]
  ) {
    assertStringIncludes(textTranscript, visible);
  }
});

Deno.test("multiselect composes minimum and caller validation in source order", async () => {
  const io = new ScriptedTerminal([
    "\r",
    " ",
    "\r",
    "\x1b[B",
    " ",
    "\r",
  ]);
  const values = await checkboxPrompt({
    message: "Choose",
    options: [
      { id: "alpha", name: "Alpha", value: "alpha" },
      { id: "beta", name: "Beta", value: "beta" },
    ],
    minOptions: 1,
    validate: (selected) =>
      selected.includes("beta") || "Beta is required for this test.",
  }, scriptedRuntime(io));
  assertEquals(values, ["alpha", "beta"]);
  const transcript = io.writes.join("");
  assertStringIncludes(transcript, "Select at least 1 option.");
  assertStringIncludes(transcript, "Beta is required for this test.");
});

Deno.test("text validation stays distinct from normalized Ctrl-C and EOF cancellation", async () => {
  const validation = new ScriptedTerminal([
    "bad\r",
    "\x7f\x7f\x7f",
    "good\r",
  ]);
  assertEquals(
    await inputPrompt({
      message: "Value",
      validate: (value) => value === "good" || "Enter good.",
    }, scriptedRuntime(validation)),
    "good",
  );
  assertStringIncludes(validation.writes.join(""), "Enter good.");

  for (const chunks of [["\x03"], []] as const) {
    const cancelled = new ScriptedTerminal(chunks);
    const error = await (async (): Promise<unknown> => {
      try {
        await inputPrompt("Value", scriptedRuntime(cancelled));
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    assertEquals(isPromptCancellation(error), true);
    assertEquals(cancelled.rawTransitions, [true, false]);
    assertEquals(cancelled.writes[0], "\n");
  }
});

// ---- promptAllowed: no interactive prompt is reachable under --json (B53) ---
//
// The class: a blocking interactive prompt reachable while `--json` is the output
// contract — it would render to stdout and hang a machine caller that holds a
// TTY. The cure forbids prompting in json mode BEFORE the TTY check, at the one
// choke `confirmProceed` routes through. The interactive gate is injected here
// as "a TTY is present" (`() => true`) so the json veto is proven independent of
// the test process's own (absent) terminal — pre-fix, json was ignored and this
// returned true.

Deno.test("promptAllowed forbids prompting under --json even with a TTY present", () => {
  const ttyPresent = (_yes: boolean): boolean => true;
  // json wins regardless of --yes or the interactive gate: never prompt.
  assertEquals(promptAllowed(false, true, ttyPresent), false);
  assertEquals(promptAllowed(true, true, ttyPresent), false);
});

Deno.test("promptAllowed defers to the interactive gate when not --json", () => {
  const ttyPresent = (_yes: boolean): boolean => true;
  const noTty = (_yes: boolean): boolean => false;
  // Outside json mode the ordinary interactive decision stands.
  assertEquals(promptAllowed(false, false, ttyPresent), true);
  assertEquals(promptAllowed(false, false, noTty), false);
});

// ---- resolveSetupConfig (prompts suppressed via flags.yes) ------------------

Deno.test("resolveSetupConfig warns on an unknown agent, drops it, keeps the known one", async () => {
  await captureStderr(async (lines) => {
    const config = await resolveSetupConfig(
      { yes: true, agents: "bogus,claude_code" },
      logger(),
    );
    // The unknown name is dropped; the known one is kept.
    assertEquals(config.agents, ["claude_code"]);
    // A warning naming the unknown agent was emitted to stderr.
    const warning = lines.find((l) => l.includes("ignoring unknown agent"));
    assertExists(
      warning,
      `expected an unknown-agent warning; saw: ${JSON.stringify(lines)}`,
    );
    assertStringIncludes(warning, "bogus");
  });
});

Deno.test("resolveSetupConfig falls back to default agents when all names are garbage", async () => {
  await captureStderr(async (lines) => {
    const config = await resolveSetupConfig(
      { yes: true, agents: "nope, , also-nope" },
      logger(),
    );
    // No valid agent survived parsing → the default set is used.
    assertEquals(config.agents, [...DEFAULTS.agents]);
    // The unknown names are still reported.
    assertEquals(
      lines.some((l) => l.includes("ignoring unknown agent")),
      true,
    );
  });
});

Deno.test("resolveSetupConfig keeps a valid agents flag without warning", async () => {
  await captureStderr(async (lines) => {
    const config = await resolveSetupConfig(
      { yes: true, agents: "codex" },
      logger(),
    );
    assertEquals(config.agents, ["codex"]);
    // No unknowns → no warning line.
    assertEquals(
      lines.some((l) => l.includes("ignoring unknown agent")),
      false,
    );
  });
});

Deno.test("resolveSetupConfig falls back to default source globs when the flag parses to empty", async () => {
  const config = await resolveSetupConfig(
    { yes: true, sourceGlobs: " , ,, " },
    logger(),
  );
  // A flag that splits to nothing → defaults, not an empty array.
  assertEquals(config.sourceGlobs, [...DEFAULTS.sourceGlobs]);
});

Deno.test("resolveSetupConfig honours explicit base flags non-interactively", async () => {
  const config = await resolveSetupConfig(
    {
      yes: true,
      name: "My Project",
      slug: "my-proj",
      branchPrefix: "wt/",
      sourceGlobs: "lib/**, pkg/**",
      brief: "a literal brief",
    },
    logger(),
  );
  assertEquals(config.slug, "my-proj");
  assertEquals(config.branchPrefix, "wt/");
  assertEquals(config.sourceGlobs, ["lib/**", "pkg/**"]);
  assertEquals(config.brief, "a literal brief");
  // No agents flag → the default set, with prompts suppressed.
  assertEquals(config.agents, [...DEFAULTS.agents]);
});

Deno.test("resolveSetupConfig resolves a @path brief flag non-interactively", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "b.md");
    await Deno.writeTextFile(path, "briefed from file");
    const config = await resolveSetupConfig(
      { yes: true, brief: `@${path}` },
      logger(),
    );
    assertEquals(config.brief, "briefed from file");
  });
});

Deno.test("resolveSetupConfig rejects an invalid explicit --slug", async () => {
  // An explicit bad slug is an error (no silent coercion of a chosen value).
  await assertRejects(
    () => resolveSetupConfig({ yes: true, slug: "Bad Slug!" }, logger()),
    Error,
    'invalid --slug "Bad Slug!"',
  );
});

Deno.test("resolveSetupConfig empty branch-prefix flag falls back to the default", async () => {
  const config = await resolveSetupConfig(
    { yes: true, branchPrefix: "   " },
    logger(),
  );
  // A whitespace-only branch prefix trims to "" → the default applies.
  assertEquals(config.branchPrefix, DEFAULTS.branchPrefix);
});
