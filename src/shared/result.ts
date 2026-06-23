/**
 * The engine's **result & plan vocabulary** — the single source of truth for what
 * every `discern` verb returns. A verb computes a pure {@link DiscernResult}; its
 * human text, its `--json`, and (the MCP server's) tool result are all renderings
 * of that one object, never re-derived in parallel (ADR 0027, ADR 0028).
 *
 * This module is the base layer — pure data and pure functions, zero internal
 * imports — so both halves of the binary (the `src/engine/**` engine and the
 * `src/commands/**` installer) depend on it without a cycle. The two sink
 * *adapters* that bridge to a concrete writer live with the writer they adapt:
 * `outSink` in `src/engine/output.ts`, `loggerSink` in `src/lib/log.ts`.
 *
 * Three concentric rings:
 *  1. the **plan vocabulary** — `EnginePlan`/`PlanStep`/`StepResult`: what a verb
 *     plans to do and how each step turned out (generalized from the installer's
 *     `fs_plan` pattern across the engine seam);
 *  2. the **diagnostic** — a normalized failure ({@link Diagnostic}): the
 *     structured "why" an agent reads to fix without re-running and scraping;
 *  3. the **envelope** — {@link DiscernResult}: the uniform `{ok, verb, …}` shell
 *     every verb returns, carrying a plan and/or steps, diagnostics, and a
 *     verb-specific `data` payload.
 */

// ── ring 1: the plan vocabulary ─────────────────────────────────────────────

/**
 * Whether a planned step will act when the plan is applied:
 *  - `run`  — the step will be performed (a job spawn, a git mutation, a destroy).
 *  - `skip` — the step is part of the plan but will NOT act (a configured-but-
 *             unchanged scope gate, a gc-opted-out resource). Listed for honesty.
 *  - `gate` — a read-only precondition that can BLOCK the plan but mutates nothing
 *             (the merge check). Rendered as "check".
 */
export type StepDisposition = "run" | "skip" | "gate";

/**
 * The engine's operation vocabulary — what a step DOES (never a filesystem write).
 * Deliberately coarse: the renderer groups by it and `--json` reports it.
 */
export type StepKind =
  | "job" // run a gate job (a capability or a check)
  | "scope-gate" // run a scope's self-contained gate
  | "merge-check" // assert the branch contains the integration branch
  | "guidance-check" // assert the generated agent files match their sources
  | "resource-create" // create a per-worktree external resource
  | "resource-destroy" // destroy / reclaim a per-worktree external resource
  | "git" // a git mutation (branch, wip-commit, remove, checkout, reset, sweep)
  | "setup-step" // a [worktree.setup].steps command
  | "env" // record port / inherit env / resource handles
  | "refresh" // recompile agent guidance + skills
  | "ratchet"; // measure a metric and compare it to its limit

/**
 * One step in an engine plan — the unit the shared renderer prints and the generic
 * `--json` serializes. Pure data: it carries no closures, so a plan is inspectable
 * and serializable before anything runs.
 */
export interface PlanStep {
  kind: StepKind;
  /** Stable label (a job/resource/scope/ratchet name, or a git verb). */
  label: string;
  disposition: StepDisposition;
  /** Human one-liner: what the step does, or why it is skipped. */
  note?: string | undefined;
  /** Optional display grouping (a gate stage, "resources", "git", …). */
  group?: string | undefined;
}

/**
 * A complete, renderable engine plan: a titled, optionally-prefaced step list. The
 * common projection every verb's typed plan reduces to for presentation.
 */
export interface EnginePlan {
  /** Imperative heading (e.g. "Graduation plan", "Gate plan"). */
  title: string;
  /** Context lines shown above the steps (e.g. branch / from / into). */
  details: string[];
  steps: PlanStep[];
}

/** A step's outcome after execution, for the generic results serialization. */
export type StepOutcome = "ok" | "failed" | "skipped";

/** One executed step: the planned step plus how it turned out. */
export interface StepResult {
  step: PlanStep;
  outcome: StepOutcome;
  /** Whole-second wall-clock duration when measured (jobs / ratchets). */
  durationS?: number | undefined;
}

// ── ring 2: the normalized diagnostic ───────────────────────────────────────

/**
 * A normalized failure from one gate command — the structured "why" behind a
 * failed step. discern's pitch is stack-neutral *commands*; the diagnostic extends
 * that to stack-neutral *results*, so an agent loops act→read-error→fix instead of
 * act→re-run→scrape-stderr→guess.
 *
 * Layered by how much discern knows about the tool (ADR 0028):
 *  - **Tier 0 (always, stack-neutral):** `tool`, `severity`, `message`,
 *    `reproduce_cmd` (the command's own string — free), and `output` (the captured
 *    combined stdout+stderr, tail-capped). No per-tool parsing; works everywhere.
 *  - **Tier 1 (opt-in):** when a capability/check declares a diagnostics `format`,
 *    discern parses `output` into `file`/`line`/`col`/`rule`/`message`.
 *  - **Tier 2 (derived):** `fix_available` — a fixer is wired that may resolve it.
 */
export interface Diagnostic {
  /** The job/capability/check label that produced this failure (e.g. "lint", "scope:web"). */
  tool: string;
  /** Tier-0 failures are always "error"; Tier-1 parsing may surface "warning". */
  severity: "error" | "warning";
  /** One-line summary (Tier 0: "<tool> failed (exit N)"; Tier 1: the parsed message). */
  message: string;
  /** The exact command to reproduce this failure — the job's own command string. */
  reproduce_cmd: string;
  /** Captured combined stdout+stderr from the failing command (Tier 0), tail-capped. */
  output?: string | undefined;
  /** True when `output` was truncated to the capture cap (head + tail kept). */
  truncated?: boolean | undefined;
  /** Tier 1: the source file the diagnostic points at. */
  file?: string | undefined;
  /** Tier 1: 1-based line number. */
  line?: number | undefined;
  /** Tier 1: 1-based column. */
  col?: number | undefined;
  /** Tier 1: the tool's rule/code identifier (an eslint rule, a `TSxxxx` code). */
  rule?: string | undefined;
  /** Tier 2: whether a wired fixer may auto-resolve this (a fix-stage command exists). */
  fix_available?: boolean | undefined;
}

// ── ring 3: the universal envelope ──────────────────────────────────────────

/**
 * The uniform result every `discern` verb returns. An agent can rely on `ok`,
 * `verb`, `error`, and `diagnostics` being present on EVERY verb; the structural
 * `plan`/`steps` carry the verbs that have steps (finish, worktree, ratchets,
 * graduate), and `data` carries each verb's own payload (doctor's checks, migrate's
 * schema versions, init's written-files list).
 *
 * `serializeResult` renders it to `--json`; the human path renders the same fields
 * (so the two can never disagree on WHAT happened) and may add verb-specific advice.
 */
export interface DiscernResult {
  /** Did the verb succeed? The one field every consumer can rely on. */
  ok: boolean;
  /** The verb that produced this result ("finish", "graduate", "doctor", …). */
  verb: string;
  /**
   * True when this is a preview (`--dry-run`): nothing was applied. The ONE
   * uniform "is this a preview?" signal across every verb — the engine plan rides
   * in `plan`, an installer's fs-plan in `data`, but `dry_run` marks both.
   */
  dry_run?: boolean | undefined;
  /** Dry-run / preview: the plan that WOULD run (mutually exclusive with `steps`). */
  plan?: EnginePlan | undefined;
  /** Apply: the steps that ran and how each turned out. */
  steps?: StepResult[] | undefined;
  /** Normalized failures — the structured "why" for an agent's act→fix loop. */
  diagnostics?: Diagnostic[] | undefined;
  /** Verb-specific payload that doesn't fit steps (checks, schema versions, file lists). */
  data?: unknown;
  /**
   * Agent-facing "what next" advice (ADR 0030): the next-step nudges a human run
   * prints (hold the ratchets, start the dev server, update the docs; on a failed
   * gate, where the gotchas are documented), promoted into the envelope so a quiet
   * `--json` run loses none of it. Purely advisory — NOT errors (those are `error`
   * / `diagnostics`).
   */
  hints?: string[] | undefined;
  /** A machine-stable error slug when the verb refused/aborted (e.g. "dirty_worktree"). */
  error?: string | undefined;
  /** A human sentence accompanying `error`. */
  message?: string | undefined;
}

// ── captured-output capping (the Tier-0 diagnostic budget) ──────────────────

/**
 * Chars retained in a failed command's captured `output` — large enough for a
 * tool's error block + summary, bounded so it never floods an agent's context.
 */
const CAPTURE_CAP = 16_000;

const isHighSurrogate = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/**
 * Cap a captured string to {@link CAPTURE_CAP}, keeping the head AND tail when it
 * overflows (a compiler lists the first error early; a runner prints its summary at
 * the end). Applied at the diagnostic boundary, not at capture, so structured
 * normalization (SARIF) still sees the full output. Cuts are snapped off UTF-16
 * surrogate boundaries so a multi-byte char is never split into a lone surrogate.
 */
export function capText(s: string): { text: string; truncated: boolean } {
  if (s.length <= CAPTURE_CAP) {
    return { text: s, truncated: false };
  }
  let head = Math.floor(CAPTURE_CAP * 0.6);
  if (isHighSurrogate(s.charCodeAt(head - 1))) {
    head -= 1; // don't split a surrogate pair at the head cut
  }
  let tailStart = s.length - (CAPTURE_CAP - head);
  if (isLowSurrogate(s.charCodeAt(tailStart))) {
    tailStart += 1; // …nor at the tail cut
  }
  const elided = tailStart - head;
  return {
    text: `${s.slice(0, head)}\n… ${elided} chars elided …\n${
      s.slice(tailStart)
    }`,
    truncated: true,
  };
}

// ── the shared plan renderer (the `--dry-run` listing) ──────────────────────

/**
 * The minimal output surface the renderer needs. Implemented by both the gate's
 * `Out` and the installer's `Logger` through `outSink` / `loggerSink` (which live
 * with the writer they adapt), so one renderer serves both paths.
 */
export interface RenderSink {
  heading(text: string): void;
  line(text: string): void;
  /** Dim a fragment (returns it unchanged when colour is off). */
  dim(text: string): string;
}

/** Short, human label for each disposition. */
const DISPOSITION_LABEL: Record<StepDisposition, string> = {
  run: "run",
  skip: "skip",
  gate: "check",
};

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

// ── the JSON projections ────────────────────────────────────────────────────

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
export function stepToJson(step: PlanStep): PlanStepJson {
  return {
    kind: step.kind,
    label: step.label,
    disposition: step.disposition,
    note: step.note,
    group: step.group,
  };
}

/** Reduce one executed step to its JSON-friendly shape. */
export function stepResultToJson(r: StepResult): StepResultJson {
  return {
    ...stepToJson(r.step),
    outcome: r.outcome,
    duration_s: r.durationS,
  };
}

/** The JSON-friendly shape of a whole plan (the `--dry-run` payload). */
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
 * Serialize (plan, results) into the legacy generic apply-mode shape `{ok, steps}`.
 * Retained for the verbs not yet migrated to {@link serializeResult}; new code
 * should build a {@link DiscernResult} and serialize that instead.
 */
export function resultsToJson(results: StepResult[]): {
  ok: boolean;
  steps: StepResultJson[];
} {
  return {
    ok: results.every((r) => r.outcome !== "failed"),
    steps: results.map(stepResultToJson),
  };
}

// ── envelope constructors ───────────────────────────────────────────────────

/**
 * A preview (dry-run) result: the plan that WOULD run, nothing executed. Carries
 * `plan` and no `steps`, the structural signal that nothing acted.
 */
export function previewResult(verb: string, plan: EnginePlan): DiscernResult {
  return { ok: true, verb, dry_run: true, plan };
}

/**
 * An applied result: the steps that ran (ok when none failed), with optional
 * diagnostics. The single place the "ok = no step failed" rule lives, so every
 * plan/apply verb agrees on it.
 */
export function appliedResult(
  verb: string,
  results: StepResult[],
  diagnostics?: Diagnostic[],
): DiscernResult {
  return {
    ok: results.every((r) => r.outcome !== "failed"),
    verb,
    steps: results,
    diagnostics: diagnostics !== undefined && diagnostics.length > 0
      ? diagnostics
      : undefined,
  };
}

// ── the envelope serializer ─────────────────────────────────────────────────

/**
 * Serialize a {@link DiscernResult} to the single `--json` object every verb emits.
 * Undefined fields are dropped so a verb's payload stays minimal — a dry-run shows
 * `plan` and no `steps`; a clean apply shows `steps` and no `diagnostics`. This is
 * the ONE place the wire shape is defined; the human renderer reads the same
 * `DiscernResult`, so the two presentations can never disagree on what happened.
 */
export function serializeResult(r: DiscernResult): Record<string, unknown> {
  const out: Record<string, unknown> = { ok: r.ok, verb: r.verb };
  if (r.dry_run !== undefined) {
    out.dry_run = r.dry_run;
  }
  if (r.plan !== undefined) {
    out.plan = planToJson(r.plan);
  }
  if (r.steps !== undefined) {
    out.steps = r.steps.map(stepResultToJson);
  }
  if (r.diagnostics !== undefined) {
    out.diagnostics = r.diagnostics;
  }
  if (r.data !== undefined) {
    out.data = r.data;
  }
  if (r.hints !== undefined && r.hints.length > 0) {
    out.hints = r.hints;
  }
  if (r.error !== undefined) {
    out.error = r.error;
  }
  if (r.message !== undefined) {
    out.message = r.message;
  }
  return out;
}
