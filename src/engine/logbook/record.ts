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
 *    state) starts when the verb starts and runs CONCURRENTLY with it; the tail
 *    await at completion is normally instant. Gathering at START is also what
 *    makes attribution survive `accept` — the branch and worktree still exist
 *    when the context is read, even though the verb removes them.
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
 *
 * Epoch bookkeeping rides the same completion: when this branch's config
 * fingerprint moved since its last recorded event (see `epoch.ts` — a pin does
 * NOT move it), a `config-change` event naming the moved sections is appended
 * before the verb event, and the per-branch sidecar advances.
 */

import { findRoot } from "../../shared/env.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import { runGit } from "../../shared/subprocess.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import { changedSections, type ConfigEpoch, configEpoch } from "./epoch.ts";
import {
  type DiagnosticClass,
  LOGBOOK_SCHEMA_VERSION,
  type LogbookSurface,
  type StepTiming,
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

/**
 * Gather the invocation context: project root, the toggle, git state, and the
 * config epoch. Resolves to undefined whenever recording should not happen.
 */
async function gatherContext(
  cwd: string,
): Promise<RecordingContext | undefined> {
  const root = await findRoot(cwd);
  if (root === undefined) {
    return undefined;
  }
  let epoch: ConfigEpoch;
  try {
    const config = await loadConfig(root);
    if (!config.project.logbook) {
      return undefined;
    }
    epoch = configEpoch(config);
  } catch {
    return undefined; // consent state unreadable — the conservative reading wins
  }
  const [commonGitDir, branch, head, status] = await Promise.all([
    resolveCommonGitDir(root),
    gitLine(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    gitLine(root, ["rev-parse", "--short", "HEAD"]),
    runGit(["status", "--porcelain"], { cwd: root }),
  ]);
  if (commonGitDir === undefined) {
    return undefined; // not a git repository — nowhere local to write
  }
  return {
    commonGitDir,
    branch,
    head,
    clean: status.success ? status.stdout.trim() === "" : null,
    epoch,
  };
}

/** The envelope's steps as recorded timings (labels, kinds, outcomes, durations
 * only — a step's free-text `note` stays out of the logbook). */
function stepTimings(result: DiscernResult): StepTiming[] | undefined {
  if (result.steps === undefined || result.steps.length === 0) {
    return undefined;
  }
  return result.steps.map((s) => ({
    label: s.step.label,
    kind: s.step.kind,
    outcome: s.outcome,
    ...(s.durationS !== undefined ? { duration_s: s.durationS } : {}),
  }));
}

/** The envelope's diagnostics reduced to CLASSES: tool, rule id, and file path
 * at most — never the message, the output, or the reproduce command. */
function diagnosticClasses(
  result: DiscernResult,
): DiagnosticClass[] | undefined {
  if (result.diagnostics === undefined || result.diagnostics.length === 0) {
    return undefined;
  }
  return result.diagnostics.map((d) => ({
    tool: d.tool,
    ...(d.rule !== undefined ? { rule: d.rule } : {}),
    ...(d.file !== undefined ? { file: d.file } : {}),
  }));
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
        const event: VerbEvent = {
          schema: LOGBOOK_SCHEMA_VERSION,
          at,
          kind: "verb",
          verb: report.verb,
          surface: report.surface,
          branch: ctx.branch,
          head: ctx.head,
          clean: ctx.clean,
          outcome: report.outcome,
          ...(report.result?.error !== undefined
            ? { error: report.result.error }
            : {}),
          ...(report.dryRun === true ? { dry_run: true } : {}),
          duration_ms: Math.round(report.durationMs),
          ...(steps !== undefined ? { steps } : {}),
          ...(diagnostics !== undefined ? { diagnostics } : {}),
          epoch: ctx.epoch.fingerprint,
        };
        await appendEvent(ctx.commonGitDir, event);
      } catch {
        // Recording never interferes: any failure here is silence, never the verb's.
      }
    },
  };
}
