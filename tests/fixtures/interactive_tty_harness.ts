/**
 * Production-wrapper child for real-terminal request integration tests.
 *
 * Decoration stays on the PTY. The submitted value and lifecycle evidence are
 * written to the separate result path supplied by the parent test.
 */

import {
  requestSelections,
  requestConfirmation,
  groupedSelectionEntries,
  requestText,
  isInteractionCancelled,
  requestSelection,
  withInteractionBoundary,
} from "../../src/lib/terminal_interaction.ts";
import {
  DenoTerminalIO,
  requestTextarea,
  type TerminalIO,
} from "discern-design-system/cli/interactive";
import {
  setTerminalContext,
  terminalProcessContext,
} from "../../src/lib/terminal.ts";
import { realDelay } from "../waiting.ts";

export type InteractiveTtyScenario =
  | "text"
  | "text-default"
  | "confirm-default-no"
  | "select"
  | "select-default"
  | "grouped-select"
  | "search"
  | "search-default"
  | "repeated-viewport"
  | "composed-viewport-cycles"
  | "textarea-tall"
  | "multiselect"
  | "multiselect-default"
  | "validation"
  | "error"
  | "cancellation";

export const INTERACTIVE_TTY_REQUEST_LABELS = {
  text: ["Edit a Unicode value"],
  "text-default": ["Keep or edit the default"],
  "confirm-default-no": ["Reclaim the contained checkout?"],
  select: ["Choose a value"],
  "select-default": ["Choose the remembered value"],
  "grouped-select": ["Choose from semantic groups"],
  search: ["Filter grouped documents"],
  "search-default": ["Restore a remembered searchable document"],
  "repeated-viewport": [
    "Choose a desk action",
    "Browse docs",
    "Choose a desk action again",
  ],
  "composed-viewport-cycles": [
    "Choose a task or action",
    "Choose an action",
  ],
  "textarea-tall": ["Edit tall notes"],
  multiselect: ["Choose at least two values"],
  "multiselect-default": ["Keep the selected values"],
  validation: ["Type valid"],
  error: ["Trigger an unexpected validator fault"],
  cancellation: ["Cancel this question"],
} as const satisfies Readonly<
  Record<InteractiveTtyScenario, readonly [string, ...string[]]>
>;

interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface InteractiveTtyResult {
  readonly scenario: InteractiveTtyScenario;
  readonly outcome: "value" | "cancelled" | "error";
  readonly value?: unknown;
  readonly error?: { readonly name: string; readonly message: string };
  readonly terminal: {
    readonly before: string;
    readonly after: string;
    readonly beforeDescription: string;
    readonly afterDescription: string;
    readonly restored: boolean;
    readonly exactStateRestored: boolean;
    readonly initialSize: TerminalDimensions;
    readonly resizedSize?: TerminalDimensions;
    readonly finalSize: TerminalDimensions;
  };
}

export const POST_INTERACTION_DIAGNOSTIC =
  "Harness diagnostic begins after the restored interaction frame.";

interface HarnessOptions {
  readonly scenario: InteractiveTtyScenario;
  readonly resultPath: string;
  readonly noColor: boolean;
  readonly initialSize?: TerminalDimensions;
  readonly resize?: TerminalDimensions & { readonly delayMs: number };
  readonly interactionStartDelayMs?: number;
  /** Make a literal VEOF produce a zero-byte PTY read while output stays open. */
  readonly canonicalEof: boolean;
}

interface CanonicalEofBoundary {
  readonly io: TerminalIO;
  readonly firstReadRequested: Promise<void>;
  readonly allowCanonicalRead: () => void;
}

const LONG_ALPHA =
  "Alpha with a deliberately long label that becomes complete after resize";

function argument(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}

function dimensions(value: string | undefined): TerminalDimensions | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/u.exec(value);
  if (match === null) throw new TypeError(`invalid terminal size ${value}`);
  return { columns: Number(match[1]), rows: Number(match[2]) };
}

function parseOptions(args: readonly string[]): HarnessOptions {
  const scenario = argument(args, "--scenario") as
    | InteractiveTtyScenario
    | undefined;
  const resultPath = argument(args, "--result");
  if (scenario === undefined || resultPath === undefined) {
    throw new TypeError("--scenario and --result are required");
  }
  const initialSize = dimensions(argument(args, "--size"));
  const resizeSize = dimensions(argument(args, "--resize"));
  const resizeDelay = Number(argument(args, "--resize-after") ?? "100");
  const interactionStartDelay = argument(args, "--interaction-start-delay");
  return {
    scenario,
    resultPath,
    noColor: args.includes("--no-color"),
    ...(initialSize === undefined ? {} : { initialSize }),
    ...(resizeSize === undefined
      ? {}
      : { resize: { ...resizeSize, delayMs: resizeDelay } }),
    ...(interactionStartDelay === undefined
      ? {}
      : { interactionStartDelayMs: Number(interactionStartDelay) }),
    canonicalEof: args.includes("--canonical-eof"),
  };
}

/** Hold the first terminal read until the harness has made it canonical. */
function canonicalEofBoundary(): CanonicalEofBoundary {
  const target = new DenoTerminalIO({});
  let resolveReadRequest: (() => void) | undefined;
  const firstReadRequested = new Promise<void>((resolve) => {
    resolveReadRequest = resolve;
  });
  let resolveCanonicalRead: (() => void) | undefined;
  const canonicalReadAllowed = new Promise<void>((resolve) => {
    resolveCanonicalRead = resolve;
  });
  let firstRead = true;
  const io: TerminalIO = {
    isInteractive: () => target.isInteractive(),
    capabilities: () => target.capabilities(),
    size: () => target.size(),
    read: async (): Promise<Uint8Array | null> => {
      if (firstRead) {
        firstRead = false;
        resolveReadRequest?.();
        await canonicalReadAllowed;
      }
      return await target.read();
    },
    setRawMode: (enabled) => target.setRawMode(enabled),
    write: (value) => target.write(value),
  };
  return {
    io,
    firstReadRequested,
    allowCanonicalRead: () => resolveCanonicalRead?.(),
  };
}

async function stty(args: readonly string[]): Promise<string> {
  const output = await new Deno.Command("stty", {
    args: [...args],
    stdin: "inherit",
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(new TextDecoder().decode(output.stderr).trim());
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function setSize(size: TerminalDimensions): Promise<void> {
  await stty(["cols", String(size.columns), "rows", String(size.rows)]);
}

function consoleSize(): TerminalDimensions {
  const size = Deno.consoleSize();
  return { columns: size.columns, rows: size.rows };
}

/** Whether canonical, echoing, signal-aware output mode matches before/after. */
function lineModeRestored(before: string, after: string): boolean {
  const enabled = (description: string, name: string): boolean =>
    description.split(/\s+/u).includes(name);
  return ["icanon", "echo", "isig", "iexten", "opost"].every((name) =>
    enabled(before, name) === enabled(after, name) && enabled(after, name)
  );
}

async function runScenario(
  scenario: InteractiveTtyScenario,
  io?: TerminalIO,
): Promise<unknown> {
  switch (scenario) {
    case "text":
      return await requestText({
        message: INTERACTIVE_TTY_REQUEST_LABELS.text[0],
        hint: "Cursor movement and deletion preserve graphemes.",
      });
    case "text-default":
      return await requestText({
        message: INTERACTIVE_TTY_REQUEST_LABELS["text-default"][0],
        default: "remembered-value",
      });
    case "confirm-default-no":
      return await requestConfirmation(
        INTERACTIVE_TTY_REQUEST_LABELS["confirm-default-no"][0],
        {
          defaultTo: false,
          noLabel: "Keep",
          yesLabel: "Reclaim",
        },
      );
    case "select":
      return await requestSelection({
        message: INTERACTIVE_TTY_REQUEST_LABELS.select[0],
        options: [
          { id: "alpha", name: "Alpha", value: "alpha" },
          { id: "beta", name: "Beta", value: "beta" },
          { id: "omega", name: "Omega", value: "omega" },
        ],
      });
    case "select-default":
      return await requestSelection({
        message: INTERACTIVE_TTY_REQUEST_LABELS["select-default"][0],
        default: "beta",
        options: [
          { id: "alpha", name: "Alpha", value: "alpha" },
          { id: "beta", name: "Beta", value: "beta" },
          { id: "omega", name: "Omega", value: "omega" },
        ],
      });
    case "grouped-select":
      return await requestSelection({
        message: INTERACTIVE_TTY_REQUEST_LABELS["grouped-select"][0],
        maxRows: 4,
        options: groupedSelectionEntries([
          {
            id: "primary",
            label: "Primary",
            items: [
              { id: "alpha", name: LONG_ALPHA, value: "alpha" },
              {
                id: "disabled",
                name: "Duplicate label",
                value: "disabled",
                disabled: true,
              },
              { id: "beta", name: "Duplicate label", value: "beta" },
            ],
          },
          {
            id: "secondary",
            label: "Secondary",
            items: [
              { id: "gamma", name: "Gamma", value: "gamma" },
              { id: "delta", name: "Delta", value: "delta" },
            ],
          },
          {
            id: "navigation",
            label: "Navigation",
            items: [{ id: "quit", name: "Quit", value: "quit" }],
          },
        ]),
      });
    case "search":
      return await requestSelection({
        message: INTERACTIVE_TTY_REQUEST_LABELS.search[0],
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
            id: "navigation",
            label: "Navigation",
            items: [{ id: "quit", name: "Quit", value: "quit" }],
          },
        ]),
      });
    case "search-default":
      return await requestSelection({
        message: INTERACTIVE_TTY_REQUEST_LABELS["search-default"][0],
        search: true,
        default: "beta",
        options: groupedSelectionEntries([
          {
            id: "documents",
            label: "Documents",
            items: [
              { id: "alpha", name: "Duplicate guide", value: "alpha" },
              { id: "beta", name: "Duplicate guide", value: "beta" },
            ],
          },
        ]),
      });
    case "repeated-viewport": {
      const deskOptions = groupedSelectionEntries([{
        id: "desk-actions",
        label: "Desk",
        items: Array.from({ length: 24 }, (_, index) => ({
          id: `desk-${index}`,
          name: `Desk task ${index}`,
          value: `desk-${index}`,
        })),
      }]);
      const docsOptions = groupedSelectionEntries([{
        id: "documents",
        label: "Documents",
        items: Array.from({ length: 24 }, (_, index) => ({
          id: `doc-${index}`,
          name: `Document ${index}`,
          value: `doc-${index}`,
        })),
      }]);
      return [
        await requestSelection({
          message: INTERACTIVE_TTY_REQUEST_LABELS["repeated-viewport"][0],
          options: deskOptions,
          search: true,
          searchLabel: "filter",
          maxRows: 16,
        }),
        await requestSelection({
          message: INTERACTIVE_TTY_REQUEST_LABELS["repeated-viewport"][1],
          options: docsOptions,
          search: true,
          default: "doc-12",
          maxRows: 14,
        }),
        await requestSelection({
          message: INTERACTIVE_TTY_REQUEST_LABELS["repeated-viewport"][2],
          options: deskOptions,
          search: true,
          searchLabel: "filter",
          maxRows: 16,
        }),
      ];
    }
    case "composed-viewport-cycles": {
      // A board-shaped composition: each cycle clears the screen, paints a
      // header, opens a grouped board menu that reserves the header's rows,
      // then clears again for a preamble and a grouped action menu. The
      // parent test asserts every header stays reserved and every window's
      // painted height stays full and constant across cycles.
      const encoder = new TextEncoder();
      const raw = (value: string): void => {
        const bytes = encoder.encode(value);
        let offset = 0;
        while (offset < bytes.length) {
          offset += Deno.stdout.writeSync(bytes.subarray(offset));
        }
      };
      const boardOptions = groupedSelectionEntries([
        {
          id: "tasks",
          label: "Tasks · 6",
          items: Array.from({ length: 6 }, (_, index) => ({
            id: `task-${index}`,
            name: `task-${index}  ahead ${index} · clean`,
            value: `task-${index}`,
          })),
        },
        {
          id: "board-actions",
          label: "Board",
          items: [
            { id: "start", name: "Start a task", value: "start" },
            { id: "scripts", name: "Run a script", value: "scripts" },
            { id: "docs", name: "Read the docs", value: "docs" },
          ],
        },
        {
          id: "session-actions",
          label: "Session",
          items: [
            { id: "refresh", name: "Refresh", value: "refresh" },
            { id: "quit", name: "Quit", value: "quit" },
          ],
        },
      ]);
      const actionOptions = groupedSelectionEntries([
        {
          id: "work",
          label: "Work",
          items: [
            { id: "agent", name: "Open with an agent", value: "agent" },
            { id: "shell", name: "Open a shell", value: "shell" },
            { id: "gate", name: "Run the gate", value: "gate" },
          ],
        },
        {
          id: "landing",
          label: "Landing",
          items: [
            { id: "accept", name: "Accept onto main", value: "accept" },
            { id: "drop", name: "Drop this task", value: "drop" },
          ],
        },
        {
          id: "navigation",
          label: "Task",
          items: [{ id: "back", name: "Back", value: "back" }],
        },
      ]);
      const values: unknown[] = [];
      for (let cycle = 1; cycle <= 3; cycle += 1) {
        raw("\x1b[2J\x1b[H");
        raw(`board | cycle ${cycle}\n`);
        raw("  6 tasks  ·  main clean\n");
        raw("  ✦ Tip  A header line the board menu must keep visible.\n");
        raw("         Its continuation hangs under the tip label.\n");
        raw("\n");
        values.push(
          await requestSelection({
            message:
              INTERACTIVE_TTY_REQUEST_LABELS["composed-viewport-cycles"][0],
            options: boardOptions,
            hint: "Use the arrow keys to move and Enter to choose.",
            reservedRows: 6,
          }),
        );
        raw("\x1b[2J\x1b[H");
        raw("task-1\n");
        raw("  ahead 1 · clean\n");
        raw("  Branch agent/task-1\n");
        values.push(
          await requestSelection({
            message:
              INTERACTIVE_TTY_REQUEST_LABELS["composed-viewport-cycles"][1],
            options: actionOptions,
            hint: "Use the arrow keys to move and Enter to choose.",
            reservedRows: 4,
          }),
        );
      }
      return values;
    }
    case "textarea-tall": {
      const initialValue = Array.from(
        { length: 8 },
        (_, index) => `remembered line ${index + 1}`,
      ).join("\n");
      return await requestTextarea({
        label: INTERACTIVE_TTY_REQUEST_LABELS["textarea-tall"][0],
        initialValue,
        rows: 12,
      }, {
        io: withInteractionBoundary(new DenoTerminalIO({})),
      });
    }
    case "multiselect":
      return await requestSelections({
        message: INTERACTIVE_TTY_REQUEST_LABELS.multiselect[0],
        minOptions: 2,
        maxRows: 4,
        options: groupedSelectionEntries([
          {
            id: "values",
            label: "Values",
            items: [
              { id: "alpha", name: "Alpha", value: "alpha", checked: true },
              {
                id: "beta",
                name: "Beta disabled",
                value: "beta",
                disabled: true,
              },
              { id: "gamma", name: "Gamma", value: "gamma" },
              { id: "delta", name: "Delta", value: "delta" },
            ],
          },
        ]),
      });
    case "multiselect-default":
      return await requestSelections({
        message: INTERACTIVE_TTY_REQUEST_LABELS["multiselect-default"][0],
        minOptions: 2,
        default: ["gamma"],
        options: [
          { id: "alpha", name: "Alpha", value: "alpha", checked: true },
          { id: "gamma", name: "Gamma", value: "gamma" },
        ],
      });
    case "validation":
      return await requestText({
        message: INTERACTIVE_TTY_REQUEST_LABELS.validation[0],
        validate: (value) => value === "valid" || "Enter valid.",
      });
    case "error":
      return await requestText({
        message: INTERACTIVE_TTY_REQUEST_LABELS.error[0],
        validate: () => {
          throw new Error("synthetic validator fault");
        },
      });
    case "cancellation":
      return await requestText(
        INTERACTIVE_TTY_REQUEST_LABELS.cancellation[0],
        io === undefined ? {} : { io },
      );
  }
}

function errorRecord(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}

async function main(args: readonly string[]): Promise<void> {
  const options = parseOptions(args);
  if (options.initialSize !== undefined) await setSize(options.initialSize);
  const before = await stty(["-g"]);
  const beforeDescription = await stty(["-a"]);
  const initialSize = consoleSize();
  setTerminalContext(terminalProcessContext({ noColor: options.noColor }));
  const eofBoundary = options.canonicalEof
    ? canonicalEofBoundary()
    : undefined;

  let resizedSize: TerminalDimensions | undefined;
  const resize = options.resize === undefined
    ? undefined
    : (async (): Promise<void> => {
      await realDelay("interactive-tty-resize-delay", options.resize?.delayMs ?? 0);
      if (options.resize === undefined) return;
      await setSize(options.resize);
      resizedSize = consoleSize();
      console.log("[resize-ready]");
    })();
  const canonicalEof = eofBoundary === undefined
    ? undefined
    : (async (): Promise<void> => {
      await eofBoundary.firstReadRequested;
      // A PTY master cannot be half-closed while its transcript remains
      // readable. Canonical VEOF is the system-level equivalent: the next ^D
      // makes the production DenoTerminalIO read return end-of-input.
      await stty(["icanon"]);
      eofBoundary.allowCanonicalRead();
      console.log("[canonical-eof-ready]");
    })();

  let result: Omit<InteractiveTtyResult, "terminal">;
  try {
    if ((options.interactionStartDelayMs ?? 0) > 0) {
      await realDelay(
        "interactive-tty-start-delay",
        options.interactionStartDelayMs ?? 0,
      );
    }
    result = {
      scenario: options.scenario,
      outcome: "value",
      value: await runScenario(options.scenario, eofBoundary?.io),
    };
  } catch (error) {
    result = isInteractionCancelled(error)
      ? { scenario: options.scenario, outcome: "cancelled" }
      : {
        scenario: options.scenario,
        outcome: "error",
        error: errorRecord(error),
      };
    if (!isInteractionCancelled(error)) {
      console.error(POST_INTERACTION_DIAGNOSTIC);
    }
  }
  await resize;
  await canonicalEof;
  const after = await stty(["-g"]);
  const afterDescription = await stty(["-a"]);
  const final: InteractiveTtyResult = {
    ...result,
    terminal: {
      before,
      after,
      beforeDescription,
      afterDescription,
      restored: lineModeRestored(beforeDescription, afterDescription),
      exactStateRestored: before === after,
      initialSize,
      ...(resizedSize === undefined ? {} : { resizedSize }),
      finalSize: consoleSize(),
    },
  };
  await Deno.writeTextFile(
    options.resultPath,
    `${JSON.stringify(final, null, 2)}\n`,
  );
}

if (import.meta.main) {
  await main(Deno.args);
}
