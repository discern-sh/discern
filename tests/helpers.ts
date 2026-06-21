/**
 * Shared test helpers: the fixture templates path, a standard token map, and a
 * temp-dir harness that cleans up after itself.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import type { TokenMap } from "../src/lib/template.ts";

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
    env: { DISCERN_TEMPLATES_DIR: REAL_TEMPLATES, NO_COLOR: "1", ...env },
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
    gotchas_doc: "",
    scopes_neutral: '"docs/", ".discern/", ".claude/"',
    scopes_web: '"src/**", "app/**"',
    scopes_previewable: '"public/**"',
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
  }
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
