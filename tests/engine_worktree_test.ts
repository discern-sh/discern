/**
 * Engine coverage for the isolated-worktree lifecycle — the repo's flagship
 * workflow, and (until now) its largest untested surface.
 *
 * These commands run from git hooks, not `discern done`, so the gate is otherwise
 * blind to them: a regression here would ship green. (The noglob break in
 * `guidelines` hid on exactly this path — the worktree-create hook runs it.)
 * Each test drives a REAL linked worktree in a hermetic git repo and shells out
 * to the dispatcher, so the bytes under test are what an install runs.
 */

import { renderCommandRefsCli } from "../src/shared/command_reference.ts";
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { basename, dirname, fromFileUrl, join } from "@std/path";
import { copy, exists } from "@std/fs";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  formatMarkdownText,
  writeDiscernToml,
} from "../src/lib/tidy_format.ts";
import { HINTS } from "../src/shared/hints.ts";
import { BUILT_IN_STEP_LABELS } from "../src/shared/result.ts";
import {
  configSchema,
  type DiscernConfig,
} from "../src/shared/config_schema.ts";
import { submoduleCommandWired } from "../src/engine/worktree/lifecycle.ts";
import type { assertOpSide } from "../src/engine/worktree/git.ts";
import {
  cliRefusalCases,
  SIDE_RESTRICTED_OPS,
} from "../src/engine/worktree/side_restrictions.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  worktreePath,
  writeConfig,
} from "./engine_helpers.ts";

const SOURCE_ROOT = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = dirname(SOURCE_ROOT);
const DECODER = new TextDecoder();

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** Plant both modified tracked data and an untracked file to exercise safe removal refusal. */
async function leaveTrackedAndUntrackedWip(wt: string): Promise<void> {
  await Deno.writeTextFile(join(wt, "tracked.txt"), "committed\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "add tracked file", "--no-gpg-sign");

  await Deno.writeTextFile(join(wt, "tracked.txt"), "tracked wip\n");
  await Deno.writeTextFile(join(wt, "untracked.txt"), "untracked wip\n");
}

/** Commit all fixture state, allowing an empty commit at a worktree lifecycle boundary. */
async function commitCurrentWorktree(
  wt: string,
  message = "commit worktree state",
): Promise<void> {
  await git(wt, "add", "-A");
  await git(
    wt,
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    message,
    "--no-gpg-sign",
  );
}

/**
 * Overlay the source engine + bundled templates onto an engine fixture. This
 * makes the fixture a self-hosting discern checkout: a branch can carry a
 * different compiler or bundled guidance, and a worktree created from that ref
 * can run the exact engine it checked out.
 */
async function addSourceEngine(dir: string): Promise<void> {
  await copy(join(REPO_ROOT, "src"), join(dir, "src"));
  await copy(join(REPO_ROOT, "templates"), join(dir, "templates"));
  await Deno.copyFile(join(REPO_ROOT, "deno.json"), join(dir, "deno.json"));
  await Deno.copyFile(join(REPO_ROOT, "deno.lock"), join(dir, "deno.lock"));
  await Deno.symlink(
    join(REPO_ROOT, "node_modules"),
    join(dir, "node_modules"),
    { type: "dir" },
  );
}

/** Run the source engine belonging to `dir`, independent of the test runner's checkout. */
async function runCheckoutEngine(
  dir: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-check",
      "--config",
      join(dir, "deno.json"),
      "-A",
      join(dir, "src/main.ts"),
      ...args,
    ],
    cwd: dir,
    env: {
      DISCERN_TEMPLATES_DIR: join(dir, "templates"),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      NO_COLOR: "1",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const out = DECODER.decode(stdout);
  const err = DECODER.decode(stderr);
  return { code, stdout: out, stderr: err, output: out + err };
}

/** Add a unique authored guidance heading and commit it on the accepting branch. */
async function commitGuidanceMarker(
  wt: string,
  marker: string,
): Promise<void> {
  const guidance = join(wt, "discern/guidance.md");
  await Deno.mkdir(join(wt, "discern"), { recursive: true });
  const existing = await Deno.readTextFile(guidance).catch(() => "");
  await Deno.writeTextFile(
    guidance,
    await formatMarkdownText(
      guidance,
      `${existing}\n\n## ${marker}\n\nKeep this marker visible in generated guidance.\n`,
    ),
  );
  const refreshed = await runAgent(wt, ["refresh", "--json"]);
  assertEquals(refreshed.code, 0, refreshed.output);
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "update guidance", "--no-gpg-sign");
}

/** Prove the fast-forward carried current branch guidance into main. */
async function assertLandedGuidanceCurrent(
  dir: string,
  marker: string,
): Promise<void> {
  assertStringIncludes(
    await Deno.readTextFile(join(dir, "CLAUDE.md")),
    marker,
    "the landed commit should carry its generated guidance",
  );
  const status = await runAgent(dir, ["status", "--json"]);
  assertEquals(status.code, 0, status.output);
  const result = JSON.parse(status.stdout) as {
    data: { stale_generated?: string[] };
  };
  assertEquals(
    result.data.stale_generated ?? [],
    [],
    `generated guidance should be current after acceptance\n${status.stdout}`,
  );
}

Deno.test("worktree setup: refreshes agent files and links skills inside the worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "alpha");
    const r = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(wt, "CLAUDE.md")),
      `CLAUDE.md missing\n${r.output}`,
    );
    assert(
      await exists(join(wt, ".claude/skills/discern-write-adr/SKILL.md")),
      `bundled skills not linked in the worktree\n${r.output}`,
    );
    assertStringIncludes(r.output, "Worktree setup complete");
  });
});

Deno.test("worktree lands in a sibling dir (never nested), and status + identity work there", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "theta");

    // The checkout is a SIBLING of the repo — adjacent to it, never nested under
    // it (the nested-worktree anti-pattern this placement exists to avoid: a
    // recursive glob would otherwise double-count it, and a walk-up to the repo
    // root would mis-resolve the worktree's .git file).
    assert(
      !wt.startsWith(`${dir}/`),
      `worktree must not be nested inside the repo: ${wt}`,
    );
    assertStringIncludes(wt, `${basename(dir)}.worktrees`);

    // identity resolves identity from the sibling checkout…
    const name = await runAgent(wt, ["identity", "--id"]);
    assertEquals(name.code, 0, name.output);
    assertStringIncludes(name.stdout, "theta");

    // …and status from the main checkout surveys the sibling as a line of work.
    const status = await runAgent(dir, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    const fleet = JSON.parse(status.stdout).data.fleet as Array<
      { branch: string }
    >;
    assert(
      fleet.some((row) => row.branch === "agent/theta"),
      `the sibling worktree should appear in the fleet: ${status.stdout}`,
    );
  });
});

Deno.test("worktree ensure sets up once, then is a no-op", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "beta");
    const first = await runAgent(wt, ["worktree", "ensure"]);
    assertEquals(first.code, 0, first.output);
    assertStringIncludes(first.output, "not configured yet");
    const second = await runAgent(wt, ["worktree", "ensure"]);
    assertEquals(second.code, 0, second.output);
    assertEquals(
      second.output.includes("not configured yet"),
      false,
      `second ensure must be a silent no-op\n${second.output}`,
    );
  });
});

Deno.test("worktree ensure on the main checkout leads with the worktree-first line", async () => {
  await withTempDir(async (dir) => {
    // The SessionStart hook runs `worktree ensure` and injects its stdout as
    // agent context — the one channel that can pre-empt a trunk edit, which
    // calls no verb first. On the main-checkout side the orientation must
    // reach stdout; the registry entry is the single source of its text.
    await mainWithWorktree(dir, "orient");
    const expected = renderCommandRefsCli(
      HINTS["ensure-main-worktree-first"].template(undefined),
    );
    const r = await runAgent(dir, ["worktree", "ensure"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, expected);
  });
});

Deno.test("worktree ensure orientation stays off the worktree side", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "quiet-orient");
    const expected = renderCommandRefsCli(
      HINTS["ensure-main-worktree-first"].template(undefined),
    );
    const r = await runAgent(wt, ["worktree", "ensure"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      r.output.includes(expected),
      false,
      `a worktree session needs no main-checkout orientation\n${r.output}`,
    );
  });
});

Deno.test("accept: fast-forwards the trunk, removes the worktree, deletes the merged branch", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "gamma");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `worktree should be removed\n${r.output}`,
    );
    // The work landed on the trunk itself, which stays checked out in main…
    assert(
      await exists(join(dir, "feature.txt")),
      `work not fast-forwarded onto the trunk\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "main",
      `main checkout should be on the trunk, not the worktree branch\n${r.output}`,
    );
    // …and the now-merged worktree branch is gone.
    assertEquals(
      await gitOut(dir, "branch", "--list", "agent/gamma"),
      "",
      `the merged branch should be deleted\n${r.output}`,
    );
    assertStringIncludes(r.output, "Acceptance complete");
  });
});

Deno.test("accept: materializes only checkout-local artifacts after landing", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "trunk-refresh");
    const marker = "Trunk Acceptance Refresh";
    await commitGuidanceMarker(wt, marker);
    const localSkills = join(dir, ".claude/skills");
    if (await exists(localSkills)) {
      await Deno.remove(localSkills, { recursive: true });
    }
    assertEquals(
      await exists(join(dir, ".claude/skills")),
      false,
      "precondition: the receiving checkout needs local skill materialization",
    );

    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as {
      ok: boolean;
      steps: Array<{ label: string; outcome: string }>;
    };
    assertEquals(result.ok, true);
    assert(
      result.steps.some((s) =>
        s.label === BUILT_IN_STEP_LABELS.materializeLocalAgentArtifacts &&
        s.outcome === "ok"
      ),
      `accept should report checkout-local materialization\n${r.stdout}`,
    );
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "main",
      `main checkout should be on the trunk\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "branch", "--list", "agent/trunk-refresh"),
      "",
      `the merged branch should be deleted\n${r.output}`,
    );
    await assertLandedGuidanceCurrent(dir, marker);
    assert(
      await exists(
        join(dir, ".claude/skills/discern-write-adr/SKILL.md"),
      ),
      "acceptance should materialize ignored skills in the receiving checkout",
    );
    assertEquals(
      await gitOut(dir, "status", "--porcelain"),
      "",
      "post-landing local materialization must not dirty tracked trunk files",
    );
  });
});

Deno.test("accept: converges and smokes the trunk without running worktree-only setup", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const wt = await mainWithWorktree(dir, "trunk-convergence");
      const repositoryMarker = join(markers, "repository-cwd");
      const statefulMarker = join(markers, "repository-stateful");
      const smokeMarker = join(markers, "smoke-cwd");
      const worktreeOnlyMarker = join(markers, "worktree-only");
      const configPath = join(wt, "discern.toml");
      const editor = new TomlEditor(await Deno.readTextFile(configPath));
      const statefulCommand =
        `test -f ${statefulMarker} || { touch ${statefulMarker}; exit 1; }`;
      editor.setStringArray("repository.ensure", [
        "discern identity --id",
        statefulCommand,
        statefulCommand,
        `pwd >> ${repositoryMarker}`,
      ]);
      editor.setStringArray("worktree.setup.steps", [
        `echo step >> ${worktreeOnlyMarker}`,
      ]);
      editor.setStringArray("worktree.setup.ensure", [
        `echo ensure >> ${worktreeOnlyMarker}`,
      ]);
      editor.setString("jobs.smoke", `pwd >> ${smokeMarker}`);
      await writeDiscernToml(configPath, editor.toString());
      await commitCurrentWorktree(wt, "configure checkout convergence");

      const mainRoot = await Deno.realPath(dir);
      const worktreeRoot = await Deno.realPath(wt);
      const run = await runAgent(wt, ["accept", "--confirmed", "--json"]);
      assertEquals(run.code, 0, run.output);
      assertEquals(
        await exists(wt),
        false,
        "accept still removes the worktree",
      );
      assertEquals(
        await gitOut(dir, "branch", "--list", "agent/trunk-convergence"),
        "",
        "accept still deletes the landed branch",
      );
      assertEquals(
        (await Deno.readTextFile(repositoryMarker)).trim(),
        mainRoot,
        "later repository ensure commands run in the trunk after an earlier failure",
      );
      assertEquals(
        await markerCount(worktreeOnlyMarker),
        0,
        "worktree setup steps and worktree-only ensure never run on the trunk",
      );
      const smokeCwds = (await Deno.readTextFile(smokeMarker)).trim().split(
        "\n",
      );
      assert(
        smokeCwds.includes(worktreeRoot),
        `the acceptance gate first validates smoke in the worktree: ${smokeCwds}`,
      );
      assert(
        smokeCwds.includes(mainRoot),
        `accept reruns smoke in the converged trunk checkout: ${smokeCwds}`,
      );

      const result = JSON.parse(run.stdout) as {
        ok: boolean;
        steps: Array<{ kind: string; label: string; outcome: string }>;
      };
      const repositorySteps = result.steps.filter((step) =>
        step.kind === "repository-ensure"
      );
      assertEquals(repositorySteps.map((step) => step.outcome), [
        "failed",
        "failed",
        "ok",
        "ok",
      ]);
      assert(
        result.steps.some((step) =>
          step.kind === "job" && step.label === "smoke" &&
          step.outcome === "ok"
        ),
        run.stdout,
      );
      assertEquals(
        result.ok,
        false,
        "the non-fatal convergence failure remains visible in the result",
      );
    });
  });
});

Deno.test("accept: records a post-landing smoke failure without skipping cleanup", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "trunk-smoke-failure");
    const configPath = join(wt, "discern.toml");
    const editor = new TomlEditor(await Deno.readTextFile(configPath));
    // A linked worktree has a .git FILE, while the main checkout has a .git
    // DIRECTORY. The acceptance gate therefore passes in the worktree and only
    // the post-landing smoke fails in the receiving checkout.
    editor.setString("jobs.smoke", "test -f .git");
    await writeDiscernToml(configPath, editor.toString());
    await commitCurrentWorktree(wt, "configure failing landing proof");

    const run = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(run.code, 0, run.output);
    assertEquals(await exists(wt), false, "cleanup removes the worktree");
    assertEquals(
      await gitOut(dir, "branch", "--list", "agent/trunk-smoke-failure"),
      "",
      "cleanup deletes the landed branch",
    );

    const result = JSON.parse(run.stdout) as {
      ok: boolean;
      steps: Array<{ kind: string; label: string; outcome: string }>;
      diagnostics?: Array<{ tool: string; reproduce_cmd: string }>;
    };
    assertEquals(result.ok, false);
    assert(
      result.steps.some((step) =>
        step.kind === "job" && step.label === "smoke" &&
        step.outcome === "failed"
      ),
      run.stdout,
    );
    assert(
      result.diagnostics?.some((diagnostic) =>
        diagnostic.tool === "smoke" &&
        diagnostic.reproduce_cmd === "test -f .git"
      ) ?? false,
      run.stdout,
    );
  });
});

Deno.test("accept: malformed tracked refresh input is refused before landing", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "grad-refresh-fail");
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(wt, ".mcp.json"), malformed);
    await git(wt, "add", ".mcp.json");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "add malformed mcp config",
      "--no-gpg-sign",
    );

    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEquals(
      await exists(wt),
      true,
      `the refused worktree must remain intact\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "main",
      `the trunk must remain checked out\n${r.output}`,
    );
    assertEquals(
      await exists(join(dir, ".mcp.json")),
      false,
      "the malformed branch file must not reach the trunk checkout",
    );
    assertStringIncludes(r.output, "tracked refresh convergence");
  });
});

Deno.test("accept: refuses a dirty worktree without moving anything", async () => {
  await withTempDir(async (dir) => {
    const name = "dirty-tree";
    const wt = await mainWithWorktree(dir, name);
    await leaveTrackedAndUntrackedWip(wt);
    const headBefore = await gitOut(wt, "rev-parse", "HEAD");

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "This worktree has uncommitted changes");
    assertStringIncludes(r.output, "never creates a work-in-progress commit");
    assertEquals(
      await exists(wt),
      true,
      `dirty worktree must stay in place\n${r.output}`,
    );
    assertEquals(await gitOut(wt, "rev-parse", "HEAD"), headBefore);
    assertEquals(
      await Deno.readTextFile(join(wt, "tracked.txt")),
      "tracked wip\n",
    );
    assertEquals(
      await Deno.readTextFile(join(wt, "untracked.txt")),
      "untracked wip\n",
    );
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "main",
      `main checkout should not move\n${r.output}`,
    );
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", `agent/${name}`),
      `agent/${name}`,
      `the branch should not be deleted\n${r.output}`,
    );
  });
});

Deno.test("accept: refuses a locked worktree at plan time, before anything moves", async () => {
  await withTempDir(async (dir) => {
    // Acceptance ends by removing the worktree, and a `git worktree lock`ed
    // one cannot be removed. The refusal must come at plan time — before the
    // gate runs and before the trunk fast-forwards — never after landing has
    // half-happened (destroyed checkout, stranded registration, failed branch
    // delete).
    const wt = await mainWithWorktree(dir, "locked-grad");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    await git(dir, "worktree", "lock", wt, "--reason", "portable drive");
    const trunkBefore = await gitOut(dir, "rev-parse", "main");

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "locked");
    assertStringIncludes(r.output, "git worktree unlock");
    assertEquals(await exists(wt), true, `the worktree survives\n${r.output}`);
    assertEquals(
      await gitOut(dir, "rev-parse", "main"),
      trunkBefore,
      `the trunk must not move\n${r.output}`,
    );
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", "agent/locked-grad"),
      "agent/locked-grad",
      `the branch keeps its commits\n${r.output}`,
    );
  });
});

Deno.test("accept: refuses a detached-HEAD main checkout the same way", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "detached-main");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    // Detach the main checkout: no branch is checked out at all, so the
    // fast-forward has nothing to land on — the refusal must say so plainly,
    // not crash and not move HEAD.
    await git(dir, "switch", "-q", "--detach", "main");

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "'(detached)', not 'main'");
    assertStringIncludes(
      r.output,
      "switch main` — then re-run `discern accept`",
    );
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "",
      `the detached main checkout must not be moved\n${r.output}`,
    );
  });
});

Deno.test("accept: refuses when the main checkout is parked off the trunk, naming the way back", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "parked-main");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    // Park the main checkout on another branch: acceptance must refuse, not
    // silently switch it back.
    await git(dir, "switch", "-q", "-c", "parked-elsewhere");

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "'parked-elsewhere', not 'main'");
    // The way back is named (path canonicalization may differ, so match the tail).
    assertStringIncludes(
      r.output,
      "switch main` — then re-run `discern accept`",
    );
    assertEquals(
      await exists(wt),
      true,
      `off-trunk refusal must leave the worktree intact\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "parked-elsewhere",
      `the parked main checkout must not be moved\n${r.output}`,
    );
  });
});

Deno.test("accept refuses (non-destructively) when the main checkout is dirty", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "delta");
    // Dirty a tracked file in main: exit must refuse rather than clobber it.
    const toml = join(dir, "discern.toml");
    await Deno.writeTextFile(
      toml,
      `${await Deno.readTextFile(toml)}\n# dirty\n`,
    );

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "uncommitted tracked changes");
    assertEquals(
      await exists(wt),
      true,
      "worktree must be left intact on refusal",
    );
  });
});

Deno.test("accept ignores untracked local scratch in the main checkout clean precondition", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "delta-scratch");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    await Deno.mkdir(join(dir, ".codex"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/session.local.toml"),
      "permission = 'local'\n",
    );

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(dir, "feature.txt")),
      `branch not landed into main\n${r.output}`,
    );
    assert(
      await exists(join(dir, ".codex/session.local.toml")),
      "the main checkout's local scratch file should be left alone",
    );
  });
});

Deno.test("accept: refuses a branch behind main before dirty-tree handling or removal", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "behind");
    await leaveTrackedAndUntrackedWip(wt);
    const branchHead = await gitOut(dir, "rev-parse", "agent/behind");

    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "advance main", "--no-gpg-sign");

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "behind the trunk (main)");
    assertStringIncludes(r.output, "discern update");
    assert(
      await exists(wt),
      `behind-main refusal must leave the worktree intact\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "rev-parse", "agent/behind"),
      branchHead,
      `behind-main refusal must not move the branch\n${r.output}`,
    );
    assertEquals(
      await Deno.readTextFile(join(wt, "tracked.txt")),
      "tracked wip\n",
    );
    assertEquals(
      await Deno.readTextFile(join(wt, "untracked.txt")),
      "untracked wip\n",
    );
  });
});

Deno.test("accept: refuses when main moves during the gate before teardown or removal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        `test = "git -C ${dir} commit --allow-empty -q -m race-main --no-gpg-sign"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "race");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const branchHead = await gitOut(wt, "rev-parse", "HEAD");

    const r = await runAgent(wt, ["accept", "--confirmed"]);

    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "behind the trunk (main)");
    assertStringIncludes(r.output, "discern update");
    assert(
      await exists(wt),
      `post-gate trunk-race refusal must leave the worktree intact\n${r.output}`,
    );
    assertEquals(await gitOut(wt, "rev-parse", "HEAD"), branchHead);
  });
});

Deno.test("accept reports ignored files changed since worktree setup at the top level", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      `${await Deno.readTextFile(join(dir, ".gitignore"))}\nlocal-cache/\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "ignored-drift");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);

    await Deno.mkdir(join(wt, "local-cache", "nested"), { recursive: true });
    for (let i = 0; i < 12; i++) {
      await Deno.writeTextFile(
        join(wt, "local-cache", "nested", `generated-${i}.txt`),
        `value ${i}\n`,
      );
    }

    const reentry = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(reentry.code, 0, reentry.output);
    await commitCurrentWorktree(wt);

    const dry = await runAgent(wt, ["accept", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertStringIncludes(dry.output, "Ignored files changed since setup");
    assertStringIncludes(dry.output, "local-cache/");
    assert(
      !dry.output.includes("generated-0.txt"),
      `ignored drift should collapse a changed directory to its top level\n${dry.output}`,
    );

    const applied = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(applied.code, 0, applied.output);
    const obj = JSON.parse(applied.stdout);
    assertEquals(obj.data.ignored_file_changes.changed_roots, ["local-cache/"]);
    assertEquals(obj.data.ignored_file_changes.truncated, false);
  });
});

Deno.test("accept suppresses ignored-file drift detection when configured off", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[worktree]",
        "ignored_file_drift = false",
        "",
      ].join("\n"),
    );
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      `${await Deno.readTextFile(join(dir, ".gitignore"))}\nlocal-cache/\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "ignored-off");
    const setup = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(setup.code, 0, setup.output);
    await Deno.mkdir(join(wt, "local-cache"), { recursive: true });
    await Deno.writeTextFile(join(wt, "local-cache", "changed.txt"), "x\n");
    await commitCurrentWorktree(wt);

    const dry = await runAgent(wt, ["accept", "--dry-run"]);

    assertEquals(dry.code, 0, dry.output);
    assert(
      !dry.output.includes("Ignored files changed since setup"),
      `disabled ignored drift detection should stay quiet\n${dry.output}`,
    );
  });
});

Deno.test("update: refuses from the main checkout", async () => {
  await withTempDir(async (dir) => {
    await mainWithWorktree(dir, "iota");
    // Run from the main checkout, not the worktree — update is worktree-only.
    const r = await runAgent(dir, ["update"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "main checkout");
  });
});

Deno.test("accept: refuses from the main checkout (worktree-only, the CLI mirror of hiding)", async () => {
  await withTempDir(async (dir) => {
    await mainWithWorktree(dir, "iota2");
    // The CLI can't pre-hide per location (it runs at the user's cwd), so its
    // equivalent of the MCP hiding accept from a main-rooted server is a clean
    // refusal: run from the main checkout, accept has no current worktree to move.
    const r = await runAgent(dir, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "runs inside a worktree");
  });
});

Deno.test("every CLI-reachable side-restricted op maps a wrong-side refusal to error:precondition_failed", async () => {
  // A wrong-side run is a refused precondition, and the --json envelope must
  // carry the machine slug an agent branches on — not just human text any
  // message could satisfy. The cases DERIVE from SIDE_RESTRICTED_OPS — the same
  // registry assertOpSide enforces — so a new side-restricted lifecycle op with
  // a CLI surface enrols here without a test edit, and can't silently degrade
  // to a bare exit-1. Every refusal fires read-only before the op acts, so one
  // shared main+worktree fixture serves all of them.
  const cases = cliRefusalCases(SIDE_RESTRICTED_OPS);
  assert(cases.length >= 7, "the registry lost its CLI-reachable members");
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "refusals");
    for (const c of cases) {
      // The wrong side: a worktree-only op runs from the main checkout; a
      // main-only op runs from inside the worktree.
      const from = c.side === "worktree" ? dir : wt;
      const r = await runAgent(from, [...c.argv, "--json"]);
      assertEquals(r.code, 1, `${c.op} from the wrong side: ${r.output}`);
      const result = JSON.parse(r.stdout);
      assertEquals(result.ok, false, c.op);
      assertEquals(result.verb, c.verb, c.op);
      assertEquals(
        result.error,
        "precondition_failed",
        `${c.op} refused from the wrong side must map to precondition_failed`,
      );
    }
  });
});

Deno.test("a fresh-named side-restricted op auto-enrols in the derived refusal cases", () => {
  // The adversarial future sibling: an op sharing no name with today's members,
  // declared the only way assertOpSide permits (a registry entry), must surface
  // in the derived CLI cases untouched — and an internal-only entry must not.
  const cases = cliRefusalCases({
    "compact-ledger": {
      side: "main-checkout",
      label: "discern compact-ledger",
      cli: { argv: ["compact-ledger"], verb: "compact-ledger" },
    },
    "internal-only-op": { side: "worktree", label: "internal op", cli: null },
  });
  assertEquals(cases, [{
    op: "compact-ledger",
    side: "main-checkout",
    argv: ["compact-ledger"],
    verb: "compact-ledger",
  }]);
});

Deno.test("the side assert accepts only registry keys (compile-level enrolment)", () => {
  // The proof is the directive itself: assertOpSide's op parameter is the
  // registry key union, so a fresh-named op cannot reach the side assert
  // without joining SIDE_RESTRICTED_OPS — where the derived test above picks it
  // up. If the expected error ever vanishes (the parameter widened to string),
  // `deno check` fails this file: the forcing function was removed.
  // @ts-expect-error — a fresh-named op is not a registry key
  const rejected: Parameters<typeof assertOpSide>[0] = "compact-ledger";
  void rejected;
});

Deno.test("update: no-op when the branch already contains main", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "kappa");
    // main has not moved, so the branch is up to date — update touches nothing.
    const r = await runAgent(wt, ["update"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "up to date");
  });
});

Deno.test("update: behind main fast-forwards and re-materializes the agent files", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "lambda");
    const branchTipBeforeUpdate = await gitOut(wt, "rev-parse", "HEAD");
    // Advance main after the worktree branched off it → the branch is behind by one.
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream work", "--no-gpg-sign");
    const mainTip = await gitOut(dir, "rev-parse", "main");
    // Ambient merge.ff=false must not turn discern's fast-forward update into
    // an extra merge commit.
    await git(wt, "config", "merge.ff", "false");
    // Stale an agent file (gitignored, so the tree stays clean to merge into).
    await Deno.writeTextFile(
      join(wt, "CLAUDE.md"),
      "STALE — update must regenerate this\n",
    );

    const r = await runAgent(wt, ["update"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "Fast-forwarded to main");
    assertStringIncludes(r.output, "Update complete");
    // The merge brought main's commit in…
    assert(
      await exists(join(wt, "upstream.txt")),
      `main was not merged into the worktree\n${r.output}`,
    );
    assertEquals(
      await gitOut(
        wt,
        "rev-list",
        "--merges",
        `${branchTipBeforeUpdate}..HEAD`,
      ),
      "",
      "a possible fast-forward must not gain a merge commit",
    );
    assertEquals(
      await gitOut(wt, "merge-base", "--is-ancestor", mainTip, "HEAD"),
      "",
    );
    // …and the stale generated file was re-materialized — the core value of bundling
    // the refresh into update (a bare `git merge` would leave it stale).
    const claude = await Deno.readTextFile(join(wt, "CLAUDE.md"));
    assertEquals(
      claude.includes("STALE"),
      false,
      `CLAUDE.md was not re-materialized\n${claude}`,
    );
    // Skills are (re)materialized into the worktree by the same refresh.
    assert(
      await exists(join(wt, ".claude/skills/discern-write-adr/SKILL.md")),
      `skills not materialized by update\n${r.output}`,
    );
  });
});

Deno.test("update: ignores untracked local scratch when checking whether the worktree is dirty", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "lambda-scratch");
    // Advance main after the worktree branched off it, so update has work to do.
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream work", "--no-gpg-sign");
    // Simulate a vendor/session-local permission file. It is untracked and should not
    // make the tracked-change precondition refuse the merge.
    await Deno.mkdir(join(wt, ".codex"), { recursive: true });
    await Deno.writeTextFile(
      join(wt, ".codex/session.local.toml"),
      "permission = 'local'\n",
    );

    const r = await runAgent(wt, ["update"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "Fast-forwarded to main");
    assert(
      await exists(join(wt, "upstream.txt")),
      `main was not merged into the worktree\n${r.output}`,
    );
    assert(
      await exists(join(wt, ".codex/session.local.toml")),
      "the local scratch file should be left alone",
    );
  });
});

Deno.test("update: refuses (non-destructively) when the worktree is dirty", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "mu");
    // Advance main so update would otherwise merge.
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");
    // Leave an uncommitted tracked change in the worktree.
    await Deno.writeTextFile(join(wt, "wip.txt"), "uncommitted\n");
    await git(wt, "add", "wip.txt");

    const r = await runAgent(wt, ["update"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(
      r.output,
      "discern: This worktree has uncommitted tracked changes",
    );
    assertStringIncludes(r.output, "Commit or stash");
    // The tree is untouched: the dirty file stays, and main was NOT merged in.
    assert(
      await exists(join(wt, "wip.txt")),
      "the dirty file must be left intact",
    );
    assertEquals(
      await exists(join(wt, "upstream.txt")),
      false,
      `main must not be merged into a dirty worktree\n${r.output}`,
    );
  });
});

Deno.test("update: a conflicting change is reported, and the merge is left aborted (clean tree)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "nu");
    // The worktree branch and main both add the same file with different content,
    // so merging main conflicts.
    await Deno.writeTextFile(join(wt, "shared.txt"), "worktree side\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "worktree edit", "--no-gpg-sign");
    await Deno.writeTextFile(join(dir, "shared.txt"), "main side\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "main edit", "--no-gpg-sign");

    const r = await runAgent(wt, ["update"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "conflicts");
    assertStringIncludes(r.output, "shared.txt");
    // The merge stepped aside cleanly — no half-merge stranded in the worktree.
    assertEquals(
      await gitOut(wt, "status", "--porcelain"),
      "",
      `update must abort the conflicting merge, leaving a clean tree\n${r.output}`,
    );
    // The worktree keeps its own commit (its side of shared.txt).
    assertEquals(
      await Deno.readTextFile(join(wt, "shared.txt")),
      "worktree side\n",
    );
  });
});

Deno.test("update --dry-run: previews the merge + refresh and touches nothing", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "xi");
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

    const r = await runAgent(wt, ["update", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "Update plan");
    assertStringIncludes(r.output, "Behind by: 1");
    // The preview merged nothing — main's commit is still absent in the worktree.
    assertEquals(
      await exists(join(wt, "upstream.txt")),
      false,
      `--dry-run must not merge\n${r.output}`,
    );
  });
});

Deno.test("update end-to-end: a behind finish points at update, which then unblocks a passing finish", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "omicron");
    // Advance main → the worktree branch is behind by one.
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "advance main", "--no-gpg-sign");

    // 1. finish fails fast on the merge check and names the remedy — the verb, not a
    //    bare `git merge` (the rest of the gate never runs).
    const behind = await runAgent(wt, ["done"]);
    assertEquals(behind.code, 1, behind.output);
    assertStringIncludes(behind.output, "discern update");

    // 2. update brings main in AND re-materializes in one step.
    const integ = await runAgent(wt, ["update"]);
    assertEquals(integ.code, 0, integ.output);
    assert(
      await exists(join(wt, "upstream.txt")),
      `update did not merge main\n${integ.output}`,
    );

    // 3. finish now passes against the merged, re-materialized tree — with no
    //    intervening `discern refresh` (the bundled refresh already made it current).
    const after = await runAgent(wt, ["done"]);
    assertEquals(after.code, 0, after.output);
  });
});

Deno.test("identity resolves the worktree identity (id + branch)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "epsilon");
    const id = await runAgent(wt, ["identity", "--id"]);
    assertEquals(id.code, 0, id.output);
    assertStringIncludes(id.stdout, "epsilon");
    const branch = await runAgent(wt, ["identity", "--branch"]);
    assertEquals(branch.code, 0, branch.output);
    assertStringIncludes(branch.stdout, "epsilon");
  });
});

Deno.test("worktree teardown runs the (no-op) adapter seams cleanly", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "eta");
    const r = await runAgent(wt, ["worktree", "teardown"]);
    assertEquals(r.code, 0, r.output);
  });
});

Deno.test("worktree prune --yes reclaims a fully-merged worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "zeta");
    await Deno.writeTextFile(join(wt, "z.txt"), "z\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "z", "--no-gpg-sign");
    // Merge the branch into main so it is fully merged → prune may reclaim it.
    await git(dir, "merge", "--no-ff", "-m", "merge zeta", "agent/zeta");

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `fully-merged worktree should be pruned\n${r.output}`,
    );
  });
});

Deno.test("worktree prune keeps a sibling worktree that still has unmerged work", async () => {
  await withTempDir(async (dir) => {
    const live = await mainWithWorktree(dir, "live");
    // The sibling carries an unmerged commit — pruning must preserve it and
    // never clobber live work in a child worktree.
    await Deno.writeTextFile(join(live, "wip.txt"), "wip\n");
    await git(live, "add", "-A");
    await git(live, "commit", "-q", "-m", "wip", "--no-gpg-sign");

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(live),
      true,
      `a live, unmerged worktree must NOT be pruned\n${r.output}`,
    );
  });
});

Deno.test("status and worktree prune keep a fully-merged worktree with uncommitted changes", async () => {
  await withTempDir(async (dir) => {
    const dirty = await mainWithWorktree(dir, "dirty-merged");
    await Deno.writeTextFile(join(dirty, "tracked.txt"), "merged\n");
    await git(dirty, "add", "-A");
    await git(dirty, "commit", "-q", "-m", "merged work", "--no-gpg-sign");
    await git(
      dir,
      "merge",
      "--no-ff",
      "-m",
      "merge dirty",
      "agent/dirty-merged",
    );

    await Deno.writeTextFile(join(dirty, "tracked.txt"), "dirty tracked\n");
    await Deno.writeTextFile(join(dirty, "untracked.txt"), "dirty untracked\n");

    const status = await runAgent(dir, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    const row = JSON.parse(status.stdout).data.fleet.find(
      (e: { branch: string }) => e.branch === "agent/dirty-merged",
    );
    assert(row, `expected agent/dirty-merged in fleet\n${status.stdout}`);
    assertEquals(row.clean, false);
    assertEquals(row.changed_files, 2);

    const dry = await runAgent(dir, ["worktree", "prune", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertStringIncludes(dry.output, "(nothing to do)");
    assert(
      await exists(dirty),
      `dry-run prune must not remove the dirty worktree\n${dry.output}`,
    );

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(dirty),
      `dirty merged worktree must not be pruned\n${r.output}`,
    );
    assertStringIncludes(r.output, "dirty 2 status entries");
    assertEquals(
      await Deno.readTextFile(join(dirty, "tracked.txt")),
      "dirty tracked\n",
    );
    assertEquals(
      await Deno.readTextFile(join(dirty, "untracked.txt")),
      "dirty untracked\n",
    );
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", "agent/dirty-merged"),
      "agent/dirty-merged",
      `a kept worktree's checked-out branch must not be deleted\n${r.output}`,
    );
  });
});

Deno.test("worktree prune --yes keeps a clean detached worktree whose HEAD is not merged", async () => {
  await withTempDir(async (dir) => {
    const detached = await mainWithWorktree(dir, "detached-unmerged");
    await git(detached, "checkout", "--detach");
    await Deno.writeTextFile(join(detached, "detached.txt"), "detached work\n");
    await git(detached, "add", "-A");
    await git(
      detached,
      "commit",
      "-q",
      "-m",
      "detached work",
      "--no-gpg-sign",
    );
    const detachedHead = await gitOut(detached, "rev-parse", "HEAD");

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(detached),
      `detached unmerged worktree must not be pruned\n${r.output}`,
    );
    assertStringIncludes(r.output, "detached HEAD has unmerged commits");
    assertEquals(await gitOut(detached, "rev-parse", "HEAD"), detachedHead);
    assertEquals(
      await Deno.readTextFile(join(detached, "detached.txt")),
      "detached work\n",
    );
  });
});

/** Parse a `discern start --json` apply result. */
interface StartResult {
  ok: boolean;
  verb: string;
  message: string;
  data: { id: string; branch: string; path: string; name_note?: string };
  hints: string[];
}

Deno.test("start: from the main checkout creates a set-up sibling worktree and returns its path", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as StartResult;
    assertEquals(result.ok, true);
    assertEquals(result.verb, "start");

    const { id, branch, path } = result.data;
    assertEquals(
      result.message,
      `Created worktree '${id}' at ${path} (branch ${branch}).`,
    );
    // The branch is the fresh agent/<id> the worktree was created on.
    assertEquals(branch, `agent/${id}`);
    // It lands in the SIBLING placement (never nested inside the repo), exactly where
    // the production resolver puts it — so a minted id round-trips through worktreePath.
    // (The verb resolves its root via findRoot, which canonicalizes /var → /private/var
    // on macOS, so compare against the canonicalized repo dir.)
    const realDir = await Deno.realPath(dir);
    assert(
      !path.startsWith(`${realDir}/`),
      `must not nest inside the repo: ${path}`,
    );
    assertStringIncludes(path, `${basename(dir)}.worktrees`);
    assertEquals(path, worktreePath(realDir, id));
    // It is genuinely set up: setup materialized the agent files inside the worktree.
    assert(
      await exists(join(path, "CLAUDE.md")),
      `setup didn't run in ${path}`,
    );
    // …and it is checked out on its own branch.
    assertEquals(await gitOut(path, "branch", "--show-current"), `agent/${id}`);
    // The result carries the re-root instruction (the agent must move into the path).
    assertHasHint(result, HINTS["start-re-root"], { dir: path });
  });
});

Deno.test("start --from: branch-owned guidance is refreshed by the new worktree's engine", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
    await addSourceEngine(dir);
    await gitInit(dir);

    const fromRef = "unlanded-guidance";
    const marker = "Branch-owned built-in guidance";
    await git(dir, "switch", "-q", "-c", fromRef);
    const builtIn = join(dir, "templates/guidance/worktrees.md");
    await Deno.writeTextFile(
      builtIn,
      `${await Deno.readTextFile(
        builtIn,
      )}\n\n## ${marker}\n\nKeep this branch-owned marker.\n`,
    );
    const refresh = await runCheckoutEngine(dir, ["refresh", "--json"]);
    assertEquals(refresh.code, 0, refresh.output);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "AGENTS.md")),
      marker,
      "the from-ref should commit agent files composed by its own engine",
    );
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "change bundled guidance",
      "--no-gpg-sign",
    );
    await git(dir, "switch", "-q", "main");

    const started = await runAgent(dir, [
      "start",
      "--from",
      fromRef,
      "--name",
      "branch guidance",
      "--json",
    ]);
    assertEquals(started.code, 0, started.output);
    const result = JSON.parse(started.stdout) as StartResult;

    assertStringIncludes(
      await Deno.readTextFile(join(result.data.path, "AGENTS.md")),
      marker,
      "start must not rewrite the from-ref with the launching engine's bundled guidance",
    );
    assertEquals(
      await gitOut(result.data.path, "status", "--porcelain"),
      "",
      "start --from must leave branch-committed generated files clean",
    );
  });
});

Deno.test("start --name: derives the branch from the name and reports the normalisation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // A messy, human-phrased name — spaces, case, trailing punctuation — is exactly
    // what a weaker agent might pass; discern must turn it into a clean branch itself.
    const r = await runAgent(dir, [
      "start",
      "--name",
      "Fix the Upload Retry!",
      "--json",
    ]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as StartResult;
    assertEquals(result.ok, true);

    const { id, branch, name_note, path } = result.data;
    // The id/branch carry the slugified name; the hex tail keeps them unique.
    assertMatch(id, /^fix-the-upload-retry-[0-9a-f]{6}$/);
    assertEquals(branch, `agent/${id}`);
    // The worktree really landed on that branch (not just a reported string).
    assertEquals(await gitOut(path, "branch", "--show-current"), branch);
    // The normalisation is surfaced in the data AND leads the hints, so the caller
    // sees what the worktree was actually named.
    const expected = assertHasHint(result, HINTS["start-name-normalized"], {
      name: "Fix the Upload Retry!",
      slug: "fix-the-upload-retry",
    });
    assertEquals(name_note, expected);
    assertEquals(result.hints[0], expected, "name_note should lead the hints");
  });
});

Deno.test("start: refuses from inside a worktree (main-checkout-only)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "alpha");
    const r = await runAgent(wt, ["start", "--json"]);
    assertEquals(r.code, 1, r.output);
    const result = JSON.parse(r.stdout);
    assertEquals(result.ok, false);
    assertEquals(result.verb, "start");
    // Mapped to the same precondition slug accept/update use from the main checkout.
    assertEquals(result.error, "precondition_failed");
    // It must NOT have created a nested worktree of its own.
    assertEquals(
      await exists(`${wt}.worktrees`),
      false,
      "refusal must touch nothing",
    );
  });
});

Deno.test("start: mints a fresh, unique id on each call (never re-mints a live worktree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const first = JSON.parse((await runAgent(dir, ["start", "--json"])).stdout)
      .data as StartResult["data"];
    const second = JSON.parse((await runAgent(dir, ["start", "--json"])).stdout)
      .data as StartResult["data"];

    assert(first.id !== second.id, `ids must differ across calls: ${first.id}`);
    assert(first.path !== second.path, "each start lands in its own directory");
    // Both worktrees exist, fully set up, on distinct branches.
    assert(
      await exists(join(first.path, "CLAUDE.md")),
      "first worktree set up",
    );
    assert(
      await exists(join(second.path, "CLAUDE.md")),
      "second worktree set up",
    );
    assertEquals(
      await gitOut(second.path, "branch", "--show-current"),
      second.branch,
    );
  });
});

Deno.test("start (human): announces the new worktree and how to cd into it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["start"]); // human mode (no --json)
    assertEquals(r.code, 0, r.output);
    // Setup narrated, then the path + the "cd into it" deliverable.
    assertStringIncludes(r.output, "is ready at");
    assertStringIncludes(r.output, "cd ");
    assertStringIncludes(r.output, `${basename(dir)}.worktrees`);
  });
});

Deno.test("start --dry-run: previews creating a worktree and touches nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["start", "--json", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout);
    assertEquals(result.dry_run, true);
    assertEquals(result.plan.title, "Start plan");
    // A dry-run mints an id for the preview but creates no worktree at all.
    assertEquals(
      await exists(`${dir}.worktrees`),
      false,
      `dry-run must not create the sibling worktree root\n${r.output}`,
    );
  });
});

// ── [worktree.setup]: one-shot `steps` vs convergent `ensure` (ADR 0059) ───────

/** Scaffold a main repo whose `[worktree.setup]` carries `steps`/`ensure`, commit
 * it, and add a linked worktree that inherits it on a CLEAN tree (so update,
 * which refuses a dirty tree, still applies). The commands are baked into the
 * committed config — the worktree carries them like a real checkout. */
async function mainWithSetup(
  dir: string,
  name: string,
  setup: {
    steps?: string[];
    ensure?: string[];
    repositoryEnsure?: string[];
  },
): Promise<string> {
  await scaffoldEngine(dir);
  const cfgPath = join(dir, "discern.toml");
  const editor = new TomlEditor(await Deno.readTextFile(cfgPath));
  if (setup.steps !== undefined) {
    editor.setStringArray("worktree.setup.steps", setup.steps);
  }
  if (setup.ensure !== undefined) {
    editor.setStringArray("worktree.setup.ensure", setup.ensure);
  }
  if (setup.repositoryEnsure !== undefined) {
    editor.setStringArray("repository.ensure", setup.repositoryEnsure);
  }
  await writeDiscernToml(cfgPath, editor.toString());
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** Run `fn` with a fresh marker directory OUTSIDE any repo (so a `git add -A` in
 * the main checkout never stages it). A setup command appends a line here per run;
 * the line count proves how many times that bucket ran. Cleaned up after. */
async function withMarkers(
  fn: (markers: string) => Promise<void>,
): Promise<void> {
  const markers = await Deno.makeTempDir({ prefix: "discern-markers-" });
  try {
    await fn(markers);
  } finally {
    await Deno.remove(markers, { recursive: true });
  }
}

/** How many times a marker command ran (non-empty lines appended); 0 when the file
 * was never created (the command never ran). */
async function markerCount(path: string): Promise<number> {
  try {
    return (await Deno.readTextFile(path)).split("\n").filter((l) => l !== "")
      .length;
  } catch {
    return 0;
  }
}

Deno.test("worktree setup: runs the one-shot steps then the convergent ensure", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const steps = join(markers, "steps");
      const ensure = join(markers, "ensure");
      const wt = await mainWithSetup(dir, "setup-both", {
        steps: [`echo x >> ${steps}`],
        ensure: [`echo x >> ${ensure}`],
      });
      const r = await runAgent(wt, ["worktree", "setup"]);
      assertEquals(r.code, 0, r.output);
      assertEquals(await markerCount(steps), 1, `steps ran once\n${r.output}`);
      assertEquals(await markerCount(ensure), 1, `ensure ran\n${r.output}`);
    });
  });
});

Deno.test("worktree setup: shared repository convergence precedes worktree-only convergence", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const order = join(markers, "order");
      const wt = await mainWithSetup(dir, "shared-before-specific", {
        repositoryEnsure: [`echo repository >> ${order}`],
        ensure: [`echo worktree >> ${order}`],
      });
      const run = await runAgent(wt, ["worktree", "setup", "--json"]);
      assertEquals(run.code, 0, run.output);
      assertEquals(
        (await Deno.readTextFile(order)).trim().split("\n"),
        ["repository", "worktree"],
      );
      const result = JSON.parse(run.stdout) as {
        steps: Array<{ kind: string; outcome: string }>;
      };
      assert(
        result.steps.some((step) =>
          step.kind === "repository-ensure" && step.outcome === "ok"
        ),
        run.stdout,
      );
      assert(
        result.steps.some((step) =>
          step.kind === "setup-ensure" && step.outcome === "ok"
        ),
        run.stdout,
      );
    });
  });
});

Deno.test("worktree setup re-entry: skips the one-shot steps, re-runs ensure", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const steps = join(markers, "steps");
      const ensure = join(markers, "ensure");
      const wt = await mainWithSetup(dir, "reentry", {
        steps: [`echo x >> ${steps}`],
        ensure: [`echo x >> ${ensure}`],
      });
      await runAgent(wt, ["worktree", "setup"]); // creation: steps 1, ensure 1
      const again = await runAgent(wt, ["worktree", "setup"]); // re-entry
      assertEquals(again.code, 0, again.output);
      assertStringIncludes(again.output, "skipping setup steps");
      assertEquals(
        await markerCount(steps),
        1,
        "the one-shot steps must not re-run on re-entry",
      );
      assertEquals(
        await markerCount(ensure),
        2,
        "the convergent ensure must re-run on re-entry",
      );
    });
  });
});

Deno.test("worktree ensure converges via [worktree.setup].ensure on every session start", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const ensure = join(markers, "ensure");
      const repositoryEnsure = join(markers, "repository-ensure");
      const wt = await mainWithSetup(dir, "wt-ensure", {
        ensure: [`echo x >> ${ensure}`],
        repositoryEnsure: [`echo x >> ${repositoryEnsure}`],
      });
      await runAgent(wt, ["worktree", "ensure"]); // first: fresh setup → ensure 1
      await runAgent(wt, ["worktree", "ensure"]); // already configured → ensure 2
      assertEquals(
        await markerCount(ensure),
        2,
        "session-start ensure must converge the worktree each time",
      );
      assertEquals(
        await markerCount(repositoryEnsure),
        2,
        "session-start ensure must rerun shared repository convergence each time",
      );
    });
  });
});

Deno.test("worktree ensure: a successful ensure command's output never leaks into session-start stdout", async () => {
  await withTempDir(async (dir) => {
    // The SessionStart hook runs `worktree ensure` and Claude Code injects its STDOUT
    // as agent context, so a chatty ensure command (a `vale sync` progress bar) must
    // not surface there. The command prints `OUT42END` only when it RUNS — the marker
    // is absent from the command text, so the "Ensure step: …" narration can't
    // false-match; it appears in the captured output alone.
    const wt = await mainWithSetup(dir, "quiet-ensure", {
      ensure: ["echo OUT$((6*7))END"],
    });
    const r = await runAgent(wt, ["worktree", "ensure"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      r.output.includes("OUT42END"),
      false,
      `a successful ensure command must be captured, not leaked to the session\n${r.output}`,
    );
  });
});

Deno.test("worktree setup --dry-run: lists the ensure commands it would run", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithSetup(dir, "dry", {
      steps: ["echo once-only"],
      ensure: ["echo converge-me"],
    });
    const r = await runAgent(wt, ["worktree", "setup", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "echo once-only");
    assertStringIncludes(r.output, "echo converge-me");
  });
});

Deno.test("worktree setup: a failing ensure at creation is fatal (aborts setup)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithSetup(dir, "fatal-ensure", { ensure: ["exit 7"] });
    const r = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "worktree ensure step failed");
    // Aborted before the agent-file refresh + sentinel — setup never completed.
    assertEquals(
      r.output.includes("Worktree setup complete"),
      false,
      `a fatal ensure must abort setup\n${r.output}`,
    );
    assertEquals(
      await exists(join(wt, "CLAUDE.md")),
      false,
      "the agent-file refresh must not run after a fatal ensure",
    );
  });
});

Deno.test("update: re-runs [worktree.setup].ensure after the merge", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const ensure = join(markers, "ensure");
      const repositoryEnsure = join(markers, "repository-ensure");
      const wt = await mainWithSetup(dir, "integ-ensure", {
        ensure: [`echo x >> ${ensure}`],
        repositoryEnsure: [`echo x >> ${repositoryEnsure}`],
      });
      // Advance main so the branch is behind by one. (No prior `worktree` setup —
      // that would record the port into an untracked .env and dirty the tree, which
      // update refuses; the ensure here runs purely as part of update.)
      await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

      const r = await runAgent(wt, ["update"]);
      assertEquals(r.code, 0, r.output);
      assertStringIncludes(r.output, "Update complete");
      assert(
        await exists(join(wt, "upstream.txt")),
        `merge landed\n${r.output}`,
      );
      assertEquals(
        await markerCount(ensure),
        1,
        `update must run ensure after the merge\n${r.output}`,
      );
      assertEquals(
        await markerCount(repositoryEnsure),
        1,
        `update must run shared repository convergence after the merge\n${r.output}`,
      );
    });
  });
});

Deno.test("update: a failing ensure is recorded but never undoes the merge", async () => {
  await withTempDir(async (dir) => {
    // The ensure fails once the merge brings upstream.txt in. (No prior `worktree`
    // setup — it would dirty the tree via .env and update would refuse; the
    // ensure here runs only as update's post-merge convergence step.)
    const wt = await mainWithSetup(dir, "integ-fail", {
      ensure: ["test ! -f upstream.txt"],
    });
    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

    const r = await runAgent(wt, ["update", "--json"]);
    // Non-fatal: the failed ensure does not abort or undo the landed merge.
    assertEquals(r.code, 0, r.output);
    assert(await exists(join(wt, "upstream.txt")), "the merge must be kept");
    const result = JSON.parse(r.stdout) as {
      ok: boolean;
      steps: Array<{ kind: string; label: string; outcome: string }>;
    };
    const mergeStep = result.steps.find((s) =>
      s.kind === "git" && s.label === "merge"
    );
    assert(mergeStep?.outcome === "ok", `merge recorded ok\n${r.stdout}`);
    const ensureStep = result.steps.find((s) => s.kind === "setup-ensure");
    assertEquals(
      ensureStep?.outcome,
      "failed",
      `the failing ensure is recorded as a failed step\n${r.stdout}`,
    );
    // A failed sub-step makes the result not-ok, mirroring a failed refresh.
    assertEquals(
      result.ok,
      false,
      `result.ok reflects the failed ensure\n${r.stdout}`,
    );
  });
});

Deno.test("update: a partial refresh is recorded but never undoes the merge", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "integ-refresh-fail");
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(wt, ".mcp.json"), malformed);
    await git(wt, "add", ".mcp.json");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "add malformed mcp config",
      "--no-gpg-sign",
    );

    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "upstream", "--no-gpg-sign");

    const r = await runAgent(wt, ["update", "--json"]);
    assertEquals(r.code, 0, r.output);
    assert(await exists(join(wt, "upstream.txt")), "the merge must be kept");
    const result = JSON.parse(r.stdout) as {
      ok: boolean;
      steps: Array<{ kind: string; label: string; outcome: string }>;
    };
    const mergeStep = result.steps.find((s) =>
      s.kind === "git" && s.label === "merge"
    );
    assertEquals(mergeStep?.outcome, "ok", `merge recorded ok\n${r.stdout}`);
    const refreshStep = result.steps.find((s) => s.kind === "refresh");
    assertEquals(
      refreshStep?.outcome,
      "failed",
      `the partial refresh is recorded as a failed step\n${r.stdout}`,
    );
    assertEquals(
      result.ok,
      false,
      `result.ok reflects the partial refresh\n${r.stdout}`,
    );
  });
});

// ── start: submodule disclosure ─────────────────────────────────────────────────
// `git worktree add` checks out `.gitmodules` but leaves every submodule
// directory empty. `start` discloses that at creation time — unless a
// configured lifecycle command already mentions submodules, in which case the
// project has an answer and the notice would be noise.

const GITMODULES =
  '[submodule "vendor/lib"]\n\tpath = vendor/lib\n\turl = ../lib.git\n';

Deno.test("start: hints when the fresh worktree carries .gitmodules and nothing populates it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.writeTextFile(join(dir, ".gitmodules"), GITMODULES);
    await gitInit(dir);

    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as StartResult;
    assertHasHint(result, HINTS["start-submodules-empty"]);
  });
});

Deno.test("start: no submodule hint once a configured command mentions submodules", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const configPath = join(dir, "discern.toml");
    const toml = await Deno.readTextFile(configPath);
    assert(
      toml.includes("ensure = []"),
      "the scaffold seeds an empty [repository].ensure for this test to fill",
    );
    await Deno.writeTextFile(
      configPath,
      toml.replace(
        "ensure = []",
        'ensure = ["git submodule update --init --recursive"]',
      ),
    );
    await Deno.writeTextFile(join(dir, ".gitmodules"), GITMODULES);
    await gitInit(dir);

    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = JSON.parse(r.stdout) as StartResult;
    assert(result.ok, "start succeeds with the ensure command wired");
    assert(
      result.hints.every((h) => !h.includes("submodule")),
      `no submodule hint expected: ${JSON.stringify(result.hints)}`,
    );
  });
});

Deno.test("submoduleCommandWired scans every lifecycle command surface", () => {
  const parse = (overrides: Record<string, unknown>): DiscernConfig =>
    configSchema.parse(overrides);
  assert(!submoduleCommandWired(parse({})));
  assert(submoduleCommandWired(parse({
    repository: { ensure: ["git submodule update --init --recursive"] },
  })));
  assert(submoduleCommandWired(parse({
    worktree: { setup: { steps: ["git submodule update --init"] } },
  })));
  assert(submoduleCommandWired(parse({
    worktree: { setup: { ensure: ["scripts/sync-submodules"] } },
  })));
  assert(submoduleCommandWired(parse({
    worktree: {
      resources: { vendor: { create: "git submodule update --init" } },
    },
  })));
});
