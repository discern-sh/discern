/**
 * The Commands row and its home panel: the desk's front page.
 *
 * The row leads the inbox in a group with no header, so the Desk opens with
 * it selected and a newcomer meets the desk's own commands before any task.
 * The panel beside it names the running discern and lists every command the
 * command registry marks for home, under the palette's sections and laid out
 * as the palette lists them: the label, the faint value the palette shows
 * beside it, and its key, where it has one, at the end. It also carries the
 * session's tip. With no tasks it leads with what a task is. Enter on the
 * row opens the palette over the panel. Pure.
 */

import type {
  ApplicationDetailBlock,
  ApplicationDetailStrip,
  ApplicationListGroup,
  ApplicationListItem,
  ApplicationRun,
} from "discern-design-system/cli/interactive";
import {
  DESK_COMMAND_LABELS,
  type DeskCommand,
} from "../../shared/desk_vocabulary.ts";
import { DISCERN_NAME } from "../../shared/product_identity.ts";
import { tipKeyLabel } from "../../shared/tips.ts";
import {
  DESK_COMMAND_REGISTRY,
  DESK_COMMANDS,
  DESK_PALETTE_SECTION_TITLES,
  DESK_PALETTE_SECTIONS,
  type DeskCommandFacts,
  type DeskCommandMetadata,
  type DeskPaletteSection,
  RELEASE_CHECK_CUES,
} from "./commands.ts";
import { COMMANDS_LABEL } from "./keys.ts";
import { DESK_GLYPHS } from "./glyphs.ts";
import { COMMANDS_ROW_ID } from "./desk_transitions.ts";
import type { DeskIntent, DeskProductState } from "./desk_state.ts";
import { inlineRuns } from "./header_view.ts";
import { commandFacts } from "./palette_view.ts";

/** What the home panel reads besides product state. */
export interface DeskHomeEnv {
  /** The running discern version. */
  readonly version: string;
  /** Wall time, for how long ago the last check was. */
  readonly now: number;
}

/** The headless group that holds the Commands row. */
export const COMMANDS_GROUP_ID = "commands";

/** Every command the home panel lists, in registry order. */
export const DESK_HOME_COMMANDS: readonly DeskCommand[] = DESK_COMMANDS
  .filter((command) => metadata(command).home === true);

/** One command's contract, read through its declared type. */
function metadata(command: DeskCommand): DeskCommandMetadata {
  return DESK_COMMAND_REGISTRY[command];
}

/** The home panel's sections in the palette's order, each with its commands. */
export function homeSections(): {
  readonly section: DeskPaletteSection;
  readonly commands: readonly DeskCommand[];
}[] {
  return DESK_PALETTE_SECTIONS.flatMap((section) => {
    const commands = DESK_HOME_COMMANDS.filter((command) =>
      metadata(command).section === section
    );
    return commands.length === 0 ? [] : [{ section, commands }];
  });
}

/** Whether status's release reminder says a check is due. */
function checkDue(state: DeskProductState): boolean {
  return state.data?.release_reminder !== undefined;
}

/** Whether the survey has read and found no task. */
export function noTasks(state: DeskProductState): boolean {
  return state.data !== undefined && state.rows.length === 0;
}

/** The palette's key, as the footer spells it. */
function paletteKey(tone: ApplicationRun["tone"]): ApplicationRun {
  return {
    text: tipKeyLabel(["ctrl-k"], "unicode"),
    ascii: tipKeyLabel(["ctrl-k"], "ascii"),
    ...(tone === undefined ? {} : { tone }),
  };
}

/**
 * The group that leads the inbox: the Commands row alone, with no header.
 * Its trailing cell names the palette's key, and its label cell says when a
 * release check is due. The row is the desk's own, not a task: the filter
 * passes over it, and zoom numbers only the tasks.
 */
export function commandsGroup(
  state: DeskProductState,
): ApplicationListGroup<DeskIntent> {
  const row: ApplicationListItem<DeskIntent> = {
    id: COMMANDS_ROW_ID,
    title: COMMANDS_LABEL,
    marker: {
      unicode: DESK_GLYPHS.commands.unicode,
      ascii: DESK_GLYPHS.commands.ascii,
      tone: "accent",
    },
    // While a check is due the cue takes the label cell, as a task's state
    // does, and the palette's key keeps its place beside it.
    cells: {
      ...(checkDue(state)
        ? {
          label: [{ text: RELEASE_CHECK_CUES.due, tone: "warning" as const }],
        }
        : {}),
      age: [paletteKey("faint")],
    },
    primary: { kind: "next", id: COMMANDS_ROW_ID },
  };
  return {
    id: COMMANDS_GROUP_ID,
    title: COMMANDS_LABEL,
    headless: true,
    counted: false,
    items: [row],
  };
}

/** Which discern runs, as the panel's heading and the strip name it. */
function running(env: DeskHomeEnv): string {
  return `${DISCERN_NAME} ${env.version}`;
}

/**
 * The widest faint value beside a home command, such as `12 queued · 3
 * landed`; the package fits the column to the values a section holds.
 */
const HOME_META_CELLS = 24;

/**
 * One section's commands as the palette lists them: each label, then the
 * faint value the palette shows beside it, then its key at the end, so a
 * key never reads as a count. A label is the whole promise in the desk's
 * words, so the block fits its content and keeps its longest label whole:
 * the value gives way first, and a label with nothing beside it runs on
 * into the empty cells.
 */
function commandRows(
  commands: readonly DeskCommand[],
  facts: DeskCommandFacts,
): ApplicationDetailBlock {
  return {
    kind: "rows",
    fit: true,
    columns: [
      { id: "meta", width: HOME_META_CELLS, align: "end", priority: 1 },
      { id: "key", width: 1 },
    ],
    items: commands.map((command) => {
      const meta = metadata(command).meta?.(facts);
      const key = metadata(command).key;
      return {
        text: [{ text: DESK_COMMAND_LABELS[command] }],
        cells: {
          ...(meta === undefined
            ? {}
            : { meta: [{ text: meta, tone: "faint" as const }] }),
          ...(key === undefined
            ? {}
            : { key: [{ text: key, role: "key" as const }] }),
        },
      };
    }),
  };
}

/** How the first survey stands, until it has read the tasks. */
function surveyBlocks(state: DeskProductState): ApplicationDetailBlock[] {
  if (state.data !== undefined) return [];
  return state.survey.failures > 0
    ? [{
      kind: "text",
      runs: [{ text: "Couldn't read tasks", tone: "warning" }],
    }]
    : [{ kind: "pending", label: "Loading tasks…" }];
}

/**
 * The section the session's tip follows: it teaches the desk as Help does,
 * and above Go to it stays on a standard 80 by 24 screen, where Go to's
 * places are a key or a Page Down away.
 */
const TIP_FOLLOWS: DeskPaletteSection = "help";

/** The home panel: what the desk does, and the session's tip. */
export function homeBlocks(
  state: DeskProductState,
  env: DeskHomeEnv,
): ApplicationDetailBlock[] {
  const empty = noTasks(state);
  const tip = state.tip;
  const facts = commandFacts(state, env.now);

  // The row and the zoom's breadcrumb already say Commands, so the panel
  // names what runs instead, beside what a task is while there are none.
  return [
    empty
      ? {
        kind: "heading",
        title: "No tasks yet",
        aside: [{ text: running(env), tone: "faint" }],
      }
      : { kind: "heading", title: running(env) },
    ...(empty
      ? [{
        kind: "text" as const,
        runs: [{
          text:
            `A task is its own checkout and branch for one change. Hand it to an agent; land it on ${state.trunk} once its checks pass.`,
        }],
      }]
      : []),
    ...surveyBlocks(state),
    ...homeSections().flatMap(({ section, commands }) => [
      {
        kind: "section" as const,
        title: DESK_PALETTE_SECTION_TITLES[section],
        blocks: [commandRows(commands, facts)],
      },
      ...(section === TIP_FOLLOWS && tip !== undefined
        ? [{
          kind: "section" as const,
          title: "Tip",
          ...(tip.newIn === undefined
            ? {}
            : { caption: `new in ${tip.newIn}` }),
          blocks: [{ kind: "text" as const, runs: inlineRuns(tip.brief) }],
        }]
        : []),
    ]),
  ];
}

/**
 * The commands the strip names below the split, in the order they matter on
 * a narrow screen: starting work, then the three a newcomer cannot guess a
 * key for. Each reads as its registry short form, or its label where it
 * declares none, followed by the faint value the panel shows beside it.
 */
export const DESK_STRIP_COMMANDS = [
  "new_task",
  "manual",
  "updates",
  "main_scripts",
] as const satisfies readonly DeskCommand[];

/**
 * The Commands row's strip on a narrow screen: the row with the palette's
 * key, then whether there are tasks yet, a due check, the commands it names
 * by their short forms with the panel's values (`Updates checked 3w ago`),
 * and the running discern. The strip keeps whole facts in order, so a
 * later, shorter one shows where an earlier one cannot.
 */
export function homeStrip(
  state: DeskProductState,
  env: DeskHomeEnv,
): ApplicationDetailStrip {
  const facts = commandFacts(state, env.now);
  return {
    title: [
      {
        text: DESK_GLYPHS.commands.unicode,
        ascii: DESK_GLYPHS.commands.ascii,
        tone: "accent",
      },
      { text: " " },
      { text: COMMANDS_LABEL, role: "title" },
      { text: "  " },
      { ...paletteKey(undefined), role: "key" },
    ],
    facts: [
      ...(noTasks(state) ? [[{ text: "No tasks yet" }]] : []),
      ...(checkDue(state)
        ? [[{ text: RELEASE_CHECK_CUES.due, tone: "warning" as const }]]
        : []),
      ...DESK_STRIP_COMMANDS.map((command): ApplicationRun[] => {
        const { key, short, meta } = metadata(command);
        const name = short ?? DESK_COMMAND_LABELS[command];
        const value = meta?.(facts);
        return [
          ...(key === undefined ? [] : [{ text: key, role: "key" as const }]),
          { text: key === undefined ? name : ` ${name}` },
          ...(value === undefined
            ? []
            : [{ text: ` ${value}`, tone: "faint" as const }]),
        ];
      }),
      [{ text: running(env), tone: "faint" as const }],
    ],
  };
}
