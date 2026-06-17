/**
 * Self-referential command vocabulary.
 *
 * The `icculus` binary lives in two worlds. As the installed **product** it is a
 * compiled binary on a user's PATH, scaffolding some external project. As the
 * kit **developing itself** (this repo) the very same upgrade logic is driven
 * through Deno tasks — `deno task selfsync` / `deno task selfcheck`.
 *
 * Any human-facing hint that tells the user to re-run the tool must name a
 * command that actually exists where they stand. `deno task selfsync` is noise
 * in an external project (no such task, maybe no Deno at all); `icculus upgrade`
 * is a footgun in this repo, where the compiled binary carries a frozen
 * `templates/` snapshot and would heal against the wrong source (see AGENTS.md).
 *
 * This module is the single place those alias strings live. Every command
 * renders self-references through {@link selfCmd}; the guard in
 * `tests/dev_vocab_guard_test.ts` fails the gate if `selfsync`/`selfcheck`
 * appear anywhere else under `src/`, so the choice cannot silently fork again.
 */

import { join } from "@std/path";

/** The upgrade-family commands that carry a self-host alias in this repo. */
export type SelfVerb = "sync" | "check";

/**
 * Render a self-referencing command in the vocabulary of the current
 * invocation. The marker is ground truth: a project whose `deno.json` declares
 * the `selfsync` task is the kit healing itself, so it gets the Deno-task form;
 * anything else is an ordinary install with only the `icculus` binary on PATH.
 */
export async function selfCmd(
  verb: SelfVerb,
  cwd: string = Deno.cwd(),
): Promise<string> {
  if (await drivesUpgradeViaDenoTask(cwd)) {
    return verb === "sync" ? "deno task selfsync" : "deno task selfcheck";
  }
  return verb === "sync" ? "icculus upgrade" : "icculus upgrade --check";
}

/**
 * True when `cwd` declares a `selfsync` Deno task — the marker that this project
 * drives the upgrade through `deno task` (the icculus self-host repo, or anyone
 * who wires the same alias). A missing, unreadable, or malformed `deno.json`
 * means an ordinary install: fail safe to the product vocabulary.
 */
async function drivesUpgradeViaDenoTask(cwd: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(join(cwd, "deno.json"));
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as { tasks?: Record<string, unknown> };
    return typeof parsed.tasks?.selfsync === "string";
  } catch {
    return false;
  }
}
