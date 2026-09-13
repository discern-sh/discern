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
  withCompletionPublication,
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

Deno.test("phased acceptance planning remains concurrent across worktrees", async () => {
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
    try {
      let secondRan = false;
      await withOperationLock(secondWorktree, { command: "accept" }, () => {
        secondRan = true;
        return Promise.resolve();
      });
      assertEquals(secondRan, true);
    } finally {
      release.resolve();
      await first;
    }
  });
});

Deno.test("completion publication holds every competing common-repository mutation outside its body", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const accepting = await addWorktree(dir, "accept-lock-owner");
    const contender = await addWorktree(dir, "common-lock-contender");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const held = withCompletionPublication(
      accepting,
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

Deno.test("parallel completion publications serialize inside a common transaction and permit nested publication", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    await withOperationLock(dir, { command: "setup done" }, async () => {
      let active = 0;
      let maximum = 0;
      let nestedActive = 0;
      let nestedMaximum = 0;
      let completed = 0;
      await Promise.all(
        Array.from(
          { length: 8 },
          () =>
            withCompletionPublication(dir, async () => {
              active += 1;
              maximum = Math.max(maximum, active);
              try {
                await Promise.all(Array.from({ length: 4 }, () =>
                  withCompletionPublication(dir, async () => {
                    nestedActive += 1;
                    nestedMaximum = Math.max(nestedMaximum, nestedActive);
                    try {
                      await withCompletionPublication(dir, async () => {
                        assertEquals(
                          await Deno.readTextFile(join(dir, "seed.txt")),
                          "seed\n",
                        );
                        completed += 1;
                      });
                    } finally {
                      nestedActive -= 1;
                    }
                  })));
              } finally {
                active -= 1;
              }
            }),
        ),
      );
      assertEquals(maximum, 1);
      assertEquals(nestedMaximum, 1);
      assertEquals(completed, 32);
    });
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

Deno.test("a waiting acceptance queues behind the running landing and resumes on its own", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const first = await addWorktree(dir, "wt-a");
    const second = await addWorktree(dir, "wt-b");

    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const running = withAcceptanceTransactionLock(
      first,
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;

    // Without a wait, the second acceptance refuses at the shared boundary.
    const refusal = await assertRejects(
      () => withAcceptanceTransactionLock(second, () => Promise.resolve()),
      WorktreeResultError,
    );
    assertStringIncludes(refusal.message, "acceptance boundary");

    // With a wait, it reports the contention once and resumes after release.
    let contended = 0;
    const order: string[] = [];
    const waiting = withAcceptanceTransactionLock(second, () => {
      order.push("second");
      return Promise.resolve();
    }, {
      onContended: () => {
        contended += 1;
        if (contended === 1) release.resolve();
      },
    });
    await running;
    order.push("first-settled");
    await waiting;
    assertEquals(contended, 1);
    assertEquals(order, ["first-settled", "second"]);
  });
});

Deno.test("a cancelled landing wait refuses without running the operation", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const running = withAcceptanceTransactionLock(
      dir,
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;

    const controller = new AbortController();
    let ran = false;
    const refusal = await assertRejects(
      () =>
        withAcceptanceTransactionLock(dir, () => {
          ran = true;
          return Promise.resolve();
        }, {
          signal: controller.signal,
          onContended: () => controller.abort(),
        }),
      WorktreeResultError,
    );
    assertEquals(ran, false);
    assertStringIncludes(refusal.message, "cancelled");
    release.resolve();
    await running;
  });
});

Deno.test("a completion publication proceeds while a landing holds the acceptance boundary", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const running = withAcceptanceTransactionLock(
      dir,
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;
    // The landing serializes on its own boundary; the short publication
    // boundary stays free for sibling completions throughout.
    const published = await withCompletionPublication(
      dir,
      () => Promise.resolve("published"),
    );
    assertEquals(published, "published");
    release.resolve();
    await running;
  });
});

Deno.test("cancellation during the wait's pause refuses even when the boundary frees immediately", async () => {
  await withTempDir(async (dir) => {
    await initializeRepo(dir);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const running = withAcceptanceTransactionLock(
      dir,
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;

    const controller = new AbortController();
    const contended = Promise.withResolvers<void>();
    let ran = false;
    const waiting = assertRejects(
      () =>
        withAcceptanceTransactionLock(dir, () => {
          ran = true;
          return Promise.resolve();
        }, {
          signal: controller.signal,
          onContended: () => contended.resolve(),
        }),
      WorktreeResultError,
    );
    await contended.promise;
    // The abort and the holder's release both land inside the wait's pause:
    // the next acquisition attempt succeeds, and the post-acquisition
    // recheck must still refuse the already-cancelled call instead of
    // handing it the boundary.
    controller.abort();
    release.resolve();
    await running;
    const refusal = await waiting;
    assertEquals(ran, false);
    assertStringIncludes(refusal.message, "cancelled");
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

Deno.test("pre-repository common publication excludes common writers without masking their body", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "[project]\nslug = 'lock-boundary'\n",
    );
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = withCompletionPublication(
      dir,
      heldOperation(entered.resolve, release.promise),
    );
    await entered.promise;
    try {
      await assertRejects(
        () =>
          withOperationLock(dir, { command: "patterns seal" }, async () => {}),
        OperationLockError,
        "common repository boundary",
      );
    } finally {
      release.resolve();
      await first;
    }
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
      "lifecycle boundary",
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
        withOperationLock(
          dir,
          { command: "prepare" },
          () => withCompletionPublication(dir, () => Promise.resolve()),
        ),
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
