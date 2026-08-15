/** The suite proves its loopback prerequisite before any expensive test starts. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  preflightTestRuntime,
  testPreflightFailureMessage,
} from "../scripts/test_preflight.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const DECODER = new TextDecoder();

Deno.test("test preflight exercises and closes a temporary listener", () => {
  let opened = 0;
  let closed = 0;
  const result = preflightTestRuntime(() => {
    opened++;
    return { close: () => closed++ };
  });

  assertEquals(result, { ok: true });
  assertEquals(opened, 1);
  assertEquals(closed, 1);
});

Deno.test("test preflight reports any future loopback denial without vendor assumptions", () => {
  const result = preflightTestRuntime(() => {
    throw new Deno.errors.PermissionDenied("future sandbox refused this bind");
  });

  assert(!result.ok);
  const message = testPreflightFailureMessage(result);
  assertStringIncludes(message, "127.0.0.1");
  assertStringIncludes(message, "future sandbox refused this bind");
  assertStringIncludes(
    message,
    "permission to bind loopback network listeners",
  );
  assertStringIncludes(message, "No tests were started");
});

Deno.test("test preflight CLI refuses immediately when Deno denies network access", async () => {
  const output = await new Deno.Command("deno", {
    args: ["run", join(REPO_ROOT, "scripts", "test_preflight.ts")],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();

  assertEquals(output.code, 1);
  assertEquals(DECODER.decode(output.stdout), "");
  const stderr = DECODER.decode(output.stderr);
  assertStringIncludes(stderr, "cannot bind a temporary 127.0.0.1 listener");
  assertStringIncludes(stderr, 'Requires net access to "127.0.0.1:0"');
  assertStringIncludes(stderr, "No tests were started");
});
