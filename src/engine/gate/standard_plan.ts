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
import type { EnginePlan, PlanStep } from "../../shared/result.ts";
import { expandMapDirReference } from "../../shared/map_path.ts";

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
   * never-loosen limit check is NOT governed by this — it runs regardless. */
  gateMeasure: boolean;
  /** The paths the metric reads (scope-paths globs, `${map.dir}` expanded) —
   * when every change since the last recorded measurement falls outside them,
   * the gate replays that value. Absent = always measure. */
  inputs?: string[];
  /** Per-job `timeout` override for this measurement job (seconds; `0` disables
   * the bound), replacing the global `[gate].timeout` in every surface. */
  timeoutS?: number;
}

/** The scheduler label for a standard measurement inside the gate. `:` is
 * outside the configured standard-name vocabulary, so this namespace cannot
 * collide with a capability, check, or scope job. Standalone standards use the
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
  mapDir: string,
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
          expandMapDirReference(glob, mapDir)
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
      const per = resolvePer(spec.per, cfg.map.dir);
      const inputs = spec.inputs?.map((glob) =>
        expandMapDirReference(glob, cfg.map.dir)
      );
      return {
        name,
        metric: spec.metric ?? name,
        direction: spec.direction,
        limit: spec.limit,
        command: expandMapDirReference(toCommand(spec.run), cfg.map.dir),
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
 * The never-loosen comparison, pure: the branch's `limit` against the trunk's
 * recorded value, in the branch's `direction`. Returns the failure reason —
 * the words every surface narrates — or undefined when the limit is not
 * loosened (tightened, unchanged, or new on the branch: `mainValue`
 * undefined). The ONE comparison behind the shared Tier-1 verification both
 * gate and standalone execution consume, so the surfaces cannot disagree on
 * what "loosened" means.
 */
export function loosenedLimitReason(
  name: string,
  direction: "up" | "down",
  limit: number,
  mainValue: number | undefined,
  mainBranch: string,
): string | undefined {
  if (mainValue === undefined) {
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

/**
 * The value `standards --pin` would tighten a limit to, or `undefined` when there is
 * no improvement worth capturing. It moves the limit toward the measured `value`,
 * leaving `margin` of headroom (floor → `value − margin`, ceiling → `value + margin`),
 * and rounds in the LOOSER direction (a floor down, a ceiling up, to two decimals) so
 * the value just measured still satisfies the pinned limit. It returns `undefined`
 * unless the result is STRICTLY tighter than `current` — so pin can only ever tighten
 * (never loosen, whatever the margin) and never churns a no-op commit for an
 * improvement smaller than the margin. Pure, so the whole decision is unit-testable.
 *
 * The pinned limit is guaranteed to be one the measured `value` still SATISFIES: a
 * floor never rises above the measurement, a ceiling never falls below it. `margin`
 * ≥ 0 upholds that at the source (the schema refuses a negative margin), but the
 * check is enforced here too — a limit the value fails is never worth pinning, so
 * `undefined` is the only safe answer whatever the caller passed.
 */
export function pinnedLimit(
  direction: "up" | "down",
  value: number,
  margin: number,
  current: number,
): number | undefined {
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
    return undefined;
  }
  const tighter = direction === "up" ? rounded > current : rounded < current;
  return tighter ? rounded : undefined;
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
    label: r.name,
    disposition: "run",
    note: `${r.direction}, limit ${r.limit}${perNote(r.per, r.scale)}`,
  }));
  return {
    title: "Standards plan",
    details: [`${plan.standards.length} standard(s) configured`],
    steps,
  };
}
