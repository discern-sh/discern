/** A shell file hold ends with its file, its directory, or its owner. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { shellAwaitFile, whileHeld } from "./shell_hold.ts";
import { withTempDir } from "./temp_dir.ts";
import {
  settlePending,
  TEST_PROCESS_TIMEOUT_MS,
  waitForPath,
  waitForPendingCondition,
} from "./waiting.ts";

const UNIX = Deno.build.os !== "windows";

/** Start `sh -c` on `script`, with `ready` and `release` as `$1` and `$2`. */
function spawnHold(
  script: string,
  ready: string,
  release: string,
  cwd?: string,
): Deno.ChildProcess {
  return new Deno.Command("sh", {
    args: ["-c", script, "sh", ready, release],
    ...(cwd === undefined ? {} : { cwd }),
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).spawn();
}

/** The exit code of a hold, within the load-safe process budget. */
async function holdExit(child: Deno.ChildProcess): Promise<number> {
  return (await settlePending(child.status, "the hold to exit", {
    timeoutMs: TEST_PROCESS_TIMEOUT_MS,
  })).code;
}

Deno.test({
  name: "a file hold passes once its file appears",
  ignore: !UNIX,
  fn: async () => {
    await withTempDir(async (dir) => {
      const ready = join(dir, "ready");
      const release = join(dir, "release");
      const child = spawnHold(
        `: > "$1"; ${shellAwaitFile('"$2"')}; printf passed`,
        ready,
        release,
      );
      const output = child.output();
      await waitForPendingCondition(
        output,
        () => targetExists(ready),
        "the hold to start",
      );
      await Deno.writeTextFile(release, "");
      const result = await output;
      assertEquals(result.code, 0);
      assertEquals(new TextDecoder().decode(result.stdout), "passed");
    });
  },
});

Deno.test({
  name: "a file hold ends once its directory is removed",
  ignore: !UNIX,
  fn: async (t) => {
    const cases = [
      {
        name: "an absolute path, never released",
        script: shellAwaitFile('"$2"'),
        relative: false,
        empty: false,
      },
      {
        name: "a relative name in a removed working directory",
        script: shellAwaitFile("release"),
        relative: true,
        empty: false,
      },
      {
        name: "an empty file while it waits for content",
        script: shellAwaitFile('"$2"', { nonEmpty: true }),
        relative: false,
        empty: true,
      },
    ] as const;
    for (const scenario of cases) {
      await t.step(scenario.name, async () => {
        await withTempDir(async (dir) => {
          const signals = join(dir, "signals");
          await Deno.mkdir(signals);
          const ready = join(dir, "ready");
          const release = join(signals, "release");
          if (scenario.empty) await Deno.writeTextFile(release, "");
          const child = spawnHold(
            `: > "$1"; ${scenario.script}; printf passed`,
            ready,
            release,
            scenario.relative ? signals : undefined,
          );
          await waitForPendingCondition(
            child.status,
            () => targetExists(ready),
            "the hold to start",
          );
          await Deno.remove(signals, { recursive: true });
          assertEquals(await holdExit(child), 1);
          assertEquals(
            (await child.stdout.text()).length,
            0,
            "nothing after an abandoned hold runs",
          );
        });
      });
    }
  },
});

Deno.test({
  name: "a file hold ends once its owner exits, even after its parent is gone",
  ignore: !UNIX,
  fn: async () => {
    await withTempDir(async (dir) => {
      const ready = join(dir, "ready");
      const release = join(dir, "release");
      const owner = new Deno.Command("cat", {
        stdin: "piped",
        stdout: "null",
        stderr: "null",
      }).spawn();
      const hold = shellAwaitFile('"$2"', { owner: owner.pid });
      // The parent backgrounds the hold and exits, so the hold is reparented.
      // Its inherited stdout stays open until the hold itself exits.
      const parent = spawnHold(
        `( : > "$1"; (${hold}); printf "hold:%s" "$?" ) & exit 0`,
        ready,
        release,
      );
      assertEquals(await holdExit(parent), 0);
      await waitForPath(ready);
      await owner.stdin.close();
      assertEquals((await owner.status).code, 0);
      const orphaned = await settlePending(
        parent.stdout.text(),
        "the orphaned hold to exit",
        { timeoutMs: TEST_PROCESS_TIMEOUT_MS },
      );
      assertEquals(orphaned, "hold:1");
      assertEquals(await targetExists(release), false);
      assertEquals(await targetExists(dir), true);
    });
  },
});

Deno.test({
  name: "whileHeld releases and settles the held child before a failure",
  ignore: !UNIX,
  fn: async () => {
    await withTempDir(async (dir) => {
      const ready = join(dir, "ready");
      const release = join(dir, "release");
      const child = spawnHold(
        `: > "$1"; ${shellAwaitFile('"$2"')}`,
        ready,
        release,
      );
      let reaped = false;
      const held = child.status.then((status) => {
        reaped = true;
        return status.code;
      });
      await assertRejects(
        () =>
          whileHeld(held, release, async () => {
            await waitForPendingCondition(
              held,
              () => targetExists(ready),
              "the hold to start",
            );
            throw new Error("the observation failed");
          }),
        Error,
        "the observation failed",
      );
      assert(reaped, "a failing observation skipped the reap");
      assertEquals(await held, 0, "the hold was released, not abandoned");
      assertEquals(await child.stdout.text(), "");
    });
  },
});

Deno.test("whileHeld returns the held outcome, and a failure in during outranks it", async () => {
  await withTempDir(async (dir) => {
    const release = join(dir, "release");
    const tick = (): Promise<void> => Promise.resolve();
    assertEquals(await whileHeld(Promise.resolve(7), release, tick), 7);
    assertEquals(await targetExists(release), true);
    await Deno.remove(release);
    // The held rejection is observed before during runs, so it is never
    // reported as unhandled while during is still awaiting.
    await assertRejects(
      () => whileHeld(Promise.reject(new Error("held failed")), release, tick),
      Error,
      "held failed",
    );
    assertEquals(await targetExists(release), true);
    await assertRejects(
      () =>
        whileHeld(
          Promise.reject(new Error("held failed")),
          release,
          () => Promise.reject(new Error("during failed")),
        ),
      Error,
      "during failed",
    );
  });
});
