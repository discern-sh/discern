/** A real done narrates producer counts and leaves a reconnectable journal. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { engineEnv, engineRunArgs } from "./engine_helpers.ts";
import { runAgent } from "./engine_helpers.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
import { processAllowance, waitUntil } from "./waiting.ts";
import { readPidsIfReady } from "./process_id.ts";
import { completionProcessAlive } from "./completion_mcp_fixture.ts";

const REPORTING_PRODUCER = [
  `printf 'DISCERN_PROGRESS {"units":{"kind":"suites","completed":1,"total":2}}\\n'`,
  `printf 'DISCERN_PROGRESS {"units":{"kind":"suites","completed":2,"total":2},"results":{"passed":5,"failed":0,"skipped":0}}\\n'`,
  `printf 'DISCERN_METRIC coverage 93\\n'`,
].join("; ");

Deno.test("a static human done narrates counts and retains a reconnectable result", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"], "", REPORTING_PRODUCER);
    const run = await runAgent(path, ["done"]);
    assertEquals(run.code, 0, run.output);
    // The producer's own counts reached the static terminal as sentences.
    assertStringIncludes(run.output, "Running test: 1 of 2 suites done.");
    assertStringIncludes(
      run.output,
      "Running test: 2 of 2 suites done, no failures so far.",
    );
    // The reconnect handle was announced at the start of the run.
    assertStringIncludes(run.output, "progress handle R1-");
    // A second session reads the same operation back without re-running it.
    const read = await operationProgressResult(path);
    assert(read.ok, JSON.stringify(read));
    assertEquals(read.data?.operation.verb, "done");
    assertEquals(read.data?.outcome, "completed");
    assertEquals(read.data?.executor, "gone");
    assertEquals(read.data?.producers?.[0]?.units, {
      kind: "suites",
      completed: 2,
      total: 2,
    });
    assertEquals(read.data?.producers?.[0]?.results, {
      passed: 5,
      failed: 0,
      skipped: 0,
    });
    const stored = read.data?.result as { ok?: boolean; verb?: string };
    assertEquals(stored.ok, true);
    assertEquals(stored.verb, "done");
  });
});

Deno.test("losing a read-only observer leaves the executing gate running", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const gated = `echo started > '${aux}/leader'; ` +
        `until [ -f '${aux}/continue' ]; do sleep 0.05; done; ` +
        `printf 'DISCERN_METRIC coverage 93\\n'`;
      const path = await project(root, ["local"], "", gated);
      const child = new Deno.Command("deno", {
        args: engineRunArgs(["done"]),
        cwd: path,
        env: await engineEnv(),
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const allowance = processAllowance();
      try {
        // The observer: reconnect reads against the running operation. They
        // are observation only — after they stop, execution must continue.
        await waitUntil(
          async () => {
            const read = await operationProgressResult(path);
            return read.ok && read.data?.executor === "running";
          },
          "the running gate to become observable",
          { allowance },
        );
        const during = await operationProgressResult(path);
        assert(during.ok);
        assertEquals(during.data?.outcome, undefined);
        // The observer goes away (no more reads); the executor is released
        // to finish and does.
        await Deno.writeTextFile(`${aux}/continue`, "go\n");
        const status = await child.status;
        const output = new TextDecoder().decode(
          (await child.output()).stdout,
        );
        assertEquals(status.code, 0, output);
        const after = await operationProgressResult(path);
        assert(after.ok);
        assertEquals(after.data?.outcome, "completed");
      } finally {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already exited: the journey's success path.
        }
      }
    });
  });
});

Deno.test("a killed executor leaves its journal readable as stopped, not decided", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const blocking = `echo $$ > '${aux}/leader'; ` +
        `printf 'DISCERN_PROGRESS {"units":{"kind":"suites","completed":1,"total":null}}\\n'; ` +
        `tail -f /dev/null & echo $! > '${aux}/descendant'; wait`;
      const path = await project(root, ["local"], "", blocking);
      const child = new Deno.Command("deno", {
        args: engineRunArgs(["done"]),
        cwd: path,
        env: await engineEnv(),
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const pids: number[] = [];
      const allowance = processAllowance();
      try {
        await waitUntil(
          async () => {
            const ready = await readPidsIfReady([
              `${aux}/leader`,
              `${aux}/descendant`,
            ]);
            if (ready === undefined) return false;
            pids.push(...ready);
            return true;
          },
          "the blocking producer to establish readiness",
          { allowance },
        );
        await waitUntil(
          async () => {
            const read = await operationProgressResult(path);
            return read.ok &&
              read.data?.producers?.[0]?.units?.completed === 1;
          },
          "the producer's report to reach the journal",
          { allowance },
        );
        // The observer dies without closing anything: SIGKILL, no cancel.
        child.kill("SIGKILL");
        await child.status;
        await waitUntil(
          async () => {
            const read = await operationProgressResult(path);
            return read.ok && read.data?.executor === "gone";
          },
          "the killed executor to read as gone",
          { allowance },
        );
        const read = await operationProgressResult(path);
        assert(read.ok, JSON.stringify(read));
        // No outcome was manufactured; the operation reads as stopped.
        assertEquals(read.data?.outcome, undefined);
        assertEquals(read.data?.operation.finished_at, undefined);
        assertStringIncludes(
          read.message ?? "",
          "stopped without finishing and its recording process is gone",
        );
        // The last recorded facts survive, unknown total intact.
        assertEquals(read.data?.producers?.[0]?.units, {
          kind: "suites",
          completed: 1,
          total: null,
        });
        // The unfinished producer's transcript stays reachable: its capture
        // location was journalled when allocated, and the bytes written
        // before the kill are readable through it.
        const transcript = read.data?.producers?.[0]?.output_path;
        assert(transcript !== undefined, JSON.stringify(read.data));
        assertStringIncludes(
          await Deno.readTextFile(transcript),
          "DISCERN_PROGRESS",
        );
      } finally {
        for (const pid of pids) {
          if (completionProcessAlive(pid)) Deno.kill(pid, "SIGKILL");
        }
        await child.stdout.cancel();
        await child.stderr.cancel();
      }
    });
  });
});
