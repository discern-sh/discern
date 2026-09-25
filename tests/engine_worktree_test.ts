/**
 * Engine coverage for the isolated-worktree lifecycle — the repo's flagship
 * workflow, and (until now) its largest untested surface.
 *
 * These commands run from git hooks, not `discern done`, so the gate is otherwise
 * blind to them: a regression here would ship green. (The noglob break in
 * `instructions` hid on exactly this path — the worktree-create hook runs it.)
 * Each test drives a REAL linked worktree in a hermetic git repo and shells out
 * to the dispatcher, so the bytes under test are what an install runs.
 *
 * Guards: claim:isolated-worktrees, claim:no-checkout-collisions
 */

import { renderCommandRefsCli } from "../src/shared/command_reference.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { basename, dirname, fromFileUrl, join } from "@std/path";
import { copy } from "@std/fs";
import { readTextIfExists, targetExists } from "../src/shared/fs_presence.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import {
  formatMarkdownText,
  writeDiscernToml,
} from "../src/lib/tidy_format.ts";
import { HINTS } from "../src/shared/hints.ts";
import { driverKind } from "../src/engine/logbook/cohorts.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { BUILT_IN_STEP_LABELS } from "../src/shared/result.ts";
import {
  configuredSetupSteps,
  readSetupStepJournal,
  runJournaledSetupSteps,
} from "../src/engine/worktree/setup_step_journal.ts";
import {
  configSchema,
  type DiscernConfig,
} from "../src/shared/config_schema.ts";
import { submoduleCommandWired } from "../src/engine/worktree/lifecycle.ts";
import {
  type assertOpSide,
  readySentinelPath,
} from "../src/engine/worktree/git.ts";
import {
  cliRefusalCases,
  SIDE_RESTRICTED_OPS,
} from "../src/engine/worktree/side_restrictions.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  readLogbookEvents,
  runAgent,
  scaffoldEngine,
  worktreePath,
  writeConfig,
} from "./engine_helpers.ts";

type StartData = Exclude<
  NonNullable<CliResultForCommand<"start">["data"]>,
  { issues: unknown }
>;

/** Decode successful start data and exclude shared configuration refusals. */
function decodeStartData(stdout: string): StartData {
  const result = decodeCliResult(stdout, "start");
  assertResultDataKey(result, "path");
  return result.data;
}

const SOURCE_ROOT = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = dirname(SOURCE_ROOT);
const DECODER = new TextDecoder();

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/** A raw Git fixture carrying discern's positive fleet-ownership marker. */
async function ownedWorktree(dir: string, name: string): Promise<string> {
  const worktree = await mainWithWorktree(dir, name);
  const marker = await readySentinelPath(worktree);
  assert(marker !== undefined, "fixture worktree must have Git-admin state");
  await Deno.mkdir(dirname(marker), { recursive: true });
  await Deno.writeTextFile(marker, "");
  return worktree;
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
 * different compiler or bundled instructions, and a worktree created from that ref
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

/** Add a unique authored instructions heading and commit it on the accepting branch. */
async function commitInstructionMarker(
  wt: string,
  marker: string,
): Promise<void> {
  const instructions = join(wt, "discern/instructions.md");
  await Deno.mkdir(join(wt, "discern"), { recursive: true });
  const existing = (await readTextIfExists(instructions)) ?? "";
  await Deno.writeTextFile(
    instructions,
    await formatMarkdownText(
      instructions,
      `${existing}\n\n## ${marker}\n\nKeep this marker visible in generated instructions.\n`,
    ),
  );
  const refreshed = await runAgent(wt, ["refresh", "--json"]);
  assertEquals(refreshed.code, 0, refreshed.output);
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "update instructions", "--no-gpg-sign");
}

/** Prove the fast-forward carried current branch instructions into main. */
async function assertLandedInstructionCurrent(
  dir: string,
  marker: string,
): Promise<void> {
  assertStringIncludes(
    await Deno.readTextFile(join(dir, "CLAUDE.md")),
    marker,
    "the landed commit should carry its generated instructions",
  );
  const status = await runAgent(dir, ["status", "--json"]);
  assertEquals(status.code, 0, status.output);
  const result = decodeCliResult(status.stdout, "status");
  assertResultDataKey(result, "location");
  assertEquals(result.data.pending_tracked_refresh, undefined);
}

Deno.test("worktree setup: refreshes agent files and links skills inside the worktree", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "alpha");
    const r = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await targetExists(join(wt, "CLAUDE.md")),
      `CLAUDE.md missing\n${r.output}`,
    );
    assert(
      await targetExists(join(wt, ".claude/skills/discern-write-adr/SKILL.md")),
      `bundled skills not linked in the worktree\n${r.output}`,
    );
    assertTerminalTextIncludes(r.output, "Worktree setup complete");
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
    const statusResult = decodeCliResult(status.stdout, "status");
    assertResultDataKey(statusResult, "location");
    const fleet = statusResult.data.fleet ?? [];
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
    assertTerminalTextIncludes(first.output, "not configured yet");
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
    assertTerminalTextIncludes(r.stdout, expected);
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

/**
 * Prove an acceptance refusal moved nothing: the trunk ref, the worktree
 * checkout, its branch tip and its branch ref are exactly as the green
 * `done` left them.
 */
async function assertProvenWorktreeUntouched(
  dir: string,
  wt: string,
  name: string,
  proven: { readonly trunk: string; readonly head: string },
  output: string,
): Promise<void> {
  assertEquals(
    await gitOut(dir, "rev-parse", "main"),
    proven.trunk,
    `the trunk must not move on refusal\n${output}`,
  );
  assertEquals(
    await targetExists(wt),
    true,
    `the refused worktree must remain intact\n${output}`,
  );
  assertEquals(
    await gitOut(wt, "rev-parse", "HEAD"),
    proven.head,
    `the refused branch tip must not move\n${output}`,
  );
  assertStringIncludes(
    await gitOut(dir, "branch", "--list", `agent/${name}`),
    `agent/${name}`,
    `the branch must not be deleted on refusal\n${output}`,
  );
}

Deno.test("accept: one proven worktree refuses every main-checkout precondition non-destructively, then fast-forwards the trunk", async (t) => {
  await withTempDir(async (dir) => {
    // The prefix every main-checkout refusal shares: a scaffolded main repo,
    // one worktree carrying committed work, and a green `done`. Main also
    // carries a branch that conflicts with its own tip, so a rebase can be
    // left in progress for one refusal and aborted afterwards. Each step
    // perturbs the main checkout, asserts the refusal, restores the
    // perturbation, and proves nothing moved; the landing at the end proves
    // the pooled refusals left the worktree acceptable.
    await scaffoldEngine(dir);
    await gitInit(dir);
    const conflict = join(dir, "rebase-conflict.txt");
    await Deno.writeTextFile(conflict, "base\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "rebase base", "--no-gpg-sign");
    await git(dir, "switch", "-q", "-c", "rebase-source");
    await Deno.writeTextFile(conflict, "source\n");
    await git(dir, "commit", "-q", "-am", "source side", "--no-gpg-sign");
    await git(dir, "switch", "-q", "main");
    await Deno.writeTextFile(conflict, "main\n");
    await git(dir, "commit", "-q", "-am", "main side", "--no-gpg-sign");
    const name = "gamma";
    const wt = await addWorktree(dir, name);
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const proven = {
      trunk: await gitOut(dir, "rev-parse", "main"),
      head: await gitOut(wt, "rev-parse", "HEAD"),
    };

    await t.step(
      "accept: refuses a detached-HEAD main checkout the same way",
      async () => {
        // Detach the main checkout: no branch is checked out at all, so the
        // fast-forward has nothing to land on — the refusal must say so plainly,
        // not crash and not move HEAD.
        await git(dir, "switch", "-q", "--detach", "main");

        const r = await runAgent(wt, ["accept", "--confirmed"]);
        assertEquals(r.code, 1, r.output);
        assertTerminalTextIncludes(r.output, "'(detached)', not 'main'");
        assertTerminalTextIncludes(
          r.output,
          "so return it first",
        );
        assertEquals(
          await gitOut(dir, "branch", "--show-current"),
          "",
          `the detached main checkout must not be moved\n${r.output}`,
        );
        await assertProvenWorktreeUntouched(dir, wt, name, proven, r.output);
        await git(dir, "switch", "-q", "main");
      },
    );

    await t.step(
      "accept names an in-progress main-checkout rebase before suggesting a branch switch",
      async () => {
        const rebase = await new Deno.Command("git", {
          args: ["rebase", "rebase-source"],
          cwd: dir,
          stdout: "piped",
          stderr: "piped",
        }).output();
        assert(rebase.code !== 0, "fixture must stop during a rebase conflict");

        const accepted = await runAgent(wt, ["accept", "--confirmed"]);
        assertEquals(accepted.code, 1, accepted.output);
        assertTerminalTextIncludes(accepted.output, "in-progress rebase");
        assertTerminalTextIncludes(accepted.output, "rebase --continue");
        assertEquals(
          accepted.output.includes("switch main"),
          false,
          accepted.output,
        );
        await git(dir, "rebase", "--abort");
        assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
        await assertProvenWorktreeUntouched(
          dir,
          wt,
          name,
          proven,
          accepted.output,
        );
      },
    );

    await t.step(
      "accept: refuses when the main checkout is parked off the trunk, naming the way back",
      async () => {
        // Park the main checkout on another branch: acceptance must refuse, not
        // silently switch it back.
        await git(dir, "switch", "-q", "-c", "parked-elsewhere");

        const r = await runAgent(wt, ["accept", "--confirmed"]);
        assertEquals(r.code, 1, r.output);
        assertTerminalTextIncludes(r.output, "'parked-elsewhere', not 'main'");
        // The way back is named (path canonicalization may differ, so match the tail).
        assertTerminalTextIncludes(
          r.output,
          "so return it first",
        );
        assertEquals(
          await targetExists(wt),
          true,
          `off-trunk refusal must leave the worktree intact\n${r.output}`,
        );
        assertEquals(
          await gitOut(dir, "branch", "--show-current"),
          "parked-elsewhere",
          `the parked main checkout must not be moved\n${r.output}`,
        );
        await assertProvenWorktreeUntouched(dir, wt, name, proven, r.output);
        await git(dir, "switch", "-q", "main");
        await git(dir, "branch", "-q", "-D", "parked-elsewhere");
      },
    );

    await t.step(
      "accept refuses (non-destructively) when the main checkout is dirty",
      async () => {
        // Dirty a tracked file in main: exit must refuse rather than clobber it.
        const toml = join(dir, "discern.toml");
        const committed = await Deno.readTextFile(toml);
        const dirtied = `${committed}\n# dirty\n`;
        await Deno.writeTextFile(toml, dirtied);

        const r = await runAgent(wt, ["accept", "--confirmed"]);
        assertEquals(r.code, 1, r.output);
        assertTerminalTextIncludes(r.output, "uncommitted tracked changes");
        assertEquals(
          await targetExists(wt),
          true,
          "worktree must be left intact on refusal",
        );
        assertEquals(
          await Deno.readTextFile(toml),
          dirtied,
          "the refusal must preserve the dirty tracked file",
        );
        await assertProvenWorktreeUntouched(dir, wt, name, proven, r.output);
        await Deno.writeTextFile(toml, committed);
        assertEquals(
          await gitOut(dir, "status", "--porcelain", "--untracked-files=no"),
          "",
        );
      },
    );

    await t.step(
      "accept fails closed when main-checkout status is unreadable",
      async () => {
        const wrapper = join(dir, "fail-main-status-git");
        const canonicalMain = await Deno.realPath(dir);
        await Deno.writeTextFile(
          wrapper,
          [
            "#!/bin/sh",
            "top=$(git rev-parse --show-toplevel 2>/dev/null || true)",
            "is_status=false",
            'for arg in "$@"; do',
            '  if [ "$arg" = status ]; then is_status=true; break; fi',
            "done",
            `if [ "$top" = '${canonicalMain}' ] && [ "$is_status" = true ]; then`,
            "  echo 'deliberate main status failure' >&2",
            "  exit 41",
            "fi",
            'exec git "$@"',
            "",
          ].join("\n"),
        );
        await Deno.chmod(wrapper, 0o755);

        const accepted = await runAgent(wt, ["accept", "--confirmed"], {
          env: { GIT_BIN: wrapper },
        });
        assertEquals(accepted.code, 1, accepted.output);
        assertTerminalTextIncludes(
          accepted.output,
          "could not read tracked status",
        );
        assertTerminalTextIncludes(
          accepted.output,
          "deliberate main status failure",
        );
        assertEquals(accepted.output.includes("discern update"), false);
        assertEquals(await gitOut(dir, "rev-parse", "main"), proven.trunk);
        assert(await targetExists(wt));
        await assertProvenWorktreeUntouched(
          dir,
          wt,
          name,
          proven,
          accepted.output,
        );
        await Deno.remove(wrapper);
      },
    );

    await t.step(
      "accept: fast-forwards the trunk, removes the worktree, deletes the merged branch, and ignores untracked local scratch in the main checkout",
      async () => {
        // Untracked local scratch in the main checkout is not a dirty tree: the
        // clean precondition ignores it and the landing leaves it alone.
        await Deno.mkdir(join(dir, ".codex"), { recursive: true });
        await Deno.writeTextFile(
          join(dir, ".codex/session.local.toml"),
          "permission = 'local'\n",
        );

        const r = await runAgent(wt, ["accept", "--confirmed"]);
        assertEquals(r.code, 0, r.output);
        assertEquals(
          await targetExists(wt),
          false,
          `worktree should be removed\n${r.output}`,
        );
        // The work landed on the trunk itself, which stays checked out in main…
        assert(
          await targetExists(join(dir, "feature.txt")),
          `work not fast-forwarded onto the trunk\n${r.output}`,
        );
        assertEquals(
          await gitOut(dir, "branch", "--show-current"),
          "main",
          `main checkout should be on the trunk, not the worktree branch\n${r.output}`,
        );
        // …and the now-merged worktree branch is gone.
        assertEquals(
          await gitOut(dir, "branch", "--list", `agent/${name}`),
          "",
          `the merged branch should be deleted\n${r.output}`,
        );
        assertTerminalTextIncludes(
          r.output,
          "; its checkout, branch, and resources are gone. You are on main in ",
        );
        assert(
          await targetExists(join(dir, ".codex/session.local.toml")),
          "the main checkout's local scratch file should be left alone",
        );
      },
    );
  });
});

Deno.test("accept resolves DISCERN_TRUNK once through done, journal, and exact landing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const mainBefore = await gitOut(dir, "rev-parse", "main");
    await git(dir, "switch", "-q", "-c", "release");
    const wt = await addWorktree(dir, "release-landing");
    await Deno.writeTextFile(join(wt, "release-feature.txt"), "landed\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "release feature", "--no-gpg-sign");
    const target = await gitOut(wt, "rev-parse", "HEAD");
    const env = { [DISCERN_ENVIRONMENT_VARIABLES.trunk]: "release" };

    const done = await runAgent(wt, ["done", "--json"], { env });
    assertEquals(done.code, 0, done.output);
    const accepted = await runAgent(
      wt,
      ["accept", "--confirmed", "--json"],
      { env },
    );
    assertEquals(accepted.code, 0, accepted.output);
    assertEquals(await gitOut(dir, "rev-parse", "release"), target);
    assertEquals(await gitOut(dir, "rev-parse", "main"), mainBefore);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "release");
    assert(await targetExists(join(dir, "release-feature.txt")));
  });
});

Deno.test("accept: materializes only checkout-local artifacts after landing", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "trunk-refresh");
    const marker = "Trunk Acceptance Refresh";
    await commitInstructionMarker(wt, marker);
    const localSkills = join(dir, ".claude/skills");
    if (await targetExists(localSkills)) {
      await Deno.remove(localSkills, { recursive: true });
    }
    assertEquals(
      await targetExists(join(dir, ".claude/skills")),
      false,
      "precondition: the receiving checkout needs local skill materialization",
    );

    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "accept");
    assertEquals(result.ok, true);
    assertExists(result.steps);
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
    await assertLandedInstructionCurrent(dir, marker);
    assert(
      await targetExists(
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
      const done = await runAgent(wt, ["done", "--json"]);
      assertEquals(done.code, 0, done.output);
      const run = await runAgent(wt, ["accept", "--confirmed", "--json"]);
      assertEquals(run.code, 1, run.output);
      assertEquals(
        await targetExists(wt),
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

      const result = decodeCliResult(run.stdout, "accept");
      assertEquals(result.error, "partial_acceptance", run.stdout);
      assertExists(result.steps);
      const repositorySteps = result.steps.filter((step) =>
        step.kind === "repository-ensure"
      );
      assertEquals(repositorySteps.map((step) => step.outcome), [
        "ok",
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
        "the post-landing convergence failure remains visible in the result",
      );
      assertEquals(
        result.diagnostics?.filter((entry) =>
          entry.tool === "repository-ensure"
        ).map((entry) => entry.reproduce_cmd),
        repositorySteps.filter((step) => step.outcome === "failed").map((
          step,
        ) => step.label),
        "every failed post-landing command retains recovery evidence",
      );
      assertHasHint(
        result,
        HINTS["lifecycle-convergence-failed"],
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

    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const run = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(run.code, 1, run.output);
    assertEquals(await targetExists(wt), false, "cleanup removes the worktree");
    assertEquals(
      await gitOut(dir, "branch", "--list", "agent/trunk-smoke-failure"),
      "",
      "cleanup deletes the landed branch",
    );

    const result = decodeCliResult(run.stdout, "accept");
    assertEquals(result.ok, false);
    assertEquals(result.error, "partial_acceptance", run.stdout);
    assertExists(result.steps);
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
    assertHasHint(result, HINTS["lifecycle-convergence-failed"]);
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

    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 1, done.output);
    assertTerminalTextIncludes(done.output, "tracked refresh convergence");
    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEquals(
      await targetExists(wt),
      true,
      `the refused worktree must remain intact\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "branch", "--show-current"),
      "main",
      `the trunk must remain checked out\n${r.output}`,
    );
    assertEquals(
      await targetExists(join(dir, ".mcp.json")),
      false,
      "the malformed branch file must not reach the trunk checkout",
    );
    assertTerminalTextIncludes(
      r.output,
      "has no honored Proof at HEAD, so there is nothing proven to land. " +
        "Run discern done, then discern accept.",
    );
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
    assertTerminalTextIncludes(
      r.output,
      "has no honored Proof at HEAD, so there is nothing proven to land. " +
        "Run discern done, then discern accept.",
    );
    assertEquals(
      await targetExists(wt),
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

Deno.test("accept: refuses a locked worktree read-only until it is unlocked", async () => {
  await withTempDir(async (dir) => {
    // Acceptance removes the worktree after landing, so an explicit Git lock
    // refuses the landing up front with the unlock route.
    const wt = await mainWithWorktree(dir, "locked-grad");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    await git(dir, "worktree", "lock", wt, "--reason", "portable drive");
    const target = await gitOut(wt, "rev-parse", "HEAD");

    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 1, r.output);
    const result = decodeCliResult(r.stdout, "accept");
    assertEquals(result.ok, false);
    assertStringIncludes(
      result.message ?? "",
      `Unlock it first (git worktree unlock ${await Deno.realPath(
        wt,
      )}), then re-run discern accept.`,
    );
    assertEquals(
      await targetExists(wt),
      true,
      `the worktree survives\n${r.output}`,
    );
    assertEquals(
      await gitOut(dir, "rev-parse", "agent/locked-grad"),
      target,
      `the refusal must not move the branch\n${r.output}`,
    );
    assertStringIncludes(
      await gitOut(dir, "branch", "--list", "agent/locked-grad"),
      "agent/locked-grad",
      `the branch keeps its commits\n${r.output}`,
    );

    // Unlocked, the same proven revision lands and the checkout is removed.
    await git(dir, "worktree", "unlock", wt);
    const landed = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
    assertEquals(await targetExists(wt), false);
  });
});

Deno.test("accept: unproven work behind main retains all committed and uncommitted source", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "behind");
    await leaveTrackedAndUntrackedWip(wt);
    const branchHead = await gitOut(dir, "rev-parse", "agent/behind");

    await Deno.writeTextFile(join(dir, "upstream.txt"), "from main\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "advance main", "--no-gpg-sign");

    const r = await runAgent(wt, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(
      r.output,
      "has no honored Proof at HEAD, so there is nothing proven to land. " +
        "Run discern done, then discern accept.",
    );
    assert(
      await targetExists(wt),
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

Deno.test("completion: main moving during validation prevents admission and acceptance", async () => {
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
    assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
    await git(dir, "add", "-A");
    if ((await gitOut(dir, "status", "--porcelain")) !== "") {
      await git(dir, "commit", "-q", "-m", "converge", "--no-gpg-sign");
    }
    const wt = await addWorktree(dir, "race");
    await Deno.writeTextFile(join(wt, "feature.txt"), "work\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const branchHead = await gitOut(wt, "rev-parse", "HEAD");

    // The Proof binds the predecessor pinned at run start; a producer that
    // moves the trunk mid-run leaves a green Proof whose predecessor is
    // stale. Acceptance composes instead of landing it directly, and a
    // trunk that keeps moving — this job moves it on every check — stops
    // the landing after the one bounded recompose.
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    assertEquals(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "race-main",
      "the declared producer really moved trunk",
    );
    const r = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(r.code, 1, r.output);
    const refused = decodeCliResult(r.stdout, "accept");
    assertEquals(refused.ok, false);
    assertStringIncludes(
      refused.message ?? "",
      "moved again while this landing recomposed",
    );
    assertStringIncludes(
      refused.message ?? "",
      "Re-run `discern accept` to compose against the current trunk.",
    );
    assertEquals(
      (await gitOut(dir, "log", "--format=%s", "main")).includes("feature"),
      false,
      `the stopped landing must not land the submission\n${r.output}`,
    );
    assert(
      await targetExists(wt),
      `post-gate trunk-race stop must leave the worktree intact\n${r.output}`,
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

    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const dry = await runAgent(wt, ["accept", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertTerminalTextIncludes(dry.output, "Ignored files changed since setup");
    assertStringIncludes(dry.output, "local-cache/");
    assert(
      !dry.output.includes("generated-0.txt"),
      `ignored drift should collapse a changed directory to its top level\n${dry.output}`,
    );

    const applied = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(applied.code, 0, applied.output);
    const obj = decodeCliResult(applied.stdout, "accept");
    assertResultDataKey(obj, "ignored_file_changes");
    const ignored = obj.data.ignored_file_changes;
    assertExists(ignored);
    assertEquals(ignored.changed_roots, ["local-cache/"]);
    assertEquals(ignored.truncated, false);
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
        "[jobs]",
        'lint = ":"',
        "",
        "[worktree]",
        "track_ignored_drift = false",
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
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);

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
    assertTerminalTextIncludes(r.output, "main checkout");
  });
});

Deno.test("accept: the main checkout cannot progress an unproven queue", async () => {
  await withTempDir(async (dir) => {
    await mainWithWorktree(dir, "iota2");
    // Main-checkout acceptance has no implicit grant or completion evidence.
    const r = await runAgent(dir, ["accept", "--confirmed"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(
      r.output,
      "Run discern accept from the effort's worktree, or select one with " +
        "--target <effort>. No effort has submitted a revision for landing.",
    );
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
  const cases = cliRefusalCases();
  assert(cases.length >= 7, "the registry lost its CLI-reachable members");
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "refusals");
    for (const c of cases) {
      // The wrong side: a worktree-only op runs from the main checkout; a
      // main-only op runs from inside the worktree.
      const from = c.side === "worktree" ? dir : wt;
      const r = await runAgent(from, [...c.argv, "--json"]);
      assertEquals(r.code, 1, `${c.op} from the wrong side: ${r.output}`);
      const result = decodeCliResult(r.stdout, c.verb);
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

Deno.test("the interrupted-acceptance guide keeps recovery commands on their registered side", async () => {
  const guide = await Deno.readTextFile(
    join(
      REPO_ROOT,
      "project/manual/20-guides/recover-an-interrupted-task.md",
    ),
  );
  const recovery = guide.slice(
    guide.indexOf("## Recover an interrupted acceptance"),
    guide.indexOf("## Recover a dropped branch"),
  );
  assertStringIncludes(recovery, "data.root");
  assertStringIncludes(recovery, "surviving checkout");
  assertStringIncludes(recovery, "discern accept --dry-run");
  assertStringIncludes(
    recovery,
    "../30-reference/mcp-and-results.md#completion-and-landing-results",
  );
  const resultReference = await Deno.readTextFile(
    join(REPO_ROOT, "project/manual/30-reference/mcp-and-results.md"),
  );
  // The queue-row vocabulary the derived landing queue actually serves.
  for (const field of ["data.queue", "pre-authorized", "awaiting-owner"]) {
    assertStringIncludes(resultReference, field);
  }
  assertEquals("accept" in SIDE_RESTRICTED_OPS, false);
  assertEquals(SIDE_RESTRICTED_OPS["worktree-prune"].side, "main-checkout");
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
    const refreshed = await runAgent(wt, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await commitCurrentWorktree(wt, "converge generated artifacts");
    // main has not moved, so the branch is up to date — update touches nothing.
    const r = await runAgent(wt, ["update"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.output, "up to date");
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
    assertTerminalTextIncludes(r.output, "Fast-forwarded to main");
    assertTerminalTextIncludes(r.output, "Update complete");
    // The merge brought main's commit in…
    assert(
      await targetExists(join(wt, "upstream.txt")),
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
      await targetExists(join(wt, ".claude/skills/discern-write-adr/SKILL.md")),
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
    assertTerminalTextIncludes(r.output, "Fast-forwarded to main");
    assert(
      await targetExists(join(wt, "upstream.txt")),
      `main was not merged into the worktree\n${r.output}`,
    );
    assert(
      await targetExists(join(wt, ".codex/session.local.toml")),
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
    assertTerminalTextIncludes(
      r.output,
      "✕ This worktree has uncommitted tracked changes",
    );
    assertTerminalTextIncludes(r.output, "Commit or stash");
    // The tree is untouched: the dirty file stays, and main was NOT merged in.
    assert(
      await targetExists(join(wt, "wip.txt")),
      "the dirty file must be left intact",
    );
    assertEquals(
      await targetExists(join(wt, "upstream.txt")),
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
    assertTerminalTextIncludes(r.output, "Update plan");
    assertTerminalTextIncludes(r.output, "Behind by: 1");
    // The preview merged nothing — main's commit is still absent in the worktree.
    assertEquals(
      await targetExists(join(wt, "upstream.txt")),
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
    assertTerminalTextIncludes(behind.output, "discern update");

    // 2. update brings main in AND re-materializes in one step.
    const integ = await runAgent(wt, ["update"]);
    assertEquals(integ.code, 0, integ.output);
    assert(
      await targetExists(join(wt, "upstream.txt")),
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
    const wt = await ownedWorktree(dir, "zeta");
    await Deno.writeTextFile(join(wt, "z.txt"), "z\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "z", "--no-gpg-sign");
    // Merge the branch into main so it is fully merged → prune may reclaim it.
    await git(dir, "merge", "--no-ff", "-m", "merge zeta", "agent/zeta");

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await targetExists(wt),
      false,
      `fully-merged worktree should be pruned\n${r.output}`,
    );
  });
});

Deno.test("worktree prune keeps a sibling worktree that still has unmerged work", async () => {
  await withTempDir(async (dir) => {
    const live = await ownedWorktree(dir, "live");
    // The sibling carries an unmerged commit — pruning must preserve it and
    // never clobber live work in a child worktree.
    await Deno.writeTextFile(join(live, "wip.txt"), "wip\n");
    await git(live, "add", "-A");
    await git(live, "commit", "-q", "-m", "wip", "--no-gpg-sign");

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await targetExists(live),
      true,
      `a live, unmerged worktree must NOT be pruned\n${r.output}`,
    );
  });
});

Deno.test("status and worktree prune keep a fully-merged worktree with uncommitted changes", async () => {
  await withTempDir(async (dir) => {
    const dirty = await ownedWorktree(dir, "dirty-merged");
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
    const statusResult = decodeCliResult(status.stdout, "status");
    assertResultDataKey(statusResult, "location");
    const row = statusResult.data.fleet?.find(
      (e) => e.branch === "agent/dirty-merged",
    );
    assert(row, `expected agent/dirty-merged in fleet\n${status.stdout}`);
    assertEquals(row.clean, false);
    assertEquals(row.changed_files, 2);

    const dry = await runAgent(dir, ["worktree", "prune", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertTerminalTextIncludes(dry.output, "(nothing to do)");
    assert(
      await targetExists(dirty),
      `dry-run prune must not remove the dirty worktree\n${dry.output}`,
    );

    const r = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await targetExists(dirty),
      `dirty merged worktree must not be pruned\n${r.output}`,
    );
    assertTerminalTextIncludes(r.output, "dirty 2 status entries");
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
    const detached = await ownedWorktree(dir, "detached-unmerged");
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
      await targetExists(detached),
      `detached unmerged worktree must not be pruned\n${r.output}`,
    );
    assertTerminalTextIncludes(r.output, "detached HEAD has unmerged commits");
    assertEquals(await gitOut(detached, "rev-parse", "HEAD"), detachedHead);
    assertEquals(
      await Deno.readTextFile(join(detached, "detached.txt")),
      "detached work\n",
    );
  });
});

Deno.test("start: from the main checkout creates a set-up sibling worktree and returns its path", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["start", "--json"]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "start");
    assertEquals(result.ok, true);
    assertEquals(result.verb, "start");
    assertResultDataKey(result, "path");

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
      await targetExists(join(path, "CLAUDE.md")),
      `setup didn't run in ${path}`,
    );
    // …and it is checked out on its own branch.
    assertEquals(await gitOut(path, "branch", "--show-current"), `agent/${id}`);
    // The result carries the re-root instruction (the agent must move into the path).
    assertHasHint(result, HINTS["start-re-root"], { dir: path });
  });
});

Deno.test("start --from: branch-owned instructions are refreshed by the new worktree's engine", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
    await addSourceEngine(dir);
    await gitInit(dir);

    const fromRef = "unlanded-instructions";
    const marker = "Branch-owned built-in instructions";
    await git(dir, "switch", "-q", "-c", fromRef);
    const builtIn = join(dir, "templates/instructions/worktrees.md");
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
      "change bundled instructions",
      "--no-gpg-sign",
    );
    await git(dir, "switch", "-q", "main");

    const started = await runAgent(dir, [
      "start",
      "--from",
      fromRef,
      "--name",
      "branch instructions",
      "--json",
    ]);
    assertEquals(started.code, 0, started.output);
    const result = decodeCliResult(started.stdout, "start");
    assertResultDataKey(result, "path");

    const events = await readLogbookEvents(dir);
    const parent = events.find((event) =>
      event.kind === "begin" && event.verb === "start"
    );
    assert(parent?.kind === "begin");
    const child = events.find((event) =>
      event.kind === "verb" && event.verb === "refresh" &&
      event.branch === result.data.branch
    );
    assert(child?.kind === "verb");
    assertEquals(child.driver?.spawned_by, parent.invocation);
    assertEquals(driverKind(child), "automation");
    const childBegin = events.find((event) =>
      event.kind === "begin" && event.invocation === child.invocation
    );
    assert(childBegin?.kind === "begin");
    assertEquals(childBegin.driver?.spawned_by, parent.invocation);

    const patterns = await runAgent(result.data.path, ["patterns", "--json"]);
    assertEquals(patterns.code, 0, patterns.output);
    const report = decodeCliResult(patterns.stdout, "patterns");
    assertResultDataKey(report, "population");
    assert(report.data.population.automation >= 1);

    assertStringIncludes(
      await Deno.readTextFile(join(result.data.path, "AGENTS.md")),
      marker,
      "start must not rewrite the from-ref with the launching engine's bundled instructions",
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
    const result = decodeCliResult(r.stdout, "start");
    assertEquals(result.ok, true);
    assertResultDataKey(result, "path");
    assertExists(result.hints);

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
    const result = decodeCliResult(r.stdout, "start");
    assertEquals(result.ok, false);
    assertEquals(result.verb, "start");
    // Mapped to the same precondition slug accept/update use from the main checkout.
    assertEquals(result.error, "precondition_failed");
    // It must NOT have created a nested worktree of its own.
    assertEquals(
      await targetExists(`${wt}.worktrees`),
      false,
      "refusal must touch nothing",
    );
  });
});

Deno.test("start: mints a fresh, unique id on each call (never re-mints a live worktree)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const first = decodeStartData(
      (await runAgent(dir, ["start", "--json"])).stdout,
    );
    const second = decodeStartData(
      (await runAgent(dir, ["start", "--json"])).stdout,
    );

    assert(first.id !== second.id, `ids must differ across calls: ${first.id}`);
    assert(first.path !== second.path, "each start lands in its own directory");
    // Both worktrees exist, fully set up, on distinct branches.
    assert(
      await targetExists(join(first.path, "CLAUDE.md")),
      "first worktree set up",
    );
    assert(
      await targetExists(join(second.path, "CLAUDE.md")),
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
    assertTerminalTextIncludes(r.output, "is ready at");
    assertTerminalTextIncludes(r.output, "cd ");
    assertStringIncludes(r.output, `${basename(dir)}.worktrees`);
  });
});

Deno.test("start --dry-run: previews creating a worktree and touches nothing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["start", "--json", "--dry-run"]);
    assertEquals(r.code, 0, r.output);
    const result = decodeCliResult(r.stdout, "start");
    assertEquals(result.dry_run, true);
    assertExists(result.plan);
    assertEquals(result.plan.title, "Start plan");
    // A dry-run mints an id for the preview but creates no worktree at all.
    assertEquals(
      await targetExists(`${dir}.worktrees`),
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
  await withTempDir(fn, { prefix: "discern-markers-" });
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

/** Quote one literal path for the setup fixture's POSIX shell command. */
function setupShellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Leave one real worktree journal entry running at a deterministic seam.
 * `after-command` proves the arbitrary command returned success before the
 * completed record; `before-command` proves retry owns the first execution.
 */
async function interruptSetupStep(
  worktree: string,
  command: string,
  seam: "before-command" | "after-command",
): Promise<string> {
  const [identity] = await configuredSetupSteps([command]);
  assert(identity !== undefined);
  await assertRejects(
    () =>
      runJournaledSetupSteps(
        worktree,
        [command],
        async (step) =>
          (await new Deno.Command("sh", {
            args: ["-c", step.command],
            cwd: worktree,
            stdout: "null",
            stderr: "null",
          }).output()).code,
        seam === "before-command"
          ? {
            afterRunning: () => {
              throw new Error("interrupted before command");
            },
          }
          : {
            afterCommand: () => {
              throw new Error("interrupted after command");
            },
          },
      ),
    Error,
    seam === "before-command"
      ? "interrupted before command"
      : "interrupted after command",
  );
  return identity.id;
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

Deno.test("worktree setup recovery marks an observed command complete without replay", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const marker = join(markers, "mark-complete");
      const command = `echo x >> ${setupShellQuote(marker)}`;
      const wt = await mainWithSetup(dir, "recover-complete", {
        steps: [command],
      });
      const stepId = await interruptSetupStep(wt, command, "after-command");
      assertEquals(await markerCount(marker), 1);

      const automatic = await runAgent(wt, ["worktree", "setup", "--json"]);
      assertEquals(automatic.code, 1, automatic.output);
      const refusal = decodeCliResult(automatic.stdout, "worktree setup");
      assertEquals(refusal.ok, false);
      assertStringIncludes(refusal.message ?? "", "cannot prove");
      assertStringIncludes(
        refusal.message ?? "",
        `--mark-step-complete ${stepId} --confirmed`,
      );
      assertStringIncludes(
        refusal.message ?? "",
        `--retry-step ${stepId} --confirmed`,
      );
      assertEquals(await markerCount(marker), 1);

      const unconfirmed = await runAgent(wt, [
        "worktree",
        "setup",
        "--json",
        "--mark-step-complete",
        stepId,
      ]);
      assertEquals(unconfirmed.code, 1, unconfirmed.output);
      assertTerminalTextIncludes(
        decodeCliResult(unconfirmed.stdout, "worktree setup").message ?? "",
        "requires --confirmed",
      );
      const stillRunning = await readSetupStepJournal(wt);
      assertEquals(stillRunning.status, "recorded");
      if (stillRunning.status === "recorded") {
        assertEquals(stillRunning.journal.steps[0]?.state, "running");
      }

      const recovered = await runAgent(wt, [
        "worktree",
        "setup",
        "--json",
        "--mark-step-complete",
        stepId,
        "--confirmed",
      ]);
      assertEquals(recovered.code, 0, recovered.output);
      const result = decodeCliResult(recovered.stdout, "worktree setup");
      assertEquals(
        result.steps?.find((step) =>
          step.label === BUILT_IN_STEP_LABELS.recoverSetupStep
        )?.outcome,
        "ok",
      );
      assertEquals(
        result.steps?.find((step) => step.label === command)?.outcome,
        "skipped",
      );
      assertEquals(await markerCount(marker), 1);

      const replay = await runAgent(wt, [
        "worktree",
        "setup",
        "--json",
        "--mark-step-complete",
        stepId,
        "--confirmed",
      ]);
      assertEquals(replay.code, 0, replay.output);
      assertEquals(
        decodeCliResult(replay.stdout, "worktree setup").steps?.find((step) =>
          step.label === BUILT_IN_STEP_LABELS.recoverSetupStep
        )?.outcome,
        "skipped",
      );
      assertEquals(await markerCount(marker), 1);
    });
  });
});

Deno.test("worktree setup recovery retries an ambiguous command exactly once", async () => {
  await withTempDir(async (dir) => {
    await withMarkers(async (markers) => {
      const marker = join(markers, "retry");
      const command = `echo x >> ${setupShellQuote(marker)}`;
      const wt = await mainWithSetup(dir, "recover-retry", {
        steps: [command],
      });
      const stepId = await interruptSetupStep(wt, command, "before-command");
      assertEquals(await markerCount(marker), 0);

      const recovered = await runAgent(wt, [
        "worktree",
        "setup",
        "--json",
        "--retry-step",
        stepId,
        "--confirmed",
      ]);
      assertEquals(recovered.code, 0, recovered.output);
      const result = decodeCliResult(recovered.stdout, "worktree setup");
      assertEquals(
        result.steps?.find((step) =>
          step.label === BUILT_IN_STEP_LABELS.recoverSetupStep
        )?.outcome,
        "ok",
      );
      assertEquals(
        result.steps?.find((step) => step.label === command)?.outcome,
        "ok",
      );
      assertEquals(await markerCount(marker), 1);

      const replay = await runAgent(wt, [
        "worktree",
        "setup",
        "--json",
        "--retry-step",
        stepId,
        "--confirmed",
      ]);
      assertEquals(replay.code, 0, replay.output);
      assertEquals(
        decodeCliResult(replay.stdout, "worktree setup").steps?.find((step) =>
          step.label === BUILT_IN_STEP_LABELS.recoverSetupStep
        )?.outcome,
        "skipped",
      );
      assertEquals(await markerCount(marker), 1);
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
      const result = decodeCliResult(run.stdout, "worktree setup");
      assertExists(result.steps);
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
      assertTerminalTextIncludes(again.output, "skipping setup steps");
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

Deno.test("worktree setup re-entry: a failed convergence command keeps recovery evidence", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithSetup(dir, "setup-reentry-fail", {
      ensure: ["exit 0"],
    });
    const first = await runAgent(wt, ["worktree", "setup", "--json"]);
    assertEquals(first.code, 0, first.output);

    const configPath = join(wt, "discern.toml");
    const editor = new TomlEditor(await Deno.readTextFile(configPath));
    editor.setStringArray("worktree.setup.ensure", ["exit 7"]);
    await writeDiscernToml(configPath, editor.toString());

    const run = await runAgent(wt, ["worktree", "setup", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = decodeCliResult(run.stdout, "worktree setup");
    assertEquals(result.ok, false, run.stdout);
    assertEquals(result.error, "apply_failed", run.stdout);
    assertEquals(
      result.diagnostics?.map((diagnostic) => ({
        tool: diagnostic.tool,
        severity: diagnostic.severity,
        reproduce_cmd: diagnostic.reproduce_cmd,
      })),
      [{
        tool: "worktree-ensure",
        severity: "error",
        reproduce_cmd: "exit 7",
      }],
    );
    assertStringIncludes(result.diagnostics?.[0]?.message ?? "", "exited 7");
    assertStringIncludes(
      result.diagnostics?.[0]?.message ?? "",
      basename(wt),
    );
    assertHasHint(
      result,
      HINTS["lifecycle-convergence-failed"],
    );
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
    assertTerminalTextIncludes(r.output, "echo once-only");
    assertTerminalTextIncludes(r.output, "echo converge-me");
  });
});

Deno.test("worktree setup: a failing ensure at creation is fatal (aborts setup)", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithSetup(dir, "fatal-ensure", { ensure: ["exit 7"] });
    const r = await runAgent(wt, ["worktree", "setup"]);
    assertEquals(r.code, 1, r.output);
    assertTerminalTextIncludes(r.output, "worktree ensure step failed");
    // Aborted before the agent-file refresh + sentinel — setup never completed.
    assertEquals(
      r.output.includes("Worktree setup complete"),
      false,
      `a fatal ensure must abort setup\n${r.output}`,
    );
    assertEquals(
      await targetExists(join(wt, "CLAUDE.md")),
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
      assertTerminalTextIncludes(r.output, "Update complete");
      assert(
        await targetExists(join(wt, "upstream.txt")),
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

Deno.test("update: a successful no-op convergence remains successful", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithSetup(dir, "noop-convergence-ok", {
      ensure: ["exit 0"],
    });
    const refreshed = await runAgent(wt, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await commitCurrentWorktree(wt, "converge generated artifacts");

    const run = await runAgent(wt, ["update", "--json"]);
    assertEquals(run.code, 0, run.output);
    const result = decodeCliResult(run.stdout, "update");
    assertEquals(result.ok, true, run.stdout);
    assertExists(result.steps);
    assertEquals(
      result.steps.find((step) => step.kind === "setup-ensure")?.outcome,
      "ok",
      run.stdout,
    );
  });
});

Deno.test("update: a failing no-op convergence serializes its command and recovery", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithSetup(dir, "noop-convergence-fail", {
      ensure: ["exit 7"],
    });
    const refreshed = await runAgent(wt, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await commitCurrentWorktree(wt, "converge generated artifacts");

    const run = await runAgent(wt, ["update", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = decodeCliResult(run.stdout, "update");
    assertEquals(result.ok, false, run.stdout);
    assertEquals(result.error, "apply_failed", run.stdout);
    assertExists(result.steps);
    assertEquals(
      result.steps.find((step) => step.label === "merge")?.outcome,
      "skipped",
      `the branch is already current\n${run.stdout}`,
    );
    assertEquals(
      result.steps.find((step) => step.kind === "setup-ensure")?.outcome,
      "failed",
      `the non-fatal failure stays visible\n${run.stdout}`,
    );
    const diagnostic = result.diagnostics?.find((entry) =>
      entry.tool === "worktree-ensure"
    );
    assertEquals(diagnostic?.reproduce_cmd, "exit 7", run.stdout);
    assertStringIncludes(diagnostic?.message ?? "", "exited 7");
    assertStringIncludes(diagnostic?.message ?? "", wt);
    assertHasHint(
      result,
      HINTS["lifecycle-convergence-failed"],
    );

    const markdown = await runAgent(wt, ["update", "--markdown"]);
    assertEquals(markdown.code, 1, markdown.output);
    assertTerminalTextIncludes(markdown.stdout, "exit 7");
    assertTerminalTextIncludes(
      markdown.stdout,
      HINTS["lifecycle-convergence-failed"].template(undefined),
    );

    const human = await runAgent(wt, ["update", "--plain"]);
    assertEquals(human.code, 1, human.output);
    assertTerminalTextIncludes(human.output, "exit 7");
    assertTerminalTextIncludes(
      human.output,
      HINTS["lifecycle-convergence-failed"].template(undefined),
    );
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
    // The failed ensure does not abort or undo the landed merge, but completion
    // remains false because convergence is required.
    assertEquals(r.code, 1, r.output);
    assert(
      await targetExists(join(wt, "upstream.txt")),
      "the merge must be kept",
    );
    const result = decodeCliResult(r.stdout, "update");
    assertExists(result.steps);
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
    assertEquals(result.error, "apply_failed", r.stdout);
    assertEquals(
      result.diagnostics?.find((entry) => entry.tool === "worktree-ensure")
        ?.reproduce_cmd,
      "test ! -f upstream.txt",
      r.stdout,
    );
    assertHasHint(
      result,
      HINTS["lifecycle-convergence-failed"],
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
    assertEquals(r.code, 1, r.output);
    assert(
      await targetExists(join(wt, "upstream.txt")),
      "the merge must be kept",
    );
    const result = decodeCliResult(r.stdout, "update");
    assertExists(result.steps);
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
    assertEquals(result.error, "apply_failed", r.stdout);
  });
});

Deno.test("update: a partial refresh serializes on the already-current path", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "noop-refresh-fail");
    const refreshed = await runAgent(wt, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await commitCurrentWorktree(wt, "converge generated artifacts");

    await Deno.writeTextFile(
      join(wt, ".mcp.json"),
      '{ "mcpServers": { "other": true, }, }\n',
    );
    await commitCurrentWorktree(wt, "add malformed mcp config");

    const run = await runAgent(wt, ["update", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = decodeCliResult(run.stdout, "update");
    assertEquals(result.ok, false, run.stdout);
    assertEquals(result.error, "apply_failed", run.stdout);
    assertExists(result.steps);
    assertEquals(
      result.steps.find((step) => step.label === "merge")?.outcome,
      "skipped",
      run.stdout,
    );
    assertEquals(
      result.steps.find((step) => step.kind === "refresh")?.outcome,
      "failed",
      run.stdout,
    );
    assertEquals(
      result.diagnostics?.find((entry) => entry.tool === "refresh")
        ?.reproduce_cmd,
      "discern refresh",
      run.stdout,
    );
    assert(
      result.hints?.some((hint) => hint.includes("discern refresh")) ?? false,
      run.stdout,
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
    const result = decodeCliResult(r.stdout, "start");
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
    const result = decodeCliResult(r.stdout, "start");
    assert(result.ok, "start succeeds with the ensure command wired");
    assertExists(result.hints);
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
