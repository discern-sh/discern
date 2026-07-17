/**
 * OS-interrupt propagation E2E — interrupting a running `done` must stop the
 * gate's jobs, not orphan them.
 *
 * The class this guards: gate jobs are spawned `detached` (their own process
 * groups, so the runner can tree-kill them), which also insulates them from the
 * terminal's own signal delivery — Ctrl-C reaches discern but never its jobs.
 * The engine therefore watches for interrupts itself while jobs are in flight
 * (`src/engine/jobs/interrupt.ts`): it tree-kills every in-flight job, then
 * re-raises so the process dies with the conventional killed-by-signal status.
 * The test drives the whole loop black-box: scaffold a project whose check job
 * records its PID and sleeps, run the real engine, interrupt it mid-gate, and
 * prove BOTH processes are gone.
 *
 * Parameterized over the watcher's own INTERRUPT_SIGNALS, so a newly watched
 * signal auto-enrols here (fix the class, not the instance).
 */

import { assert } from "@std/assert";
import { join } from "@std/path";
import {
  INTERRUPT_SIGNALS,
  SIGNAL_EXIT_CODES,
} from "../src/engine/jobs/interrupt.ts";
import {
  DENO_JSON,
  engineEnv,
  gitInit,
  MAIN_TS,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

/** Poll until `check` resolves true, failing the test after the deadline. */
async function pollFor(
  check: () => Promise<boolean> | boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Whether a PID is still alive (signal 0 semantics via a harmless SIGCONT). */
function alive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

for (const sig of INTERRUPT_SIGNALS) {
  Deno.test(`an interrupted done run (${sig}) kills the in-flight gate job and dies by the interrupt`, async () => {
    const dir = await Deno.makeTempDir({ prefix: "discern-gate-interrupt-" });
    try {
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
          "[capabilities]",
          // The check-stage job records its own PID (the job group's leader)
          // and blocks, so the test can interrupt a genuinely in-flight gate
          // and then prove the group died.
          'lint = "echo $$ > gate.pid && sleep 30"',
        ].join("\n"),
      );
      await gitInit(dir);

      const child = new Deno.Command("deno", {
        args: [
          "run",
          "--no-check",
          "--config",
          DENO_JSON,
          "-A",
          MAIN_TS,
          "done",
        ],
        cwd: dir,
        env: await engineEnv(),
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      // Drain both streams so a full pipe can never wedge the engine.
      const drained = Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      const pidFile = join(dir, "gate.pid");
      await pollFor(
        async () => (await Deno.stat(pidFile).catch(() => null)) !== null,
        "the gate's check job to start",
      );
      const jobPid = Number((await Deno.readTextFile(pidFile)).trim());
      assert(Number.isFinite(jobPid) && jobPid > 0, `bad gate.pid: ${jobPid}`);

      Deno.kill(child.pid, sig);
      const status = await child.status;
      await drained;

      // The engine died the way the interrupt asked — re-raised BY the signal
      // (the normal path), OR with that signal's conventional 128+n exit code
      // when the self-signal doesn't terminate (the documented fallback in
      // interrupt.ts; observed under load once the listener is torn down). Both
      // are a clean killed-by-interrupt outcome, not a normal exit 0/1; asserting
      // only the former is stricter than interrupt.ts guarantees and flakes under
      // load. What matters is it did NOT run to a normal completion.
      const diedBySignal = status.signal === sig;
      const diedByFallbackCode = status.signal === null &&
        status.code === SIGNAL_EXIT_CODES[sig];
      assert(
        diedBySignal || diedByFallbackCode,
        `expected death by ${sig} or exit ${SIGNAL_EXIT_CODES[sig]}, got ${
          JSON.stringify(status)
        }`,
      );
      // And the job it was running is dead too — no orphaned gate processes.
      await pollFor(
        () => !alive(jobPid),
        `gate job ${jobPid} to die`,
        10_000,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
}
