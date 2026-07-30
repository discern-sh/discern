/**
 * The compact terminal projection for a green `discern done`: the jobs that
 * actually ran, followed by the receipt line for the exact tree they judged.
 *
 * This is presentation only. The result envelope still owns every fact, and
 * the stored Markdown receipt stays the page rendered by `status --verbose`.
 */

import { displayWidth, padDisplayEnd, wrapText } from "../../lib/text.ts";
import type { StepOutcome, StepResult } from "../../shared/result.ts";
import type { Receipt } from "../../shared/result_schemas.ts";
import { type Palette, palette } from "../output.ts";
import { fmtDuration } from "./receipt_render.ts";

const INDENT = "  ";
const GUTTER = "  ";
const MAX_REPORT_WIDTH = 120;
const MIN_THREE_COLUMN_WIDTH = 44;

// The reference treatment uses a brighter success green and a restrained green
// panel. They stay local to this projection; `color: false` emits no escapes.
const SUCCESS = "\x1b[38;2;52;211;121m";
const SUCCESS_BACKGROUND = "\x1b[48;2;12;29;27m";
const RECEIPT_TEXT = "\x1b[38;2;238;239;244m";

export interface DoneTtyOptions {
  /** Full terminal width in visible columns. */
  width: number;
  /** Whether ANSI color is enabled. */
  color: boolean;
}

interface DoneRow {
  job: string;
  command: string;
  result: string;
  outcome: StepOutcome;
}

function reportWidth(width: number): number {
  const terminal = Number.isFinite(width) ? Math.floor(width) : 80;
  return Math.max(
    1,
    Math.min(MAX_REPORT_WIDTH, terminal - displayWidth(INDENT)),
  );
}

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
        outcome: result.outcome,
      };
    });
}

function outcomeStyle(
  outcome: StepOutcome,
  color: boolean,
  c: Palette,
): string {
  if (!color) {
    return "";
  }
  switch (outcome) {
    case "ok":
      return SUCCESS;
    case "failed":
      return c.red;
    case "cancelled":
      return c.yellow;
    case "skipped":
      return c.dim;
  }
}

function styled(
  value: string,
  style: string,
  reset: string,
): string {
  return style === "" ? value : `${style}${value}${reset}`;
}

function rule(width: number, c: Palette): string {
  return `${INDENT}${styled("─".repeat(width), c.dim, c.reset)}`;
}

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
      outcomeStyle(row.outcome, color, c),
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
          outcomeStyle(row.outcome, color, c),
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

/**
 * Render the `JOB / COMMAND / RESULT` table from executed envelope steps.
 * Narrow terminals use a stacked row so no column is squeezed into noise.
 */
export function renderDoneTtyTable(
  steps: readonly StepResult[],
  options: DoneTtyOptions,
): string {
  const width = reportWidth(options.width);
  const c = palette(options.color);
  const rows = doneRows(steps);
  const lines = width < MIN_THREE_COLUMN_WIDTH
    ? renderCompactTable(rows, width, options.color, c)
    : renderThreeColumnTable(rows, width, options.color, c);
  return lines.join("\n");
}

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

/** Render the complete green TTY tail: job table, then highlighted receipt. */
export function renderDoneTtySummary(
  steps: readonly StepResult[],
  receipt: Receipt,
  options: DoneTtyOptions,
): string {
  return `${renderDoneTtyTable(steps, options)}\n\n${
    renderReceiptPanel(receipt.line, options)
  }`;
}
