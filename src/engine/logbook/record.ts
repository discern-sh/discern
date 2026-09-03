/**
 * The logbook **recorder** — the layer between an interceptor (the CLI action
 * wrapper in `cli.ts`, the MCP `runTool` completion chokepoint) and the store,
 * holding the two promises the substrate makes:
 *
 *  - **Recording never interferes.** Every failure — no project, unreadable
 *    config, no git, a read-only disk — degrades to SILENCE: the verb's own
 *    result and exit code are untouched, always. The whole finish path is one
 *    try/catch around best-effort work.
 *  - **Overhead stays unmeasurable.** Context gathering (root, config, git
 *    state, change scale) starts when the verb starts and runs CONCURRENTLY
 *    with it; the tail await at completion is normally instant. Gathering at
 *    START is also what makes attribution survive `accept` — the branch and
 *    worktree still exist when the context is read, even though the verb
 *    removes them.
 *
 * What gets recorded, and when it doesn't:
 *  - The toggle is `[project].logbook` (default on). `false` stops all writes.
 *  - Outside a discern project, nothing records (there is no config to consent
 *    through and no `.git` to write under). An UNREADABLE config also records
 *    nothing — if the consent state can't be read, the conservative reading
 *    wins. A verb that exits before its wrapper (a hard crash, a kill signal)
 *    loses that run's event; accepted for v1.
 *  - Envelope-less verbs (`identity`, `scripts`, the config read surface, …)
 *    still record: the event simply carries no `steps`/`diagnostics`. Every
 *    verb records and readers filter — uniform beats curated, and a
 *    verb-sequence reader needs the full stream.
 *  - Envelope `data` is lifted by SHAPE, not by verb name: a payload carrying
 *    the gate's fields feeds `failed_stage`/`scopes`/`standards`, a start's
 *    feeds `from`/`target`, a fetched doc's feeds its canonical `target`, an
 *    update's feeds `update`, a pin's feeds `pin` events — so a renamed verb or
 *    a new surface keeps recording correctly. Everything lifted is names and
 *    numbers; message bodies never land.
 *
 * Epoch bookkeeping rides the same completion: when this branch's config
 * fingerprint moved since its last recorded event (see `epoch.ts` — a pin does
 * NOT move it), a `config-change` event naming the moved sections is appended
 * before the verb event, and the per-branch sidecar advances. A `standards
 * --pin` instead lands as `pin` events — the limit trajectory the epoch
 * machinery deliberately masks.
 */

import { z } from "@zod/zod";
import { bestEffort } from "../../shared/best_effort.ts";
import { AcceptLandingStateSchema } from "../../shared/accept_landing_state.ts";
import { findRoot } from "../../shared/env.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import { runGit } from "../../shared/subprocess.ts";
import { isKnownGitCount, parseGitCount } from "../../shared/git_count.ts";
import { treeDiffFingerprint } from "../../shared/tree_identity.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import { type Clock, SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import type { CrashSignature } from "../crash.ts";
import {
  type DiscernResult,
  stepResultSatisfiesCompletion,
} from "../../shared/result.ts";
import { LANDING_CONSENT_SOURCES } from "../../shared/consent.ts";
import { logbookVerbIsEffectful } from "../../shared/verbs.ts";
import type { OperationLockBoundary } from "../../shared/operation_effects.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import {
  type CheckpointObservations,
  takeCheckpointActivity,
} from "../../shared/result_capture.ts";
import { changedSections, type ConfigEpoch, configEpoch } from "./epoch.ts";
import { setActiveInvocationId } from "./invocation_context.ts";
import type {
  BeginEvent,
  ChangeScale,
  DiagnosticClass,
  DriverFacts,
  LogbookOutcome,
  LogbookSurface,
  PinEvent,
  StandardReading,
  StepTiming,
  UpdateShape,
  VerbEvent,
} from "./schema.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import {
  appendEvent,
  type EpochState,
  readEpochState,
  writeEpochState,
} from "./store.ts";
import { validationEvidence } from "./validation.ts";

/** Everything the recorder learned about the invocation's surroundings. */
interface RecordingContext {
  commonGitDir: string;
  branch: string | null;
  head: string | null;
  clean: boolean | null;
  /** Fingerprint of the uncommitted diff (dirty trees only). */
  tree: string | undefined;
  /** Working tree vs its merge-base with the trunk, in counts. */
  change: ChangeScale | undefined;
  epoch: ConfigEpoch;
}

/** What an interceptor reports at verb completion. */
export interface FinishReport {
  /** The invoked verb, display form ("done", "worktree drop"). */
  verb: string;
  surface: LogbookSurface;
  outcome: "ok" | "failed";
  /** Wall-clock duration of the whole invocation, in milliseconds. */
  durationMs: number;
  /** Slot-wait time when capped acquisition was in play. */
  waitedMs?: number | undefined;
  /** The invocation's result envelope, when one surfaced. */
  result?: DiscernResult | undefined;
  /** Stable ids of the hints delivered with the invocation. */
  hintIds?: string[] | undefined;
  /** Stable ids of the desk tips shown during the invocation. */
  tipIds?: string[] | undefined;
  /** True when the invocation was a preview (`--dry-run`). */
  dryRun?: boolean | undefined;
  /** Surface-specific driver signals (session, mode, identity hints). */
  driver?: DriverFacts | undefined;
  /** Flag NAMES the invocation passed (never values). */
  flags?: string[] | undefined;
  /** The requested object, when the surface knows it; a resolved payload wins. */
  target?: string | undefined;
  /** The crash signature, when the invocation died on an unexpected throw. */
  crash?: CrashSignature | undefined;
  /** Checkpoint observations the surface chokepoint drained for this
   * invocation ({@link CheckpointObservations}); the recorder falls back to
   * draining the accumulator itself for direct callers. */
  checkpoints?: CheckpointObservations | undefined;
}

/** What an interceptor knows when an invocation starts. */
export interface BeginReport {
  /** The invoked verb, display form ("done", "worktree drop"). */
  verb: string;
  surface: LogbookSurface;
  /** Surface-specific driver signals, gathered beside the recorder context. */
  driver: Promise<DriverFacts>;
  /** Flag names already known at invocation start. */
  flags?: readonly string[] | undefined;
  /** Whether this invocation is a read-only preview. */
  dryRun?: boolean | undefined;
  /** Whether a mixed command group received its effect-selecting operand. */
  hasOperands?: boolean | undefined;
  /** The operation registry's resolved exclusion boundary for this call. */
  lockBoundary?: OperationLockBoundary | undefined;
}

/** A live recording: created at verb start, finished exactly once at completion. */
export interface Recording {
  /** Compose and append this invocation's event. Never throws, never interferes. */
  finish(report: FinishReport): Promise<void>;
}

/** One trimmed line of git output, or null when the command failed. */
async function gitLine(cwd: string, args: string[]): Promise<string | null> {
  const run = await runGit(args, { cwd });
  if (!run.success) {
    return null;
  }
  const line = run.stdout.trim();
  return line === "" ? null : line;
}

/** Parse `git diff --shortstat`; omitted categories are zero, malformed output is unknown. */
function parseShortstat(
  s: string,
): { files: number; insertions: number; deletions: number } | undefined {
  const grab = (re: RegExp): number | undefined => {
    const first = re.exec(s)?.[1];
    if (first === undefined) {
      return 0;
    }
    const count = parseGitCount(first);
    return isKnownGitCount(count) ? count : undefined;
  };
  if (s.trim() !== "" && !/\d+ files? changed/u.test(s)) {
    return undefined;
  }
  const files = grab(/(\d+) files? changed/);
  const insertions = grab(/(\d+) insertions?\(/);
  const deletions = grab(/(\d+) deletions?\(/);
  if (
    files === undefined || insertions === undefined || deletions === undefined
  ) {
    return undefined;
  }
  return {
    files,
    insertions,
    deletions,
  };
}

/** The change's scale: working tree vs its merge-base with the trunk, plus the
 * commit count above it. Undefined when the merge-base is unresolvable (an
 * unborn trunk, a detached orphan) — recording stays honest, never guesses. */
async function gatherChangeScale(
  root: string,
  trunk: string,
): Promise<ChangeScale | undefined> {
  const mergeBase = await gitLine(root, ["merge-base", trunk, "HEAD"]);
  if (mergeBase === null) {
    return undefined;
  }
  const [diff, commits] = await Promise.all([
    runGit(["diff", "--shortstat", mergeBase], { cwd: root }),
    gitLine(root, ["rev-list", "--count", `${mergeBase}..HEAD`]),
  ]);
  if (!diff.success) {
    return undefined;
  }
  const commitCount = commits === null ? undefined : parseGitCount(commits);
  if (commitCount === undefined || !isKnownGitCount(commitCount)) {
    return undefined;
  }
  const shortstat = parseShortstat(diff.stdout);
  if (shortstat === undefined) {
    return undefined;
  }
  return {
    ...shortstat,
    commits: commitCount,
  };
}

/**
 * Gather the invocation context: project root, the toggle, git state, the
 * change's scale, and the config epoch. Resolves to undefined whenever
 * recording should not happen.
 */
async function gatherContext(
  cwd: string,
): Promise<RecordingContext | undefined> {
  const root = await findRoot(cwd);
  if (root === undefined) {
    return undefined;
  }
  let epoch: ConfigEpoch;
  let trunk: string;
  try {
    const config = await loadConfig(root);
    if (!config.project.logbook) {
      return undefined;
    }
    epoch = configEpoch(config);
    trunk = config.repository.trunk;
  } catch {
    // discern-best-effort: logbook-recording-config-fallback
    return undefined; // consent state unreadable — the conservative reading wins
  }
  const [commonGitDir, branch, head, status, change] = await Promise.all([
    resolveCommonGitDir(root),
    gitLine(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    gitLine(root, ["rev-parse", "--short", "HEAD"]),
    runGit(["status", "--porcelain", "-z"], { cwd: root }),
    gatherChangeScale(root, trunk),
  ]);
  if (commonGitDir === undefined) {
    return undefined; // not a git repository — nowhere local to write
  }
  const clean = status.success ? status.stdout.trim() === "" : null;
  const tree = clean === false ? await treeDiffFingerprint(root) : undefined;
  return { commonGitDir, branch, head, clean, tree, change, epoch };
}

/** The envelope's steps as recorded timings (labels, kinds, dispositions,
 * outcomes, durations, and the error-like line count only — a step's free-text
 * `note` stays out of the logbook). */
function stepTimings(result: DiscernResult): StepTiming[] | undefined {
  if (result.steps === undefined || result.steps.length === 0) {
    return undefined;
  }
  return result.steps.map((s) => ({
    label: s.step.label,
    kind: s.step.kind,
    outcome: s.outcome,
    disposition: s.step.disposition,
    ...(s.step.group !== undefined ? { group: s.step.group } : {}),
    ...(s.durationS !== undefined ? { duration_s: s.durationS } : {}),
    ...(s.errorLikeLines !== undefined && s.errorLikeLines > 0
      ? { error_like_lines: s.errorLikeLines }
      : {}),
  }));
}

/** The envelope's diagnostics reduced to CLASSES: tool, rule id, and file path
 * at most — never the message, the output, or the reproduce command. Identical
 * classes collapse into one entry with a `count`, so magnitude survives
 * without repeating lines. */
function diagnosticClasses(
  result: DiscernResult,
): DiagnosticClass[] | undefined {
  if (result.diagnostics === undefined || result.diagnostics.length === 0) {
    return undefined;
  }
  const byClass = new Map<string, DiagnosticClass>();
  for (const d of result.diagnostics) {
    const key = `${d.tool} ${d.rule ?? ""} ${d.file ?? ""}`;
    const existing = byClass.get(key);
    if (existing !== undefined) {
      existing.count = (existing.count ?? 1) + 1;
      continue;
    }
    byClass.set(key, {
      tool: d.tool,
      ...(d.rule !== undefined ? { rule: d.rule } : {}),
      ...(d.file !== undefined ? { file: d.file } : {}),
    });
  }
  return [...byClass.values()];
}

// ── envelope-data lifts (by shape, never by verb name) ───────────────────────

/** The gate fields worth lifting when a payload carries them. */
const liftedGateShape = z.looseObject({
  gate_ran: z.boolean().optional(),
  failed_stage: z.string().nullable().optional(),
  scopes_changed: z.array(z.string()).optional(),
});

/** A per-standard reading as the gate/standards envelopes carry it. */
const liftedStandardShape = z.looseObject({
  name: z.string(),
  direction: z.string().optional(),
  limit: z.number().optional(),
  margin: z.number().optional(),
  value: z.number().optional(),
  verdict: z.string().optional(),
  measurement: z.string().optional(),
  replayed_from: z.string().optional(),
  pin_eligible: z.boolean().optional(),
  pin_target: z.number().optional(),
});

/** A payload carrying standard readings (the gate's or the standards verb's). */
const liftedStandardsShape = z.looseObject({
  standards: z.array(liftedStandardShape),
});

/** A payload carrying applied pins (the standards verb's `--pin` result). */
const liftedPinsShape = z.looseObject({
  pinned: z.array(z.looseObject({
    name: z.string(),
    from: z.number(),
    to: z.number(),
    measured: z.number(),
  })),
});

/** A successful documentation page fetch, reduced to its canonical target. */
const liftedDocFetchShape = z.looseObject({
  doc: z.looseObject({
    target: z.string(),
  }),
});

/** A start's payload: the created branch and the ref it forked from. */
const liftedStartShape = z.looseObject({
  branch: z.string(),
  from: z.string(),
  path: z.string(),
});

/** An update's payload, reduced to its counts. */
const liftedUpdateShape = z.looseObject({
  behind: z.number(),
  files_total: z.number(),
  overlap_total: z.number(),
});

/** An acceptance's recorded consent evidence. */
const liftedConsentShape = z.looseObject({
  consent: z.looseObject({
    source: z.enum(LANDING_CONSENT_SOURCES),
    scopes: z.array(z.string()).optional(),
  }),
});

/** An acceptance's irreversible effect state. */
const liftedLandingShape = z.looseObject({
  landing: z.looseObject(AcceptLandingStateSchema.shape),
});

/** One applied pin, as lifted from the standards verb's payload. */
interface LiftedPin {
  name: string;
  from: number;
  to: number;
  measured: number;
}

/** Everything liftable from one envelope's `data`, already reduced to the
 * event vocabulary. */
interface LiftedData {
  gateRan?: boolean;
  failedStage?: string;
  scopes?: string[];
  standards?: StandardReading[];
  pins?: LiftedPin[];
  target?: string;
  from?: string;
  update?: UpdateShape;
  consent?: VerbEvent["consent"];
  landing?: VerbEvent["landing"];
}

/** Reduce an envelope's `data` to the liftable facts it carries, by shape. */
function liftData(data: unknown): LiftedData {
  if (typeof data !== "object" || data === null) {
    return {};
  }
  const lifted: LiftedData = {};
  const gate = liftedGateShape.safeParse(data);
  if (gate.success) {
    if (gate.data.gate_ran !== undefined) {
      lifted.gateRan = gate.data.gate_ran;
    }
    if (
      gate.data.failed_stage !== undefined && gate.data.failed_stage !== null
    ) {
      lifted.failedStage = gate.data.failed_stage;
    }
    if (
      gate.data.scopes_changed !== undefined &&
      gate.data.scopes_changed.length > 0
    ) {
      lifted.scopes = gate.data.scopes_changed;
    }
  }
  const standards = liftedStandardsShape.safeParse(data);
  if (standards.success && standards.data.standards.length > 0) {
    lifted.standards = standards.data.standards.map((s) => ({
      name: s.name,
      ...(s.direction !== undefined ? { direction: s.direction } : {}),
      ...(s.limit !== undefined ? { limit: s.limit } : {}),
      ...(s.margin !== undefined ? { margin: s.margin } : {}),
      ...(s.value !== undefined ? { value: s.value } : {}),
      ...(s.verdict !== undefined ? { verdict: s.verdict } : {}),
      ...(s.measurement !== undefined ? { measurement: s.measurement } : {}),
      ...(s.replayed_from !== undefined
        ? { replayed_from: s.replayed_from }
        : {}),
      ...(s.pin_eligible !== undefined ? { pin_eligible: s.pin_eligible } : {}),
      ...(s.pin_target !== undefined ? { pin_target: s.pin_target } : {}),
    }));
  }
  const pins = liftedPinsShape.safeParse(data);
  if (pins.success && pins.data.pinned.length > 0) {
    lifted.pins = pins.data.pinned.map((p) => ({
      name: p.name,
      from: p.from,
      to: p.to,
      measured: p.measured,
    }));
  }
  const docFetch = liftedDocFetchShape.safeParse(data);
  if (docFetch.success) {
    lifted.target = docFetch.data.doc.target;
  }
  const start = liftedStartShape.safeParse(data);
  if (start.success) {
    lifted.target = start.data.branch;
    lifted.from = start.data.from;
  }
  const update = liftedUpdateShape.safeParse(data);
  if (update.success) {
    lifted.update = {
      behind: update.data.behind,
      files: update.data.files_total,
      overlap: update.data.overlap_total,
    };
  }
  const consent = liftedConsentShape.safeParse(data);
  if (consent.success) {
    lifted.consent = {
      source: consent.data.consent.source,
      ...(consent.data.consent.scopes !== undefined
        ? { scopes: consent.data.consent.scopes }
        : {}),
    };
  }
  const landing = liftedLandingShape.safeParse(data);
  if (landing.success) {
    lifted.landing = { ...landing.data.landing };
  }
  return lifted;
}

/** Detect any recorded acceptance effect that makes a failed result partial. */
function landingChanged(
  landing: VerbEvent["landing"] | undefined,
): boolean {
  return landing !== undefined &&
    (landing.recovery_performed || landing.trunk_landed ||
      landing.worktree_removed || landing.branch_deleted);
}

/** The recorded outcome: irreversible effect evidence wins over an error slug
 * (`partial`), and a failed/cancelled required step proves work ran and failed.
 * Otherwise a slug means the verb declined to act (`refused`). A crash envelope
 * is also work that died, so it records as `failed`. */
function recordedOutcome(
  reported: "ok" | "failed",
  result: DiscernResult | undefined,
  landing: VerbEvent["landing"] | undefined,
): LogbookOutcome {
  if (reported === "ok") {
    return "ok";
  }
  if (landingChanged(landing)) {
    return "partial";
  }
  if (result?.steps?.some((step) => !stepResultSatisfiesCompletion(step))) {
    return "failed";
  }
  if (result?.error === "internal_error") {
    return "failed";
  }
  return result?.error !== undefined ? "refused" : "failed";
}

/**
 * Advance the per-branch epoch sidecar, appending a `config-change` event when
 * this branch's fingerprint moved since its last recorded event. First
 * observation of a branch records state silently (there is nothing to compare).
 * Two parallel verbs can race the sidecar; the worst case is one duplicate or
 * one missed `config-change` marker, and every event still carries its own
 * fingerprint — accepted for v1.
 */
async function advanceEpoch(
  ctx: RecordingContext,
  atIso: string,
): Promise<void> {
  const state: EpochState = (await readEpochState(ctx.commonGitDir)) ??
    { schema: ON_DISK_FORMATS.logbookEpoch.version, branches: {} };
  const key = ctx.branch ?? "";
  const previous = state.branches[key];
  if (previous?.fingerprint === ctx.epoch.fingerprint) {
    return;
  }
  if (previous !== undefined) {
    await appendEvent(ctx.commonGitDir, {
      schema: ON_DISK_FORMATS.logbookEvent.version,
      at: atIso,
      writer: DISCERN_VERSION,
      kind: "config-change",
      branch: ctx.branch,
      sections: changedSections(previous.sections, ctx.epoch.sections),
      epoch: ctx.epoch.fingerprint,
    });
  }
  state.branches[key] = {
    fingerprint: ctx.epoch.fingerprint,
    sections: ctx.epoch.sections,
  };
  await writeEpochState(ctx.commonGitDir, state);
}

/**
 * Begin recording an invocation rooted at `cwd`. Context gathering and the
 * effectful-verb begin append start immediately and run concurrently with the
 * verb; every failure inside either is absorbed. Call {@link Recording.finish}
 * once at verb completion.
 */
export function beginRecording(
  cwd: string,
  begin: BeginReport,
  clock: Clock = SYSTEM_CLOCK,
  entropy: SecureEntropy = SYSTEM_SECURE_ENTROPY,
): Recording {
  const invocation = entropy.uuid();
  setActiveInvocationId(invocation);
  // The checkpoint-observation accumulator is process-local: discard anything a
  // previous invocation in this process left behind (the MCP server serves many
  // calls) so this invocation's event carries only its own observations.
  takeCheckpointActivity();
  const startedAt = wallTimeIso(clock.wallNow());
  const context = gatherContext(cwd).catch(() => {
    // discern-best-effort: logbook-recording-context-fallback
    return undefined;
  });
  const beginAppend = logbookVerbIsEffectful(begin.verb, begin.flags)
    ? bestEffort(
      "logbook-begin-append",
      async (): Promise<void> => {
        const [ctx, driver] = await Promise.all([context, begin.driver]);
        if (ctx === undefined) {
          return;
        }
        const event: BeginEvent = {
          schema: ON_DISK_FORMATS.logbookEvent.version,
          at: startedAt,
          writer: DISCERN_VERSION,
          kind: "begin",
          invocation,
          verb: begin.verb,
          surface: begin.surface,
          driver,
          branch: ctx.branch,
          head: ctx.head,
          epoch: ctx.epoch.fingerprint,
          ...(begin.lockBoundary === undefined
            ? {}
            : { lock_boundary: begin.lockBoundary }),
          ...(begin.flags === undefined ? {} : { flags: [...begin.flags] }),
          ...(begin.dryRun === undefined ? {} : { dry_run: begin.dryRun }),
          ...(begin.hasOperands === undefined
            ? {}
            : { has_operands: begin.hasOperands }),
        };
        await appendEvent(ctx.commonGitDir, event);
      },
    )
    : Promise.resolve();
  return {
    async finish(report: FinishReport): Promise<void> {
      await bestEffort("logbook-finish-append", async () => {
        // The surface chokepoints drain the checkpoint-observation mailbox and
        // pass it here (the drain-parity guard holds them to it); the fallback
        // take serves direct recorder callers and clears any remainder, so an
        // observation can never attach to a later invocation's event.
        const checkpointActivity = report.checkpoints ??
          takeCheckpointActivity();
        // Preserve append order even when a very short verb finishes before its
        // concurrent context gather. A swallowed begin failure still lets the
        // completion append proceed.
        await beginAppend;
        const ctx = await context;
        if (ctx === undefined) {
          return;
        }
        const at = wallTimeIso(clock.wallNow());
        await advanceEpoch(ctx, at);
        const steps = report.result !== undefined
          ? stepTimings(report.result)
          : undefined;
        const diagnostics = report.result !== undefined
          ? diagnosticClasses(report.result)
          : undefined;
        const validation = validationEvidence(report.result);
        const lifted = liftData(report.result?.data);
        // A successful payload names the object actually served. Surface input
        // remains the fallback for human-only reads and refused lookups.
        const target = lifted.target ?? report.target;
        const event: VerbEvent = {
          schema: ON_DISK_FORMATS.logbookEvent.version,
          at,
          writer: DISCERN_VERSION,
          kind: "verb",
          invocation,
          verb: report.verb,
          surface: report.surface,
          ...(report.driver !== undefined ? { driver: report.driver } : {}),
          branch: ctx.branch,
          head: ctx.head,
          clean: ctx.clean,
          ...(ctx.tree !== undefined ? { tree: ctx.tree } : {}),
          outcome: recordedOutcome(
            report.outcome,
            report.result,
            lifted.landing,
          ),
          ...(report.result?.error !== undefined
            ? { error: report.result.error }
            : {}),
          ...(lifted.gateRan !== undefined ? { gate_ran: lifted.gateRan } : {}),
          ...(lifted.failedStage !== undefined
            ? { failed_stage: lifted.failedStage }
            : {}),
          ...(report.crash !== undefined ? { crash: report.crash } : {}),
          ...(report.dryRun === true ? { dry_run: true } : {}),
          ...(begin.lockBoundary === undefined
            ? {}
            : { lock_boundary: begin.lockBoundary }),
          ...(begin.hasOperands === undefined
            ? {}
            : { has_operands: begin.hasOperands }),
          duration_ms: Math.round(report.durationMs),
          ...(report.waitedMs !== undefined
            ? { waited_ms: Math.round(report.waitedMs) }
            : {}),
          ...(target !== undefined ? { target } : {}),
          ...(lifted.from !== undefined ? { from: lifted.from } : {}),
          ...(report.flags !== undefined && report.flags.length > 0
            ? { flags: report.flags }
            : {}),
          ...(ctx.change !== undefined ? { change: ctx.change } : {}),
          ...(lifted.scopes !== undefined ? { scopes: lifted.scopes } : {}),
          ...(steps !== undefined ? { steps } : {}),
          ...(validation !== undefined ? { validation } : {}),
          ...(diagnostics !== undefined ? { diagnostics } : {}),
          hint_ids: report.hintIds ?? [],
          ...(report.tipIds !== undefined && report.tipIds.length > 0
            ? { tip_ids: report.tipIds }
            : {}),
          ...(lifted.standards !== undefined
            ? { standards: lifted.standards }
            : {}),
          ...(lifted.update !== undefined ? { update: lifted.update } : {}),
          ...(lifted.consent !== undefined ? { consent: lifted.consent } : {}),
          ...(lifted.landing !== undefined ? { landing: lifted.landing } : {}),
          ...(checkpointActivity !== undefined
            ? { checkpoints: checkpointActivity }
            : {}),
          epoch: ctx.epoch.fingerprint,
        };
        await appendEvent(ctx.commonGitDir, event);
        for (const pin of lifted.pins ?? []) {
          const pinEvent: PinEvent = {
            schema: ON_DISK_FORMATS.logbookEvent.version,
            at,
            writer: DISCERN_VERSION,
            kind: "pin",
            branch: ctx.branch,
            standard: pin.name,
            from: pin.from,
            to: pin.to,
            measured: pin.measured,
          };
          await appendEvent(ctx.commonGitDir, pinEvent);
        }
      });
    },
  };
}
