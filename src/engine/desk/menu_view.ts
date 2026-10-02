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
  rememberedLaunch,
  unavailableSentence,
} from "./model.ts";
import type {
  DeskIntent,
  DeskLoad,
  DeskProductState,
  DeskScriptOwner,
} from "./desk_state.ts";
import {
  branchTitle,
  goneSentence,
  rowRef,
  taskTitleOf,
} from "./desk_transitions.ts";

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
          // The menu's Open agent shows every launch; its key and Enter on
          // the row run the remembered one.
          action: {
            kind: "action",
            action: offer.action,
            id,
            ...(offer.action === "agent" ? { choose: true } : {}),
          },
          ...(section === "danger" ? { tone: "danger" as const } : {}),
          description: [{ text: offer.summary }],
        }));
      // A section title reads like every other; only a destructive item
      // is red.
      return items.length === 0 ? [] : [{
        title: DESK_ACTION_SECTION_TITLES[section],
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

/**
 * A launch named by what it does, and the sentence shown beneath the menu
 * while it is highlighted: what it does, and how to come back when the
 * provider documents it.
 */
function launchWords(
  launch: DeskAgentLaunch,
): { readonly label: string; readonly description: string } {
  const back = launch.exit === undefined
    ? ""
    : ` ${launch.exit} comes back here.`;
  return launch.kind === "continue"
    ? {
      label: "Continue",
      description: `Picks up the last conversation.${back}`,
    }
    : {
      label: "New session",
      description: `Starts a new conversation.${back}`,
    };
}

/** Why a configured agent can't open, in a few words beside its name. */
function unavailableWords(launch: DeskAgentLaunch): string {
  return launch.reason?.includes("PATH") === true
    ? "not on your PATH"
    : "unavailable";
}

/** What opening an agent does to the window, and what it shares. */
function agentFootnote(state: DeskProductState, row: DeskRow): string {
  const shared =
    row.decision.collisions.flatMap((collision) =>
      collision.kind === "changed_files"
        ? [
          `Shares ${collision.paths[0] ?? "files"} with ${
            taskTitleOf(state, collision.otherBranch)
          }.`,
        ]
        : []
    )[0];
  const brief = row.entry.task?.brief === undefined
    ? undefined
    : "A new session starts with the task's brief.";
  return [
    "The agent takes over this window. Exit it to come back here.",
    ...(shared === undefined ? [] : [shared]),
    ...(brief === undefined ? [] : [brief]),
  ].join(" ");
}

/**
 * Each configured agent's launches, by what they do, with the remembered
 * launch highlighted; agents that can't open are listed with why.
 */
export function agentsMenu(
  state: DeskProductState,
  taskId: string,
): ApplicationMenu<DeskIntent> {
  const ref = rowRef(state, taskId);
  if (ref?.kind !== "task") return goneMenu(state, "agents", taskId);
  const title = `${DESK_ACTION_LABELS.agent} in ${ref.row.task.name}`;
  if (!ref.row.discovered) {
    return {
      kind: "menu",
      id: "agents",
      scope: "item",
      title,
      aside: [{ text: "Finding agents…", tone: "faint" }],
      sections: [],
      footnote: [{ text: agentFootnote(state, ref.row) }],
    };
  }
  const launches = ref.row.agentLaunches;
  const providers = [
    ...new Set(launches.map((launch) => launch.providerLabel)),
  ];
  const remembered = rememberedLaunch(ref.row, state.preferences.last_agent);
  const available = providers.filter((provider) =>
    launches.some((launch) =>
      launch.providerLabel === provider && launch.availability !== "disabled"
    )
  );
  const unavailable = providers.flatMap((provider) => {
    const launch = launches.find((candidate) =>
      candidate.providerLabel === provider
    );
    return available.includes(provider) || launch === undefined ? [] : [{
      id: `unavailable:${provider}`,
      label: provider,
      sentence: launch.reason ?? unavailableWords(launch),
      reason: unavailableWords(launch),
    }];
  });
  // Continue first: it is what returning to a task usually wants.
  const order = (launch: DeskAgentLaunch): number =>
    launch.kind === "continue" ? 0 : 1;
  return {
    kind: "menu",
    id: "agents",
    scope: "item",
    title,
    ...(remembered === undefined ? {} : { initialItemId: remembered.id }),
    sections: available.map((provider, index) => ({
      title: provider,
      items: launches.filter((launch) =>
        launch.providerLabel === provider && launch.availability !== "disabled"
      ).sort((left, right) => order(left) - order(right)).map((launch) => {
        const words = launchWords(launch);
        return {
          id: launch.id,
          label: words.label,
          action: { kind: "launch", taskId, launch: launch.id },
          description: [{ text: words.description, tone: "faint" }],
        };
      }),
      // Inline, a row says why in a few words; Enter shows the remedy.
      ...(index === available.length - 1 && unavailable.length > 0
        ? { unavailable }
        : {}),
    })),
    ...(available.length === 0 && unavailable.length > 0
      ? { unavailable: { title: "Unavailable", items: unavailable } }
      : {}),
    footnote: [{ text: agentFootnote(state, ref.row) }],
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
