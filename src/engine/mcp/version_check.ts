import { parseVersionOutput } from "../../lib/version.ts";
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
 * (`DISCERN_VERSION`, baked into the running process) against the version of the
 * discern binary currently on disk, and on a mismatch append a hint telling the
 * agent to restart.
 *
 * Cheap by construction — statted, not spawned per call: the
 * running executable is stat-keyed on every call (one syscall) and `<binary>
 * --version` is spawned ONLY when that key changes — which, for the running
 * binary, is exactly the replace event we care about. The resolver is seeded at
 * construction with the running binary's own stat → `DISCERN_VERSION`, so the steady
 * state is one stat and zero spawns. It also stays silent (never a false alarm)
 * under `deno run`, where the executable is `deno`, not a discern binary: a
 * stable `deno` mtime never triggers a probe, and even if it did, `deno
 * --version` output fails the `discern <semver>` shape {@link parseDiscernVersion}
 * requires.
 */

import { DISCERN_VERSION } from "../../lib/version.ts";
import { colorResolvedEnv, stripAnsi } from "../../shared/color_env.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";

/**
 * Build the restart hint when the running server's version and the on-disk
 * binary's version disagree. `undefined` when they match, or when the installed
 * version could not be resolved (→ no hint; the check never invents an alarm).
 */
export function versionMismatchHint(
  serverVersion: string,
  installedVersion: string | undefined,
): FiredHint | undefined {
  if (installedVersion === undefined || installedVersion === serverVersion) {
    return undefined;
  }
  return fire(HINTS["mcp-version-mismatch"], {
    serverVersion,
    installedVersion,
  });
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
  /** The version compiled into THIS running server (defaults to `DISCERN_VERSION`). */
  serverVersion?: string;
  /** Absolute path to the running executable (defaults to `Deno.execPath()`). */
  execPath?: string;
  /** PATH-resolved discern command installed for provider calls, when available. */
  commandPath?: string;
  /** Stat a path to a cheap change-key (defaults to a real inode/mtime/size stat). */
  statKey?: StatKey;
  /** Resolve a binary's version by spawning it (defaults to `<path> --version`). */
  probeVersion?: ProbeVersion;
}

/**
 * Capture one command used by the installed-version handshake. The resolver
 * needs the provider process's ambient PATH, while the probe needs one exact
 * executable path; keeping both here leaves one registered spawn boundary.
 */
async function captureVersionCommand(
  binary: string,
  args: string[],
  options: { env?: Record<string, string>; stderr: "null" },
): Promise<Deno.CommandOutput> {
  return await new Deno.Command(binary, {
    args,
    stdout: "piped",
    ...options,
  }).output();
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
  const serverVersion = deps.serverVersion ?? DISCERN_VERSION;
  const execPath = deps.execPath ?? Deno.execPath();
  const commandPath = deps.commandPath;
  const probePath = commandPath ?? execPath;
  const watchedPaths = commandPath === undefined || commandPath === execPath
    ? [execPath]
    : [execPath, commandPath];
  const statKey = deps.statKey ?? defaultStatKey;
  const probeVersion = deps.probeVersion ?? defaultProbeVersion;

  const currentKey = (): string | undefined => {
    const keys = watchedPaths.map((path) => statKey(path));
    return keys.some((key) => key === undefined) ? undefined : keys.join("|");
  };
  let cachedKey = currentKey();
  let cachedVersion: string | undefined = serverVersion;

  return async (): Promise<string | undefined> => {
    const key = currentKey();
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
    cachedVersion = await probeVersion(probePath);
    return cachedVersion;
  };
}

/**
 * Resolve one executable through PATH with the same POSIX shell contract used by
 * discern's provider integrations. `undefined` keeps the resolver conservative:
 * it can still watch the running executable and never invents an installed copy.
 */
export async function resolveCommandPath(
  command: string,
): Promise<string | undefined> {
  try {
    const output = await captureVersionCommand(
      "sh",
      ["-c", 'command -v "$1"', "sh", command],
      {
        stderr: "null",
      },
    );
    if (!output.success) return undefined;
    const path = new TextDecoder().decode(output.stdout).trim();
    return path.startsWith("/") ? path : undefined;
  } catch {
    // discern-best-effort: mcp-version-command-path-fallback
    return undefined;
  }
}

/** Real stat-key: link identity + resolved target identity. A symlink retarget
 * changes the key even when both target files already existed with stable stats. */
function defaultStatKey(path: string): string | undefined {
  try {
    const link = Deno.lstatSync(path);
    const real = Deno.realPathSync(path);
    const target = Deno.statSync(real);
    return [
      link.ino ?? 0,
      link.mtime?.getTime() ?? 0,
      link.size,
      real,
      target.ino ?? 0,
      target.mtime?.getTime() ?? 0,
      target.size,
    ].join(":");
  } catch {
    // discern-best-effort: mcp-version-stat-fallback
    return undefined;
  }
}

/**
 * Extract the version from `discern --version` output. Requires discern's own
 * `discern <semver>` shape, so a different executable at the same path (e.g.
 * `deno` under `deno run`, whose `--version` starts `deno …`) never parses — the
 * discriminator that keeps the handshake silent outside a real install.
 */
export function parseDiscernVersion(raw: string): string | undefined {
  const clean = stripAnsi(raw).trim();
  return parseVersionOutput(clean);
}

/** Real probe: spawn `<execPath> --version` (colour off) and parse its output. */
async function defaultProbeVersion(
  execPath: string,
): Promise<string | undefined> {
  try {
    const output = await captureVersionCommand(
      execPath,
      ["--version"],
      { stderr: "null", env: colorResolvedEnv() },
    );
    if (!output.success) {
      return undefined;
    }
    return parseDiscernVersion(new TextDecoder().decode(output.stdout));
  } catch {
    // discern-best-effort: mcp-version-probe-fallback
    return undefined;
  }
}
