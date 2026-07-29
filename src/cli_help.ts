/**
 * Operator-oriented `discern --help` — group, reorder, and annotate the flat
 * command list so the daily-driver verbs lead and the workflow reads as a map.
 *
 * WHY this is a post-processor and not Cliffy's `.group()`: in Cliffy (1.2.x)
 * `.group()` groups OPTIONS, not commands, and the built-in help generator
 * renders every subcommand in one flat, registration-ordered "Commands:" block.
 * That generator is not exported, so it cannot be subclassed to teach it command
 * groups. So we let Cliffy render its canonical help — header, usage, options,
 * examples, all byte-identical to every subcommand's own `--help` — then rewrite
 * just its "Commands:" section into named, ordered groups read from
 * {@link COMMAND_GROUPS}. No internal Cliffy imports, no custom help handler, and
 * the rest of the help stays exactly as the framework renders it. (ADR 0066.)
 */

import type { Command } from "@cliffy/command";
import { colors } from "@cliffy/ansi/colors";
import { terminalWidth, wrapText } from "./lib/text.ts";
import type { EnvReader } from "./shared/env.ts";

/** Ambient inputs that callers may pin for deterministic help rendering. */
export interface OperatorHelpOptions {
  /** Lay out the grouped command list to this width, bypassing the terminal. */
  readonly width?: number;
  /** Environment source used by terminal-width fallback (chiefly `$COLUMNS`). */
  readonly env?: EnvReader;
  /**
   * The CLI's resolved colour decision (`--no-color` flag + NO_COLOR + isatty).
   * When set it governs the help's colour — including stripping any escape Cliffy's
   * own `getHelp()` emitted, since that generator consults only `Deno.noColor` and
   * so ignores both `--no-color` and non-TTY output. Omitted, the legacy heuristic
   * (was the base help already coloured?) applies.
   */
  readonly color?: boolean;
}

/** A named, ordered bucket of top-level commands for the help listing. */
export interface CommandGroup {
  /** The heading shown above the bucket. */
  readonly name: string;
  /** A short dim annotation after the heading — chiefly WHO drives this group, so
   * a first-time reader sees that the loop and worktree verbs are the ones their
   * coding agent runs, not chores for them. */
  readonly note: string;
  /** The command names, in the order they should read under the heading. */
  readonly commands: readonly string[];
}

/**
 * The command → group map, ordered so the verbs an agent runs every iteration
 * lead and the once-in-a-while human chores sink. This is the SSOT for
 * `discern --help` grouping: the guard test (`tests/engine_help_groups_test.ts`)
 * asserts every visible top-level command is covered here, so a verb registered
 * without a home fails the gate rather than landing silently ungrouped.
 *
 * The notes allude to WHO runs each group: discern is driven mainly by the
 * human's coding agent, and the loop + worktree verbs are almost always the
 * agent's, not the human's — so a novice doesn't read them as their own chores.
 */
export const COMMAND_GROUPS: readonly CommandGroup[] = [
  {
    name: "Your desk",
    note: "the human entry point; bare `discern` opens it",
    commands: ["desk"],
  },
  {
    name: "Agentic loop",
    note: "your coding agent runs these as it works",
    commands: ["status", "prepare", "done", "test", "tidy"],
  },
  {
    name: "Worktree lifecycle",
    note: "isolated workspaces your agent drives",
    commands: ["start", "update", "await", "accept", "worktree", "identity"],
  },
  {
    name: "Project Scripts",
    note: "project-owned automation, listed or run by name",
    commands: ["script"],
  },
  {
    name: "Setup & maintenance",
    note: "you or your agent tend the installation",
    commands: [
      "setup",
      "upgrade",
      "doctor",
      "config",
      "refresh",
      "uninstall",
    ],
  },
  {
    name: "Inspect & explore",
    note: "read-only views for you or your agent",
    commands: [
      "improvement",
      "standards",
      "skills",
      "impact",
      "coupling",
      "patterns",
      "map",
      "docs",
      "help",
      "licenses",
      "mcp",
    ],
  },
];

/** Every command name that has a declared group (drives the coverage guard). */
export function groupedCommandNames(): Set<string> {
  return new Set(COMMAND_GROUPS.flatMap((g) => g.commands));
}

/** The ESC byte that opens every ANSI escape, built without a control-char regex. */
const ESC = String.fromCharCode(27);

/**
 * Strip ANSI SGR colour sequences (`ESC [ … m`) from a string. Cliffy's `getHelp()`
 * colours from `Deno.noColor` alone, so it emits escapes even under `--no-color` or
 * to a pipe; when the resolved decision is "no colour" we remove them here so the
 * help is truly plain. Built by splitting on ESC and dropping each part up to its
 * terminating `m`, avoiding a control-character regex (matches the test helper).
 */
function stripAnsi(s: string): string {
  return s
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.slice(part.indexOf("m") + 1)))
    .join("");
}

/**
 * A column-0 line carrying `${label}:` — a help section heading. Cliffy renders
 * a heading as `bold("Label:")`, so under colour the line opens with an escape
 * (not a space) and the literal `Label:` survives contiguously inside it; under
 * no-colour it is the bare word. Content rows are always indented, so the
 * not-indented test separates a heading from a row that merely mentions the word.
 */
function isHeading(line: string, label: string): boolean {
  return !line.startsWith(" ") && line.includes(`${label}:`);
}

/**
 * The width to lay the command list out to. Mirrors how Cliffy wraps the rest of
 * the help (its `getColumns() ?? 150`) so the grouped commands and the framework's
 * own sections wrap to the SAME width: the terminal's when attached to one, else
 * `$COLUMNS`, else 150 (Cliffy's piped default). The per-row floor below keeps a
 * narrow terminal sane; there is no cap, so a wide terminal stays consistent.
 */
function helpWidth(options: OperatorHelpOptions): number {
  if (options.width !== undefined) {
    return Math.max(1, Math.floor(options.width));
  }
  return terminalWidth({
    env: options.env ?? Deno.env,
    fallback: 150,
  });
}

/**
 * Render the grouped "Commands:" section from the live command tree. Reads the
 * authoritative name + one-line description straight off each visible command
 * (so it can never disagree with what Cliffy would have listed), laid out under
 * {@link COMMAND_GROUPS} headings with a uniform name column and the description
 * word-wrapped to `width` with a hanging indent (so a long line never wraps back
 * to column 0 and shreds the alignment in a narrow terminal).
 */
function renderGroupedCommands(
  root: Command,
  color: boolean,
  width: number,
): string {
  const visible = root.getCommands(false);
  const byName = new Map(visible.map((c) => [c.getName(), c]));
  const nameCol = Math.min(
    Math.max(0, ...visible.map((c) => c.getName().length)),
    20,
  );
  // The description column begins after `    <name padded>  `; its continuation
  // lines hang-indent to the same column. A floor keeps the wrap sane if the
  // terminal is unusually narrow.
  const descStart = 4 + nameCol + 2;
  const descWidth = Math.max(24, width - descStart);
  const descIndent = " ".repeat(descStart);

  const heading = (s: string): string => (color ? colors.bold.cyan(s) : s);
  const name = (s: string): string => (color ? colors.brightBlue(s) : s);
  const desc = (s: string): string => (color ? colors.dim(s) : s);
  const rowLines = (c: Command): string[] => {
    const wrapped = wrapText(c.getShortDescription(), descWidth);
    const first = `    ${name(c.getName().padEnd(nameCol))}  ${
      desc(wrapped[0] ?? "")
    }`;
    return [first, ...wrapped.slice(1).map((l) => `${descIndent}${desc(l)}`)];
  };

  const out: string[] = ["Commands:", ""];
  const seen = new Set<string>();
  for (const group of COMMAND_GROUPS) {
    const members = group.commands
      .map((n) => byName.get(n))
      .filter((c): c is Command => c !== undefined);
    if (members.length === 0) {
      continue;
    }
    out.push(`  ${heading(group.name)} ${desc(`— ${group.note}`)}`);
    for (const c of members) {
      out.push(...rowLines(c));
      seen.add(c.getName());
    }
    out.push("");
  }

  // Defence in depth: a visible command with no declared group still shows, so a
  // missing assignment is loud rather than a vanished verb. The guard test keeps
  // this list empty; rendering it is the belt to that test's braces.
  const ungrouped = visible.filter((c) => !seen.has(c.getName()));
  if (ungrouped.length > 0) {
    out.push(`  ${heading("Other")}`);
    for (const c of ungrouped) {
      out.push(...rowLines(c));
    }
    out.push("");
  }

  if (out.at(-1) === "") {
    out.pop();
  }
  return out.join("\n");
}

/** Drop Cliffy's header `Version:` row — `--version` still reports it, so the
 * row is pure noise in an operator's map. A column-0 line only; the `--version`
 * option row is indented and survives. */
function dropVersionRow(lines: string[]): string[] {
  return lines.filter((l) => !isHeading(l, "Version"));
}

/**
 * Render the operator-oriented root help: Cliffy's canonical help with its flat
 * command list rewritten into {@link COMMAND_GROUPS} and a "see per-command help"
 * footer. Pass the fully-built root command; this calls its default `getHelp()`
 * (no custom handler is installed, so there is no recursion) and transforms the
 * string.
 */
export function operatorHelp(
  root: Command,
  options: OperatorHelpOptions = {},
): string {
  const rawBase = root.getHelp();
  // The CLI's resolved decision wins; absent it, fall back to "did Cliffy colour
  // the base?" (its legacy heuristic). When the decision is "no colour", strip the
  // escapes Cliffy emitted regardless — its generator honours only Deno.noColor, so
  // it ignores our --no-color and non-TTY output.
  const color = options.color ?? rawBase.includes(ESC);
  const base = color ? rawBase : stripAnsi(rawBase);
  const lines = dropVersionRow(base.split("\n"));

  const ci = lines.findIndex((l) => isHeading(l, "Commands"));
  if (ci === -1) {
    // No command list (degenerate tree) — nothing to regroup.
    return appendFooter(base, color);
  }
  // The command list runs until the next heading. We always register an example
  // (see buildCli), so "Examples:" reliably bounds it; fall back to end-of-help.
  let end = lines.findIndex((l, i) => i > ci && isHeading(l, "Examples"));
  if (end === -1) {
    end = lines.length;
  }
  const before = lines.slice(0, ci);
  const after = lines.slice(end);
  const grouped = renderGroupedCommands(root, color, helpWidth(options)).split(
    "\n",
  );
  const rebuilt = [...before, ...grouped, "", ...after].join("\n");
  return appendFooter(rebuilt, color);
}

/** Append the "drill into any command" pointer as a trailing footer line, set
 * off by a blank line from the examples above it. */
function appendFooter(help: string, color: boolean): string {
  const note = "Run `discern <command> --help` for detail on any command.";
  const body = help.replace(/\n+$/, "");
  return `${body}\n\n${color ? colors.dim(note) : note}\n`;
}
