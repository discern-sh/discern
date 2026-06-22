/**
 * The single engine-side **plan renderer** — the mirror of the installer's
 * `lib/plan_view.ts`, kept apart from planning so planning stays pure and printing
 * stays in one place. Every effectful verb routes its `--dry-run` listing and its
 * generic `--json` through here, so the two are never re-implemented per verb.
 *
 * It renders the common {@link EnginePlan} projection (see `./types.ts`). To serve
 * discern's two presentation paths from one renderer, it writes through a minimal
 * {@link RenderSink} that both the gate's `Out` and the installer's `Logger`
 * implement (via the adapters below).
 */

import type { Out } from "../output.ts";
import type { Logger } from "../../lib/log.ts";
import type { EnginePlan, PlanStep, StepOutcome, StepResult } from "./types.ts";

/**
 * The minimal output surface the renderer needs. Implemented by both the gate's
 * `Out` and the installer's `Logger` through {@link outSink} / {@link loggerSink},
 * so one renderer serves both paths.
 */
export interface RenderSink {
  heading(text: string): void;
  line(text: string): void;
  /** Dim a fragment (returns it unchanged when colour is off). */
  dim(text: string): string;
}

/** Adapt the gate's `Out` to a {@link RenderSink} (writes to its info stream). */
export function outSink(out: Out): RenderSink {
  return {
    heading: (t: string): void => out.heading(t),
    line: (t: string): void => out.raw(`${t}\n`),
    dim: (t: string): string => `${out.c.dim}${t}${out.c.reset}`,
  };
}

/** Adapt the installer's `Logger` to a {@link RenderSink}. */
export function loggerSink(log: Logger): RenderSink {
  return {
    heading: (t: string): void => log.heading(t),
    line: (t: string): void => log.line(t),
    dim: (t: string): string => log.dim(t),
  };
}

/** Short, human label for each disposition (mirrors `plan_view.ts`). */
const DISPOSITION_LABEL: Record<StepDisposition, string> = {
  run: "run",
  skip: "skip",
  gate: "check",
};

type StepDisposition = PlanStep["disposition"];

/**
 * Render a plan as a per-step listing under its heading — the `--dry-run` view.
 * Steps carrying a `group` are printed under a dim group line; ungrouped plans
 * (e.g. graduate) list flat.
 */
export function renderPlan(sink: RenderSink, plan: EnginePlan): void {
  sink.heading(plan.title);
  for (const d of plan.details) {
    sink.line(`  ${sink.dim(d)}`);
  }
  if (plan.steps.length === 0) {
    sink.line(`  ${sink.dim("(nothing to do)")}`);
    return;
  }
  let group: string | undefined;
  for (const step of plan.steps) {
    if (step.group !== group) {
      group = step.group;
      if (group !== undefined && group !== "") {
        sink.line(`  ${sink.dim(group)}`);
      }
    }
    const indent = step.group !== undefined && step.group !== ""
      ? "    "
      : "  ";
    const label = DISPOSITION_LABEL[step.disposition].padEnd(6);
    const note = step.note !== undefined ? sink.dim(` — ${step.note}`) : "";
    sink.line(`${indent}${label} ${step.label}${note}`);
  }
}

/** The JSON-friendly shape of one step (the generic `--json` payloads). */
export interface PlanStepJson {
  kind: PlanStep["kind"];
  label: string;
  disposition: StepDisposition;
  note?: string | undefined;
  group?: string | undefined;
}

/** One step with its execution outcome, for the apply-mode results serialization. */
export interface StepResultJson extends PlanStepJson {
  outcome: StepOutcome;
  duration_s?: number | undefined;
}

/** Reduce one step to its JSON-friendly shape. */
function stepToJson(step: PlanStep): PlanStepJson {
  return {
    kind: step.kind,
    label: step.label,
    disposition: step.disposition,
    note: step.note,
    group: step.group,
  };
}

/** The JSON-friendly shape of a whole plan (the `--dry-run --json` payload). */
export interface PlanJson {
  title: string;
  details: string[];
  steps: PlanStepJson[];
}

/** Reduce a plan to its JSON-friendly shape (no results — the dry-run payload). */
export function planToJson(plan: EnginePlan): PlanJson {
  return {
    title: plan.title,
    details: plan.details,
    steps: plan.steps.map(stepToJson),
  };
}

/**
 * Serialize (plan, results) — the generic apply-mode `--json` for verbs without a
 * bespoke contract (graduate / teardown / prune / setup / ratchets). `ok` is true
 * when no step failed. (The gate keeps its own ADR-0004 report shape, built from
 * its plan + results, rather than this generic shape.)
 */
export function resultsToJson(results: StepResult[]): {
  ok: boolean;
  steps: StepResultJson[];
} {
  return {
    ok: results.every((r) => r.outcome !== "failed"),
    steps: results.map((r) => ({
      ...stepToJson(r.step),
      outcome: r.outcome,
      duration_s: r.durationS,
    })),
  };
}
