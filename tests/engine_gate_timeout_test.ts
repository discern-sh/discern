/**
 * Engine tests for the gate job timeout (`[gate].timeout`): the watchdog that
 * tree-kills any command that never exits within its budget, so the gate can NEVER
 * hang — the single worst first-hour failure (a bare `test = "<runner>"` entering
 * watch mode and waiting forever for a file change). These prove the behaviour at
 * two levels: the job runner (a hung job is killed, its whole process group dies,
 * and it is a GENUINE failure, not a cancelled sibling) and the full `discern
 * finish` (the plain-language, watch-mode-naming diagnostic reaches the envelope).
 *
 * The class guard (ADR 0051): the budget rides in one place and every stage runs
 * through the one executor, so a hung command in ANY stage kind must be killed. The
 * parameterized coverage below proves that off the STAGE REGISTRY (`STAGES` /
 * `KNOWN_CAPABILITIES`), plus a custom check and a scope gate — so a newly-added
 * stage kind has to time out too, or the gate fails here.
 *
 * Behavioural only: the watchdog reasons about "did the command exit?", never about
 * which runner produced it — discern never sniffs framework or capability strings.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runParallel } from "../src/engine/jobs/runner.ts";
import { RECORD_ENTRY_SCHEMAS } from "../src/shared/config_schema.ts";
import {
  type Capability,
  KNOWN_CAPABILITIES,
  type Stage,
  STAGES,
} from "../src/shared/capabilities.ts";
import { escapedDaemonCommand, withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

/** Poll until a PID no longer exists (signal 0 probes without sending). */
async function waitForExit(pid: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      Deno.kill(pid, "SIGCONT");
    } catch {
      return; // gone
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`process ${pid} still alive after the timeout`);
}

Deno.test("gate timeout: a job that never exits is tree-killed and recorded as a genuine timeout failure", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-timeout-" });
  try {
    const start = performance.now();
    const r = await runParallel([
      // Record the backgrounded grandchild's PID so the test can prove the whole
      // process GROUP died, not just the direct `sh`.
      {
        label: "hang",
        command: "sh -c 'echo $$ > inner.pid; sleep 9999' & wait",
      },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      timeoutS: 1,
      write: () => {},
    });
    const elapsed = performance.now() - start;

    const hang = r.results.find((x) => x.label === "hang");
    assertEquals(r.ok, false);
    // It timed out: the budget is recorded, so the diagnostic can name it…
    assertEquals(hang?.timedOutAfterS, 1, JSON.stringify(hang));
    // …and it is a GENUINE failure, never a cancelled sibling (whose output is dropped).
    assertEquals(
      hang?.cancelled,
      undefined,
      "a timeout is a real failure, not a cancelled sibling",
    );
    assert((hang?.code ?? 0) !== 0, "a tree-killed job reports non-zero");
    assert(
      elapsed < 10_000,
      `the watchdog should fire within a ~1s budget, took ${elapsed}ms`,
    );
    // The whole process group was tree-killed — the backgrounded grandchild is dead.
    const innerPid = Number(
      (await Deno.readTextFile(join(dir, "inner.pid"))).trim(),
    );
    await waitForExit(innerPid);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gate timeout: an escaped descendant holding the pipes cannot wedge the watchdog — the job stays bounded and fails as a genuine timeout", async () => {
  // The pipe-holder class: the watchdog tree-kills the job's process GROUP,
  // but a descendant that re-parented into its own session (the standard
  // self-daemonizing pattern) survives the kill while inheriting the job's
  // stdout/stderr. Before the kill path bounded the drains, the runner then
  // waited for pipe EOF — the daemon's whole lifetime (15s here; forever for a
  // real daemon) — and, the direct shell having exited 0, reported the job OK
  // with the recorded timeout silently swallowed.
  const dir = await Deno.makeTempDir({ prefix: "discern-timeout-escape-" });
  try {
    const start = performance.now();
    const r = await runParallel([
      { label: "escape", command: escapedDaemonCommand(15) },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      timeoutS: 2,
      write: () => {},
    });
    const elapsed = performance.now() - start;

    const escape = r.results.find((x) => x.label === "escape");
    assertEquals(r.ok, false);
    // The timeout is recorded AND is a failure — never `ok` with the budget
    // swallowed just because the direct shell exited clean.
    assertEquals(escape?.timedOutAfterS, 2, JSON.stringify(escape));
    assert(
      (escape?.code ?? 0) !== 0,
      "a timed-out job must report non-zero even when its shell exited clean",
    );
    assertEquals(escape?.cancelled, undefined);
    // Bounded: budget + the kill path's pipe grace, not the daemon's lifetime.
    assert(
      elapsed < 10_000,
      `the kill path should release the held pipes within its grace, took ${elapsed}ms`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("gate timeout: a job that finishes within budget is untouched", async () => {
  const r = await runParallel([{ label: "quick", command: "true" }], {
    cwd: Deno.cwd(),
    stream: false,
    failFast: true,
    color: false,
    timeoutS: 30,
    write: () => {},
  });
  assertEquals(r.ok, true);
  assertEquals(r.results[0]?.timedOutAfterS, undefined);
});

Deno.test("gate timeout: 0 disables the watchdog (no spurious kill of a fast job)", async () => {
  const r = await runParallel([{ label: "quick", command: "true" }], {
    cwd: Deno.cwd(),
    stream: false,
    failFast: true,
    color: false,
    timeoutS: 0,
    write: () => {},
  });
  assertEquals(r.ok, true);
  assertEquals(r.results[0]?.timedOutAfterS, undefined);
});

Deno.test("gate timeout: a never-exiting test command fails `discern done` with the watch-mode diagnostic", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[capabilities]",
        'test = "sleep 9999"', // never exits — the watch-mode-runner hang, distilled
        "",
        "[gate]",
        "timeout = 1", // a tiny budget so the test is fast
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const start = Date.now();
    const r = await runAgent(dir, ["done", "--json"]);
    const elapsed = Date.now() - start;

    assertEquals(r.code, 1, r.output);
    // deno-lint-ignore no-explicit-any
    const obj = JSON.parse(r.stdout.trim()) as any;
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "check/test");
    // deno-lint-ignore no-explicit-any
    const diag = (obj.diagnostics ?? []).find((d: any) => d.tool === "test");
    assert(diag !== undefined, `expected a diagnostic for test: ${r.stdout}`);
    // The message is bounded, plain, and names the likely cause + the way out.
    assertStringIncludes(diag.message, "timed out");
    assertStringIncludes(diag.message, "watch-mode");
    assertStringIncludes(diag.message, "[gate].timeout");
    // Bounded: the gate returned in seconds, not the 9999s the command wanted.
    assert(
      elapsed < 30_000,
      `the gate should fail within the budget, took ${elapsed}ms`,
    );
  });
});

// ── the class guard: the timeout applies to EVERY stage kind (ADR 0051) ──────────

/**
 * Drive a never-exiting command wired into some stage kind through the full
 * `discern done` under a tiny budget, and assert it fails with the actionable
 * timeout diagnostic — bounded, not a hang. `wiring` is the config section(s) that
 * place the `sleep 9999`; `jobLabel` is the diagnostic's `tool`; `changedFile`
 * (scope gates only) marks the scope changed so its gate fires.
 */
async function assertStageKindTimesOut(opts: {
  wiring: string[];
  jobLabel: string;
  changedFile?: string;
}): Promise<void> {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        ...opts.wiring,
        "",
        "[gate]",
        "timeout = 1",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    if (opts.changedFile !== undefined) {
      await writeExecutable(join(dir, opts.changedFile), "x");
    }

    const start = Date.now();
    const r = await runAgent(dir, ["done", "--json"]);
    const elapsed = Date.now() - start;

    assertEquals(r.code, 1, r.output);
    // deno-lint-ignore no-explicit-any
    const obj = JSON.parse(r.stdout.trim()) as any;
    // deno-lint-ignore no-explicit-any
    const diag = (obj.diagnostics ?? []).find((d: any) =>
      d.tool === opts.jobLabel
    );
    assert(
      diag !== undefined,
      `expected a timeout diagnostic for ${opts.jobLabel}: ${r.stdout}`,
    );
    // The SAME actionable diagnostic reaches every stage kind — not a bare exit code.
    assertStringIncludes(diag.message, "timed out");
    assertStringIncludes(diag.message, "watch-mode");
    assertStringIncludes(diag.message, "[gate].timeout");
    assert(
      elapsed < 30_000,
      `${opts.jobLabel}: the watchdog should fire within budget, took ${elapsed}ms`,
    );
  });
}

/** One representative capability per gate stage, derived from KNOWN_CAPABILITIES
 * (first-seen wins) — NOT a hand-copied list, so a new capability or stage enrols
 * automatically and the loop below must then prove it is bounded too. */
const CAPABILITY_FOR_STAGE = new Map<Stage, Capability>();
for (
  const [cap, stage] of Object.entries(KNOWN_CAPABILITIES) as [
    Capability,
    Stage,
  ][]
) {
  if (!CAPABILITY_FOR_STAGE.has(stage)) {
    CAPABILITY_FOR_STAGE.set(stage, cap);
  }
}

// A capability in every gate stage — iterated off the STAGES registry, so a stage
// added to `STAGES` auto-enrols (and fails here until it too honours the timeout).
for (const stage of STAGES) {
  Deno.test(`gate timeout: the ${stage} stage is bounded`, async () => {
    const cap = CAPABILITY_FOR_STAGE.get(stage);
    assert(
      cap !== undefined,
      `no capability represents the "${stage}" stage — extend the timeout stage-coverage guard`,
    );
    await assertStageKindTimesOut({
      wiring: ["[capabilities]", `${cap} = "sleep 9999"`],
      jobLabel: cap,
    });
  });
}

// The escaped-descendant variant through the FULL done: the command exits
// clean but leaves a detached daemon holding its output pipes, so only the
// kill path's drain bound (not the tree-kill) can end the job. The gate must
// still fail within budget with the actionable timeout diagnostic — before the
// bound it hung for the daemon's whole lifetime and reported the job ok.
Deno.test("gate timeout: a daemonizing command is bounded and diagnosed", async () => {
  await assertStageKindTimesOut({
    wiring: [
      "[capabilities]",
      `test = ${JSON.stringify(escapedDaemonCommand(60))}`,
    ],
    jobLabel: "test",
  });
});

// The other job kinds the gate runs, which are NOT capability stages: a custom
// [checks.<name>] and a changed scope's own gate.
Deno.test("gate timeout: a custom check is bounded", async () => {
  await assertStageKindTimesOut({
    wiring: ["[checks.slowcheck]", 'stage = "check"', 'run = "sleep 9999"'],
    jobLabel: "slowcheck",
  });
});

Deno.test("gate timeout: a changed scope's gate is bounded", async () => {
  await assertStageKindTimesOut({
    wiring: ["[scopes.widget]", 'paths = ["widget/**"]', 'gate = "sleep 9999"'],
    jobLabel: "scope:widget",
    changedFile: "widget/x.txt",
  });
});

// ── per-job `timeout` overrides: one job's own budget, siblings keep the global ──

Deno.test("timeout override: a job's own budget bounds only that job — siblings keep the run-level budget", async () => {
  const start = performance.now();
  const r = await runParallel([
    // Overridden down to 1s: killed. The sibling sleeps past that override but
    // well inside the run-level budget: untouched.
    { label: "tight", command: "sleep 9999", timeoutS: 1 },
    { label: "roomy", command: "sleep 2" },
  ], {
    cwd: Deno.cwd(),
    stream: false,
    failFast: false,
    color: false,
    timeoutS: 30,
    write: () => {},
  });
  const elapsed = performance.now() - start;
  const tight = r.results.find((x) => x.label === "tight");
  const roomy = r.results.find((x) => x.label === "roomy");
  assertEquals(tight?.timedOutAfterS, 1, JSON.stringify(tight));
  assertEquals(roomy?.timedOutAfterS, undefined, JSON.stringify(roomy));
  assertEquals(roomy?.code, 0);
  assert(elapsed < 15_000, `bounded by the override, took ${elapsed}ms`);
});

Deno.test("timeout override: 0 disables the bound for that job alone", async () => {
  const r = await runParallel([
    // The run-level budget is 1s; the override lifts it for this job only.
    { label: "unbounded", command: "sleep 2", timeoutS: 0 },
  ], {
    cwd: Deno.cwd(),
    stream: false,
    failFast: true,
    color: false,
    timeoutS: 1,
    write: () => {},
  });
  assertEquals(r.results[0]?.timedOutAfterS, undefined);
  assertEquals(r.results[0]?.code, 0);
});

/**
 * Drive a config whose one slow job carries its own `timeout` while a sibling
 * relies on the (generous) global, through the full `discern done`: the override
 * must bound ITS job — failing within seconds — while the sibling passes.
 */
async function assertOverrideBoundsOwnJob(opts: {
  wiring: string[];
  jobLabel: string;
}): Promise<void> {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        ...opts.wiring,
        "",
        "[gate]",
        "timeout = 600", // generous global: only the override can fire this fast
        "fail_fast = false",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const start = Date.now();
    const r = await runAgent(dir, ["done", "--json"]);
    const elapsed = Date.now() - start;

    assertEquals(r.code, 1, r.output);
    // deno-lint-ignore no-explicit-any
    const obj = JSON.parse(r.stdout.trim()) as any;
    // deno-lint-ignore no-explicit-any
    const diag = (obj.diagnostics ?? []).find((d: any) =>
      d.tool === opts.jobLabel
    );
    assert(
      diag !== undefined,
      `expected a timeout diagnostic for ${opts.jobLabel}: ${r.stdout}`,
    );
    assertStringIncludes(diag.message, "timed out after 1s");
    // The sibling under the global budget is untouched.
    // deno-lint-ignore no-explicit-any
    const sibling = (obj.steps ?? []).find((s: any) => s.label === "lint");
    assertEquals(sibling?.outcome, "ok", JSON.stringify(sibling));
    assert(
      elapsed < 30_000,
      `the override should bound its job, took ${elapsed}ms`,
    );
  });
}

// The override class, per job-bearing config shape — the capability TABLE form,
// a [checks.<name>].timeout, and a [scopes.<name>].timeout — each proven to
// bound its own job while a sibling keeps the global budget.
Deno.test("timeout override: the capability table form { run, timeout } bounds its job", async () => {
  await assertOverrideBoundsOwnJob({
    wiring: [
      "[capabilities]",
      'lint = "true"',
      'test = { run = "sleep 9999", timeout = 1 }',
    ],
    jobLabel: "test",
  });
});

Deno.test("timeout override: [checks.<name>].timeout bounds its job", async () => {
  await assertOverrideBoundsOwnJob({
    wiring: [
      "[capabilities]",
      'lint = "true"',
      "",
      "[checks.slowcheck]",
      'stage = "check"',
      'run = "sleep 9999"',
      "timeout = 1",
    ],
    jobLabel: "slowcheck",
  });
});

Deno.test("timeout override: [scopes.<name>].timeout bounds its gate job", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[capabilities]",
        'lint = "true"',
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        'gate = "sleep 9999"',
        "timeout = 1",
        "",
        "[gate]",
        "timeout = 600",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x");

    const start = Date.now();
    const r = await runAgent(dir, ["done", "--json"]);
    const elapsed = Date.now() - start;

    assertEquals(r.code, 1, r.output);
    // deno-lint-ignore no-explicit-any
    const obj = JSON.parse(r.stdout.trim()) as any;
    // deno-lint-ignore no-explicit-any
    const diag = (obj.diagnostics ?? []).find((d: any) =>
      d.tool === "scope:widget"
    );
    assert(diag !== undefined, `expected a timeout diagnostic: ${r.stdout}`);
    assertStringIncludes(diag.message, "timed out after 1s");
    assert(elapsed < 30_000, `bounded by the override, took ${elapsed}ms`);
  });
});

// The forcing function for the override class: every record family whose
// entries run a gate job (a `run` or `gate` command) must accept the shared
// per-job `timeout` key — driven off RECORD_ENTRY_SCHEMAS, so a future
// job-bearing record family auto-enrols and fails here until it takes it.
Deno.test("timeout override: every job-bearing record family accepts the per-job timeout key", () => {
  let jobBearing = 0;
  for (const [family, schema] of Object.entries(RECORD_ENTRY_SCHEMAS)) {
    const keys = Object.keys(schema.shape);
    if (!keys.includes("run") && !keys.includes("gate")) {
      continue; // not a gate-job table (e.g. worktree resources)
    }
    jobBearing++;
    assert(
      keys.includes("timeout"),
      `[${family}] entries run gate jobs but take no per-job \`timeout\` override — wire the shared jobTimeout key so one slow job never needs a slower global`,
    );
  }
  assert(jobBearing >= 3, "expected checks, scopes, and standards to enrol");
});

Deno.test("timeout override: the bare command-or-list capability form parses and runs unchanged", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[capabilities]",
        'lint = "true"',
        'test = ["true", "true"]',
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const r = await runAgent(dir, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
  });
});
