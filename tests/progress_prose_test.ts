/** Every progress sentence is composed once, plainly, with its next step. */
import { assert, assertEquals } from "@std/assert";
import type { Requirement } from "../src/engine/completion/evidence.ts";
import type { CompletionBlocker } from "../src/engine/completion/protocol.ts";
import {
  completionBlockerAccount,
  completionFailureSentence,
  completionPendingData,
  completionProgressSentence,
  diagnosticSentence,
  producerWorkSentence,
  uniqueCompletionBlockers,
} from "../src/engine/completion/progress_prose.ts";

const requirement: Requirement = {
  id: "coverage",
  kind: "standard",
  definition: "0".repeat(64),
};

/** One member per blocker kind, plus the branches inside a kind. */
const BLOCKERS: readonly CompletionBlocker[] = [
  { kind: "cancelled", reason: "The owner cancelled the run" },
  {
    kind: "record-incompatible",
    record_id: "candidate/1",
    reason: "written by a newer discern",
  },
  { kind: "record-corrupt", record_id: "candidate/2", reason: "not JSON" },
  { kind: "missing-judgment", subjects: [] },
  { kind: "missing-judgment", subjects: ["a", "b", "c", "d", "e"] },
  { kind: "missing-evidence", requirements: [requirement] },
  { kind: "stale-evidence", evidence_ids: ["e1"], reason: "policy-changed" },
  { kind: "validation-failed", evidence_ids: [], requirement },
  { kind: "validation-failed", evidence_ids: [], reason: "lint failed" },
  { kind: "validation-failed", evidence_ids: [] },
  { kind: "unavailable", reason: "the trunk cannot serve this run" },
  { kind: "waiting-for-operation", attempt_id: "att/1", expires_at: 1 },
  { kind: "report-only" },
];

const OWNER_DECIDES = new Set(["missing-judgment"]);

Deno.test("every pending blocker kind has a plain account with a next step", () => {
  for (const blocker of BLOCKERS) {
    const account = completionBlockerAccount(blocker);
    assert(
      /[.!?…]$/u.test(account.reason),
      `${blocker.kind}: reason must end as a sentence: ${account.reason}`,
    );
    assert(
      account.next.length > 0 && account.next.endsWith("."),
      `${blocker.kind}: next must be a sentence: ${account.next}`,
    );
    assertEquals(
      account.owner_must_act,
      OWNER_DECIDES.has(blocker.kind),
      `${blocker.kind}: only a judgment or a grant is the owner's to give`,
    );
    // The composed line joins the two without doubling punctuation.
    assertEquals(
      completionProgressSentence(account),
      `${account.reason} ${account.next}`,
    );
  }
  // A large subject set is named by its first few members, never flooded.
  const many = completionBlockerAccount({
    kind: "missing-judgment",
    subjects: ["a", "b", "c", "d", "e"],
  });
  assertEquals(
    many.reason,
    "Waiting for a recorded judgment on a, b, c and 2 more; the owner decides.",
  );
  const none = completionBlockerAccount({
    kind: "missing-judgment",
    subjects: [],
  });
  assertEquals(
    none.reason,
    "Waiting for a recorded judgment on the served questions; the owner decides.",
  );
});

Deno.test("one live attempt projects one actionable pending cause across every obligation", () => {
  const blocker = {
    kind: "waiting-for-operation" as const,
    attempt_id: "00000000-0000-4000-8000-000000000002",
    operation_handle: "R1-AAAA-AAAA-AA",
    expires_at: 60_000,
  };
  assertEquals(uniqueCompletionBlockers(Array(22).fill(blocker)), [blocker]);
  assertEquals(completionPendingData(blocker), {
    kind: "waiting-for-operation",
    reason:
      "Completion attempt 00000000-0000-4000-8000-000000000002 is still running for this worktree.",
    next_action:
      "Read progress handle R1-AAAA-AAAA-AA without starting another completion run; retry completion after that operation finishes.",
    attempt_id: "00000000-0000-4000-8000-000000000002",
    operation_handle: "R1-AAAA-AAAA-AA",
    expires_at: 60_000,
  });
});

Deno.test("producer sentences state counts as counts, and unknown as unknown", () => {
  assertEquals(
    producerWorkSentence({ producer: "test" }),
    "Recorded progress for test.",
  );
  assertEquals(
    producerWorkSentence({
      producer: "test",
      units: { kind: "suites", completed: 2, total: null },
    }),
    "Recorded progress for test: 2 suites done.",
  );
  assertEquals(
    producerWorkSentence({
      producer: "test",
      units: { kind: "partitions", completed: 3, total: 8 },
      results: { failed: 2 },
      partial: true,
    }),
    "Recorded progress for test: 3 of 8 partitions done, 2 failures; counts are incomplete.",
  );
  assertEquals(
    producerWorkSentence({ producer: "lint", results: { failed: 0 } }),
    "Recorded progress for lint: no failures.",
  );
});

Deno.test("failure and diagnostic sentences stay one line each and keep their reproduction", () => {
  assertEquals(
    completionFailureSentence({ name: "alpha", message: "boom" }),
    "alpha failed: boom.",
  );
  assertEquals(
    completionFailureSentence({
      name: "alpha",
      message: "boom",
      file: "tests/alpha_test.ts",
    }),
    "alpha failed (tests/alpha_test.ts): boom.",
  );
  assertEquals(
    completionFailureSentence({
      name: "alpha",
      message: "expected 2,\n  got 3",
      file: "tests/alpha_test.ts",
      line: 7,
      reproduce_cmd: "deno task test tests/alpha_test.ts --filter alpha",
    }),
    "alpha failed (tests/alpha_test.ts:7): expected 2, got 3. " +
      "Reproduce: deno task test tests/alpha_test.ts --filter alpha",
  );
  assertEquals(
    diagnosticSentence("lint", "unused import\n\n  at src/x.ts:1"),
    "lint: unused import at src/x.ts:1.",
  );
  const long = diagnosticSentence("test", "m".repeat(1_000));
  assertEquals(long.endsWith("…"), true);
  assert(long.length < 420, "a diagnostic sentence stays bounded");
  assertEquals(
    completionProgressSentence({ reason: "Waiting." }),
    "Waiting.",
  );
});
