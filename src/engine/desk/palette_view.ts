/**
 * The command palette: what needs the owner first (each such task's next
 * step and each header chip's route), then every Desk command by section from
 * the command registry, then every task and parked branch to go to. Pure.
 */

import type {
  ApplicationPalette,
  ApplicationPaletteItem,
  ApplicationPaletteSection,
} from "discern-design-system/cli/interactive";
import {
  DESK_COMMAND_LABELS,
  type DeskCommand,
} from "../../shared/desk_vocabulary.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import {
  DESK_COMMAND_REGISTRY,
  DESK_COMMANDS,
  DESK_PALETTE_SECTION_TITLES,
  DESK_PALETTE_SECTIONS,
  type DeskCommandFacts,
  type DeskCommandMetadata,
} from "./commands.ts";
import { waitsForOwner } from "../../shared/fleet_row_vocabulary.ts";
import { deskRowId } from "./model.ts";
import type { DeskIntent, DeskProductState } from "./desk_state.ts";
import {
  branchTitle,
  parkedBranches,
  parkedRowId,
} from "./desk_transitions.ts";
import { tone } from "./inspector_view.ts";
import { deskChips, toggleLabel } from "./header_view.ts";

/** The facts command meta reads. */
function commandFacts(state: DeskProductState): DeskCommandFacts {
  return {
    ...(state.data === undefined ? {} : { data: state.data }),
    version: DISCERN_VERSION,
    trunk: state.trunk,
    sessionOperations: state.activity.length,
  };
}

/** A command's label as it reads now: toggles say what they will do. */
function commandLabel(state: DeskProductState, command: DeskCommand): string {
  return command === "sort" || command === "details" || command === "mouse"
    ? toggleLabel(state, command)
    : DESK_COMMAND_LABELS[command];
}

/** One palette row for a global command. */
function commandItem(
  state: DeskProductState,
  command: DeskCommand,
): ApplicationPaletteItem<DeskIntent> {
  const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[command];
  const meta = metadata.meta?.(commandFacts(state));
  return {
    id: command,
    label: commandLabel(state, command),
    ...(meta === undefined ? {} : { meta: [{ text: meta, tone: "faint" }] }),
    ...(metadata.key === undefined ? {} : { key: metadata.key }),
    action: { kind: "command", command },
    keywords: metadata.summary,
  };
}

/** Each task that needs the owner, by its next step. */
function needsYou(
  state: DeskProductState,
): ApplicationPaletteItem<DeskIntent>[] {
  const tasks = state.rows.flatMap((row) => {
    const next = row.decision.next;
    if (
      !waitsForOwner(row.decision.group) ||
      next?.availability !== "enabled"
    ) return [];
    const id = deskRowId(row);
    return [{
      id: `next:${id}`,
      label: next.label,
      context: row.task.name,
      meta: [{
        text: row.decision.label,
        tone: tone(row.decision.tones.label),
      }],
      action: { kind: "next", id } as const,
      keywords: `${row.entry.branch} ${row.decision.label}`,
    }];
  });
  const chips = deskChips(state.data).flatMap((chip, index) =>
    chip.action === undefined ? [] : [{
      id: `chip:${index}`,
      label: chip.runs.map((run) => run.text).join("").replace(/^! /u, ""),
      action: chip.action,
    }]
  );
  return [...tasks, ...chips];
}

/** The palette layer. */
export function deskPalette(
  state: DeskProductState,
): ApplicationPalette<DeskIntent> {
  const sections: ApplicationPaletteSection<DeskIntent>[] = [];
  const urgent = needsYou(state);
  if (urgent.length > 0) sections.push({ title: "Needs you", items: urgent });
  for (const section of DESK_PALETTE_SECTIONS) {
    const items = DESK_COMMANDS.filter((command) => {
      const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[command];
      return metadata.scope === "global" && metadata.section === section;
    }).map((command) => commandItem(state, command));
    sections.push({ title: DESK_PALETTE_SECTION_TITLES[section], items });
  }
  if (state.rows.length > 0) {
    sections.push({
      title: "Tasks",
      items: state.rows.map((row) => ({
        id: `task:${deskRowId(row)}`,
        label: row.task.name,
        meta: [{
          text: row.decision.label,
          tone: tone(row.decision.tones.label),
        }],
        action: { kind: "select", id: deskRowId(row) },
        keywords: row.entry.branch,
      })),
    });
  }
  const parked = parkedBranches(state.data);
  if (parked.length > 0) {
    sections.push({
      title: DESK_COMMAND_LABELS.parked,
      items: parked.map((branch) => ({
        id: `branch:${branch}`,
        label: branchTitle(branch, state.data),
        meta: [{ text: "Parked", tone: "faint" }],
        action: { kind: "select", id: parkedRowId(branch) },
        keywords: branch,
      })),
    });
  }
  return {
    kind: "palette",
    id: "palette",
    scope: "global",
    placeholder: "Search tasks and commands",
    sections,
  };
}
