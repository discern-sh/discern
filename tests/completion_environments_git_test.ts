/** Real bounded Git failures remain actionable in an environment's recovery. */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { executionGit } from "../src/engine/execution/snapshot.ts";
import { SYSTEM_SCHEDULER } from "../src/shared/scheduler.ts";
import { GIT_OUTPUT_LIMIT_EXCEEDED } from "../src/shared/subprocess.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "./waiting.ts";

Deno.test("V06 bounded Git failures retain deadline, output ceiling, and exit evidence", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "source"), "source bytes\n");
    await gitInit(root);
    const bounds = {
      maxFiles: 100,
      maxBytes: 1024 * 1024,
      gitTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
    };
    const timedOut = await assertRejects(
      () =>
        executionGit(root, ["rev-parse", "HEAD"], {
          ...bounds,
          gitTimeoutMs: 37,
        }, {
          allowedExitCodes: [124],
          scheduler: {
            ...SYSTEM_SCHEDULER,
            scheduleTimeout: (callback) => {
              callback();
              return 0;
            },
            cancelTimeout: () => {},
          },
        }),
      Error,
      "time limit 37 ms",
    );
    assertStringIncludes(timedOut.message, "exit 124");
    assertStringIncludes(timedOut.message, "Preserve the environment");
    const limited = await assertRejects(
      () =>
        executionGit(root, ["rev-parse", "HEAD"], {
          ...bounds,
          maxBytes: 1,
        }, { allowedExitCodes: [GIT_OUTPUT_LIMIT_EXCEEDED] }),
      Error,
      "output limit 1 bytes",
    );
    assertStringIncludes(limited.message, `exit ${GIT_OUTPUT_LIMIT_EXCEEDED}`);
    const failed = await assertRejects(
      () =>
        executionGit(
          root,
          ["rev-parse", "--verify", "refs/heads/missing"],
          bounds,
        ),
      Error,
      "exit 128",
    );
    assertStringIncludes(failed.message, "Preserve the environment");

    await git(root, "switch", "--detach", "HEAD");
    assertEquals(
      await executionGit(root, ["symbolic-ref", "-q", "HEAD"], bounds, {
        allowedExitCodes: [1],
      }),
      "",
    );
  });
});
