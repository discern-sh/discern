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
 *
 * A const tuple so `result_schemas.ts` derives its Zod enum from it (rather than
 * hand-mirroring), keeping the wire vocabulary tied to this one source.
 */
export const STEP_DISPOSITIONS = ["run", "skip", "gate"] as const;
/** One planned-step disposition ({@link STEP_DISPOSITIONS}). */
export type StepDisposition = (typeof STEP_DISPOSITIONS)[number];

/**
 * The engine's operation vocabulary — what a step DOES (never a filesystem write).
 * Deliberately coarse: the renderer groups by it and `--json` reports it. A const
 * tuple so `result_schemas.ts` derives its Zod enum from it — a new kind extends the
 * union AND the wire schema from one edit, never a hand-kept mirror that can lag.
 */
export const STEP_KINDS = [
  "job", // run a gate job (a capability or a check)
  "scope-gate", // run a scope's self-contained gate
  "merge-check", // assert the branch contains the integration branch
  "guidance-check", // assert the generated agent files match their sources
  "skills-check", // assert the materialized skills match the effective set
  "resource-create", // create a per-worktree external resource
  "resource-destroy", // destroy / reclaim a per-worktree external resource
  "git", // a git mutation (branch, remove, checkout, fast-forward, sweep)
  "setup-step", // a [worktree.setup].steps command (one-shot, at creation)
  "setup-ensure", // a [worktree.setup].ensure command (convergent, every pass)
  "env", // record port / inherit env / resource handles
  "refresh", // recompile agent guidance + skills
  "ratchet", // measure a metric and compare it to its limit
] as const;
/** One engine operation kind ({@link STEP_KINDS}). */
export type StepKind = (typeof STEP_KINDS)[number];

/**
 * Who a step's command belongs to — the two-way split `discern doctor`'s execution
 * model marks every step with: `"project"` is a command from the project's own config
 * (a capability/check, a scope or ratchet command, a resource `create`/`destroy`, a
 * `[worktree.setup]` step), `"discern"` is a built-in operation the harness performs
 * itself (a precondition check, a git mutation, an env/refresh step). A const tuple so
 * `result_schemas.ts` derives its Zod enum from it rather than hand-mirroring.
 */
export const ACTORS = ["project", "discern"] as const;
/** One step actor ({@link ACTORS}). */
export type Actor = (typeof ACTORS)[number];

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

/** A step's outcome after execution, for the generic results serialization. A const
 * tuple so `result_schemas.ts` derives its Zod enum from it (not a hand mirror). */
export const STEP_OUTCOMES = ["ok", "failed", "skipped"] as const;
/** One executed-step outcome ({@link STEP_OUTCOMES}). */
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

/** One executed step: the planned step plus how it turned out. */
export interface StepResult {
  step: PlanStep;
  outcome: StepOutcome;
  /** Whole-second wall-clock duration when measured (jobs / ratchets). */
  durationS?: number | undefined;
}

/**
 * The gate's **failed-stage vocabulary** — every label `finish`/`prepare`/`test`
 * can record as the stage that failed (the value carried in `GateData.failed_stage`
 * and the key the human die message is looked up by). A CLOSED set: typing every hop
 * to it, deriving the Zod `failed_stage` enum (`result_schemas.ts`) from it, and
 * building the message table (`failMessage`, a total `Record<FailedStage, string>`)
 * from it makes a new label a COMPILE error until every consumer handles it — it can
 * never fall through to a generic "a stage failed".
 *
 * The members, by origin:
 *  - `fix` / `build` / `check` / `test` — one capability stage's job group failed
 *    (`prepare` runs `check` alone; `discern test` runs `test` alone);
 *  - `check/test` — `finish` fuses the read-only checks and the tests into ONE group,
 *    so their combined failure reports this label rather than `check` or `test`;
 *  - `scope_gates` — a changed scope's self-contained gate failed;
 *  - `fix_drift` — the fix stage left uncommitted changes (ADR 0047);
 *  - `guidance` / `skills` — a generated agent file / materialized skills dir is stale
 *    (the currency checks, ADR 0034);
 *  - `merge` — the branch is behind the integration branch (the fail-fast
 *    precondition, ADR 0050).
 *
 * Defined in this base vocabulary module (not the engine) because `result_schemas.ts`
 * — a `shared/` module that must NOT import the engine — derives the `failed_stage`
 * enum from it; placing it in the gate would invert that layer (and cycle with
 * `plan.ts`, which already imports `GateData` from `result_schemas.ts`).
 */
export const FAILED_STAGES = [
  "fix",
  "build",
  "check",
  "test",
  "check/test",
  "scope_gates",
  "fix_drift",
  "guidance",
  "skills",
  "merge",
] as const;

/** One failed-stage label ({@link FAILED_STAGES}). */
export type FailedStage = (typeof FAILED_STAGES)[number];

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
 *    combined stdout+stderr, terminal-normalized and capped) plus `output_path`
 *    when the full normalized capture was offloaded. No per-tool parsing; works
 *    everywhere.
 *  - **Tier 1 (opt-in):** when a capability/check declares a diagnostics `format`,
 *    discern parses `output` into `file`/`line`/`col`/`rule`/`message`.
 *  - **Tier 2 (derived):** `fix_available` — a fixer is wired that may resolve it.
 */

/** A diagnostic's severity. A const tuple so `result_schemas.ts` derives its Zod
 * enum from it (not a hand mirror), keeping the wire vocabulary tied to this source. */
export const DIAGNOSTIC_SEVERITIES = ["error", "warning"] as const;
/** One diagnostic severity ({@link DIAGNOSTIC_SEVERITIES}). */
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export interface Diagnostic {
  /** The job/capability/check label that produced this failure (e.g. "lint", "scope:web"). */
  tool: string;
  /** Tier-0 failures are always "error"; Tier-1 parsing may surface "warning". */
  severity: DiagnosticSeverity;
  /** One-line summary (Tier 0: "<tool> failed (exit N)"; Tier 1: the parsed message). */
  message: string;
  /** The exact command to reproduce this failure — the job's own command string. */
  reproduce_cmd: string;
  /** Captured combined stdout+stderr from the failing command (Tier 0), normalized and capped. */
  output?: string | undefined;
  /** True when `output` was truncated to the capture cap (head + tail kept). */
  truncated?: boolean | undefined;
  /** Absolute path to the full normalized capture when `output` was truncated. */
  output_path?: string | undefined;
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
 *
 * Generic over its `data` payload (`TData`, default `unknown`): a verb core narrows
 * it to its own schema-backed type (`DiscernResult<StatusData>`, `<GateData>`, …) so
 * a core that builds the wrong `data` shape is a COMPILE error and a consumer reads
 * `result.data` already typed — no `as` cast back from `unknown`. The dataless verbs
 * and the generic renderers keep the `unknown` default; `serializeResult` and the
 * other sinks accept any specialization (every `DiscernResult<T>` widens to
 * `DiscernResult<unknown>`).
 */
export interface DiscernResult<TData = unknown> {
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
  data?: TData | undefined;
  /**
   * Agent-facing "what next" advice (ADR 0030): the next-step nudges a human run
   * prints (check the ratchets, start the dev server, update the docs; on a failed
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
export const CAPTURE_CAP = 16_000;

const isHighSurrogate = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

export interface CappedText {
  text: string;
  truncated: boolean;
  /** The full normalized text before capping. Equal to `text` when untruncated. */
  fullText: string;
}

function collapseCarriageReturns(s: string): string {
  return s.replaceAll("\r\n", "\n").split("\n")
    .map((line) => {
      const lastReturn = line.lastIndexOf("\r");
      return lastReturn === -1 ? line : line.slice(lastReturn + 1);
    })
    .join("\n");
}

function stripTerminalEscapes(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) !== 0x1b) {
      out += s.charAt(i);
      continue;
    }
    const kind = s.charAt(i + 1);
    if (kind === "[") {
      i += 2;
      while (i < s.length) {
        const code = s.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) {
          break;
        }
        i += 1;
      }
      continue;
    }
    if (kind === "]") {
      i += 2;
      while (i < s.length) {
        const code = s.charCodeAt(i);
        if (code === 0x07) {
          break;
        }
        if (code === 0x1b && s.charAt(i + 1) === "\\") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    const nextCode = s.charCodeAt(i + 1);
    if (
      (nextCode >= 0x40 && nextCode <= 0x5a) ||
      (nextCode >= 0x5c && nextCode <= 0x5f)
    ) {
      i += 1;
    }
  }
  return out;
}

/**
 * Normalize captured terminal output without learning anything about the tool that
 * produced it: keep the visible end state of carriage-return rewrites, remove
 * terminal escape controls, and drop non-text C0 controls while preserving newlines
 * and tabs.
 */
export function normalizeCapturedOutput(s: string): string {
  return stripTerminalEscapes(collapseCarriageReturns(s))
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 || code === 0x0a || code === 0x09;
    })
    .join("");
}

/**
 * Normalize then cap a captured string to {@link CAPTURE_CAP}, keeping the head AND
 * tail when it overflows (a compiler lists the first error early; a runner prints
 * its summary at the end). Applied at the diagnostic boundary, not at capture, so
 * structured normalization (SARIF) still sees the full output. Cuts are snapped off
 * UTF-16 surrogate boundaries so a multi-byte char is never split into a lone
 * surrogate.
 */
export function capText(s: string): CappedText {
  const normalized = normalizeCapturedOutput(s);
  if (normalized.length <= CAPTURE_CAP) {
    return { text: normalized, truncated: false, fullText: normalized };
  }

  let marker = "";
  let head = 0;
  let tailStart = normalized.length;
  for (let i = 0; i < 4; i += 1) {
    const budget = CAPTURE_CAP - marker.length;
    head = Math.max(0, Math.floor(budget * 0.6));
    if (head > 0 && isHighSurrogate(normalized.charCodeAt(head - 1))) {
      head -= 1; // don't split a surrogate pair at the head cut
    }
    const tailChars = Math.max(0, budget - head);
    tailStart = Math.max(head, normalized.length - tailChars);
    if (
      tailStart < normalized.length &&
      isLowSurrogate(normalized.charCodeAt(tailStart))
    ) {
      tailStart += 1; // …nor at the tail cut
    }
    const nextMarker = `\n… ${tailStart - head} chars elided …\n`;
    if (nextMarker === marker) {
      break;
    }
    marker = nextMarker;
  }
  return {
    text: `${normalized.slice(0, head)}${marker}${normalized.slice(tailStart)}`,
    truncated: true,
    fullText: normalized,
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
export function previewResult(
  verb: string,
  plan: EnginePlan,
): DiscernResult<never> {
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
): DiscernResult<never> {
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
