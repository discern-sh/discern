/**
 * `finish` — the full quality gate. The TS port of the shell `finish` recipe.
 *
 * Runs fix → build → check∥test → scope-gates → merge-check, each capability and
 * check as its own tracked job (fix serial, the rest parallel within their
 * stage). `--json` emits a single machine-readable object on stdout (human
 * progress to stderr) whose shape is a published contract (ADR 0004) reproduced
 * here byte-for-shape:
 *
 *   { ok, jobs:[{name,kind,stage,status,duration_s}], scope_gates:[{scope,status,
 *     duration_s}], scopes_changed:[…], failed_stage }
 *
 * A no-op gate (nothing wired) → `jobs:[]`, `failed_stage:null`, `ok:true`. A job
 * whose stage aborted before it ran → `status:"skipped"`.
 */

import { Config } from "../../shared/config_read.ts";
import { type Stage, STAGES } from "../../shared/capabilities.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import { type RunOptions, runParallel, runSerial } from "../jobs/runner.ts";
import { cmdsInStage, jobsInStage } from "./stages.ts";
import { gotchasHint } from "./gotchas.ts";
import { changedScopes } from "../scopes/changed.ts";
import { byteWriter, colorEnabled, makeOut, type Out } from "../output.ts";
import { assertMainMerged } from "../worktree/git.ts";

/** A per-job entry in the `--json` report. */
interface JobReport {
  name: string;
  kind: "capability" | "check";
  stage: Stage;
  status: "ok" | "failed" | "skipped";
  duration_s: number;
}

/** A per-scope-gate entry in the `--json` report. */
interface ScopeGateReport {
  scope: string;
  status: "ok" | "failed" | "skipped";
  duration_s: number;
}

/** The full `finish --json` report object. */
interface GateReport {
  ok: boolean;
  jobs: JobReport[];
  scope_gates: ScopeGateReport[];
  scopes_changed: string[];
  failed_stage: string | null;
}

/** Build the `--json` report from the accumulated per-job results. */
function buildReport(
  cfg: Config,
  results: Map<string, JobResult>,
  changed: string[],
  failedStage: string | null,
): GateReport {
  const jobs: JobReport[] = [];
  for (const stage of STAGES) {
    for (const j of jobsInStage(cfg, stage)) {
      const r = results.get(j.label);
      jobs.push({
        name: j.label,
        kind: j.kind,
        stage,
        status: r === undefined ? "skipped" : (r.code === 0 ? "ok" : "failed"),
        duration_s: r === undefined ? 0 : r.durationS,
      });
    }
  }
  const scope_gates: ScopeGateReport[] = [];
  for (const scope of cfg.subsections("scopes")) {
    if (cfg.get(`scopes.${scope}.gate`, "") === "") {
      continue;
    }
    const r = results.get(`scope:${scope}`);
    scope_gates.push({
      scope,
      status: r === undefined ? "skipped" : (r.code === 0 ? "ok" : "failed"),
      duration_s: r === undefined ? 0 : r.durationS,
    });
  }
  return {
    ok: failedStage === null,
    jobs,
    scope_gates,
    scopes_changed: changed,
    failed_stage: failedStage,
  };
}

/** The human die message for each failed stage (matches the shell fail_phase). */
function failMessage(stage: string): string {
  switch (stage) {
    case "fix":
      return "The fix stage failed.";
    case "build":
      return "The build stage failed.";
    case "check/test":
      return "The check/test stage failed.";
    case "scope_gates":
      return "One or more scope gates failed.";
    case "merge":
      return "Integrate main, then re-run finish.";
    default:
      return "A gate stage failed.";
  }
}

/** Run the gate once, accumulating per-job results and building the report. */
async function runGate(
  root: string,
  json: boolean,
): Promise<
  {
    report: GateReport;
    failedStage: string | null;
    cfg: Config;
    out: Out;
    changed: string[];
  }
> {
  const cfg = await Config.load(root);
  // Non-json: human output → stdout (matching the shell). --json: human → stderr,
  // leaving stdout for the single JSON object.
  const infoStream = json ? "stderr" : "stdout";
  const color = colorEnabled();
  const runOpts: RunOptions = {
    stream: cfg.bool("gate.stream"),
    // fail_fast defaults ON: abort the moment a job fails.
    failFast: cfg.get("gate.fail_fast", "true") !== "false",
    color,
    write: byteWriter(infoStream),
  };
  const out = makeOut(color, infoStream);

  const results = new Map<string, JobResult>();
  const record = (rs: JobResult[]): void => {
    for (const r of rs) {
      results.set(r.label, r);
    }
  };
  const toJobs = (stage: Stage): Job[] =>
    jobsInStage(cfg, stage).map((j) => ({
      label: j.label,
      command: j.command,
    }));

  let failedStage: string | null = null;

  // fix (serial, mutating)
  const fixJobs = toJobs("fix");
  if (fixJobs.length > 0) {
    out.heading("Applying fixers...");
    const r = await runSerial(fixJobs, runOpts);
    record(r.results);
    if (!r.ok) {
      failedStage = "fix";
    }
  }
  // build (parallel)
  if (failedStage === null) {
    const buildJobs = toJobs("build");
    if (buildJobs.length > 0) {
      out.heading("Building artifacts...");
      const r = await runParallel(buildJobs, runOpts);
      record(r.results);
      if (!r.ok) {
        failedStage = "build";
      }
    }
  }
  // check + test together (parallel)
  if (failedStage === null) {
    const ctJobs = [...toJobs("check"), ...toJobs("test")];
    if (ctJobs.length > 0) {
      out.heading("Checking and testing...");
      const r = await runParallel(ctJobs, runOpts);
      record(r.results);
      if (!r.ok) {
        failedStage = "check/test";
      }
    }
  }
  // scope gates (only for scopes the branch changed)
  const changed = await changedScopes(root, cfg);
  if (failedStage === null) {
    const gateJobs: Job[] = [];
    for (const scope of cfg.subsections("scopes")) {
      const gateCmd = cfg.get(`scopes.${scope}.gate`, "");
      if (gateCmd === "" || !changed.includes(scope)) {
        continue;
      }
      gateJobs.push({ label: `scope:${scope}`, command: gateCmd });
    }
    if (gateJobs.length > 0) {
      out.heading("Running gates for changed scopes...");
      const r = await runParallel(gateJobs, runOpts);
      record(r.results);
      if (!r.ok) {
        failedStage = "scope_gates";
      }
    }
  }
  // merge check (no-op in the main checkout / outside a worktree)
  if (failedStage === null) {
    const mainBranch = Deno.env.get("MAIN_BRANCH") ||
      cfg.get("project.main_branch", "main");
    if ((await assertMainMerged(root, mainBranch)).kind === "behind") {
      failedStage = "merge";
    }
  }

  return {
    report: buildReport(cfg, results, changed, failedStage),
    failedStage,
    cfg,
    out,
    changed,
  };
}

/** Print the informational success tail (non-`--json`). */
function printSuccessTail(cfg: Config, out: Out, changed: string[]): void {
  let unfilled = 0;
  for (const stage of STAGES) {
    if (cmdsInStage(cfg, stage) === ":") {
      unfilled++;
    }
  }
  if (unfilled === 4) {
    out.ok(
      "Gate passed — but no capability or check is wired, so nothing was actually checked (a no-op gate).",
    );
    out.warn(
      "Add [capabilities] (format/lint/typecheck/test/build) to discern.toml — or run `discern bootstrap`.",
    );
  } else {
    out.ok("Everything built and all checks passed.");
    if (unfilled > 0) {
      out.info(
        `${out.c.dim}note: ${unfilled} of 4 gate stages have no command yet.${out.c.reset}`,
      );
    }
    out.info(
      "If you changed something meaningful, update the docs to match before you finish.",
    );
  }
  if (cfg.subsections("ratchets").length > 0) {
    out.info(
      `Before pushing, hold the ratchets: ${out.c.bold}discern ratchets${out.c.reset} (slow, so not part of finish).`,
    );
  }
  if (
    cfg.get("worktree.resources.dev_server.create", "") !== "" &&
    changed.includes("previewable")
  ) {
    out.info(
      "A previewable change landed — start this worktree's dev server to view it.",
    );
  }
}

/** Run `finish`. Returns a process exit code. */
export async function runFinish(
  root: string,
  opts: { json: boolean },
): Promise<number> {
  const { report, failedStage, cfg, out, changed } = await runGate(
    root,
    opts.json,
  );
  if (opts.json) {
    console.log(JSON.stringify(report));
    return failedStage === null ? 0 : 1;
  }
  if (failedStage !== null) {
    out.error(failMessage(failedStage));
    gotchasHint(cfg, root, out.color);
    return 1;
  }
  printSuccessTail(cfg, out, changed);
  return 0;
}
