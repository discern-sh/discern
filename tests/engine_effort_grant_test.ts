/**
 * The desk-owned, worktree-scoped landing grant: storage lifetime,
 * forge-resistant placement, idempotence, and the sole production writer.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, isAbsolute, join } from "@std/path";
import {
  clearEffortGrant,
  grantEffort,
  readEffortGrant,
} from "../src/engine/worktree/effort_grant.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { addWorktree, git, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

const FIRST_GRANT = "2026-07-28T21:00:00.000Z";
const SECOND_GRANT = "2026-07-28T22:00:00.000Z";

Deno.test("effort grant round-trips idempotently outside the worktree tree", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "overnight");
    const branch = await gitOut(worktree, "branch", "--show-current");

    assertEquals(
      await grantEffort(worktree, branch, FIRST_GRANT),
      {
        status: "granted",
        grant: { branch, granted_at: FIRST_GRANT },
      },
    );
    assertEquals(await readEffortGrant(worktree), {
      status: "granted",
      grant: { branch, granted_at: FIRST_GRANT },
    });
    assertEquals(
      await grantEffort(worktree, branch, SECOND_GRANT),
      {
        status: "already_granted",
        grant: { branch, granted_at: FIRST_GRANT },
      },
      "repeating the same decision must preserve its original evidence",
    );

    const marker = await gitAdminStatePath(worktree, "effortGrant");
    assert(marker !== undefined);
    const mainGitDir = await gitOut(dir, "rev-parse", "--absolute-git-dir");
    assert(isAbsolute(marker));
    assert(
      marker.startsWith(`${join(mainGitDir, "worktrees")}/`),
      "linked-worktree state must live in the main repository's Git admin area",
    );
    assert(
      !marker.startsWith(`${worktree}/`),
      "an effort must not be able to write its grant into its own checkout",
    );
    assertEquals(
      await gitOut(worktree, "status", "--short"),
      "",
      "granting must leave the branch-writable tree untouched",
    );

    assertEquals(
      await grantEffort(worktree, "agent/renamed", SECOND_GRANT),
      {
        status: "granted",
        grant: {
          branch: "agent/renamed",
          granted_at: SECOND_GRANT,
        },
      },
      "a branch identity change replaces stale authority",
    );
    assertEquals(await clearEffortGrant(worktree), true);
    assertEquals(await readEffortGrant(worktree), { status: "missing" });
    assertEquals(await clearEffortGrant(worktree), false);
  });
});

Deno.test("effort grant reads fail closed for malformed or unavailable state", async () => {
  await withTempDir(async (dir) => {
    assertEquals((await readEffortGrant(dir)).status, "unavailable");

    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "malformed-grant");
    const marker = await gitAdminStatePath(worktree, "effortGrant");
    assert(marker !== undefined);
    await Deno.mkdir(dirname(marker), { recursive: true });
    await Deno.writeTextFile(marker, '{"branch": 42}\n');

    const read = await readEffortGrant(worktree);
    assertEquals(read.status, "invalid");
  });
});

Deno.test("Git worktree removal reaps its effort grant with no orphan state", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "short-lived");
    const branch = await gitOut(worktree, "branch", "--show-current");
    await grantEffort(worktree, branch, FIRST_GRANT);
    const marker = await gitAdminStatePath(worktree, "effortGrant");
    assert(marker !== undefined);
    await Deno.stat(marker);

    await git(dir, "worktree", "remove", worktree);
    try {
      await Deno.stat(marker);
      throw new Error("worktree removal left an orphaned effort grant");
    } catch (error) {
      assert(
        error instanceof Deno.errors.NotFound,
        "Git must remove the worktree-scoped administrative directory",
      );
    }
  });
});

Deno.test("the interactive desk is the only production effort-grant writer", async () => {
  const allowed = new Set([
    "src/engine/desk/desk.ts",
    "src/engine/worktree/effort_grant.ts",
  ]);
  const offenders: string[] = [];
  for (
    const rel of AUTHORED_TS_FILES.filter((path) => path.startsWith("src/"))
  ) {
    if (allowed.has(rel)) continue;
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (/\b(?:grantEffort|clearEffortGrant)\s*\(/.test(source)) {
      offenders.push(rel);
    }
  }
  assertEquals(
    offenders,
    [],
    "agent-run CLI and MCP code may read landing authority, never write it",
  );
});
