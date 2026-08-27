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
 * install than the engine gating the tree. The shim is prepended to the child
 * PATH by the shell spawners in engine/jobs/command.ts,
 * engine/worktree/shell.ts, and shared/subprocess.ts (which also applies it
 * to the `commandExists` probe, so doctor's advisory verdict on a `discern …`
 * command agrees with what the runners will do).
 *
 * The shim lives inside the repository's Git administrative directory — the
 * registered worktree-scoped `selfShim` entry — under one content-addressed
 * subdirectory per engine identity (ADR 0249). The shim script's bytes fully
 * encode the identity, so their hash names the subdirectory: every process
 * of one engine converges on one path, distinct engines sharing a worktree
 * (the main checkout's MCP server operating here by path, and this
 * worktree's own CLI) each keep their own, and Git's worktree lifecycle
 * removes the whole home with the worktree. Creation is idempotent
 * (write-aside, then rename) and reuse verifies the bytes. This stays inside
 * discern's day-one footprint — the repository, its Git admin state, and OS
 * temp — and the admin directory is repo-owned, which is what makes the
 * deterministic name safe; a predictable path in a SHARED temp directory
 * would let another local user pre-plant it.
 *
 * A caller with no repository root at hand (a probe outside any repo, setup
 * before init) gets a randomly named per-process OS-temp directory via the
 * temp-artifact registry instead; the family's reaper drains whatever those
 * short-lived contexts leave behind.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { SYSTEM_CLOCK } from "./clock.ts";
import {
  type GitAdminPathRunner,
  resolveGitAdminStatePath,
} from "./git_admin_paths.ts";
import { sha256Hex } from "./sha256.ts";
import { makeTempArtifactDir } from "./temp_artifacts.ts";
import { fileExists, readTextIfExists } from "./fs_presence.ts";
import { bestEffort } from "./best_effort.ts";

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

/** The shim script for this engine. Its bytes ARE the engine identity. */
function shimContent(): string {
  return `#!/usr/bin/env sh\n${selfInvocation()}\n`;
}

/** Hex digits of SHA-256(`text`) naming an identity subdirectory. */
async function identityName(text: string): Promise<string> {
  return (await sha256Hex(text)).slice(0, 16);
}

/** Best-effort mtime refresh: the keep-alive the temp-artifact reaper honors
 * on a fallback shim. Harmless on a git-admin shim, which no reaper visits. */
async function touch(dir: string): Promise<void> {
  const now = new Date(SYSTEM_CLOCK.wallNow());
  await bestEffort("self-shim-keepalive-touch", async () => {
    await Deno.utime(dir, now, now);
  });
}

/** Write `content` beside `target` and rename it into place, executable. */
async function writeShimAside(target: string, content: string): Promise<void> {
  const suffix = Array.from(
    crypto.getRandomValues(new Uint8Array(8)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const aside = `${target}.${suffix}`;
  await Deno.writeTextFile(aside, content);
  if (Deno.build.os !== "windows") {
    await Deno.chmod(aside, 0o755);
  }
  try {
    await Deno.rename(aside, target);
  } catch (error) {
    await bestEffort("self-shim-aside-cleanup", async () => {
      await Deno.remove(aside);
    });
    // A concurrent process of the SAME identity renames identical bytes, so
    // losing that race (Windows refuses to replace an existing target) is
    // success — anything else propagates to the fallback path.
    if (await readTextIfExists(target) !== content) {
      throw error;
    }
  }
}

/** Mint or reuse the identity subdirectory for `content` under `home`. */
async function ensureShimAt(home: string, content: string): Promise<string> {
  const dir = join(home, await identityName(content));
  const shim = join(dir, "discern");
  if (await readTextIfExists(shim) === content) {
    return dir;
  }
  await Deno.mkdir(dir, { recursive: true });
  await writeShimAside(shim, content);
  return dir;
}

/** A per-process temp shim for callers with no repository root at hand. */
async function mintTempShim(content: string): Promise<string> {
  const dir = await makeTempArtifactDir("shim");
  await Deno.writeTextFile(join(dir, "discern"), content);
  if (Deno.build.os !== "windows") {
    await Deno.chmod(join(dir, "discern"), 0o755);
  }
  return dir;
}

/** Resolved shim dirs for this process, keyed by root ("" = rootless). */
const resolved = new Map<string, string>();

/**
 * The directory holding the `discern` shim for the repository around `root`,
 * resolved on first use and cached for the process's life. A long-lived
 * process (the MCP server) can outlive a cleaner, so a vanished shim is
 * re-resolved rather than trusted from the cache.
 */
export async function selfShimDir(
  root?: string,
  gitRunner?: GitAdminPathRunner,
): Promise<string> {
  const key = root ?? "";
  const cached = resolved.get(key);
  if (cached !== undefined && (await fileExists(join(cached, "discern")))) {
    await touch(cached);
    return cached;
  }
  const content = shimContent();
  if (root !== undefined) {
    if (gitRunner === undefined) {
      throw new Error(
        "repository-backed self-shim resolution requires an injected Git runner",
      );
    }
    const home = await resolveGitAdminStatePath(root, "selfShim", gitRunner);
    if (home !== undefined) {
      try {
        const dir = await ensureShimAt(home, content);
        resolved.set(key, dir);
        return dir;
      } catch {
        // discern-best-effort: self-shim-admin-store-fallback
        // An unusable admin directory must never block a spawn — a
        // per-process temp artifact dir serves instead.
      }
    }
  }
  const dir = await mintTempShim(content);
  resolved.set(key, dir);
  return dir;
}

/** PATH separator of the host platform. */
const PATH_DELIMITER = Deno.build.os === "windows" ? ";" : ":";

/**
 * The PATH for an operator-command child: the self-shim first, then `base`
 * (default: this process's PATH). Prepended — not appended — so `discern`
 * resolves to the running engine even when the base PATH carries another
 * install. `root` is any path inside the repository the command operates on;
 * omit it only when no repository is in play.
 */
export async function selfShimPath(
  root?: string,
  base: string = Deno.env.get("PATH") ?? "",
  gitRunner?: GitAdminPathRunner,
): Promise<string> {
  const dir = await selfShimDir(root, gitRunner);
  return base === "" ? dir : `${dir}${PATH_DELIMITER}${base}`;
}
