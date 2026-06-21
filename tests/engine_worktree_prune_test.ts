/**
 * Engine coverage for the worktree teardown/prune family — the housekeeping side
 * of the isolated-worktree lifecycle.
 *
 * `engine_worktree_test.ts` drives the happy-path lifecycle (setup → exit →
 * prune). This file pins down the surfaces it leaves uncovered: the safety
 * boundary of `remove-worktree-safely` (refuse the main checkout / a non-worktree
 * path), the BRANCH-pruning behaviour of `worktree:prune` (a merged branch with
 * no worktree is deleted; an unmerged one is kept), the teardown ADAPTER seams
 * actually firing (db `drop` + dev-server `unlink`, not just the no-op path),
 * `inherit-main-env-vars` copying a whitelisted secret into a worktree's `.env`,
 * and `with-gotchas` printing its failure pointer while propagating the exit code.
 *
 * Like the sibling engine tests these shell out to the installed `agent` in a
 * hermetic git repo, so the bytes under test are the bytes an install runs. They
 * are correspondingly slower than the pure-`src/` suite.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

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
    "[scopes]",
    'neutral = ["docs/"]',
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

// ── worktree:teardown — the adapter seams actually firing ───────────────────
//
// The sibling test proves teardown is a clean no-op when the seams are unset.
// This proves the other half: a configured db `drop` and dev-server `unlink`
// both run, with the `@dir@` runtime token expanded to the worktree root.

Deno.test("worktree:teardown runs the configured db-drop and dev-server-unlink adapters", async () => {
  await withTempDir(async (dir) => {
    const wt = await mainWithWorktree(dir, "tear");
    // The recipe reads its config from the CURRENT root, which inside a worktree
    // resolves to the worktree's own discern.toml (find_root walks up from pwd
    // and stops at the worktree). So the adapter commands go there, not main's.
    // Harmless commands that drop a marker into the worktree root prove each seam
    // fired; `@dir@` expands to this worktree's checkout.
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      baseConfig(
        [
          "",
          "[worktree.db]",
          'drop = "touch @dir@/DB_DROPPED"',
          "",
          "[worktree.dev_server]",
          'unlink = "touch @dir@/SERVER_UNLINKED"',
        ].join("\n"),
      ),
    );

    const r = await runAgent(wt, ["worktree:teardown"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(wt, "DB_DROPPED")),
      `db drop adapter did not run (no DB_DROPPED marker)\n${r.output}`,
    );
    assert(
      await exists(join(wt, "SERVER_UNLINKED")),
      `dev-server unlink adapter did not run (no SERVER_UNLINKED marker)\n${r.output}`,
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
