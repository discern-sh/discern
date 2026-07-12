/**
 * Worktree error-copy guard: every location failure defines the unfamiliar term
 * it uses and gives one concrete recovery step. These are class-level tests over
 * the shared Git predicates, so every lifecycle verb inherits the same voice.
 */

import { assert, assertStringIncludes } from "@std/assert";
import {
  assertInWorktree,
  assertNotInWorktree,
  ensureWorktreeBranch,
  missingIntegrationBranchWarning,
  WorktreeGitError,
} from "../src/engine/worktree/git.ts";
import { addWorktree, git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

async function refusal(run: () => Promise<void | string>): Promise<string> {
  try {
    await run();
  } catch (error) {
    assert(error instanceof WorktreeGitError);
    return error.message;
  }
  throw new Error("expected a WorktreeGitError");
}

Deno.test("worktree location errors define the term and end in a recovery", async () => {
  await withTempDir(async (dir) => {
    const outside = await refusal(() =>
      assertInWorktree("discern update", dir)
    );
    assertStringIncludes(outside, "needs a Git repository");
    assertStringIncludes(outside, "git init");
    assertStringIncludes(outside, "then re-run");

    await Deno.writeTextFile(`${dir}/README.md`, "fixture\n");
    await gitInit(dir);
    const main = await refusal(() => assertInWorktree("discern update", dir));
    assertStringIncludes(main, "separate checkout and branch for one change");
    assertStringIncludes(main, "discern start");
    assertStringIncludes(main, "then re-run");

    const worktree = await addWorktree(dir, "copy-guard");
    const linked = await refusal(() =>
      assertNotInWorktree("discern start", worktree)
    );
    assertStringIncludes(linked, "main checkout");
    assertStringIncludes(linked, "git worktree list");
    assertStringIncludes(linked, "then re-run");

    await git(worktree, "checkout", "--detach");
    const detached = await refusal(() =>
      ensureWorktreeBranch("not a branch", worktree)
    );
    assertStringIncludes(detached, "invalid branch name");
    assertStringIncludes(detached, "[project].branch_prefix");
    assertStringIncludes(detached, "then re-run");
  });
});

Deno.test("a missing trunk warning uses one name and gives the repair", () => {
  const message = missingIntegrationBranchWarning("main");
  assertStringIncludes(message, "trunk branch 'main'");
  assertStringIncludes(message, "[project].main_branch");
  assertStringIncludes(message, "then re-run");
  assert(!message.includes("integration branch"));
});
