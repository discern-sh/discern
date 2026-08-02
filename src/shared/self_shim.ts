/**
 * Self-resolution for `discern` inside operator commands.
 *
 * Every operator-supplied command the engine spawns — a gate job, a worktree
 * lifecycle command, a command-existence probe — runs with a PATH that
 * resolves `discern` to the engine that spawned it: a compiled binary
 * re-executes itself; a from-source run re-invokes its own checkout's
 * entrypoint. A self-invocation like the seeded `format = "discern tidy"`
 * therefore never depends on the ambient PATH — which holds no discern at all
 * under CI running the engine from source, or under an MCP server spawned
 * with a stripped environment — and can never silently run a DIFFERENT
 * install than the engine gating the tree.
 *
 * The mechanism is a lazily created OS-temp directory — a registered artifact
 * family (temp_artifacts.ts), reaped only once abandoned — holding one
 * executable `discern` shim script, prepended to the child PATH by the shell
 * spawners in engine/jobs/command.ts, engine/worktree/shell.ts, and
 * shared/subprocess.ts (which also applies it to the `commandExists` probe,
 * so doctor's advisory verdict on a `discern …` command agrees with what the
 * runners will do).
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { makeTempArtifactDir } from "./temp_artifacts.ts";

/** Single-quote `value` for literal embedding in the shim script. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The `exec` line that re-invokes the running engine. A compiled binary is
 * its own executable. A from-source run re-invokes this checkout's
 * `src/main.ts` via the absolute deno path — absolute so the shim still works
 * under a scrubbed PATH — pinned to THIS checkout rather than re-discovered,
 * because the engine's identity is already fixed: a worktree's gate must run
 * that worktree's engine.
 */
function selfInvocation(): string {
  if (Deno.build.standalone) {
    return `exec ${shellQuote(Deno.execPath())} "$@"`;
  }
  const repoRoot = dirname(dirname(dirname(fromFileUrl(import.meta.url))));
  return `exec ${shellQuote(Deno.execPath())} run --no-check --config ${
    shellQuote(join(repoRoot, "deno.json"))
  } -A ${shellQuote(join(repoRoot, "src", "main.ts"))} "$@"`;
}

/** Return whether the value is file. */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

let shimDir: string | undefined;

/**
 * The directory holding the `discern` shim, created on first use and cached
 * for the process's life. Each use refreshes the directory's mtime so the
 * artifact reaper only ever collects shims whose engine is gone; and a
 * long-lived process (the MCP server) can still outlive a system temp-dir
 * cleaner, so a vanished shim is recreated rather than trusted from the
 * cache. A concurrent first call may create a sibling dir, which is merely
 * unshared, not wrong.
 */
export async function selfShimDir(): Promise<string> {
  if (shimDir !== undefined && (await isFile(join(shimDir, "discern")))) {
    const now = new Date();
    await Deno.utime(shimDir, now, now).catch(() => {
      // Keep-alive is hygiene; a raced or unwritable touch never blocks a spawn.
    });
    return shimDir;
  }
  const dir = await makeTempArtifactDir("shim");
  const shim = join(dir, "discern");
  await Deno.writeTextFile(shim, `#!/usr/bin/env sh\n${selfInvocation()}\n`);
  if (Deno.build.os !== "windows") {
    await Deno.chmod(shim, 0o755);
  }
  shimDir = dir;
  return dir;
}

/** PATH separator of the host platform. */
const PATH_DELIMITER = Deno.build.os === "windows" ? ";" : ":";

/**
 * The PATH for an operator-command child: the self-shim first, then `base`
 * (default: this process's PATH). Prepended — not appended — so `discern`
 * resolves to the running engine even when the base PATH carries another
 * install.
 */
export async function selfShimPath(base?: string): Promise<string> {
  const dir = await selfShimDir();
  const rest = base ?? Deno.env.get("PATH") ?? "";
  return rest === "" ? dir : `${dir}${PATH_DELIMITER}${rest}`;
}
