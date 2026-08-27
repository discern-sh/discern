/** Run the repository suite with runtime preflight and native Deno parallelism. */

import {
  preflightTestRuntime,
  testPreflightFailureMessage,
} from "./test_preflight.ts";
import { runOwnedChild } from "../src/engine/owned_child.ts";
import { fromFileUrl } from "@std/path";
import { resolveIdentity } from "../src/engine/worktree/identity.ts";

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

/** Parse one caller-supplied explicit shuffle seed, refusing bare randomness. */
export function explicitShuffleSeed(
  forwarded: readonly string[],
): number | undefined {
  const flags = forwarded.filter((arg) =>
    arg === "--shuffle" || arg.startsWith("--shuffle=")
  );
  if (flags.length === 0) return undefined;
  if (flags.length > 1) {
    throw new TypeError("Pass at most one explicit --shuffle=<seed> value.");
  }
  const flag = flags[0];
  if (flag === undefined || flag === "--shuffle") {
    throw new TypeError(
      "Bare --shuffle cannot be replayed; pass --shuffle=<seed>.",
    );
  }
  const raw = flag.slice("--shuffle=".length);
  const seed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(seed)) {
    throw new TypeError(
      `Invalid shuffle seed '${raw}'; use a non-negative integer.`,
    );
  }
  return seed;
}

/** The caller's explicit seed when present, otherwise checkout identity. */
export function effectiveTestSeed(
  identitySeed: number,
  forwarded: readonly string[],
): number {
  return explicitShuffleSeed(forwarded) ?? identitySeed;
}

/** One stable line every suite runner prints before Deno starts. */
export function testSeedAnnouncement(seed: number): string {
  return `Test shuffle seed: ${seed}`;
}

/** Resolve the current checkout's structured-state test seed. */
export async function testIdentitySeed(
  root: string = REPO_ROOT,
): Promise<number> {
  return (await resolveIdentity(root, root)).seed;
}

/** Build the internally parallel, explicitly shuffled Deno command. */
export function testCommandArgs(
  identitySeed: number,
  forwarded: readonly string[],
): string[] {
  const seed = effectiveTestSeed(identitySeed, forwarded);
  return [
    "test",
    "--allow-read",
    "--allow-write",
    "--allow-env",
    "--allow-run",
    "--allow-sys",
    "--parallel",
    `--shuffle=${seed}`,
    ...forwarded.filter((arg) =>
      arg !== "--shuffle" && !arg.startsWith("--shuffle=")
    ),
  ];
}

if (import.meta.main) {
  const preflight = preflightTestRuntime();
  if (!preflight.ok) {
    console.error(testPreflightFailureMessage(preflight));
    Deno.exit(1);
  }

  const identitySeed = await testIdentitySeed();
  console.error(
    testSeedAnnouncement(effectiveTestSeed(identitySeed, Deno.args)),
  );
  const child = await runOwnedChild(Deno.execPath(), {
    args: testCommandArgs(identitySeed, Deno.args),
  });
  Deno.exit(child.status.code);
}
