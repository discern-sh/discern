/**
 * OpenQuestion state primitives (`src/engine/checkpoints/open_questions.ts`): the store
 * lives in the per-worktree Git admin area and survives restarts, operations
 * are idempotent per (checkpoint, subject, declaration evidence), a
 * declaration without an open question is an error, the unmet rationale is
 * validated before any write, and a corrupt store reads as `invalid` for the
 * caller to fail open (a write over one rebuilds from empty).
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  declarationIsCurrent,
  readOpenQuestions,
  reconcileOpenQuestion,
  recordDeclaration,
  UNMET_RATIONALE_MAX_LENGTH,
  validateUnmetRationale,
} from "../src/engine/checkpoints/open_questions.ts";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T01:00:00.000Z";
const T2 = "2026-01-01T02:00:00.000Z";

/** A seeded repo for the store to live in. */
async function repo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
  await gitInit(dir);
}

Deno.test("open questions: open → carry → reopen, idempotent per subject", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    const first = await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: ["a.txt"],
    }, T0);
    assert(first.ok);
    assertEquals(first.outcome, "opened");
    assertEquals(first.openQuestion.openedAt, T0);

    // The same subject carries without a write (openedAt untouched).
    const again = await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: ["a.txt"],
    }, T1);
    assert(again.ok);
    assertEquals(again.outcome, "carried");
    assertEquals(again.openQuestion.openedAt, T0);
    assertEquals(again.openQuestion.reopenedAt, undefined);

    // A moved subject reopens in place, keeping the original openedAt.
    const reopened = await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub2",
      matchedPaths: ["a.txt", "b.txt"],
    }, T2);
    assert(reopened.ok);
    assertEquals(reopened.outcome, "reopened");
    assertEquals(reopened.openQuestion.openedAt, T0);
    assertEquals(reopened.openQuestion.reopenedAt, T2);
    assertEquals(reopened.openQuestion.matchedPaths, ["a.txt", "b.txt"]);
  });
});

Deno.test("a declaration needs an active open question", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    const out = await recordDeclaration(
      dir,
      { conclusion: "met", definitionHash: "def1", subject: "sub1" },
      "probe",
    );
    assert(!out.ok);
    assertEquals(out.error, "no_open_question");
    assertStringIncludes(out.reason, "probe");
  });
});

Deno.test("met and unmet declarations record, repeat idempotently, and replace each other", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: ["a.txt"],
    }, T0);

    const met = await recordDeclaration(
      dir,
      { conclusion: "met", definitionHash: "def1", subject: "sub1" },
      "probe",
      T0,
    );
    assert(met.ok);
    assertEquals(met.changed, true);
    assert(declarationIsCurrent(met.openQuestion));

    // Identical evidence is a no-op: the original timestamp stands.
    const repeat = await recordDeclaration(
      dir,
      { conclusion: "met", definitionHash: "def1", subject: "sub1" },
      "probe",
      T1,
    );
    assert(repeat.ok);
    assertEquals(repeat.changed, false);
    assertEquals(repeat.openQuestion.declaration?.declaredAt, T0);

    // The other conclusion replaces it, rationale attached.
    const unmet = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "  The docs half is deferred to the follow-up effort.  ",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T1,
    );
    assert(unmet.ok);
    assertEquals(unmet.changed, true);
    assert(unmet.openQuestion.declaration?.conclusion === "unmet");
    // The rationale was trimmed before the write.
    assertEquals(
      unmet.openQuestion.declaration.why,
      "The docs half is deferred to the follow-up effort.",
    );

    // A changed rationale is new evidence; the same rationale is not.
    const sameWhy = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "The docs half is deferred to the follow-up effort.",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T2,
    );
    assert(sameWhy.ok);
    assertEquals(sameWhy.changed, false);
    const newWhy = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "A narrower reason.",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T2,
    );
    assert(newWhy.ok);
    assertEquals(newWhy.changed, true);
    assertEquals(newWhy.openQuestion.declaration?.declaredAt, T2);
  });
});

Deno.test("reopening leaves a declaration in place but no longer current", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: ["a.txt"],
    }, T0);
    await recordDeclaration(
      dir,
      { conclusion: "met", definitionHash: "def1", subject: "sub1" },
      "probe",
      T0,
    );
    const reopened = await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub2",
      matchedPaths: ["a.txt"],
    }, T1);
    assert(reopened.ok);
    assertEquals(reopened.openQuestion.declaration?.conclusion, "met");
    assertEquals(declarationIsCurrent(reopened.openQuestion), false);
  });
});

Deno.test("the store survives sessions and lives per worktree", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: ["a.txt"],
    }, T0);
    // A fresh read (a new session) sees the same open question.
    const read = await readOpenQuestions(dir);
    assert(read.status === "ok");
    assertEquals(read.openQuestions.probe?.subject, "sub1");

    // A linked worktree keeps its own store: nothing leaks across.
    const wt = await addWorktree(dir, "openQuestions-probe");
    assertEquals(await readOpenQuestions(wt), { status: "missing" });
    const wtPath = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    const mainPath = await gitAdminStatePath(dir, "checkpointOpenQuestions");
    assert(wtPath !== undefined && mainPath !== undefined);
    assertNotEquals(wtPath, mainPath);
  });
});

Deno.test("a corrupt store reads invalid; a write rebuilds from empty and says so", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    const path = await gitAdminStatePath(dir, "checkpointOpenQuestions");
    assert(path !== undefined);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, "not json\n");
    const read = await readOpenQuestions(dir);
    assert(read.status === "invalid");

    const rebuilt = await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: [],
    }, T0);
    assert(rebuilt.ok);
    assertEquals(rebuilt.outcome, "opened");
    assertEquals(rebuilt.recovered, true);
    const after = await readOpenQuestions(dir);
    assert(after.status === "ok");
  });
});

Deno.test("outside a repository the store is unavailable, never a throw", async () => {
  await withTempDir(async (dir) => {
    assertEquals((await readOpenQuestions(dir)).status, "unavailable");
    const write = await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "d",
      subject: "s",
      matchedPaths: [],
    });
    assert(!write.ok);
  });
});

Deno.test("unmet rationale validation: trim, one paragraph, 1-500 chars, no control characters", async () => {
  assertEquals(validateUnmetRationale("  fine.  "), {
    ok: true,
    rationale: "fine.",
  });
  for (
    const bad of [
      "",
      "   ",
      "a\nb",
      "a\tb",
      "a\rb",
      "a\u0000b",
      "a\u009fb",
      // Invisible formatting (Cf): bidi override and isolates, zero-width
      // space — displayed text must never diverge from recorded text.
      "a\u202eb",
      "a\u2066b",
      "a\u2069b",
      "a\u200bb",
      // Unicode line and paragraph separators (Zl, Zp) break the
      // one-paragraph shape without being control characters.
      "a\u2028b",
      "a\u2029b",
      "x".repeat(UNMET_RATIONALE_MAX_LENGTH + 1),
    ]
  ) {
    const out = validateUnmetRationale(bad);
    assert(!out.ok, JSON.stringify(bad.slice(0, 12)));
  }
  // Both inclusive bounds pass — a single character, and exactly the cap; the
  // boundary belongs to the writer.
  assert(validateUnmetRationale("x").ok);
  assert(validateUnmetRationale("x".repeat(UNMET_RATIONALE_MAX_LENGTH)).ok);

  // The store enforces the same rule before any write, whatever the caller did.
  await withTempDir(async (dir) => {
    await repo(dir);
    await reconcileOpenQuestion(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: [],
    }, T0);
    const out = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "line one\nline two",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
    );
    assert(!out.ok);
    assertEquals(out.error, "invalid_rationale");
    const read = await readOpenQuestions(dir);
    assert(read.status === "ok");
    assertEquals(read.openQuestions.probe?.declaration, undefined);
  });
});
