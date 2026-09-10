/** Completion accounting's report projection and terminal adapter. */
import { renderResultSummaryGroupCli } from "discern-design-system/cli";
import { terminalMultiline } from "../../lib/terminal.ts";
import { completionEconomicsLines } from "../../shared/completion_economics_presentation.ts";
import { formatHumanNumber } from "../../shared/human_number.ts";
import type {
  CompletionEconomics,
  PatternsStats,
} from "../../shared/patterns_vocabulary.ts";
import type { Out } from "../output.ts";
import { completionEconomics } from "./completion_economics.ts";
import type { LogbookEvent } from "./schema.ts";

/** Missing observations leave the report absent; automated CI does not enter local economics. */
export function completionReportData(
  events: readonly LogbookEvent[],
): { completion?: CompletionEconomics } {
  const completion = events.flatMap((event) =>
    event.kind === "completion" && event.driver?.ci !== true
      ? [event.observation]
      : []
  );
  return completion.length === 0
    ? {}
    : { completion: completionEconomics(completion) };
}

/** Render the same bounded accounting prose as Markdown using the caller's terminal context. */
export function renderCompletionReport(
  out: Out,
  value: CompletionEconomics | undefined,
  width: number,
): void {
  if (value === undefined) return;
  out.raw(`${
    out.terminal.presenter.present(renderResultSummaryGroupCli, {
      items: completionEconomicsLines(value).map((line) => ({
        state: "unchanged" as const,
        fact: terminalMultiline(line),
      })),
      maxWidth: width,
    })
  }\n`);
}

/** Format a count with its singular or supplied plural noun. */
export function plural(
  value: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${formatHumanNumber(value)} ${value === 1 ? singular : pluralForm}`;
}

/** Render a count pair as a rounded percentage for the stats card. */
export function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`;
}

/** A proportion row keeps the explicit denominator beside its percentage. */
export function meterRow(fraction: number, text: string): string {
  return `${Math.round(fraction * 100)}% · ${text}`;
}

/** Recorded completion-call outcomes and command-time sums, without inferring
 * validation failure or physical execution. Streaks of one stay off the card. */
export function statsGateRows(gate: PatternsStats["gate"]): string[] {
  if (gate.runs === 0) {
    return ["No `done` runs yet."];
  }
  const rows = [
    meterRow(
      gate.greens / gate.runs,
      `${formatHumanNumber(gate.greens)} of ${
        plural(gate.runs, "`done` run")
      } green (${percent(gate.greens, gate.runs)})`,
    ),
  ];
  if (gate.gated_branches > 0) {
    rows.push(
      meterRow(
        gate.first_try_green_branches / gate.gated_branches,
        `${formatHumanNumber(gate.first_try_green_branches)} of ${
          plural(gate.gated_branches, "branch", "branches")
        } green first try (${
          percent(gate.first_try_green_branches, gate.gated_branches)
        })`,
      ),
    );
  }
  const reds = gate.runs - gate.greens;
  if (reds > 0) {
    rows.push(
      `${
        plural(reds, "non-green `done` result")
      }; validation, coordination and recovery outcomes differ`,
    );
  }
  const tail: string[] = [];
  if (gate.longest_green_streak > 1) {
    tail.push(
      `longest green streak ${formatHumanNumber(gate.longest_green_streak)}`,
    );
  }
  if (gate.current_green_streak > 1) {
    tail.push(
      `current ${formatHumanNumber(gate.current_green_streak)}`,
    );
  }
  if (gate.check_hours > 0) {
    tail.push(
      `${
        formatHumanNumber(gate.check_hours)
      }h summed command durations (\`done\` · \`prepare\` · \`test\`; includes waits and overlap)`,
    );
  }
  if (tail.length > 0) {
    rows.push(tail.join(" · "));
  }
  return rows;
}
