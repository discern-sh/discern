/**
 * Acceptance journals bind narrow owner decisions to one exact
 * expected-to-target transition: v3 carries checkpoint variances; v4 also
 * carries proposed Standard limit tuples. Recorded grants cannot authorize
 * either narrow decision, and malformed/duplicated bindings remain inert for
 * inspection instead of replaying onto another tree.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  inspectInterruptedAcceptance,
} from "../src/engine/worktree/acceptance_transaction.ts";
import { WorktreeGitError } from "../src/engine/worktree/git.ts";

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

/** A structurally valid v3 journal body for this repo pair. */
function journal(
  dir: string,
  overrides: Record<string, unknown> = {},
): string {
  return `${
    JSON.stringify({
      version: 3,
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
      ...overrides,
    })
  }\n`;
}

/** One structurally valid exact Standard proposal for v4 journal tests. */
function standardProposal(): Record<string, unknown> {
  return {
    standard: "source_count",
    commit: SHA_B,
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

Deno.test("journal v3: a valid record surfaces its journal-bound conversation consent", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(path, journal(dir));
    const inspected = await inspectInterruptedAcceptance(wt, "main");
    assert(inspected.kind === "recorded");
    assertEquals(inspected.consent, { source: "conversation" });
    assertEquals(inspected.transaction.target, SHA_B);
  });
});

Deno.test("journal v3: variances under a recorded grant are invalid — no engine ever wrote that record", async () => {
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

Deno.test("journal v3: a malformed variance binding is invalid", async () => {
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

Deno.test("journal v3: an empty variance set under any consent source parses (the ordinary landing)", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        consent: { source: "effort-grant" },
        effort_claim: true,
        variances: [],
      }),
    );
    const inspected = await inspectInterruptedAcceptance(wt, "main");
    assert(inspected.kind === "recorded");
    assertEquals(inspected.transaction.version, 3);
  });
});

Deno.test("journal v4: exact Standard proposal tuples require and preserve conversation consent", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        version: 4,
        variances: [],
        standard_proposals: [standardProposal()],
      }),
    );
    const inspected = await inspectInterruptedAcceptance(wt, "main");
    assert(inspected.kind === "recorded");
    assert(inspected.transaction.version === 4);
    assertEquals(inspected.consent, { source: "conversation" });
    assertEquals(
      inspected.transaction.standard_proposals[0]?.reason,
      "The accepted feature adds one required source.",
    );
  });
});

Deno.test("journal v4: a recorded grant cannot authorize a proposed Standard limit", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        version: 4,
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

Deno.test("journal v4: duplicate or malformed proposal tuples are invalid", async () => {
  await withTempDir(async (dir) => {
    const { wt, path } = await journaledWorktree(dir);
    await Deno.writeTextFile(
      path,
      journal(dir, {
        version: 4,
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
        version: 4,
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
