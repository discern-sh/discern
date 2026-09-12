/** Bounded completion accounting prose shared by terminal and Markdown readers. */
import type { CompletionEconomics } from "./patterns_vocabulary.ts";

/** A missing observation stays unknown on every surface. */
function seconds(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "unknown"
    : `${(value / 1000).toFixed(2)}s`;
}

/** Explain observed denominators and overlapping spans without inferring policy or blame. */
export function completionEconomicsLines(value: CompletionEconomics): string[] {
  const latency = (key: string): string => {
    const sample = value.latencies?.[key];
    return sample === undefined
      ? "unknown"
      : `${
        seconds(sample.median_ms)
      } median across ${sample.observations} observations (${sample.unknown} unknown)`;
  };
  const timestamp = (value: number | null): string => {
    const date = new Date(value ?? NaN);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "unknown";
  };
  const first = timestamp(value.window.first_at);
  const last = timestamp(value.window.last_at);
  const phases = Object.entries(value.timing).slice(0, 20).map((
    [name, spans],
  ) =>
    `${name}: ${seconds(spans.elapsed_ms)} union / ${
      seconds(spans.sum_ms)
    } sum (${spans.observations} observed, ${spans.unknown} unknown)`
  );
  return [
    `Completion window ${first} to ${last}: ${value.efforts} efforts, ${value.candidates} candidates, ${value.proofs} strict Proofs.`,
    `Native producer executions: ${
      value.producer_executions ?? "unknown"
    }; reused component receipts: ${value.reused_receipts}; observed reuse-only validations: ${
      value.reuse_only_runs ?? "unknown"
    }. Summed producer work: ${seconds(value.producer_work_ms)}.`,
    `Validation feedback: ${latency("validation-feedback")}.`,
    phases.length === 0
      ? "Phase durations are unknown."
      : `Phase spans: ${phases.join("; ")}.`,
    "Durations overlap and are not additive completion latency or CPU use. Invalidated work can be reused; it is not an estimate of discarded work. Missing history and changed conditions limit comparisons. Observations grant no Proof or ownership authority.",
  ];
}
