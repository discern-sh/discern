/** Working-state comparison must retain changes absent from the tracked diff. */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  EMPTY_TREE_DIFF_FINGERPRINT,
  treeDiffFingerprint,
  workingStateFingerprint,
} from "../src/shared/tree_identity.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("working-state fingerprints distinguish staging, renamed and deleted paths, and untracked edits", async () => {
  await withTempDir(async (root) => {
    assertEquals(await workingStateFingerprint(root), undefined);
    assertEquals(await treeDiffFingerprint(root), undefined);
    await Deno.writeTextFile(`${root}/tracked`, "initial\n");
    await Deno.writeTextFile(`${root}/old name`, "rename me\n");
    await gitInit(root);

    const clean = await workingStateFingerprint(root);
    assert(clean !== undefined);
    assertEquals(await treeDiffFingerprint(root), EMPTY_TREE_DIFF_FINGERPRINT);
    await Deno.writeTextFile(`${root}/tracked`, "edited\n");
    const unstaged = await workingStateFingerprint(root);
    assert(unstaged !== undefined);
    assertNotEquals(unstaged, clean);
    await git(root, "add", "tracked");
    const staged = await workingStateFingerprint(root);
    assert(staged !== undefined);
    assertNotEquals(
      staged,
      unstaged,
      "staging changes the working-state identity",
    );
    assertEquals(await workingStateFingerprint(root), staged);

    await git(root, "mv", "old name", "new name");
    const renamed = await workingStateFingerprint(root);
    assert(renamed !== undefined);
    assertNotEquals(renamed, staged);
    await Deno.remove(`${root}/tracked`);
    const deleted = await workingStateFingerprint(root);
    assert(deleted !== undefined);
    assertNotEquals(deleted, renamed);

    const trackedOnly = await treeDiffFingerprint(root);
    assert(trackedOnly !== undefined);
    assertNotEquals(trackedOnly, EMPTY_TREE_DIFF_FINGERPRINT);
    await Deno.mkdir(`${root}/untracked`);
    await Deno.writeTextFile(`${root}/untracked/input`, "first\n");
    const added = await workingStateFingerprint(root);
    assert(added !== undefined);
    assertNotEquals(added, deleted);
    await Deno.writeTextFile(`${root}/untracked/input`, "a longer revision\n");
    const revised = await workingStateFingerprint(root);
    assert(revised !== undefined);
    assertNotEquals(
      revised,
      added,
      "an edit inside an untracked directory moves identity",
    );
    assertEquals(await treeDiffFingerprint(root), trackedOnly);
    assertEquals(await workingStateFingerprint(root), revised);

    await git(root, "restore", "--staged", "--worktree", "--", ".");
    await Deno.remove(`${root}/untracked`, { recursive: true });
    assertEquals(await workingStateFingerprint(root), clean);
  });
});
