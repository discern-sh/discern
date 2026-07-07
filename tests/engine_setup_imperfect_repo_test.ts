/**
 * Setup on IMPERFECT repos — the realistic first-contact states the funnel must
 * hold up on rather than soft-degrade: a `master` (or otherwise non-`main`) repo,
 * a brand-new repo whose default branch is still unborn, a directory with no git
 * at all, a machine with no git identity, an abandoned half-finished setup, and a
 * verbatim-copied placeholder flag. Each test fails on the old behavior (the
 * silent `main` assumption, the poisoned re-begin, the false isolation promise,
 * the discarded stderr, the scaffolded literal placeholder).
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { isValidDocsDir } from "../src/shared/docs_path.ts";

/** A fresh git work tree with one commit — on the given branch, not `main`. */
async function repoOnBranch(dir: string, branch: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await gitInit(dir);
  await git(dir, "branch", "-M", branch);
}

/** A brand-new `git init` whose default branch is still UNBORN (no commits),
 * with identity configured so setup's own commits can succeed. */
async function unbornRepo(dir: string, branch: string): Promise<void> {
  await git(dir, "init", "-q", "-b", branch);
  await git(dir, "config", "user.email", "engine-test@example.com");
  await git(dir, "config", "user.name", "Engine Test");
  await git(dir, "config", "commit.gpgsign", "false");
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
}

// ── A6: the integration branch is detected and stamped ────────────────────────

Deno.test("begin on a master repo stamps [project].main_branch = master and land works", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // The scaffolded config carries the repo's REAL default branch — without it
    // the gate's behind-main merge check self-skips forever ('main' is missing)
    // and `setup land` dead-ends.
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "master"');

    // Landing works end to end: setup lives on discern-setup, lands onto master.
    const land = await runAgent(dir, ["setup", "land"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "master");

    // The merge check is armed against the stamped branch: status reports it as
    // the integration branch (and it exists locally, so nothing self-skips).
    const status = JSON.parse(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assertEquals(status.data.git.integration_branch, "master");
  });
});

Deno.test("begin prefers the remote's declared default (origin/HEAD) over the current branch", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "feature-work");
    await git(dir, "remote", "add", "origin", dir);
    await git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk",
    );
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "trunk"');
  });
});

Deno.test("begin stamps the checked-out branch even when init.defaultBranch disagrees", async () => {
  // Vendor git builds bake `init.defaultBranch = main` into an unmaskable config
  // (Apple's git does), so the checked-out branch — the repo's ground truth —
  // must outrank it, or every macOS `master` repo would be stamped `main`.
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    await git(dir, "config", "init.defaultBranch", "trunk");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "master"');
  });
});

Deno.test("begin falls back to init.defaultBranch on a detached HEAD", async () => {
  await withTempDir(async (dir) => {
    await repoOnBranch(dir, "master");
    await git(dir, "checkout", "-q", "--detach");
    await git(dir, "config", "init.defaultBranch", "trunk");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "trunk"');
  });
});

Deno.test("begin on an unborn-main repo stamps main, and land serves the creation step that then works", async () => {
  await withTempDir(async (dir) => {
    await unbornRepo(dir, "main");
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    assertStringIncludes(toml, 'main_branch = "main"');

    // `main` is still unborn (every commit landed on discern-setup): land refuses
    // with the exact creation-then-land step, not a dead end — and the same
    // message rides the JSON surface an agent reads.
    const refused = await runAgent(dir, ["setup", "land", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const res = JSON.parse(refused.stdout);
    assertEquals(res.error, "no_target");
    assertStringIncludes(res.message, "git branch main && discern setup land");

    // Following the served step lands the setup and arms the merge check.
    await git(dir, "branch", "main");
    const land = await runAgent(dir, ["setup", "land"]);
    assertEquals(land.code, 0, land.output);
    assertEquals(await gitOut(dir, "branch", "--show-current"), "main");
    assert(
      await exists(join(dir, "discern.toml")),
      "the harness landed on main",
    );
  });
});

// ── B8: non-git directories are honest and git-init-first ─────────────────────

Deno.test("verify in a non-git directory serves git-init-first and promises no isolation it can't deliver", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    const res = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    );
    const d = res.data;
    assertEquals(d.findings.git.repo, false);

    // The served next action is to CREATE the repository, then re-run the
    // preflight — never straight to begin.
    assertStringIncludes(d.next_action, "git init");
    const conflict = d.conflicts.find(
      (c: { kind: string }) => c.kind === "not_a_repo",
    );
    assert(conflict !== undefined, JSON.stringify(d.conflicts));
    assertStringIncludes(conflict.detail, "git init");
    assert(
      !conflict.detail.includes("Consider"),
      "git init is the path, not a soft suggestion",
    );

    // The consent message conditions its promises on the git state: no
    // unconditional isolated-branch story, and the git-init consent point rides
    // the fenced message.
    assert(
      !d.guidance.includes("so nothing touches your main branch"),
      "the served message must not promise branch isolation without git",
    );
    assertStringIncludes(d.guidance, "OK to initialize git here?");

    // Parity (ADR 0086): a flag-less fresh `begin` re-serves the identical
    // conditioned message.
    const begin = await runAgent(dir, ["setup", "begin"]);
    assertEquals(begin.code, 1, begin.output);
    assertStringIncludes(begin.stdout, d.guidance);
  });
});

// ── C9 residual: verify previews from the resolved root ───────────────────────

Deno.test("verify from a repo subdirectory previews the ROOT's sibling worktree path", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const sub = join(dir, "packages", "app");
    await Deno.mkdir(sub, { recursive: true });

    const d = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"], { cwd: sub })).stdout,
    ).data;
    // The preview must describe the tree `begin` will operate on — the repo
    // top-level and ITS sibling — not `<subdir>.worktrees` inside the repo.
    // (realPath: git reports the /private-canonicalized form of the temp dir.)
    assertEquals(
      d.findings.worktree_path,
      `${await Deno.realPath(dir)}.worktrees`,
    );
  });
});

// ── C11: the welcome shows where it's needed most ──────────────────────────────

Deno.test("bare `discern` in a non-git directory shows the welcome (leading with git init), not raw CLI help", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    const r = await runAgent(dir, []);
    assertEquals(r.code, 0, r.output);
    // The curated first contact, dual-addressed — not the operator help.
    assertStringIncludes(r.stdout, "FOR HUMANS");
    assertStringIncludes(r.stdout, "FOR CODING AGENTS");
    assert(
      !r.stdout.includes("Usage:"),
      `raw CLI help must not be the no-git first contact:\n${r.stdout}`,
    );
    // …and it leads with the git-init step (there is no isolation without git).
    assertStringIncludes(r.stdout, "git init");
    // The welcome writes nothing, in a stray dir least of all.
    assert(!(await exists(join(dir, "discern.toml"))));
  });
});

Deno.test("the fresh welcome carries the git-init note only in a non-git directory", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    // Non-git: the note rides both surfaces.
    const nonGit = await runAgent(dir, ["setup"]);
    assertStringIncludes(nonGit.stdout, "isn't a git repository yet");
    const nonGitJson = JSON.parse(
      (await runAgent(dir, ["setup", "--json"])).stdout,
    ).data;
    assertStringIncludes(nonGitJson.human_framing, "git init");

    // With git: no note on either surface.
    await gitInit(dir);
    const withGit = await runAgent(dir, ["setup"]);
    assert(!withGit.stdout.includes("isn't a git repository yet"));
    const withGitJson = JSON.parse(
      (await runAgent(dir, ["setup", "--json"])).stdout,
    ).data;
    assert(!withGitJson.human_framing.includes("git init"));
  });
});

// ── C10: a copied placeholder can't scaffold ───────────────────────────────────

Deno.test("isValidDocsDir rejects the placeholder class, not one instance", () => {
  // Any angle-bracketed value is an unsubstituted placeholder — the guard is on
  // the shape, so every current and future served example is covered.
  for (
    const placeholder of [
      "<their-docs-path>",
      "<chosen-docs-dir>",
      "docs/<subdir>",
      "<docs>",
    ]
  ) {
    assert(
      !isValidDocsDir(placeholder),
      `placeholder must be invalid: ${placeholder}`,
    );
  }
  assert(isValidDocsDir("docs/"));
});

Deno.test("begin rejects a verbatim --docs placeholder instead of scaffolding a literal tree", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--docs",
      "<their-docs-path>",
    ]);
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.error, "invalid_option");
    assertStringIncludes(res.message, "placeholder");
    assertStringIncludes(res.message, "--docs docs/");
    // Nothing was written — no literal `<their-docs-path>/` tree, no config.
    assert(!(await exists(join(dir, "<their-docs-path>"))));
    assert(!(await exists(join(dir, "discern.toml"))));
  });
});

// ── B9: commit failures explain themselves ─────────────────────────────────────

/** A git repo with one commit but NO configured identity — the commit was made
 * with one-shot `-c` overrides. `user.useConfigOnly` makes the missing identity
 * fail deterministically (without it, git may auto-detect user@hostname on some
 * machines and silently record a guessed author instead). */
async function repoWithoutIdentity(dir: string): Promise<void> {
  await git(dir, "init", "-q", "-b", "main");
  await git(dir, "config", "user.useConfigOnly", "true");
  await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
  await git(dir, "add", "-A");
  await git(
    dir,
    "-c",
    "user.name=Engine Test",
    "-c",
    "user.email=engine-test@example.com",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "scaffold",
  );
}

Deno.test("verify names a missing git identity with the exact commands, and begin's failed machinery commit surfaces stderr", async () => {
  await withTempDir(async (dir) => {
    await repoWithoutIdentity(dir);

    // The preflight names the gap BEFORE the agent burns a session hitting it.
    const v = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    ).data;
    assertEquals(v.findings.git.identity, false);
    const conflict = v.conflicts.find(
      (c: { kind: string }) => c.kind === "missing_git_identity",
    );
    assert(conflict !== undefined, JSON.stringify(v.conflicts));
    assertStringIncludes(conflict.detail, 'git config user.name "Your Name"');
    assertStringIncludes(
      conflict.detail,
      'git config user.email "you@example.com"',
    );

    // If the agent proceeds anyway, the machinery auto-commit fails — and the
    // cause is surfaced (git's stderr line), not collapsed into a silent skip.
    const begin = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(begin.code, 0, begin.output);
    const d = JSON.parse(begin.stdout).data;
    assertEquals(d.machinery_committed, false);
    assert(
      typeof d.machinery_commit_error === "string" &&
        d.machinery_commit_error.length > 0,
      `expected the git stderr cause: ${JSON.stringify(d)}`,
    );
  });
});

Deno.test("a failed completion-marker commit explains itself instead of misattributing the cause", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "user.useConfigOnly", "true");
    await git(dir, "add", "-A");
    await git(
      dir,
      "-c",
      "user.name=Engine Test",
      "-c",
      "user.email=engine-test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "scaffold",
    );

    // --force skips the completion proof; the marker is written, and its
    // auto-commit fails on the missing identity. The old output misattributed
    // this as "could not prove that was the only discern.toml change".
    const human = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(human.stdout, "Git said:");
    assert(
      !human.stdout.includes("could not prove"),
      `a failed commit must not be misattributed:\n${human.stdout}`,
    );

    const res = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    assertEquals(res.data.marker_committed, false);
    assert(
      typeof res.data.marker_commit_error === "string" &&
        res.data.marker_commit_error.length > 0,
      `expected the git stderr cause: ${JSON.stringify(res.data)}`,
    );
  });
});

// ── B7: an abandoned setup resumes instead of compounding ─────────────────────

Deno.test("an abandoned setup routes first contact to the resume, and re-begin resumes instead of re-scaffolding", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const first = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      "claude_code",
    ]);
    assertEquals(first.code, 0, first.output);

    // Abandon mid-setup: switch back to main. The config lives only in commits
    // on discern-setup; the compiled agent files are gitignored and survive.
    await git(dir, "checkout", "-q", "main");
    assert(!(await exists(join(dir, "discern.toml"))), "config is branch-only");

    // The welcome routes to the resume, not the FRESH funnel.
    const w = JSON.parse((await runAgent(dir, ["setup", "--json"])).stdout)
      .data;
    assertEquals(w.phase, "in_progress");
    assertStringIncludes(w.next_action, "git checkout discern-setup");
    assertStringIncludes(w.agent_guidance, "do NOT start setup again");
    const human = (await runAgent(dir, ["setup"])).stdout;
    assertStringIncludes(human, "IN PROGRESS");
    assertStringIncludes(human, "git checkout discern-setup");
    assert(
      !human.includes("This project isn't set up yet"),
      `the fresh welcome must not show over an abandoned setup:\n${human}`,
    );

    // verify routes the same way.
    const v = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    ).data;
    assertEquals(v.phase, "in_progress");
    assertStringIncludes(v.next_action, "git checkout discern-setup");

    // A re-begin from main RESUMES: the existing branch is checked out, the
    // materialized install is recognized (nothing re-scaffolded), and nothing of
    // discern's own compiled output is imported into the guidance source.
    const re = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(re.code, 0, re.output);
    const reData = JSON.parse(re.stdout).data;
    assertEquals(reData.written, [], "a resume must not re-scaffold");
    const guidance = await Deno.readTextFile(
      join(dir, SOURCE_PATHS.guidance.defaultPath),
    );
    assert(
      !guidance.includes("Imported from"),
      `discern's own compiled output was imported into guidance:\n${guidance}`,
    );
  });
});

Deno.test("re-begin never imports a surviving compiled agent file that matches discern's own render", async () => {
  // The harder abandonment: the setup branch was DELETED, so the install really
  // is fresh again — but the gitignored compiled agent file survived on disk.
  // The exact-match guard must recognize it as discern's own output and skip the
  // "Imported from" migration (it is not the user's authoring), and say so.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const first = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      "claude_code",
    ]);
    assertEquals(first.code, 0, first.output);
    await git(dir, "checkout", "-q", "main");
    await git(dir, "branch", "-D", "discern-setup");
    assert(await exists(join(dir, "CLAUDE.md")), "the compiled file survives");

    const re = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(re.code, 0, re.output);
    const guidance = await Deno.readTextFile(
      join(dir, SOURCE_PATHS.guidance.defaultPath),
    );
    assert(
      !guidance.includes("Imported from"),
      `discern's own compiled output was imported into guidance:\n${guidance}`,
    );
    // …and the skip is reported, not silent.
    const hints: string[] = JSON.parse(re.stdout).hints ?? [];
    assert(
      hints.some((h) => h.includes("discern's own compiled output")),
      `expected a skip hint: ${JSON.stringify(hints)}`,
    );
  });
});
