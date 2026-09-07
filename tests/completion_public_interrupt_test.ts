/** OS cancellation spans public execution, native return, and queue settlement. */
import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { project } from "./completion_public_fixture.ts";
import { engineEnv, engineRunArgs } from "./engine_helpers.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { withTempDir } from "./helpers.ts";
import { settlePending, waitForPendingCondition } from "./waiting.ts";
import {
  INTERRUPT_SIGNALS,
  SIGNAL_EXIT_CODES,
} from "../src/engine/process_signals.ts";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import { inspectGateProof } from "../src/engine/gate/proof.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { observedRecords } from "../src/engine/landing_queue/repository.ts";

const DECLARATION = `
[gate]
concurrent_test_runs = 1
[execution.local]
kind = 'borrowed'
reusable = true
capacity = 1
inputs = ['**']
ignored = ['executions']
resources = []
prepare = 'true'
restore = 'true'
`;

/** A dead owned PID cannot retain a test child or mutate the returned checkout. */
function alive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

for (
  const scenario of [
    "done",
    "test",
    "standards",
    "extract",
    "capacity",
  ] as const
) {
  // The full native transaction is exercised for every watched OS signal;
  // the other public demands guard distinct producer/extractor/capacity paths.
  for (
    const signal of scenario === "done"
      ? INTERRUPT_SIGNALS
      : ["SIGINT"] as const
  ) {
    Deno.test(`public ${scenario} interruption with ${signal} settles execution before releasing its checkout`, async () => {
      await withTempDir(async (root) => {
        await withTempDir(async (aux) => {
          const leader = join(aux, "leader");
          const descendant = join(aux, "descendant");
          const tree =
            `echo $$ > ${leader}; tail -f /dev/null & echo $! > ${descendant}; wait`;
          const extra = (scenario === "extract"
            ? `extract = ${JSON.stringify(tree)}\n`
            : "") + DECLARATION;
          const path = await project(
            root,
            ["local"],
            extra,
            scenario === "extract" ? undefined : tree,
          );
          const before =
            (await runGit(["rev-parse", "HEAD", "HEAD^{tree}"], { cwd: path }))
              .stdout;
          const branch =
            (await runGit(["symbolic-ref", "HEAD"], { cwd: path })).stdout;
          let slot: Deno.FsFile | undefined;
          if (scenario === "capacity") {
            const directory = join(
              root,
              ".git",
              GIT_ADMIN_STATE.testSlots.path,
            );
            await Deno.mkdir(directory, { recursive: true });
            slot = await Deno.open(join(directory, "slot-1"), {
              create: true,
              read: true,
              write: true,
            });
            assert(await slot.tryLock(true));
          }
          const verb = scenario === "capacity"
            ? "done"
            : scenario === "extract"
            ? "standards"
            : scenario;
          const engine = new Deno.Command(Deno.execPath(), {
            args: engineRunArgs([verb]),
            cwd: path,
            env: await engineEnv(),
            stdin: "null",
            stdout: "piped",
            stderr: "piped",
          }).spawn();
          let text = "";
          const drain = async (
            stream: ReadableStream<Uint8Array>,
          ): Promise<void> => {
            const decoder = new TextDecoder();
            for await (const chunk of stream) {
              text += decoder.decode(chunk, { stream: true });
            }
          };
          const completion = Promise.all([
            engine.status,
            drain(engine.stdout),
            drain(engine.stderr),
          ]);
          const pids: number[] = [];
          try {
            await waitForPendingCondition(
              completion,
              async () =>
                scenario === "capacity"
                  ? text.includes("Tests queued")
                  : await exists(leader) && await exists(descendant),
              "public execution to reach the interruption boundary",
              {
                settledError: () =>
                  new Error(text),
              },
            );
            if (scenario !== "capacity") {
              pids.push(
                Number(await Deno.readTextFile(leader)),
                Number(await Deno.readTextFile(descendant)),
              );
            }
            engine.kill(signal);
            const [status] = await settlePending(
              completion,
              "interrupted public execution to return its checkout",
              { timeoutMs: 30_000 },
            );
            assert(
              status.signal === signal ||
                status.code === SIGNAL_EXIT_CODES[signal],
              `${JSON.stringify(status)}\n${text}`,
            );
            assertEquals(
              pids.map(alive),
              pids.map(() => false),
              text,
            );
            assertEquals(
              (await runGit(["symbolic-ref", "HEAD"], { cwd: path })).stdout,
              branch,
              text,
            );
            assertEquals(
              (await runGit(["rev-parse", "HEAD", "HEAD^{tree}"], {
                cwd: path,
              })).stdout,
              before,
            );
            assertEquals(
              (await runGit(["status", "--porcelain"], { cwd: path })).stdout,
              "",
            );
            assertEquals((await inspectGateProof(path)).status, "missing");
            const records = observedRecords(
              await observeCompletionRecords(path),
            );
            if (scenario === "test") assertEquals(records, []);
            else {
              const environments = records.filter((record) =>
                record.kind === "environment"
              );
              assertEquals(environments.length, 1, JSON.stringify(records));
              assertEquals(
                environments.map((record) => record.data.state.kind),
                ["idle"],
                JSON.stringify(records),
              );
              for (const record of records) {
                if (record.kind === "attempt") {
                  assertEquals(record.data.state.kind, "finished");
                  if (record.data.state.kind === "finished") {
                    assertEquals(record.data.state.outcome, "cancelled");
                  }
                }
                if (record.kind === "queue") {
                  assert(
                    record.data.entries.every((entry) =>
                      entry.state !== "active"
                    ),
                    JSON.stringify(record),
                  );
                }
                assert(record.kind !== "proof", JSON.stringify(record));
              }
            }
            if (scenario === "capacity") {
              assertEquals(await exists(leader), false);
            }
          } finally {
            slot?.close();
            try {
              engine.kill("SIGKILL");
            } catch {
              /* Already exited. */
            }
            for (const pid of pids) {
              try {
                Deno.kill(pid, "SIGKILL");
              } catch { /* Already exited. */ }
            }
            await completion;
          }
        });
      });
    });
  }
}
