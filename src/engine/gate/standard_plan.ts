/**
 * The standards verb's **pure planning core** — "given the typed config, which
 * standards run, with what direction / limit / metric / command." The mirror of the
 * gate's `plan.ts` for the standard seam (ADR 0027): everything here is a pure
 * function of its argument — no subprocess, no git, no filesystem. The effectful
 * Tier-1 verification lives in `standard_limits.ts`; the shared measurement
 * projection and standalone executor live in `standards.ts`.
 *
 * Each `[standards.<name>]` becomes one {@link PlannedStandard} carrying exactly the
 * data the executor needs; the whole list is carried as DATA, so "what would
 * standards run" is unit-testable without touching git or a subprocess.
 */

import {
  type DiscernConfig,
  type Extent,
  EXTENTS,
  type StandardConfig,
  toCommand,
} from "../../shared/config_schema.ts";
import {
  type EnginePlan,
  type PlanStep,
  verbatimStepLabel,
} from "../../shared/result.ts";
import { expandSourcePathReferences } from "../../shared/source_path_references.ts";

/** The denominator that turns a raw count into a rate, resolved to the shape the
 * executor acts on: either a second emitted metric, or a built-in extent discern
 * measures itself over a set of git pathspecs. */
export type PerSpec =
  | { kind: "metric"; metric: string }
  | { kind: "extent"; measure: Extent; globs: string[] };

/**
 * One standard as planned: the resolved fields the executor reads, lifted out of
 * the schema-validated spec. `metric` defaults to the standard name; `command` is
 * the spec's `run` flattened; `limitKey` is the dotted key read from main's config
 * for the never-loosen baseline. `per`/`scale` make the measured value a rate
 * (`metric / per * scale`) so a growing tree never breaches the limit on its own.
 */
export interface PlannedStandard {
  name: string;
  /** The schema-normalized source table. Tier 1 applies the total field policy
   * to this shape before any measurement runs; execution uses the resolved
   * projections below. */
  spec: StandardConfig;
  /** The metric token the run emits (spec.metric ?? name). */
  metric: string;
  direction: "up" | "down";
  limit: number;
  /** The measurement command (spec.run flattened), possibly empty. */
  command: string;
  /** The dotted config key compared to main (`standards.<name>.limit`). */
  limitKey: string;
  /** The denominator, when the standard holds a rate rather than a raw count. */
  per?: PerSpec;
  /** Multiplier applied to the rate so the limit reads in human units (default 1). */
  scale: number;
  /** Headroom `standards --pin` leaves when tightening this limit to the measured
   * value (default 0 → pin to the exact measurement). Same units as `limit`. */
  margin: number;
  /** Whether the gate measures this standard (`measure = "gate"`, the default);
   * false defers the measurement to the standalone `standards` verb. The
   * definition-and-limit check is NOT governed by this — it runs regardless. */
  gateMeasure: boolean;
  /** The paths the metric reads (scope-paths globs, with live source-path
   * references expanded) —
   * when every change since the last recorded measurement falls outside them,
   * the gate replays that value. Absent = always measure. */
  inputs?: string[];
  /** Per-job `timeout` override for this measurement job (seconds; `0` disables
   * the bound), replacing the global `[gate].timeout` in every surface. */
  timeoutS?: number;
}

/** What one Standard's Gate-facing measurement should do. Standalone
 * `standards` resolves every configured Standard to `measure`; the Gate may
 * instead replay input-keyed evidence or defer an on-demand measurement. */
export type StandardAction =
  | { kind: "measure" }
  | { kind: "replay"; value: number; from: string }
  | { kind: "defer" };

/** One planned Standard paired with its independently resolved action. */
export interface ResolvedStandard {
  standard: PlannedStandard;
  action: StandardAction;
}

/** Every process-affecting fact behind one Standard measurement. This is the
 * execution identity authority: adding another process option requires adding
 * it here before measurements may share a run. */
export interface StandardExecutionIdentity {
  command: string;
  cwd: string;
  timeoutS: number;
}

/** One physical process run and the independently evaluated Standards that
 * consume its emitted metrics. */
export interface PlannedStandardMeasurement {
  identity: StandardExecutionIdentity;
  standards: PlannedStandard[];
}

/** The pure process plan after replay/defer policy has been resolved. */
export interface StandardMeasurementPlan {
  measurements: PlannedStandardMeasurement[];
}

/** Build the exact execution identity for one measurement. The root and the
 * effective timeout (per-Standard override or Gate default) participate beside
 * the command; shell, environment, streaming, and cancellation policy are
 * invocation-wide today and therefore equal for every member of this plan. */
export function standardExecutionIdentity(
  root: string,
  standard: PlannedStandard,
  defaultTimeoutS: number,
): StandardExecutionIdentity {
  return {
    command: standard.command,
    cwd: root,
    timeoutS: standard.timeoutS ?? defaultTimeoutS,
  };
}

/** Stable, collision-free identity key for the bounded JSON-compatible process
 * shape. Kept private so consumers group through the typed plan, not by
 * reimplementing its membership rule. */
function standardExecutionKey(identity: StandardExecutionIdentity): string {
  return JSON.stringify(identity);
}

/** Group only Standards whose own resolved action is `measure`. Replayed and
 * deferred siblings retain their semantic state even when they declare the
 * same command as a measuring member. Group order and member order follow the
 * configured Standard order. Pure: no subprocess, Git, clock, or filesystem. */
export function buildStandardMeasurementPlan(
  root: string,
  resolved: readonly ResolvedStandard[],
  defaultTimeoutS: number,
): StandardMeasurementPlan {
  const byIdentity = new Map<string, PlannedStandardMeasurement>();
  for (const { standard, action } of resolved) {
    if (action.kind !== "measure") {
      continue;
    }
    const identity = standardExecutionIdentity(
      root,
      standard,
      defaultTimeoutS,
    );
    const key = standardExecutionKey(identity);
    const existing = byIdentity.get(key);
    if (existing === undefined) {
      byIdentity.set(key, { identity, standards: [standard] });
    } else {
      existing.standards.push(standard);
    }
  }
  return { measurements: [...byIdentity.values()] };
}

/** The scheduler label for a standard measurement inside the gate. `:` is
 * outside the configured standard-name vocabulary, so this namespace cannot
 * collide with a declared or scope job. Standalone standards use the
 * plain standard name at their result boundary while sharing the same job
 * projection underneath. */
export function standardJobLabel(name: string): string {
  return `standard:${name}`;
}

/** Normalize a schema-validated `per` into the executor's {@link PerSpec}. A string
 * names a second emitted metric; an object names exactly one built-in extent (the
 * schema guarantees exactly one), whose value is one or more git pathspecs. */
function resolvePer(
  per: StandardConfig["per"],
  config: DiscernConfig,
): PerSpec | undefined {
  if (per === undefined) return undefined;
  if (typeof per === "string") return { kind: "metric", metric: per };
  for (const measure of EXTENTS) {
    const globs = per[measure];
    if (globs !== undefined) {
      return {
        kind: "extent",
        measure,
        globs: (typeof globs === "string" ? [globs] : globs).map((glob) =>
          expandSourcePathReferences(glob, config)
        ),
      };
    }
  }
  return undefined; // unreachable: the schema requires exactly one extent
}

/**
 * A pure, inspectable description of one `standards` run: the ordered list of
 * planned standards. Built before any git read or measurement; executed by
 * `executeStandardPlan`; projected to the shared renderer for `--dry-run`/`--json`.
 */
export interface StandardPlan {
  standards: PlannedStandard[];
}

/**
 * Build the standard plan from the typed config. Pure: just reads `cfg.standards`
 * (declared order) into the planned list, resolving each standard's metric and
 * command. This is the unit-testable decision — which standards, with what
 * direction / limit / metric / command — with zero I/O.
 */
export function buildStandardPlan(cfg: DiscernConfig): StandardPlan {
  const standards: PlannedStandard[] = Object.entries(cfg.standards).map(
    ([name, spec]: [string, StandardConfig]) => {
      const per = resolvePer(spec.per, cfg);
      const inputs = spec.inputs?.map((glob) =>
        expandSourcePathReferences(glob, cfg)
      );
      return {
        name,
        spec,
        metric: spec.metric ?? name,
        direction: spec.direction,
        limit: spec.limit,
        command: expandSourcePathReferences(toCommand(spec.run), cfg),
        limitKey: `standards.${name}.limit`,
        scale: spec.scale,
        margin: spec.margin,
        gateMeasure: spec.measure === "gate",
        ...(inputs !== undefined ? { inputs } : {}),
        ...(spec.timeout !== undefined ? { timeoutS: spec.timeout } : {}),
        ...(per !== undefined ? { per } : {}),
      };
    },
  );
  return { standards };
}

/**
 * The monotonic-bound comparison, pure: the branch's `limit` against the
 * trunk's recorded value after both sides' directions agree. Returns the
 * failure reason — the words every surface narrates — or undefined when the
 * limit is not comparable or not loosened (tightened, unchanged, or new on the
 * branch: `mainValue` undefined). The ONE numeric comparison behind the shared
 * Tier-1 verification both gate and standalone execution consume.
 */
export function loosenedLimitReason(
  name: string,
  direction: "up" | "down",
  limit: number,
  mainDirection: "up" | "down",
  mainValue: number | undefined,
  mainBranch: string,
): string | undefined {
  if (mainValue === undefined) {
    return undefined;
  }
  // A bound has an ordering only after both sides agree on what ordering it is.
  // Tier 1 reports a direction mismatch as a definition change; it must never
  // reinterpret the trunk's floor as a ceiling (or vice versa) through the
  // branch's direction.
  if (direction !== mainDirection) {
    return undefined;
  }
  if (direction === "up" && limit < mainValue) {
    return `standard '${name}': floor ${mainValue} -> ${limit} vs ${mainBranch} — the floor only rises. Raise the metric, don't loosen the gate.`;
  }
  if (direction === "down" && limit > mainValue) {
    return `standard '${name}': ceiling ${mainValue} -> ${limit} vs ${mainBranch} — the ceiling only falls. Lower the metric, don't loosen the gate.`;
  }
  return undefined;
}

/** Inputs to the mechanical Standard-pin decision. */
export interface StandardPinEligibilityInput {
  direction: "up" | "down";
  value: number;
  margin: number;
  limit: number;
}

/** The mechanical pin decision shared by Gate execution and every recorded
 * consumer. Recommendation policy does not belong here. */
export type StandardPinEligibility =
  | { eligible: true; target: number }
  | { eligible: false };

/**
 * Evaluate one Standard's mechanical pin eligibility. The target moves the
 * limit toward the measurement while leaving configured headroom: floor to
 * `value - margin`, ceiling to `value + margin`. Rounding goes in the looser
 * direction so the measurement still satisfies the target. Eligibility is
 * true only for a strictly tighter, measurement-satisfying result. Pure and
 * total over numeric inputs, including defensive rejection of a negative
 * margin.
 */
export function standardPinEligibility(
  input: StandardPinEligibilityInput,
): StandardPinEligibility {
  const { direction, value, margin, limit } = input;
  const target = direction === "up" ? value - margin : value + margin;
  const rounded = direction === "up"
    ? Math.floor(target * 100) / 100
    : Math.ceil(target * 100) / 100;
  // Never pin a limit the measurement itself fails (the trap a negative margin
  // sets: a floor pinned above, or a ceiling below, the value just measured).
  const satisfiedByMeasurement = direction === "up"
    ? value + 1e-9 >= rounded
    : value - 1e-9 <= rounded;
  if (!satisfiedByMeasurement) {
    return { eligible: false };
  }
  const tighter = direction === "up" ? rounded > limit : rounded < limit;
  return tighter ? { eligible: true, target: rounded } : { eligible: false };
}

/** Compatibility projection for callers that need only the prospective limit. */
export function pinnedLimit(
  direction: "up" | "down",
  value: number,
  margin: number,
  current: number,
): number | undefined {
  const eligibility = standardPinEligibility({
    direction,
    value,
    margin,
    limit: current,
  });
  return eligibility.eligible ? eligibility.target : undefined;
}

/** A human suffix for a standard's denominator, e.g. " per 1000 words in <docs-dir>**"
 * or " per <metric>". Empty when the standard is a raw count. */
export function perNote(per: PerSpec | undefined, scale: number): string {
  if (per === undefined) return "";
  const factor = scale === 1 ? "" : `${scale} `;
  return per.kind === "metric"
    ? ` per ${factor}${per.metric}`
    : ` per ${factor}${per.measure} in ${per.globs.join(", ")}`;
}

/**
 * Project a standard plan onto the common {@link EnginePlan} the shared renderer
 * prints. Each standard becomes a `standard` step labelled by name, noting its
 * direction and limit. Every standard renders as `run` — an empty command is still
 * a config error caught at execute time, not a plan-time skip (the dry-run honesty
 * rule: a plan lists "what would run").
 */
export function standardPlanToEngine(plan: StandardPlan): EnginePlan {
  const steps: PlanStep[] = plan.standards.map((r) => ({
    kind: "standard",
    label: verbatimStepLabel(r.name),
    disposition: "run",
    note: `${r.direction}, limit ${r.limit}${perNote(r.per, r.scale)}`,
  }));
  return {
    title: "Standards plan",
    details: [`${plan.standards.length} standard(s) configured`],
    steps,
  };
}
