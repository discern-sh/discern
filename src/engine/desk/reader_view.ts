/**
 * The Desk's readers: full-height documents opened from the inbox, the
 * palette, or a task's actions. Every reader paints from the last
 * observation or from its own read, never a fresh survey; keys that lend the
 * terminal to a child (a shell, an editor, the pager) leave the reader open.
 * The keys reader is generated from the key map. Pure.
 */

import type {
  ApplicationActionHint,
  ApplicationDetailBlock,
  ApplicationGlyph,
  ApplicationReader,
  ApplicationRun,
} from "discern-design-system/cli/interactive";
import {
  createCliBlock,
  renderCodeBlockCli,
  renderMarkdownCli,
} from "discern-design-system/cli";
import {
  DESK_ACTION_LABELS,
  DESK_COMMAND_LABELS,
  withTrunk,
} from "../../shared/desk_vocabulary.ts";
import { plural } from "../../shared/result_markdown_values.ts";
import { proofHuman, queueHuman, relativeAge } from "../status/row_facts.ts";
import {
  COMMANDS_LABEL,
  DESK_KEYS,
  type DeskKeyBinding,
  type DeskRowLayer,
  JUMP_GROUP_READS,
} from "./keys.ts";
import { deskRowId } from "./model.ts";
import { DESK_GLYPHS } from "./glyphs.ts";
import type { DeskChangesEvidence } from "./contracts.ts";
import {
  activityEnding,
  activityOutputSummary,
  type DeskActivityEnding,
  type DeskIntent,
  type DeskLoad,
  type DeskMarkdownReading,
  type DeskProductState,
  type DeskReaderSubject,
} from "./desk_state.ts";
import { branchTitle, rowRef, sessionRead } from "./desk_transitions.ts";
import { type DeskCommandRead, readerReads } from "./commands.ts";
import { ageText, diffRuns, glyph, proofLineBlock } from "./inspector_view.ts";
import { inlineRuns } from "./header_view.ts";

/** What a reader reads besides product state. */
export interface DeskReaderEnv {
  readonly now: number;
  readonly root: string;
}

/** Plain muted text. */
function text(value: string): ApplicationDetailBlock {
  return { kind: "text", runs: [{ text: value }] };
}

/** A command, as code. */
function command(value: string): ApplicationDetailBlock {
  return { kind: "text", runs: [{ text: value, role: "code" }] };
}

/** Markdown rendered by the package. */
function markdown(source: string): ApplicationDetailBlock {
  return {
    kind: "block",
    content: createCliBlock(renderMarkdownCli, { source }),
  };
}

/** What Tip of the session says while the tasks it is chosen from can't be read. */
export const DESK_NO_TIP_YET = "This session has no tip yet.";

/**
 * What a view over the session's own reads shows while one of `reads` is
 * not ready: the tasks still loading or unreadable, or the session's tip
 * still being chosen or waiting on tasks that can't be read. Undefined once
 * every one is ready, so the view's own blocks fill in.
 */
export function awaitedBlocks(
  state: DeskProductState,
  reads: readonly DeskCommandRead[],
): ApplicationDetailBlock[] | undefined {
  for (const read of reads) {
    const status = sessionRead(state, read);
    if (status === "ready") continue;
    switch (read) {
      case "survey":
        return status === "failed"
          ? [{
            kind: "text",
            runs: [{ text: "Couldn't read tasks", tone: "warning" }],
          }]
          : [{ kind: "pending", label: "Loading tasks…" }];
      case "tip":
        return status === "failed"
          ? [{ kind: "text", runs: [{ text: DESK_NO_TIP_YET }] }]
          : [{ kind: "pending", label: "Choosing this session's tip…" }];
      default:
        // The manual opens in place of the desk, never in a reader.
        continue;
    }
  }
  return undefined;
}

/** A read that has not finished, failed, or produced its blocks. */
function loaded<T>(
  load: DeskLoad<T>,
  pending: string,
  blocks: (value: T) => ApplicationDetailBlock[],
): ApplicationDetailBlock[] {
  if (load.state === "loading") return [{ kind: "pending", label: pending }];
  if (load.state === "failed") {
    return [{
      kind: "text",
      runs: [{ text: load.error, tone: "warning" }],
    }];
  }
  return blocks(load.value);
}

/**
 * Bindings with one meaning, collected per label in key-map order; an
 * alternative the reader leaves to the manual is skipped.
 */
function keyItems(
  bindings: readonly DeskKeyBinding[],
  label: (binding: DeskKeyBinding) => string | undefined,
): { key: string[]; label: string }[] {
  const items: { key: string[]; label: string }[] = [];
  for (const binding of bindings) {
    if (binding.listed === false) continue;
    const words = label(binding);
    if (words === undefined) continue;
    const existing = items.find((item) => item.label === words);
    if (existing === undefined) {
      items.push({ key: [binding.key], label: words });
    } else existing.key.push(binding.key);
  }
  return items;
}

/**
 * Where each row other than a task's gives keys a meaning of its own, as the
 * keys reader's section titles say it.
 */
const ROW_PLACES = {
  commands: `On the ${COMMANDS_LABEL} row`,
  branch: "On a parked branch",
  landed: "On a landed task",
} as const satisfies Record<Exclude<DeskRowLayer, "inbox">, string>;

/**
 * The keys each row other than a task's gives a meaning the inbox's map
 * does not, by the place that means them: Enter on the Commands row opens
 * Commands rather than a next step. A place whose keys all mean what they
 * mean on a task has none.
 */
function rowOwnKeys(
  meaning: (binding: DeskKeyBinding) => string | undefined,
): { title: string; items: { key: string[]; label: string }[] }[] {
  return (Object.keys(ROW_PLACES) as (keyof typeof ROW_PLACES)[]).flatMap(
    (layer) => {
      const items = keyItems(DESK_KEYS[layer], (binding) => {
        const inbox = DESK_KEYS.inbox.find((candidate) =>
          candidate.key === binding.key
        );
        return inbox !== undefined &&
            JSON.stringify(inbox.meaning) === JSON.stringify(binding.meaning)
          ? undefined
          : meaning(binding);
      });
      return items.length === 0 ? [] : [{ title: ROW_PLACES[layer], items }];
    },
  );
}

/**
 * The keys reader: every key the inbox and a review answer to, and the
 * meanings other rows give keys.
 */
function keysReader(state: DeskProductState): ApplicationReader<DeskIntent> {
  const gesture = (names: readonly string[]) => (binding: DeskKeyBinding) =>
    binding.meaning.kind === "gesture" &&
      names.includes(binding.meaning.gesture)
      ? binding.meaning.reads ?? binding.meaning.label
      : undefined;
  // Parked's key is the number after the groups', so it reads with them.
  const parkedJump = (binding: DeskKeyBinding) =>
    binding.meaning.kind === "command" && binding.meaning.command === "parked"
      ? JUMP_GROUP_READS
      : undefined;
  const either = (
    ...labels: ((binding: DeskKeyBinding) => string | undefined)[]
  ) =>
  (binding: DeskKeyBinding) =>
    labels.reduce<string | undefined>(
      (found, label) => found ?? label(binding),
      undefined,
    );
  const section = (
    title: string,
    items: { key: string[]; label: string }[],
  ): ApplicationDetailBlock => ({
    kind: "section",
    title,
    blocks: [{ kind: "hints", items }],
  });
  return {
    kind: "reader",
    id: "reader-keys",
    scope: "global",
    title: DESK_COMMAND_LABELS.keys,
    columns: 2,
    blocks: [
      section("Move", [
        ...keyItems(DESK_KEYS.inbox, gesture(["move"])),
        ...keyItems(
          DESK_KEYS.inbox,
          gesture(["next-group", "previous-group"]),
        ),
        ...keyItems(
          DESK_KEYS.inbox,
          either(gesture(["jump-group"]), parkedJump),
        ),
        ...keyItems(DESK_KEYS.inbox, gesture(["first", "last"])),
        ...keyItems(DESK_KEYS.inbox, gesture(["details", "page"])),
      ]),
      section("Act", [
        ...keyItems(DESK_KEYS.inbox, gesture(["next-step", "actions"])),
        ...keyItems(DESK_KEYS.inbox, gesture(["filter", "palette"])),
        ...keyItems(
          DESK_KEYS.inbox,
          (binding) =>
            binding.meaning.kind === "command" &&
              parkedJump(binding) === undefined
              ? DESK_COMMAND_LABELS[binding.meaning.command]
              : undefined,
        ),
        ...keyItems(DESK_KEYS.inbox, gesture(["dismiss"])),
      ]),
      section(
        "Task",
        keyItems(
          DESK_KEYS.inbox,
          (binding) =>
            binding.meaning.kind === "action"
              ? withTrunk(
                DESK_ACTION_LABELS[binding.meaning.action],
                state.trunk,
              )
              : undefined,
        ),
      ),
      ...rowOwnKeys(either(
        gesture(["palette", "next-step", "actions"]),
        (binding) =>
          binding.meaning.kind === "command"
            ? DESK_COMMAND_LABELS[binding.meaning.command]
            : undefined,
      )).map(({ title, items }) => section(title, items)),
      section(
        "In a review",
        keyItems(
          DESK_KEYS.sheet,
          gesture([
            "previous-button",
            "next-button",
            "dismiss",
            "toggle-plan",
            "toggle-command",
          ]),
        ),
      ),
    ],
    keys: [{
      key: "m",
      label: DESK_COMMAND_LABELS.manual,
      action: { kind: "command", command: "manual" },
    }],
  };
}

/** The landing reader: the queue in words, any running landing, recent landings. */
function landingBlocks(
  state: DeskProductState,
  env: DeskReaderEnv,
): ApplicationDetailBlock[] {
  const data = state.data;
  const queue = data?.queue ?? [];
  const recent = data?.recent_completed_tasks ?? [];
  const outstanding = (data?.emergency_validation ?? []).filter((item) =>
    item.state === "outstanding"
  );
  return [
    {
      kind: "section",
      title: "Queue",
      count: queue.length,
      blocks: queue.length === 0 ? [text("Nothing is queued.")] : [{
        kind: "rows",
        lead: { id: "place", width: 3 },
        items: queue.map((item) => ({
          lead: [{ text: `#${item.position}`, tone: "faint" as const }],
          text: [
            { text: branchTitle(item.branch, data) },
            { text: " · ", ascii: " - ", tone: "faint" as const },
            {
              text: queueHuman(item).replace(/^#\d+ · /u, ""),
              tone: "muted" as const,
            },
          ],
        })),
      }],
    },
    ...(data?.operation === undefined ? [] : [{
      kind: "section" as const,
      title: "Running",
      blocks: [
        text(`${data.operation.verb} · ${data.operation.latest ?? "running"}`),
        command(`discern progress ${data.operation.handle}`),
      ],
    }]),
    ...(recent.length === 0 ? [] : [{
      kind: "section" as const,
      title: "Recent landings",
      count: recent.length,
      blocks: [{
        kind: "rows" as const,
        columns: [{ id: "age", width: 4, align: "end" as const }],
        items: recent.map((task) => ({
          text: [{ text: branchTitle(task.branch, data) }],
          cells: {
            age: [{
              text: ageText(task.completed_at, env.now),
              tone: "faint" as const,
            }],
          },
        })),
      }],
    }]),
    ...(outstanding.length === 0 ? [] : [{
      kind: "section" as const,
      title: "Emergency exceptions",
      count: outstanding.length,
      blocks: outstanding.map((item) => ({
        kind: "marks" as const,
        items: [{
          mark: glyph(DESK_GLYPHS.attention, "warning"),
          runs: [{ text: item.reason }],
          lines: [[{ text: item.next_action, tone: "muted" as const }]],
        }],
      })),
    }]),
  ];
}

/** The main checkout reader: changes, generated files, and fleet facts. */
function mainBlocks(
  state: DeskProductState,
  env: DeskReaderEnv,
): ApplicationDetailBlock[] {
  const data = state.data;
  const git = data?.git;
  const pending = data?.pending_tracked_refresh ?? [];
  const errors = data?.tracked_refresh_plan_errors ?? [];
  const tracked = git?.tracked_changes ?? 0;
  return [
    {
      kind: "facts",
      rows: [
        { label: "Path", value: [[{ text: env.root }]] },
        ...(git === undefined || git === null ? [] : [
          { label: "Branch", value: [[{ text: git.branch }]] },
          {
            label: "Changes",
            value: [[{
              text: git.clean
                ? "Clean"
                : tracked > 0
                ? plural(tracked, "tracked change")
                : plural(git.changed_files, "untracked file"),
              ...(tracked > 0 ? { tone: "warning" as const } : {}),
            }]],
          },
        ]),
        {
          label: "Generated",
          value: [[{
            text: pending.length === 0 && errors.length === 0
              ? "Up to date"
              : `${plural(pending.length, "file")} out of date`,
          }]],
        },
      ],
    },
    ...(pending.length === 0 && errors.length === 0 ? [] : [{
      kind: "section" as const,
      title: "Generated files out of date",
      blocks: [
        ...pending.map((path) => text(path)),
        ...errors.map((error) => ({
          kind: "text" as const,
          runs: [{ text: error, tone: "warning" as const }],
        })),
        command("discern refresh"),
      ],
    }]),
    ...(state.hints.length === 0 ? [] : [{
      kind: "section" as const,
      title: "Hints",
      blocks: state.hints.map((hint): ApplicationDetailBlock => ({
        kind: "text",
        runs: inlineRuns(hint),
      })),
    }]),
    ...((data?.adr_collisions ?? []).length === 0 ? [] : [{
      kind: "section" as const,
      title: "ADR numbers",
      blocks: (data?.adr_collisions ?? []).map((collision) =>
        text(`${collision.number} · ${collision.branches.join(", ")}`)
      ),
    }]),
    ...((data?.reappeared_worktree_paths ?? []).length === 0 ? [] : [{
      kind: "section" as const,
      title: "Removed checkouts that reappeared",
      blocks: [
        ...(data?.reappeared_worktree_paths ?? []).map((path) =>
          text(
            path.cleanup_blocked_reason === undefined
              ? path.path
              : `${path.path} · ${path.cleanup_blocked_reason}`,
          )
        ),
        command("discern worktree prune"),
      ],
    }]),
    ...((data?.contained_refs ?? []).length === 0 ? [] : [{
      kind: "section" as const,
      title: "Kept branches",
      blocks: (data?.contained_refs ?? []).map((ref) =>
        text(`${ref.branch} · kept until ${ref.contained_in} lands`)
      ),
    }]),
  ];
}

/** The mark an activity's ending leads with. */
function endingMark(ending: DeskActivityEnding): ApplicationGlyph {
  switch (ending) {
    case "done":
      return glyph(DESK_GLYPHS.done, "success");
    case "stopped":
      return glyph(DESK_GLYPHS.attention, "warning");
    case "didn't complete":
      return glyph(DESK_GLYPHS.failed, "danger");
  }
}

/**
 * This session's activity, newest first: each command exactly as it ran,
 * when and how it ended with its message, and the last lines it wrote.
 */
function activityBlocks(
  state: DeskProductState,
  env: DeskReaderEnv,
): ApplicationDetailBlock[] {
  if (state.activity.length === 0) {
    return [text("Nothing has run in this session yet.")];
  }
  return [{
    kind: "marks",
    items: [...state.activity].reverse().map((entry) => {
      const ending = activityEnding(entry);
      return {
        mark: endingMark(ending),
        runs: [{ text: entry.command, role: "code" as const }],
        lines: [
          [{
            text: [
              relativeAge(new Date(entry.at).toISOString(), env.now),
              ending,
              ...(entry.summary === undefined ? [] : [entry.summary]),
            ].join(" · "),
            tone: "muted" as const,
          }],
          ...activityOutputSummary(entry).map((line) => [{
            text: line,
            tone: "faint" as const,
          }]),
        ],
      };
    }),
  }];
}

/** A degraded task's recovery evidence. */
function recoveryBlocks(
  state: DeskProductState,
  taskId: string,
): ApplicationDetailBlock[] {
  const ref = rowRef(state, taskId);
  const recovery = ref?.kind === "task" ? ref.row.decision.recovery : undefined;
  if (recovery === undefined) {
    return [text("This task has nothing to recover.")];
  }
  return [
    text(recovery.failure),
    ...(recovery.failedCommand === undefined
      ? []
      : [command(recovery.failedCommand)]),
    {
      kind: "marks",
      items: [
        ...recovery.verified.map((line) => ({
          mark: glyph(DESK_GLYPHS.done, "success"),
          runs: [{ text: line }],
        })),
        ...recovery.unavailable.map((line) => ({
          mark: glyph(DESK_GLYPHS.attention, "warning"),
          runs: [{ text: line }],
        })),
      ],
    },
    {
      kind: "section",
      title: "Next",
      blocks: [text(recovery.nextStep), command(recovery.repairCommand)],
    },
  ];
}

/** View changes: Checks, the Proof, files, commits, and the stored Proof. */
function changesBlocks(
  state: DeskProductState,
  taskId: string,
  review: DeskChangesEvidence,
  env: DeskReaderEnv,
): ApplicationDetailBlock[] {
  const ref = rowRef(state, taskId);
  const authority = ref?.kind === "task"
    ? ref.row.decision.authority.summary
    : undefined;
  const proofLine = review.proof.proof_line ?? review.proof.proof_data?.line;
  const complete = review.proof.proof ?? review.proof.proof_data?.markdown;
  const totals: ApplicationRun[] = [
    { text: `${plural(review.files.length, "changed path")}  ` },
    ...diffRuns(review.insertions, review.deletions),
  ];
  return [
    {
      kind: "facts",
      rows: [
        {
          label: "Checks",
          value: [[{ text: proofHuman(review.proof, env.now) }]],
        },
        ...(authority === undefined
          ? []
          : [{ label: "Landing", value: [[{ text: authority }]] }]),
        { label: "Changes", value: [totals] },
        // The inspector shortens both; here they are whole, to copy.
        ...(ref?.kind === "task"
          ? [
            { label: "Path", value: [[{ text: ref.row.entry.path }]] },
            ...(ref.row.entry.branch === "" ? [] : [{
              label: "Branch",
              value: [[{ text: ref.row.entry.branch }]],
            }]),
          ]
          : []),
      ],
    },
    ...(proofLine === undefined ? [] : [proofLineBlock(proofLine)]),
    ...review.failures.map((failure): ApplicationDetailBlock => ({
      kind: "marks",
      items: [{
        mark: glyph(DESK_GLYPHS.attention, "warning"),
        runs: [{ text: failure.title }],
        lines: [[{ text: failure.detail, tone: "muted" }], [{
          text: failure.nextAction,
          tone: "muted",
        }]],
      }],
    })),
    {
      kind: "section",
      title: "Files",
      count: review.files.length,
      blocks: review.files.length === 0 ? [text("No changed files.")] : [{
        kind: "rows",
        lead: { id: "change", width: 1 },
        columns: [{ id: "lines", width: 12, align: "end", priority: 1 }],
        items: review.files.map((file) => ({
          lead: [
            file.disposition === "added"
              ? { text: "A", tone: "success" as const }
              : file.disposition === "removed"
              ? { text: "D", tone: "danger" as const }
              : { text: "M", tone: "muted" as const },
          ],
          text: [
            { text: file.path },
            ...(file.uncommitted
              ? [{ text: "  uncommitted", tone: "faint" as const }]
              : []),
          ],
          cells: {
            lines: file.added === undefined && file.removed === undefined
              ? []
              : diffRuns(file.added ?? 0, file.removed ?? 0),
          },
        })),
      }],
    },
    {
      kind: "section",
      title: "Commits",
      blocks: review.commits.trim() === ""
        ? [text(`No commits ahead of ${review.trunk}.`)]
        : review.commits.trim().split("\n").map((line) => text(line)),
    },
    ...(complete === undefined ? [] : [{
      kind: "section" as const,
      title: "Proof",
      blocks: [markdown(complete)],
    }]),
  ];
}

/** Keys of the View changes reader. */
function changesKeys(
  taskId: string,
  load: DeskLoad<DeskChangesEvidence>,
): ApplicationActionHint<DeskIntent>[] {
  return [
    {
      key: "o",
      label: "Full diff",
      action: { kind: "child", child: { kind: "diff", taskId } },
    },
    ...(load.state === "ready" && load.value.editor !== undefined
      ? [{
        key: "e",
        label: "Open in editor",
        action: {
          kind: "child" as const,
          child: { kind: "editor" as const, taskId },
        },
      }]
      : []),
    {
      key: "s",
      label: DESK_ACTION_LABELS.jump,
      action: { kind: "child", child: { kind: "shell", taskId } },
    },
  ];
}

/** What Escape does in a reader, in the key map's words. */
const READER_ESCAPE = ((): string => {
  const meaning = DESK_KEYS.reader.find((binding) => binding.key === "escape")
    ?.meaning;
  return meaning?.kind === "gesture" ? meaning.label : "Close";
})();

/** One reader layer. */
export function deskReader(
  state: DeskProductState,
  reader: DeskReaderSubject,
  env: DeskReaderEnv,
): ApplicationReader<DeskIntent> {
  return { ...readerLayer(state, reader, env), escapeLabel: READER_ESCAPE };
}

/**
 * One reader layer: its contents, or, while a read its command declares is
 * still loading, that read's pending line in their place.
 */
function readerLayer(
  state: DeskProductState,
  reader: DeskReaderSubject,
  env: DeskReaderEnv,
): ApplicationReader<DeskIntent> {
  const layer = readerContents(state, reader, env);
  const waiting = awaitedBlocks(state, readerReads(reader.kind));
  if (waiting === undefined) return layer;
  const { rows: _rows, footnote: _footnote, ...rest } = layer;
  return { ...rest, blocks: waiting };
}

/** One reader layer's contents. */
function readerContents(
  state: DeskProductState,
  reader: DeskReaderSubject,
  env: DeskReaderEnv,
): ApplicationReader<DeskIntent> {
  const id = `reader-${reader.kind}`;
  switch (reader.kind) {
    case "keys":
      return keysReader(state);
    case "tip":
      return {
        kind: "reader",
        id,
        scope: "global",
        title: DESK_COMMAND_LABELS.tip,
        blocks: [{
          kind: "text",
          runs: state.tip === undefined
            ? [{ text: "This session has no tip." }]
            : inlineRuns(state.tip.full),
        }],
        keys: [{
          key: "m",
          label: DESK_COMMAND_LABELS.manual,
          action: { kind: "command", command: "manual" },
        }],
      };
    case "landing":
      return {
        kind: "reader",
        id,
        scope: "global",
        title: DESK_COMMAND_LABELS.landing,
        blocks: landingBlocks(state, env),
      };
    case "main":
      return {
        kind: "reader",
        id,
        scope: "global",
        title: DESK_COMMAND_LABELS.main_checkout,
        blocks: mainBlocks(state, env),
        keys: [
          {
            key: "s",
            label: DESK_ACTION_LABELS.jump,
            action: { kind: "child", child: { kind: "shell" } },
          },
          {
            key: "o",
            label: "View diff",
            action: { kind: "child", child: { kind: "diff" } },
          },
          {
            key: "e",
            label: "Open in editor",
            action: { kind: "child", child: { kind: "editor" } },
          },
          {
            key: "x",
            label: DESK_COMMAND_LABELS.main_scripts,
            action: { kind: "command", command: "main_scripts" },
          },
        ],
      };
    case "activity":
      return {
        kind: "reader",
        id,
        scope: "global",
        title: DESK_COMMAND_LABELS.activity,
        blocks: activityBlocks(state, env),
      };
    case "recovery": {
      const ref = rowRef(state, reader.taskId);
      return {
        kind: "reader",
        id,
        scope: "item",
        title: `${DESK_ACTION_LABELS.recovery} for ${
          ref?.kind === "task" ? ref.row.task.name : reader.taskId
        }`,
        blocks: recoveryBlocks(state, reader.taskId),
        keys: [{
          key: "s",
          label: DESK_ACTION_LABELS.jump,
          action: {
            kind: "child",
            child: { kind: "shell", taskId: reader.taskId },
          },
        }],
      };
    }
    case "changes": {
      const ref = rowRef(state, reader.taskId);
      return {
        kind: "reader",
        id,
        scope: "item",
        title: ref?.kind === "task" ? ref.row.task.name : reader.taskId,
        aside: [{ text: DESK_ACTION_LABELS.inspect, tone: "faint" }],
        blocks: loaded(
          reader.load,
          "Reading changes…",
          (review) => changesBlocks(state, reader.taskId, review, env),
        ),
        keys: changesKeys(
          ref?.kind === "task" ? deskRowId(ref.row) : reader.taskId,
          reader.load,
        ),
      };
    }
    case "branch":
      return {
        kind: "reader",
        id,
        scope: "item",
        title: branchTitle(reader.branch, state.data),
        aside: [{ text: DESK_COMMAND_LABELS.branch_commits, tone: "faint" }],
        blocks: loaded(
          reader.load,
          "Reading commits…",
          (reading: DeskMarkdownReading) => [markdown(reading.markdown)],
        ),
      };
    case "landed":
      return {
        kind: "reader",
        id,
        scope: "item",
        title: DESK_COMMAND_LABELS.landed_proof,
        blocks: loaded(
          reader.load,
          "Reading the stored Proof…",
          (reading: DeskMarkdownReading) => [markdown(reading.markdown)],
        ),
      };
    case "notice":
      return {
        kind: "reader",
        id,
        scope: "global",
        title: reader.title,
        blocks: reader.lines.map((line) => text(line)),
      };
    case "opened":
      return {
        kind: "reader",
        id,
        scope: "global",
        title: reader.title,
        blocks: loaded(
          reader.load,
          `${reader.running}…`,
          (reading: DeskMarkdownReading) => [markdown(reading.markdown)],
        ),
      };
    case "output": {
      const operation = state.operations.get(reader.operationId);
      return {
        kind: "reader",
        id,
        scope: "global",
        title: operation?.title ?? "Output",
        aside: [{ text: "Full output", tone: "faint" }],
        blocks: operation === undefined
          ? [
            text(
              `It has ended; ${DESK_COMMAND_LABELS.activity} keeps how it ended and its last lines.`,
            ),
          ]
          : outputBlocks(operation.output, operation.command),
      };
    }
  }
}

/** What an operation wrote, after the command it runs. */
export function outputBlocks(
  output: string,
  command: string,
): ApplicationDetailBlock[] {
  return [
    { kind: "text", runs: [{ text: command, role: "code" }] },
    output.trim() === "" ? text("Nothing written yet.") : {
      kind: "block",
      content: createCliBlock(renderCodeBlockCli, {
        code: output.trimEnd(),
      }),
    },
  ];
}
