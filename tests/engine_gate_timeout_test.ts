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
 * `KNOWN_JOBS`), plus a custom check and a scope gate — so a newly-added
 * stage kind has to time out too, or the gate fails here.
 *
 * Behavioural only: the watchdog reasons about "did the command exit?", never about
 * which runner produced it — discern never sniffs framework or capability strings.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { targetExists } from "../src/shared/fs_presence.ts";
import { join } from "@std/path";
import { runParallel } from "../src/engine/jobs/runner.ts";
import { RECORD_ENTRY_SCHEMAS } from "../src/shared/config_schema.ts";
import {
  KNOWN_JOBS,
  type KnownJob,
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
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { waitUntil } from "./waiting.ts";

// Startup and behaviour are separate clocks. A loaded parallel suite may delay
// a cold engine before it reaches its configured command; once that command
// writes its readiness marker, the watchdog keeps the tight behavioural bound.
const ENGINE_READINESS_TIMEOUT_MS = 180_000;
const DIRECT_WATCHDOG_CEILING_MS = 10_000;
const FULL_GATE_POST_READY_CEILING_MS = 15_000;
const OVERRIDE_WATCHDOG_CEILING_MS = 15_000;
const TIMEOUT_READY_FILE = ".discern-timeout-ready";

/** Wait for a planted readiness marker and fail if the engine operation settles before it appears. */
async function waitForReadiness<T>(
  path: string,
  pending: Promise<T>,
  what: string,
): Promise<void> {
  let settled:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: unknown }
    | undefined;
  void pending.then(
    (value) => {
      settled = { ok: true, value };
    },
    (error: unknown) => {
      settled = { ok: false, error };
    },
  );
  await waitUntil(async () => {
    if (await targetExists(path)) {
      return true;
    }
    if (settled !== undefined) {
      if (!settled.ok) {
        throw settled.error;
      }
      throw new Error(
        `${what} settled before writing its readiness marker: ${
          JSON.stringify(settled.value)
        }`,
      );
    }
    return false;
  }, `${what} readiness`, {
    timeoutMs: ENGINE_READINESS_TIMEOUT_MS,
    intervalMs: 25,
  });
}

/** Measure only the shutdown interval after a timed job proves it has started. */
async function settleAfterReadiness<T>(
  path: string,
  pending: Promise<T>,
  what: string,
): Promise<{ readonly result: T; readonly elapsedMs: number }> {
  await waitForReadiness(path, pending, what);
  const started = performance.now();
  const result = await pending;
  return { result, elapsedMs: performance.now() - started };
}

/** Prefix a shell fixture with the marker that starts the timeout assertion clock. */
function readyThen(command: string): string {
  return `: > ${TIMEOUT_READY_FILE} && ${command}`;
}

const RUN_AGENT_CALL = ["run", "Agent("].join("");

/** Find agent invocations whose test timer incorrectly starts before a readiness boundary. */
function preReadinessAgentTimers(source: string): string[] {
  const lines = source.split("\n");
  const offenders: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!line.includes(RUN_AGENT_CALL)) {
      continue;
    }
    const lead = lines.slice(Math.max(0, index - 4), index + 1).join("\n");
    if (/Date\.now\(\)|performance\.now\(\)/.test(lead)) {
      offenders.push(`${index + 1}: ${line.trim()}`);
    }
  }
  return offenders;
}

Deno.test("gate timeout harness: a full-engine deadline cannot start before readiness — future cases auto-enrol", async () => {
  assertEquals(
    preReadinessAgentTimers(
      await Deno.readTextFile(new URL(import.meta.url)),
    ),
    [],
    "launch the agent, wait for the planted job marker, then start the behavioural clock",
  );
  const futureSibling = [
    "const started = Date.now();",
    `const result = await ${RUN_AGENT_CALL}root, ["done"]);`,
  ].join("\n");
  assertEquals(
    preReadinessAgentTimers(futureSibling),
    ['2: const result = await runAgent(root, ["done"]);'],
  );
});

/** Poll until a PID no longer exists (signal 0 probes without sending). */
async function waitForExit(pid: number): Promise<void> {
  await waitUntil(() => {
    try {
      Deno.kill(pid, "SIGCONT");
      return false;
    } catch {
      return true;
    }
  }, `process ${pid} to exit after the timeout`, {
    timeoutMs: 5_000,
    intervalMs: 50,
  });
}

Deno.test("gate timeout: a job that never exits is tree-killed and recorded as a genuine timeout failure", async () => {
  await withTempDir(async (dir) => {
    const pending = runParallel([
      // Record the backgrounded grandchild's PID so the test can prove the whole
      // process GROUP died, not just the direct `sh`.
      {
        label: "hang",
        command:
          `sh -c 'echo $$ > inner.pid; : > ${TIMEOUT_READY_FILE}; sleep 9999' & wait`,
      },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      timeoutS: 1,
      write: () => {},
    });
    const { result: r, elapsedMs: elapsed } = await settleAfterReadiness(
      join(dir, TIMEOUT_READY_FILE),
      pending,
      "the never-exiting job",
    );

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
      elapsed < DIRECT_WATCHDOG_CEILING_MS,
      `the watchdog should fire within a ~1s budget, took ${elapsed}ms`,
    );
    // The whole process group was tree-killed — the backgrounded grandchild is dead.
    const innerPid = Number(
      (await Deno.readTextFile(join(dir, "inner.pid"))).trim(),
    );
    await waitForExit(innerPid);
  }, { prefix: "discern-timeout-" });
});

Deno.test("gate timeout: an escaped descendant holding the pipes cannot wedge the watchdog — the job stays bounded and fails as a genuine timeout", async () => {
  // The pipe-holder class: the watchdog tree-kills the job's process GROUP,
  // but a descendant that re-parented into its own session (the standard
  // self-daemonizing pattern) survives the kill while inheriting the job's
  // stdout/stderr. Before the kill path bounded the drains, the runner then
  // waited for pipe EOF — the daemon's whole lifetime (15s here; forever for a
  // real daemon) — and, the direct shell having exited 0, reported the job OK
  // with the recorded timeout silently swallowed.
  await withTempDir(async (dir) => {
    const pending = runParallel([
      {
        label: "escape",
        command: escapedDaemonCommand(15, TIMEOUT_READY_FILE),
      },
    ], {
      cwd: dir,
      stream: false,
      failFast: true,
      color: false,
      timeoutS: 2,
      write: () => {},
    });
    const { result: r, elapsedMs: elapsed } = await settleAfterReadiness(
      join(dir, TIMEOUT_READY_FILE),
      pending,
      "the escaped pipe holder",
    );

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
      elapsed < DIRECT_WATCHDOG_CEILING_MS,
      `the kill path should release the held pipes within its grace, took ${elapsed}ms`,
    );
  }, { prefix: "discern-timeout-escape-" });
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
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        `test = ${JSON.stringify(readyThen("sleep 9999"))}`, // never exits
        "",
        "[gate]",
        "timeout = 1", // a tiny budget so the test is fast
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const pending = runAgent(dir, ["done", "--json"]);
    const { result: r, elapsedMs: elapsed } = await settleAfterReadiness(
      join(dir, TIMEOUT_READY_FILE),
      pending,
      "the full-gate test job",
    );

    assertEquals(r.code, 1, r.output);
    const obj = decodeCliResult(r.stdout, "done");
    assertResultDataKey(obj, "failed_stage");
    assertEquals(obj.ok, false);
    assertEquals(obj.data.failed_stage, "check/test");
    const diag = (obj.diagnostics ?? []).find((d) => d.tool === "test");
    assert(diag !== undefined, `expected a diagnostic for test: ${r.stdout}`);
    // The message is bounded, plain, and names the likely cause + the way out.
    assertStringIncludes(diag.message, "timed out");
    assertStringIncludes(diag.message, "watch-mode");
    assertStringIncludes(diag.message, "[gate].timeout");
    // Bounded: the gate returned in seconds, not the 9999s the command wanted.
    assert(
      elapsed < FULL_GATE_POST_READY_CEILING_MS,
      `the ready gate should fail within the budget, took ${elapsed}ms`,
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
  wiring: (command: string) => string[];
  jobLabel: string;
  changedFile?: string;
  command?: (markerFile: string) => string;
}): Promise<void> {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = opts.command?.(TIMEOUT_READY_FILE) ??
      readyThen("sleep 9999");
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        ...opts.wiring(command),
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

    const pending = runAgent(dir, ["done", "--json"]);
    const { result: r, elapsedMs: elapsed } = await settleAfterReadiness(
      join(dir, TIMEOUT_READY_FILE),
      pending,
      `${opts.jobLabel} job`,
    );

    assertEquals(r.code, 1, r.output);
    const obj = decodeCliResult(r.stdout, "done");
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
      elapsed < FULL_GATE_POST_READY_CEILING_MS,
      `${opts.jobLabel}: the ready watchdog should fire within budget, took ${elapsed}ms`,
    );
  });
}

/** One representative capability per gate stage, derived from KNOWN_JOBS
 * (first-seen wins) — NOT a hand-copied list, so a new capability or stage enrols
 * automatically and the loop below must then prove it is bounded too. */
const CAPABILITY_FOR_STAGE = new Map<Stage, KnownJob>();
for (
  const [cap, stage] of Object.entries(KNOWN_JOBS) as [
    KnownJob,
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
      wiring: (command) => [
        "[jobs]",
        `${cap} = ${JSON.stringify(command)}`,
      ],
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
    wiring: (command) => ["[jobs]", `test = ${JSON.stringify(command)}`],
    jobLabel: "test",
    command: (markerFile) => escapedDaemonCommand(60, markerFile),
  });
});

// The other job kinds the gate runs, which are NOT capability stages: a custom
// [jobs.<name>] and a changed scope's own gate.
Deno.test("gate timeout: a custom check is bounded", async () => {
  await assertStageKindTimesOut({
    wiring: (command) => [
      "[jobs.slowcheck]",
      'stage = "check"',
      `run = ${JSON.stringify(command)}`,
    ],
    jobLabel: "slowcheck",
  });
});

Deno.test("gate timeout: a changed scope's gate is bounded", async () => {
  await assertStageKindTimesOut({
    wiring: (command) => [
      "[scopes.widget]",
      'paths = ["widget/**"]',
      `gate = ${JSON.stringify(command)}`,
    ],
    jobLabel: "scope:widget",
    changedFile: "widget/x.txt",
  });
});

// ── per-job `timeout` overrides: one job's own budget, siblings keep the global ──

Deno.test("timeout override: a job's own budget bounds only that job — siblings keep the run-level budget", async () => {
  await withTempDir(async (dir) => {
    const pending = runParallel([
      // Overridden down to 1s: killed. The sibling sleeps past that override but
      // well inside the run-level budget: untouched.
      { label: "tight", command: readyThen("sleep 9999"), timeoutS: 1 },
      { label: "roomy", command: "sleep 2" },
    ], {
      cwd: dir,
      stream: false,
      failFast: false,
      color: false,
      timeoutS: 30,
      write: () => {},
    });
    const { result: r, elapsedMs: elapsed } = await settleAfterReadiness(
      join(dir, TIMEOUT_READY_FILE),
      pending,
      "the job with a timeout override",
    );
    const tight = r.results.find((x) => x.label === "tight");
    const roomy = r.results.find((x) => x.label === "roomy");
    assertEquals(tight?.timedOutAfterS, 1, JSON.stringify(tight));
    assertEquals(roomy?.timedOutAfterS, undefined, JSON.stringify(roomy));
    assertEquals(roomy?.code, 0);
    assert(
      elapsed < OVERRIDE_WATCHDOG_CEILING_MS,
      `bounded by the override after readiness, took ${elapsed}ms`,
    );
  });
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
  wiring: (command: string) => string[];
  jobLabel: string;
}): Promise<void> {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        ...opts.wiring(readyThen("sleep 9999")),
        "",
        "[gate]",
        "timeout = 600", // generous global: only the override can fire this fast
        "fail_fast = false",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const pending = runAgent(dir, ["done", "--json"]);
    const { result: r, elapsedMs: elapsed } = await settleAfterReadiness(
      join(dir, TIMEOUT_READY_FILE),
      pending,
      `${opts.jobLabel} override`,
    );

    assertEquals(r.code, 1, r.output);
    const obj = decodeCliResult(r.stdout, "done");
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
      elapsed < FULL_GATE_POST_READY_CEILING_MS,
      `the ready override should bound its job, took ${elapsed}ms`,
    );
  });
}

// The override class, per job-bearing config shape — the capability TABLE form,
// a [jobs.<name>].timeout, and a [scopes.<name>].timeout — each proven to
// bound its own job while a sibling keeps the global budget.
Deno.test("timeout override: the capability table form { run, timeout } bounds its job", async () => {
  await assertOverrideBoundsOwnJob({
    wiring: (command) => [
      "[jobs]",
      'lint = "true"',
      `test = { run = ${JSON.stringify(command)}, timeout = 1 }`,
    ],
    jobLabel: "test",
  });
});

Deno.test("timeout override: [jobs.<name>].timeout bounds its job", async () => {
  await assertOverrideBoundsOwnJob({
    wiring: (command) => [
      "[jobs]",
      'lint = "true"',
      "",
      "[jobs.slowcheck]",
      'stage = "check"',
      `run = ${JSON.stringify(command)}`,
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
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        'lint = "true"',
        "",
        "[scopes.widget]",
        'paths = ["widget/**"]',
        `gate = ${JSON.stringify(readyThen("sleep 9999"))}`,
        "timeout = 1",
        "",
        "[gate]",
        "timeout = 600",
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    await writeExecutable(join(dir, "widget/x.txt"), "x");

    const pending = runAgent(dir, ["done", "--json"]);
    const { result: r, elapsedMs: elapsed } = await settleAfterReadiness(
      join(dir, TIMEOUT_READY_FILE),
      pending,
      "the scope timeout override",
    );

    assertEquals(r.code, 1, r.output);
    const obj = decodeCliResult(r.stdout, "done");
    // deno-lint-ignore no-explicit-any
    const diag = (obj.diagnostics ?? []).find((d: any) =>
      d.tool === "scope:widget"
    );
    assert(diag !== undefined, `expected a timeout diagnostic: ${r.stdout}`);
    assertStringIncludes(diag.message, "timed out after 1s");
    assert(
      elapsed < FULL_GATE_POST_READY_CEILING_MS,
      `bounded by the override after readiness, took ${elapsed}ms`,
    );
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
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
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
