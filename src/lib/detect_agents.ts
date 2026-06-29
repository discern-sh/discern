/**
 * PATH auto-detection of the coding agents discern knows.
 *
 * A fresh install resolves its default `[guidance].agents` from what is actually
 * installed: which of the {@link PROVIDERS} have a binary on `PATH`. This is a
 * **feature-layer** concern (which agents exist is agent-specific), so it lives
 * here, not in the stack-neutral engine.
 *
 * Detection runs **once, at setup** ({@link resolveDefaultAgents}, wired into
 * `discern setup`) and is persisted into `discern.toml`. It is NEVER a runtime
 * fallback — `resolveConfiguredAgents` stays a pure reader of committed config, so
 * the agent set a project compiles against is fixed in the file, not re-derived
 * from whatever happens to be on PATH at gate time.
 *
 * Semantics are **match-any** (a provider is present when ANY of its `binaries`
 * resolves), and the scan is **registry-driven**: it iterates `AGENT_NAMES` × each
 * provider's `binaries`, so a future vendor added to the registry auto-enrols in
 * detection with no edit here.
 */

import { join } from "@std/path";
import { AGENT_NAMES, DEFAULT_AGENTS } from "../shared/config_schema.ts";
import type { EnvReader } from "../shared/env.ts";
import type { AgentName } from "./config.ts";
import { PROVIDERS } from "./providers.ts";

/** The `PATH`-list delimiter for the host OS (`;` on Windows, `:` elsewhere). A
 * direct constant rather than a `@std/path` import, so the one place this matters
 * reads obviously. */
function pathListDelimiter(): string {
  return Deno.build.os === "windows" ? ";" : ":";
}

/**
 * The executable-name candidates to probe for one binary. On Windows a bare name
 * resolves through `PATHEXT`, so `claude` must also match `claude.cmd` /
 * `claude.exe`; on POSIX the name is used verbatim.
 */
function executableCandidates(binary: string): string[] {
  if (Deno.build.os !== "windows") {
    return [binary];
  }
  const exts = (Deno.env.get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
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
): Promise<boolean> {
  for (const dir of pathDirs) {
    for (const candidate of executableCandidates(binary)) {
      try {
        const info = await Deno.stat(join(dir, candidate));
        if (!info.isFile) {
          continue;
        }
        // On POSIX a PATH entry must be executable; mode can be null on some
        // platforms, in which case file existence is the best signal available.
        if (
          Deno.build.os !== "windows" && info.mode !== null &&
          (info.mode & 0o111) === 0
        ) {
          continue;
        }
        return true;
      } catch {
        // Not found / unreadable at this candidate — try the next.
      }
    }
  }
  return false;
}

/**
 * The known agents whose binary is present on `PATH` (match-any over each
 * provider's `binaries`), in `AGENT_NAMES` order. Empty when none is detected.
 * `env` defaults to the real process environment; a test injects a fake reader so
 * it never mutates the process (ADR 0068).
 */
export async function detectAgentsOnPath(
  env: EnvReader = Deno.env,
): Promise<AgentName[]> {
  const pathDirs = (env.get("PATH") ?? "")
    .split(pathListDelimiter())
    .filter((d) => d.length > 0);
  const present: AgentName[] = [];
  for (const name of AGENT_NAMES) {
    for (const binary of PROVIDERS[name].binaries) {
      if (await binaryOnPath(binary, pathDirs)) {
        present.push(name);
        break; // match-any — one present binary makes the agent present
      }
    }
  }
  return present;
}

/**
 * The default agent set for a fresh install: the {@link detectAgentsOnPath}
 * result, or {@link DEFAULT_AGENTS} when none is detected. The single resolver
 * `discern setup` uses to seed `[guidance].agents` when the user named no agents
 * (no `--agents`, no `--config` agents). Persisted to config — never consulted at
 * runtime.
 */
export async function resolveDefaultAgents(
  env: EnvReader = Deno.env,
): Promise<AgentName[]> {
  const detected = await detectAgentsOnPath(env);
  return detected.length > 0 ? detected : [...DEFAULT_AGENTS];
}
