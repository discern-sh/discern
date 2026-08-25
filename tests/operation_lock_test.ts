/** Deterministic concurrency protocol tests for classified operation locks. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname } from "@std/path";
import {
  OperationLockError,
  withOperationLock,
} from "../src/engine/operation_lock.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** Hold one operation at a barrier after its lock has been acquired. */
function heldOperation(
  entered: (value: void) => void,
  release: Promise<void>,
): () => Promise<void> {
  return async () => {
    entered();
    await release;
  };
}

/** Initialize the repository helper with one authored file to commit. */
async function initializeRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(`${dir}/seed.txt`, "seed\n");
  await gitInit(dir);
}

Deno.test("acceptance from two worktrees shares one common-repository exclusion", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const firstWorktree = await addWorktree(dir, "first-acceptance");
    const secondWorktree = await addWorktree(dir, "second-acceptance");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withOperationLock(
      firstWorktree,
      { command: "accept" },
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;

    let secondRan = false;
    const refusal = await assertRejects(
      () =>
        withOperationLock(secondWorktree, { command: "accept" }, () => {
          secondRan = true;
          return Promise.resolve();
        }),
      OperationLockError,
    );
    assertEquals(secondRan, false);
    assertStringIncludes(refusal.message, "common repository boundary");
    assertStringIncludes(refusal.message, "This call made no change");
    assertStringIncludes(refusal.message, "Retry after");

    release.resolve();
    await first;
  });
});

Deno.test("conflicting writers in one checkout refuse instead of interleaving", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withOperationLock(
      dir,
      { command: "refresh" },
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;

    let secondRan = false;
    const refusal = await assertRejects(
      () =>
        withOperationLock(dir, { command: "prepare" }, () => {
          secondRan = true;
          return Promise.resolve();
        }),
      OperationLockError,
    );
    assertEquals(secondRan, false);
    assertStringIncludes(refusal.message, "checkout boundary");

    const refreshTool = TOOLS.find((tool) => tool.name === "discern_refresh");
    assert(refreshTool !== undefined);
    const routed = await runTool(
      refreshTool,
      new WorkingRoot(dir),
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    assertEquals(routed.structuredContent.error, "precondition_failed");
    const routedMessage = routed.structuredContent.message;
    assert(typeof routedMessage === "string");
    assertStringIncludes(routedMessage, "checkout boundary");

    release.resolve();
    await first;
  });
});

Deno.test("an orphaned lock path is not treated as ownership", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const path = await gitAdminStatePath(dir, "operationCheckoutLock");
    assert(path !== undefined);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, "stale contents are not authority\n");

    let ran = false;
    await withOperationLock(dir, { command: "refresh" }, () => {
      ran = true;
      return Promise.resolve();
    });
    assertEquals(ran, true);
  });
});

Deno.test("pre-repository writers share a path-keyed exclusion", async () => {
  await withTempDir(async (dir) => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withOperationLock(dir, { command: "refresh" }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    await assertRejects(
      () => withOperationLock(dir, { command: "refresh" }, async () => {}),
      OperationLockError,
      "checkout boundary",
    );

    release.resolve();
    await first;
  });
});

Deno.test("nested locking cannot invert common-before-checkout order", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const refusal = await assertRejects(
      () =>
        withOperationLock(dir, { command: "prepare" }, () =>
          withOperationLock(
            dir,
            { command: "accept" },
            () => Promise.resolve(),
          )),
      OperationLockError,
    );
    assertStringIncludes(refusal.message, "common repository boundary after");
    assertStringIncludes(refusal.message, "common before checkout");
  });
});

Deno.test("checkout-scoped writers in separate worktrees retain parallelism", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const firstWorktree = await addWorktree(dir, "first-refresh");
    const secondWorktree = await addWorktree(dir, "second-refresh");
    const firstEntered = Promise.withResolvers<void>();
    const secondEntered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withOperationLock(
      firstWorktree,
      { command: "refresh" },
      heldOperation(firstEntered.resolve, release.promise),
    );
    await firstEntered.promise;
    const second = withOperationLock(
      secondWorktree,
      { command: "refresh" },
      heldOperation(secondEntered.resolve, release.promise),
    );
    await secondEntered.promise;
    assert(true);

    release.resolve();
    await Promise.all([first, second]);
  });
});

Deno.test("mixed observation forms and previews do not take writer locks", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withOperationLock(
      dir,
      { command: "refresh" },
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;

    let observed = 0;
    await withOperationLock(dir, { command: "docs" }, () => {
      observed++;
      return Promise.resolve();
    });
    await withOperationLock(
      dir,
      { command: "accept", dryRun: true },
      () => {
        observed++;
        return Promise.resolve();
      },
    );
    assertEquals(observed, 2);
    await assertRejects(
      () =>
        withOperationLock(
          dir,
          { command: "docs", flags: ["output"] },
          () => Promise.resolve(),
        ),
      OperationLockError,
    );

    release.resolve();
    await first;
  });
});
