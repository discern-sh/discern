/**
 * Shared test helpers: the fixture templates path, a standard token map, and a
 * temp-dir harness that cleans up after itself.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { DESK_SESSION_ENV } from "../src/engine/desk/session.ts";
import type { TokenMap } from "../src/lib/template.ts";
import type { EnvReader } from "../src/shared/env.ts";

/** Absolute path to the synthetic fixture templates tree. */
export const FIXTURE_TEMPLATES = join(
  dirname(fromFileUrl(import.meta.url)),
  "fixtures",
  "templates",
);

/** Absolute path to the real, committed templates tree. */
export const REAL_TEMPLATES = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "templates",
);

/** Absolute path to the CLI entrypoint. */
const MAIN = join(
  dirname(fromFileUrl(import.meta.url)),
  "..",
  "src",
  "main.ts",
);

/**
 * A gate-job command that leaves an ESCAPED descendant holding the job's
 * stdout/stderr: `deno eval` spawns a detached (own-session) `sleep` that
 * inherits the pipes, then the shell exits 0. The sleeper survives any
 * process-group tree-kill — the standard self-daemonizing pattern, distilled —
 * so it exercises the kill path's drain bound: without it, the runner would
 * wait for pipe EOF (the daemon's whole lifetime) and the gate would hang past
 * its budget. `markerFile` (cwd-relative), when given, is written once the
 * daemon is up, so a test can synchronize before aborting.
 */
export function escapedDaemonCommand(
  holdS: number,
  markerFile?: string,
): string {
  const marker = markerFile === undefined
    ? ""
    : `; Deno.writeTextFileSync("${markerFile}", "up")`;
  return `deno eval 'new Deno.Command("sleep", { args: ["${holdS}"], stdout: "inherit", stderr: "inherit", detached: true }).spawn().unref()${marker}' && sleep 0.2`;
}

/** The captured result of one CLI subprocess invocation. */
export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run `src/main.ts` as a subprocess in `cwd`, so Cliffy parsing, the global
 * flags, JSON output, and exit codes are all exercised for real. `NO_COLOR` and
 * the real templates dir are set; `env` adds/overrides further variables. When
 * `stdin` is given, it is piped to the process (for `--config -`).
 */
export async function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
  stdin?: string,
): Promise<CliResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      MAIN,
      ...args,
    ],
    cwd,
    // The desk session marker inherits into every descendant; blank it so a
    // suite launched from inside `discern desk` stays deterministic.
    env: {
      DISCERN_TEMPLATES_DIR: REAL_TEMPLATES,
      NO_COLOR: "1",
      // FORCE_COLOR flips Deno.noColor false even when NO_COLOR is set; empty
      // means unset, so an inherited value can't recolour spawned output.
      FORCE_COLOR: "",
      [DESK_SESSION_ENV]: "",
      ...env,
    },
    stdin: stdin !== undefined ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });

  if (stdin !== undefined) {
    const child = command.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
    const { code, stdout, stderr } = await child.output();
    return {
      code,
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
    };
  }

  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

/** A complete token map with recognisable test values. */
export function testTokens(overrides: Partial<TokenMap> = {}): TokenMap {
  return {
    project_name: "Demo App",
    project_slug: "demo-app",
    branch_prefix: "agent/",
    agents_array: '"claude_code", "codex"',
    map_dir: "docs/",
    gotchas_doc: "",
    scopes_neutral: '"${map.dir}", ".discern/", ".claude/"',
    scopes_guidance: '"discern/guidance.md", "discern/skills/"',
    scopes_web: '"src/**", "app/**"',
    scopes_previewable: '"public/**"',
    artifact_provenance_marker: "discern provenance marker",
    kit_version: "0.1.0",
    ...overrides,
  };
}

/** Run `fn` with a fresh temp directory, removing it afterwards. */
export async function withTempDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "discern-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
    // Worktrees land in a SIBLING dir by default (`<dir>.worktrees`, the new
    // placement) — sweep it too so sibling-placed test worktrees never leak into
    // the system temp root. Best-effort: absent on the many tests that make none.
    await Deno.remove(`${dir}.worktrees`, { recursive: true }).catch(() => {});
  }
}

/** Return C0/C1 bytes that are unsafe outside an intentional terminal sequence. */
export function unexpectedTerminalControls(text: string): string[] {
  const controls: string[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x08 || codePoint === 0x0b || codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      controls.push(character);
    }
  }
  return controls;
}

/**
 * Seed a minimal config at the root `discern.toml` path. For tests that fake an
 * install without running the installer.
 */
export async function seedConfig(dir: string, content: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "discern.toml"), content);
}

/** Read a target file relative to a destination dir as text. */
export async function readTarget(dir: string, rel: string): Promise<string> {
  return await Deno.readTextFile(join(dir, rel));
}

/** The octal permission bits of a target file. */
export async function modeOf(dir: string, rel: string): Promise<number> {
  const info = await Deno.stat(join(dir, rel));
  return (info.mode ?? 0) & 0o777;
}

/** True when a target file exists. */
export async function targetExists(dir: string, rel: string): Promise<boolean> {
  try {
    await Deno.stat(join(dir, rel));
    return true;
  } catch {
    return false;
  }
}

/**
 * An {@link EnvReader} backed by a plain map — the parallel-safe way for a test to
 * hand env overrides to a function under test (resolveTemplatesDir, colourEnabled,
 * resolveWorktreeId, …) WITHOUT mutating the real process env. A process-env
 * mutation is global and leaks across test files running concurrently under
 * `deno test --parallel`; an injected reader stays local to the call. An unlisted
 * key reads as absent.
 */
export function fakeEnv(
  vars: Record<string, string | undefined> = {},
): EnvReader {
  return { get: (key: string): string | undefined => vars[key] };
}
