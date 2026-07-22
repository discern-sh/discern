/**
 * Version handshake for the long-lived MCP server.
 *
 * A client spawns the discern MCP server ONCE and keeps it for the whole
 * session. If the discern binary on disk is replaced later — the install script
 * re-run, then a `discern upgrade` that rewrites this project
 * to the new templates — the running server keeps executing the engine and
 * embedded templates it was compiled with. A stale `discern_refresh` from this
 * server and a fresh CLI `discern done` then rewrite the generated files back
 * and forth until the client restarts. Nothing else catches this drift; a
 * restart (so the client starts the server fresh from the new binary) is the fix.
 *
 * So on every tool call we compare the version THIS server was compiled with
 * (`KIT_VERSION`, baked into the running process) against the version of the
 * discern binary currently on disk, and on a mismatch append a hint telling the
 * agent to restart.
 *
 * Cheap by construction — statted, not spawned per call: the
 * running executable is stat-keyed on every call (one syscall) and `<binary>
 * --version` is spawned ONLY when that key changes — which, for the running
 * binary, is exactly the replace event we care about. The resolver is seeded at
 * construction with the running binary's own stat → `KIT_VERSION`, so the steady
 * state is one stat and zero spawns. It also stays silent (never a false alarm)
 * under `deno run`, where the executable is `deno`, not a discern binary: a
 * stable `deno` mtime never triggers a probe, and even if it did, `deno
 * --version` output fails the `discern <semver>` shape {@link parseDiscernVersion}
 * requires.
 */

import { KIT_VERSION } from "../../lib/version.ts";
import { fire, HINTS } from "../../shared/hints.ts";

/**
 * Build the restart hint when the running server's version and the on-disk
 * binary's version disagree. `undefined` when they match, or when the installed
 * version could not be resolved (→ no hint; the check never invents an alarm).
 */
export function versionMismatchHint(
  serverVersion: string,
  installedVersion: string | undefined,
): string | undefined {
  if (installedVersion === undefined || installedVersion === serverVersion) {
    return undefined;
  }
  return fire(HINTS["mcp-version-mismatch"], {
    serverVersion,
    installedVersion,
  }).text;
}

/** A cheap change-key for a file (inode + mtime + size), or `undefined` when the
 * path is unreadable. A replaced binary changes at least one component. */
export type StatKey = (path: string) => string | undefined;

/** Run `<execPath> --version` and return the parsed discern version, or
 * `undefined` when the spawn failed or the output was not discern-shaped. */
export type ProbeVersion = (execPath: string) => Promise<string | undefined>;

/**
 * Injectable seams for {@link createInstalledVersionResolver}. Every field
 * defaults to the real implementation; tests override them to drive the resolver
 * with stubbed versions and to count probes without spawning a real process.
 */
export interface InstalledVersionDeps {
  /** The version compiled into THIS running server (defaults to `KIT_VERSION`). */
  serverVersion?: string;
  /** Absolute path to the running executable (defaults to `Deno.execPath()`). */
  execPath?: string;
  /** Stat a path to a cheap change-key (defaults to a real inode/mtime/size stat). */
  statKey?: StatKey;
  /** Resolve a binary's version by spawning it (defaults to `<path> --version`). */
  probeVersion?: ProbeVersion;
}

/**
 * A resolver for "the version of the discern binary on disk right now". Returns
 * `undefined` when it cannot be determined reliably (unreadable binary, or a
 * non-discern executable at `execPath`), so the caller stays silent rather than
 * emitting a false mismatch.
 *
 * Seeded at construction with the running binary's stat → `serverVersion` (the
 * process running us IS that version, no spawn needed); it re-probes only when
 * the executable's stat-key changes — the replace event — and caches the result
 * against the new key.
 */
export function createInstalledVersionResolver(
  deps: InstalledVersionDeps = {},
): () => Promise<string | undefined> {
  const serverVersion = deps.serverVersion ?? KIT_VERSION;
  const execPath = deps.execPath ?? Deno.execPath();
  const statKey = deps.statKey ?? defaultStatKey;
  const probeVersion = deps.probeVersion ?? defaultProbeVersion;

  let cachedKey = statKey(execPath);
  let cachedVersion: string | undefined = serverVersion;

  return async (): Promise<string | undefined> => {
    const key = statKey(execPath);
    if (key === undefined) {
      // The binary vanished or is unreadable — can't compare, so don't guess.
      return undefined;
    }
    if (key === cachedKey) {
      return cachedVersion;
    }
    // The executable was replaced since we last looked: resolve the new version
    // once and remember it against the new key so later calls stay spawn-free.
    cachedKey = key;
    cachedVersion = await probeVersion(execPath);
    return cachedVersion;
  };
}

/** Real stat-key: inode/mtime/size, the components a file replace changes. */
function defaultStatKey(path: string): string | undefined {
  try {
    const info = Deno.statSync(path);
    return `${info.ino ?? 0}:${info.mtime?.getTime() ?? 0}:${info.size}`;
  } catch {
    return undefined;
  }
}

// A control character in a literal regex trips `no-control-regex`; build it from
// the escape code instead so the linter stays happy.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Extract the version from `discern --version` output. Requires discern's own
 * `discern <semver>` shape, so a different executable at the same path (e.g.
 * `deno` under `deno run`, whose `--version` starts `deno …`) never parses — the
 * discriminator that keeps the handshake silent outside a real install.
 */
export function parseDiscernVersion(raw: string): string | undefined {
  const clean = raw.replace(ANSI, "").trim();
  const match = clean.match(/^discern\s+(\d[\w.+-]*)/);
  return match?.[1];
}

/** Real probe: spawn `<execPath> --version` (colour off) and parse its output. */
async function defaultProbeVersion(
  execPath: string,
): Promise<string | undefined> {
  try {
    const output = await new Deno.Command(execPath, {
      args: ["--version"],
      stdout: "piped",
      stderr: "null",
      env: { NO_COLOR: "1" },
    }).output();
    if (!output.success) {
      return undefined;
    }
    return parseDiscernVersion(new TextDecoder().decode(output.stdout));
  } catch {
    return undefined;
  }
}
