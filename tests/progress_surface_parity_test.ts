/** Terminal, MCP, and the journal present the same composed progress facts. */
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  emitCompletionFailure,
  emitCompletionProgress,
} from "../src/engine/completion/events.ts";
import { completionBlockerAccount } from "../src/engine/completion/progress_prose.ts";
import { withOperationJournal } from "../src/engine/completion/operation_journal.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
import { createGateProgressPresenter } from "../src/engine/gate/progress_presenter.ts";
import { observedGateOperation } from "../src/engine/gate/observed_operation.ts";
import { withCompletionObserver } from "../src/engine/completion/events.ts";
import { withMcpCompletionProgress } from "../src/engine/mcp/progress.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";

const COUNTS = "Running test: 3 of 8 partitions done, 1 failure so far.";
const FAILURE_SENTENCE =
  "alpha holds failed (tests/red_test.ts:7): expected 2, got 3. " +
  "Reproduce: deno task test tests/red_test.ts --filter 'alpha holds' --shuffle=7";

/** Emit one scripted sequence of facts the way a validation run would. */
function emitScriptedFacts(): void {
  emitCompletionProgress({
    phase: "producer",
    state: "running",
    candidate_id: "candidate",
    reason: COUNTS,
    work: {
      producer: "test",
      units: { kind: "partitions", completed: 3, total: 8 },
      results: { failed: 1 },
    },
  });
  emitCompletionFailure({
    producer: "test",
    name: "alpha holds",
    message: "expected 2, got 3",
    file: "tests/red_test.ts",
    line: 7,
    reproduce_cmd:
      "deno task test tests/red_test.ts --filter 'alpha holds' --shuffle=7",
    partial: false,
  });
  const account = completionBlockerAccount({
    kind: "missing-judgment",
    subjects: ["candidate-checkpoints"],
  });
  emitCompletionProgress({
    phase: "pending",
    state: "missing-judgment",
    candidate_id: "candidate",
    reason: account.reason,
    next: account.next,
    owner_must_act: account.owner_must_act,
  });
}

/** The pending sentence every surface must show: the wait, then what comes next. */
const PENDING =
  "Waiting for a recorded judgment on candidate-checkpoints; the owner decides. " +
  "Landing waits until the judgment is recorded.";

Deno.test("one fact stream reads identically on the terminal, over MCP, and after reconnect", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "readme"), "parity fixture\n");
    await gitInit(root);
    const terminal: { kind: string; text: string }[] = [];
    const mcp: { message: string; owner?: boolean }[] = [];
    const presenter = createGateProgressPresenter({
      live: {
        note: (text, tone): void => {
          terminal.push({ kind: tone ?? "note", text });
        },
        transient: (text): void => {
          terminal.push({ kind: "transient", text });
        },
      },
    });
    const envelope: DiscernResult = { ok: true, verb: "done", steps: [] };
    let handle: string | undefined;
    await withMcpCompletionProgress(
      { progressToken: "parity" },
      (notification) => {
        mcp.push({
          message: notification.params.message,
          ...(notification.params._meta.discern_completion?.owner_must_act ===
              true
            ? { owner: true }
            : {}),
        });
        return Promise.resolve();
      },
      () =>
        withCompletionObserver(
          (fact) => presenter.observe(fact),
          () =>
            withOperationJournal(
              root,
              { verb: "done", path: root, branch: "agent/parity" },
              (issued) => {
                handle = issued;
                emitScriptedFacts();
                return Promise.resolve(envelope);
              },
              { result: (value) => value },
            ),
        ),
    );
    assert(handle !== undefined);
    const announcement =
      `done is running. If this call is lost, \`discern progress ${handle}\` reads it back.`;
    // Human output presents work and decisions; the recovery announcement is
    // reserved for MCP, and the journal remains available through progress.
    assertEquals(terminal, [
      { kind: "transient", text: COUNTS },
      { kind: "failure", text: FAILURE_SENTENCE },
      { kind: "warning", text: PENDING },
    ]);
    // MCP delivered the same sentences as notification messages.
    assertEquals(mcp, [
      { message: announcement },
      { message: COUNTS },
      { message: FAILURE_SENTENCE },
      { message: PENDING, owner: true },
    ]);
    // A reconnecting reader sees the same facts the live surfaces presented.
    const read = await operationProgressResult(root, { handle });
    assert(read.ok);
    assertEquals(
      read.data?.progress?.reason.includes("the owner decides"),
      true,
    );
    assertEquals(read.data?.progress?.owner_must_act, true);
    assertEquals(read.data?.producers?.[0]?.results?.failed, 1);
    assertEquals(read.data?.failures?.length, 1);
  });
});

Deno.test("a nested operation presents each fact exactly once between its outer and inner presenters", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "readme"), "nesting fixture\n");
    await gitInit(root);
    const outer: string[] = [];
    const inner: string[] = [];
    const envelope: DiscernResult = { ok: true, verb: "accept", steps: [] };
    // An acceptance presents the coordination it waits through, while the
    // validation it runs inside presents the producer's own counts and
    // failures — the shape `accept` takes on a human surface.
    await observedGateOperation(
      root,
      "accept",
      undefined,
      async (outerSlot) => {
        outerSlot.set(createGateProgressPresenter({
          scope: "coordination",
          write: (line): void => {
            outer.push(line.trimEnd());
          },
        }));
        return await observedGateOperation(
          root,
          "done",
          undefined,
          (innerSlot) => {
            innerSlot.set(createGateProgressPresenter({
              write: (line): void => {
                inner.push(line.trimEnd());
              },
            }));
            emitScriptedFacts();
            return Promise.resolve(envelope);
          },
          (value) => value,
        );
      },
      (value) => value,
    );
    assertEquals(outer, ["done is running within accept.", PENDING]);
    assertEquals(inner, [COUNTS, FAILURE_SENTENCE]);
    // One journal covers the whole acceptance: the nested run opened none of
    // its own, and the producer's failure reached the shared record.
    const read = await operationProgressResult(root);
    assert(read.ok, JSON.stringify(read));
    assertEquals(read.data?.operation.verb, "accept");
    assertEquals(read.data?.failures?.length, 1);
    assertEquals(
      read.data?.progress?.next,
      "Landing waits until the judgment is recorded.",
    );
  });
});
