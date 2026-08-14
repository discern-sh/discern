/**
 * Production-wrapper child for real-terminal prompt integration tests.
 *
 * Decoration stays on the PTY. The submitted value and lifecycle evidence are
 * written to the separate result path supplied by the parent test.
 */

import {
  checkboxPrompt,
  confirmationPrompt,
  groupedSelectOptions,
  inputPrompt,
  isPromptCancellation,
  selectPrompt,
  withPromptBoundary,
} from "../../src/lib/prompts.ts";
import {
  DenoTerminalIO,
  promptTextarea,
} from "discern-design-system/cli/interactive";
import {
  productionTerminalContext,
  setTerminalContext,
} from "../../src/lib/terminal.ts";

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
  | "textarea-tall"
  | "multiselect"
  | "multiselect-default"
  | "validation"
  | "error"
  | "cancellation";

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

export const POST_PROMPT_DIAGNOSTIC =
  "Harness diagnostic begins after the restored prompt frame.";

interface HarnessOptions {
  readonly scenario: InteractiveTtyScenario;
  readonly resultPath: string;
  readonly noColor: boolean;
  readonly initialSize?: TerminalDimensions;
  readonly resize?: TerminalDimensions & { readonly delayMs: number };
  /** Make a literal VEOF produce a zero-byte PTY read while output stays open. */
  readonly canonicalEofAfterMs?: number;
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
  const canonicalEofAfter = argument(args, "--canonical-eof-after");
  return {
    scenario,
    resultPath,
    noColor: args.includes("--no-color"),
    ...(initialSize === undefined ? {} : { initialSize }),
    ...(resizeSize === undefined
      ? {}
      : { resize: { ...resizeSize, delayMs: resizeDelay } }),
    ...(canonicalEofAfter === undefined
      ? {}
      : { canonicalEofAfterMs: Number(canonicalEofAfter) }),
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

async function runScenario(scenario: InteractiveTtyScenario): Promise<unknown> {
  switch (scenario) {
    case "text":
      return await inputPrompt({
        message: "Edit a Unicode value",
        hint: "Cursor movement and deletion preserve graphemes.",
      });
    case "text-default":
      return await inputPrompt({
        message: "Keep or edit the default",
        default: "remembered-value",
      });
    case "confirm-default-no":
      return await confirmationPrompt("Apply the destructive action?", false);
    case "select":
      return await selectPrompt({
        message: "Choose a value",
        options: [
          { id: "alpha", name: "Alpha", value: "alpha" },
          { id: "beta", name: "Beta", value: "beta" },
          { id: "omega", name: "Omega", value: "omega" },
        ],
      });
    case "select-default":
      return await selectPrompt({
        message: "Choose the remembered value",
        default: "beta",
        options: [
          { id: "alpha", name: "Alpha", value: "alpha" },
          { id: "beta", name: "Beta", value: "beta" },
          { id: "omega", name: "Omega", value: "omega" },
        ],
      });
    case "grouped-select":
      return await selectPrompt({
        message: "Choose from semantic groups",
        maxRows: 4,
        options: groupedSelectOptions([
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
      return await selectPrompt({
        message: "Filter grouped documents",
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
            id: "navigation",
            label: "Navigation",
            items: [{ id: "quit", name: "Quit", value: "quit" }],
          },
        ]),
      });
    case "search-default":
      return await selectPrompt({
        message: "Restore a remembered searchable document",
        search: true,
        default: "beta",
        options: groupedSelectOptions([
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
      const deskOptions = groupedSelectOptions([{
        id: "desk-actions",
        label: "Desk",
        items: Array.from({ length: 24 }, (_, index) => ({
          id: `desk-${index}`,
          name: `Desk task ${index}`,
          value: `desk-${index}`,
        })),
      }]);
      const docsOptions = groupedSelectOptions([{
        id: "documents",
        label: "Documents",
        items: Array.from({ length: 24 }, (_, index) => ({
          id: `doc-${index}`,
          name: `Document ${index}`,
          value: `doc-${index}`,
        })),
      }]);
      return [
        await selectPrompt({
          message: "Choose a desk action",
          options: deskOptions,
          search: true,
          searchLabel: "filter",
          maxRows: 16,
        }),
        await selectPrompt({
          message: "Browse docs",
          options: docsOptions,
          search: true,
          default: "doc-12",
          maxRows: 14,
        }),
        await selectPrompt({
          message: "Choose a desk action again",
          options: deskOptions,
          search: true,
          searchLabel: "filter",
          maxRows: 16,
        }),
      ];
    }
    case "textarea-tall": {
      const initialValue = Array.from(
        { length: 8 },
        (_, index) => `remembered line ${index + 1}`,
      ).join("\n");
      return await promptTextarea({
        label: "Edit tall notes",
        initialValue,
        rows: 12,
      }, {
        io: withPromptBoundary(new DenoTerminalIO({})),
      });
    }
    case "multiselect":
      return await checkboxPrompt({
        message: "Choose at least two values",
        minOptions: 2,
        maxRows: 4,
        options: groupedSelectOptions([
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
      return await checkboxPrompt({
        message: "Keep the selected values",
        minOptions: 2,
        default: ["gamma"],
        options: [
          { id: "alpha", name: "Alpha", value: "alpha", checked: true },
          { id: "gamma", name: "Gamma", value: "gamma" },
        ],
      });
    case "validation":
      return await inputPrompt({
        message: "Type valid",
        validate: (value) => value === "valid" || "Enter valid.",
      });
    case "error":
      return await inputPrompt({
        message: "Trigger an unexpected validator fault",
        validate: () => {
          throw new Error("synthetic validator fault");
        },
      });
    case "cancellation":
      return await inputPrompt("Cancel this question");
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
  setTerminalContext(productionTerminalContext({ noColor: options.noColor }));

  let resizedSize: TerminalDimensions | undefined;
  const resize = options.resize === undefined
    ? undefined
    : (async (): Promise<void> => {
      await new Promise((resolve) =>
        setTimeout(resolve, options.resize?.delayMs)
      );
      if (options.resize === undefined) return;
      await setSize(options.resize);
      resizedSize = consoleSize();
    })();
  const canonicalEof = options.canonicalEofAfterMs === undefined
    ? undefined
    : (async (): Promise<void> => {
      await new Promise((resolve) =>
        setTimeout(resolve, options.canonicalEofAfterMs)
      );
      // A PTY master cannot be half-closed while its transcript remains
      // readable. Canonical VEOF is the system-level equivalent: the next ^D
      // makes the production DenoTerminalIO read return end-of-input.
      await stty(["icanon"]);
    })();

  let result: Omit<InteractiveTtyResult, "terminal">;
  try {
    result = {
      scenario: options.scenario,
      outcome: "value",
      value: await runScenario(options.scenario),
    };
  } catch (error) {
    result = isPromptCancellation(error)
      ? { scenario: options.scenario, outcome: "cancelled" }
      : {
        scenario: options.scenario,
        outcome: "error",
        error: errorRecord(error),
      };
    if (!isPromptCancellation(error)) {
      console.error(POST_PROMPT_DIAGNOSTIC);
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
