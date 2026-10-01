/** Product composition for the package-owned live Desk. */
import {
  createCliBlock,
  renderMarkdownCli,
  type TerminalSemanticTone,
} from "discern-design-system/cli";
import type {
  InteractionEntry,
  TerminalApplicationView,
} from "discern-design-system/cli/interactive";
import type { StatusData } from "../../shared/result_schemas.ts";
import {
  DESK_COMMAND_LABELS,
  type DeskCommand,
  labelName,
} from "../../shared/desk_vocabulary.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import type { FleetRowTone } from "../status/row_states.ts";
import {
  type DeskAction,
  type DeskActionOffer,
  type DeskRow,
  deskRowId,
} from "./model.ts";
import { commandDisclosure, DESK_COMMAND_REGISTRY } from "./commands.ts";
import { DESK_KEYS } from "./keys.ts";
import { deskLine, deskLiteral } from "./text.ts";

export type DeskPage =
  | "overview"
  | "task"
  | "more"
  | "details"
  | "help"
  | "tip"
  | "queue"
  | "notice";

/** Root destinations and effects this view offers. */
type DeskRoute =
  | DeskPage
  | "back"
  | "retry"
  | "quit"
  | "start"
  | "scripts"
  | "main"
  | "recent"
  | "releases"
  | "docs"
  | "unlanded";

export type DeskChoice =
  | { readonly kind: "task"; readonly id: string }
  | {
    readonly kind: "action";
    readonly id: string;
    readonly path: string;
    readonly branch: string;
    readonly action: DeskAction;
  }
  | {
    readonly kind: "route";
    readonly route: DeskRoute;
    readonly branch?: string;
  };
export interface DeskSnapshot {
  readonly data?: StatusData;
  readonly rows: readonly DeskRow[];
  readonly phase: "loading" | "fresh" | "refreshing" | "stale";
  readonly message?: string;
  readonly notice?: string;
  readonly tip?: string;
}

/** The commands this view offers, and the route each one opens. */
export const DESK_COMMAND_ROUTES = {
  new_task: "start",
  updates: "releases",
  main_scripts: "scripts",
  main_checkout: "main",
  landing: "queue",
  manual: "docs",
  tip: "tip",
  keys: "help",
  refresh: "retry",
  quit: "quit",
} as const satisfies Partial<Record<DeskCommand, DeskRoute>>;
type RoutedCommand = keyof typeof DESK_COMMAND_ROUTES;

/** Whether this view serves a command. */
export function isRoutedCommand(
  command: DeskCommand,
): command is RoutedCommand {
  return Object.hasOwn(DESK_COMMAND_ROUTES, command);
}

/** Routes a key can serve without leaving the view: pages, refresh, quit. */
type KeyRoute = "help" | "tip" | "queue" | "retry" | "quit";

/** Whether a route is one a key can serve. */
function isKeyRoute(target: DeskRoute): target is KeyRoute {
  return ["help", "tip", "queue", "retry", "quit"].includes(target);
}

/** The keys this view serves: inbox command keys whose route needs no
 * foreground handoff. */
export function deskShortcuts(): readonly {
  readonly key: string;
  readonly command: RoutedCommand;
  readonly route: KeyRoute;
}[] {
  return DESK_KEYS.inbox.flatMap((binding) => {
    if (
      binding.meaning.kind !== "command" ||
      !isRoutedCommand(binding.meaning.command)
    ) return [];
    const target = DESK_COMMAND_ROUTES[binding.meaning.command];
    return isKeyRoute(target)
      ? [{ key: binding.key, command: binding.meaning.command, route: target }]
      : [];
  });
}

/** The package tone for one status row tone; green stays reserved for landable work. */
const SEMANTIC_TONES = {
  accent: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
  muted: "neutral",
  faint: "neutral",
} as const satisfies Record<FleetRowTone, TerminalSemanticTone>;

/** The flag beside a row's state glyph when its files overlap another task's. */
const OVERLAP = { glyph: "⇄", ascii: "&" } as const;

/** Whether another task changes the same files or claims the same ADR. */
function overlaps(row: DeskRow): boolean {
  return row.decision.collisions.length > 0;
}

/** A semantic destination for one package choice. */
function route(
  label: string,
  target: DeskRoute,
  description?: string,
): InteractionEntry<DeskChoice> {
  return {
    id: target,
    label,
    value: { kind: "route", route: target },
    ...(description ? { description: deskLine(description) } : {}),
  };
}

/** One registered command, labelled and routed from its registry entry. */
function command(
  id: RoutedCommand,
  meta?: string,
  description?: string,
): InteractionEntry<DeskChoice> {
  return {
    ...route(
      DESK_COMMAND_REGISTRY[id].label,
      DESK_COMMAND_ROUTES[id],
      description,
    ),
    ...(meta === undefined
      ? {}
      : { status: { content: deskLine(meta), tone: "neutral" as const } }),
  };
}

/** A package Markdown block in a scrollable reading region. */
function reading(
  id: string,
  title: string,
  lines: readonly string[],
): {
  kind: "reading";
  id: string;
  title: string;
  content: ReturnType<typeof createCliBlock>;
} {
  return {
    kind: "reading",
    id,
    title,
    content: createCliBlock(renderMarkdownCli, { source: lines.join("\n\n") }),
  };
}

/** Capture identity and the registered action without treating the menu as consent. */
function actionEntry(
  row: DeskRow,
  offer: DeskActionOffer,
): InteractionEntry<DeskChoice> {
  return {
    id: offer.action,
    label: offer.label,
    description: deskLine(
      offer.availability === "disabled" ? offer.reason : offer.summary,
    ),
    ...(offer.availability === "disabled" ? { disabled: true } : {}),
    value: {
      kind: "action",
      id: deskRowId(row),
      path: row.entry.path,
      branch: row.entry.branch,
      action: offer.action,
    },
  };
}

/** The task's next step when it can run, then its other available steps. */
function stepOffers(row: DeskRow): DeskActionOffer[] {
  const next = row.decision.next;
  return [
    ...(next?.availability === "enabled" ? [next] : []),
    ...row.decision.also.filter((offer) => offer.action !== next?.action),
  ];
}

/** The state line: glyph, label, and its qualifier. */
function stateLine(row: DeskRow): string {
  const { decision } = row;
  return `${decision.glyph} ${decision.label}${
    decision.qualifier === undefined ? "" : ` · ${decision.qualifier}`
  }`;
}

/** Build immutable product views; no geometry, terminal I/O or discovery lives here. */
export function deskApplicationView(
  snapshot: DeskSnapshot,
  page: DeskPage,
  selectedId?: string,
): TerminalApplicationView<DeskChoice> {
  const { data, rows } = snapshot;
  const row = rows.find((candidate) => deskRowId(candidate) === selectedId);
  const phase = snapshot.phase === "stale"
    ? " · Stale — Retry"
    : snapshot.phase === "loading"
    ? " · Loading"
    : snapshot.phase === "refreshing"
    ? " · Refreshing"
    : "";
  const shortcuts = deskShortcuts();
  const keysShortcut = shortcuts.find((item) => item.command === "keys");
  const base = {
    title: deskLine(
      `discern · ${data?.project ?? "Desk"}${phase}${
        snapshot.message ? ` · ${snapshot.message}` : ""
      }`,
    ),
    ...(snapshot.tip ? { tip: deskLine(`Tip: ${snapshot.tip}`) } : {}),
    help: `Tab ${page === "overview" ? "commands" : "regions"}  / find  ${
      keysShortcut === undefined
        ? ""
        : `${keysShortcut.key} ${DESK_COMMAND_REGISTRY.keys.short}  `
    }Arrows move  Enter select`,
  };
  const back = route("Back", "back");
  if (
    page === "help" || page === "tip" || page === "queue" || page === "notice"
  ) {
    const lines = page === "notice"
      ? [
        deskLiteral(
          snapshot.notice ?? snapshot.message ?? "No current notice.",
        ),
      ]
      : page === "tip"
      ? [
        deskLiteral(
          snapshot.tip ?? "A tip will appear after the first observation.",
        ),
        `Choose ${DESK_COMMAND_LABELS.manual} from "Desk commands" for more information.`,
      ]
      : page === "help"
      ? [
        "Arrow keys move; Page Up/Down and Home/End reach the rest of a collection. Enter chooses. Tab switches regions, including regions hidden by a small viewport.",
        "Press / to find a task. Type to filter; Enter returns to navigation, Escape clears the filter. Typing never runs global shortcuts.",
        "Escape goes Back, then exits from the overview.",
        ...shortcuts.map((item) =>
          `${deskLiteral(item.key)} — ${
            DESK_COMMAND_REGISTRY[item.command].label
          }`
        ),
      ]
      : [
        ...(snapshot.message ? [deskLiteral(snapshot.message)] : []),
        ...(data?.queue ?? []).map((item) =>
          deskLiteral(
            `${item.position}. ${item.branch} · ${item.head} · ${item.readiness} · ${item.authority}${
              item.reason ? ` · ${item.reason}` : ""
            }${item.operation_handle ? ` · ${item.operation_handle}` : ""}`,
          )
        ),
        ...((data?.queue?.length ?? 0) === 0
          ? ["No submissions in the landing queue."]
          : []),
        ...(data?.operation
          ? [
            deskLiteral(
              `${data.operation.verb} · ${data.operation.handle} · ${
                data.operation.latest ?? "Running"
              }`,
            ),
          ]
          : []),
        ...(data?.emergency_validation ?? []).filter((item) =>
          item.state === "outstanding"
        ).map((item) =>
          deskLiteral(
            `Outstanding emergency exception: ${item.reason} · ${item.next_action}`,
          )
        ),
      ];
    return {
      ...base,
      regions: [
        reading(
          page,
          page === "help"
            ? DESK_COMMAND_LABELS.keys
            : page === "tip"
            ? DESK_COMMAND_LABELS.tip
            : page === "notice"
            ? "Action result"
            : DESK_COMMAND_LABELS.landing,
          lines,
        ),
        {
          kind: "choices",
          id: "reader-back",
          title: "Navigation",
          entries: [back],
        },
      ],
    };
  }
  if (row !== undefined && page !== "overview") {
    const summary = [
      ...(snapshot.message ? [snapshot.message] : []),
      stateLine(row),
      row.decision.explanation,
    ];
    const steps = stepOffers(row);
    const entries = page === "more"
      ? row.decision.actions
        .filter((offer) => !steps.some((step) => step.action === offer.action))
        .map((offer) => actionEntry(row, offer))
      : steps.map((offer) => actionEntry(row, offer));
    const detailLines = [
      ...summary,
      `Branch: ${row.entry.branch}`,
      `Path: ${row.entry.path}`,
      `Identity: ${deskRowId(row)}`,
      ...(data?.queue?.filter((item) =>
        item.branch === row.entry.branch && item.reason
      ).map((item) => `Queue: ${item.reason}`) ?? []),
      ...(row.entry.task?.brief ? [row.entry.task.brief] : []),
      ...row.decision.details.map((detail) => detail.text),
      ...(row.decision.proof.line ? [row.decision.proof.line] : []),
      ...(row.capabilityError ? [row.capabilityError] : []),
    ].map(deskLiteral);
    return {
      ...base,
      title: deskLine(
        `${row.task.name}${phase}${
          snapshot.message ? ` · ${snapshot.message}` : ""
        }`,
      ),
      regions: [
        {
          kind: "choices",
          id: `task:${deskRowId(row)}:${page === "more" ? "more" : "actions"}`,
          title: page === "more"
            ? "More actions"
            : deskLine(`Task controls · ${row.decision.label}`),
          search: true,
          entries: [
            ...entries,
            ...(page === "more" ? [] : [
              route("Task details", "details"),
              route("More actions", "more"),
            ]),
            back,
          ],
        },
        reading(
          `task:${deskRowId(row)}:${
            page === "details" ? "details" : "summary"
          }`,
          page === "details" ? "Task details" : "Current work",
          page === "details" ? detailLines : [
            ...summary,
            ...(row.decision.collisions.length
              ? ["Advisory overlaps · Task details"]
              : []),
          ].map(deskLiteral),
        ),
      ],
    };
  }
  const titles = new Map<string, number>();
  for (const task of rows) {
    titles.set(task.task.name, (titles.get(task.task.name) ?? 0) + 1);
  }
  const tasks: InteractionEntry<DeskChoice>[] = rows.map((row) => ({
    id: deskRowId(row),
    label: deskLine(
      `${row.task.name}${
        (titles.get(row.task.name) ?? 0) > 1 ? ` (${deskRowId(row)})` : ""
      } · ${
        row.entry.running
          ? `${row.entry.running.verb} running`
          : row.decision.activity.summary
      }`,
    ),
    value: { kind: "task", id: deskRowId(row) },
    // The state's glyph, then the overlap flag when another task changes the
    // same files.
    indicator: {
      content: `${row.decision.glyph}${overlaps(row) ? OVERLAP.glyph : ""}`,
      ascii: `${row.decision.ascii}${overlaps(row) ? OVERLAP.ascii : ""}`,
      tone: SEMANTIC_TONES[row.decision.tones.glyph],
    },
    status: {
      content: deskLine(row.decision.label),
      tone: SEMANTIC_TONES[row.decision.tones.label],
    },
  }));
  const facts = {
    ...(data === undefined ? {} : { data }),
    version: DISCERN_VERSION,
    ...(data?.git?.trunk === undefined ? {} : { trunk: data.git.trunk }),
  };
  const resume = labelName(DESK_COMMAND_LABELS.resume);
  const commands: InteractionEntry<DeskChoice>[] = [
    command("new_task"),
    command(
      "updates",
      DESK_COMMAND_REGISTRY.updates.meta(facts),
      commandDisclosure("updates", facts),
    ),
    command("main_scripts"),
    command("main_checkout", DESK_COMMAND_REGISTRY.main_checkout.meta(facts)),
    command("landing", DESK_COMMAND_REGISTRY.landing.meta(facts)),
    route("Recent completed tasks", "recent"),
    command("manual"),
    command("tip"),
    command("keys"),
    command("refresh"),
    ...(data?.unlanded_branches ?? []).map((branch) => ({
      id: `unlanded:${branch}`,
      label: deskLine(`${resume} ${branch}…`),
      value: { kind: "route" as const, route: "unlanded" as const, branch },
    })),
    command("quit"),
  ];
  return {
    ...base,
    regions: [{
      kind: "choices",
      id: "tasks",
      title: snapshot.phase === "loading"
        ? "Loading tasks..."
        : rows.length === 0
        ? snapshot.phase === "stale"
          ? "Tasks unavailable · Retry"
          : "No tasks yet"
        : `Tasks (${rows.length})`,
      search: true,
      entries: tasks.length
        ? tasks
        : [command("new_task"), route("Retry observation", "retry")],
    }, {
      kind: "choices",
      id: "desk",
      title: data?.operation
        ? `Desk · ${data.operation.verb} running`
        : data?.emergency_validation?.some((item) =>
            item.state === "outstanding"
          )
        ? "Desk · emergency exception"
        : "Desk commands",
      search: true,
      entries: commands,
    }],
  };
}
