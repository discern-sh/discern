/**
 * The gate side of `[standards]` — how "never lower your standards" is
 * structure rather than advice (ADR 0133). Two tiers, both inside `done`:
 *
 *  - **Tier 1 — the never-loosen verification** ({@link verifyTrunkLimits}):
 *    every configured limit, compared against the trunk's committed copy, as a
 *    fail-fast precondition on EVERY real gate run. Loosened or deleted →
 *    the gate fails; an unreadable trunk skips LOUDLY (never silently); a
 *    trunk config that was fetched but does not parse fails hard. Not
 *    configurable — an escape hatch here would defeat the guarantee.
 *  - **Tier 2 — measurement by default** ({@link resolveStandardActions} +
 *    {@link buildGateStandardJobs}): each standard's measurement runs as an
 *    ordinary job inside the gate's parallel check∥test group, under the same
 *    scheduler semantics (fail-fast, buffering, the per-job timeout). A
 *    standard whose declared `inputs` the change never touched REPLAYS its
 *    recorded baseline value instead of re-measuring (loudly, naming the
 *    source commit); one marked `measure = "on-demand"` is deferred to the
 *    standalone verb, its limit still Tier-1-verified.
 *
 * `prepare` stays measurement-free (the ADR 0003 split survives exactly where
 * its argument holds — the inner loop); the standalone `standards` verb always
 * measures, so pinning and CI stay full-fat.
 */

import type { Diagnostic } from "../../shared/result.ts";
import type {
  GateStandard,
  StandardsLimitsData,
} from "../../shared/result_schemas.ts";
import type { JobResult } from "../jobs/types.ts";
import { collectPaths } from "../scopes/scopes.ts";
import { pathMatchesPattern } from "../scopes/glob.ts";
import { loosenedLimitReason, type PlannedStandard } from "./standard_plan.ts";
import {
  compareValueToLimit,
  evaluateMeasuredOutput,
  fmtRate,
  readTrunkConfig,
  type StandardVerdict,
} from "./standards.ts";
import { measurementBaselines } from "./receipt.ts";
import { runGit } from "../../shared/subprocess.ts";
import type { PlannedJob } from "./plan.ts";
import type { JobEvaluators } from "./execute.ts";

/** The gate's job-label prefix for a standard's measurement job. `:` is outside
 * NAME_RE, so a standard can never collide with a capability or check label in
 * the results map (the same construction as the `scope:` prefix). */
export function standardJobLabel(name: string): string {
  return `standard:${name}`;
}

// ── Tier 1: the never-loosen verification ────────────────────────────────────

/** The gate's Tier-1 outcome: the wire summary ({@link StandardsLimitsData})
 * plus the per-standard diagnostics when a limit loosened / was deleted / the
 * trunk config failed to parse. `blocking` is true exactly when the gate must
 * fail (`loosened` or `parse_failed`). */
export interface TrunkLimitsVerification {
  summary: StandardsLimitsData;
  diagnostics: Diagnostic[];
  blocking: boolean;
}

/** The next step a Tier-1 loosening diagnostic tells its reader — an agent —
 * to take: relay, and know whose decision a loosening is. */
const LOOSENING_NEXT_STEP =
  "Relay this finding to your owner rather than working around it: lowering a " +
  "limit is an owner decision taken on the trunk — at their explicit " +
  "instruction, an agent working in the main checkout edits " +
  "[standards.<name>] in the trunk's discern.toml, in daylight, in trunk " +
  "history. On this branch, move the metric the right way instead.";

/**
 * Verify every configured `[standards]` limit against the trunk's committed
 * copy — Tier 1, run as a fail-fast precondition on every real gate run.
 * Compares the loaded (working-tree) limits to the trunk's raw config, and
 * checks the trunk's own `[standards]` table for entries DELETED on this
 * branch (deletion is the ultimate loosening). A standard new on the branch
 * passes vacuously, as does a trunk with no config at all. Reads git once —
 * milliseconds, not measurements.
 */
export async function verifyTrunkLimits(
  root: string,
  mainBranch: string,
  standards: PlannedStandard[],
): Promise<TrunkLimitsVerification> {
  const trunk = await readTrunkConfig(root, mainBranch);
  if (trunk.kind === "unreadable") {
    return {
      summary: {
        status: "unverified",
        trunk: mainBranch,
        reason: trunk.reason,
      },
      diagnostics: [],
      blocking: false,
    };
  }
  if (trunk.kind === "parse_failed") {
    return {
      summary: {
        status: "parse_failed",
        trunk: mainBranch,
        reason: trunk.reason,
      },
      diagnostics: [{
        tool: "standards",
        severity: "error",
        message:
          `the never-loosen check cannot verify [standards] limits: ${trunk.reason}. ` +
          `Fix the trunk's config (a broken trunk config is a real defect, not a skippable one).`,
        reproduce_cmd: `git show ${mainBranch}:./discern.toml`,
      }],
      blocking: true,
    };
  }
  if (trunk.kind === "absent") {
    // No config on the trunk: every standard is new on this branch — vacuous.
    return {
      summary: { status: "verified", trunk: mainBranch },
      diagnostics: [],
      blocking: false,
    };
  }

  const diagnostics: Diagnostic[] = [];
  const branchNames = new Set(standards.map((r) => r.name));

  // Loosened: each configured limit vs the trunk's recorded value.
  for (const r of standards) {
    const mainValue = trunk.config.getNumber(r.limitKey);
    const loosened = loosenedLimitReason(
      r.name,
      r.direction,
      r.limit,
      mainValue,
      mainBranch,
    );
    if (loosened !== undefined) {
      diagnostics.push({
        tool: standardJobLabel(r.name),
        severity: "error",
        message: `${loosened} ${LOOSENING_NEXT_STEP}`,
        reproduce_cmd: "discern standards --dry-run",
      });
    }
  }

  // Deleted: a trunk standard with no branch counterpart. The trunk's own
  // direction words the message (default "up", matching the schema default).
  for (const name of trunk.config.subsections("standards")) {
    if (branchNames.has(name)) {
      continue;
    }
    const limit = trunk.config.getNumber(`standards.${name}.limit`);
    if (limit === undefined) {
      continue; // a trunk table with no numeric limit holds nothing to loosen
    }
    const bound = trunk.config.get(`standards.${name}.direction`, "up") ===
        "down"
      ? "ceiling"
      : "floor";
    diagnostics.push({
      tool: standardJobLabel(name),
      severity: "error",
      message:
        `standard '${name}' was deleted on this branch (${mainBranch} holds its ${bound} at ${limit}) — ` +
        `deletion is the ultimate loosening. Restore the [standards.${name}] table. ${LOOSENING_NEXT_STEP}`,
      reproduce_cmd: `git show ${mainBranch}:./discern.toml`,
    });
  }

  if (diagnostics.length > 0) {
    return {
      summary: {
        status: "loosened",
        trunk: mainBranch,
        reason:
          `${diagnostics.length} limit(s) loosened or deleted versus ${mainBranch}`,
      },
      diagnostics,
      blocking: true,
    };
  }
  return {
    summary: { status: "verified", trunk: mainBranch },
    diagnostics: [],
    blocking: false,
  };
}

// ── Tier 2: resolution (measure / replay / defer) ────────────────────────────

/** What the gate decided to do about one standard's measurement. */
export type StandardAction =
  | { kind: "measure" }
  | { kind: "replay"; value: number; from: string }
  | { kind: "defer" };

/** One standard with its resolved gate action. */
export interface ResolvedStandard {
  standard: PlannedStandard;
  action: StandardAction;
}

/** Whether `sha` is an ancestor of (or equal to) HEAD at `root`. */
async function isAncestorOfHead(root: string, sha: string): Promise<boolean> {
  const r = await runGit(["merge-base", "--is-ancestor", sha, "HEAD"], {
    cwd: root,
  });
  return r.success;
}

/**
 * The config-only resolution — measure or defer, never replay — for the
 * callers that must stay I/O-free: the `--dry-run` plan and doctor's execution
 * model. A replay is decided at run time from the tree and the recorded
 * baseline, which a pure plan cannot honestly predict.
 */
export function resolveStandardActionsFromConfig(
  standards: PlannedStandard[],
): ResolvedStandard[] {
  return standards.map((standard) => ({
    standard,
    action: standard.gateMeasure
      ? { kind: "measure" as const }
      : { kind: "defer" as const },
  }));
}

/**
 * Resolve each standard's gate action from the tree: `defer` for
 * `measure = "on-demand"`; `replay` when the standard declares `inputs`, a
 * recorded baseline measurement exists on an ancestor commit, and EVERY path
 * changed between that commit and the tree under test — the committed diff
 * PLUS dirty working-tree paths, renames decomposed to delete + add — falls
 * outside the inputs; `measure` otherwise (the conservative default; omitted
 * `inputs` always measures). Read-only. Runs AFTER the fix stage, so a fixer's
 * edits count as changes.
 */
export async function resolveStandardActions(
  root: string,
  standards: PlannedStandard[],
): Promise<ResolvedStandard[]> {
  const replayable = standards.filter(
    (r) => r.gateMeasure && r.inputs !== undefined && r.inputs.length > 0,
  );
  const baselines = replayable.length > 0 ? await usableBaselines(root) : [];
  // The changed-path set since each baseline commit, computed once per sha —
  // the SAME reader the scope classifier uses (`--no-renames` decomposition,
  // NUL-separated decoding, the full dirty set), never a parallel parse.
  const changedSince = new Map<string, string[] | null>();
  const changedPaths = async (sha: string): Promise<string[] | null> => {
    let paths = changedSince.get(sha);
    if (paths === undefined) {
      paths = await collectPaths(root, sha);
      changedSince.set(sha, paths);
    }
    return paths;
  };

  const out: ResolvedStandard[] = [];
  for (const standard of standards) {
    if (!standard.gateMeasure) {
      out.push({ standard, action: { kind: "defer" } });
      continue;
    }
    const inputs = standard.inputs;
    if (inputs === undefined || inputs.length === 0) {
      out.push({ standard, action: { kind: "measure" } });
      continue;
    }
    let action: StandardAction = { kind: "measure" };
    for (const baseline of baselines) {
      const value = baseline.values[standard.name];
      if (value === undefined) {
        continue;
      }
      const paths = await changedPaths(baseline.head);
      if (paths === null) {
        continue; // git couldn't answer — fail open: measure
      }
      if (paths.some((path) => inputsMatch(inputs, path))) {
        continue; // an input changed since this baseline — measure
      }
      action = { kind: "replay", value, from: baseline.head };
      break;
    }
    out.push({ standard, action });
  }
  return out;
}

/** The recorded baselines usable from this tree: parsed measurement receipts
 * (own first, then the trunk checkout's) whose commit is an ancestor of HEAD. */
async function usableBaselines(
  root: string,
): Promise<{ head: string; values: Record<string, number> }[]> {
  const out: { head: string; values: Record<string, number> }[] = [];
  for (const baseline of await measurementBaselines(root)) {
    if (await isAncestorOfHead(root, baseline.head)) {
      out.push(baseline);
    }
  }
  return out;
}

/** Whether a changed path (normalized like the scope classifier normalizes)
 * matches any of a standard's input globs — the SAME matcher the scopes use. */
function inputsMatch(inputs: string[], rawPath: string): boolean {
  const path = rawPath.trim().replace(/^\//, "");
  if (path === "") {
    return false;
  }
  return inputs.some((glob) => pathMatchesPattern(path, glob));
}

// ── Tier 2: the gate jobs ────────────────────────────────────────────────────

/** A verdict's standing against the limit, for the envelope: strictly better
 * than the limit → `improved`, at it (within epsilon) → `held`. Only called
 * for a holding value. */
function heldVerdict(
  standard: PlannedStandard,
  value: number,
): "improved" | "held" {
  const better = standard.direction === "up"
    ? value - 1e-9 > standard.limit
    : value + 1e-9 < standard.limit;
  return better ? "improved" : "held";
}

/**
 * One resolved standard as a {@link PlannedJob} for the gate's check∥test
 * group: a measured standard runs (with its own `timeout` override when
 * declared); a replay or deferral is listed `willRun: false` with the note
 * that says why — the honest plan the serialization and the dry-run listing
 * both read. Pure, so the `--dry-run` plan and doctor's execution model share
 * the exact job shape the executor runs.
 */
export function plannedStandardJob(
  standard: PlannedStandard,
  action: StandardAction,
): PlannedJob {
  const label = standardJobLabel(standard.name);
  if (action.kind === "defer") {
    return {
      label,
      command: standard.command,
      kind: "standard",
      reportStage: "test",
      willRun: false,
      note:
        'measurement deferred (measure = "on-demand") — run `discern standards`',
    };
  }
  if (action.kind === "replay") {
    return {
      label,
      command: standard.command,
      kind: "standard",
      reportStage: "test",
      willRun: false,
      note: `${standard.direction}, limit ${standard.limit}, measured ${
        fmtRate(action.value)
      } — replayed from ${action.from.slice(0, 7)} (inputs unchanged)`,
    };
  }
  return {
    label,
    command: standard.command,
    kind: "standard",
    reportStage: "test",
    willRun: true,
    ...(standard.timeoutS !== undefined ? { timeoutS: standard.timeoutS } : {}),
  };
}

/** The pure, config-only standards job list — measure or defer, never replay —
 * for the I/O-free callers (the `--dry-run` plan, doctor's execution model). */
export function planStandardJobsFromConfig(
  standards: PlannedStandard[],
): PlannedJob[] {
  return resolveStandardActionsFromConfig(standards).map((
    { standard, action },
  ) => plannedStandardJob(standard, action));
}

/**
 * Everything the gate needs to run the resolved standards inside its parallel
 * group: the planned jobs (measured ones `willRun`, replays/deferrals listed
 * with their notes), the evaluators that judge each measured job's output, the
 * synthesized results for replayed standards (seeded into the results map — a
 * replayed value is still compared to the CURRENT limit, which the branch may
 * have tightened since the baseline), and the per-standard outcomes assembled
 * for the envelope as the jobs settle.
 */
export interface GateStandardJobs {
  jobs: PlannedJob[];
  evaluators: JobEvaluators;
  /** Pre-settled results for replayed standards, keyed by job label — seed
   * these into the gate's results map before the group runs. */
  synthesized: Map<string, JobResult>;
  /** The per-standard envelope outcomes; measured entries are completed by
   * their evaluators as the group settles ({@link finishGateStandards}). */
  outcomes: Map<string, GateStandard>;
}

/**
 * Project the resolved standards into gate jobs + evaluators. Pure except for
 * the evaluators' deferred work (each runs `evaluateMeasuredOutput` over its
 * job's captured output when the job settles, inside the parallel group).
 */
export function buildGateStandardJobs(
  root: string,
  resolved: ResolvedStandard[],
): GateStandardJobs {
  const jobs: PlannedJob[] = [];
  const evaluators: JobEvaluators = new Map();
  const synthesized = new Map<string, JobResult>();
  const outcomes = new Map<string, GateStandard>();

  for (const { standard, action } of resolved) {
    const label = standardJobLabel(standard.name);
    const base = {
      name: standard.name,
      direction: standard.direction,
      limit: standard.limit,
    };
    jobs.push(plannedStandardJob(standard, action));
    if (action.kind === "defer") {
      outcomes.set(standard.name, { ...base, measurement: "deferred" });
      continue;
    }
    if (action.kind === "replay") {
      // A replayed value is a real measurement of an identical input set — but
      // the LIMIT may have tightened on this branch since the baseline, so the
      // comparison still runs against the current limit.
      const verdict: StandardVerdict = compareValueToLimit(
        standard,
        action.value,
        fmtRate(action.value),
        "",
      );
      const shortSha = action.from.slice(0, 7);
      const result: JobResult = {
        label,
        status: verdict.held ? "ok" : "failed",
        code: verdict.held ? 0 : 1,
        durationS: 0,
        outputLines: 0,
        errorLikeLines: 0,
        ...(verdict.held ? {} : {
          failureMessage: `${
            verdict.reason ?? `standard '${standard.name}' failed.`
          } (value replayed from ${shortSha} — inputs unchanged; the limit tightened past it on this branch)`,
        }),
      };
      synthesized.set(label, result);
      outcomes.set(standard.name, {
        ...base,
        measurement: "replayed",
        value: action.value,
        replayed_from: action.from,
        ...(verdict.held
          ? { verdict: heldVerdict(standard, action.value) }
          : { verdict: "regressed" as const }),
      });
      continue;
    }
    // measure — a real job in the parallel group, judged by its evaluator.
    outcomes.set(standard.name, { ...base, measurement: "skipped" });
    evaluators.set(label, async (result: JobResult): Promise<JobResult> => {
      const verdict: StandardVerdict = standard.command === ""
        ? {
          held: false,
          reason:
            `standard '${standard.name}' has no run command (set run = "<command>" under [standards.${standard.name}]).`,
        }
        : await evaluateMeasuredOutput(
          standard,
          result.output ?? "",
          root,
        );
      outcomes.set(standard.name, {
        ...base,
        measurement: "measured",
        duration_s: result.durationS,
        ...(verdict.value !== undefined ? { value: verdict.value } : {}),
        ...(verdict.held && verdict.value !== undefined
          ? { verdict: heldVerdict(standard, verdict.value) }
          : {}),
        ...(!verdict.held && verdict.value !== undefined
          ? { verdict: "regressed" as const }
          : {}),
      });
      if (verdict.held) {
        // Drop the retained output — it was evidence for the evaluation, not
        // a diagnostic — and report the pass whatever the exit code was (the
        // metric line, not the exit code, decides a measurement).
        const { output: _output, ...rest } = result;
        return { ...rest, status: "ok", code: 0 };
      }
      return {
        ...result,
        status: "failed",
        code: result.code === 0 ? 1 : result.code,
        failureMessage: verdict.reason ?? `standard '${standard.name}' failed.`,
      };
    });
  }
  return { jobs, evaluators, synthesized, outcomes };
}

/**
 * The per-standard envelope entries, in configured order, with the measured
 * step notes to patch in (`measured <value>` beside the command). Called after
 * the check∥test group settles; a measured standard whose evaluator never ran
 * (fail-fast cancelled, the group never reached) stays `skipped`.
 */
export function gateStandardsData(
  resolved: ResolvedStandard[],
  standards: GateStandardJobs,
): GateStandard[] {
  return resolved.flatMap(({ standard }) => {
    const outcome = standards.outcomes.get(standard.name);
    return outcome === undefined ? [] : [outcome];
  });
}
