/**
 * Shared test helpers: the fixture templates path, a standard token map, and a
 * temp-dir harness that cleans up after itself.
 */

import { assertEquals } from "@std/assert";
import { ensureDir, walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative, SEPARATOR } from "@std/path";
import { sha256Hex } from "../src/lib/manifest.ts";
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
    env: { ICCULUS_TEMPLATES_DIR: REAL_TEMPLATES, NO_COLOR: "1", ...env },
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
    scopes_neutral: '"docs/", ".icculus/", ".claude/"',
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

/**
 * Seed a minimal config at the consolidated `.icculus/config.toml` path, creating
 * the `.icculus/` namespace dir. For tests that fake an install without running
 * the installer (which would create the dir itself).
 */
export async function seedConfig(dir: string, content: string): Promise<void> {
  await ensureDir(join(dir, ".icculus"));
  await Deno.writeTextFile(join(dir, ".icculus/config.toml"), content);
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
 * A content snapshot of a scaffolded tree: target-relative path → sha256 of its
 * bytes. The manifest is excluded — its `generated_at` timestamp differs run to
 * run, so compare it separately — as is any `.git` directory. This is the basis
 * of the "upgrade ≡ fresh init" convergence check (ADR 0014): two installs that
 * should be equivalent must produce equal snapshots.
 */
export async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const snap = new Map<string, string>();
  for await (const entry of walk(dir, { includeDirs: false })) {
    const rel = relative(dir, entry.path).replaceAll(SEPARATOR, "/");
    if (rel === ".icculus/manifest.json" || rel.startsWith(".git/")) {
      continue;
    }
    snap.set(rel, await sha256Hex(await Deno.readFile(entry.path)));
  }
  return snap;
}

/**
 * Assert two tree snapshots are identical, reporting the first divergences
 * (files only in one side, or present in both with differing contents).
 */
export function assertConverges(
  upgraded: Map<string, string>,
  fresh: Map<string, string>,
): void {
  const onlyUpgraded = [...upgraded.keys()].filter((k) => !fresh.has(k)).sort();
  const onlyFresh = [...fresh.keys()].filter((k) => !upgraded.has(k)).sort();
  const differing = [...upgraded.keys()]
    .filter((k) => fresh.has(k) && upgraded.get(k) !== fresh.get(k))
    .sort();
  const problems: string[] = [];
  if (onlyUpgraded.length) {
    problems.push(`only in upgraded: ${onlyUpgraded.join(", ")}`);
  }
  if (onlyFresh.length) problems.push(`only in fresh: ${onlyFresh.join(", ")}`);
  if (differing.length) {
    problems.push(`differing contents: ${differing.join(", ")}`);
  }
  assertEquals(problems, [], `trees diverge:\n  ${problems.join("\n  ")}`);
}
