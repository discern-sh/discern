/**
 * The compact terminal projection for `discern done`: planned jobs appear
 * before execution, update as the scheduler settles them, and finish beside
 * the receipt line for the exact tree they judged.
 *
 * This is presentation only. The result envelope still owns every fact, and
 * the stored Markdown receipt stays the page rendered by `status --verbose`.
 */

import { displayWidth, padDisplayEnd, wrapText } from "../../lib/text.ts";
import type { StepOutcome, StepResult } from "../../shared/result.ts";
import type { Receipt } from "../../shared/result_schemas.ts";
import type { JobRunObserver } from "../jobs/runner.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import { type Palette, palette } from "../output.ts";
import type { GatePlan } from "./plan.ts";
import { fmtDuration } from "./receipt_render.ts";

const INDENT = "  ";
const GUTTER = "  ";
const MAX_REPORT_WIDTH = 120;
const MIN_THREE_COLUMN_WIDTH = 44;

// The reference treatment uses a brighter success green and a restrained green
// panel. They stay local to this projection; `color: false` emits none of these
// styling escapes.
const SUCCESS = "\x1b[38;2;52;211;121m";
const SUCCESS_BACKGROUND = "\x1b[48;2;12;29;27m";
const RECEIPT_TEXT = "\x1b[38;2;238;239;244m";

export interface DoneTtyOptions {
  /** Full terminal width in visible columns. */
  width: number;
  /** Whether ANSI color is enabled. */
  color: boolean;
}

type DoneRowTone = StepOutcome | "pending" | "running";

interface DoneRow {
  job: string;
  command: string;
  result: string;
  tone: DoneRowTone;
}

/** Report the width. */
function reportWidth(width: number): number {
  const terminal = Number.isFinite(width) ? Math.floor(width) : 80;
  return Math.max(
    1,
    Math.min(MAX_REPORT_WIDTH, terminal - displayWidth(INDENT)),
  );
}

/** Return the done rows. */
function doneRows(steps: readonly StepResult[]): DoneRow[] {
  return steps
    .filter((result) =>
      result.step.kind === "job" || result.step.kind === "scope-gate"
    )
    .map((result) => {
      const ran = result.step.disposition === "run";
      const duration = ran && result.durationS !== undefined
        ? ` · ${fmtDuration(result.durationS)}`
        : "";
      return {
        job: result.step.label,
        command: ran
          ? result.step.note ?? result.step.label
          : result.step.note ?? "—",
        result: `${result.outcome}${duration}`,
        tone: result.outcome,
      };
    });
}

/** Return the job outcome. */
function jobOutcome(result: JobResult): StepOutcome {
  if (result.cancelled === true) {
    return "cancelled";
  }
  return result.code === 0 ? "ok" : "failed";
}

/** Return the planned rows. */
function plannedRows(
  plan: GatePlan,
  running: ReadonlySet<string>,
  results: ReadonlyMap<string, JobResult>,
): DoneRow[] {
  return plan.groups.flatMap((group) =>
    group.jobs
      .filter((job) => job.kind !== "standard")
      .map((job): DoneRow => {
        const settled = results.get(job.label);
        if (settled !== undefined) {
          const outcome = jobOutcome(settled);
          return {
            job: job.label,
            command: job.command,
            result: `${outcome} · ${fmtDuration(settled.durationS)}`,
            tone: outcome,
          };
        }
        if (running.has(job.label)) {
          return {
            job: job.label,
            command: job.command,
            result: "running",
            tone: "running",
          };
        }
        if (!job.willRun) {
          return {
            job: job.label,
            command: job.command,
            result: "skipped",
            tone: "skipped",
          };
        }
        return {
          job: job.label,
          command: job.command,
          result: "pending",
          tone: "pending",
        };
      })
  );
}

/** Return the row style. */
function rowStyle(
  tone: DoneRowTone,
  color: boolean,
  c: Palette,
): string {
  if (!color) {
    return "";
  }
  switch (tone) {
    case "ok":
      return SUCCESS;
    case "failed":
      return c.red;
    case "cancelled":
      return c.yellow;
    case "skipped":
    case "pending":
      return c.dim;
    case "running":
      return c.cyan;
  }
}

/** Return the styled. */
function styled(
  value: string,
  style: string,
  reset: string,
): string {
  return style === "" ? value : `${style}${value}${reset}`;
}

/** Return the rule. */
function rule(width: number, c: Palette): string {
  return `${INDENT}${styled("─".repeat(width), c.dim, c.reset)}`;
}

/** Render the compact table. */
function renderCompactTable(
  rows: readonly DoneRow[],
  width: number,
  color: boolean,
  c: Palette,
): string[] {
  const lines = [
    `${INDENT}${styled("JOB / RESULT", c.dim, c.reset)}`,
    rule(width, c),
  ];
  if (rows.length === 0) {
    lines.push(
      ...wrapText("(no job is wired — nothing ran)", width)
        .map((line) => `${INDENT}${line}`),
      rule(width, c),
    );
    return lines;
  }
  for (const row of rows) {
    const result = styled(
      row.result,
      rowStyle(row.tone, color, c),
      c.reset,
    );
    lines.push(`${INDENT}${row.job}  ${result}`);
    lines.push(
      ...wrapText(row.command, Math.max(1, width - 2))
        .map((line) => `${INDENT}  ${line}`),
      rule(width, c),
    );
  }
  return lines;
}

/** Render the three column table. */
function renderThreeColumnTable(
  rows: readonly DoneRow[],
  width: number,
  color: boolean,
  c: Palette,
): string[] {
  const resultWidth = Math.max(12, Math.floor(width * 0.2));
  const jobWidth = Math.max(10, Math.floor(width * 0.24));
  const commandWidth = Math.max(
    1,
    width - jobWidth - resultWidth - (2 * displayWidth(GUTTER)),
  );
  const line = (
    job: string,
    command: string,
    result: string,
  ): string =>
    `${INDENT}${padDisplayEnd(job, jobWidth)}${GUTTER}${
      padDisplayEnd(command, commandWidth)
    }${GUTTER}${result}`;

  const lines = [
    styled(line("JOB", "COMMAND", "RESULT"), c.dim, c.reset),
    rule(width, c),
  ];
  if (rows.length === 0) {
    lines.push(
      ...wrapText("(no job is wired — nothing ran)", width)
        .map((value) => `${INDENT}${value}`),
      rule(width, c),
    );
    return lines;
  }

  for (const row of rows) {
    const jobs = wrapText(row.job, jobWidth);
    const commands = wrapText(row.command, commandWidth);
    const height = Math.max(jobs.length, commands.length);
    for (let index = 0; index < height; index++) {
      const job = padDisplayEnd(jobs[index] ?? "", jobWidth);
      const command = padDisplayEnd(commands[index] ?? "", commandWidth);
      const result = index === 0
        ? styled(
          row.result,
          rowStyle(row.tone, color, c),
          c.reset,
        )
        : "";
      lines.push(
        line(
          styled(job, c.dim, c.reset),
          command,
          result,
        ),
      );
    }
    lines.push(rule(width, c));
  }
  return lines;
}

/** Render the rows. */
function renderRows(
  rows: readonly DoneRow[],
  options: DoneTtyOptions,
): string {
  const width = reportWidth(options.width);
  const c = palette(options.color);
  const lines = width < MIN_THREE_COLUMN_WIDTH
    ? renderCompactTable(rows, width, options.color, c)
    : renderThreeColumnTable(rows, width, options.color, c);
  return lines.join("\n");
}

/**
 * Render the `JOB / COMMAND / RESULT` table from executed envelope steps.
 * Narrow terminals use a stacked row so no column is squeezed into noise.
 */
export function renderDoneTtyTable(
  steps: readonly StepResult[],
  options: DoneTtyOptions,
): string {
  return renderRows(doneRows(steps), options);
}

/**
 * Render the current live table from the planned jobs and scheduler events.
 * Standards stay in the receipt rather than becoming duplicate job rows.
 */
export function renderDoneTtyProgressTable(
  plan: GatePlan,
  running: ReadonlySet<string>,
  results: ReadonlyMap<string, JobResult>,
  options: DoneTtyOptions,
): string {
  return renderRows(plannedRows(plan, running, results), options);
}

/** The effectful controller that keeps one live table in place on a TTY. */
export interface DoneTtyProgress extends JobRunObserver {
  start(plan: GatePlan): void;
  replacePlan(plan: GatePlan): void;
  complete(steps: readonly StepResult[]): void;
}

/**
 * Create one in-place TTY table. Colour SGR sequences follow `options.color`;
 * cursor movement remains active in no-colour mode because it is layout, not
 * styling.
 */
export function createDoneTtyProgress(
  write: (value: string) => void,
  options: DoneTtyOptions,
): DoneTtyProgress {
  const running = new Set<string>();
  const results = new Map<string, JobResult>();
  let plan: GatePlan | undefined;
  let visible = new Set<string>();
  let renderedLines = 0;
  let redrawQueued = false;
  let completed = false;

  const replace = (table: string): void => {
    if (renderedLines === 0) {
      write(`\n${table}\n`);
    } else {
      write(`\x1b[${renderedLines}A\r\x1b[J${table}\n`);
    }
    renderedLines = table.split("\n").length;
  };

  const redraw = (): void => {
    if (plan === undefined || completed) {
      return;
    }
    replace(renderDoneTtyProgressTable(plan, running, results, options));
  };

  const queueRedraw = (): void => {
    if (redrawQueued || completed) {
      return;
    }
    redrawQueued = true;
    queueMicrotask(() => {
      redrawQueued = false;
      redraw();
    });
  };

  const setPlan = (next: GatePlan): void => {
    plan = next;
    visible = new Set(
      next.groups.flatMap((group) =>
        group.jobs
          .filter((job) => job.kind !== "standard")
          .map((job) => job.label)
      ),
    );
  };

  return {
    start: (next: GatePlan): void => {
      setPlan(next);
      redraw();
    },
    replacePlan: (next: GatePlan): void => {
      if (completed) {
        return;
      }
      setPlan(next);
      redraw();
    },
    started: (job: Job): void => {
      if (!visible.has(job.label) || completed) {
        return;
      }
      running.add(job.label);
      queueRedraw();
    },
    settled: (result: JobResult): void => {
      if (!visible.has(result.label) || completed) {
        return;
      }
      running.delete(result.label);
      results.set(result.label, result);
      queueRedraw();
    },
    complete: (steps: readonly StepResult[]): void => {
      completed = true;
      replace(renderDoneTtyTable(steps, options));
    },
  };
}

/** Render the receipt panel. */
function renderReceiptPanel(
  line: string,
  options: DoneTtyOptions,
): string {
  const width = reportWidth(options.width);
  const textWidth = Math.max(1, width - 5);
  const lines = ["", ...wrapText(line, textWidth), ""];
  if (!options.color) {
    return lines.map((value) => `${INDENT}│  ${value}`).join("\n");
  }
  return lines.map((value) =>
    `${INDENT}${SUCCESS}▌\x1b[0m${SUCCESS_BACKGROUND}${RECEIPT_TEXT}  ${
      padDisplayEnd(value, textWidth)
    }  \x1b[0m`
  ).join("\n");
}

/** Render the highlighted receipt panel that follows a completed live table. */
export function renderDoneTtyReceiptPanel(
  receipt: Receipt,
  options: DoneTtyOptions,
): string {
  return renderReceiptPanel(receipt.line, options);
}

/** Render the complete green TTY tail: job table, then highlighted receipt. */
export function renderDoneTtySummary(
  steps: readonly StepResult[],
  receipt: Receipt,
  options: DoneTtyOptions,
): string {
  return `${renderDoneTtyTable(steps, options)}\n\n${
    renderDoneTtyReceiptPanel(receipt, options)
  }`;
}
