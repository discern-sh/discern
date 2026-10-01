/**
 * The words the inbox chrome shares with the palette: the header's chips,
 * which route fleet facts that need the owner to where they live, the label
 * a toggle command shows now, and tip text with its commands as code.
 */

import type {
  ApplicationHeaderChip,
  ApplicationRun,
} from "discern-design-system/cli/interactive";
import type { StatusData } from "../../shared/result_schemas.ts";
import {
  DESK_COMMAND_LABELS,
  DESK_COMMAND_TOGGLED_LABELS,
} from "../../shared/desk_vocabulary.ts";
import type { DeskIntent, DeskProductState } from "./desk_state.ts";

/** One chip and the command it routes to. */
function chip(
  text: string,
  command: "main_checkout" | "landing" | "updates",
  warning = true,
): ApplicationHeaderChip<DeskIntent> {
  return {
    runs: [
      ...(warning
        ? [{ text: "! ", ascii: "! ", tone: "warning" as const }]
        : []),
      { text, tone: warning ? "warning" : "muted" },
    ],
    action: { kind: "command", command },
  };
}

/** Fleet-level facts that need the owner, each routed to where it lives. */
export function deskChips(
  data: StatusData | undefined,
): ApplicationHeaderChip<DeskIntent>[] {
  if (data === undefined) return [];
  const chips: ApplicationHeaderChip<DeskIntent>[] = [];
  if ((data.git?.tracked_changes ?? 0) > 0) {
    chips.push(chip("main has changes", "main_checkout"));
  }
  if (
    (data.pending_tracked_refresh?.length ?? 0) > 0 ||
    (data.tracked_refresh_plan_errors?.length ?? 0) > 0
  ) chips.push(chip("main needs a refresh", "main_checkout"));
  const emergencies =
    (data.emergency_validation ?? []).filter((item) =>
      item.state === "outstanding"
    ).length;
  if (emergencies > 0) {
    chips.push(
      chip(
        `${emergencies} emergency exception${emergencies === 1 ? "" : "s"}`,
        "landing",
      ),
    );
  }
  const clashes = data.adr_collisions?.length ?? 0;
  if (clashes > 0) {
    chips.push(
      chip(
        `${clashes} ADR number${clashes === 1 ? "" : "s"} clash`,
        "main_checkout",
      ),
    );
  }
  const reappeared = data.reappeared_worktree_paths?.length ?? 0;
  if (reappeared > 0) {
    chips.push(
      chip(
        `${reappeared} removed checkout${
          reappeared === 1 ? "" : "s"
        } reappeared`,
        "main_checkout",
      ),
    );
  }
  if (data.release_reminder !== undefined) {
    chips.push(chip("Update available", "updates", false));
  }
  return chips;
}

/** A toggle command's label as it reads now. */
export function toggleLabel(
  state: DeskProductState,
  command: keyof typeof DESK_COMMAND_TOGGLED_LABELS,
): string {
  const used = command === "sort"
    ? state.preferences.sort === "title"
    : command === "details"
    ? state.preferences.details === "hidden"
    : state.preferences.mouse === true;
  return used
    ? DESK_COMMAND_TOGGLED_LABELS[command]
    : DESK_COMMAND_LABELS[command];
}

/** Text with backtick spans as code runs, as tips write commands. */
export function codeRuns(text: string): ApplicationRun[] {
  return text.split("`").flatMap((part, index) =>
    part === "" ? [] : [
      index % 2 === 1 ? { text: part, role: "code" as const } : { text: part },
    ]
  );
}
