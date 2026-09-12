/**
 * Unit coverage for the landed-branch settlement module: every scan
 * disposition the re-verification can reach, and the apply arms that clear,
 * keep, finish, fail loudly, and skip. The injected Git predicates let the
 * blocked arms fire deterministically; the delete arms run the real deletion
 * chokepoint against a scratch repository.
 */

import { join } from "@std/path";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Logger } from "../src/lib/log.ts";
import {
  applyOrphanedLandedBranches,
  type LandedBranchScanDeps,
  scanOrphanedLandedBranches,
} from "../src/engine/worktree/landed_branches.ts";
import {
  readRetiredWorktreeBranchRecords,
  recordRetiredWorktreeBranch,
} from "../src/engine/worktree/retired_paths.ts";
import {
  commitIsMerged,
  localBranchExists,
} from "../src/engine/worktree/git.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** A repo with one commit on main and `branch` pointing at that same commit. */
async function landedFixture(
  dir: string,
  branch: string,
): Promise<{ head: string }> {
  await Deno.writeTextFile(join(dir, "file.txt"), "content\n");
  await gitInit(dir);
  const head = await gitOut(dir, "rev-parse", "HEAD");
  await git(dir, "branch", branch, head);
  await recordRetiredWorktreeBranch(dir, {
    branch,
    expectedCommit: head,
    mergedInto: "main",
  });
  return { head };
}

/** The real predicates: the ordinary injection every production caller uses. */
const REAL_DEPS: LandedBranchScanDeps = { localBranchExists, commitIsMerged };

const QUIET = new Logger({ json: true, noColor: true });

Deno.test("landed-branch scan reaches every disposition from live refs", async (t) => {
  await t.step("a scheduled branch is left to its own removal", async () => {
    await withTempDir(async (dir) => {
      await landedFixture(dir, "agent/scheduled");
      const rows = await scanOrphanedLandedBranches(
        dir,
        "main",
        new Set(["agent/scheduled"]),
        new Set(),
        REAL_DEPS,
      );
      assertEquals(rows, []);
    });
  });

  await t.step(
    "a trunk record clears: the trunk is never deleted",
    async () => {
      await withTempDir(async (dir) => {
        await Deno.writeTextFile(join(dir, "file.txt"), "content\n");
        await gitInit(dir);
        const head = await gitOut(dir, "rev-parse", "HEAD");
        await recordRetiredWorktreeBranch(dir, {
          branch: "main",
          expectedCommit: head,
          mergedInto: "main",
        });
        const rows = await scanOrphanedLandedBranches(
          dir,
          "main",
          new Set(),
          new Set(),
          REAL_DEPS,
        );
        assertEquals(rows.map((row) => row.disposition), ["clear"]);
        assertStringIncludes(rows[0]?.reason ?? "", "never deleted");
      });
    },
  );

  await t.step("a re-checked-out branch clears", async () => {
    await withTempDir(async (dir) => {
      await landedFixture(dir, "agent/again");
      const rows = await scanOrphanedLandedBranches(
        dir,
        "main",
        new Set(),
        new Set(["agent/again"]),
        REAL_DEPS,
      );
      assertEquals(rows.map((row) => row.disposition), ["clear"]);
      assertStringIncludes(rows[0]?.reason ?? "", "checked out again");
    });
  });

  await t.step("an already-gone branch clears", async () => {
    await withTempDir(async (dir) => {
      await landedFixture(dir, "agent/gone");
      await git(dir, "branch", "-D", "agent/gone");
      const rows = await scanOrphanedLandedBranches(
        dir,
        "main",
        new Set(),
        new Set(),
        REAL_DEPS,
      );
      assertEquals(rows.map((row) => row.disposition), ["clear"]);
      assertStringIncludes(rows[0]?.reason ?? "", "already gone");
    });
  });

  await t.step("a moved branch clears: the record is superseded", async () => {
    await withTempDir(async (dir) => {
      await landedFixture(dir, "agent/moved");
      await git(dir, "checkout", "-q", "agent/moved");
      await Deno.writeTextFile(join(dir, "more.txt"), "later\n");
      await git(dir, "add", "-A");
      await git(dir, "commit", "-qm", "later work", "--no-gpg-sign");
      await git(dir, "checkout", "-q", "main");
      const rows = await scanOrphanedLandedBranches(
        dir,
        "main",
        new Set(),
        new Set(),
        REAL_DEPS,
      );
      assertEquals(rows.map((row) => row.disposition), ["clear"]);
      assertStringIncludes(rows[0]?.reason ?? "", "moved after its landing");
    });
  });

  await t.step("a missing merge target blocks", async () => {
    await withTempDir(async (dir) => {
      await landedFixture(dir, "agent/orphan");
      const rows = await scanOrphanedLandedBranches(
        dir,
        "main",
        new Set(),
        new Set(),
        {
          localBranchExists: () => Promise.resolve(false),
          commitIsMerged,
        },
      );
      assertEquals(rows.map((row) => row.disposition), ["blocked"]);
      assertStringIncludes(rows[0]?.reason ?? "", "unavailable to prove");
    });
  });

  await t.step("an unreachable recorded tip blocks", async () => {
    await withTempDir(async (dir) => {
      await landedFixture(dir, "agent/unreachable");
      const rows = await scanOrphanedLandedBranches(
        dir,
        "main",
        new Set(),
        new Set(),
        {
          localBranchExists,
          commitIsMerged: () => Promise.resolve(false),
        },
      );
      assertEquals(rows.map((row) => row.disposition), ["blocked"]);
      assertStringIncludes(rows[0]?.reason ?? "", "no longer reachable");
    });
  });

  await t.step("a proven record is deletable", async () => {
    await withTempDir(async (dir) => {
      await landedFixture(dir, "agent/proven");
      const rows = await scanOrphanedLandedBranches(
        dir,
        "main",
        new Set(),
        new Set(),
        REAL_DEPS,
      );
      assertEquals(rows.map((row) => row.disposition), ["delete"]);
      assertStringIncludes(
        rows[0]?.reason ?? "",
        "only the branch deletion remained",
      );
    });
  });
});

Deno.test("landed-branch apply clears, keeps, finishes, fails loudly, and skips", async (t) => {
  await t.step(
    "clear and blocked settle their records without Git effects",
    async () => {
      await withTempDir(async (dir) => {
        const { head } = await landedFixture(dir, "agent/kept");
        const outcome = await applyOrphanedLandedBranches(dir, [
          {
            branch: "agent/kept",
            expectedCommit: head,
            mergedInto: "main",
            recordedAt: "2026-09-12T00:00:00.000Z",
            disposition: "clear",
            reason: "the branch is checked out again",
          },
          {
            branch: "agent/blocked",
            expectedCommit: head,
            mergedInto: "main",
            recordedAt: "2026-09-12T00:00:00.000Z",
            disposition: "blocked",
            reason: "local branch 'main' is unavailable to prove the landing",
          },
        ], QUIET);
        assertEquals(outcome.deleted, []);
        assertEquals(outcome.failed, false);
        assertEquals(
          outcome.records.map((record) => [record.branch, record.action]),
          [["agent/kept", "cleared"], ["agent/blocked", "kept"]],
        );
        assertEquals(await readRetiredWorktreeBranchRecords(dir), []);
        assertEquals(
          await gitOut(dir, "rev-parse", "--verify", "agent/kept"),
          head,
        );
      });
    },
  );

  await t.step(
    "a proven deletion finishes and settles its record",
    async () => {
      await withTempDir(async (dir) => {
        const { head } = await landedFixture(dir, "agent/finish");
        const outcome = await applyOrphanedLandedBranches(dir, [
          {
            branch: "agent/finish",
            expectedCommit: head,
            mergedInto: "main",
            recordedAt: "2026-09-12T00:00:00.000Z",
            disposition: "delete",
            reason: "landed into main; only the branch deletion remained",
          },
        ], QUIET);
        assertEquals(outcome.deleted, ["agent/finish"]);
        assertEquals(outcome.failed, false);
        const listed = await gitOut(dir, "branch", "--list", "agent/finish");
        assertEquals(listed, "");
        assertEquals(await readRetiredWorktreeBranchRecords(dir), []);
      });
    },
  );

  await t.step(
    "an unavailable ref update fails loudly and keeps the record",
    async () => {
      await withTempDir(async (dir) => {
        const { head } = await landedFixture(dir, "agent/locked");
        const lock = join(dir, ".git", "refs", "heads", "agent", "locked.lock");
        await Deno.mkdir(join(dir, ".git", "refs", "heads", "agent"), {
          recursive: true,
        });
        await Deno.writeTextFile(lock, "");
        try {
          const outcome = await applyOrphanedLandedBranches(dir, [
            {
              branch: "agent/locked",
              expectedCommit: head,
              mergedInto: "main",
              recordedAt: "2026-09-12T00:00:00.000Z",
              disposition: "delete",
              reason: "landed into main; only the branch deletion remained",
            },
          ], QUIET);
          assertEquals(outcome.deleted, []);
          assertEquals(outcome.failed, true);
          assertEquals(
            outcome.records.map((record) => record.action),
            ["kept"],
          );
          assert((await readRetiredWorktreeBranchRecords(dir)).length === 1);
        } finally {
          await Deno.remove(lock);
        }
      });
    },
  );

  await t.step(
    "a tip that moved between scan and apply skips without failing",
    async () => {
      await withTempDir(async (dir) => {
        const { head } = await landedFixture(dir, "agent/raced");
        await git(dir, "checkout", "-q", "agent/raced");
        await Deno.writeTextFile(join(dir, "race.txt"), "raced\n");
        await git(dir, "add", "-A");
        await git(dir, "commit", "-qm", "raced", "--no-gpg-sign");
        await git(dir, "checkout", "-q", "main");
        const outcome = await applyOrphanedLandedBranches(dir, [
          {
            branch: "agent/raced",
            expectedCommit: head,
            mergedInto: "main",
            recordedAt: "2026-09-12T00:00:00.000Z",
            disposition: "delete",
            reason: "landed into main; only the branch deletion remained",
          },
        ], QUIET);
        assertEquals(outcome.deleted, []);
        assertEquals(outcome.failed, false);
        assertEquals(
          outcome.records.map((record) => record.action),
          ["kept"],
        );
        const survives = await gitOut(
          dir,
          "rev-parse",
          "--verify",
          "agent/raced",
        );
        assert(survives !== head && survives !== "");
      });
    },
  );
});
