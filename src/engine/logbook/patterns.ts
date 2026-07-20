/**
 * `discern patterns` — the logbook's first reader, and the diagnostic ladder's
 * third question: `doctor` asks whether the install is valid, `improvement`
 * whether the setup follows best practice, `patterns` whether the practice is
 * actually healthy. It runs the detector registry (`detectors.ts`) over the
 * recorded event stream and reports findings ranked by evidence strength —
 * each an observation in plain counts, a scope, and a recommended next step.
 *
 * Like every verb it computes one {@link DiscernResult}; the human report, the
 * `--json`, and the MCP tool are three renderings of the same object.
 * {@link patternsResult} is the unrendered core the MCP server calls;
 * {@link runPatterns} is the CLI.
 *
 * Advisory only, structurally: the result is always `ok` once the logbook is
 * readable — findings are advice, never failures — and nothing in the gate
 * imports this module. The one destructive member of the family, the reset,
 * deletes the accumulated history ({@link patternsResetResult}); it is
 * CLI-only and plan/apply like every effectful verb (`--dry-run` previews).
 */

import { agentLabel } from "../../shared/agent_catalogue.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type {
  PatternsData,
  PatternsFinding,
  PatternsPopulation,
  PatternsResetData,
} from "../../shared/patterns_vocabulary.ts";
import { emitResult } from "../../shared/emit.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import { readLogbookStream } from "./read.ts";
import { listLogbookFiles, logbookDir, removeLogbook } from "./store.ts";
import {
  buildStreamFacts,
  type DetectorReport,
  driverAgent,
  driverKind,
  runDetectors,
  type StreamFacts,
} from "./detectors.ts";

/**
 * Score the analysis population's drivers — reader logic over the recorded
 * evidence, computed fresh on every read so improved scoring retroactively
 * covers all accumulated history. The report states this split so the
 * segmentation the detectors rely on is never a silent filter.
 */
function scorePopulation(facts: StreamFacts): PatternsPopulation {
  const kinds = { agent: 0, human: 0, unknown: 0 };
  const identityRuns = new Map<string, number>();
  for (const e of facts.verbs) {
    kinds[driverKind(e)] += 1;
    const identity = driverAgent(e);
    if (identity !== undefined) {
      identityRuns.set(identity, (identityRuns.get(identity) ?? 0) + 1);
    }
  }
  return {
    analyzed: facts.verbs.length,
    ...kinds,
    identities: [...identityRuns.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([agent, runs]) => ({ agent, label: agentLabel(agent), runs })),
  };
}

/** The refusal when the working root is not inside a git repository — with no
 * git admin area there is nowhere a logbook could live. */
function noRepository(verb: string): DiscernResult<never> {
  return {
    ok: false,
    verb,
    error: "no_repository",
    message:
      "this directory isn't inside a git repository, so it has no logbook to read. " +
      "Run discern from the project's checkout.",
  };
}

/** Reduce the gated detector reports to the verb's ranked findings list. */
function rankedFindings(reports: DetectorReport[]): PatternsFinding[] {
  const findings = reports.flatMap((r) =>
    r.findings.map((f): PatternsFinding => ({
      detector: r.detector.id,
      family: r.detector.family,
      scope: r.detector.scope,
      ...(f.subject !== undefined ? { subject: f.subject } : {}),
      observed: f.observed,
      evidence: f.evidence,
      strength: f.strength,
      next_step: f.next_step ?? r.detector.next_step,
    }))
  );
  return findings.sort((a, b) =>
    b.strength - a.strength || a.detector.localeCompare(b.detector)
  );
}

/**
 * Compute the `patterns` {@link DiscernResult} without printing or exiting —
 * the core the MCP server renders. Reads the whole logbook tolerantly (torn
 * and foreign lines are skipped and counted), runs every registry detector
 * with its evidence threshold applied, and reports the ranked findings plus
 * every detector's status. An empty or absent logbook is a first-class state
 * with a helpful hint, not an error.
 */
export async function patternsResult(
  root: string,
): Promise<DiscernResult<PatternsData>> {
  const config = await loadConfig(root);
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return noRepository("patterns");
  }
  const stream = await readLogbookStream(commonGitDir);
  const facts = buildStreamFacts(stream.events, config.repository.trunk);
  const reports = runDetectors(facts);
  const findings = rankedFindings(reports);
  const first = stream.events[0];
  const last = stream.events[stream.events.length - 1];
  const branches = new Set(
    facts.verbs.map((e) => e.branch).filter((b): b is string => b !== null),
  );
  const data: PatternsData = {
    logbook: {
      events: stream.events.length,
      unparsed: stream.unparsed,
      months: stream.months.length,
      ...(first !== undefined ? { first_at: first.at } : {}),
      ...(last !== undefined ? { last_at: last.at } : {}),
      branches: branches.size,
      recording: config.project.logbook,
    },
    population: scorePopulation(facts),
    findings,
    detectors: reports.map((r) => ({
      id: r.detector.id,
      title: r.detector.title,
      family: r.detector.family,
      scope: r.detector.scope,
      tier: r.detector.tier,
      status: r.status,
      considered: r.considered,
      threshold: r.detector.threshold,
      findings: r.findings.length,
    })),
  };

  const hints: string[] = [];
  if (stream.events.length === 0) {
    hints.push(
      "The logbook is empty. discern records one event per verb run, locally " +
        "under the repository's git directory — check back after some use.",
    );
  } else {
    const young = reports.filter((r) => r.status === "insufficient-evidence");
    if (young.length > 0) {
      hints.push(
        `The logbook is too young for ${young.length} of ${reports.length} ` +
          `detectors — each reports insufficient evidence rather than guessing.`,
      );
    }
    if (findings.length > 0) {
      hints.push(
        "Advisory only: nothing here blocks or gates. Standards are the " +
          "enforcement surface; a finding's next step says how to get there.",
      );
    }
  }
  if (!config.project.logbook) {
    hints.push(
      "Recording is off ([project].logbook = false), so new runs aren't " +
        "recorded; this report reads the history that already exists.",
    );
  }

  return {
    ok: true,
    verb: "patterns",
    data,
    ...(hints.length > 0 ? { hints } : {}),
  };
}

// ── human rendering ─────────────────────────────────────────────────────────

/** "312 events · 3 months · 8 branches · 2026-06-02 → 2026-07-20" */
function summaryLine(data: PatternsData): string {
  const log = data.logbook;
  const parts = [
    `${log.events} event${log.events === 1 ? "" : "s"}`,
    `${log.months} month${log.months === 1 ? "" : "s"}`,
    `${log.branches} branch${log.branches === 1 ? "" : "es"}`,
  ];
  if (log.first_at !== undefined && log.last_at !== undefined) {
    parts.push(`${log.first_at.slice(0, 10)} → ${log.last_at.slice(0, 10)}`);
  }
  if (log.unparsed > 0) {
    parts.push(
      `${log.unparsed} unparsable line${log.unparsed === 1 ? "" : "s"} skipped`,
    );
  }
  return parts.join(" · ");
}

/** "drivers: 231 agent · 60 interactive · 21 unknown — Claude Code 190, …" */
function driversLine(population: PatternsPopulation): string {
  const parts = [
    `${population.agent} agent`,
    `${population.human} interactive`,
    `${population.unknown} unknown`,
  ];
  const identities = population.identities
    .map((i) => `${i.label} ${i.runs}`)
    .join(", ");
  return `drivers: ${parts.join(" · ")}${
    identities !== "" ? ` — ${identities}` : ""
  }`;
}

/** Render the report for a person: the ranked findings, then the registry's
 * own accounting (quiet and too-young detector counts), then the boundary. */
function renderReport(out: Out, data: PatternsData, slug: string): void {
  const c = out.c;
  out.heading(`discern patterns${slug ? ` · ${slug}` : ""}`);
  out.raw(`  ${c.dim}${summaryLine(data)}${c.reset}\n`);
  if (data.population.analyzed > 0) {
    out.raw(`  ${c.dim}${driversLine(data.population)}${c.reset}\n`);
  }
  out.raw("\n");

  if (data.logbook.events === 0) {
    out.raw(
      "  The logbook is empty. discern records one event per verb run,\n" +
        "  locally under the repository's git directory — nothing leaves\n" +
        "  the machine. Check back after some use.\n",
    );
    return;
  }

  for (const f of data.findings) {
    const subject = f.subject !== undefined ? ` · ${f.subject}` : "";
    out.raw(
      `  ${c.bold}${f.detector}${c.reset}${c.dim}${subject} · ${f.family}, ${f.scope} scope${c.reset}\n`,
    );
    out.raw(`    ${f.observed}\n`);
    out.raw(`    ${c.cyan}next${c.reset}  ${f.next_step}\n\n`);
  }

  const quiet = data.detectors.filter((d) => d.status === "quiet").length;
  const young =
    data.detectors.filter((d) => d.status === "insufficient-evidence").length;
  if (data.findings.length === 0) {
    out.raw("  No patterns to report.\n");
  }
  const accounting: string[] = [];
  if (quiet > 0) {
    accounting.push(
      `${quiet} detector${
        quiet === 1 ? "" : "s"
      } saw enough evidence and found nothing`,
    );
  }
  if (young > 0) {
    accounting.push(
      `the logbook is too young for ${young} of ${data.detectors.length}`,
    );
  }
  if (accounting.length > 0) {
    out.raw(`  ${c.dim}${accounting.join("; ")}.${c.reset}\n`);
  }
  out.raw(
    `  ${c.dim}Advisory only: nothing here blocks. Standards are the enforcement surface.${c.reset}\n`,
  );
}

/** Options accepted by the patterns CLI. */
export interface RunPatternsOptions {
  json: boolean;
}

/** Run `discern patterns`. Returns a process exit code — 0 whenever the
 * logbook was readable: findings are advice, never failures. */
export async function runPatterns(
  root: string,
  opts: RunPatternsOptions,
): Promise<number> {
  const result = await patternsResult(root);
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const out = makeOut(colorEnabled());
  if (!result.ok || result.data === undefined) {
    out.error(result.message ?? "patterns failed.");
    return 1;
  }
  const config = await loadConfig(root);
  renderReport(out, result.data, config.project.slug);
  return 0;
}

// ── the reset action ────────────────────────────────────────────────────────

/**
 * Compute (and unless `dryRun`, apply) the `patterns reset` result: delete the
 * whole logbook directory — every month file and the epoch sidecar — and
 * report exactly what was (or would be) removed. Plan/apply like every
 * effectful verb: the plan is the file list, computed read-only; the executor
 * is one directory removal in the store.
 */
export async function patternsResetResult(
  root: string,
  opts: { dryRun?: boolean } = {},
): Promise<DiscernResult<PatternsResetData>> {
  const commonGitDir = await resolveCommonGitDir(root);
  if (commonGitDir === undefined) {
    return noRepository("patterns reset");
  }
  const dryRun = opts.dryRun ?? false;
  const removed = await listLogbookFiles(commonGitDir);
  const data: PatternsResetData = {
    dir: logbookDir(commonGitDir),
    removed,
    bytes: removed.reduce((sum, f) => sum + f.bytes, 0),
  };
  if (removed.length === 0) {
    return {
      ok: true,
      verb: "patterns reset",
      ...(dryRun ? { dry_run: true } : {}),
      data,
      hints: ["No logbook to remove — nothing has been recorded."],
    };
  }
  if (dryRun) {
    return {
      ok: true,
      verb: "patterns reset",
      dry_run: true,
      data,
      hints: [
        "A preview — nothing was removed. Run without --dry-run to delete.",
      ],
    };
  }
  await removeLogbook(commonGitDir);
  const hints: string[] = [];
  const recording = await loadConfig(root)
    .then((c) => c.project.logbook)
    .catch(() => undefined);
  if (recording === true) {
    hints.push(
      "The history is gone; recording starts again on the next verb run. " +
        "Set [project].logbook = false to stop recording entirely.",
    );
  }
  return {
    ok: true,
    verb: "patterns reset",
    data,
    ...(hints.length > 0 ? { hints } : {}),
  };
}

/** Options accepted by the patterns-reset CLI. */
export interface RunPatternsResetOptions {
  json: boolean;
  dryRun: boolean;
}

/** Run `discern patterns reset`. Returns a process exit code. */
export async function runPatternsReset(
  root: string,
  opts: RunPatternsResetOptions,
): Promise<number> {
  const result = await patternsResetResult(root, { dryRun: opts.dryRun });
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const out = makeOut(colorEnabled());
  if (!result.ok || result.data === undefined) {
    out.error(result.message ?? "patterns reset failed.");
    return 1;
  }
  const c = out.c;
  const data = result.data;
  if (data.removed.length === 0) {
    out.raw("No logbook to remove — nothing has been recorded.\n");
    return 0;
  }
  const verb = result.dry_run === true ? "Would remove" : "Removed";
  out.raw(`${verb} the logbook at ${c.dim}${data.dir}${c.reset}:\n`);
  for (const f of data.removed) {
    out.raw(`  ${f.file} ${c.dim}(${f.bytes} bytes)${c.reset}\n`);
  }
  out.raw(
    `${data.removed.length} file${
      data.removed.length === 1 ? "" : "s"
    }, ${data.bytes} bytes${
      result.dry_run === true ? " — nothing removed" : ""
    }.\n`,
  );
  for (const hint of result.hints ?? []) {
    out.raw(`${c.dim}${hint}${c.reset}\n`);
  }
  return 0;
}
