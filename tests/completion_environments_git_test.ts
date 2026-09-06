/** Real bounded Git failures remain actionable in an environment's recovery. */
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  captureGitSnapshot,
  containedFile,
  executionGit,
} from "../src/engine/execution/snapshot.ts";
import { CheckoutPathSchema } from "../src/engine/execution/snapshot_schema.ts";
import { ArtifactPathSchema } from "../src/engine/completion/evidence.ts";
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

Deno.test("V08 checkout capture preserves literal native filenames and rejects traversal", async () => {
  await withTempDir(async (root) => {
    const names = Deno.build.os === "windows" ? ["with space", "café"] : [
      "*bold*.txt",
      "line\nbreak",
      " leading",
      "trailing ",
      "café",
      "back\\slash",
    ];
    for (const name of names) await Deno.writeTextFile(join(root, name), name);
    await gitInit(root);
    const snapshot = await captureGitSnapshot(root, {
      maxFiles: 100,
      maxBytes: 1024 * 1024,
      gitTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
    });
    assertEquals(
      snapshot.files.map((file) => file.path).sort(),
      [...names].sort(),
    );
    for (const file of snapshot.files) {
      assertEquals(
        await Deno.readTextFile(await containedFile(root, file.path)),
        file.path,
      );
    }
    for (
      const name of [
        "../outside",
        "/outside",
        "a/../outside",
        "a/./b",
        "a//b",
        ".git/index",
        "a/.GIT/config",
        "a\0b",
      ]
    ) {
      assertEquals(CheckoutPathSchema.safeParse(name).success, false, name);
      await assertRejects(() => containedFile(root, name));
    }
    assertEquals(CheckoutPathSchema.safeParse("e\u0301").success, true);
    assertEquals(ArtifactPathSchema.safeParse("*bold*.txt").success, false);
    await Deno.symlink(root, join(root, "ancestor"), { type: "dir" });
    await assertRejects(
      () => containedFile(root, "ancestor/source"),
      Error,
      "non-directory ancestor",
    );
  });
});
