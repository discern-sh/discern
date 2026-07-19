import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const DRIVER = fromFileUrl(
  new URL("fixtures/owned_child_driver.ts", import.meta.url),
);

interface DriverResult {
  readonly interruptedBy: Deno.Signal | null;
  readonly code: number;
  readonly signal: Deno.Signal | null;
  readonly success: boolean;
}

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
