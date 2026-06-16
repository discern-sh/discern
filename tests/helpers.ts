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
 * the real templates dir are set; `env` adds/overrides further variables.
 */
export async function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
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
    env: { ICCULUS_TEMPLATES_DIR: REAL_TEMPLATES, NO_COLOR: "1", ...env },
    stdout: "piped",
    stderr: "piped",
  });
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
    gotchas_doc: "docs/80-development/finish-gate-gotchas.md",
    scopes_neutral: '"docs/", ".ai/", ".claude/"',
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
  const dir = await Deno.makeTempDir({ prefix: "icculus-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
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
