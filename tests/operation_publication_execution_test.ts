/** The shared execution boundary rejects slow work under publication ownership. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { gitInit, runAgent } from "./engine_helpers.ts";
import { withCompletionPublication } from "../src/engine/operation_lock.ts";
import { runShell } from "../src/shared/subprocess.ts";

Deno.test("publication ownership cannot enclose a project command with an unrelated name", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/source`, "fixture\n");
    await gitInit(root);
    await withCompletionPublication(root, async () => {
      await assertRejects(
        () => runShell("true", { cwd: root }),
        Error,
        "common publication",
      );
    });
  });
});

Deno.test("publication ownership rejects every project execution capability and capacity admission", async () => {
  await withTempDir(async (root) => {
    const config = parseConfigOrThrow(
      '[project]\nslug = "execution"\n[gate]\nconcurrent_test_runs = 1\n',
    );
    await Deno.writeTextFile(
      `${root}/discern.toml`,
      '[project]\nslug = "execution"\n[gate]\nconcurrent_test_runs = 1\n',
    );
    await gitInit(root);
    const log = new Logger({
      json: true,
      noColor: true,
      terminal: pinnedTerminal(),
    });
    const acquirer = buildTestRunSlotAcquirer(root, config);
    assert(acquirer);
    await withCompletionPublication(root, async () => {
      for (
        const run of [
          () =>
            spawnJob({ label: "unrelated", command: "true" }, {
              cwd: root,
              stream: false,
              write: () => {},
            }),
          () => runOwnedChild("true", { cwd: root }),
          () => runShellRouted("true", { cwd: root, log }),
          () => acquirer.acquire(() => {}),
        ]
      ) await assertRejects(run, Error, "common publication");
      const child = await runAgent(root, [
        "queue",
        "--",
        "sh",
        "-c",
        "touch forbidden-child",
      ], { env: operationLockChildEnv() });
      assertEquals(child.code, 1, child.output);
      assertTerminalTextIncludes(
        child.output,
        "common publication",
      );
      assertEquals(await pathExists(`${root}/forbidden-child`), false);
    });
  });
});

import { spawnJob } from "../src/engine/jobs/command.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { runShellRouted } from "../src/engine/worktree/shell.ts";
import { buildTestRunSlotAcquirer } from "../src/engine/test_run_slots.ts";
import { operationLockChildEnv } from "../src/shared/operation_lock_context.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { Logger } from "../src/lib/log.ts";
import { pinnedTerminal } from "./helpers.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
