/**
 * The logbook **recorder** — the layer between an interceptor (the CLI action
 * wrapper in `cli.ts`, the MCP `runVerb` chokepoint) and the store, holding the
 * two promises the substrate makes:
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
 *  - Envelope-less verbs (`identity`, `script`, the config read surface, …)
 *    still record: the event simply carries no `steps`/`diagnostics`. Every
 *    verb records and readers filter — uniform beats curated, and a
 *    verb-sequence reader needs the full stream.
 *  - Envelope `data` is lifted by SHAPE, not by verb name: a payload carrying
 *    the gate's fields feeds `failed_stage`/`scopes`/`standards`, a start's
 *    feeds `from`/`target`, an update's feeds `update`, a pin's feeds `pin`
 *    events — so a renamed verb or a new surface keeps recording correctly.
 *    Everything lifted is names and numbers; message bodies never land.
 *
 * Epoch bookkeeping rides the same completion: when this branch's config
 * fingerprint moved since its last recorded event (see `epoch.ts` — a pin does
 * NOT move it), a `config-change` event naming the moved sections is appended
 * before the verb event, and the per-branch sidecar advances. A `standards
 * --pin` instead lands as `pin` events — the limit trajectory the epoch
 * machinery deliberately masks.
 */

import { z } from "@zod/zod";
import { findRoot } from "../../shared/env.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import { runGit } from "../../shared/subprocess.ts";
import { cksumString } from "../../shared/crc.ts";
import { KIT_VERSION } from "../../lib/version.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import { changedSections, type ConfigEpoch, configEpoch } from "./epoch.ts";
import {
  type ChangeScale,
  type DiagnosticClass,
  type DriverFacts,
  LOGBOOK_SCHEMA_VERSION,
  type LogbookOutcome,
  type LogbookSurface,
  type PinEvent,
  type StandardReading,
  type StepTiming,
  type UpdateShape,
  type VerbEvent,
} from "./schema.ts";
import {
  appendEvent,
  type EpochState,
  readEpochState,
  writeEpochState,
} from "./store.ts";

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
  /** The invocation's result envelope, when one surfaced. */
  result?: DiscernResult | undefined;
  /** True when the invocation was a preview (`--dry-run`). */
  dryRun?: boolean | undefined;
  /** Surface-specific driver signals (session, json, tty, ci). */
  driver?: DriverFacts | undefined;
  /** Flag NAMES the invocation passed (never values). */
  flags?: string[] | undefined;
  /** The verb's object (a help topic, a map page), when the surface knows it. */
  target?: string | undefined;
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

/** Parse `git diff --shortstat` output into counts (absent pieces are 0). */
function parseShortstat(
  s: string,
): { files: number; insertions: number; deletions: number } {
  const grab = (re: RegExp): number => {
    const first = re.exec(s)?.[1];
    return first !== undefined ? Number.parseInt(first, 10) : 0;
  };
  return {
    files: grab(/(\d+) files? changed/),
    insertions: grab(/(\d+) insertions?\(/),
    deletions: grab(/(\d+) deletions?\(/),
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
  return {
    ...parseShortstat(diff.stdout),
    commits: commits !== null ? Number.parseInt(commits, 10) : 0,
  };
}

/** Fingerprint the uncommitted diff (tracked files only) so `head` + `tree`
 * names "the same exact tree" across runs — what a flake reader compares. */
async function gatherTreeFingerprint(
  root: string,
): Promise<string | undefined> {
  const diff = await runGit(["diff", "HEAD"], { cwd: root });
  if (!diff.success) {
    return undefined;
  }
  return cksumString(diff.stdout).toString(16);
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
  const tree = clean === false ? await gatherTreeFingerprint(root) : undefined;
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
  failed_stage: z.string().nullable().optional(),
  scopes_changed: z.array(z.string()).optional(),
});

/** A per-standard reading as the gate/standards envelopes carry it. */
const liftedStandardShape = z.looseObject({
  name: z.string(),
  direction: z.string().optional(),
  limit: z.number().optional(),
  value: z.number().optional(),
  verdict: z.string().optional(),
  measurement: z.string().optional(),
  replayed_from: z.string().optional(),
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
  failedStage?: string;
  scopes?: string[];
  standards?: StandardReading[];
  pins?: LiftedPin[];
  target?: string;
  from?: string;
  update?: UpdateShape;
}

/** Reduce an envelope's `data` to the liftable facts it carries, by shape. */
function liftData(data: unknown): LiftedData {
  if (typeof data !== "object" || data === null) {
    return {};
  }
  const lifted: LiftedData = {};
  const gate = liftedGateShape.safeParse(data);
  if (gate.success) {
    if (
      gate.data.failed_stage !== undefined && gate.data.failed_stage !== null
    ) {
      lifted.failedStage = gate.data.failed_stage;
    }
    if (gate.data.scopes_changed !== undefined) {
      lifted.scopes = gate.data.scopes_changed;
    }
  }
  const standards = liftedStandardsShape.safeParse(data);
  if (standards.success && standards.data.standards.length > 0) {
    lifted.standards = standards.data.standards.map((s) => ({
      name: s.name,
      ...(s.direction !== undefined ? { direction: s.direction } : {}),
      ...(s.limit !== undefined ? { limit: s.limit } : {}),
      ...(s.value !== undefined ? { value: s.value } : {}),
      ...(s.verdict !== undefined ? { verdict: s.verdict } : {}),
      ...(s.measurement !== undefined ? { measurement: s.measurement } : {}),
      ...(s.replayed_from !== undefined
        ? { replayed_from: s.replayed_from }
        : {}),
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
  return lifted;
}

/** The recorded outcome: a verb that declined to act (a machine-stable `error`
 * slug on the envelope) is `refused`, distinct from work that ran and failed. */
function recordedOutcome(
  reported: "ok" | "failed",
  result: DiscernResult | undefined,
): LogbookOutcome {
  if (reported === "ok") {
    return "ok";
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
    { schema: LOGBOOK_SCHEMA_VERSION, branches: {} };
  const key = ctx.branch ?? "";
  const previous = state.branches[key];
  if (previous?.fingerprint === ctx.epoch.fingerprint) {
    return;
  }
  if (previous !== undefined) {
    await appendEvent(ctx.commonGitDir, {
      schema: LOGBOOK_SCHEMA_VERSION,
      at: atIso,
      writer: KIT_VERSION,
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
 * Begin recording an invocation rooted at `cwd`. Context gathering starts
 * immediately and runs concurrently with the verb; every failure inside it is
 * absorbed. Call {@link Recording.finish} once at verb completion.
 */
export function beginRecording(cwd: string): Recording {
  const context = gatherContext(cwd).catch(() => undefined);
  return {
    async finish(report: FinishReport): Promise<void> {
      try {
        const ctx = await context;
        if (ctx === undefined) {
          return;
        }
        const at = new Date().toISOString();
        await advanceEpoch(ctx, at);
        const steps = report.result !== undefined
          ? stepTimings(report.result)
          : undefined;
        const diagnostics = report.result !== undefined
          ? diagnosticClasses(report.result)
          : undefined;
        const lifted = liftData(report.result?.data);
        const target = report.target ?? lifted.target;
        const event: VerbEvent = {
          schema: LOGBOOK_SCHEMA_VERSION,
          at,
          writer: KIT_VERSION,
          kind: "verb",
          verb: report.verb,
          surface: report.surface,
          ...(report.driver !== undefined ? { driver: report.driver } : {}),
          branch: ctx.branch,
          head: ctx.head,
          clean: ctx.clean,
          ...(ctx.tree !== undefined ? { tree: ctx.tree } : {}),
          outcome: recordedOutcome(report.outcome, report.result),
          ...(report.result?.error !== undefined
            ? { error: report.result.error }
            : {}),
          ...(lifted.failedStage !== undefined
            ? { failed_stage: lifted.failedStage }
            : {}),
          ...(report.dryRun === true ? { dry_run: true } : {}),
          duration_ms: Math.round(report.durationMs),
          ...(target !== undefined ? { target } : {}),
          ...(lifted.from !== undefined ? { from: lifted.from } : {}),
          ...(report.flags !== undefined && report.flags.length > 0
            ? { flags: report.flags }
            : {}),
          ...(ctx.change !== undefined ? { change: ctx.change } : {}),
          ...(lifted.scopes !== undefined ? { scopes: lifted.scopes } : {}),
          ...(steps !== undefined ? { steps } : {}),
          ...(diagnostics !== undefined ? { diagnostics } : {}),
          ...(lifted.standards !== undefined
            ? { standards: lifted.standards }
            : {}),
          ...(lifted.update !== undefined ? { update: lifted.update } : {}),
          epoch: ctx.epoch.fingerprint,
        };
        await appendEvent(ctx.commonGitDir, event);
        for (const pin of lifted.pins ?? []) {
          const pinEvent: PinEvent = {
            schema: LOGBOOK_SCHEMA_VERSION,
            at,
            writer: KIT_VERSION,
            kind: "pin",
            branch: ctx.branch,
            standard: pin.name,
            from: pin.from,
            to: pin.to,
            measured: pin.measured,
          };
          await appendEvent(ctx.commonGitDir, pinEvent);
        }
      } catch {
        // Recording never interferes: any failure here is silence, never the verb's.
      }
    },
  };
}
