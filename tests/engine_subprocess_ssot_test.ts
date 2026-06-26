/**
 * Architectural guard (ADR 0054): every git invocation, and every buffered
 * `sh -c`, funnels through a shared runner in src/shared/subprocess.ts, so GIT_BIN
 * handling, output decoding, the `:` no-op, and the spawn-failure fallback are
 * single-sourced. A raw `new Deno.Command(gitBin()|"git", …)` anywhere else under
 * src/ fails this test — route it through runGit(). A raw `new Deno.Command("sh",
 * …)` likewise fails, except in the two sanctioned spawners named below: the
 * gate's streaming, cancellable job runner and the logger-routed setup runner.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, join, relative } from "@std/path";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const SRC = join(REPO_ROOT, "src");

/** Every `.ts` file under `src/`, as `[repo-relative path, contents]`. */
async function srcFiles(): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for await (const entry of walk(SRC, { includeDirs: false })) {
    if (!entry.path.endsWith(".ts")) continue;
    out.push([
      relative(REPO_ROOT, entry.path),
      await Deno.readTextFile(entry.path),
    ]);
  }
  return out;
}

/** The one file permitted to spawn git directly — the shared runner's home. */
const GIT_SPAWN_HOME = join("src", "shared", "subprocess.ts");

/** A `new Deno.Command(…)` whose binary is git: the gitBin() resolver or a literal. */
const GIT_SPAWN = /new Deno\.Command\(\s*(?:gitBin\(\)|["']git["'])/;

Deno.test("every git spawn funnels through the shared runGit", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await srcFiles()) {
    if (rel === GIT_SPAWN_HOME) continue;
    if (GIT_SPAWN.test(text)) offenders.push(rel);
  }
  assertEquals(
    offenders,
    [],
    `git is spawned outside ${GIT_SPAWN_HOME} — route it through runGit():\n  ${
      offenders.join("\n  ")
    }`,
  );
});

/**
 * The files permitted to spawn `sh -c` directly: the shared runners' home, the
 * gate's streaming/cancellable job runner, and the logger-routed setup runner that
 * reserves its parent's stdout for a machine result.
 */
const SH_SPAWN_HOMES = new Set([
  join("src", "shared", "subprocess.ts"),
  join("src", "engine", "jobs", "command.ts"),
  join("src", "engine", "worktree", "shell.ts"),
]);

/** A `new Deno.Command(…)` whose binary is the literal shell. */
const SH_SPAWN = /new Deno\.Command\(\s*["']sh["']/;

Deno.test("every sh -c spawn funnels through a sanctioned runner", async () => {
  const offenders: string[] = [];
  for (const [rel, text] of await srcFiles()) {
    if (SH_SPAWN_HOMES.has(rel)) continue;
    if (SH_SPAWN.test(text)) offenders.push(rel);
  }
  assertEquals(
    offenders,
    [],
    `sh is spawned outside the sanctioned runners (${
      [...SH_SPAWN_HOMES].join(", ")
    }) — run buffered shell commands through runShell():\n  ${
      offenders.join("\n  ")
    }`,
  );
});
