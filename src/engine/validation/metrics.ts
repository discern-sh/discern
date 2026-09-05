/** Finite readings are component evidence; protected limits are consumer decisions. */
import type { PlannedStandard } from "../gate/standard_plan.ts";
import { compareValueToLimit, fmtRate } from "../gate/standards.ts";

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
      throw new Error("producer emitted a malformed or non-finite metric");
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
    throw new Error(`missing finite metric '${definition.metric}'`);
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
    throw new Error("standard denominator must be finite and positive");
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
