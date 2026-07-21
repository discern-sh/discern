/**
 * Unit coverage for the gate's job-group executor (`src/engine/gate/execute.ts`)
 * — specifically its label-uniqueness tripwire. The executor records every job
 * result into ONE label-keyed map shared across a run's groups, and the report
 * looks each planned job up by that label; a duplicate label would silently
 * overwrite one job's outcome with its sibling's (destroying the genuine
 * failure's diagnostics). Config validation makes a user-authored collision
 * impossible, so the executor refuses one loudly — an engine bug, not a config
 * problem — BEFORE any job spawns.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { runGroup } from "../src/engine/gate/execute.ts";
import type { JobGroup, PlannedJob } from "../src/engine/gate/plan.ts";
import type { JobResult } from "../src/engine/jobs/types.ts";
import type { RunOptions } from "../src/engine/jobs/runner.ts";
import { makeOut } from "../src/engine/output.ts";

const RUN_OPTS: RunOptions = {
  cwd: Deno.cwd(),
  stream: false,
  failFast: true,
  color: false,
  write: () => {},
  quiet: true,
};

function job(label: string, command = "true"): PlannedJob {
  return {
    label,
    command,
    kind: "custom",
    reportStage: "check",
    willRun: true,
  };
}

function group(jobs: PlannedJob[]): JobGroup {
  return {
    stage: "check",
    mode: "parallel",
    heading: "Checking...",
    display: "Check",
    jobs,
  };
}

Deno.test("runGroup refuses a job label already recorded by an earlier group", async () => {
  const results = new Map<string, JobResult>();
  results.set("lint", {
    label: "lint",
    status: "failed",
    code: 1,
    durationS: 0,
    outputLines: 0,
    errorLikeLines: 0,
  });
  await assertRejects(
    () =>
      runGroup(
        group([job("lint", "echo should-never-run")]),
        results,
        RUN_OPTS,
        makeOut(false, { quiet: true }),
      ),
    Error,
    "duplicate gate job label",
  );
  // The earlier group's genuine result was NOT overwritten.
  assertEquals(results.get("lint")?.code, 1);
});

Deno.test("runGroup refuses duplicate labels within one group, before anything runs", async () => {
  const results = new Map<string, JobResult>();
  await assertRejects(
    () =>
      runGroup(
        group([job("lint"), job("lint", "echo sibling")]),
        results,
        RUN_OPTS,
        makeOut(false, { quiet: true }),
      ),
    Error,
    "duplicate gate job label",
  );
  assertEquals(results.size, 0, "no result recorded for the refused group");
});

Deno.test("runGroup records distinct labels normally", async () => {
  const results = new Map<string, JobResult>();
  const ok = await runGroup(
    group([job("lint"), job("typecheck")]),
    results,
    RUN_OPTS,
    makeOut(false, { quiet: true }),
  );
  assertEquals(ok, true);
  assertEquals([...results.keys()].sort(), ["lint", "typecheck"]);
});
