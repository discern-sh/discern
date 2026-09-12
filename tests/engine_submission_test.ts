/**
 * The effort's submission: worktree-scoped placement beside the grant,
 * replacement by a later submission, consumption, and forward-version refusal.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, isAbsolute, join } from "@std/path";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import {
  clearSubmission,
  recordSubmission,
} from "../src/engine/worktree/submission_writer.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { addWorktree, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const POINTER = {
  candidate_id: "0f1e2d3c-4b5a-4978-8a9b-0c1d2e3f4a5b",
  proof_id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
};

Deno.test("a submission is recorded beside the grant, replaced, and consumed", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "overnight");
    const head = await gitOut(worktree, "rev-parse", "HEAD");
    const tree = await gitOut(worktree, "rev-parse", "HEAD^{tree}");
    assertEquals(await readSubmission(worktree), { status: "missing" });

    const first = await recordSubmission(worktree, {
      id: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      effort_id: "overnight",
      branch: "agent/overnight",
      head,
      tree,
      proof: POINTER,
      submitted_at: "2026-09-12T08:00:00.000Z",
    });
    assertEquals(first.version, ON_DISK_FORMATS.submission.version);
    assertEquals(await readSubmission(worktree), {
      status: "submitted",
      submission: first,
    });

    const path = await gitAdminStatePath(worktree, "submission");
    assert(path !== undefined && isAbsolute(path));
    const mainGitDir = await gitOut(dir, "rev-parse", "--absolute-git-dir");
    assert(
      path.startsWith(`${mainGitDir}/worktrees/`),
      "the submission lives under the linked worktree's Git administration, never in its tree",
    );
    assertEquals(
      dirname(path),
      dirname((await gitAdminStatePath(worktree, "effortGrant")) ?? ""),
    );

    const second = await recordSubmission(worktree, {
      ...first,
      id: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f",
      submitted_at: "2026-09-12T09:00:00.000Z",
    });
    const replaced = await readSubmission(worktree);
    assert(replaced.status === "submitted");
    assertEquals(replaced.submission.id, second.id, "a later accept replaces");

    await clearSubmission(worktree);
    assertEquals(await readSubmission(worktree), { status: "missing" });
    await clearSubmission(worktree); // absence is settled, not an error
    assertEquals(await readSubmission(worktree), { status: "missing" });
  });
});

Deno.test("a submission never names a revision outside its effort's branch shape", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "shape");
    await assertRejects(() =>
      recordSubmission(worktree, {
        id: "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f80",
        effort_id: "shape",
        branch: "agent/shape",
        head: "not-a-commit",
        tree: "0".repeat(40),
        proof: POINTER,
        submitted_at: "2026-09-12T09:00:00.000Z",
      })
    );
    assertEquals(await readSubmission(worktree), { status: "missing" });
  });
});

Deno.test("a newer submission format refuses instead of reading as absent", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "newer");
    const path = await gitAdminStatePath(worktree, "submission");
    assert(path !== undefined);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(
      path,
      JSON.stringify({ version: ON_DISK_FORMATS.submission.version + 1 }),
    );
    const read = await readSubmission(worktree);
    assertEquals(read.status, "newer");
    await Deno.writeTextFile(path, '{"version": 1, "branch": 3}');
    assertEquals((await readSubmission(worktree)).status, "invalid");
  });
});
