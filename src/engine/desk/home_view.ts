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
import { plural } from "../../shared/result_markdown_values.ts";
import { displayWidth } from "../../lib/text.ts";
import { tipKeyLabel } from "../../shared/tips.ts";
import {
  DESK_COMMAND_REGISTRY,
  DESK_COMMANDS,
  DESK_PALETTE_SECTION_TITLES,
  DESK_PALETTE_SECTIONS,
  type DeskCommandFacts,
  type DeskCommandMetadata,
  type DeskPaletteSection,
  RELEASE_CHECK_DUE,
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
        ? { label: [{ text: RELEASE_CHECK_DUE, tone: "warning" as const }] }
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
 * One section's commands as the palette lists them: each label, then the
 * faint value the palette shows beside it, then its key at the end, so a
 * key never reads as a count. A label is the whole promise in the desk's
 * words, so the block keeps its longest whole: the value gives way first,
 * and a label with nothing beside it runs on into the empty cells.
 */
function commandRows(
  commands: readonly DeskCommand[],
  facts: DeskCommandFacts,
): ApplicationDetailBlock {
  const rows = commands.map((command) => ({
    label: DESK_COMMAND_LABELS[command],
    meta: metadata(command).meta?.(facts),
    key: metadata(command).key,
  }));
  const metaWidth = Math.max(
    0,
    ...rows.map((row) => row.meta === undefined ? 0 : displayWidth(row.meta)),
  );
  const keyed = rows.some((row) => row.key !== undefined);
  return {
    kind: "rows",
    columns: [
      ...(metaWidth === 0 ? [] : [{
        id: "meta",
        width: metaWidth,
        align: "end" as const,
        priority: 1,
      }]),
      ...(keyed ? [{ id: "key", width: 1 }] : []),
    ],
    minText: Math.max(...rows.map((row) => displayWidth(row.label))),
    items: rows.map((row) => ({
      text: [{ text: row.label }],
      cells: {
        ...(row.meta === undefined
          ? {}
          : { meta: [{ text: row.meta, tone: "faint" as const }] }),
        ...(row.key === undefined
          ? {}
          : { key: [{ text: row.key, role: "key" as const }] }),
      },
    })),
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
    ...homeSections().map(({ section, commands }): ApplicationDetailBlock => ({
      kind: "section",
      title: DESK_PALETTE_SECTION_TITLES[section],
      blocks: [commandRows(commands, facts)],
    })),
    ...(tip === undefined ? [] : [{
      kind: "section" as const,
      title: "Tip",
      ...(tip.newIn === undefined ? {} : { caption: `new in ${tip.newIn}` }),
      blocks: [{ kind: "text" as const, runs: inlineRuns(tip.brief) }],
    }]),
  ];
}

/**
 * The Commands row's strip on a narrow screen: New task first while there
 * are none, then how many commands Space shows, the release check, and the
 * palette's key.
 */
export function homeStrip(
  state: DeskProductState,
  env: DeskHomeEnv,
): ApplicationDetailStrip {
  const newTask = metadata("new_task").key;
  return {
    title: [
      {
        text: DESK_GLYPHS.commands.unicode,
        ascii: DESK_GLYPHS.commands.ascii,
        tone: "accent",
      },
      { text: " " },
      { text: noTasks(state) ? "No tasks yet" : COMMANDS_LABEL, role: "title" },
    ],
    facts: [
      ...(noTasks(state) && newTask !== undefined
        ? [[{ text: newTask, role: "key" as const }, {
          text: ` ${DESK_COMMAND_LABELS.new_task}`,
        }]]
        : []),
      [{ text: plural(DESK_HOME_COMMANDS.length, "command") }],
      checkDue(state)
        ? [{ text: RELEASE_CHECK_DUE, tone: "warning" as const }]
        : [{ text: running(env), tone: "faint" as const }],
      [paletteKey(undefined), { text: " anywhere", tone: "muted" }],
    ],
  };
}
