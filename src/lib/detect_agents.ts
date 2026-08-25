/**
 * Installed-agent detection for fresh setup, plus PATH launch detection for the
 * desk.
 *
 * A fresh install resolves its default `[project].agents` from what is actually
 * installed: which of the {@link PROVIDERS} have a terminal-agent binary, a
 * provider-declared editor command, or a conventional application path. This is
 * a **feature-layer** concern (which agents exist is agent-specific), so it lives
 * here, outside the stack-neutral engine.
 *
 * Setup uses detection once ({@link resolveDefaultAgents}) and persists the
 * resulting agent set into `discern.toml`. The desk reuses the lower-level binary
 * scan as live launch availability, but NEVER as a configuration fallback:
 * `resolveConfiguredAgents` remains a pure reader of committed config, so the
 * project agent set is fixed in the file rather than re-derived at runtime.
 *
 * Semantics are **match-any**, and setup's scan is **registry-driven**: it
 * iterates `AGENT_NAMES` × each provider's complete presence declaration, so a
 * future vendor or IDE marker auto-enrols with no edit here.
 */

import { join } from "@std/path";
import { bestEffortFs, pathExists } from "../shared/fs_presence.ts";
import { AGENT_NAMES, DEFAULT_AGENTS } from "../shared/config_schema.ts";
import type { EnvReader } from "../shared/env.ts";
import type { ConsentAgentSet } from "../shared/setup_messages.ts";
import type { AgentName } from "./config.ts";
import {
  type Provider,
  PROVIDERS,
  type SetupFilesystemMarker,
} from "./providers.ts";

/** One known provider resolved to the concrete executable name found on PATH. */
export interface DetectedAgentBinary {
  readonly name: AgentName;
  readonly binary: string;
}

/** The `PATH`-list delimiter for the host OS (`;` on Windows, `:` elsewhere). A
 * direct constant rather than a `@std/path` import, so the one place this matters
 * reads obviously. */
function pathListDelimiter(os: typeof Deno.build.os = Deno.build.os): string {
  return os === "windows" ? ";" : ":";
}

/**
 * The executable-name candidates to probe for one binary. On Windows a bare name
 * resolves through `PATHEXT`, so `claude` must also match `claude.cmd` /
 * `claude.exe`; on POSIX the name is used verbatim.
 */
function executableCandidates(
  binary: string,
  os: typeof Deno.build.os = Deno.build.os,
  pathExtensions: string = Deno.env.get("PATHEXT") ??
    ".COM;.EXE;.BAT;.CMD",
): string[] {
  if (os !== "windows") {
    return [binary];
  }
  const exts = pathExtensions
    .split(";").map((e) => e.trim()).filter((e) => e.length > 0);
  return [binary, ...exts.map((e) => `${binary}${e.toLowerCase()}`)];
}

/** Whether `binary` resolves to a runnable file in any of the `PATH` directories —
 * a regular file, and (on POSIX) carrying an executable bit when the mode is known.
 * A direct filesystem scan, not a shell-out to `which`, so it is portable and has
 * no subprocess cost. */
async function binaryOnPath(
  binary: string,
  pathDirs: readonly string[],
  os: typeof Deno.build.os = Deno.build.os,
  pathExtensions: string = Deno.env.get("PATHEXT") ??
    ".COM;.EXE;.BAT;.CMD",
): Promise<boolean> {
  for (const dir of pathDirs) {
    for (const candidate of executableCandidates(binary, os, pathExtensions)) {
      const info = await bestEffortFs(() => Deno.stat(join(dir, candidate)), {
        onFailure: undefined,
        reason:
          "Agent discovery may skip one missing or unreadable PATH candidate and continue searching.",
      });
      if (info === undefined || !info.isFile) {
        continue;
      }
      // On POSIX a PATH entry must be executable; mode can be null on some
      // platforms, in which case file existence is the best signal available.
      if (
        os !== "windows" && info.mode !== null &&
        (info.mode & 0o111) === 0
      ) continue;
      return true;
    }
  }
  return false;
}

/**
 * The known agents and concrete executable names present on `PATH` (match-any
 * over each provider's `binaries`), in `AGENT_NAMES` order. Empty when none is
 * detected. `env` defaults to the real process environment; a test injects a
 * fake reader so it never mutates the process (ADR 0068).
 */
export async function detectAgentBinariesOnPath(
  env: EnvReader = Deno.env,
): Promise<DetectedAgentBinary[]> {
  const pathDirs = (env.get("PATH") ?? "")
    .split(pathListDelimiter())
    .filter((d) => d.length > 0);
  const present: DetectedAgentBinary[] = [];
  const pathExtensions = env.get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  for (const name of AGENT_NAMES) {
    for (const binary of PROVIDERS[name].binaries) {
      if (
        await binaryOnPath(binary, pathDirs, Deno.build.os, pathExtensions)
      ) {
        present.push({ name, binary });
        break; // match-any — one present binary makes the agent present
      }
    }
  }
  return present;
}

/** Filesystem and platform boundary injected into setup installation detection. */
export interface SetupDetectionHost {
  readonly os: typeof Deno.build.os;
  pathExists(path: string): Promise<boolean>;
}

const REAL_SETUP_HOST: SetupDetectionHost = {
  os: Deno.build.os,
  pathExists,
};

/** Resolve one registry marker for this host, or `undefined` when its base is absent. */
function setupMarkerPath(
  marker: SetupFilesystemMarker,
  env: EnvReader,
): string | undefined {
  if (marker.path !== undefined) {
    return marker.path;
  }
  const base = env.get(marker.baseEnv);
  if (base === undefined || base === "") {
    return undefined;
  }
  const separator = marker.os === "windows" ? "\\" : "/";
  const trimmed = base.replace(/[\\/]+$/, "");
  const suffix = marker.segments.join(separator);
  return trimmed === ""
    ? `${separator}${suffix}`
    : `${trimmed}${separator}${suffix}`;
}

/**
 * Whether one provider is installed for fresh-setup purposes. Its terminal-agent
 * binaries, setup-only editor binaries, and filesystem markers form one match-any
 * declaration. Exported as the pure provider seam so the class guard can prove an
 * unrelated future IDE marker enrolls without a name switch.
 */
export async function providerInstalledForSetup(
  provider: Provider,
  env: EnvReader = Deno.env,
  host: SetupDetectionHost = REAL_SETUP_HOST,
): Promise<boolean> {
  const pathDirs = (env.get("PATH") ?? "")
    .split(pathListDelimiter(host.os))
    .filter((d) => d.length > 0);
  const pathBinaries = [
    ...provider.binaries,
    ...provider.setupPresence.additionalPathBinaries,
  ];
  const pathExtensions = env.get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  for (const binary of pathBinaries) {
    if (await binaryOnPath(binary, pathDirs, host.os, pathExtensions)) {
      return true;
    }
  }
  for (const marker of provider.setupPresence.filesystemMarkers) {
    if (marker.os !== host.os) {
      continue;
    }
    const path = setupMarkerPath(marker, env);
    if (path !== undefined && await host.pathExists(path)) {
      return true;
    }
  }
  return false;
}

/**
 * The native agents installed on this machine for fresh setup, in
 * {@link AGENT_NAMES} order. This is intentionally broader than
 * {@link detectAgentBinariesOnPath}: an IDE installation may be present without
 * the provider's separate terminal-agent executable.
 */
export async function detectInstalledAgents(
  env: EnvReader = Deno.env,
  host: SetupDetectionHost = REAL_SETUP_HOST,
): Promise<AgentName[]> {
  const present: AgentName[] = [];
  for (const name of AGENT_NAMES) {
    if (await providerInstalledForSetup(PROVIDERS[name], env, host)) {
      present.push(name);
    }
  }
  return present;
}

/**
 * The known agents whose binary is present on `PATH` (match-any over each
 * provider's `binaries`), in `AGENT_NAMES` order. This name-only API is a
 * projection of {@link detectAgentBinariesOnPath}; runtime launchers use the
 * lower-level result so they execute the binary that was actually detected.
 */
export async function detectAgentsOnPath(
  env: EnvReader = Deno.env,
): Promise<AgentName[]> {
  return (await detectAgentBinariesOnPath(env)).map(({ name }) => name);
}

/**
 * The default agent set for a fresh install: the {@link detectInstalledAgents}
 * result, or {@link DEFAULT_AGENTS} when none is detected. The single resolver
 * `discern setup` uses to seed `[project].agents` when the user named no agents
 * (no `--agents`, no `--config` agents). Persisted to config — never consulted at
 * runtime. Pass an already-scanned `detected` list to skip the rescan (the
 * detected-else-defaults rule still lives only here).
 */
export async function resolveDefaultAgents(
  env: EnvReader = Deno.env,
  detected?: AgentName[],
): Promise<AgentName[]> {
  const found = detected ?? await detectInstalledAgents(env);
  return found.length > 0 ? found : [...DEFAULT_AGENTS];
}

/**
 * The agent-set consent summary the setup handshake serves ({@link ConsentAgentSet}):
 * the set `begin` will wire — via {@link resolveDefaultAgents}, so the
 * detected-else-defaults rule stays in one place — as display labels plus the
 * registry names `--agents` accepts, alongside the raw detected list for the
 * preflight's structured findings. One installation scan covers both.
 */
export async function consentAgentSet(
  env: EnvReader = Deno.env,
): Promise<{ detected: AgentName[]; set: ConsentAgentSet }> {
  const detected = await detectInstalledAgents(env);
  const wired = await resolveDefaultAgents(env, detected);
  return {
    detected,
    set: {
      wired: wired.map((name) => ({ label: PROVIDERS[name].label, name })),
      detected: detected.length > 0,
    },
  };
}
