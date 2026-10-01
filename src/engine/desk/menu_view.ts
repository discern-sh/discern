/**
 * The Desk's menus: every action for a task (a projection of the action
 * registry, in its sections, with the actions that cannot run now listed with
 * their reason), a parked branch's two routes, the agent picker, and the
 * script picker. Pure.
 */

import type {
  ApplicationLayer,
  ApplicationMenu,
  ApplicationMenuItem,
  ApplicationUnavailableItem,
} from "discern-design-system/cli/interactive";
import { commandEvidence } from "../../shared/command_evidence.ts";
import {
  DESK_ACTION_LABELS,
  DESK_COMMAND_LABELS,
  labelName,
} from "../../shared/desk_vocabulary.ts";
import type { DeskProjectScriptInventory } from "../project_scripts.ts";
import {
  DESK_ACTION_SECTION_TITLES,
  DESK_ACTION_SECTIONS,
  type DeskAgentLaunch,
  type DeskRow,
  deskRowId,
  unavailableSentence,
} from "./model.ts";
import type {
  DeskIntent,
  DeskLoad,
  DeskProductState,
  DeskScriptOwner,
} from "./desk_state.ts";
import { branchTitle, goneSentence, rowRef } from "./desk_transitions.ts";

/** Every action for one task, by section, the unavailable ones folded last. */
export function actionsMenu(row: DeskRow): ApplicationMenu<DeskIntent> {
  const id = deskRowId(row);
  const offers = row.decision.actions;
  const enabled = offers.filter((offer) => offer.availability === "enabled");
  const unavailable: ApplicationUnavailableItem[] = offers.flatMap((offer) =>
    offer.availability === "disabled"
      ? [{
        id: offer.action,
        label: offer.label,
        sentence: unavailableSentence(offer.label, offer.reason),
        ...(offer.key === undefined ? {} : { key: offer.key }),
      }]
      : []
  );
  const next = row.decision.next;
  return {
    kind: "menu",
    id: "actions",
    scope: "item",
    title: row.task.name,
    aside: [{
      text: `Actions · ${enabled.length} of ${offers.length} available`,
      tone: "faint",
    }],
    columns: 2,
    lettersActivate: true,
    ...(next?.availability === "enabled" ? { initialItemId: next.action } : {}),
    sections: DESK_ACTION_SECTIONS.flatMap((section) => {
      const items: ApplicationMenuItem<DeskIntent>[] = enabled
        .filter((offer) => offer.section === section)
        .map((offer) => ({
          id: offer.action,
          label: offer.label,
          ...(offer.key === undefined ? {} : { key: offer.key }),
          action: { kind: "action", action: offer.action, id },
          ...(section === "danger" ? { tone: "danger" as const } : {}),
          description: [{ text: offer.summary }],
        }));
      return items.length === 0 ? [] : [{
        title: DESK_ACTION_SECTION_TITLES[section],
        ...(section === "danger" ? { tone: "danger" as const } : {}),
        items,
      }];
    }),
    ...(unavailable.length === 0 ? {} : {
      unavailable: { title: "Unavailable", items: unavailable },
    }),
  };
}

/**
 * A menu whose task or branch left the inbox while it was open. It stays
 * until the owner closes it, says why, and offers nothing.
 */
export function goneMenu(
  state: DeskProductState,
  id: string,
  rowId: string,
): ApplicationMenu<DeskIntent> {
  return {
    kind: "menu",
    id,
    scope: "item",
    title: state.departed.get(rowId)?.title ?? "This task",
    aside: [{ text: "Gone", tone: "faint" }],
    sections: [],
    unavailable: {
      title: "Unavailable",
      items: [{
        id: "gone",
        label: "Every action",
        sentence: goneSentence(state.departed, rowId, state.trunk),
      }],
    },
  };
}

/** A parked branch's routes: give it a checkout again, or read its commits. */
export function branchMenu(
  state: DeskProductState,
  branch: string,
): ApplicationMenu<DeskIntent> {
  return {
    kind: "menu",
    id: "actions",
    scope: "item",
    title: branchTitle(branch, state.data),
    aside: [{ text: "Parked branch", tone: "faint" }],
    lettersActivate: true,
    sections: [{
      title: "Branch",
      items: [
        {
          id: "resume",
          label: DESK_COMMAND_LABELS.resume,
          action: { kind: "command", command: "resume", ref: branch },
          description: [{
            text: "Give the branch a checkout again, with its title and brief",
          }],
        },
        {
          id: "branch_commits",
          label: DESK_COMMAND_LABELS.branch_commits,
          key: "v",
          action: { kind: "command", command: "branch_commits", ref: branch },
          description: [{ text: `The commits that are not on ${state.trunk}` }],
        },
      ],
    }],
  };
}

/** The command a launch runs, as the picker shows it. */
function launchCommand(launch: DeskAgentLaunch): string {
  return commandEvidence([launch.binary, ...launch.args]);
}

/** Each configured agent's launches, unavailable ones with their reason. */
export function agentsMenu(
  state: DeskProductState,
  taskId: string,
): ApplicationMenu<DeskIntent> {
  const ref = rowRef(state, taskId);
  if (ref?.kind !== "task") return goneMenu(state, "agents", taskId);
  const launches = ref.row.agentLaunches;
  const providers = [
    ...new Set(launches.map((launch) => launch.providerLabel)),
  ];
  const remembered = launches.find((launch) =>
    launch.agent === state.preferences.last_agent &&
    launch.availability !== "disabled"
  );
  return {
    kind: "menu",
    id: "agents",
    scope: "item",
    title: `${DESK_ACTION_LABELS.agent} in ${ref.row.task.name}`,
    ...(remembered === undefined ? {} : { initialItemId: remembered.id }),
    sections: providers.map((provider) => ({
      title: provider,
      items: launches.filter((launch) =>
        launch.providerLabel === provider && launch.availability !== "disabled"
      ).map((launch) => ({
        id: launch.id,
        label: launch.label,
        action: { kind: "launch", taskId, launch: launch.id },
        detail: [{ text: launchCommand(launch), tone: "faint" as const }],
      })),
      unavailable: launches.filter((launch) =>
        launch.providerLabel === provider && launch.availability === "disabled"
      ).map((launch) => ({
        id: launch.id,
        label: launch.label,
        sentence: launch.reason ?? `${launch.label} is unavailable.`,
      })),
    })),
    footnote: [{
      text: "The agent takes over this window. Exit it to come back here.",
    }],
  };
}

/** The script picker: finding scripts, the scripts, or why there are none. */
export function scriptsLayer(
  state: DeskProductState,
  owner: DeskScriptOwner,
  load: DeskLoad<DeskProjectScriptInventory>,
): ApplicationLayer<DeskIntent> {
  const where = owner.kind === "main"
    ? "the main checkout"
    : rowRef(state, owner.taskId)?.kind === "task"
    ? "this task"
    : "this checkout";
  if (load.state !== "ready" || load.value.scripts.length === 0) {
    return {
      kind: "reader",
      id: load.state === "ready" ? "scripts" : "scripts-finding",
      scope: owner.kind === "main" ? "global" : "item",
      title: "Project Scripts",
      blocks: [
        load.state === "loading"
          ? { kind: "pending", label: "Finding scripts…" }
          : {
            kind: "text",
            runs: [{
              text: load.state === "failed"
                ? load.error
                : load.value.unavailableReason ??
                  `No Project Scripts are available in ${where}.`,
            }],
          },
      ],
    };
  }
  const scripts = load.value.scripts;
  return {
    kind: "menu",
    id: "scripts",
    scope: owner.kind === "main" ? "global" : "item",
    title: `${labelName(DESK_ACTION_LABELS.scripts)} in ${where}`,
    sections: [{
      title: "Project Scripts",
      items: scripts.filter((script) => script.availability !== "disabled")
        .map((script) => ({
          id: script.name,
          label: script.name,
          action: { kind: "script", name: script.name },
          ...(script.description === undefined
            ? {}
            : { description: [{ text: script.description }] }),
        })),
      unavailable: scripts.filter((script) =>
        script.availability === "disabled"
      )
        .map((script) => ({
          id: script.name,
          label: script.name,
          sentence: script.reason ?? `${script.name} can't run.`,
        })),
    }],
  };
}
