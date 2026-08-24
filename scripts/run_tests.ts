/** Run the repository suite with runtime preflight and native Deno parallelism. */

import {
  preflightTestRuntime,
  testPreflightFailureMessage,
} from "./test_preflight.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";

/** Build the internally parallel Deno command while preserving caller arguments. */
export function testCommandArgs(forwarded: readonly string[]): string[] {
  return [
    "test",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    "--allow-sys",
    "--parallel",
    ...forwarded,
  ];
}

if (import.meta.main) {
  const preflight = preflightTestRuntime();
  if (!preflight.ok) {
    console.error(testPreflightFailureMessage(preflight));
    Deno.exit(1);
  }

  const child = await runOwnedChild(Deno.execPath(), {
    args: testCommandArgs(Deno.args),
  });
  Deno.exit(child.status.code);
}
