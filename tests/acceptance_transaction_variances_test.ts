/**
 * Acceptance journals bind narrow owner decisions to one exact
 * expected-to-target transition. The single v1 record always carries consent,
 * checkpoint variances, and Standard limit proposal arrays. Recorded grants
 * cannot authorize either narrow decision, and malformed/duplicated bindings
 * remain inert for inspection instead of replaying onto another tree.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { addWorktree, gitInit, gitOut } from "./engine_helpers.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  inspectInterruptedAcceptance,
} from "../src/engine/worktree/acceptance_transaction.ts";
import { WorktreeGitError } from "../src/engine/worktree/git.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const TRANSACTION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** A repo + worktree pair whose journal the inspection reads. */
async function journaledWorktree(
  dir: string,
): Promise<{ wt: string; path: string }> {
  await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
  await gitInit(dir);
  const wt = await addWorktree(dir, "journaled");
  const path = await gitAdminStatePath(wt, "acceptanceTransaction");
  assert(path !== undefined);
  await Deno.mkdir(join(path, ".."), { recursive: true });
  return { wt, path };
}

/** A structurally valid canonical journal body for this repo pair. */
function journal(
  dir: string,
  overrides: Record<string, unknown> = {},
): string {
  return `${
    JSON.stringify({
      version: ON_DISK_FORMATS.acceptanceTransaction.version,
      id: TRANSACTION_ID,
      worktree_branch: "agent/journaled",
      trunk: "main",
      expected_trunk: SHA_A,
      target: SHA_B,
      main_repo: dir,
      effort_claim: false,
      consent: { source: "conversation" },
      variances: [
        {
          checkpoint: "api-review",
          definition_hash: "def-hash",
          subject: "subject-fingerprint",
          why: "The docs lag the new surface.",
        },
      ],
      standard_proposals: [],
      ...overrides,
    })
  }\n`;
}

/** One structurally valid exact Standard proposal for journal tests. */
function standardProposal(): Record<string, unknown> {
  return {
    standard: "source_count",
    commit: SHA_B,
    bound_commit: SHA_B,
    measured_commit: SHA_A,
    definition_fingerprint: "definition-fingerprint",
    trunk: "main",
    trunk_commit: SHA_A,
    direction: "down",
    trunk_limit: 1,
    proposed_limit: 2,
    measurement: 2,
    delta: 1,
    reason: "The accepted feature adds one required source.",
    evidence_paths: ["src/feature.ts"],
  };
}

Deno.test("journal v1: a complete record surfaces its journal-bound consent", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(path, journal(dir));
    const inspected = await inspectInterruptedAcceptance(wt, "main");
    assert(inspected.kind === "recorded");
    assertEquals(inspected.consent, { source: "conversation" });
    assertEquals(inspected.transaction.target, SHA_B);
  });
});

Deno.test("journal v1: variances under a recorded grant are invalid", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, { consent: { source: "standing-grant", scopes: ["api"] } }),
    );
    await assertRejects(
      () => inspectInterruptedAcceptance(wt, "main"),
      WorktreeGitError,
      "invalid",
    );
    // The refusal preserved the journal for inspection.
    assertEquals(await Deno.readTextFile(path) !== "", true);
  });
});

Deno.test("journal v1: a malformed variance binding is invalid", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        variances: [{ checkpoint: "api-review", why: "" }],
      }),
    );
    await assertRejects(
      () => inspectInterruptedAcceptance(wt, "main"),
      WorktreeGitError,
      "invalid",
    );
  });
});

Deno.test("journal v1: empty decision arrays parse for an ordinary landing", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        consent: { source: "effort-grant" },
        effort_claim: true,
        variances: [],
        standard_proposals: [],
      }),
    );
    const inspected = await inspectInterruptedAcceptance(wt, "main");
    assert(inspected.kind === "recorded");
    assertEquals(inspected.transaction.version, 1);
  });
});

Deno.test("journal v1: exact Standard proposals preserve conversation consent", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        variances: [],
        standard_proposals: [standardProposal()],
      }),
    );
    const inspected = await inspectInterruptedAcceptance(wt, "main");
    assert(inspected.kind === "recorded");
    assert(inspected.transaction.version === 1);
    assertEquals(inspected.consent, { source: "conversation" });
    assertEquals(
      inspected.transaction.standard_proposals[0]?.reason,
      "The accepted feature adds one required source.",
    );
    assertEquals(
      inspected.transaction.standard_proposals[0]?.bound_commit,
      SHA_B,
    );
  });
});

Deno.test("journal v1: a recorded grant cannot authorize a Standard proposal", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        consent: { source: "standing-grant", scopes: ["code"] },
        variances: [],
        standard_proposals: [standardProposal()],
      }),
    );
    await assertRejects(
      () => inspectInterruptedAcceptance(wt, "main"),
      WorktreeGitError,
      "invalid",
    );
  });
});

Deno.test("journal v1: duplicate or malformed proposal tuples are invalid", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        variances: [],
        standard_proposals: [standardProposal(), standardProposal()],
      }),
    );
    await assertRejects(
      () => inspectInterruptedAcceptance(wt, "main"),
      WorktreeGitError,
      "invalid",
    );

    await Deno.writeTextFile(
      path,
      journal(dir, {
        variances: [],
        standard_proposals: [{ ...standardProposal(), reason: "" }],
      }),
    );
    await assertRejects(
      () => inspectInterruptedAcceptance(wt, "main"),
      WorktreeGitError,
      "invalid",
    );
  });
});

Deno.test("journal readers diagnose and preserve every newer transaction version", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    for (const offset of [1, 2, 3]) {
      const version = ON_DISK_FORMATS.acceptanceTransaction.version + offset;
      const bytes = journal(dir, { version });
      await Deno.writeTextFile(path, bytes);
      const refusal = await assertRejects(
        () => inspectInterruptedAcceptance(wt, "main"),
        WorktreeGitError,
        "invalid",
      );
      assertStringIncludes(refusal.message, "written by a newer discern");
      assertStringIncludes(refusal.message, "Update discern");
      assertEquals(await Deno.readTextFile(path), bytes);
    }
  });
});

Deno.test("journal inspection preserves malformed authority and identity evidence without moving refs", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    const head = await gitOut(wt, "rev-parse", "HEAD");
    const corruptions: Record<string, unknown>[] = [
      { consent: null },
      { consent: { source: "invented-authority" } },
      { consent: { source: "conversation", scopes: ["scope"] } },
      { consent: { source: "standing-grant", scopes: "scope" } },
      { consent: { source: "standing-grant", scopes: [null] } },
      { variances: null },
      { variances: [null] },
      { standard_proposals: null },
      { worktree_branch: "" },
      { trunk: "main\nother-ref" },
      { expected_trunk: "not-an-object-id" },
      { target: null },
      { main_repo: "." },
      { effort_claim: true },
      { id: "not-a-transaction-id" },
    ];
    for (
      const bytes of [
        "{",
        "[]",
        ...corruptions.map((value) => journal(dir, value)),
      ]
    ) {
      await Deno.writeTextFile(path, bytes);
      await assertRejects(
        () => inspectInterruptedAcceptance(wt, "main"),
        WorktreeGitError,
        "invalid",
        bytes,
      );
      assertEquals(await Deno.readTextFile(path), bytes);
    }
    for (
      const change of [{ trunk: "another-trunk" }, {
        main_repo: join(dir, "another-main"),
      }]
    ) {
      const bytes = journal(dir, change);
      await Deno.writeTextFile(path, bytes);
      await assertRejects(
        () => inspectInterruptedAcceptance(wt, "main"),
        WorktreeGitError,
        "preserved",
      );
      assertEquals(await Deno.readTextFile(path), bytes);
    }
    await Deno.remove(path);
    await Deno.mkdir(path);
    await assertRejects(
      () => inspectInterruptedAcceptance(wt, "main"),
      WorktreeGitError,
      "invalid",
    );
    assert((await Deno.stat(path)).isDirectory);
    assertEquals(await gitOut(wt, "rev-parse", "HEAD"), head);
    assertEquals(await gitOut(dir, "rev-parse", "main"), head);
  });
});
