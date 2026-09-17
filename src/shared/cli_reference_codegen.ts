/**
 * The CLI command model and the generated CLI reference — both read off the LIVE
 * command registry (`buildCli`'s Cliffy tree), never a hand-copied list, so the
 * documented surface and the real one are a single source (the same discipline as
 * `config_codegen.ts`, ADR 0026).
 *
 * Two consumers:
 *  - `scripts/codegen.ts` renders {@link renderManualCliReferenceDoc} into the manual's
 *    committed CLI reference; a sync test asserts the committed file equals the
 *    generator output, so a verb or flag change that isn't regenerated fails the
 *    gate.
 *  - the docs-integrity guard validates every fenced `discern …` example in the
 *    map against {@link cliCommandModel}, so an example quoting a renamed verb or
 *    a removed flag fails the docs, not the user.
 *
 * The walker reads Cliffy's public introspection surface through a narrow
 * structural view ({@link CommandView}) — the generic `Command` type is
 * impractical to thread here, and the view names exactly the methods used.
 * These functions stay OUT of the engine's hot path — they are dev/codegen tools.
 */

import { COMMAND_GROUPS } from "../cli_help.ts";
import { EnumType } from "@cliffy/command";
import { renderMarkdownHtml } from "../lib/markdown.ts";
import { repositoryBlobUrl } from "./brand.ts";
import { renderExitStatusTable } from "./exit_codes.ts";

/** One positional argument a command declares. */
export interface CliArg {
  name: string;
  optional: boolean;
  variadic: boolean;
  /** Parser value types, in argument order. */
  value_types: string[];
  /** Accepted values for an enum-typed positional, in declaration order. */
  choices?: string[];
}

/** One flag a command accepts, as declared (every spelling in `flags`). */
export interface CliOption {
  /** All spellings, e.g. `["-y", "--yes"]`. */
  flags: string[];
  description: string;
  /** Cliffy's value spec (`"<name:string>"`), `""` for a boolean flag. */
  type_definition: string;
  /** Number of values Cliffy consumes for one occurrence. */
  arity: number;
  /** Parser value types, in argument order; empty for a Boolean flag. */
  value_types: string[];
  /** Registered default, or null when the option has no default. */
  default_value: unknown;
  hidden: boolean;
  /** True for a root `globalOption` inherited by every command. */
  global: boolean;
  /** Accepted values for a flag whose single value has an enum type, in declaration order. */
  choices?: string[];
}

/** One command in the live tree, with its full subcommand subtree. */
export interface CliCommand {
  /** Command words below `discern`, e.g. `["worktree", "create"]`. */
  path: string[];
  description: string;
  aliases: string[];
  hidden: boolean;
  args: CliArg[];
  /** An explicit Cliffy usage suffix, or an empty string for derived usage. */
  usage: string;
  /** Own + inherited-global options, exactly as Cliffy resolves them. */
  options: CliOption[];
  children: CliCommand[];
}

/** Entry-point-owned projection of the fully attached live command tree. */
export type CliModelProvider = () => CliCommand;

/** Flags Cliffy accepts on every command without declaring them as options. */
export const IMPLICIT_COMMAND_FLAGS: readonly string[] = ["-h", "--help"];

/** Flags Cliffy accepts on the root command only (from `.version()`). */
export const IMPLICIT_ROOT_FLAGS: readonly string[] = ["-V", "--version"];

/** The narrow structural view of a Cliffy command this module reads. */
interface CommandView {
  getName(): string;
  getDescription(): string;
  getAliases(): string[];
  getUsage(): string;
  getArguments(): ReadonlyArray<{
    name: string;
    optional: boolean;
    variadic: boolean;
    type: string;
  }>;
  getType(name: string): { handler: unknown } | undefined;
  getOptions(hidden?: boolean): ReadonlyArray<{
    name: string;
    flags: string[];
    description: string;
    typeDefinition?: string;
    args?: ReadonlyArray<{ type?: string }>;
    default?: unknown;
    hidden?: boolean;
    global?: boolean;
  }>;
  getCommands(hidden?: boolean): CommandView[];
}

/** The accepted values of one registered enum type, or nothing for any other type. */
function enumChoices(
  cmd: CommandView,
  type: string | undefined,
): { choices?: string[] } {
  const handler = type === undefined ? undefined : cmd.getType(type)?.handler;
  return handler instanceof EnumType
    ? { choices: handler.values().map(String) }
    : {};
}

/** Walk one command into the plain model, `path` naming its position. */
function walkCommand(
  cmd: CommandView,
  path: string[],
  hidden: boolean,
): CliCommand {
  const args = cmd.getArguments();
  const visibleChildren = new Set(
    cmd.getCommands(false).map((c) => c.getName()),
  );
  return {
    path,
    description: cmd.getDescription(),
    aliases: cmd.getAliases(),
    hidden,
    usage: args.length === 0 ? cmd.getUsage() : "",
    args: args.map((a) => ({
      name: a.name,
      optional: a.optional,
      variadic: a.variadic,
      value_types: [a.type],
      ...enumChoices(cmd, a.type),
    })),
    options: cmd.getOptions(true).map((o) => ({
      flags: [...o.flags],
      description: o.description,
      type_definition: o.typeDefinition ?? "",
      arity: o.args?.length ?? 0,
      value_types: o.args?.map((arg) => arg.type ?? "unknown") ?? [],
      default_value: o.default ?? null,
      hidden: o.hidden === true,
      global: o.global === true,
      ...(o.args?.length === 1 ? enumChoices(cmd, o.args[0]?.type) : {}),
    })),
    children: cmd.getCommands(true).map((c) =>
      walkCommand(
        c,
        [...path, c.getName()],
        hidden || !visibleChildren.has(c.getName()),
      )
    ),
  };
}

/**
 * The live command tree as plain data. Pass the fully-built root (`buildCli`) —
 * taking it as a parameter keeps this module free of the CLI's own wiring, and
 * makes the model trivially testable against a synthetic tree. The root node's
 * `path` is `[]`; its `options` are the global flags.
 */
export function cliCommandModel(root: unknown): CliCommand {
  return walkCommand(root as CommandView, [], false);
}

/** Depth-first walk over `node` and every descendant. */
export function* walkCliCommands(node: CliCommand): Generator<CliCommand> {
  yield node;
  for (const child of node.children) {
    yield* walkCliCommands(child);
  }
}

// ── the generated CLI reference ────────────────────────────────────────────────

/** The banner stamped atop the generated reference page. */
const DOCS_BANNER =
  "<!-- This reference is generated from the live command registry. -->";

/** Escape a cell value for a Markdown table (pipes would split the row). */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** One argument rendered for a usage line: `<name>`, `[name]`, `[name...]`. */
function argLabel(arg: CliArg): string {
  const dots = arg.variadic ? "..." : "";
  return arg.optional ? `[${arg.name}${dots}]` : `<${arg.name}${dots}>`;
}

/**
 * A help-only command GROUP: subcommands, no positionals, and nothing of its
 * own to invoke. The prelaunch vocabulary retired presenting a bare group as a
 * command — docs teach `discern worktree <subcommand>`, never `discern
 * worktree` — so the reference renders groups in that canonical shape.
 */
export function isHelpOnlyGroup(node: CliCommand): boolean {
  return node.children.length > 0 && node.args.length === 0 &&
    node.options.every((o) => o.hidden || o.global);
}

/** The backticked label a command's heading and usage carry: the full path,
 * with `<subcommand>` appended for a help-only group. */
export function commandHeadingLabel(node: CliCommand): string {
  const words = ["discern", ...node.path];
  if (isHelpOnlyGroup(node)) words.push("<subcommand>");
  return words.join(" ");
}

/** A flag's value spec with Cliffy's `:type` annotations dropped:
 * `<name:string>` → `<name>`. */
function valueSpec(typeDefinition: string): string {
  return typeDefinition.replace(/:[a-zA-Z]+([>\]])/g, "$1");
}

/** The full usage line for one command, e.g. `discern map [target] [options]`. */
function usageLine(node: CliCommand): string {
  if (isHelpOnlyGroup(node)) return commandHeadingLabel(node);
  if (node.usage !== "") {
    return ["discern", ...node.path, node.usage].join(" ");
  }
  const words = ["discern", ...node.path, ...node.args.map(argLabel)];
  if (node.options.some((o) => !o.hidden)) {
    words.push("[options]");
  }
  return words.join(" ");
}

/** The `| Option | Description |` table for a command's own visible flags.
 * Inherited globals are excluded — they render once, in their own section. */
function optionsTable(node: CliCommand): string {
  const rows = node.options
    .filter((o) => !o.hidden && !o.global)
    .map((o) => {
      const spec = valueSpec(o.type_definition);
      const label = o.flags.join(", ") + (spec === "" ? "" : ` ${spec}`);
      return `| \`${cell(label)}\` | ${cell(o.description)} |`;
    });
  if (rows.length === 0) return "";
  return ["| Option | Description |", "| --- | --- |", ...rows].join("\n");
}

/** The heading + body for one command (and, recursively, its visible
 * subcommands one heading level down). */
function commandSection(
  node: CliCommand,
  depth: number,
  includeAliases = false,
): string {
  const heading = "#".repeat(depth);
  const parts: string[] = [
    `${heading} \`${commandHeadingLabel(node)}\``,
    "",
    node.description,
    "",
    `Usage: \`${usageLine(node)}\``,
  ];
  if (includeAliases && node.aliases.length > 0) {
    const parent = node.path.slice(0, -1);
    const aliases = node.aliases.map((alias) =>
      `\`discern ${[...parent, alias].join(" ")}\``
    );
    parts.push("", `Aliases: ${aliases.join(", ")}.`);
  }
  const table = optionsTable(node);
  if (table !== "") {
    parts.push("", table);
  }
  for (const child of node.children) {
    if (child.hidden) continue;
    parts.push(
      "",
      commandSection(child, Math.min(depth + 1, 6), includeAliases),
    );
  }
  return parts.join("\n");
}

/**
 * Render the map's CLI reference page from the live command tree. Every visible
 * command appears under its `COMMAND_GROUPS` group (the same grouping — and the
 * same guarded SSOT — as `discern --help`), with its flags and subcommands read
 * straight off the registry. Search aliases are derived from the same tree,
 * so every visible command path is searchable without a second list to maintain.
 */
export function renderCliReferenceModel(
  model: CliCommand,
  manual: boolean,
): string {
  const byName = new Map(model.children.map((c) => [c.path[0] ?? "", c]));
  const commands = [...walkCliCommands(model)]
    .filter((command) => command.path.length > 0 && !command.hidden);
  const aliases = commands.flatMap((command) => {
    const canonical = `discern ${command.path.join(" ")}`;
    if (!manual) return [canonical];
    const parent = command.path.slice(0, -1);
    return [
      canonical,
      ...command.aliases.map((alias) =>
        `discern ${[...parent, alias].join(" ")}`
      ),
    ];
  });
  const manualAliases = manual
    ? [
      "interactive documentation reader",
      "terminal reader controls",
      "Tab picker",
      "Press Enter to continue",
      "$PAGER",
    ]
    : [];

  const groups = COMMAND_GROUPS.map((group) => {
    const members = group.commands
      .map((name) => byName.get(name))
      .filter((c): c is CliCommand => c !== undefined && !c.hidden);
    if (members.length === 0) return "";
    return [
      `## ${group.name}`,
      "",
      `${group.note.charAt(0).toUpperCase()}${group.note.slice(1)}.`,
      "",
      members.map((m) => commandSection(m, 3, manual)).join("\n\n"),
    ].join("\n");
  }).filter((s) => s !== "");

  const globalRows = model.options
    .filter((o) => !o.hidden)
    .map((o) => {
      const spec = valueSpec(o.type_definition);
      const label = o.flags.join(", ") + (spec === "" ? "" : ` ${spec}`);
      return `| \`${cell(label)}\` | ${cell(o.description)} |`;
    });

  const manualContract = manual
    ? [
      "## Help, version, and parser-owned flags",
      "",
      "No project setup is required to read help or the version. The command parser owns command usage, argument validation, aliases, and option help. `discern <command> --help` and `discern help <command>` read the same command tree as this page.",
      "",
      "| Spelling | Scope | Meaning |",
      "| --- | --- | --- |",
      `| \`${
        IMPLICIT_COMMAND_FLAGS.join("\`, \`")
      }\` | Every command | Show command help and exit without running the command. |`,
      `| \`${
        IMPLICIT_ROOT_FLAGS.join("\`, \`")
      }\` | Root only | Show the installed discern version and exit. |`,
      "",
      "Options after an exec-style boundary, including `discern queue --` and a project script name, belong to the child command rather than discern.",
      "",
      "## Interactive documentation reader",
      "",
      "Bare `discern docs` on an interactive terminal opens the grouped documentation reader. The picker searches document titles and paths. `discern map` uses the same reader for the configured project map.",
      "",
      "| Context | Input | Contract |",
      "| --- | --- | --- |",
      "| Picker | Type text | Filter the grouped document titles and paths. |",
      "| Picker | `Up`, `Down`, `Ctrl-P`, `Ctrl-N` | Move one selectable entry. With no document open, `Tab` and `Shift-Tab` also move one entry. |",
      "| Picker | `Page Up`, `Page Down` | Move by one visible picker page. |",
      "| Picker | `Home`, `End` | Move to the first or last selectable entry. |",
      "| Picker | `Enter` | Open the selected document or run the selected action. |",
      "| Picker | `Escape`, `Ctrl-C`, end of input | Leave the reader without changing project state. |",
      "| Open document | `Tab`, `Shift-Tab` | Move focus between the picker and document panes. |",
      "| Open document | `Up`, `Down`, `Ctrl-P`, `Ctrl-N` | Scroll the document by one rendered row. |",
      "| Open document | `Page Up`, `Page Down` | Scroll by one visible document page. |",
      "| Open document | `Home`, `End` | Jump to the start or end of the document. |",
      "| Open document | `[`, `]` | Focus the previous or next addressable link. |",
      "| Focused link | `Enter` | Follow the link. `Escape` clears link focus and returns to scrolling. |",
      "| Open document | `Escape`, `q` | Close the document and retain the picker query and selection. |",
      "",
      "Admitted relative-document links and heading fragments stay inside the reader. Absolute `http://` and `https://` destinations open in the system browser only after discern restores the terminal. Other external schemes are not supported.",
      "",
      "With mouse tracking available, the wheel moves three picker entries or three document rows under the pointer. A left click focuses a pane and selects a picker entry; clicking a link follows it. Other mouse buttons and releases have no product action. Use the terminal application's own selection modifier to select terminal text while tracking is active; discern does not define that modifier.",
      "",
      "The rich reader requires ANSI terminal control and at least 32 columns. With the default three chrome rows, the picker-only layout needs 10 total rows, document-only needs 11, and the split layout begins at 18. Between those bounds, the focused pane occupies all usable rows.",
      "",
      "If the rich reader cannot start because ANSI control is unavailable or the terminal is too small, discern uses the sequential picker. An internally rendered document then waits at the exact prompt `Press Enter to continue.` and the next picker restores the remembered document selection. `--pager` selects this sequential flow and hands each document to `$PAGER`, or `less -R` when `$PAGER` is unset, when the pager succeeds.",
      "",
      "A direct `discern docs <target>` renders and exits without waiting. Bare `discern docs` off a terminal prints the table of contents and never requests input. `--list`, `--json`, and `--raw` never enter the reader; `--search` prints matches. Export writes or returns one Markdown stream, except `--export select` can request a selection on an interactive terminal.",
      "",
      `The implementation and real-terminal contract are public in [\`src/commands/docs.ts\`](${
        repositoryBlobUrl("src/commands/docs.ts")
      }) and [\`tests/docs_test.ts\`](${
        repositoryBlobUrl("tests/docs_test.ts")
      }).`,
      "",
      "## Exit behavior",
      "",
      renderExitStatusTable(),
      "",
      "Quiet JSON and Markdown results evaluate their completion policy before choosing the controlled exit status. Predicate result modes exit `0` and place the boolean in `data`; bare predicates use `0` or `1`.",
      "",
    ]
    : [];

  return [
    "---",
    "title: CLI reference",
    manual
      ? "description: Find discern commands and options, understand their results, and use the terminal documentation reader."
      : "description: Every discern command and flag, generated from the live command registry.",
    "order: 10",
    "publish: true",
    "aliases:",
    ...[...aliases, ...manualAliases].map((alias) => `  - ${alias}`),
    "---",
    "",
    DOCS_BANNER,
    "",
    "# CLI reference",
    "",
    manual
      ? "Find a command, check its options, or look up how the terminal reader works. Your agent usually runs these commands for you; this page is here when you want to understand an invocation or use the terminal yourself."
      : "Use this page to look up the exact syntax and flags for every visible `discern` command. The entries are generated from the command registry the binary dispatches on. `discern <command> --help` prints the same declarations in the terminal.",
    ...(manual
      ? [
        "",
        "`discern <command> --help` shows the same command options in your terminal. Help works before project setup; commands that need a configured project return `setup_unfinished` until setup is complete.",
        "",
        "## Find a command",
        "",
        "| Area | Commands |",
        "| --- | --- |",
        ...COMMAND_GROUPS.map((group) => {
          const links = group.commands.flatMap((name) => {
            const command = byName.get(name);
            if (command === undefined || command.hidden) return [];
            const heading = renderMarkdownHtml(
              `### \`${commandHeadingLabel(command)}\``,
            ).headings[0];
            if (heading === undefined) {
              throw new Error(`no heading for ${name}`);
            }
            return [`[\`${name}\`](#${heading.id})`];
          });
          return links.length === 0
            ? ""
            : `| ${cell(group.name)} | ${links.join(", ")} |`;
        }).filter((row) => row !== ""),
        "",
        "For options shared by commands, see [Global options](#global-options). For keyboard and mouse controls, see [Interactive documentation reader](#interactive-documentation-reader). To interpret a returned status code, see [Exit behavior](#exit-behavior).",
      ]
      : []),
    "",
    "## Global options",
    "",
    "These options apply to commands unless an entry says otherwise. When discern runs another command, options after that boundary belong to the command it runs. For example, options after `discern queue --` are passed to the queued command.",
    "",
    "| Option | Description |",
    "| --- | --- |",
    ...globalRows,
    "",
    groups.join("\n\n"),
    "",
    ...manualContract,
    ...(manual
      ? [
        "",
        "For result-envelope fields and Model Context Protocol delivery, see [MCP and results](mcp-and-results.md). For symptom-led recovery, see [Troubleshooting](../40-troubleshooting/README.md).",
      ]
      : []),
    "",
  ].join("\n");
}

/** Render the complete public-manual projection from the same live tree. */
export function renderManualCliReferenceDoc(root: unknown): string {
  return renderCliReferenceModel(cliCommandModel(root), true);
}
