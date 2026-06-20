/**
 * Coverage for the shell hook commands wired into `.claude/settings.json` — the
 * SessionStart / WorktreeCreate / WorktreeRemove one-liners that drive the
 * worktree workflow. They are jq + git + dispatch shell, run by the agent
 * harness (never by `agent finish`), so a quoting or jq-path slip surfaces only
 * at runtime. Each test extracts the command from the RENDERED settings and runs
 * it exactly as the harness would: `sh -c <command>` with the event's JSON
 * payload on stdin. The file matches `engine_*_test.ts`, so it runs in CI's
 * dash/bash matrix too.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import { engineEnv, gitInit, scaffoldEngine } from "./engine_helpers.ts";

const DECODER = new TextDecoder();

/** jq is a hard dependency of two hooks; skip those when it is unavailable. */
const HAS_JQ = await (async () => {
  try {
    const c = new Deno.Command("jq", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    });
    return (await c.output()).success;
  } catch {
    return false;
  }
})();

/** The command string a settings.json hook event runs (first hook of the group). */
async function hookCommand(dir: string, event: string): Promise<string> {
  const settings = JSON.parse(
    await Deno.readTextFile(join(dir, ".claude/settings.json")),
  );
  return settings.hooks[event][0].hooks[0].command as string;
}

/** Run a hook command as the harness does: `sh -c <command>`, JSON on stdin. */
async function runHook(
  dir: string,
  command: string,
  payload: unknown,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = new Deno.Command("sh", {
    args: ["-c", command],
    cwd: dir,
    env: await engineEnv(),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(payload)));
  await writer.close();
  const { code, stdout, stderr } = await child.output();
  return {
    code,
    stdout: DECODER.decode(stdout),
    stderr: DECODER.decode(stderr),
  };
}

Deno.test("hook SessionStart: dispatches worktree:ensure (a no-op in the main checkout)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runHook(dir, await hookCommand(dir, "SessionStart"), {});
    assertEquals(r.code, 0, r.stderr);
  });
});

Deno.test({
  name:
    "hook WorktreeCreate: creates the worktree, runs setup, prints its path",
  ignore: !HAS_JQ,
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
        name: "hooked",
        cwd: dir,
      });
      assertEquals(r.code, 0, r.stderr);

      const wt = join(dir, ".claude/worktrees/hooked");
      // The hook prints the new worktree's path on stdout — Claude Code reads it.
      assertEquals(r.stdout.trim(), wt);
      // It is a real linked worktree, with `agent worktree` setup having run.
      assert(await exists(join(wt, ".git")), `not a worktree\n${r.stderr}`);
      assert(
        await exists(join(wt, ".claude/skills/handoff-worktree/SKILL.md")),
        `setup did not run inside the worktree\n${r.stderr}`,
      );
    });
  },
});

Deno.test({
  name: "hook WorktreeRemove: tears down a worktree and never fails the event",
  ignore: !HAS_JQ,
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      // Make a worktree with the create hook, then feed its path to remove.
      await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
        name: "doomed",
        cwd: dir,
      });
      const wt = join(dir, ".claude/worktrees/doomed");
      const r = await runHook(dir, await hookCommand(dir, "WorktreeRemove"), {
        worktree_path: wt,
      });
      // The remove hook ends in `|| true`: teardown problems never fail the event.
      assertEquals(r.code, 0, r.stderr);
    });
  },
});
