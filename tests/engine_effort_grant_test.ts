/**
 * The desk-owned, worktree-scoped landing grant: storage lifetime,
 * forge-resistant placement, idempotence, and the sole production writer.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, isAbsolute, join } from "@std/path";
import {
  type EffortGrant,
  readEffortGrant,
} from "../src/engine/worktree/effort_grant.ts";
import {
  claimEffortGrant,
  clearEffortGrant,
  clearEffortGrantPlan,
  consumeEffortGrantClaim,
  consumeEffortGrantClaimById,
  restoreEffortGrantClaim,
  settleEffortGrantClaim,
} from "../src/engine/worktree/effort_grant_cleanup.ts";
import {
  effortGrantPlan,
  grantEffort,
} from "../src/engine/worktree/effort_grant_writer.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { addWorktree, git, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const FIRST_GRANT = "2026-07-28T21:00:00.000Z";
const SECOND_GRANT = "2026-07-28T22:00:00.000Z";

/** Build one current-format effort grant fixture. */
function grantRecord(branch: string, grantedAt: string): EffortGrant {
  return {
    version: ON_DISK_FORMATS.effortGrant.version,
    branch,
    granted_at: grantedAt,
  };
}

Deno.test("effort grant round-trips idempotently outside the worktree tree", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "overnight");
    const branch = await gitOut(worktree, "branch", "--show-current");

    const before = await effortGrantPlan(worktree, branch);
    assertEquals(before.steps.map((step) => step.disposition), ["run"]);
    assertStringIncludes(before.details.join("\n"), branch);

    assertEquals(
      await grantEffort(worktree, branch, FIRST_GRANT),
      {
        status: "granted",
        grant: grantRecord(branch, FIRST_GRANT),
      },
    );
    assertEquals(await readEffortGrant(worktree), {
      status: "granted",
      grant: grantRecord(branch, FIRST_GRANT),
    });
    assertEquals(
      (await effortGrantPlan(worktree, branch)).steps.map((step) =>
        step.disposition
      ),
      ["skip"],
    );
    assertEquals(
      await grantEffort(worktree, branch, SECOND_GRANT),
      {
        status: "already_granted",
        grant: grantRecord(branch, FIRST_GRANT),
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
        grant: grantRecord("agent/renamed", SECOND_GRANT),
      },
      "a branch identity change replaces stale authority",
    );
    assertEquals(
      (await clearEffortGrantPlan(worktree)).steps.map((step) =>
        step.disposition
      ),
      ["run"],
    );
    assertEquals(await clearEffortGrant(worktree), true);
    assertEquals(await readEffortGrant(worktree), { status: "missing" });
    assertEquals(
      (await clearEffortGrantPlan(worktree)).steps.map((step) =>
        step.disposition
      ),
      ["skip"],
    );
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
    for (
      const raw of [
        "not json\n",
        "[]\n",
        '{"branch": 42}\n',
      ]
    ) {
      await Deno.writeTextFile(marker, raw);
      const read = await readEffortGrant(worktree);
      assert(read.status === "invalid");
      assertStringIncludes(
        read.reason,
        "effort-grant record",
        "a malformed grant reason can reach authority warnings, so it must name " +
          "the record instead of relying on storage shorthand",
      );
    }
  });
});

Deno.test("an effort grant written by a newer discern grants no authority and is preserved", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "newer-grant");
    const branch = await gitOut(worktree, "branch", "--show-current");
    const marker = await gitAdminStatePath(worktree, "effortGrant");
    assert(marker !== undefined);
    await Deno.mkdir(dirname(marker), { recursive: true });
    const future = `${
      JSON.stringify({
        version: ON_DISK_FORMATS.effortGrant.version + 1,
        branch,
        granted_at: FIRST_GRANT,
        future_authority: true,
      })
    }\n`;
    await Deno.writeTextFile(marker, future);

    const read = await readEffortGrant(worktree);
    assert(read.status === "newer");
    assertStringIncludes(read.reason, "written by a newer discern");
    await assertRejects(
      () => effortGrantPlan(worktree, branch),
      Error,
      "Update discern",
    );
    await assertRejects(
      () => clearEffortGrantPlan(worktree),
      Error,
      "Update discern",
    );
    await assertRejects(
      () => grantEffort(worktree, branch, SECOND_GRANT),
      Error,
      "Update discern",
    );
    await assertRejects(
      () => clearEffortGrant(worktree),
      Error,
      "Update discern",
    );
    const claimed = await claimEffortGrant(
      worktree,
      branch,
      "12345678-1234-4123-8123-123456789abc",
    );
    assert(claimed.status === "newer");
    assertEquals(await Deno.readTextFile(marker), future);

    const claims = await gitAdminStatePath(worktree, "effortGrantClaims");
    assert(claims !== undefined);
    const claimId = "87654321-4321-4321-8321-cba987654321";
    const claimPath = join(claims, claimId);
    await Deno.mkdir(dirname(claimPath), { recursive: true });
    await Deno.writeTextFile(claimPath, future);
    assertEquals(
      await consumeEffortGrantClaimById(worktree, claimId),
      false,
    );
    assertEquals(await Deno.readTextFile(claimPath), future);
  });
});

Deno.test("effort grant claim linearizes accept against desk revoke and re-grant", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "claim-race");
    const branch = await gitOut(worktree, "branch", "--show-current");
    await grantEffort(worktree, branch, FIRST_GRANT);

    const first = await claimEffortGrant(worktree, branch);
    assert(first.status === "claimed");
    assertEquals(await readEffortGrant(worktree), { status: "missing" });
    assertEquals(
      await clearEffortGrant(worktree),
      false,
      "acceptance claimed the grant before revoke linearized",
    );
    assertEquals(
      await restoreEffortGrantClaim(worktree, first.claim),
      true,
    );
    assertEquals(await readEffortGrant(worktree), {
      status: "granted",
      grant: grantRecord(branch, FIRST_GRANT),
    });

    const second = await claimEffortGrant(worktree, branch);
    assert(second.status === "claimed");
    await grantEffort(worktree, branch, SECOND_GRANT);
    assertEquals(
      await restoreEffortGrantClaim(worktree, second.claim),
      true,
      "a newer desk grant wins over restoration of the consumed evidence",
    );
    assertEquals(await readEffortGrant(worktree), {
      status: "granted",
      grant: grantRecord(branch, SECOND_GRANT),
    });

    const final = await claimEffortGrant(worktree, branch);
    assert(final.status === "claimed");
    assertEquals(await consumeEffortGrantClaim(final.claim), true);
    assertEquals(await readEffortGrant(worktree), { status: "missing" });
  });
});

Deno.test("effort claim settlement follows the trunk ref, never the checkout report", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "claim-settlement");
    const branch = await gitOut(worktree, "branch", "--show-current");

    await grantEffort(worktree, branch, FIRST_GRANT);
    const irreversible = await claimEffortGrant(worktree, branch);
    assert(irreversible.status === "claimed");
    assertEquals(
      await settleEffortGrantClaim(worktree, irreversible.claim, {
        kind: "checkout-failed",
        detail: "checkout failed and ref rollback lost its race",
        rolledBack: false,
      }),
      { disposition: "consume", settled: true },
      "authority is spent whenever the trunk remained advanced",
    );
    assertEquals(await readEffortGrant(worktree), { status: "missing" });

    await grantEffort(worktree, branch, SECOND_GRANT);
    const refused = await claimEffortGrant(worktree, branch);
    assert(refused.status === "claimed");
    assertEquals(
      await settleEffortGrantClaim(worktree, refused.claim, {
        kind: "checkout-failed",
        detail: "checkout failed but ref rollback succeeded",
        rolledBack: true,
      }),
      { disposition: "restore", settled: true },
      "authority returns only when the old trunk ref is known to be restored",
    );
    assertEquals(await readEffortGrant(worktree), {
      status: "granted",
      grant: grantRecord(branch, SECOND_GRANT),
    });

    const stuck = join(dir, "non-empty-claim");
    await Deno.mkdir(stuck);
    await Deno.writeTextFile(join(stuck, "kept"), "claim\n");
    assertEquals(
      await settleEffortGrantClaim(
        worktree,
        {
          path: stuck,
          grant: grantRecord(branch, SECOND_GRANT),
          raw: "{}\n",
        },
        { kind: "updated" },
      ),
      { disposition: "consume", settled: false },
      "claim cleanup failure is reported instead of throwing after the ref moved",
    );
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
