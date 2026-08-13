/**
 * The compact terminal projection for planned gate jobs. Jobs appear before
 * execution, update as the scheduler settles them, and finish from the
 * serialized result steps.
 *
 * This is presentation only. The scheduler and result envelope own every fact.
 */

import {
  displayWidth,
  padDisplayEnd,
  terminalWidth,
  wrapText,
} from "../../lib/text.ts";
import type { StepOutcome, StepResult } from "../../shared/result.ts";
import type { JobRunObserver } from "../jobs/runner.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import { type Palette, palette } from "../output.ts";
import type { JobGroup } from "./plan.ts";
import { fmtDuration } from "./proof_render.ts";

const INDENT = "  ";
const GUTTER = "  ";
const MAX_REPORT_WIDTH = 120;
const MIN_THREE_COLUMN_WIDTH = 44;

/** The success treatment shared by gate-job rows and verb-specific tails. */
export const GATE_TTY_SUCCESS = "\x1b[38;2;52;211;121m";

export interface GateTtyOptions {
  /** Full terminal width in visible columns. */
  width: number;
  /** Whether ANSI color is enabled. */
  color: boolean;
}

type GateRowTone = StepOutcome | "pending" | "running";

interface GateRow {
  job: string;
  command: string;
  result: string;
  tone: GateRowTone;
}

/** Bound the report to the usable terminal width while retaining a readable minimum. */
export function gateReportWidth(width: number): number {
  const terminal = Number.isFinite(width) ? Math.floor(width) : 80;
  return Math.max(
    1,
    Math.min(MAX_REPORT_WIDTH, terminal - displayWidth(INDENT)),
  );
}

/** Project completed jobs and scope gates into the common report-row model. */
function completedRows(steps: readonly StepResult[]): GateRow[] {
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

/** Map scheduler status and exit code to the human outcome vocabulary. */
function jobOutcome(result: JobResult): StepOutcome {
  if (result.cancelled === true) {
    return "cancelled";
  }
  return result.code === 0 ? "ok" : "failed";
}

/** Project planned groups and scheduler state without implying pending jobs ran. */
function plannedRows(
  groups: readonly JobGroup[],
  running: ReadonlySet<string>,
  results: ReadonlyMap<string, JobResult>,
): GateRow[] {
  return groups.flatMap((group) =>
    group.jobs
      .filter((job) => job.kind !== "standard")
      .map((job): GateRow => {
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

/** Choose the ANSI treatment associated with one outcome. */
function rowStyle(
  tone: GateRowTone,
  color: boolean,
  c: Palette,
): string {
  if (!color) {
    return "";
  }
  switch (tone) {
    case "ok":
      return GATE_TTY_SUCCESS;
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

/** Apply a row style only when color output is enabled. */
function styled(
  value: string,
  style: string,
  reset: string,
): string {
  return style === "" ? value : `${style}${value}${reset}`;
}

/** Draw a horizontal divider sized to the active report width. */
function rule(width: number, c: Palette): string {
  return `${INDENT}${styled("─".repeat(width), c.dim, c.reset)}`;
}

/** Keep table cells inside their column even when one path or command has no spaces. */
function wrapCell(text: string, width: number): string[] {
  return wrapText(text, width, "", { breakLongWords: true });
}

/** Render narrow terminals as stacked label-value rows without truncation. */
function renderCompactTable(
  rows: readonly GateRow[],
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
      ...wrapCell("(no job is wired — nothing ran)", width)
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
      ...wrapCell(row.command, Math.max(1, width - 2))
        .map((line) => `${INDENT}  ${line}`),
      rule(width, c),
    );
  }
  return lines;
}

/** Render result, job, and command columns within the measured width budget. */
function renderThreeColumnTable(
  rows: readonly GateRow[],
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
      ...wrapCell("(no job is wired — nothing ran)", width)
        .map((value) => `${INDENT}${value}`),
      rule(width, c),
    );
    return lines;
  }

  for (const row of rows) {
    const jobs = wrapCell(row.job, jobWidth);
    const commands = wrapCell(row.command, commandWidth);
    const results = wrapCell(row.result, resultWidth);
    const height = Math.max(jobs.length, commands.length, results.length);
    for (let index = 0; index < height; index++) {
      const job = padDisplayEnd(jobs[index] ?? "", jobWidth);
      const command = padDisplayEnd(commands[index] ?? "", commandWidth);
      const resultValue = results[index] ?? "";
      const result = styled(
        resultValue,
        resultValue === "" ? "" : rowStyle(row.tone, color, c),
        c.reset,
      );
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

/** Choose the compact or 3-column layout from available terminal width. */
function renderRows(
  rows: readonly GateRow[],
  options: GateTtyOptions,
): string {
  const width = gateReportWidth(options.width);
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
export function renderGateTtyTable(
  steps: readonly StepResult[],
  options: GateTtyOptions,
): string {
  return renderRows(completedRows(steps), options);
}

/** Render the current live table from planned job groups and scheduler events. */
export function renderGateTtyProgressTable(
  groups: readonly JobGroup[],
  running: ReadonlySet<string>,
  results: ReadonlyMap<string, JobResult>,
  options: GateTtyOptions,
): string {
  return renderRows(plannedRows(groups, running, results), options);
}

/** The effectful controller that keeps one live job table in place on a TTY. */
export interface GateTtyProgress extends JobRunObserver {
  start(groups: readonly JobGroup[]): void;
  replaceGroups(groups: readonly JobGroup[]): void;
  complete(steps: readonly StepResult[]): void;
}

/**
 * Create one in-place TTY table. Color SGR sequences follow `options.color`;
 * cursor movement remains active in no-color mode because it controls layout.
 */
export function createGateTtyProgress(
  write: (value: string) => void,
  options: GateTtyOptions,
): GateTtyProgress {
  const running = new Set<string>();
  const results = new Map<string, JobResult>();
  let groups: readonly JobGroup[] | undefined;
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
    if (groups === undefined || completed) {
      return;
    }
    replace(renderGateTtyProgressTable(groups, running, results, options));
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

  const setGroups = (next: readonly JobGroup[]): void => {
    groups = next;
    visible = new Set(
      next.flatMap((group) =>
        group.jobs
          .filter((job) => job.kind !== "standard")
          .map((job) => job.label)
      ),
    );
  };

  return {
    start: (next: readonly JobGroup[]): void => {
      setGroups(next);
      redraw();
    },
    replaceGroups: (next: readonly JobGroup[]): void => {
      if (completed) {
        return;
      }
      setGroups(next);
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
      replace(renderGateTtyTable(steps, options));
    },
  };
}

/** Render one wrapped status line inside the same width and color budget as the table. */
export function renderGateTtyStatus(
  message: string,
  tone: GateRowTone,
  options: GateTtyOptions,
): string {
  const width = gateReportWidth(options.width);
  const c = palette(options.color);
  const marker = tone === "ok"
    ? "✓"
    : tone === "failed"
    ? "✗"
    : tone === "cancelled"
    ? "!"
    : tone === "running"
    ? "→"
    : "·";
  const markerWidth = displayWidth(marker) + 1;
  const lines = wrapCell(message, Math.max(1, width - markerWidth));
  return lines.map((line, index) => {
    const prefix = index === 0
      ? `${styled(marker, rowStyle(tone, options.color, c), c.reset)} `
      : " ".repeat(markerWidth);
    return `${INDENT}${prefix}${line}`;
  }).join("\n");
}

/** CI and `--plain` request a static transcript even when stdout is a TTY. */
function staticOutputRequested(plain: boolean): boolean {
  if (plain) {
    return true;
  }
  try {
    const marker = Deno.env.get("CI")?.trim().toLowerCase();
    return marker !== undefined && marker !== "" && marker !== "false";
  } catch {
    return false;
  }
}

/** The terminal widths available to a gate verb's static and live projections. */
export interface GateTtyPresentation {
  ttyWidth?: number;
  liveWidth?: number;
}

/** Resolve the common TTY, CI, and `--plain` presentation boundary once. */
export function gateTtyPresentation(
  json: boolean,
  plain: boolean,
): GateTtyPresentation {
  if (json || !Deno.stdout.isTerminal()) {
    return {};
  }
  const width = terminalWidth();
  return {
    ttyWidth: width,
    ...(staticOutputRequested(plain) ? {} : { liveWidth: width }),
  };
}
