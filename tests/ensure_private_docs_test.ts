/**
 * The private-overlay ensure script (`project/scripts/ensure_private_docs.ts`)
 * must be boring in every environment: it symlinks the main checkout's
 * `project/map/_private/` into a linked worktree when — and only when — the
 * overlay exists there, heals a broken link, never touches a real directory,
 * and is a silent successful no-op everywhere else (a contributor's clean
 * public clone above all). Each behaviour is proven against a hermetic git
 * fixture with a real linked worktree.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const SCRIPT = join(REPO_ROOT, "project", "scripts", "ensure_private_docs.ts");

const OVERLAY_REL = join("project", "map", "_private");

interface EnsureRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the ensure script exactly as `[worktree.setup].ensure` would. */
async function runEnsure(cwd: string): Promise<EnsureRun> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "--allow-write", "--allow-run=git", SCRIPT],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

/** The silent-success contract every path of the script keeps. */
function assertSilentSuccess(run: EnsureRun, label: string): void {
  assertEquals(run.code, 0, `${label}: must exit 0 (stderr: ${run.stderr})`);
  assertEquals(run.stdout, "", `${label}: must write nothing to stdout`);
  assertEquals(run.stderr, "", `${label}: must write nothing to stderr`);
}

/** A hermetic main checkout (with a tracked project/map) plus one linked
 * worktree — the layout the worktree lifecycle runs the script in. */
async function scaffold(
  dir: string,
): Promise<{ main: string; worktree: string }> {
  const main = join(dir, "main");
  await ensureDir(join(main, "project", "map"));
  await Deno.writeTextFile(
    join(main, "project", "map", "README.md"),
    "# Map\n",
  );
  await gitInit(main);
  const worktree = join(dir, "wt");
  await git(main, "worktree", "add", worktree, "-b", "ensure-test");
  return { main, worktree };
}

Deno.test("ensure_private_docs symlinks the overlay into a linked worktree", async () => {
  await withTempDir(async (dir) => {
    const { main, worktree } = await scaffold(dir);
    // The post-scrub shape: the overlay exists only in the main checkout,
    // untracked (a private clone), so the worktree starts without it.
    await ensureDir(join(main, OVERLAY_REL));
    await Deno.writeTextFile(join(main, OVERLAY_REL, "notes.md"), "secret\n");

    assertSilentSuccess(await runEnsure(worktree), "first run");
    const target = join(worktree, OVERLAY_REL);
    assert((await Deno.lstat(target)).isSymlink, "the overlay must be linked");
    assertEquals(
      await Deno.readTextFile(join(target, "notes.md")),
      "secret\n",
      "the overlay must be readable through the canonical path",
    );

    // Idempotent: a healthy link is left exactly as it is.
    assertSilentSuccess(await runEnsure(worktree), "re-run");
    assert((await Deno.lstat(target)).isSymlink);

    // Healing: a broken or mispointed link is replaced, not worked around.
    await Deno.remove(target);
    await Deno.symlink(join(dir, "nowhere"), target, { type: "dir" });
    assertSilentSuccess(await runEnsure(worktree), "heal run");
    assertEquals(
      await Deno.readTextFile(join(target, "notes.md")),
      "secret\n",
      "a broken link must be healed back to the overlay",
    );
  });
});

Deno.test("ensure_private_docs never touches a real directory at the target", async () => {
  await withTempDir(async (dir) => {
    const { main, worktree } = await scaffold(dir);
    await ensureDir(join(main, OVERLAY_REL));
    // The pre-scrub shape: the worktree's _private files are real, tracked
    // content — the script must leave them alone.
    const target = join(worktree, OVERLAY_REL);
    await ensureDir(target);
    await Deno.writeTextFile(join(target, "tracked.md"), "keep me\n");

    assertSilentSuccess(await runEnsure(worktree), "real-directory run");
    const info = await Deno.lstat(target);
    assert(!info.isSymlink && info.isDirectory, "the real directory survives");
    assertEquals(
      await Deno.readTextFile(join(target, "tracked.md")),
      "keep me\n",
    );
  });
});

Deno.test("ensure_private_docs no-ops silently when there is no overlay to link", async () => {
  await withTempDir(async (dir) => {
    const { worktree } = await scaffold(dir);

    assertSilentSuccess(await runEnsure(worktree), "clean-clone run");
    assertEquals(
      await Deno.lstat(join(worktree, OVERLAY_REL)).catch(() => undefined),
      undefined,
      "nothing may be created when the main checkout has no overlay",
    );
  });
});

Deno.test("ensure_private_docs no-ops in the main checkout itself", async () => {
  await withTempDir(async (dir) => {
    const { main } = await scaffold(dir);
    await ensureDir(join(main, OVERLAY_REL));
    await Deno.writeTextFile(join(main, OVERLAY_REL, "notes.md"), "secret\n");

    assertSilentSuccess(await runEnsure(main), "main-checkout run");
    const info = await Deno.lstat(join(main, OVERLAY_REL));
    assert(
      !info.isSymlink && info.isDirectory,
      "the main checkout's overlay must never be replaced by a link",
    );
  });
});

Deno.test("ensure_private_docs no-ops silently outside any git repository", async () => {
  await withTempDir(async (dir) => {
    const bare = join(dir, "no-repo");
    await ensureDir(bare);
    assertSilentSuccess(await runEnsure(bare), "non-repo run");
    assertEquals(
      await Deno.lstat(join(bare, OVERLAY_REL)).catch(() => undefined),
      undefined,
    );
  });
});
