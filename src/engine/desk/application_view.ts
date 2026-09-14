/** Product composition for the package-owned live Desk. */
import { createCliBlock, renderMarkdownCli } from "discern-design-system/cli";
import type {
  InteractionEntry,
  TerminalApplicationView,
} from "discern-design-system/cli/interactive";
import type { StatusData } from "../../shared/result_schemas.ts";
import { terminalLine } from "../../lib/terminal.ts";
import {
  DESK_ACTIONS,
  type DeskAction,
  type DeskRow,
  deskRowId,
} from "./model.ts";

/** The product key map drives shortcut handling and visible help. */
export const DESK_KEYS = [
  { key: "?", label: "Help", route: "help" },
  { key: "r", label: "Refresh", route: "retry" },
  { key: "t", label: "Tip", route: "tip" },
  { key: "q", label: "Quit", route: "quit" },
] as const;
export type DeskPage =
  | "overview"
  | "task"
  | "more"
  | "details"
  | "help"
  | "tip"
  | "queue"
  | "notice";
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
    readonly route:
      | DeskPage
      | "back"
      | "retry"
      | "quit"
      | "start"
      | "scripts"
      | "main"
      | "recent"
      | "docs"
      | "unlanded";
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
const PRIMARY = [
  "agent",
  "scripts",
  "grant",
  "revoke_grant",
  "accept",
  "drop",
] as const satisfies readonly DeskAction[];
/** A semantic destination for one package choice. */
function route(
  label: string,
  target: Extract<DeskChoice, { kind: "route" }>["route"],
  description?: string,
): InteractionEntry<DeskChoice> {
  return {
    id: target,
    label,
    value: { kind: "route", route: target },
    ...(description ? { description: terminalLine(description) } : {}),
  };
}
/** Escape observed text before using it in a reading Component. */
function literal(text: string): string {
  return terminalLine(text).replace(/[\\`*_{}\[\]<>#|]/gu, "\\$&");
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
/** Compact Proof vocabulary; validity never implies permission or submission. */
export function deskProofLabel(row: DeskRow): string {
  switch (row.decision.proof.status) {
    case "honored":
      return "Proof valid";
    case "missing":
      return "No Proof";
    case "stale":
      return "Proof stale";
    case "dirty":
      return "Proof: edited";
    case "report_only":
      return "Report only";
    case "read_failed":
      return "Proof unreadable";
    case "unavailable":
      return "Proof unknown";
  }
}
/** Preserve the status-projected exact submission, including older submitted work. */
export function deskSubmission(
  row: DeskRow,
  data: StatusData | undefined,
): string {
  const submission = data?.queue?.find((item) =>
    item.branch === row.entry.branch
  );
  return submission === undefined
    ? "Not submitted"
    : `Submitted ${submission.head.slice(0, 12)} · ${submission.readiness}${
      submission.reason ? ` · ${submission.reason}` : ""
    }`;
}
/** Capture identity and the registered action without treating the menu as consent. */
function actionEntry(
  row: DeskRow,
  action: DeskAction,
): InteractionEntry<DeskChoice> {
  const offer = row.decision.actions.find((item) => item.action === action);
  if (offer === undefined) throw new TypeError(`Missing Desk action ${action}`);
  return {
    id: action,
    label: offer.label,
    value: {
      kind: "action",
      id: deskRowId(row),
      path: row.entry.path,
      branch: row.entry.branch,
      action,
    },
  };
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
  const base = {
    title: terminalLine(
      `discern · ${data?.project ?? "Desk"}${phase}${
        snapshot.message ? ` · ${snapshot.message}` : ""
      }`,
    ),
    ...(snapshot.tip ? { tip: terminalLine(`Tip: ${snapshot.tip}`) } : {}),
    help: `↑↓ move  Enter  Tab  / find  ${DESK_KEYS[0].key} help`,
  };
  const back = route("Back", "back");
  if (
    page === "help" || page === "tip" || page === "queue" || page === "notice"
  ) {
    const lines = page === "notice"
      ? [literal(snapshot.notice ?? snapshot.message ?? "No current notice.")]
      : page === "tip"
      ? [
        literal(
          snapshot.tip ?? "A tip will appear after the first observation.",
        ),
        "Read the manual from Desk commands for more information.",
      ]
      : page === "help"
      ? [
        "Arrow keys move; Page Up/Down and Home/End reach the rest of a collection. Enter chooses. Tab switches regions, including regions hidden by a small viewport.",
        "Press / to find a task. Type to filter; Enter returns to navigation, Escape clears the filter. Typing never runs global shortcuts.",
        "Escape goes Back, then exits from the overview.",
        ...DESK_KEYS.map((key) => `${key.key} — ${key.label}`),
      ]
      : [
        ...(snapshot.message ? [literal(snapshot.message)] : []),
        ...(data?.queue ?? []).map((item) =>
          literal(
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
            literal(
              `${data.operation.verb} · ${data.operation.handle} · ${
                data.operation.latest ?? "Running"
              }`,
            ),
          ]
          : []),
        ...(data?.emergency_validation ?? []).filter((item) =>
          item.state === "outstanding"
        ).map((item) =>
          literal(
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
            ? "Keyboard help"
            : page === "tip"
            ? "Tip"
            : page === "notice"
            ? "Action result"
            : "Landing queue",
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
      row.decision.activity.summary,
      deskProofLabel(row),
      row.decision.authority.summary,
      deskSubmission(row, data),
    ];
    const primary = PRIMARY.filter((action) =>
      action === "grant"
        ? row.decision.authority.source !== "effort-grant"
        : action === "revoke_grant"
        ? row.decision.authority.source === "effort-grant"
        : true
    );
    const entries = page === "more"
      ? DESK_ACTIONS.filter((action) =>
        !PRIMARY.includes(action as typeof PRIMARY[number])
      ).map((action) => actionEntry(row, action))
      : primary.map((action) => actionEntry(row, action));
    const detailLines = [
      ...summary,
      `Branch: ${row.entry.branch}`,
      `Path: ${row.entry.path}`,
      `Identity: ${deskRowId(row)}`,
      ...(row.entry.task?.brief ? [row.entry.task.brief] : []),
      ...row.decision.details.map((detail) => detail.text),
      ...(row.decision.proof.line ? [row.decision.proof.line] : []),
      ...(row.capabilityError ? [row.capabilityError] : []),
    ].map(literal);
    return {
      ...base,
      title: terminalLine(
        `${row.task.name}${phase}${
          snapshot.message ? ` · ${snapshot.message}` : ""
        }`,
      ),
      regions: [
        {
          kind: "choices",
          id: `task:${deskRowId(row)}:${page === "more" ? "more" : "actions"}`,
          title: page === "more" ? "More actions" : "Task controls",
          search: true,
          entries: [
            ...entries,
            ...(page === "more" ? [] : [
              route("Proof and details", "details"),
              route("More actions", "more"),
            ]),
            back,
          ],
        },
        reading(
          `task:${deskRowId(row)}:${
            page === "details" ? "details" : "summary"
          }`,
          page === "details" ? "Proof and details" : "Current work",
          page === "details" ? detailLines : [
            ...summary,
            ...(row.decision.collisions.length
              ? ["Advisory overlaps · Proof and details"]
              : []),
          ].map(literal),
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
    label: terminalLine(
      `${row.task.name}${
        (titles.get(row.task.name) ?? 0) > 1 ? ` (${deskRowId(row)})` : ""
      } · ${
        row.entry.running
          ? `${row.entry.running.verb} running`
          : row.decision.activity.summary
      }`,
    ),
    value: { kind: "task", id: deskRowId(row) },
    status: {
      content: deskProofLabel(row),
      tone: row.decision.proof.honored ? "success" : "neutral",
    },
    ...(row.decision.collisions.length
      ? { indicator: { content: "i", ascii: "i", tone: "neutral" as const } }
      : {}),
  }));
  const commands: InteractionEntry<DeskChoice>[] = [
    ...(snapshot.notice || snapshot.message
      ? [route("Read notice", "notice")]
      : []),
    route("Start a task", "start"),
    route("Project Scripts", "scripts"),
    route("Main checkout", "main"),
    route(`Landing queue (${data?.queue?.length ?? 0})`, "queue"),
    route("Recent completed tasks", "recent"),
    route("Read the manual", "docs"),
    route("Read this Tip", "tip"),
    route("Keyboard help", "help"),
    route(snapshot.phase === "stale" ? "Retry" : "Refresh", "retry"),
    ...(data?.unlanded_branches ?? []).map((branch) => ({
      id: `unlanded:${branch}`,
      label: terminalLine(`Resume ${branch}`),
      value: { kind: "route" as const, route: "unlanded" as const, branch },
    })),
    route("Quit", "quit"),
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
        : [route("Start a task", "start"), route("Retry observation", "retry")],
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
