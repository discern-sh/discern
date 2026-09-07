/** Finite readings are component evidence; protected limits are consumer decisions. */
import {
  type PlannedStandard,
  standardPinEligibility,
} from "../gate/standard_plan.ts";
import type { GateStandard } from "../../shared/result_schemas.ts";
import { withoutDiagnosticReports } from "../gate/diagnostics.ts";

/** Format a normalized value compactly: integers bare, otherwise up to two decimals
 * with trailing zeros trimmed (18.699… → "18.7", 18 → "18"). */
export function fmtRate(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

/** One standard check's verdict. On failure, `reason` carries the words the
 * result envelope and human renderer expose. Metric-reading failures also carry
 * the captured measurement `output`: the evidence for why no metric emerged. */
export interface StandardVerdict {
  held: boolean;
  /** The value compared to the limit (rate or count); absent when unmeasurable. */
  value?: number;
  /** The one-line pass summary, exactly as narrated; absent when it failed. */
  summary?: string;
  /** The failure reason, exactly as narrated; absent when the standard held. */
  reason?: string;
  /** The measurement command's captured output, when it is the failure's evidence. */
  output?: string;
  /** The command that reproduces the failure — the standard's own `run` when the
   * measurement is what failed or fell short; absent for the structural failures
   * (a loosened limit, a missing command), where re-running measures nothing. */
  reproduce_cmd?: string;
}

/**
 * Compare an already-known `value` to a standard's limit — the pure final third
 * of a standard's verdict, shared by a fresh measurement, the pin's proof
 * replay, and the gate's input-keyed replay, so "past the limit" is decided by
 * ONE comparison (epsilon tolerance included) everywhere. `shown`/`breakdown`
 * carry the human rendering when the caller normalized a rate.
 */
export function compareValueToLimit(
  r: Pick<PlannedStandard, "name" | "metric" | "direction" | "limit" | "per">,
  value: number,
  shown: string,
  breakdown: string,
): StandardVerdict {
  const { name, metric, direction, limit, per } = r;
  if (direction === "up") {
    if (value + 1e-9 < limit) {
      return {
        held: false,
        value,
        reason:
          `standard '${name}': ${metric} ${shown} is below the floor ${limit}${breakdown}. ` +
          `Raise it within the scope of your task; never lower the floor. ` +
          `If the work itself shrank what this measures, commit the final clean ` +
          `tree and run \`discern standards propose ${name} --reason "…"\`; ` +
          `the proposal command measures this standard. ` +
          `propping the number up with unrelated changes is worse than the breach.`,
      };
    }
    return {
      held: true,
      value,
      summary:
        `standard '${name}': ${metric} ${shown} meets the floor ${limit}${breakdown}.`,
    };
  }
  if (value - 1e-9 > limit) {
    // A raw-count ceiling that a growing tree can breach on its own is the classic
    // trap — point at the fix the moment it bites.
    const growHint = per === undefined
      ? " If this counts items over a tree you grow, it rises with size — hold a rate instead (add `per`)."
      : "";
    return {
      held: false,
      value,
      reason:
        `standard '${name}': ${metric} ${shown} exceeds the ceiling ${limit}${breakdown}. ` +
        `Bring it down within the scope of your task; never raise the ceiling. ` +
        `If the work itself grew what this measures, commit the final clean ` +
        `tree and run \`discern standards propose ${name} --reason "…"\`; ` +
        `the proposal command measures this standard. ` +
        `offsetting the number with unrelated changes is worse than the breach.${growHint}`,
    };
  }
  return {
    held: true,
    value,
    summary:
      `standard '${name}': ${metric} ${shown} within the ceiling ${limit}${breakdown}.`,
  };
}

/** A holding value's standing against the current limit. */
export function heldVerdict(
  standard: PlannedStandard,
  value: number,
): "improved" | "held" {
  const better = standard.direction === "up"
    ? value - 1e-9 > standard.limit
    : value + 1e-9 < standard.limit;
  return better ? "improved" : "held";
}

/** Gate-owned pin evidence for one measured value. Patterns records and reads
 * this projection; it never reimplements margin arithmetic. */
export function standardPinEvidence(
  standard: PlannedStandard,
  value: number,
): Pick<GateStandard, "pin_eligible" | "pin_target"> {
  const eligibility = standardPinEligibility({
    direction: standard.direction,
    value,
    margin: standard.margin,
    limit: standard.limit,
  });
  return eligibility.eligible
    ? { pin_eligible: true, pin_target: eligibility.target }
    : { pin_eligible: false };
}

export type MetricDefinition = Pick<
  PlannedStandard,
  "metric" | "scale" | "per"
>;
export type StandardDefinition =
  & MetricDefinition
  & Pick<PlannedStandard, "name" | "direction" | "limit">;

/** Parse the existing last-emission-wins protocol without accepting partial numbers. */
export function readMetrics(output: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (
    const marker of withoutDiagnosticReports(output).matchAll(
      /(?:^|\s)DISCERN_METRIC[ \t]+(\S+)(?:[ \t]+(\S+))?/gu,
    )
  ) {
    const name = marker[1];
    const token = marker[2];
    if (
      name === undefined || token === undefined ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(token) ||
      !Number.isFinite(Number(token))
    ) {
      throw new Error(
        `metric '${name ?? "<missing>"}' value is not a number: '${
          token ?? "<missing>"
        }'. Emit a finite DISCERN_METRIC value.`,
      );
    }
    Object.defineProperty(metrics, name, {
      value: Number(token),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return metrics;
}

/** Denominator extents are observed over their own declared candidate inputs. */
export function standardReading(
  definition: MetricDefinition,
  metrics: Readonly<Record<string, number>>,
  extent: number | null,
): number {
  const value = Object.hasOwn(metrics, definition.metric)
    ? metrics[definition.metric]
    : undefined;
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(
      `could not read metric '${definition.metric}'. Emit a line: DISCERN_METRIC ${definition.metric} <number>.`,
    );
  }
  const per = definition.per;
  const denominator = per === undefined
    ? 1
    : per.kind === "extent"
    ? extent
    : Object.hasOwn(metrics, per.metric)
    ? metrics[per.metric]
    : undefined;
  if (
    denominator === null || denominator === undefined ||
    !Number.isFinite(denominator) || denominator <= 0
  ) {
    const what = per?.kind === "metric"
      ? `could not read 'per' metric '${per.metric}' as a finite positive number`
      : `the '${
        per?.kind === "extent" ? per.measure : "per"
      }' extent is not positive`;
    throw new Error(
      `${what} (nothing to divide by). Check the 'per' pathspec/metric.`,
    );
  }
  const reading = per === undefined
    ? value
    : value / denominator * definition.scale;
  if (!Number.isFinite(reading)) {
    throw new Error("standard reading is not finite");
  }
  return reading;
}

/** Current callers and candidate assembly share the existing protected-bound comparison. */
export function standardHeld(
  definition: StandardDefinition,
  reading: number,
): boolean {
  return Number.isFinite(reading) && Number.isFinite(definition.limit) &&
    compareValueToLimit(definition, reading, fmtRate(reading), "").held;
}

/** Describe the same reading and comparison used by assembly, including the captured denominator. */
export function standardVerdict(
  definition: StandardDefinition,
  metrics: Readonly<Record<string, number>>,
  extent: number | null,
): StandardVerdict {
  const reading = standardReading(definition, metrics, extent);
  const per = definition.per;
  const denominator = per?.kind === "extent"
    ? extent
    : per?.kind === "metric"
    ? metrics[per.metric]
    : undefined;
  const breakdown = per === undefined
    ? ""
    : ` (${metrics[definition.metric]} per ${denominator}${
      per.kind === "extent" ? ` ${per.measure}` : ""
    }${definition.scale === 1 ? "" : ` ×${definition.scale}`})`;
  return compareValueToLimit(definition, reading, fmtRate(reading), breakdown);
}
