/**
 * Engine coverage for the worktree teardown/prune family — the housekeeping side
 * of the isolated-worktree lifecycle.
 *
 * `engine_worktree_test.ts` drives the happy-path lifecycle (setup → exit →
 * prune). This file pins down the surfaces it leaves uncovered: the safety
 * boundary of `remove-worktree-safely` (refuse the main checkout / a non-worktree
 * path), the BRANCH-pruning behaviour of `worktree:prune` (a merged branch with
 * no worktree is deleted; an unmerged one is kept), teardown destroying a
 * worktree's declared resources (not just the no-op path),
 * `inherit-main-env-vars` copying a whitelisted secret into a worktree's `.env`,
 * and `with-gotchas` printing its failure pointer while propagating the exit code.
 *
 * Like the sibling engine tests these shell out to the installed `agent` in a
 * hermetic git repo, so the bytes under test are the bytes an install runs. They
 * are correspondingly slower than the pure-`src/` suite.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { exists } from "@std/fs";
import { parse as parseToml } from "@std/toml";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { wireProviderWorktreeApp } from "../src/lib/providers.ts";

/** A scaffolded, committed main repo with one linked worktree ready to drive. */
async function mainWithWorktree(dir: string, name: string): Promise<string> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  return await addWorktree(dir, name);
}

/**
 * A minimal valid config. The default scaffolded `discern.toml` already carries
 * the `[worktree]` seams (all empty), but tests that need specific adapter
 * commands or an `inherit_env` list overwrite it via `writeConfig` with this
 * shape plus their own additions.
 */
function baseConfig(extra = ""): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
    "",
    "[scopes.docs]",
    'paths = ["docs/"]',
    "neutral = true",
    extra,
    "",
  ].join("\n");
}

// ── remove-worktree-safely: the rm -rf safety boundary ──────────────────────
//
// This helper is the rm -rf primitive every prune/sweep path funnels through, so
// its refusal conditions are the load-bearing guard against deleting the wrong
// directory. Nothing else exercises them.

Deno.test("remove-worktree-safely refuses to delete the main checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // Point it at the main repo itself: it must refuse, and main must survive.
    const r = await runAgent(dir, ["remove-worktree-safely", dir]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "main checkout");
    assert(
      await exists(join(dir, "discern.toml")),
      `main checkout must be left intact\n${r.output}`,
    );
  });
});

Deno.test("remove-worktree-safely refuses a path that is not a worktree of this repo", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // An ordinary directory inside the repo that git does not track as a
    // worktree: deleting it would be the stray-argument footgun the gate guards.
    const bystander = join(dir, "not-a-worktree");
    await Deno.mkdir(bystander);
    await Deno.writeTextFile(join(bystander, "keep.txt"), "keep\n");

    const r = await runAgent(dir, ["remove-worktree-safely", bystander]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "not a git worktree");
    assert(
      await exists(join(bystander, "keep.txt")),
      `a non-worktree directory must NOT be removed\n${r.output}`,
    );
  });
});

Deno.test("remove-worktree-safely removes a real linked worktree and reconciles git", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "removable");

    const r = await runAgent(dir, ["remove-worktree-safely", wt]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(wt),
      false,
      `the worktree directory should be gone\n${r.output}`,
    );
    // git should no longer list it as a registered worktree.
    const list = await runAgent(dir, ["worktree-name", "--id"], { cwd: dir });
    assertEquals(
      list.output.includes("removable"),
      false,
      `git metadata should be reconciled (worktree deregistered)\n${list.output}`,
    );
  });
});

Deno.test("remove-worktree-safely is idempotent on an already-removed path", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "twice");

    const first = await runAgent(dir, ["remove-worktree-safely", wt]);
    assertEquals(first.code, 0, first.output);
    // Re-running against the now-absent path must be a clean success no-op.
    const second = await runAgent(dir, ["remove-worktree-safely", wt]);
    assertEquals(second.code, 0, second.output);
  });
});

// ── worktree:prune — branch sweeping (the merged/unmerged distinction) ───────
//
// The existing suite asserts a merged worktree DIRECTORY is reclaimed and a live
// one is kept. This pins the parallel BRANCH behaviour: a fully-merged branch
// whose worktree is already gone is deleted, while an unmerged dangling branch is
// preserved (its commits are still worth reviewing).

Deno.test("worktree:prune deletes a dangling fully-merged branch but keeps an unmerged one", async () => {
  await withTempDir(async (dir) => {
    // Two extra worktrees so we can produce two branches, then remove the
    // worktrees to leave the branches dangling (no checkout) for the branch
    // sweep to consider.
    const mergedWt = await mainWithWorktree(dir, "merged");
    const keepWt = await addWorktree(dir, "kept");

    // agent/merged: a commit that we merge into main → fully merged.
    await Deno.writeTextFile(join(mergedWt, "m.txt"), "m\n");
    await git(mergedWt, "add", "-A");
    await git(mergedWt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge merged", "agent/merged");

    // agent/kept: a commit that is NEVER merged → unmerged work to preserve.
    await Deno.writeTextFile(join(keepWt, "k.txt"), "k\n");
    await git(keepWt, "add", "-A");
    await git(keepWt, "commit", "-q", "-m", "k", "--no-gpg-sign");

    // Remove both worktrees (but keep their branches) so the branch sweep — not
    // the worktree sweep — is what decides each branch's fate.
    await git(dir, "worktree", "remove", "--force", mergedWt);
    await git(dir, "worktree", "remove", "--force", keepWt);

    const r = await runAgent(dir, ["worktree:prune", "--yes"]);
    assertEquals(r.code, 0, r.output);

    // Inspect the surviving local branches directly via git.
    const after = await branchList(dir);
    assertEquals(
      after.includes("agent/merged"),
      false,
      `a dangling fully-merged branch should be deleted\n${r.output}\n${after}`,
    );
    assert(
      after.includes("agent/kept"),
      `an unmerged branch must be preserved\n${r.output}\n${after}`,
    );
    // main is always protected.
    assert(after.includes("main"), `main must survive\n${after}`);
  });
});

// ── worktree:prune — the dry-run plan must AGREE with the real run ───────────
//
// Regression guard (ADR 0027): `--dry-run` builds a plan from what prune WOULD
// remove and reclaim. A dry-run that reports "nothing to do" while the real run
// then removes worktrees and deletes branches is the exact plan/apply divergence
// the model forbids — and was a real bug (pruneGitWorktrees/sweepOrphanWorktrees
// narrated their candidates but returned EMPTY lists in dryRun mode, so the plan
// read nothing). This pins the two paths to agree.

Deno.test("worktree:prune --dry-run lists what the real run removes, and acts on nothing", async () => {
  await withTempDir(async (dir) => {
    // A live, clean, fully-merged worktree — a genuine removal candidate.
    const mergedWt = await mainWithWorktree(dir, "victim");
    await Deno.writeTextFile(join(mergedWt, "m.txt"), "m\n");
    await git(mergedWt, "add", "-A");
    await git(mergedWt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge victim", "agent/victim");

    // Dry-run must NAME the candidate (not claim "nothing to do") and touch nothing.
    const dry = await runAgent(dir, ["worktree:prune", "--dry-run"]);
    assertEquals(dry.code, 0, dry.output);
    assertStringIncludes(dry.stdout, "victim");
    assert(
      !dry.stdout.includes("nothing to do"),
      `dry-run wrongly reported an empty plan\n${dry.stdout}`,
    );
    assert(
      await exists(mergedWt),
      `dry-run must not remove the worktree\n${dry.output}`,
    );

    // --dry-run --json: the plan carries the worktree and its branch.
    const dryJson = await runAgent(dir, [
      "worktree:prune",
      "--dry-run",
      "--json",
    ]);
    const plan = JSON.parse(dryJson.stdout.trim());
    const labels: string[] = plan.plan.steps.map((s: { label: string }) =>
      s.label
    );
    assert(
      labels.some((l) => l.includes("victim")),
      `the dry-run plan should include the victim worktree\n${dryJson.stdout}`,
    );

    // The real run removes exactly what the dry-run promised.
    const real = await runAgent(dir, ["worktree:prune", "--yes"]);
    assertEquals(real.code, 0, real.output);
    assertEquals(
      await exists(mergedWt),
      false,
      `the real run should remove the worktree the dry-run named\n${real.output}`,
    );
    assert(
      !(await branchList(dir)).includes("agent/victim"),
      "the merged branch should be deleted by the real run",
    );
  });
});

Deno.test("worktree:prune refuses off-TTY without --yes and shows the candidates", async () => {
  await withTempDir(async (dir) => {
    const mergedWt = await mainWithWorktree(dir, "confirm");
    await Deno.writeTextFile(join(mergedWt, "m.txt"), "m\n");
    await git(mergedWt, "add", "-A");
    await git(mergedWt, "commit", "-q", "-m", "m", "--no-gpg-sign");
    await git(dir, "merge", "--no-ff", "-m", "merge confirm", "agent/confirm");

    const r = await runAgent(dir, ["worktree:prune"]);

    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "Confirmation required");
    assertStringIncludes(r.output, "re-run with `--yes`");
    assertStringIncludes(r.output, "confirm");
    assert(
      await exists(mergedWt),
      `refusing for missing --yes must not remove the candidate\n${r.output}`,
    );
  });
});

// ── worktree:prune — orphan-directory sweep at the configured root ───────────
//
// A worktree dir whose git metadata was lost (a hard kill, a failed remove hook)
// is reclaimed by the orphan sweep. The sweep discovers locations from git's
// registry — the parents of registered worktrees — so when NO registered
// worktree remains to derive the worktree root from, it would miss that root
// entirely. The dispatch layer therefore passes the resolved [worktree].root as
// extraDirs (ADR 0052). This pins that wiring: a FULLY-orphaned dir at the
// (sibling) default root is still reclaimed.

Deno.test("worktree:prune keeps a dirty orphaned dir at the configured worktree root", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "orphan"); // <dir>.worktrees/orphan
    const root = dirname(wt); // the sibling worktree root
    const orphan = join(root, "orphan-moved");
    await Deno.writeTextFile(join(wt, "uncommitted.txt"), "save me\n");

    // Sever git's registration while leaving the checkout on disk: move it so the
    // registered path goes missing (prune drops the stale admin entry), while the
    // moved dir keeps its `.git` gitlink into this repo's worktrees admin area —
    // exactly the orphan a hard kill leaves behind.
    await Deno.rename(wt, orphan);

    // No registered linked worktree now points anywhere under `root`, so the
    // git-derived parent scan cannot reach it; only the extraDirs the dispatch
    // layer passes (the resolved [worktree].root) does.
    const r = await runAgent(dir, ["worktree:prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(orphan),
      `the dirty orphaned dir at the worktree root must be kept\n${r.output}`,
    );
    assertEquals(
      await Deno.readTextFile(join(orphan, "uncommitted.txt")),
      "save me\n",
    );
    assertStringIncludes(r.output, "dirty 1 status entries");
  });
});

Deno.test("worktree:prune reclaims a clean fully-orphaned dir at the configured worktree root", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "clean-orphan");
    const root = dirname(wt);
    const orphan = join(root, "clean-orphan-moved");
    await Deno.writeTextFile(join(wt, "merged.txt"), "merged\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "merged orphan", "--no-gpg-sign");
    await git(
      dir,
      "merge",
      "--no-ff",
      "-m",
      "merge clean orphan",
      "agent/clean-orphan",
    );
    await Deno.rename(wt, orphan);

    const r = await runAgent(dir, ["worktree:prune", "--yes"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(orphan),
      false,
      `a clean orphaned dir at the worktree root should be reclaimed\n${r.output}`,
    );
  });
});

Deno.test("worktree:prune refuses to run from inside a linked worktree", async () => {
  await withTempDir(async (dir) => {
    // Pool housekeeping is a main-checkout operation (guarded by
    // assert-not-in-worktree). Driving it from inside a linked worktree must
    // refuse — you would be pruning siblings from within one — and touch nothing.
    const wt = await mainWithWorktree(dir, "from-inside");
    const r = await runAgent(wt, ["worktree:prune", "--yes"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "main checkout");
    assert(await exists(wt), `the worktree must be left intact\n${r.output}`);
  });
});

/** The repo's local branch names, newline-joined, via a hermetic git call. */
async function branchList(dir: string): Promise<string> {
  const c = new Deno.Command("git", {
    args: ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    cwd: dir,
    env: {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await c.output();
  return new TextDecoder().decode(stdout);
}

// ── worktree:teardown — resources actually destroyed ────────────────────────
//
// The sibling test proves teardown is a clean no-op when nothing is declared.
// This proves the other half: a resource created at setup is destroyed at
// teardown (via the ledger's frozen command), with its handle expanded. The
// markers live OUTSIDE the worktree so the destroy can be checked afterwards.

Deno.test("worktree:teardown destroys the worktree's resources", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "tear");
    const markers = join(dir, "markers");
    // Append a resource to the scaffolded config (keeping [guidance] etc. so the
    // setup step's guidance refresh still runs).
    const cfg = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `${cfg}\n[worktree.resources.thing]\n` +
        `create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"\n` +
        `destroy = "mkdir -p ${markers} && rm -f ${markers}/@resource@.live && touch ${markers}/@resource@.gone"\n`,
    );

    // Setup creates the resource (and the ledger entry teardown acts on).
    const setup = await runAgent(wt, ["worktree"]);
    assertEquals(setup.code, 0, setup.output);
    const handle =
      (await runAgent(wt, ["worktree-name", "--resource", "thing"])).stdout
        .trim();
    assert(
      await exists(join(markers, `${handle}.live`)),
      `setup did not create the resource\n${setup.output}`,
    );

    const r = await runAgent(wt, ["worktree:teardown"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(markers, `${handle}.gone`)),
      `teardown did not destroy the resource\n${r.output}`,
    );
    assert(
      !(await exists(join(markers, `${handle}.live`))),
      "teardown left the live marker",
    );
  });
});

Deno.test("worktree:teardown refuses to run from the main checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // From main, teardown must refuse — it is a worktree-only, destructive op.
    const r = await runAgent(dir, ["worktree:teardown"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "worktree");
  });
});

// ── Codex [cleanup] contract: the written cleanup.script is the cwd-based teardown ──
//
// Codex's environment.toml `[cleanup].script` runs as a BARE command in the worktree
// cwd with no stdin (unlike Claude's `worktree:remove`, which reads a {worktree_path}
// payload). This binds the two halves of that contract: the exact script string
// discern writes into the app's environment.toml IS a dispatchable verb that tears the
// worktree down by cwd — so a rename of the verb (or the written script) that broke
// Codex teardown would red-light here rather than silently ship.

Deno.test("worktree:teardown by cwd is the verb discern writes as Codex's environment.toml [cleanup].script", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "codexcleanup");
    const markers = join(dir, "markers");
    const cfg = await Deno.readTextFile(join(wt, "discern.toml"));
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `${cfg}\n[worktree.resources.thing]\n` +
        `create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"\n` +
        `destroy = "mkdir -p ${markers} && rm -f ${markers}/@resource@.live && touch ${markers}/@resource@.gone"\n`,
    );
    // Setup creates the resource + the ledger entry teardown acts on.
    await runAgent(wt, ["worktree"]);
    const handle =
      (await runAgent(wt, ["worktree-name", "--resource", "thing"])).stdout
        .trim();

    // discern writes the cleanup script into the app's environment.toml…
    await wireProviderWorktreeApp(wt, ["codex"]);
    const env = parseToml(
      await Deno.readTextFile(join(wt, ".codex/environments/environment.toml")),
    ) as { cleanup: { script: string } };

    // …and running THAT script verbatim as a bare command in the worktree cwd (no
    // stdin — the Codex [cleanup] invocation shape) tears the worktree down by cwd.
    const [bin, ...verbArgs] = env.cleanup.script.split(" ");
    assertEquals(bin, "discern"); // the local-dev shim invokes the engine for us
    const r = await runAgent(wt, verbArgs);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(markers, `${handle}.gone`)),
      `the [cleanup].script did not tear the worktree down by cwd\n${r.output}`,
    );
  });
});

// ── inherit-main-env-vars — whitelisted secret propagation ──────────────────
//
// A fresh worktree's .env carries only what is in version control. This recipe
// copies the [worktree].inherit_env whitelist from the MAIN checkout's .env into
// the worktree's .env so the worktree's app can boot with the same secrets.

Deno.test("inherit-main-env-vars copies a whitelisted var from main's .env into the worktree's .env", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "envwt");
    // The inherit list is read from the current root = the worktree's own
    // discern.toml; the secret is read from the MAIN checkout's .env.
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      baseConfig('\n[worktree]\ninherit_env = ["FOO"]'),
    );

    // FOO is a secret kept out of git: it lives only in main's .env.
    await Deno.writeTextFile(join(dir, ".env"), "FOO=bar\n");
    // The recipe is a no-op unless the worktree already has an .env to patch
    // (it never creates one). Seed an empty .env so it has a target.
    await Deno.writeTextFile(join(wt, ".env"), "");

    const r = await runAgent(wt, ["inherit-main-env-vars"]);
    assertEquals(r.code, 0, r.output);

    const wtEnv = await Deno.readTextFile(join(wt, ".env"));
    assertStringIncludes(wtEnv, "FOO=bar");
  });
});

Deno.test("inherit-main-env-vars is a no-op when the worktree has no .env yet", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "noenv");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      baseConfig('\n[worktree]\ninherit_env = ["FOO"]'),
    );
    await Deno.writeTextFile(join(dir, ".env"), "FOO=bar\n");
    // No worktree .env created → recipe must skip cleanly and create nothing.

    const r = await runAgent(wt, ["inherit-main-env-vars"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      await exists(join(wt, ".env")),
      false,
      `the recipe must not fabricate a worktree .env\n${r.output}`,
    );
  });
});

// ── with-gotchas — the failure pointer + exit-code passthrough ──────────────
//
// `finish` and `with-gotchas` both print the same "a gate step failed" pointer.
// Here we drive the wrapper directly: a failing command must surface the pointer
// AND propagate the command's own exit code (the wrapper deliberately omits
// `set -e` so it observes the failure rather than dying on it).

Deno.test("with-gotchas prints the failure pointer and propagates the command's exit code", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // gotchas_doc unset → the pointer takes its "record the fix" wording.
    await writeConfig(
      dir,
      ["[project]", 'slug = "engine-test"', 'gotchas_doc = ""', ""].join("\n"),
    );

    // Wrap a command that exits 3: the wrapper must re-exit 3 and print the
    // banner that names a failed gate step.
    const r = await runAgent(dir, ["with-gotchas", "sh", "-c", "exit 3"]);
    assertEquals(r.code, 3, r.output);
    assertStringIncludes(r.output, "a gate step failed");
    assertStringIncludes(r.output, "gotchas_doc");
  });
});

Deno.test("with-gotchas stays silent and returns 0 when the wrapped command succeeds", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["with-gotchas", "sh", "-c", "exit 0"]);
    assertEquals(r.code, 0, r.output);
    assertEquals(
      r.output.includes("a gate step failed"),
      false,
      `the pointer must not appear on success\n${r.output}`,
    );
  });
});

Deno.test("with-gotchas points at the configured gotchas doc when one is set", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A configured doc switches the pointer to the "it's written down here" path,
    // resolving the doc against the project root.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'gotchas_doc = "docs/GOTCHAS.md"',
        "",
      ]
        .join("\n"),
    );

    const r = await runAgent(dir, ["with-gotchas", "sh", "-c", "exit 1"]);
    assertEquals(r.code, 1, r.output);
    assertStringIncludes(r.output, "a gate step failed");
    assertStringIncludes(r.output, "docs/GOTCHAS.md");
  });
});
