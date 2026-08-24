import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Logger } from "../src/lib/log.ts";
import { runShellRouted } from "../src/engine/worktree/shell.ts";
import { pinnedTerminal, withTempDir } from "./helpers.ts";

const DRIVER = fromFileUrl(
  new URL("fixtures/owned_child_driver.ts", import.meta.url),
);

interface DriverResult {
  readonly interruptedBy: Deno.Signal | null;
  readonly code: number;
  readonly signal: Deno.Signal | null;
  readonly success: boolean;
}

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
  return JSON.parse(new TextDecoder().decode(output.stdout));
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
    const started = performance.now();
    const result = await runDriver("SIGTERM", true);

    assertEquals(result.interruptedBy, "SIGTERM");
    assertEquals(result.signal, "SIGKILL");
    assertEquals(result.code, 137);
    assert(
      performance.now() - started >= 2_000,
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
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      const observed = await Deno.lstat(late).catch((error) => {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
      });
      assertEquals(
        observed,
        undefined,
        "a setup command returned while its process group could still write",
      );
    }, { prefix: "discern-shell-quiesce-" });
  },
});
