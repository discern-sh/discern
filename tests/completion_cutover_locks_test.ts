/** Native checkout exclusion stays held while unrelated common publication can proceed. */
import { currentOperationLocks } from "../src/shared/operation_lock_context.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { fromFileUrl, join } from "@std/path";
import { exists } from "@std/fs";
import { waitForPendingCondition } from "./waiting.ts";
import { addWorktree, gitInit, repoSourceRunArgs } from "./engine_helpers.ts";
import {
  OperationLockError,
  withCompletionCheckout,
  withCompletionPublication,
  withOperationLock,
  withSetupProbeCheckout,
} from "../src/engine/operation_lock.ts";

Deno.test("completion execution allows short publication and excludes competing checkout writers", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/seed`, "seed\n");
    await gitInit(root);
    const checkout = await addWorktree(root, "execution-race");
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    let published = 0;
    const execution = withCompletionCheckout(checkout, async () => {
      await withCompletionPublication(checkout, () => {
        published++;
        return Promise.resolve();
      });
      entered.resolve();
      await finish.promise;
      await withCompletionPublication(checkout, () => {
        published++;
        return Promise.resolve();
      });
    });
    await entered.promise;
    try {
      await withCompletionPublication(root, () => {
        published++;
        return Promise.resolve();
      });
      await assertRejects(
        () =>
          withOperationLock(
            checkout,
            { command: "refresh" },
            () => Promise.resolve(),
          ),
        OperationLockError,
      );
      await assertRejects(
        () => withCompletionCheckout(checkout, () => Promise.resolve()),
        OperationLockError,
      );
      assertEquals(published, 2);
    } finally {
      finish.resolve();
      await execution;
    }
    assertEquals(published, 3);
    await withOperationLock(
      checkout,
      { command: "refresh" },
      () => Promise.resolve(),
    );
  });
});

Deno.test("completion publication excludes another publisher and ordinary inversion remains refused", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/seed`, "seed\n");
    await gitInit(root);
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const order: string[] = [];
    const publication = withCompletionPublication(root, async () => {
      order.push("first entered");
      entered.resolve();
      await finish.promise;
      order.push("first exited");
    });
    await entered.promise;
    const next = withCompletionPublication(root, async () => {
      order.push("second entered");
      await withCompletionPublication(root, () => Promise.resolve());
    });
    finish.resolve();
    await Promise.all([publication, next]);
    assertEquals(order, ["first entered", "first exited", "second entered"]);
    await withOperationLock(root, { command: "refresh" }, async () => {
      await assertRejects(
        () => withCompletionPublication(root, () => Promise.resolve()),
        OperationLockError,
      );
    });
    await assertRejects(
      () =>
        withCompletionCheckout(
          root,
          () => Promise.reject(new Error("controlled failure")),
        ),
      Error,
      "controlled failure",
    );
    await withOperationLock(
      root,
      { command: "refresh" },
      () => Promise.resolve(),
    );
  });
});

Deno.test("canonical and symlink checkout paths share the same live exclusion", async () => {
  await withTempDir(async (root) => {
    const real = `${root}/real`;
    const alias = `${root}/alias`;
    await Deno.mkdir(real);
    await Deno.writeTextFile(`${real}/seed`, "seed\n");
    await gitInit(real);
    await Deno.symlink(real, alias);
    await withCompletionCheckout(alias, async () => {
      await withCompletionPublication(
        real,
        () => withCompletionCheckout(real, () => Promise.resolve()),
      );
    });
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const holder = withCompletionCheckout(alias, async () => {
      entered.resolve();
      await finish.promise;
    });
    await entered.promise;
    try {
      await assertRejects(
        () => withCompletionCheckout(real, () => Promise.resolve()),
        OperationLockError,
      );
    } finally {
      finish.resolve();
      await holder;
    }
  });
});

Deno.test("setup probes require the exact parent transaction and keep both checkouts excluded", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/seed`, "seed\n");
    await gitInit(root);
    const probe = await addWorktree(root, "setup-probe");
    await assertRejects(
      () => withSetupProbeCheckout(root, probe, () => Promise.resolve()),
      OperationLockError,
    );
    const release = Promise.withResolvers<void>();
    let ready = false;
    const running = withOperationLock(
      root,
      { command: "setup done" },
      async () => {
        await assertRejects(
          () => withCompletionCheckout(probe, () => Promise.resolve()),
          OperationLockError,
        );
        await assertRejects(
          () => withSetupProbeCheckout(root, root, () => Promise.resolve()),
          OperationLockError,
        );
        await withSetupProbeCheckout(root, probe, async () => {
          await withCompletionCheckout(probe, () => Promise.resolve());
          await withCompletionCheckout(root, () => Promise.resolve());
          assertEquals(
            currentOperationLocks()?.boundaries.has("common"),
            false,
          );
          ready = true;
          await release.promise;
        });
      },
    );
    try {
      await waitForPendingCondition(
        running,
        () => ready,
        "setup probe to own both checkouts",
      );
      for (const checkout of [root, probe]) {
        await assertRejects(
          () => withCompletionCheckout(checkout, () => Promise.resolve()),
          OperationLockError,
        );
      }
    } finally {
      release.resolve();
      await running;
    }
  });
});

Deno.test("separate completion publishers wait before effects and execute once after exclusion", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/seed`, "seed\n");
    await gitInit(root);
    const waiting = join(root, "waiting");
    const published = join(root, "published");
    const driver = fromFileUrl(
      new URL("fixtures/completion_publication_wait.ts", import.meta.url),
    );
    let output: Promise<Deno.CommandOutput> | undefined;
    let child: Deno.ChildProcess | undefined;
    try {
      await withCompletionPublication(root, async () => {
        child = new Deno.Command(Deno.execPath(), {
          args: repoSourceRunArgs(driver, [root, waiting, published]),
          cwd: root,
          stdout: "piped",
          stderr: "piped",
        }).spawn();
        output = child.output();
        await waitForPendingCondition(
          output,
          () => exists(waiting),
          "a separate publisher to observe the held boundary",
        );
        assertEquals(await exists(published), false);
      });
      const result = await output;
      assertEquals(
        result?.code,
        0,
        result === undefined
          ? "missing child"
          : new TextDecoder().decode(result.stderr),
      );
      assertEquals(await Deno.readTextFile(published), "published");
    } finally {
      try {
        child?.kill("SIGKILL");
      } catch { /* Already exited. */ }
      await output;
    }
  });
});
