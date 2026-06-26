/**
 * Coverage for the worktree-lifecycle hook commands wired into
 * `.claude/settings.json` — the SessionStart / WorktreeCreate / WorktreeRemove
 * entries that drive the worktree workflow. They are now thin `discern
 * worktree:ensure` / `worktree:create` / `worktree:remove` dispatches: the binary
 * reads the hook's JSON payload from stdin itself, so the hooks no longer shell
 * out to `jq` (ADR 0039). Each test extracts the command from the RENDERED
 * settings and runs it exactly as the harness would — `sh -c <command>` with the
 * event's JSON payload on stdin — so a regression in the hook contract surfaces
 * here. The file matches `engine_*_test.ts`, so it runs in CI's dash/bash matrix.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  engineEnv,
  gitInit,
  scaffoldEngine,
  worktreePath,
} from "./engine_helpers.ts";

const DECODER = new TextDecoder();

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

Deno.test("hooks: no worktree hook shells out to jq anymore", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const raw = await Deno.readTextFile(join(dir, ".claude/settings.json"));
    assert(
      !/\bjq\b/.test(raw),
      `settings.json should not reference jq:\n${raw}`,
    );
    // The create/remove hooks are the thin binary dispatches that replaced it.
    assertStringIncludes(
      await hookCommand(dir, "WorktreeCreate"),
      "worktree:create",
    );
    assertStringIncludes(
      await hookCommand(dir, "WorktreeRemove"),
      "worktree:remove",
    );
  });
});

Deno.test("hook SessionStart: dispatches worktree:ensure (a no-op in the main checkout)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runHook(dir, await hookCommand(dir, "SessionStart"), {});
    assertEquals(r.code, 0, r.stderr);
  });
});

Deno.test("hook WorktreeCreate: creates the worktree, runs setup, prints its path", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: "hooked",
      cwd: dir,
    });
    assertEquals(r.code, 0, r.stderr);

    const wt = worktreePath(dir, "hooked");
    // The hook prints ONLY the new worktree's path on stdout (no trailing
    // newline) — Claude Code reads it as the worktree location.
    assertEquals(r.stdout, wt);
    // It is a real linked worktree, with `discern worktree` setup having run.
    assert(await exists(join(wt, ".git")), `not a worktree\n${r.stderr}`);
    assert(
      await exists(join(wt, ".claude/skills/write-adr/SKILL.md")),
      `setup did not run inside the worktree\n${r.stderr}`,
    );
  });
});

Deno.test("hook WorktreeCreate: a setup step that writes to stdout never pollutes the path", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A `[worktree.setup]` step that prints to stdout — exactly what `vale sync`,
    // `npm ci`, etc. do. Its output must be routed to stderr, NOT prepended to the
    // worktree path the hook returns on stdout. Committed (HEAD) so the freshly
    // checked-out worktree carries it and setup actually runs it.
    const noise = "DISCERN-SETUP-STDOUT-NOISE";
    const cfgPath = join(dir, "discern.toml");
    const cfg = await Deno.readTextFile(cfgPath);
    assertStringIncludes(cfg, "steps = []"); // template default we override
    await Deno.writeTextFile(
      cfgPath,
      cfg.replace("steps = []", `steps = ["echo ${noise}"]`),
    );
    await gitInit(dir);

    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: "noisy",
      cwd: dir,
    });
    assertEquals(r.code, 0, r.stderr);

    const wt = worktreePath(dir, "noisy");
    // The path on stdout is EXACTLY the worktree path — no setup output, and so no
    // embedded newline. (A regression here is the "path contains control
    // characters" failure Claude Code reports.)
    assertEquals(r.stdout, wt);
    // The step still ran and its output is visible — rerouted to stderr, not lost.
    assertStringIncludes(r.stderr, noise);
  });
});

Deno.test("hook WorktreeCreate: re-firing on an existing worktree is idempotent", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const create = await hookCommand(dir, "WorktreeCreate");
    const payload = { name: "again", cwd: dir };
    const first = await runHook(dir, create, payload);
    assertEquals(first.code, 0, first.stderr);
    // A second create for the same name must not error on the already-added
    // worktree — it re-runs setup and re-prints the same path.
    const second = await runHook(dir, create, payload);
    assertEquals(second.code, 0, second.stderr);
    assertEquals(second.stdout, worktreePath(dir, "again"));
  });
});

Deno.test("hook WorktreeCreate: a payload missing name/cwd fails loudly", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      cwd: dir,
    });
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "name");
  });
});

Deno.test("hook WorktreeRemove: tears down a worktree and never fails the event", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Make a worktree with the create hook, then feed its path to remove.
    await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: "doomed",
      cwd: dir,
    });
    const wt = worktreePath(dir, "doomed");
    const r = await runHook(dir, await hookCommand(dir, "WorktreeRemove"), {
      worktree_path: wt,
    });
    // The remove hook is best-effort: teardown problems never fail the event.
    assertEquals(r.code, 0, r.stderr);
  });
});

Deno.test("hook WorktreeRemove: a missing worktree path is a clean no-op", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runHook(dir, await hookCommand(dir, "WorktreeRemove"), {});
    assertEquals(r.code, 0, r.stderr);
  });
});
