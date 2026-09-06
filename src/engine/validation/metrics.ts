/** Finite readings are component evidence; protected limits are consumer decisions. */
import type { PlannedStandard } from "../gate/standard_plan.ts";
import {
  compareValueToLimit,
  fmtRate,
  type StandardVerdict,
} from "../gate/standards.ts";

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
    const marker of output.matchAll(
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
