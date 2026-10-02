/**
 * The words the inbox chrome shares with the palette: the header's chips,
 * which route fleet facts that need the owner to where they live, the label
 * a toggle command shows now, and inline Markdown (tips, hints, a stored
 * Proof line) as styled runs.
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
import { splitTipKeys, tipKeyLabel } from "../../shared/tips.ts";

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

/**
 * One line of inline Markdown as runs, as tips, hints and stored Proof lines
 * write it: a quote's marker dropped, `**strong**` as a title run, code
 * spans (of any backtick count) as code runs, and a tip's keys as key runs
 * spelled as the footer spells them, so no marker reaches the screen.
 * Anything else reads as written.
 */
export function inlineRuns(text: string): ApplicationRun[] {
  return splitTipKeys(text).flatMap((part): ApplicationRun[] =>
    "keys" in part
      ? [{
        text: tipKeyLabel(part.keys, "unicode"),
        ascii: tipKeyLabel(part.keys, "ascii"),
        role: "key",
      }]
      : markdownRuns(part.text)
  );
}

/** Inline Markdown without keys as runs ({@link inlineRuns}). */
function markdownRuns(text: string): ApplicationRun[] {
  const source = text.replace(/^>\s?/u, "");
  const runs: ApplicationRun[] = [];
  let plain = "";
  let at = 0;
  const flush = (): void => {
    if (plain !== "") runs.push({ text: plain });
    plain = "";
  };
  while (at < source.length) {
    if (source.startsWith("**", at)) {
      const end = source.indexOf("**", at + 2);
      if (end > at + 2) {
        flush();
        runs.push({ text: source.slice(at + 2, end), role: "title" });
        at = end + 2;
        continue;
      }
    }
    const fence = /^`+/u.exec(source.slice(at))?.[0];
    if (fence !== undefined) {
      const end = source.indexOf(fence, at + fence.length);
      if (end > at) {
        flush();
        const code = source.slice(at + fence.length, end);
        runs.push({
          text: code.startsWith(" ") && code.endsWith(" ") && code.trim() !== ""
            ? code.slice(1, -1)
            : code,
          role: "code",
        });
        at = end + fence.length;
        continue;
      }
    }
    plain += source[at];
    at += 1;
  }
  flush();
  return runs;
}
