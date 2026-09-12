/**
 * The terminal dashboard's Landing queue lines derive from status data alone:
 * one line per submission in landing order, plain text (no code spans), the
 * current worktree's own effort marked, each row carrying its authority and
 * either readiness or the single reason it waits.
 */
import { assertEquals } from "@std/assert";
import { landingQueueLines } from "../src/engine/status/queue_presentation.ts";
import type { SubmissionRow } from "../src/engine/worktree/submissions_view.ts";
import type { StatusData } from "../src/shared/result_schemas.ts";

/** One fully-populated submission row; tests override the fields under test. */
function row(overrides: Partial<SubmissionRow>): SubmissionRow {
  return {
    effort: "repair",
    branch: "refs/heads/agent/repair",
    path: "/tmp/worktrees/repair",
    head: "0123456789abcdef0123456789abcdef01234567",
    submitted_at: "2026-09-12T10:00:00Z",
    authority: "awaiting-owner",
    position: 1,
    readiness: "waiting",
    ...overrides,
  };
}

/** The current checkout's identity, as status reports it. */
const worktree: NonNullable<StatusData["worktree"]> = {
  id: "repair",
  branch: "agent/repair",
  site: "repair.localhost",
  port: 3001,
  db: "app_repair",
  seed: 1,
  resources: {},
};

Deno.test("an absent or empty queue renders no lines", () => {
  assertEquals(landingQueueLines({ worktree: null }), []);
  assertEquals(landingQueueLines({ queue: [], worktree: null }), []);
  assertEquals(landingQueueLines({ queue: [], worktree }), []);
});

Deno.test("a ready pre-authorized row is one plain line with the branch, short head, and its authority", () => {
  assertEquals(
    landingQueueLines({
      queue: [row({ authority: "pre-authorized", readiness: "ready" })],
      worktree: null,
    }),
    ["Queue 1: agent/repair at 0123456789ab — pre-authorized; ready."],
  );
});

Deno.test("the current worktree's own submission is marked; other efforts are not", () => {
  const lines = landingQueueLines({
    queue: [
      row({ readiness: "ready" }),
      row({
        effort: "other",
        branch: "refs/heads/agent/other",
        position: 2,
        reason: "Awaiting the owner's landing decision.",
      }),
    ],
    worktree,
  });
  assertEquals(lines, [
    "Queue 1: agent/repair at 0123456789ab (this effort) — awaiting the owner; ready.",
    "Queue 2: agent/other at 0123456789ab — awaiting the owner; Awaiting the owner's landing decision.",
  ]);
});

Deno.test("a waiting row without a recorded reason falls back to the waiting word and gains a period", () => {
  assertEquals(
    landingQueueLines({ queue: [row({})], worktree: null }),
    ["Queue 1: agent/repair at 0123456789ab — awaiting the owner; waiting."],
  );
});
