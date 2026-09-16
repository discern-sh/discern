import { waitForPendingCondition } from "./waiting.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
/** Production Desk effects own their journal before exclusion and retain results. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  executeDeskOperation,
  runDeskInteractiveChild,
  runDeskProjectScript,
} from "../src/engine/desk/desk.ts";
import { withCompletionObserver } from "../src/engine/completion/events.ts";
import { readOperationJournal } from "../src/engine/completion/operation_journal.ts";
import {
  addWorktree,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("Desk Project Script retains its own successful and failed operation results", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await gitInit(root);
    await writeExecutable(
      join(root, "discern/scripts/check-result"),
      '#!/bin/sh\nexit "$1"\n',
    );
    for (const code of [0, 7]) {
      let handle: string | undefined;
      const result = await withCompletionObserver((fact) => {
        if (fact.kind === "progress" && fact.progress.operation_handle) {
          handle = fact.progress.operation_handle;
        }
      }, () => runDeskProjectScript(root, "check-result", [String(code)], {}));
      assertEquals(result, code);
      assert(
        handle !== undefined,
        "the production action must start a shared journal",
      );
      const read = await readOperationJournal(root, handle);
      assert(read.kind === "found");
      assertEquals(read.record.operation.verb, "scripts");
      const delivered = read.record.result;
      assert(
        typeof delivered === "object" && delivered !== null &&
          "ok" in delivered,
      );
      assertEquals(delivered.ok, code === 0);
    }
    let nestedHandle: string | undefined;
    await withCompletionObserver(
      (fact) => {
        if (
          fact.kind === "progress" && fact.progress.operation_handle
        ) nestedHandle = fact.progress.operation_handle;
      },
      () =>
        executeDeskOperation(
          root,
          { command: "scripts", hasOperands: true },
          async () => {
            await executeDeskOperation(
              root,
              { command: "prepare" },
              () => Promise.resolve({ ok: true, verb: "prepare" }),
            );
            const pending = await operationProgressResult(root, {
              handle: nestedHandle ?? "",
            });
            assertEquals(pending.data?.operation.verb, "scripts");
            assertEquals(pending.data?.executor, "running");
            return {
              ok: false,
              verb: "scripts",
              error: "precondition_failed" as const,
              message: "The enclosing script refused after its nested command.",
            };
          },
        ),
    );
    const nested = await operationProgressResult(root, {
      handle: nestedHandle ?? "",
    });
    assertEquals(nested.data?.operation.verb, "scripts");
    assertEquals(nested.data?.outcome, "failed");
    const original = join(root, "discern/scripts/check-result");
    await writeExecutable(
      join(root, "other/check-result"),
      "#!/bin/sh\nexit 0\n",
    );
    await writeConfig(
      root,
      '[project]\nslug = "engine-test"\nagents = []\n[scripts]\ndir = "other"\n',
    );
    assertEquals(
      await runDeskProjectScript(root, "check-result", [], {}, original),
      1,
      "branch-local script relocation cannot inherit executable consent",
    );
  });
});

Deno.test("paused production Desk script exposes its actual lease, cancels durably, and releases the next action", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await writeExecutable(
      join(root, "discern/scripts/pause"),
      '#!/bin/sh\nprintf ready > "$1"\nsleep 60\n',
    );
    await writeExecutable(
      join(root, "discern/scripts/next"),
      "#!/bin/sh\nexit 0\n",
    );
    await gitInit(root);
    const sibling = await addWorktree(root, "independent");
    const controller = new AbortController();
    const marker = join(root, "ready");
    let handle: string | undefined;
    const pending = withCompletionObserver(
      (fact) => {
        if (
          fact.kind === "progress" && fact.progress.operation_handle
        ) handle = fact.progress.operation_handle;
      },
      () =>
        runDeskProjectScript(
          root,
          "pause",
          [marker],
          {},
          undefined,
          controller.signal,
        ),
    );
    try {
      await waitForPendingCondition(
        pending,
        async () => await targetExists(marker),
        "the owned Project Script to pause",
      );
      assert(handle !== undefined);
      const progress = await operationProgressResult(root, { handle });
      assertEquals(progress.data?.operation.verb, "scripts");
      assertEquals(progress.data?.executor, "running");
      // A running script is project code: it holds no boundary, so competing
      // checkout effects proceed while its journal still shows it running.
      for (const command of ["update", "worktree rename"]) {
        let ran = false;
        await executeDeskOperation(root, { command }, () => {
          ran = true;
          return Promise.resolve();
        });
        assertEquals(ran, true, command);
      }
      assertEquals(
        (await operationProgressResult(root, { handle })).data?.executor,
        "running",
      );
      assertEquals(await runDeskProjectScript(sibling, "next", [], {}), 0);
    } finally {
      controller.abort();
      assert((await pending) !== 0);
    }
    const final = await operationProgressResult(root, { handle: handle ?? "" });
    assertEquals(final.data?.outcome, "cancelled");
    assertEquals(final.data?.operation.verb, "scripts");
    assertEquals(await runDeskProjectScript(root, "next", [], {}), 0);
    let previewRan = false;
    const before = await operationProgressResult(root);
    await executeDeskOperation(
      root,
      { command: "worktree drop", dryRun: true },
      () => {
        previewRan = true;
        return Promise.resolve();
      },
    );
    assert(previewRan);
    assertEquals(
      (await operationProgressResult(root)).data?.handle,
      before.data?.handle,
      "dry runs do not create an action journal",
    );
  });
});

/** A minimal gate whose one job settles instantly or waits for a release file. */
function gateConfig(testJob = "true"): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    `test = ${JSON.stringify(testJob)}`,
    "",
  ].join("\n");
}

/** Hold a shell open as the desk would, signalling readiness through a file. */
function holdOpen(ready: string, release: string): readonly string[] {
  return [
    "-c",
    'printf ready > "$1"; while [ ! -e "$2" ]; do sleep 0.05; done',
    "sh",
    ready,
    release,
  ];
}

Deno.test("an open desk shell never keeps the gate from running on its checkout", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await writeConfig(root, gateConfig());
    await gitInit(root);
    // Signals live beside the checkout so the gate sees a clean tree.
    await withTempDir(async (signals) => {
      const ready = join(signals, "shell-ready");
      const release = join(signals, "shell-release");
      const shell = runDeskInteractiveChild(
        "sh",
        holdOpen(ready, release),
        root,
        {},
        "desk shell",
      );
      try {
        await waitForPendingCondition(
          shell,
          async () => await targetExists(ready),
          "the desk shell to be open",
        );
        // The operator is looking around in a shell; the agent runs its gate.
        const gate = await runAgent(root, ["done"]);
        assertEquals(gate.code, 0, gate.output);
      } finally {
        await Deno.writeTextFile(release, "");
      }
      assertEquals(await shell, 0);
    });
  });
});

Deno.test("a running gate never refuses a desk shell on its checkout", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await withTempDir(async (signals) => {
      const ready = join(signals, "gate-ready");
      const release = join(signals, "gate-release");
      await writeConfig(
        root,
        gateConfig(
          `printf ready > '${ready}'; while [ ! -e '${release}' ]; do sleep 0.05; done`,
        ),
      );
      await gitInit(root);
      const gate = runAgent(root, ["done"]);
      try {
        await waitForPendingCondition(
          gate,
          async () => await targetExists(ready),
          "the gate to hold the checkout",
        );
        // The agent's gate holds the checkout; the operator jumps in to look.
        assertEquals(
          await runDeskInteractiveChild(
            "sh",
            ["-c", "exit 0"],
            root,
            {},
            "desk shell",
          ),
          0,
        );
      } finally {
        await Deno.writeTextFile(release, "");
      }
      const finished = await gate;
      assertEquals(finished.code, 0, finished.output);
    });
  });
});

Deno.test("a terminal-owning child refuses an action not registered as a session", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await gitInit(root);
    const marker = join(root, "spawned");
    const refusal = await assertRejects(
      () =>
        runDeskInteractiveChild(
          "sh",
          ["-c", `printf spawned > '${marker}'`],
          root,
          {},
          "desk unrelated",
        ),
      Error,
      "not registered as an interactive session",
    );
    assertStringIncludes(refusal.message, "desk unrelated");
    assertEquals(await targetExists(marker), false, "nothing may spawn first");
  });
});
