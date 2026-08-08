/** The receipt treatment that follows `discern done`'s shared gate-job table. */

import { padDisplayEnd, wrapText } from "../../lib/text.ts";
import type { StepResult } from "../../shared/result.ts";
import type { Proof } from "../../shared/result_schemas.ts";
import {
  GATE_TTY_SUCCESS,
  gateReportWidth,
  type GateTtyOptions,
  renderGateTtyTable,
} from "./gate_tty.ts";

const INDENT = "  ";
const SUCCESS_BACKGROUND = "\x1b[48;2;12;29;27m";
const PROOF_TEXT = "\x1b[38;2;238;239;244m";

/** Show the commit-bound gate receipt and its validity window after success. */
function renderProofPanel(
  line: string,
  options: GateTtyOptions,
): string {
  const width = gateReportWidth(options.width);
  const textWidth = Math.max(1, width - 5);
  const lines = ["", ...wrapText(line, textWidth), ""];
  if (!options.color) {
    return lines.map((value) => `${INDENT}│  ${value}`).join("\n");
  }
  return lines.map((value) =>
    `${INDENT}${GATE_TTY_SUCCESS}▌\x1b[0m${SUCCESS_BACKGROUND}${PROOF_TEXT}  ${
      padDisplayEnd(value, textWidth)
    }  \x1b[0m`
  ).join("\n");
}

/** Render the highlighted receipt panel that follows a completed live table. */
export function renderDoneTtyProofPanel(
  receipt: Proof,
  options: GateTtyOptions,
): string {
  return renderProofPanel(receipt.line, options);
}

/** Render the complete green TTY tail: shared job table, then receipt panel. */
export function renderDoneTtySummary(
  steps: readonly StepResult[],
  receipt: Proof,
  options: GateTtyOptions,
): string {
  return `${renderGateTtyTable(steps, options)}\n\n${
    renderDoneTtyProofPanel(receipt, options)
  }`;
}
