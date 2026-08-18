/**
 * The effort-diff collector (`src/engine/checkpoints/diff.ts`) against real
 * temp repositories: committed, staged, unstaged, and untracked changes all
 * arrive; kinds and line stats are right; renames stay a deletion plus an
 * addition; and the merge-base listing rides along.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { collectEffortDiff } from "../src/engine/checkpoints/diff.ts";
import type { EffortFileChange } from "../src/engine/checkpoints/types.ts";

/** The collected diff indexed by path, asserting collection succeeded. */
async function collected(
  dir: string,
  base: string,
): Promise<{
  byPath: Map<string, EffortFileChange>;
  baseFiles: readonly string[];
}> {
  const diff = await collectEffortDiff(dir, base);
  assert(diff !== undefined, "expected the effort diff to collect");
  return {
    byPath: new Map(diff.files.map((f) => [f.path, f])),
    baseFiles: diff.baseFiles,
  };
}

Deno.test("collectEffortDiff sees committed, staged, unstaged, and untracked changes", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "kept.txt"), "one\ntwo\n");
    await Deno.writeTextFile(join(dir, "gone.txt"), "a\nb\nc\n");
    await Deno.writeTextFile(join(dir, "staged.txt"), "before\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");

    // Committed: modify kept.txt.
    await Deno.writeTextFile(join(dir, "kept.txt"), "one\ntwo\nthree\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "grow kept", "--no-gpg-sign");
    // Staged: rewrite staged.txt.
    await Deno.writeTextFile(join(dir, "staged.txt"), "after\nmore\n");
    await git(dir, "add", "staged.txt");
    // Unstaged: delete gone.txt from disk only.
    await Deno.remove(join(dir, "gone.txt"));
    // Untracked: a brand-new file (unterminated last line still counts).
    await Deno.writeTextFile(join(dir, "fresh.txt"), "x\ny\nz");

    const { byPath, baseFiles } = await collected(dir, base);
    assertEquals(byPath.get("kept.txt")?.kind, "modified");
    assertEquals(byPath.get("kept.txt")?.insertions, 1);
    assertEquals(byPath.get("staged.txt")?.kind, "modified");
    assertEquals(byPath.get("gone.txt")?.kind, "deleted");
    assertEquals(byPath.get("gone.txt")?.deletions, 3);
    assertEquals(byPath.get("fresh.txt"), {
      path: "fresh.txt",
      kind: "added",
      insertions: 3,
      deletions: 0,
      binary: false,
    });
    assert(baseFiles.includes("kept.txt"));
    assert(baseFiles.includes("gone.txt"));
    assert(!baseFiles.includes("fresh.txt"));
  });
});

Deno.test("a rename reads as a deletion plus an addition", async () => {
  await withTempDir(async (dir) => {
    const body = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n") +
      "\n";
    await Deno.writeTextFile(join(dir, "old_name.txt"), body);
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await git(dir, "mv", "old_name.txt", "new_name.txt");
    const { byPath } = await collected(dir, base);
    assertEquals(byPath.get("old_name.txt")?.kind, "deleted");
    assertEquals(byPath.get("new_name.txt")?.kind, "added");
  });
});

Deno.test("binary content carries the binary flag with zeroed line stats", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    // Tracked binary (via numstat "-") and untracked binary (via the sniff).
    await Deno.writeFile(
      join(dir, "tracked.bin"),
      new Uint8Array([0, 1, 2, 3]),
    );
    await git(dir, "add", "tracked.bin");
    await Deno.writeFile(
      join(dir, "untracked.bin"),
      new Uint8Array([65, 0, 66]),
    );
    const { byPath } = await collected(dir, base);
    assertEquals(byPath.get("tracked.bin"), {
      path: "tracked.bin",
      kind: "added",
      insertions: 0,
      deletions: 0,
      binary: true,
    });
    assertEquals(byPath.get("untracked.bin"), {
      path: "untracked.bin",
      kind: "added",
      insertions: 0,
      deletions: 0,
      binary: true,
    });
  });
});

Deno.test("a committed change reverted in the working tree drops out of the diff", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "wobble.txt"), "original\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    await Deno.writeTextFile(join(dir, "wobble.txt"), "changed\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "change", "--no-gpg-sign");
    // Revert on disk without committing: net change versus the base is zero.
    await Deno.writeTextFile(join(dir, "wobble.txt"), "original\n");
    const { byPath } = await collected(dir, base);
    assertEquals(byPath.get("wobble.txt"), undefined);
  });
});

Deno.test("an empty effort collects an empty diff, and a bad base fails soft", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");
    const diff = await collectEffortDiff(dir, base);
    assert(diff !== undefined);
    assertEquals(diff.files, []);
    assert(diff.baseFiles.length > 0);
    assertEquals(
      await collectEffortDiff(dir, "0000000000000000000000000000000000000000"),
      undefined,
    );
  });
});

Deno.test("outside a repository the collector answers undefined (fail open)", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await collectEffortDiff(dir, "HEAD"), undefined);
  });
});

