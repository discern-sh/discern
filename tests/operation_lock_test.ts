/** Deterministic concurrency protocol tests for classified operation locks. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import {
  OperationLockError,
  withOperationLock,
} from "../src/engine/operation_lock.ts";
import { withAcceptanceTransactionLock } from "../src/engine/worktree/acceptance_transaction.ts";
import { WorktreeResultError } from "../src/engine/worktree/git.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { OPERATION_EFFECTS } from "../src/shared/operation_effects.ts";
import { currentOperationLocks } from "../src/shared/operation_lock_context.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { cliJsonResultVerb } from "../src/shared/result_contracts.ts";
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
  await Deno.writeTextFile(
    join(dir, "discern.toml"),
    [
      "[meta]",
      "bootstrapped = true",
      "",
      "[project]",
      'slug = "operation-lock"',
      "",
    ].join("\n"),
  );
  await gitInit(dir);
}

/** Make one directory deny entry creation and always restore its mode. */
async function withUnwritableDirectory(
  dir: string,
  operation: () => Promise<void>,
): Promise<void> {
  const mode = (await Deno.stat(dir)).mode;
  assert(mode !== null, `could not read mode for ${dir}`);
  await Deno.chmod(dir, 0o555);
  try {
    await operation();
  } finally {
    await Deno.chmod(dir, mode & 0o777);
  }
}

Deno.test("a Git writer probes Git administration without enrolling file-only writers", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    let gitWriterRan = false;
    let fileWriterRan = false;
    const gitAdmin = join(dir, ".git");

    await withUnwritableDirectory(gitAdmin, async () => {
      const refusal = await assertRejects(
        () =>
          withOperationLock(dir, { command: "update" }, () => {
            gitWriterRan = true;
            return Promise.resolve();
          }),
        OperationLockError,
      );
      assertEquals(refusal.result.error, "write_access");
      assertEquals(refusal.result.diagnostics?.[0]?.tool, "write-access");
      assertEquals(
        refusal.result.diagnostics?.[0]?.reproduce_cmd,
        "discern update",
      );
      assertStringIncludes(refusal.message, gitAdmin);

      const updateTool = TOOLS.find((tool) => tool.name === "discern_update");
      assert(updateTool !== undefined);
      const routed = await runTool(
        updateTool,
        new WorkingRoot(dir),
        {},
        undefined,
        () => Promise.resolve(undefined),
      );
      assertEquals(routed.structuredContent.error, "write_access");
      const routedMessage = routed.structuredContent.message;
      assert(typeof routedMessage === "string");
      assertStringIncludes(routedMessage, gitAdmin);

      await withOperationLock(dir, { command: "refresh" }, () => {
        fileWriterRan = true;
        return Promise.resolve();
      });
    });

    assertEquals(gitWriterRan, false);
    assertEquals(fileWriterRan, true);
  });
});

Deno.test("Git-writer preflight refusals use each command's public result verb", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const gitWriters = Object.entries(OPERATION_EFFECTS).filter(([, policy]) =>
      policy.gitWriteAuthority === "boundary-plan" ||
      policy.gitWriteAuthority === "boundary-plus-effect-plan"
    );

    await withUnwritableDirectory(join(dir, ".git"), async () => {
      for (const [command] of gitWriters) {
        const publishedVerb = cliJsonResultVerb(command);
        const refusal = await assertRejects(
          () =>
            withOperationLock(
              dir,
              {
                command,
                ...(publishedVerb === undefined
                  ? {}
                  : { resultVerb: publishedVerb }),
              },
              () => Promise.resolve(),
            ),
          OperationLockError,
        );
        assertEquals(
          refusal.result.verb,
          publishedVerb ?? command,
          command,
        );
      }
    });
  });
});

Deno.test("common-only Git writers do not demand linked-checkout administration", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const worktree = await addWorktree(dir, "common-only-authority");
    const anchor = await gitAdminStatePath(worktree, "gateProof");
    assert(anchor !== undefined);
    const checkoutAdmin = dirname(dirname(anchor));
    let ran = false;

    await withUnwritableDirectory(checkoutAdmin, async () => {
      await withOperationLock(
        worktree,
        { command: "patterns reset" },
        () => {
          ran = true;
          return Promise.resolve();
        },
      );
    });

    assertEquals(ran, true);
  });
});

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

Deno.test("accept holds every competing common-repository mutation outside its body", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const accepting = await addWorktree(dir, "accept-lock-owner");
    const contender = await addWorktree(dir, "common-lock-contender");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const held = withOperationLock(
      accepting,
      { command: "accept" },
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;

    try {
      const commonMutations = Object.entries(OPERATION_EFFECTS).filter(
        ([, policy]) =>
          policy.lock === "common" || policy.lock === "common-and-checkout",
      );
      for (const [command] of commonMutations) {
        let ran = false;
        const refusal = await assertRejects(
          () =>
            withOperationLock(contender, { command }, () => {
              ran = true;
              return Promise.resolve();
            }),
          OperationLockError,
        );
        assertEquals(ran, false, command);
        assertStringIncludes(refusal.message, "common repository boundary");
        assertStringIncludes(refusal.message, "This call made no change");
      }
    } finally {
      release.resolve();
      await held;
    }
  });
});

Deno.test("acceptance lock preserves structured write-access evidence", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const worktree = await addWorktree(dir, "accept-write-access");
    await withUnwritableDirectory(join(dir, ".git"), async () => {
      const refusal = await assertRejects(
        () => withAcceptanceTransactionLock(worktree, () => Promise.resolve()),
        WorktreeResultError,
      );
      assertEquals(refusal.result.error, "write_access");
      assertEquals(refusal.result.diagnostics?.[0]?.tool, "write-access");
      assertEquals(
        refusal.result.diagnostics?.[0]?.reproduce_cmd,
        "discern accept",
      );
    });
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
    let path: string | undefined;
    await withOperationLock(dir, { command: "refresh" }, () => {
      path = [...(currentOperationLocks()?.leases.values() ?? [])][0]?.path;
      return Promise.resolve();
    });
    assert(path !== undefined);
    await Deno.writeTextFile(path, "stale contents are not authority\n");

    let ran = false;
    await withOperationLock(dir, { command: "refresh" }, () => {
      ran = true;
      return Promise.resolve();
    });
    assertEquals(ran, true);
    assertEquals(
      await Deno.readTextFile(path),
      "stale contents are not authority\n",
      "the live lease token must not replace an inert standing record",
    );
  });
});

Deno.test("every pre-repository boundary falls back without masking the command body", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[project]\nslug = 'lock-boundary'\n",
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withOperationLock(dir, { command: "accept" }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    await assertRejects(
      () => withOperationLock(dir, { command: "accept" }, async () => {}),
      OperationLockError,
      "common repository boundary",
    );

    release.resolve();
    await first;
  });
});

Deno.test("setup begin writers serialize before a project root exists", async () => {
  await withTempDir(async (dir) => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withOperationLock(
      dir,
      { command: "setup begin" },
      async () => {
        entered.resolve();
        await release.promise;
      },
    );
    await entered.promise;

    await assertRejects(
      () => withOperationLock(dir, { command: "setup begin" }, async () => {}),
      OperationLockError,
      "common repository boundary",
    );

    release.resolve();
    await first;
  });
});

Deno.test("pre-repository exclusion keys nested callers to the discovered project root", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[project]\nslug = 'lock-root'\n",
    );
    const left = join(dir, "left");
    const right = join(dir, "right");
    await Deno.mkdir(left);
    await Deno.mkdir(right);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withOperationLock(left, { command: "prepare" }, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;

    await assertRejects(
      () => withOperationLock(right, { command: "prepare" }, async () => {}),
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
