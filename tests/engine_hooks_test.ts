/**
 * Coverage for the worktree-lifecycle hook commands wired into
 * `.claude/settings.json` — the SessionStart / WorktreeCreate / WorktreeRemove
 * entries that drive the worktree workflow. They are now thin `discern
 * worktree ensure` / `worktree create` / `worktree remove` dispatches: the binary
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
  addWorktree,
  engineEnv,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  worktreePath,
  writeConfig,
} from "./engine_helpers.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import { portForId } from "../src/engine/worktree/identity.ts";

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
      "worktree create",
    );
    assertStringIncludes(
      await hookCommand(dir, "WorktreeRemove"),
      "worktree remove",
    );
  });
});

Deno.test("hook SessionStart: dispatches worktree ensure (a no-op in the main checkout)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const r = await runHook(dir, await hookCommand(dir, "SessionStart"), {});
    assertEquals(r.code, 0, r.stderr);
  });
});

Deno.test("hook WorktreeCreate: branches from the trunk even when the main checkout is parked elsewhere", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Park the main checkout on a side branch carrying a poison commit — the
    // same class `discern start` guards (engine_start_correctness_test.ts).
    await git(dir, "switch", "-q", "-c", "parked-branch");
    await Deno.writeTextFile(join(dir, "poison.txt"), "off-trunk work\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "poison", "--no-gpg-sign");

    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: "parked-hooked",
      cwd: dir,
    });
    assertEquals(r.code, 0, r.stderr);
    const wt = r.stdout.trim();
    assertEquals(
      await exists(join(wt, "poison.txt")),
      false,
      `the parked branch's commit must not reach the hook's worktree\n${r.stderr}`,
    );
  });
});

Deno.test("hook WorktreeCreate: a failed create never deletes a pre-existing branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A branch left behind by an earlier session of the same name, holding
    // unlanded commits (the session's worktree is gone; the branch survives —
    // exactly the abandoned-work state `status` surfaces as unlanded).
    await git(dir, "branch", "agent/fix-login");
    await git(dir, "switch", "-q", "agent/fix-login");
    await Deno.writeTextFile(join(dir, "unlanded.txt"), "5 commits of work\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "unlanded", "--no-gpg-sign");
    await git(dir, "switch", "-q", "main");
    const tip = await gitOut(dir, "rev-parse", "agent/fix-login");

    // A new session re-uses the worktree name: the create must fail plainly —
    // and the failure cleanup must NOT `git branch -D` a branch it never
    // created (that silently destroyed the unlanded commits).
    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: "fix-login",
      cwd: dir,
    });
    assertEquals(r.code, 1, r.stderr);
    assertStringIncludes(r.stderr, "agent/fix-login");
    assertStringIncludes(r.stderr, "already exists");
    assertEquals(
      await gitOut(dir, "rev-parse", "agent/fix-login"),
      tip,
      `the pre-existing branch must keep its commits\n${r.stderr}`,
    );
  });
});

Deno.test("hook WorktreeCreate: warns when the caller-named worktree's port collides with a live sibling's", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      '[project]\nslug = "engine-test"\nmain_branch = "main"\n\n[worktree]\nport = true\n',
    );
    await gitInit(dir);
    // The hook takes the caller's name verbatim (no mint, so no re-roll) — find
    // a name whose derived port collides with an existing sibling's, then prove
    // the collision is at least EXPLAINED rather than left to fight unexplained.
    const sibling = "port-twin-a";
    await addWorktree(dir, sibling);
    let clash: string | undefined;
    for (let i = 0; clash === undefined && i < 100_000; i++) {
      const candidate = `port-twin-b${i}`;
      if (portForId(candidate) === portForId(sibling)) {
        clash = candidate;
      }
    }
    assert(clash !== undefined, "the 2000-wide band must yield a collision");

    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: clash,
      cwd: dir,
    });
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(
      r.stderr,
      "already claimed by a live sibling",
      `the collision must be explained\n${r.stderr}`,
    );
    assertStringIncludes(r.stderr, "DISCERN_WORKTREE_ID");
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
    // It is a real linked worktree, with `discern worktree setup` having run.
    assert(await exists(join(wt, ".git")), `not a worktree\n${r.stderr}`);
    assert(
      await exists(join(wt, ".claude/skills/discern-write-adr/SKILL.md")),
      `setup did not run inside the worktree\n${r.stderr}`,
    );
  });
});

Deno.test("hook-created worktree stays git-clean after setup and session-start ensure", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: [...AGENT_NAMES] });
    const refresh = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refresh.code, 0, refresh.output);
    await gitInit(dir);

    const create = await runHook(
      dir,
      await hookCommand(dir, "WorktreeCreate"),
      {
        name: "clean",
        cwd: dir,
      },
    );
    assertEquals(create.code, 0, create.stderr);
    const wt = worktreePath(dir, "clean");
    assertEquals(create.stdout, wt);

    assertEquals(
      await gitOut(wt, "status", "--porcelain", "--untracked-files=all"),
      "",
      "worktree setup must not leave tracked or unignored files dirty",
    );

    const ensure = await runHook(wt, await hookCommand(wt, "SessionStart"), {});
    assertEquals(ensure.code, 0, ensure.stderr);
    assertEquals(
      await gitOut(wt, "status", "--porcelain", "--untracked-files=all"),
      "",
      "session-start ensure must not leave tracked or unignored files dirty",
    );
  });
});

Deno.test("hook WorktreeCreate: a successful setup step is silent and never pollutes the path", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A `[worktree.setup]` step that prints to stdout — exactly what `vale sync`,
    // `npm ci`, etc. do. The engine CAPTURES it: a successful step's output reaches
    // neither the worktree path on stdout (the "path contains control characters"
    // bug) NOR stderr (quiet on success, like a gate job). The marker `RAN_42_OUT`
    // appears only when the command RUNS — it is absent from the command text, so the
    // `→ Setup step: …` narration (which echoes the command) can't false-match it. The
    // `touch` proves the step ran.
    const cfgPath = join(dir, "discern.toml");
    const cfg = await Deno.readTextFile(cfgPath);
    assertStringIncludes(cfg, "steps = []"); // template default we override
    await Deno.writeTextFile(
      cfgPath,
      cfg.replace(
        "steps = []",
        `steps = ["echo RAN_$((6*7))_OUT; touch ran.marker"]`,
      ),
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
    // The step ran…
    assert(
      await exists(join(wt, "ran.marker")),
      `the setup step did not run\n${r.stderr}`,
    );
    // …but a SUCCESSFUL step is silent: its OUTPUT leaks to NEITHER channel.
    assertEquals(
      `${r.stdout}${r.stderr}`.includes("RAN_42_OUT"),
      false,
      `a successful setup step's output must be captured, not surfaced\n${r.stdout}\n${r.stderr}`,
    );
  });
});

Deno.test("hook WorktreeCreate: a FAILING setup step surfaces its output for debugging", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // The mirror of the silent-on-success case: when a setup step FAILS, its captured
    // output is surfaced on stderr (the diagnostic channel) so the failure is
    // debuggable — never on stdout, which carries only the worktree path. The marker
    // `FAIL_42_Z` appears only in the command's OUTPUT (not its text), so asserting it
    // proves the captured output was surfaced, not merely the command-echo narration.
    const cfgPath = join(dir, "discern.toml");
    const cfg = await Deno.readTextFile(cfgPath);
    await Deno.writeTextFile(
      cfgPath,
      cfg.replace("steps = []", `steps = ["echo FAIL_$((6*7))_Z; exit 3"]`),
    );
    await gitInit(dir);

    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: "failing",
      cwd: dir,
    });
    // The failed step aborts creation; the hook returns no path.
    assertEquals(r.code, 1);
    assertEquals(r.stdout, "");
    // The step's own OUTPUT is surfaced on stderr, beside the failure narration.
    assertStringIncludes(r.stderr, "FAIL_42_Z");
    assertStringIncludes(r.stderr, "Setup step failed");
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

/** Point `[worktree].root` at `value` in a scaffolded config (the template seeds
 * `root = ""`), so the create hook resolves placement there instead of the
 * sibling default. */
async function setWorktreeRoot(dir: string, value: string): Promise<void> {
  const cfgPath = join(dir, "discern.toml");
  const cfg = await Deno.readTextFile(cfgPath);
  assertStringIncludes(cfg, 'root = ""'); // the template default we override
  await Deno.writeTextFile(
    cfgPath,
    cfg.replace('root = ""', `root = "${value}"`),
  );
}

Deno.test("hook WorktreeCreate: a RELATIVE [worktree].root resolves against the repo (restores nesting)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await setWorktreeRoot(dir, ".claude/worktrees"); // the documented old-nesting opt-in
    await gitInit(dir);

    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: "rel",
      cwd: dir,
    });
    assertEquals(r.code, 0, r.stderr);
    const wt = join(dir, ".claude/worktrees/rel");
    assertEquals(r.stdout, wt);
    assert(await exists(join(wt, ".git")), `not a worktree\n${r.stderr}`);
  });
});

Deno.test("hook WorktreeCreate: an ABSOLUTE [worktree].root is used as-is", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // An absolute path (here under dir, so withTempDir reclaims it) is honoured verbatim.
    const absRoot = join(dir, "external-wts");
    await setWorktreeRoot(dir, absRoot);
    await gitInit(dir);

    const r = await runHook(dir, await hookCommand(dir, "WorktreeCreate"), {
      name: "abs",
      cwd: dir,
    });
    assertEquals(r.code, 0, r.stderr);
    const wt = join(absRoot, "abs");
    assertEquals(r.stdout, wt);
    assert(await exists(join(wt, ".git")), `not a worktree\n${r.stderr}`);
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
