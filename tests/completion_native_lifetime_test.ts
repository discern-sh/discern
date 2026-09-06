/** The native lease proves exclusion and child settlement before a source can return. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import { createEnvironmentExecutor } from "../src/engine/execution/executor.ts";
import {
  createNativeExecutionLifetime,
  executionChildrenQuiescent,
} from "../src/engine/execution/lifetime.ts";
import { saveEnvironmentArtifact } from "../src/engine/execution/artifacts.ts";
import { withExecutionChildren } from "../src/shared/execution_child_context.ts";
import { spawnJob } from "../src/engine/jobs/command.ts";
import { superviseSpawn } from "../src/engine/owned_child.ts";
import { artifactPath } from "../src/engine/execution/artifact_read.ts";
import { withCompletionPublication } from "../src/engine/operation_lock.ts";
import { requireEnvironment } from "../src/engine/execution/registry.ts";

Deno.test("native borrowed execution returns its source and retains common child evidence", async () => {
  await withTempDir(async (base) => {
    const fixture = await environmentFixture(base);
    const lifetime = createNativeExecutionLifetime(fixture.root);
    const executor = createEnvironmentExecutor({
      ...fixture.options,
      lifetime,
    });
    const claimed = await fixture.claim(fixture.plan(), executor);
    const returned = await executor.execute(claimed, async (execution) => {
      await withCompletionPublication(fixture.root, () => Promise.resolve());
      const result = await spawnJob({
        label: "candidate",
        command: 'test "$(cat schema)" = 2',
      }, {
        cwd: fixture.path,
        stream: false,
        write: () => {},
        signal: execution.signal,
      });
      return result.result.code === 0;
    });
    assertEquals(returned.validation, true);
    assertEquals(returned.returned.kind, "restored");
    assertEquals(await Deno.readTextFile(`${fixture.path}/schema`), "1\n");
    assertEquals(
      await executionChildrenQuiescent(
        fixture.root,
        claimed.attempt.identity.id,
      ),
      true,
    );
    assertEquals(
      (await requireEnvironment(fixture.root, fixture.id)).record.data.release
        .kind,
      "held",
    );
  });
});

Deno.test("uncertain child receipts retain recovery independently of the checkout lease", async () => {
  await withTempDir(async (base) => {
    const fixture = await environmentFixture(base);
    const lifetime = createNativeExecutionLifetime(fixture.root);
    const executor = createEnvironmentExecutor({
      ...fixture.options,
      lifetime,
    });
    const claimed = await fixture.claim(fixture.plan(), executor);
    const subject = {
      attempt_id: claimed.attempt.identity.id,
      candidate_id: claimed.candidate_id,
      context: "local",
    };
    const returned = await executor.execute(claimed, async () => {
      await saveEnvironmentArtifact(
        fixture.root,
        subject,
        "children/planned-uncertain",
        true,
      );
      return true;
    });
    assertEquals(returned.returned.kind, "recovery-incomplete");
    assertEquals(
      await executionChildrenQuiescent(
        fixture.root,
        claimed.attempt.identity.id,
      ),
      false,
    );
    assertEquals((await lifetime.inspect(fixture.path)).quiescent, true);
    const path = await artifactPath(
      fixture.root,
      claimed.attempt.identity.id,
      "environment/children/started-uncertain.json",
    );
    await Deno.writeTextFile(path, "{broken");
    assertEquals(
      await executionChildrenQuiescent(
        fixture.root,
        claimed.attempt.identity.id,
      ),
      false,
    );
  });
});

Deno.test("both owned spawn boundaries settle receipts and reap on receipt failure", async () => {
  await withTempDir(async (base) => {
    const fixture = await environmentFixture(base, "undeclared");
    for (const fail of [false, true]) {
      for (const boundary of ["job", "owned"] as const) {
        let started = 0;
        let settled = false;
        let child: Deno.ChildProcess | undefined;
        const run = () =>
          withExecutionChildren({
            planned: () =>
              Promise.resolve({
                started: (pid, isolated) => {
                  started = pid;
                  assert(isolated);
                  return fail
                    ? Promise.reject(new Error("receipt unavailable"))
                    : Promise.resolve();
                },
                settled: () => {
                  settled = true;
                  return Promise.resolve();
                },
              }),
          }, async () => {
            if (boundary === "job") {
              await spawnJob({ label: "receipt", command: "printf ok" }, {
                cwd: fixture.path,
                stream: false,
                write: () => {},
              });
            } else {
              await superviseSpawn(
                () => {
                  child = new Deno.Command("sh", {
                    args: ["-c", "exit 0"],
                    stdin: "null",
                    stdout: "null",
                    stderr: "null",
                    detached: true,
                  }).spawn();
                  return child;
                },
                (child) => child.status,
                { isolatedGroup: true },
              );
            }
          });
        if (fail) await assertRejects(run, Error, "receipt unavailable");
        else await run();
        assert(started > 0);
        if (child !== undefined) await child.status;
        if (!fail) assert(settled);
      }
    }
  });
});

Deno.test("test claims remain diagnostic across the environment and evaluator boundary", async () => {
  await withTempDir(async (base) => {
    const fixture = await environmentFixture(base);
    const plan = {
      ...fixture.plan(),
      demand: {
        kind: "test" as const,
        mode: "strict" as const,
        context: "local",
        producers: [],
        readings: "already-produced" as const,
      },
    };
    const claimed = await fixture.claim(plan);
    assertEquals(claimed.attempt.purpose, "diagnostic");
    await fixture.executor.execute(claimed, () => Promise.resolve(true));
  });
});
