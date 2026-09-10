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
    `Completion window ${first} to ${last}: ${value.efforts} efforts, ${value.candidates} candidates, ${value.landings} landings (${value.emergency_landings} emergency).`,
    `Native producer executions: ${
      value.producer_executions ?? "unknown"
    }; reused component receipts: ${value.reused_receipts}; observed reuse-only validations: ${
      value.reuse_only_runs ?? "unknown"
    }. Summed producer work: ${seconds(value.producer_work_ms)}.`,
    `Approval-to-land: ${latency("approval-to-land")}. Validation feedback: ${
      latency("validation-feedback")
    }.`,
    `Prediction outcomes: ${
      value.successful_predictions ?? "unknown"
    } successes; ${value.invalidated_predictions} observed invalidations; denominator ${
      value.prediction_denominator ?? "unknown"
    } resolved of ${
      value.eligible_predictions ?? "unknown"
    } eligible admissions. Miss rate: ${
      value.prediction_miss_rate === null
        ? "unknown"
        : `${(100 * value.prediction_miss_rate).toFixed(1)}%`
    }; ${value.unresolved_predictions ?? "unknown"} unresolved and ${
      value.conflicting_prediction_outcomes ?? "unknown"
    } ambiguous or emergency outcomes. Withdrawals after prediction: ${value.withdrawals_after_prediction}; before observed green admission: ${
      value.withdrawals_before_green ?? "unknown"
    }.`,
    phases.length === 0
      ? "Phase durations are unknown."
      : `Phase spans: ${phases.join("; ")}.`,
    `Durations overlap and are not additive completion latency or CPU use. Work on invalidated candidates (${
      seconds(value.invalidated_candidate_producer_work_ms)
    }) can be reused; it is not an estimate of discarded work. Missing history and changed conditions limit comparisons. Observations grant no Proof, ownership or recovery authority.`,
  ];
}
