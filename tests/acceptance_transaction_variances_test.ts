/**
 * The v3 acceptance-transaction journal binds authorized variances to one
 * exact expected-to-target transition: a valid record surfaces its
 * journal-bound consent for recovery; a record claiming variances under any
 * recorded grant, or carrying a malformed variance binding, is invalid — the
 * journal is preserved for inspection and recovery refuses to act, so the
 * decision can never replay onto changed declarations or another tree.
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
