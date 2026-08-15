/**
 * Pure presentation for the Gate's human journey.
 *
 * Discern supplies typed plan, execution, diagnostic, Standard, and Proof facts.
 * The released design-system package supplies every terminal Component, text
 * measurement, Token role, and triangle motif that present those facts.
 * Nothing in this module observes the process, clock, filesystem, Git, or Gate.
 */

import {
  type DiagnosticCliProps,
  type ReceiptCliProps,
  renderCommandCli,
  renderDiagnosticCli,
  renderMeterCli,
  renderPrerequisiteListCli,
  renderProcedureCli,
  renderRawOutputCli,
  renderReceiptCli,
  renderResultSummaryCli,
  renderRetryNoticeCli,
  renderStandardMeterCli,
  type ResultSummaryCliProps,
  type SequentialStepStatus,
  type StandardMeterCliProps,
} from "discern-design-system/cli";
import {
  type TerminalContext,
  terminalLine,
  terminalMultiline,
} from "../../lib/terminal.ts";
import {
  type Diagnostic,
  type EnginePlan,
  type FailedStage,
  type PlanStep,
  STEP_OUTCOMES,
  type StepDisposition,
  type StepKind,
  type StepOutcome,
  type StepResult,
} from "../../shared/result.ts";
import type { LANDING_AUTHORITY_KINDS } from "../../shared/consent.ts";
import type {
  GateData,
  GateProofCheckData,
  GateProofCheckStatus,
  GateStandard,
  LandingAuthorityData,
  Proof,
  StandardMeasurementDisposition,
  StandardVerdictLabel,
} from "../../shared/result_schemas.ts";
import type { JobResult } from "../jobs/types.ts";
import type { JobGroup } from "./plan.ts";
import { fmtDuration } from "./proof_render.ts";

const MAX_GATE_WIDTH = 120;
const MIN_COMPONENT_WIDTH = 20;

/** Explicit inputs shared by every pure Gate view. */
export interface GatePresentationOptions {
  readonly terminal: TerminalContext;
  /** Full terminal width in visible columns. */
  readonly width: number;
  /** Package spinner phase. Time remains an effectful caller concern. */
  readonly phase?: number;
}

/** Live and final states presented by the Gate workflow. */
export type GateJobPresentationStatus =
  | StepOutcome
  | "pending"
  | "running";

/** One job fact after Discern has decided its meaning. */
export interface GateJobPresentation {
  readonly group: string;
  readonly label: string;
  readonly command: string;
  readonly kind: string;
  readonly status: GateJobPresentationStatus;
  readonly durationS?: number;
  /** Explicit live duration supplied by the effectful controller. */
  readonly elapsedS?: number;
}

/** Product grammar sharing one live dashboard without conflating Gate and test. */
export type GateLiveDashboardKind = "gate" | "test";

/** Exhaustive aggregate states shown by full, compact, and continuous views. */
export type GateLiveDashboardState =
  | "active"
  | "failed"
  | "cancelled"
  | "complete";

/** Pure scheduler projection consumed by every live presentation mode. */
export interface GateLiveDashboard {
  readonly kind: GateLiveDashboardKind;
  readonly state: GateLiveDashboardState;
  readonly jobs: readonly GateJobPresentation[];
  readonly running: readonly GateJobPresentation[];
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly remaining: number;
  readonly total: number;
  readonly elapsedS: number;
}

const LIVE_DASHBOARD_RESULT_STATE = {
  active: "changed",
  failed: "failed",
  cancelled: "blocked",
  complete: "passed",
} as const satisfies Readonly<
  Record<GateLiveDashboardState, ResultSummaryCliProps["state"]>
>;

/** Exhaustive status mapping into the package workflow vocabulary. */
export const GATE_JOB_STEP_STATUS = {
  pending: "pending",
  running: "active",
  ok: "complete",
  failed: "error",
  skipped: "cancelled",
  cancelled: "cancelled",
} as const satisfies Readonly<
  Record<GateJobPresentationStatus, SequentialStepStatus>
>;

/** Human labels remain separate from semantic package status. */
export const GATE_JOB_STATUS_LABEL = {
  pending: "pending",
  running: "running",
  ok: "passed",
  failed: "failed",
  skipped: "skipped",
  cancelled: "cancelled",
} as const satisfies Readonly<Record<GateJobPresentationStatus, string>>;

/** Exhaustive dry-run mapping. A skipped plan step is visibly inactive. */
export const GATE_PLAN_STEP_STATUS = {
  gate: "pending",
  run: "pending",
  skip: "cancelled",
} as const satisfies Readonly<Record<StepDisposition, SequentialStepStatus>>;

/** Exhaustive Gate failure-stage labels for human result composition. */
export const GATE_FAILED_STAGE_LABEL = {
  fix: "Fix stage",
  build: "Build stage",
  check: "Check stage",
  test: "Test stage",
  "check/test": "Check and test stage",
  scope_gates: "Changed-scope gates",
  tree_drift: "Tracked-tree currency",
  generated_drift: "Generated-artifact currency",
  refresh_drift: "Tracked refresh currency",
  tracked_artifacts: "Tracked-artifact ownership",
  guidance: "Agent guidance currency",
  skills: "Agent Skill currency",
  skill_frontmatter: "Agent Skill metadata",
  adr_numbers: "ADR numbering",
  adr_index: "ADR index currency",
  map_integrity: "Map integrity",
  merge: "Trunk integration",
  standards: "Standard limits",
  write_access: "discern write access",
} as const satisfies Readonly<Record<FailedStage, string>>;

/** Exhaustive diagnostic mapping into the package severity vocabulary. */
export const GATE_DIAGNOSTIC_SEVERITY = {
  error: "failure",
  warning: "attention",
} as const satisfies Readonly<
  Record<Diagnostic["severity"], NonNullable<DiagnosticCliProps["severity"]>>
>;

/** Exhaustive Standard direction mapping into floor/ceiling semantics. */
export const GATE_STANDARD_DIRECTION = {
  up: "floor",
  down: "ceiling",
} as const satisfies Readonly<
  Record<GateStandard["direction"], "floor" | "ceiling">
>;

/** Exhaustive Standard verdict mapping into package trajectory semantics. */
export const GATE_STANDARD_TREND = {
  improved: "improving",
  held: "flat",
  regressed: "drifting",
} as const satisfies Readonly<
  Record<StandardVerdictLabel, NonNullable<StandardMeterCliProps["trend"]>>
>;

/** Exact measurement labels used by Standard evidence summaries. */
export const GATE_STANDARD_MEASUREMENT_LABEL = {
  measured: "measured",
  replayed: "replayed",
  deferred: "deferred",
  skipped: "skipped",
} as const satisfies Readonly<Record<StandardMeasurementDisposition, string>>;

type GateProofRecord = NonNullable<GateData["gate_proof"]>;
type GateProofRecordStatus = GateProofRecord["status"];

interface ReceiptPresentationState {
  readonly checkState: NonNullable<ReceiptCliProps["checks"]>[number]["state"];
  readonly stateLabel: string;
  readonly summary: string;
  readonly stamp?: NonNullable<ReceiptCliProps["stamp"]>;
}

/**
 * Exhaustive recording-state mapping. Only a recorded Proof earns a pass stamp;
 * every other state stays visibly unrecorded even when the Gate itself passed.
 */
export const GATE_PROOF_RECORD_PRESENTATION = {
  recorded: {
    checkState: "pass",
    stateLabel: "recorded",
    summary: "The Proof was recorded for this committed tree.",
    stamp: "pass",
  },
  skipped_dirty: {
    checkState: "skip",
    stateLabel: "not recorded",
    summary: "The Gate passed, but the worktree was dirty when the run began.",
  },
  skipped_head_moved: {
    checkState: "skip",
    stateLabel: "not recorded",
    summary: "The Gate passed, but HEAD moved while the Gate was running.",
  },
  unavailable: {
    checkState: "fail",
    stateLabel: "unavailable",
    summary: "The Gate passed, but Proof recording was unavailable.",
  },
  record_failed: {
    checkState: "fail",
    stateLabel: "record failed",
    summary: "The Gate passed, but the Proof record could not be written.",
  },
  cleared: {
    checkState: "skip",
    stateLabel: "cleared",
    summary: "A prior Proof was cleared after the Gate failed.",
  },
  clear_failed: {
    checkState: "fail",
    stateLabel: "clear failed",
    summary: "The Gate failed, and its prior Proof could not be cleared.",
  },
} as const satisfies Readonly<
  Record<GateProofRecordStatus, ReceiptPresentationState>
>;

/** Exhaustive inspection-state mapping prepared for Proof consumers. */
export const GATE_PROOF_CHECK_PRESENTATION = {
  honored: {
    checkState: "pass",
    stateLabel: "current",
    summary: "The Proof matches the clean current HEAD.",
    stamp: "pass",
  },
  missing: {
    checkState: "skip",
    stateLabel: "missing",
    summary: "No Proof is recorded for the current worktree.",
  },
  stale: {
    checkState: "fail",
    stateLabel: "stale",
    summary: "The recorded Proof names a different commit.",
  },
  dirty: {
    checkState: "fail",
    stateLabel: "dirty",
    summary: "The worktree changed after the Proof was recorded.",
  },
  unavailable: {
    checkState: "fail",
    stateLabel: "unavailable",
    summary: "The Proof location is unavailable.",
  },
  read_failed: {
    checkState: "fail",
    stateLabel: "unreadable",
    summary: "The recorded Proof could not be read.",
  },
} as const satisfies Readonly<
  Record<GateProofCheckStatus, ReceiptPresentationState>
>;

/** Exhaustive landing-readiness mapping for the Gate receipt. */
export const GATE_LANDING_AUTHORITY_PRESENTATION = {
  authorized: {
    state: "pass",
    stateLabel: "authorized",
  },
  "conversation-required": {
    state: "skip",
    stateLabel: "conversation required",
  },
} as const satisfies Readonly<
  Record<
    (typeof LANDING_AUTHORITY_KINDS)[number],
    {
      readonly state: NonNullable<ReceiptCliProps["checks"]>[number]["state"];
      readonly stateLabel: string;
    }
  >
>;

/** Bound one explicit viewport while retaining the package Component minimum. */
function presentationWidth(width: number): number {
  const finite = Number.isFinite(width) ? Math.floor(width) : 80;
  return Math.max(MIN_COMPONENT_WIDTH, Math.min(MAX_GATE_WIDTH, finite - 2));
}

/** Preserve an empty observed value as an explicit visible fact. */
function safeLine(value: string, fallback = "(empty)"): string {
  const safe = terminalLine(value);
  return safe === "" ? fallback : safe;
}

/** Preserve an empty observed block as an explicit visible fact. */
function safeMultiline(value: string, fallback = "(empty)"): string {
  const safe = terminalMultiline(value);
  return safe === "" ? fallback : safe;
}

/** True when a job state is final in this run. */
function statusSettled(status: GateJobPresentationStatus): boolean {
  return status !== "pending" && status !== "running";
}

/** Explain who owns one planned or completed job. */
function jobKindLabel(kind: string): string {
  switch (kind) {
    case "known":
      return "Configured known job";
    case "custom":
      return "Configured custom job";
    case "generated":
      return "Configured generated-artifact job";
    case "scope-gate":
      return "Configured scope gate";
    case "standard":
      return "discern Standard measurement";
    case "job":
      return "Configured project job";
    default:
      return "discern Gate step";
  }
}

/** Compose the truthful action and duration behind one job command. */
function jobAction(row: GateJobPresentation): string {
  if (row.status === "running" && row.elapsedS !== undefined) {
    return `${jobKindLabel(row.kind)} running for ${
      fmtDuration(row.elapsedS)
    }.`;
  }
  const duration = row.durationS === undefined || !statusSettled(row.status)
    ? ""
    : ` in ${fmtDuration(row.durationS)}`;
  return `${jobKindLabel(row.kind)} ${
    GATE_JOB_STATUS_LABEL[row.status]
  }${duration}.`;
}

interface GateJobRun {
  readonly group: string;
  readonly rows: readonly GateJobPresentation[];
}

interface MutableGateJobRun {
  readonly group: string;
  readonly rows: GateJobPresentation[];
}

/** Preserve recurring semantic groups as separate ordered runs. */
function jobRuns(rows: readonly GateJobPresentation[]): GateJobRun[] {
  const runs: MutableGateJobRun[] = [];
  for (const row of rows) {
    const last = runs.at(-1);
    if (last?.group === row.group) {
      last.rows.push(row);
    } else {
      runs.push({ group: row.group, rows: [row] });
    }
  }
  return runs;
}

/** Render one semantic Gate group through Procedure and Command Components. */
function renderJobRun(
  run: GateJobRun,
  options: GatePresentationOptions,
): string {
  const width = presentationWidth(options.width);
  const presenter = options.terminal.presenter;
  const phase = options.phase ?? 0;
  const procedure = presenter.present(renderProcedureCli, {
    title: safeLine(run.group),
    steps: run.rows.map((row) => ({
      title: safeLine(
        `${row.label} [${GATE_JOB_STATUS_LABEL[row.status]}]`,
      ),
      status: GATE_JOB_STEP_STATUS[row.status],
      ...(row.status === "running" ? { phase } : {}),
    })),
    completion: "Every configured step reaches a final reported state.",
    completionLabel: "Complete when",
    maxWidth: width,
  });
  const commands = run.rows.map((row) =>
    presenter.present(renderCommandCli, {
      command: safeMultiline(row.command),
      explanation: safeMultiline(`${row.label}: ${jobAction(row)}`),
      maxWidth: width,
    })
  );
  return [procedure, ...commands].join("\n\n");
}

/** Build aggregate dashboard facts from an already-projected job collection. */
export function gateLiveDashboard(
  jobs: readonly GateJobPresentation[],
  kind: GateLiveDashboardKind,
  elapsedS: number,
): GateLiveDashboard {
  const completed = jobs.filter((row) => statusSettled(row.status)).length;
  const failed = jobs.filter((row) => row.status === "failed").length;
  const cancelled = jobs.filter((row) => row.status === "cancelled").length;
  const remaining = jobs.length - completed;
  const state: GateLiveDashboardState = failed > 0
    ? "failed"
    : cancelled > 0
    ? "cancelled"
    : remaining === 0
    ? "complete"
    : "active";
  return {
    kind,
    state,
    jobs,
    running: jobs.filter((row) => row.status === "running"),
    completed,
    failed,
    cancelled,
    remaining,
    total: jobs.length,
    elapsedS: Math.max(0, Math.floor(elapsedS)),
  };
}

/** The product noun and meter label for one shared live grammar. */
function dashboardSubject(kind: GateLiveDashboardKind): {
  readonly noun: string;
  readonly label: string;
  readonly empty: string;
} {
  return kind === "test"
    ? {
      noun: "Test",
      label: "Test progress",
      empty: "No test job is configured, so no project command ran.",
    }
    : {
      noun: "Gate",
      label: "Gate progress",
      empty: "No Gate job is configured, so no project command ran.",
    };
}

/** Render aggregate progress and every ordered job fact through package Components. */
export function renderGateFullDashboard(
  dashboard: GateLiveDashboard,
  options: GatePresentationOptions,
): string {
  const width = presentationWidth(options.width);
  const presenter = options.terminal.presenter;
  const subject = dashboardSubject(dashboard.kind);
  if (dashboard.jobs.length === 0) {
    return presenter.present(renderResultSummaryCli, {
      state: "unchanged",
      fact: safeLine(subject.empty),
      maxWidth: width,
    });
  }
  const lifecycle = dashboard.state === "failed"
    ? {
      status: "validation-error" as const,
      message: safeLine(
        dashboard.kind === "test" ? "Tests failed." : "A Gate job failed.",
      ),
    }
    : dashboard.state === "cancelled"
    ? {
      status: "cancelled" as const,
      reason: safeLine(
        dashboard.kind === "test"
          ? "The test run was cancelled."
          : "The Gate run was cancelled.",
      ),
    }
    : dashboard.state === "complete"
    ? { status: "submitted" as const }
    : { status: "active" as const };
  const progress = presenter.present(renderMeterCli, {
    kind: "determinate-progress",
    label: safeLine(subject.label),
    lifecycle,
    completed: dashboard.completed,
    total: dashboard.total,
    tone: dashboard.state === "failed"
      ? "danger"
      : dashboard.state === "cancelled"
      ? "warning"
      : "neutral",
    width,
  });
  return [
    progress,
    ...jobRuns(dashboard.jobs).map((run) => renderJobRun(run, options)),
  ].join("\n\n");
}

/** Render the intentionally small live view: aggregate facts plus active jobs. */
export function renderGateCompactDashboard(
  dashboard: GateLiveDashboard,
  options: GatePresentationOptions,
): string {
  const width = presentationWidth(options.width);
  const presenter = options.terminal.presenter;
  const subject = dashboardSubject(dashboard.kind);
  if (dashboard.total === 0) {
    return presenter.present(renderResultSummaryCli, {
      state: "unchanged",
      fact: safeLine(subject.empty),
      maxWidth: width,
    });
  }
  const running = dashboard.running.map((row) => row.label);
  const activity = running.length === 0
    ? dashboard.state === "active"
      ? "Waiting for the next job to start."
      : `The ${subject.noun.toLowerCase()} has no running job.`
    : running.length === 1
    ? `Running: ${running[0] ?? "(unknown)"}.`
    : `Running concurrently: ${running.join(", ")}.`;
  const status = dashboard.state === "active"
    ? "active"
    : dashboard.state === "failed"
    ? "failed"
    : dashboard.state === "cancelled"
    ? "cancelled"
    : "complete";
  return presenter.present(renderResultSummaryCli, {
    state: LIVE_DASHBOARD_RESULT_STATE[dashboard.state],
    fact: safeLine(
      `${subject.noun} ${status} · ${dashboard.completed} / ${dashboard.total} jobs settled. ${activity}`,
    ),
    counts: [
      { label: "Completed", value: safeLine(String(dashboard.completed)) },
      { label: "Failed", value: safeLine(String(dashboard.failed)) },
      { label: "Cancelled", value: safeLine(String(dashboard.cancelled)) },
      { label: "Remaining", value: safeLine(String(dashboard.remaining)) },
    ],
    duration: safeLine(fmtDuration(dashboard.elapsedS)),
    maxWidth: width,
  });
}

/** Compatibility projection for completed and static Gate job tables. */
export function renderGateJobs(
  rows: readonly GateJobPresentation[],
  options: GatePresentationOptions,
  kind: GateLiveDashboardKind = "gate",
  elapsedS = 0,
): string {
  return renderGateFullDashboard(
    gateLiveDashboard(rows, kind, elapsedS),
    options,
  );
}

/** Project completed envelope steps without re-deciding any outcome. */
export function completedGateJobs(
  steps: readonly StepResult[],
): GateJobPresentation[] {
  return steps
    .filter((result) =>
      result.step.kind === "job" || result.step.kind === "scope-gate" ||
      result.step.kind === "standard"
    )
    .map((result) => ({
      group: result.step.group ?? "Gate jobs",
      label: result.step.label,
      command: result.step.note ?? result.step.label,
      kind: result.step.kind,
      status: result.outcome,
      ...(result.step.disposition === "run" && result.durationS !== undefined
        ? { durationS: result.durationS }
        : {}),
    }));
}

/** Resolve a settled scheduler result without consulting presentation. */
function jobOutcome(result: JobResult): StepOutcome {
  if (result.cancelled === true) return "cancelled";
  return result.code === 0 ? "ok" : "failed";
}

/** Project planned jobs and scheduler facts without implying a pending job ran. */
export function liveGateJobs(
  groups: readonly JobGroup[],
  running: ReadonlySet<string>,
  results: ReadonlyMap<string, JobResult>,
  startedAtMs: ReadonlyMap<string, number> = new Map(),
  timeMs = 0,
): GateJobPresentation[] {
  return groups.flatMap((group) =>
    group.jobs.map((job): GateJobPresentation => {
      const settled = results.get(job.label);
      if (settled !== undefined) {
        return {
          group: group.display,
          label: job.label,
          command: job.command,
          kind: job.kind,
          status: jobOutcome(settled),
          durationS: settled.durationS,
        };
      }
      if (running.has(job.label)) {
        const started = startedAtMs.get(job.label);
        return {
          group: group.display,
          label: job.label,
          command: job.command,
          kind: job.kind,
          status: "running",
          ...(started === undefined
            ? {}
            : { elapsedS: Math.max(0, Math.floor((timeMs - started) / 1000)) }),
        };
      }
      return {
        group: group.display,
        label: job.label,
        command: job.command,
        kind: job.kind,
        status: job.willRun ? "pending" : "skipped",
      };
    })
  );
}

/** Explain the owner and meaning of one Gate plan step kind. */
function planKindLabel(kind: StepKind): string {
  if (kind === "job") return "Configured project job";
  if (kind === "scope-gate") return "Configured scope gate";
  if (kind === "standard") return "discern Standard measurement";
  return "discern prerequisite";
}

interface PlanRun {
  readonly group: string | undefined;
  readonly steps: readonly PlanStep[];
}

interface MutablePlanRun {
  readonly group: string | undefined;
  readonly steps: PlanStep[];
}

/** Preserve contiguous plan groups, including repeated prerequisite runs. */
function planRuns(steps: readonly PlanStep[]): PlanRun[] {
  const runs: MutablePlanRun[] = [];
  for (const step of steps) {
    const last = runs.at(-1);
    if (last !== undefined && last.group === step.group) {
      last.steps.push(step);
    } else {
      runs.push({ group: step.group, steps: [step] });
    }
  }
  return runs;
}

/** Render one discern-owned prerequisite run. */
function renderPlanPrerequisites(
  run: PlanRun,
  occurrence: number,
  options: GatePresentationOptions,
): string {
  const width = presentationWidth(options.width);
  return options.terminal.presenter.present(renderPrerequisiteListCli, {
    title: occurrence === 1 ? "Gate prerequisites" : "Final checks",
    items: run.steps.map((step) => ({
      requirement: safeMultiline(
        `${step.label}: ${step.note ?? planKindLabel(step.kind)}`,
      ),
      state: step.disposition === "skip" ? "satisfied" : "required",
      detail: safeMultiline(
        `${planKindLabel(step.kind)} is marked ${step.disposition}.`,
      ),
    })),
    maxWidth: width,
  });
}

/** Render one configured Gate-job plan run. */
function renderPlanJobRun(
  run: PlanRun,
  options: GatePresentationOptions,
): string {
  return renderGateJobs(
    run.steps.map((step) => ({
      group: run.group ?? "Gate steps",
      label: step.label,
      command: step.note ?? planKindLabel(step.kind),
      kind: step.kind,
      status: GATE_PLAN_STEP_STATUS[step.disposition] === "cancelled"
        ? "skipped"
        : "pending",
    })),
    options,
  );
}

/** Render the Gate dry-run plan while preserving every semantic group run. */
export function renderGatePlan(
  plan: EnginePlan,
  options: GatePresentationOptions,
): string {
  const width = presentationWidth(options.width);
  const presenter = options.terminal.presenter;
  const title = presenter.triangleSectionRule(safeLine(plan.title), {
    width,
  });
  const context = plan.details.length === 0
    ? []
    : [presenter.present(renderResultSummaryCli, {
      state: "unchanged",
      fact: safeMultiline(plan.details.join("\n")),
      maxWidth: width,
    })];
  if (plan.steps.length === 0) {
    return [
      title,
      ...context,
      presenter.present(renderResultSummaryCli, {
        state: "unchanged",
        fact: "The Gate plan contains no project command.",
        maxWidth: width,
      }),
    ].join("\n\n");
  }
  let prerequisiteOccurrence = 0;
  const rendered = planRuns(plan.steps).map((run) => {
    if (run.group === undefined || run.group === "") {
      prerequisiteOccurrence += 1;
      return renderPlanPrerequisites(
        run,
        prerequisiteOccurrence,
        options,
      );
    }
    return renderPlanJobRun(run, options);
  });
  return [title, ...context, ...rendered].join("\n\n");
}

/** Map one Standard reading to a package result-summary state. */
function standardSummaryState(
  standard: GateStandard,
): ResultSummaryCliProps["state"] {
  if (
    standard.measurement === "deferred" || standard.measurement === "skipped"
  ) {
    return "blocked";
  }
  switch (standard.verdict) {
    case "improved":
      return "changed";
    case "held":
      return "passed";
    case "regressed":
      return "failed";
    case undefined:
      return "failed";
  }
}

/** Explain where one Standard value came from, or why it is absent. */
function standardEvidence(standard: GateStandard): string {
  switch (standard.measurement) {
    case "measured":
      return "The Standard command measured this value in the current Gate run.";
    case "replayed":
      return standard.replayed_from === undefined
        ? "A recorded value was replayed because the Standard inputs did not change."
        : `The value was replayed from ${standard.replayed_from} because the Standard inputs did not change.`;
    case "deferred":
      return 'Measurement is deferred by measure = "on-demand".';
    case "skipped":
      return "The Gate stopped before this Standard measurement ran.";
  }
}

/** Render every Standard reading without manufacturing a value for deferred work. */
export function renderGateStandards(
  standards: readonly GateStandard[],
  options: GatePresentationOptions,
): string {
  if (standards.length === 0) return "";
  const width = presentationWidth(options.width);
  const presenter = options.terminal.presenter;
  return standards.map((standard) => {
    const evidence = presenter.present(renderResultSummaryCli, {
      state: standardSummaryState(standard),
      fact: safeMultiline(standardEvidence(standard)),
      counts: [
        {
          label: "Measurement",
          value: safeLine(
            GATE_STANDARD_MEASUREMENT_LABEL[standard.measurement],
          ),
        },
        ...(standard.margin === undefined
          ? []
          : [{ label: "Margin", value: safeLine(String(standard.margin)) }]),
        ...(standard.pin_eligible === undefined ? [] : [{
          label: "Pin eligible",
          value: safeLine(standard.pin_eligible ? "yes" : "no"),
        }]),
        ...(standard.pin_target === undefined ? [] : [{
          label: "Pin target",
          value: safeLine(String(standard.pin_target)),
        }]),
      ],
      ...(standard.duration_s === undefined
        ? {}
        : { duration: safeLine(fmtDuration(standard.duration_s)) }),
      ...(standard.measurement === "deferred"
        ? { nextAction: "Run discern standards." }
        : {}),
      maxWidth: width,
    });
    if (standard.value === undefined) return evidence;
    const meter = presenter.present(renderStandardMeterCli, {
      label: safeLine(standard.name),
      value: standard.value,
      limit: standard.limit,
      direction: GATE_STANDARD_DIRECTION[standard.direction],
      ...(standard.verdict === undefined
        ? {}
        : { trend: GATE_STANDARD_TREND[standard.verdict] }),
      maxWidth: width,
    });
    return `${meter}\n${evidence}`;
  }).join("\n\n");
}

/** Derive the existing retry path from normalized diagnostic facts. */
function diagnosticCorrection(diagnostic: Diagnostic): string {
  return diagnostic.fix_available === true
    ? "Run discern prepare, then rerun the reproduction command."
    : "Fix the reported finding, then rerun the reproduction command.";
}

/** Render retry safety and order through the package RetryNotice. */
function renderDiagnosticRetry(
  diagnostic: Diagnostic,
  options: GatePresentationOptions,
): string {
  const width = presentationWidth(options.width);
  return options.terminal.presenter.present(renderRetryNoticeCli, {
    safeToRetry: true,
    reason: safeMultiline(diagnosticCorrection(diagnostic)),
    label: safeLine(`after running ${safeLine(diagnostic.reproduce_cmd)}`),
    maxWidth: width,
  });
}

/** Render a discern-owned captured excerpt, if the diagnostic carries one. */
function renderDiagnosticOutput(
  diagnostic: Diagnostic,
  options: GatePresentationOptions,
): string {
  if (diagnostic.output === undefined || diagnostic.output.trim() === "") {
    return "";
  }
  const width = presentationWidth(options.width);
  const artifact = diagnostic.truncated === true &&
      diagnostic.output_path !== undefined
    ? `\nFull output artifact: ${safeLine(diagnostic.output_path)}`
    : "";
  return options.terminal.presenter.present(renderRawOutputCli, {
    output: safeMultiline(`${diagnostic.output}${artifact}`),
    label: safeLine(
      diagnostic.truncated === true
        ? `${safeLine(diagnostic.tool)} captured output excerpt`
        : `${safeLine(diagnostic.tool)} captured output`,
    ),
    maxWidth: width,
  });
}

/** Render only Discern-authored captured-output excerpts for a quieted run. */
export function renderGateDiagnosticOutputs(
  diagnostics: readonly Diagnostic[],
  options: GatePresentationOptions,
): string {
  return diagnostics.map((diagnostic) =>
    renderDiagnosticOutput(diagnostic, options)
  ).filter((frame) => frame !== "").join("\n\n");
}

/** Render normalized findings and Discern-authored excerpts through Components. */
export function renderGateDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: GatePresentationOptions,
): string {
  if (diagnostics.length === 0) return "";
  const width = presentationWidth(options.width);
  const presenter = options.terminal.presenter;
  return diagnostics.map((diagnostic) => {
    const title = diagnostic.rule === undefined
      ? diagnostic.tool
      : `${diagnostic.tool}: ${diagnostic.rule}`;
    const finding = presenter.present(renderDiagnosticCli, {
      title: safeLine(title),
      impact: safeMultiline(diagnostic.message),
      correction: safeMultiline(diagnosticCorrection(diagnostic)),
      severity: GATE_DIAGNOSTIC_SEVERITY[diagnostic.severity],
      ...(diagnostic.file === undefined
        ? {}
        : { path: safeLine(diagnostic.file) }),
      ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
      ...(diagnostic.col === undefined ? {} : { column: diagnostic.col }),
      reproductionCommand: safeMultiline(diagnostic.reproduce_cmd),
      maxWidth: width,
    });
    const retry = renderDiagnosticRetry(diagnostic, options);
    const output = renderDiagnosticOutput(diagnostic, options);
    return output === ""
      ? `${finding}\n${retry}`
      : `${finding}\n${output}\n${retry}`;
  }).join("\n\n");
}

/** Render the tail-safe failure outcome from the same diagnostic collection. */
export function renderGateFailureSummary(
  verb: string,
  headline: string,
  diagnostics: readonly Diagnostic[],
  options: GatePresentationOptions,
  failedStage?: FailedStage,
): string {
  const width = presentationWidth(options.width);
  const firstCommand = diagnostics[0]?.reproduce_cmd;
  return options.terminal.presenter.present(renderResultSummaryCli, {
    state: "failed",
    fact: safeLine(
      firstCommand === undefined
        ? `discern ${verb} failed${
          failedStage === undefined
            ? ""
            : ` (${GATE_FAILED_STAGE_LABEL[failedStage]})`
        }: ${headline}`
        : `discern ${verb} failed · reproduce: ${firstCommand}`,
    ),
    maxWidth: width,
  });
}

/** Map any Gate job state to a package Result summary. */
function resultState(
  status: GateJobPresentationStatus,
): ResultSummaryCliProps["state"] {
  switch (status) {
    case "ok":
      return "passed";
    case "failed":
      return "failed";
    case "cancelled":
      return "blocked";
    case "running":
      return "changed";
    case "pending":
    case "skipped":
      return "unchanged";
  }
}

/** Render a concise Gate status through the package outcome Component. */
export function renderGateStatus(
  message: string,
  status: GateJobPresentationStatus,
  options: GatePresentationOptions,
): string {
  const width = presentationWidth(options.width);
  return options.terminal.presenter.present(renderResultSummaryCli, {
    state: resultState(status),
    fact: safeMultiline(message),
    maxWidth: width,
  });
}

/** Render a truthful Proof receipt and retain the exact copyable proof line. */
export function renderGateProofReceipt(
  proof: Proof,
  record: GateProofRecord | undefined,
  steps: readonly StepResult[],
  options: GatePresentationOptions,
  landingAuthority?: LandingAuthorityData,
): string {
  const width = presentationWidth(options.width);
  const state: ReceiptPresentationState = record === undefined
    ? GATE_PROOF_RECORD_PRESENTATION.unavailable
    : GATE_PROOF_RECORD_PRESENTATION[record.status];
  const stepSummary = STEP_OUTCOMES.map((outcome) => ({
    label: GATE_JOB_STATUS_LABEL[outcome],
    count: steps.filter((step) => step.outcome === outcome).length,
  })).filter(({ count }) => count > 0)
    .map(({ label, count }) => `${count} ${label}`)
    .join(", ");
  const proofSummary = record?.reason === undefined
    ? state.summary
    : `${state.summary} ${safeMultiline(record.reason)}`;
  const uncovered = landingAuthority?.uncovered?.length ?? 0;
  const landingSummary = landingAuthority === undefined
    ? ""
    : landingAuthority.kind === "authorized"
    ? ` Landing is authorized by ${
      landingAuthority.source ?? "a verified grant"
    }.`
    : ` Landing still needs conversation consent; ${uncovered} changed path${
      uncovered === 1 ? " is" : "s are"
    } uncovered.`;
  const receipt = options.terminal.presenter.present(renderReceiptCli, {
    title: "Gate proof",
    ...(state.stamp === undefined ? {} : { stamp: state.stamp }),
    meta: [
      { label: "Branch", value: safeLine(proof.branch) },
      { label: "Commit", value: safeLine(proof.head) },
      { label: "Compared with", value: safeLine(proof.trunk) },
      {
        label: "Change",
        value: safeLine(
          `${proof.files_total} files +${proof.insertions} -${proof.deletions}`,
        ),
      },
    ],
    checks: [
      {
        label: "Gate steps",
        state: "pass",
        value: safeLine(
          stepSummary === "" ? "no jobs configured" : stepSummary,
        ),
      },
      {
        label: "Proof record",
        state: state.checkState,
        stateLabel: safeLine(state.stateLabel),
      },
      ...(landingAuthority === undefined ? [] : [{
        label: "Landing authority",
        state: GATE_LANDING_AUTHORITY_PRESENTATION[landingAuthority.kind].state,
        stateLabel: safeLine(
          GATE_LANDING_AUTHORITY_PRESENTATION[landingAuthority.kind].stateLabel,
        ),
        value: safeLine(
          landingAuthority.kind === "authorized"
            ? landingAuthority.source ?? "verified grant"
            : `${uncovered} uncovered`,
        ),
      }]),
    ],
    summary: safeMultiline(`${proofSummary}${landingSummary}`),
    footer: "Full proof: discern status --verbose",
    maxWidth: width,
  });
  return `${receipt}\n\n${safeLine(proof.line)}`;
}

/** Render one inspected Proof currency state without re-running the Gate. */
export function renderGateProofCheckReceipt(
  check: GateProofCheckData,
  options: GatePresentationOptions,
): string {
  const width = presentationWidth(options.width);
  const state: ReceiptPresentationState =
    GATE_PROOF_CHECK_PRESENTATION[check.status];
  const summary = check.reason === undefined
    ? state.summary
    : `${state.summary} ${safeMultiline(check.reason)}`;
  const receipt = options.terminal.presenter.present(renderReceiptCli, {
    title: "Gate proof",
    ...(state.stamp === undefined ? {} : { stamp: state.stamp }),
    meta: [
      ...(check.recorded === undefined
        ? []
        : [{ label: "Recorded commit", value: safeLine(check.recorded) }]),
      ...(check.head === undefined
        ? []
        : [{ label: "Current commit", value: safeLine(check.head) }]),
      ...(check.path === undefined
        ? []
        : [{ label: "Proof record", value: safeLine(check.path) }]),
    ],
    checks: [{
      label: "Proof currency",
      state: state.checkState,
      stateLabel: safeLine(state.stateLabel),
    }],
    summary: safeMultiline(summary),
    footer: check.status === "honored"
      ? "The recorded Gate result is authoritative for this tree."
      : "Refresh proof: discern done",
    maxWidth: width,
  });
  return check.proof_line === undefined
    ? receipt
    : `${receipt}\n\n${safeLine(check.proof_line)}`;
}
