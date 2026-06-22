/**
 * The ratchets verb's **pure planning core** — "given the typed config, which
 * ratchets run, with what direction / limit / metric / command." The mirror of the
 * gate's `plan.ts` for the ratchet seam (ADR 0027): everything here is a pure
 * function of its argument — no subprocess, no git, no filesystem. The effectful
 * executor (the never-loosen-vs-main read, the measurement, the comparison) lives
 * in `ratchets.ts`.
 *
 * Each `[ratchets.<name>]` becomes one {@link PlannedRatchet} carrying exactly the
 * data the executor needs; the whole list is carried as DATA, so "what would
 * ratchets run" is unit-testable without touching git or a subprocess.
 */

import {
  type DiscernConfig,
  type RatchetConfig,
  toCommand,
} from "../../shared/config_schema.ts";
import type { EnginePlan, PlanStep } from "../plan/types.ts";

/**
 * One ratchet as planned: the resolved fields the executor reads, lifted out of
 * the schema-validated spec. `metric` defaults to the ratchet name; `command` is
 * the spec's `run` flattened; `limitKey` is the dotted key read from main's config
 * for the never-loosen baseline.
 */
export interface PlannedRatchet {
  name: string;
  /** The metric token the run emits (spec.metric ?? name). */
  metric: string;
  direction: "up" | "down";
  limit: number;
  /** The measurement command (spec.run flattened), possibly empty. */
  command: string;
  /** The dotted config key compared to main (`ratchets.<name>.limit`). */
  limitKey: string;
}

/**
 * A pure, inspectable description of one `ratchets` run: the ordered list of
 * planned ratchets. Built before any git read or measurement; executed by
 * `executeRatchetPlan`; projected to the shared renderer for `--dry-run`/`--json`.
 */
export interface RatchetPlan {
  ratchets: PlannedRatchet[];
}

/**
 * Build the ratchet plan from the typed config. Pure: just reads `cfg.ratchets`
 * (declared order) into the planned list, resolving each ratchet's metric and
 * command. This is the unit-testable decision — which ratchets, with what
 * direction / limit / metric / command — with zero I/O.
 */
export function buildRatchetPlan(cfg: DiscernConfig): RatchetPlan {
  const ratchets: PlannedRatchet[] = Object.entries(cfg.ratchets).map(
    ([name, spec]: [string, RatchetConfig]) => ({
      name,
      metric: spec.metric ?? name,
      direction: spec.direction,
      limit: spec.limit,
      command: toCommand(spec.run),
      limitKey: `ratchets.${name}.limit`,
    }),
  );
  return { ratchets };
}

/**
 * Project a ratchet plan onto the common {@link EnginePlan} the shared renderer
 * prints. Each ratchet becomes a `ratchet` step labelled by name, noting its
 * direction and limit. Every ratchet renders as `run` — an empty command is still
 * a config error caught at execute time, not a plan-time skip (the dry-run honesty
 * rule: a plan lists "what would run").
 */
export function ratchetPlanToEngine(plan: RatchetPlan): EnginePlan {
  const steps: PlanStep[] = plan.ratchets.map((r) => ({
    kind: "ratchet",
    label: r.name,
    disposition: "run",
    note: `${r.direction}, limit ${r.limit}`,
  }));
  return {
    title: "Ratchets plan",
    details: [`${plan.ratchets.length} ratchet(s) configured`],
    steps,
  };
}
