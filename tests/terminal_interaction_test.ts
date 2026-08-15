/**
 * Product-policy and deterministic package-adapter tests for terminal interaction.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  measureText,
  stripAnsi,
  type TerminalCapabilities,
} from "discern-design-system/cli";
import type {
  TerminalIO,
  TerminalSize,
} from "discern-design-system/cli/interactive";
import {
  canInteract,
  confirmationAllowed,
  confirmDestructiveAction,
  confirmDialogAction,
  groupedSelectionEntries,
  interactionAllowed,
  isInteractionCancelled,
  renderConfirmationDialog,
  renderDestructiveConfirmation,
  requestSelection,
  requestSelections,
  requestText,
  resolveBrief,
  resolveSetupConfig,
  setJsonMode,
  setPlainMode,
} from "../src/lib/terminal_interaction.ts";
import { DEFAULTS } from "../src/lib/config.ts";
import { Logger } from "../src/lib/log.ts";
import {
  resolveTerminalContext,
  type TerminalContext,
} from "../src/lib/terminal.ts";
import { fakeEnv, pinnedTerminal, withTempDir } from "./helpers.ts";

const encoder = new TextEncoder();

/** Widest visible row in one package-painted terminal write. */
function widestTerminalLine(value: string): number {
  return Math.max(
    ...stripAnsi(value).split("\n").map((line) => measureText(line)),
  );
}

/** Scripted package terminal that still runs the production request wrappers. */
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

/** A real, colourless, non-JSON logger as the wizard receives one, with a
 * pinned terminal context so nothing floats with the ambient locale. */
function logger(): Logger {
  return new Logger({ json: false, noColor: true, terminal: pinnedTerminal() });
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

// ---- canInteract -------------------------------------------------------------

Deno.test("canInteract(true) is false — --yes suppresses interaction", () => {
  // `--yes` short-circuits before any TTY check, so this holds in CI too.
  assertEquals(canInteract(true), false);
});

Deno.test("interaction policy independently honors every veto", () => {
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
      requestSelection({
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
        requestSelection({
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
        requestSelection({
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
  const groups = groupedSelectionEntries([
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
    await requestSelection({
      message: "Choose",
      options: groups,
      default: "beta",
    }, scriptedRuntime(first)),
    "beta",
  );
  assertStringIncludes(first.writes.join(""), "FIRST GROUP");
  assertStringIncludes(first.writes.join(""), "SECOND GROUP");

  const reordered = new ScriptedTerminal(["\r"]);
  assertEquals(
    await requestSelection({
      message: "Choose",
      options: groupedSelectionEntries([
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

Deno.test("the shared choice adapter preserves wide frames and group breathing rows", async () => {
  const columns = 96;
  const io = new ScriptedTerminal(
    ["\r"],
    { colorDepth: "none", columns, unicode: true },
    { columns, rows: 24 },
  );
  assertEquals(
    await requestSelection({
      message: "Choose",
      options: groupedSelectionEntries([
        {
          id: "primary",
          label: "Primary",
          items: [{ name: "Alpha", value: "alpha" }],
        },
        {
          id: "secondary",
          label: "Secondary",
          items: [{ name: "Beta", value: "beta" }],
        },
      ]),
    }, scriptedRuntime(io)),
    "alpha",
  );

  const active = io.writes.find((write) => write.includes("Choose [active]"));
  assertExists(active);
  assertEquals(widestTerminalLine(active), columns);
  const rows = stripAnsi(active).split("\n");
  const blank = `│${" ".repeat(columns - 2)}│`;
  for (const heading of ["PRIMARY", "SECONDARY"]) {
    const index = rows.findIndex((row) => row.includes(heading));
    assert(index > 0, `missing ${heading} heading`);
    assertEquals(rows[index - 1], blank);
  }
});

Deno.test("the shared choice adapter discloses choices below its visible window", async () => {
  const io = new ScriptedTerminal(["\r"]);
  assertEquals(
    await requestSelection({
      message: "Choose",
      options: Array.from({ length: 5 }, (_, index) => ({
        name: `Choice ${index + 1}`,
        value: index,
      })),
      maxRows: 2,
    }, scriptedRuntime(io)),
    0,
  );
  const active = io.writes.find((write) => write.includes("Choose [active]"));
  assertExists(active);
  assertStringIncludes(stripAnsi(active), "↓ 3 more");
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
        requestSelection<unknown>(
          { message: "Choose", options },
          scriptedRuntime(io),
        ),
      TypeError,
    );
    assertEquals(io.rawTransitions, []);
  }
});

Deno.test("single-select rejects nullish values that collide with no-selection", async () => {
  for (const value of [null, undefined]) {
    const io = new ScriptedTerminal(["\r"]);
    await assertRejects(
      () =>
        requestSelection<unknown>({
          message: "Choose",
          options: [{ id: "nullish", name: "Nullish", value }],
        }, scriptedRuntime(io)),
      TypeError,
      "cannot use null or undefined",
    );
    assertEquals(io.rawTransitions, []);
  }

  const multiple = new ScriptedTerminal(["\r"]);
  assertEquals(
    await requestSelections<null>({
      message: "Choose",
      options: [{ id: "null", name: "Null", value: null, checked: true }],
    }, scriptedRuntime(multiple)),
    [null],
  );
});

Deno.test("search preserves matching groups, order, identity, and returned value", async () => {
  const io = new ScriptedTerminal(["Beta", "\x1b[B", "\r"]);
  const value = await requestSelection({
    message: "Browse",
    search: true,
    searchLabel: "filter",
    options: groupedSelectionEntries([
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
  assertStringIncludes(transcript, "DOCUMENTS");
  assertStringIncludes(transcript, "Beta guide");
});

Deno.test("search restores a stable initial choice through duplicate labels", async () => {
  const io = new ScriptedTerminal(["\r"]);
  assertEquals(
    await requestSelection({
      message: "Browse",
      search: true,
      default: "beta",
      options: groupedSelectionEntries([
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
      ]),
    }, scriptedRuntime(io)),
    "beta",
  );
  assertEquals(io.rawTransitions, [true, false]);
});

/** Twenty zero-padded choices, so window edges are visible as exact labels. */
function manyChoices(): { name: string; value: string }[] {
  return Array.from({ length: 20 }, (_, index) => ({
    name: `Choice ${String(index).padStart(2, "0")}`,
    value: `choice-${index}`,
  }));
}

Deno.test("a tall terminal fills the choice window instead of the package default", async () => {
  const io = new ScriptedTerminal(["\r"], undefined, { columns: 60, rows: 40 });
  const value = await requestSelection({
    message: "Choose",
    options: manyChoices(),
  }, scriptedRuntime(io));
  assertEquals(value, "choice-0");
  const transcript = io.writes.join("");
  assertStringIncludes(transcript, "Choice 00");
  assertStringIncludes(transcript, "Choice 19");
});

Deno.test("every choice request fits its complete frame below reserved rows", async () => {
  const selectIo = new ScriptedTerminal(["\r"], undefined, {
    columns: 60,
    rows: 40,
  });
  const searchIo = new ScriptedTerminal(["\r"], undefined, {
    columns: 60,
    rows: 40,
  });
  const selectionsIo = new ScriptedTerminal(["\r"], undefined, {
    columns: 60,
    rows: 40,
  });
  await requestSelection({
    message: "Choose",
    options: manyChoices(),
    reservedRows: 30,
  }, scriptedRuntime(selectIo));
  await requestSelection({
    message: "Search",
    options: manyChoices(),
    search: true,
    default: "choice-0",
    reservedRows: 30,
  }, scriptedRuntime(searchIo));
  await requestSelections({
    message: "Choose several",
    options: manyChoices(),
    reservedRows: 30,
  }, scriptedRuntime(selectionsIo));
  for (const io of [selectIo, searchIo, selectionsIo]) {
    for (const write of io.writes) {
      assertEquals(
        write.split("\n").length <= 10,
        true,
        `the package must fit the complete frame below the 30-row reservation:\n${write}`,
      );
    }
  }
});

Deno.test("maxRows stays a hard ceiling below the derived budget", async () => {
  const io = new ScriptedTerminal(["\r"], undefined, { columns: 60, rows: 40 });
  await requestSelection({
    message: "Choose",
    options: manyChoices(),
    maxRows: 3,
  }, scriptedRuntime(io));
  const transcript = io.writes.join("");
  assertStringIncludes(transcript, "Choice 02");
  assertEquals(transcript.includes("Choice 03"), false);
});

Deno.test("over-reserved compositions use the package's coherent-frame refusal", async () => {
  const io = new ScriptedTerminal(["\r"], undefined, { columns: 60, rows: 40 });
  await assertRejects(
    () =>
      requestSelection({
        message: "Choose",
        options: manyChoices(),
        reservedRows: 90,
      }, scriptedRuntime(io)),
    TypeError,
    "cannot hold a coherent interaction frame",
  );
  assertEquals(io.rawTransitions, [true, false]);
});

Deno.test("a short terminal degrades through package fitting, never overflowing", async () => {
  const io = new ScriptedTerminal(["\r"], undefined, { columns: 60, rows: 8 });
  const value = await requestSelection({
    message: "Choose",
    options: manyChoices(),
    hint: "Use the arrow keys to move and Enter to choose.",
  }, scriptedRuntime(io));
  assertEquals(value, "choice-0");
  for (const write of io.writes) {
    // Control sequences carry no newlines, so the raw newline count is the
    // painted row count without any stripping.
    assertEquals(
      write.split("\n").length <= 8,
      true,
      `a painted frame must fit the 8-row terminal:\n${JSON.stringify(write)}`,
    );
  }
});

Deno.test("the interaction trace records sizing evidence only when enabled", async () => {
  await withTempDir(async (dir) => {
    const tracePath = join(dir, "interaction-trace.jsonl");
    const tracingEnv = {
      get: (name: string) =>
        name === "DISCERN_INTERACTION_TRACE" ? tracePath : undefined,
    };
    await requestSelection(
      {
        message: "Choose",
        options: manyChoices(),
        reservedRows: 30,
      },
      {
        ...scriptedRuntime(
          new ScriptedTerminal(["\r"], undefined, { columns: 60, rows: 40 }),
        ),
        env: tracingEnv,
      },
    );
    const lines = (await Deno.readTextFile(tracePath)).trim().split("\n");
    assertEquals(lines.length, 1);
    const record = JSON.parse(lines[0] ?? "") as {
      opened: { rows: number };
      budget?: { rows: number; reserved: number; derived: number };
      sizeRows: number[];
      writes: { lines: number }[];
      outcome: string;
    };
    assertEquals(record.opened.rows, 40);
    assertEquals(record.budget, { rows: 40, reserved: 30, derived: 39 });
    assertEquals(record.sizeRows.length > 0, true);
    assertEquals(record.writes.length > 0, true);
    assertEquals(record.outcome, "value");

    const silent = new ScriptedTerminal(["\r"], undefined, {
      columns: 60,
      rows: 40,
    });
    await requestSelection({
      message: "Choose",
      options: manyChoices(),
    }, {
      ...scriptedRuntime(silent),
      env: { get: () => undefined },
    });
    assertEquals(
      (await Deno.readTextFile(tracePath)).trim().split("\n").length,
      1,
      "tracing must stay inert without the variable",
    );
  });
});

Deno.test("unknown select, search, and multi-select defaults fail before raw mode", async () => {
  const single = new ScriptedTerminal(["\r"]);
  await assertRejects(
    () =>
      requestSelection({
        message: "Choose",
        default: "missing",
        options: [{ name: "Present", value: "present" }],
      }, scriptedRuntime(single)),
    TypeError,
    "does not name a selection choice",
  );
  assertEquals(single.rawTransitions, []);

  const search = new ScriptedTerminal(["\r"]);
  await assertRejects(
    () =>
      requestSelection({
        message: "Search",
        search: true,
        default: "missing",
        options: [{ name: "Present", value: "present" }],
      }, scriptedRuntime(search)),
    TypeError,
    "does not name a selection choice",
  );
  assertEquals(search.rawTransitions, []);

  const multiple = new ScriptedTerminal(["\r"]);
  await assertRejects(
    () =>
      requestSelections({
        message: "Choose",
        default: ["missing"],
        options: [{ name: "Present", value: "present" }],
      }, scriptedRuntime(multiple)),
    TypeError,
    "does not name a selection choice",
  );
  assertEquals(multiple.rawTransitions, []);
});

Deno.test("component text is inert while submitted values remain exact", async () => {
  const rawValue = "\x1b[31mvalue";
  const io = new ScriptedTerminal(["\r"]);
  assertEquals(
    await requestSelection({
      message: "Choose\x1bmessage",
      hint: "Hint\nnext",
      options: groupedSelectionEntries([{
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
      "GROUP␉NAME",
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
    await requestText({
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
  const values = await requestSelections({
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
    await requestText({
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
        await requestText("Value", scriptedRuntime(cancelled));
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    assertEquals(isInteractionCancelled(error), true);
    assertEquals(cancelled.rawTransitions, [true, false]);
    assertEquals(cancelled.writes[0], "\n");
  }
});

Deno.test("text transforms before required validation and returns the canonical value", async () => {
  const observed: string[] = [];
  const io = new ScriptedTerminal([
    "   \r",
    "\x7f\x7f\x7f",
    "  MiXeD  \r",
  ]);
  assertEquals(
    await requestText({
      message: "Value",
      required: "Enter a value.",
      transform: (value) => value.trim().toLowerCase(),
      validate: (value) => {
        observed.push(value);
        return value === "mixed" || "Enter mixed.";
      },
    }, scriptedRuntime(io)),
    "mixed",
  );
  assert(
    observed.every((value) => value === value.trim().toLowerCase()),
    "required and caller validation should see only canonical values",
  );
  assertEquals(observed.at(-1), "mixed");
  assertStringIncludes(io.writes.join(""), "Enter a value.");
});

Deno.test("an unexpected in-frame error restores and terminates the interaction", async () => {
  const io = new ScriptedTerminal(["\r"]);
  const failure = new Error("synthetic validator fault");
  await assertRejects(
    () =>
      requestText({
        message: "Value",
        validate: () => {
          throw failure;
        },
      }, scriptedRuntime(io)),
    Error,
    failure.message,
  );
  assertEquals(io.rawTransitions, [true, false]);
  assertEquals(
    io.writes.at(-1),
    "\n",
    "the restored cursor must be followed by a semantic frame terminator",
  );
});

// ---- confirmationAllowed: no interaction is reachable under --json (B53) ---
//
// The class: blocking terminal input reachable while `--json` is the output
// contract — it would render to stdout and hang a machine caller that holds a
// TTY. The cure forbids interaction in JSON mode BEFORE the TTY check, at the one
// choke `confirmProceed` routes through. The interactive gate is injected here
// as "a TTY is present" (`() => true`) so the json veto is proven independent of
// the test process's own (absent) terminal — pre-fix, json was ignored and this
// returned true.

Deno.test("confirmationAllowed forbids interaction under --json even with a TTY present", () => {
  const ttyPresent = (_yes: boolean): boolean => true;
  // JSON wins regardless of --yes or the interactive gate.
  assertEquals(confirmationAllowed(false, true, ttyPresent), false);
  assertEquals(confirmationAllowed(true, true, ttyPresent), false);
});

Deno.test("confirmationAllowed defers to the interactive gate when not --json", () => {
  const ttyPresent = (_yes: boolean): boolean => true;
  const noTty = (_yes: boolean): boolean => false;
  // Outside json mode the ordinary interactive decision stands.
  assertEquals(confirmationAllowed(false, false, ttyPresent), true);
  assertEquals(confirmationAllowed(false, false, noTty), false);
});

const DESTRUCTIVE_COPY = {
  label: "Remove generated wiring",
  scope: "/tmp/project",
  impact: "Generated integration files are removed.",
  recovery: "Restore committed files with Git.",
  authority: "Project owner",
  continuation: "Continue with removal?",
} as const;

/** Stable colourless terminal facts for destructive-review rendering. */
function confirmationTerminal(): TerminalContext {
  return resolveTerminalContext({
    noColor: true,
    env: fakeEnv({ TERM: "xterm-256color", LANG: "en_GB.UTF-8" }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: 72, rows: 24 }),
  });
}

Deno.test("destructive confirmation renders the package's semantic facts", () => {
  assertEquals(
    renderDestructiveConfirmation(DESTRUCTIVE_COPY, confirmationTerminal()),
    [
      "DANGER: Remove generated wiring",
      "Scope: /tmp/project",
      "Impact: Generated integration files are removed.",
      "Authority: Project owner",
      "Recovery: Restore committed files with Git.",
    ].join("\n"),
  );
});

Deno.test("destructive confirmation presents only on the interactive human path", async () => {
  const presented: string[] = [];
  const requests: string[] = [];
  const options = {
    yes: false,
    json: false,
    terminal: confirmationTerminal(),
    present: (frame: string): void => {
      presented.push(frame);
    },
  };
  const request = (message: string, defaultTo: boolean): Promise<boolean> => {
    requests.push(`${message}:${defaultTo}`);
    return Promise.resolve(false);
  };

  assertEquals(
    await confirmDestructiveAction(DESTRUCTIVE_COPY, options, {
      interactive: () => false,
      request,
    }),
    true,
  );
  assertEquals(presented, []);
  assertEquals(requests, []);

  assertEquals(
    await confirmDestructiveAction(DESTRUCTIVE_COPY, options, {
      interactive: () => true,
      request,
    }),
    false,
  );
  assertEquals(presented.length, 1);
  assertStringIncludes(presented[0] ?? "", "Scope: /tmp/project");
  assertEquals(requests, ["Continue with removal?:true"]);
});

const DIALOG_COPY = {
  label: "Overlay preset example?",
  scope: "/tmp/project",
  consequence:
    "Two missing files will be created. Existing files stay unchanged.",
  continuation: "Overlay the preset now?",
} as const;

Deno.test("neutral confirmation renders and requests the same bounded act", async () => {
  const rendered = renderConfirmationDialog(
    DIALOG_COPY,
    confirmationTerminal(),
  );
  assertStringIncludes(rendered, "Confirm");
  assertStringIncludes(rendered, DIALOG_COPY.label);
  assertStringIncludes(rendered, "Scope: /tmp/project");
  assertStringIncludes(rendered, "Consequence: Two missing files");
  assertStringIncludes(rendered, "[Cancel]  [Continue]");

  const presented: string[] = [];
  const requests: string[] = [];
  assertEquals(
    await confirmDialogAction(
      DIALOG_COPY,
      {
        yes: false,
        json: false,
        terminal: confirmationTerminal(),
        present: (frame: string): void => {
          presented.push(frame);
        },
      },
      {
        interactive: () => true,
        request: (message, defaultTo) => {
          requests.push(`${message}:${defaultTo}`);
          return Promise.resolve(true);
        },
      },
    ),
    true,
  );
  assertEquals(presented.length, 1);
  assertEquals(requests, ["Overlay the preset now?:true"]);
});

// ---- resolveSetupConfig (interaction suppressed via flags.yes) --------------

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
  // No agents flag → the default set, with interaction suppressed.
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
