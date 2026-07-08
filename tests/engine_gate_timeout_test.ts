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
import {
  type Capability,
  KNOWN_CAPABILITIES,
  type Stage,
  STAGES,
} from "../src/shared/capabilities.ts";
import { withTempDir } from "./helpers.ts";
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

Deno.test("gate timeout: a never-exiting test command fails `discern finish` with the watch-mode diagnostic", async () => {
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
    const r = await runAgent(dir, ["finish", "--json"]);
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
 * `discern finish` under a tiny budget, and assert it fails with the actionable
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
    const r = await runAgent(dir, ["finish", "--json"]);
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
