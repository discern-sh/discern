import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Logger } from "../src/lib/log.ts";
import { runShellRouted } from "../src/engine/worktree/shell.ts";
import { pinnedTerminal, withTempDir } from "./helpers.ts";
import { lstatIfExists } from "../src/shared/fs_presence.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import { realDelay, waitForPendingCondition } from "./waiting.ts";

const DRIVER = fromFileUrl(
  new URL("fixtures/owned_child_driver.ts", import.meta.url),
);

interface DriverResult {
  readonly interruptedBy: Deno.Signal | null;
  readonly code: number;
  readonly signal: Deno.Signal | null;
  readonly success: boolean;
}

const DRIVER_RESULT_SCHEMA = z.object({
  interruptedBy: z.enum(["SIGINT", "SIGTERM"]).nullable(),
  code: z.number().int(),
  signal: z.enum(["SIGINT", "SIGTERM", "SIGKILL"]).nullable(),
  success: z.boolean(),
});

/** Exercise owned-child signal forwarding in a subprocess and decode its structured observations. */
async function runDriver(
  signal: "SIGINT" | "SIGTERM",
  ignore = false,
): Promise<DriverResult> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-run",
      DRIVER,
      signal,
      ...(ignore ? ["ignore"] : []),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(
    output.success,
    new TextDecoder().decode(output.stderr),
  );
  return decodeWith(
    DRIVER_RESULT_SCHEMA,
    new TextDecoder().decode(output.stdout),
  );
}

Deno.test("an owning interactive surface resumes after its child is interrupted", async () => {
  const result = await runDriver("SIGINT");

  assertEquals(result.interruptedBy, "SIGINT");
  assert(!result.success);
  assertEquals(result.signal, "SIGINT");
  assertEquals(result.code, 130);
});

Deno.test({
  name: "an owned child that ignores shutdown is killed after the grace period",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const started = SYSTEM_CLOCK.monotonicNow();
    const result = await runDriver("SIGTERM", true);

    assertEquals(result.interruptedBy, "SIGTERM");
    assertEquals(result.signal, "SIGKILL");
    assertEquals(result.code, 137);
    assert(
      SYSTEM_CLOCK.monotonicNow() - started >= 2_000,
      "the child must receive the graceful signal before SIGKILL",
    );
  },
});

Deno.test({
  name:
    "a routed setup command quiesces background descendants before returning",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      const late = join(dir, "late");
      const ready = join(dir, "ready");
      const release = join(dir, "release");
      const code = await runShellRouted(
        '(touch "$READY_TARGET"; while [ ! -f "$RELEASE_TARGET" ]; do sleep 0.01; done; mkdir -p "$LATE_TARGET") >/dev/null 2>&1 & while [ ! -f "$READY_TARGET" ]; do sleep 0.01; done',
        {
          cwd: dir,
          env: {
            LATE_TARGET: late,
            READY_TARGET: ready,
            RELEASE_TARGET: release,
          },
          log: new Logger({
            json: false,
            noColor: true,
            terminal: pinnedTerminal(),
          }),
        },
      );
      assertEquals(code, 0);
      await Deno.writeTextFile(release, "");
      await realDelay("routed-command-quiescence-window", 350);
      const observed = await lstatIfExists(late);
      assertEquals(
        observed,
        undefined,
        "a setup command returned while its process group could still write",
      );
    }, { prefix: "discern-shell-quiesce-" });
  },
});

Deno.test("request cancellation stops a routed command without killing its owning server", async () => {
  await withTempDir(async (dir) => {
    const controller = new AbortController();
    const ready = join(dir, "ready");
    const late = join(dir, "late");
    const command = runShellRouted(
      'touch "$READY_TARGET"; tail -f /dev/null; touch "$LATE_TARGET"',
      {
        cwd: dir,
        env: { READY_TARGET: ready, LATE_TARGET: late },
        log: new Logger({ json: true, noColor: true }),
        signal: controller.signal,
      },
    );
    try {
      await waitForPendingCondition(
        command,
        async () => await lstatIfExists(ready) !== undefined,
        "routed command to start",
      );
    } finally {
      controller.abort();
      assert(
        (await command) !== 0,
        "a cancelled command cannot supply success",
      );
    }
    assertEquals(await lstatIfExists(late), undefined);
    assertEquals(
      await runShellRouted("exit 0", {
        cwd: dir,
        log: new Logger({ json: true, noColor: true }),
      }),
      0,
    );
  });
});
