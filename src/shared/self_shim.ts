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
 * The shim lives at a deterministic, content-addressed path in the user's
 * cache directory: one directory per engine identity, shared by every process
 * of that engine (ADR 0249). The shim script's bytes fully encode the
 * identity, so their hash names the directory — processes of one engine
 * converge on one path, and distinct engines can never collide on one (a
 * collision would require identical bytes, which are the same shim).
 * Creation is idempotent (write-aside, then rename), reuse verifies the
 * bytes, and each use refreshes the directory's mtime so the stale-shim
 * prune only ever collects identities nothing has run for a TTL.
 *
 * The cache directory is user-private, so the deterministic name is safe
 * there; a predictable path in a SHARED temp directory would let another
 * local user pre-plant it. When no cache root resolves (no HOME in the
 * environment, or environment access denied), the shim falls back to a
 * randomly named OS-temp directory via the temp-artifact registry, whose
 * reaper drains whatever that family still holds.
 */

import { dirname, fromFileUrl, isAbsolute, join } from "@std/path";
import { makeTempArtifactDir, TEMP_ARTIFACT_TTL_MS } from "./temp_artifacts.ts";

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

/** Lowercase-hex SHA-256 of `text`. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * The user's cache root, per the XDG convention with a home-relative
 * fallback, or undefined when nothing usable resolves (then the caller uses
 * the OS-temp fallback). Environment access is tolerated to fail: an
 * embedder that denies env reads gets the fallback, never a throw.
 */
function cacheRoot(): string | undefined {
  try {
    const xdg = Deno.env.get("XDG_CACHE_HOME");
    if (xdg !== undefined && isAbsolute(xdg)) {
      return xdg;
    }
    const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
    if (home !== undefined && isAbsolute(home)) {
      return join(home, ".cache");
    }
  } catch {
    // Env permission denied — the shim falls back to a temp artifact dir.
  }
  return undefined;
}

/** The directory holding every cached shim identity, or undefined. */
export function shimCacheRoot(): string | undefined {
  const root = cacheRoot();
  return root === undefined ? undefined : join(root, "discern", "shims");
}

/** Identity directories a single prune pass will remove at most. */
const SHIM_PRUNE_MAX_REMOVALS = 50;

/**
 * Remove cached shim identities nothing has refreshed for the TTL. Runs when
 * a NEW identity is minted — engine churn (each worktree is its own identity)
 * is exactly what grows the population, so churn funds its own cleanup — and
 * from the retention tests. Bounded and best-effort throughout: shim hygiene
 * can never decide a spawn.
 */
export async function pruneStaleCachedShims(
  root: string,
  opts: { ttlMs?: number; now?: number; maxRemovals?: number } = {},
): Promise<number> {
  const ttlMs = opts.ttlMs ?? TEMP_ARTIFACT_TTL_MS;
  const now = opts.now ?? Date.now();
  const maxRemovals = opts.maxRemovals ?? SHIM_PRUNE_MAX_REMOVALS;
  let removed = 0;
  try {
    for await (const entry of Deno.readDir(root)) {
      if (removed >= maxRemovals) {
        break;
      }
      if (!entry.isDirectory) {
        continue;
      }
      const path = join(root, entry.name);
      try {
        const mtime = (await Deno.stat(path)).mtime?.getTime();
        if (mtime === undefined || now - mtime < ttlMs) {
          continue; // in use, or an unreadable age — keep (fail-safe)
        }
        await Deno.remove(path, { recursive: true });
        removed++;
      } catch {
        // Raced away by a concurrent engine, or unreadable — skip it.
      }
    }
  } catch {
    // No cache root yet, or unreadable — nothing to prune.
  }
  return removed;
}

/** Best-effort mtime refresh: the keep-alive the stale-shim prune honors. */
async function touch(dir: string): Promise<void> {
  const now = new Date();
  await Deno.utime(dir, now, now).catch(() => {
    // Keep-alive is hygiene; a raced or unwritable touch never blocks a spawn.
  });
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
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
    await Deno.remove(aside).catch(() => undefined);
    // A concurrent process of the SAME identity renames identical bytes, so
    // losing that race (Windows refuses to replace an existing target) is
    // success — anything else propagates to the fallback path.
    if (await Deno.readTextFile(target).catch(() => undefined) !== content) {
      throw error;
    }
  }
}

/**
 * Mint the deterministic cache-dir shim for this engine, pruning stale
 * sibling identities while a new one is being created. Throws when the cache
 * is unusable; the caller falls back to a temp artifact dir.
 */
async function ensureCachedShim(
  root: string,
  content: string,
): Promise<string> {
  const dir = join(root, await sha256Hex(content));
  const shim = join(dir, "discern");
  if (await Deno.readTextFile(shim).catch(() => undefined) === content) {
    await touch(dir);
    return dir;
  }
  await Deno.mkdir(dir, { recursive: true });
  await writeShimAside(shim, content);
  await pruneStaleCachedShims(root);
  return dir;
}

let shimDir: string | undefined;

/**
 * The directory holding the `discern` shim, resolved on first use and cached
 * for the process's life. A long-lived process (the MCP server) can outlive
 * a cache or temp cleaner, so a vanished shim is re-resolved rather than
 * trusted from the cache; each use refreshes the directory's mtime so the
 * prune only ever collects shims whose engine is gone.
 */
export async function selfShimDir(): Promise<string> {
  if (shimDir !== undefined && (await isFile(join(shimDir, "discern")))) {
    await touch(shimDir);
    return shimDir;
  }
  const content = shimContent();
  const root = shimCacheRoot();
  if (root !== undefined) {
    try {
      shimDir = await ensureCachedShim(root, content);
      return shimDir;
    } catch {
      // An unusable cache (read-only home, exotic rename failure) must never
      // block a spawn — a per-process temp artifact dir serves instead.
    }
  }
  const dir = await makeTempArtifactDir("shim");
  await Deno.writeTextFile(join(dir, "discern"), content);
  if (Deno.build.os !== "windows") {
    await Deno.chmod(join(dir, "discern"), 0o755);
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
