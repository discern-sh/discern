import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  ATTEMPT_CLAIM_LEASE_MS,
  ATTEMPT_CLAIM_RENEW_INTERVAL_MS,
  recoverAbandonedAttempts,
  renewAttemptClaim,
  reserveAttempt,
  withAttemptClaim,
} from "../src/engine/completion/attempt_lifecycle.ts";
import {
  completionRecordPath,
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { openOperationJournal } from "../src/engine/completion/operation_journal.ts";
import { runGit } from "../src/shared/subprocess.ts";
import type {
  IntervalHandle,
  Scheduler,
  TimeoutHandle,
} from "../src/shared/scheduler.ts";
import { withTempDir } from "./helpers.ts";
import { fakeSecureEntropy } from "./fake_secure_entropy.ts";
import { git } from "./engine_helpers.ts";
import {
  COMPLETION_CLOCK,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

Deno.test("completion ownership uses one bounded renewable lease", () => {
  assertEquals(ATTEMPT_CLAIM_LEASE_MS, 60_000);
  assertEquals(ATTEMPT_CLAIM_RENEW_INTERVAL_MS, 20_000);
});

/** Initialize one committed repository whose common Git state can hold records. */
async function initializeRepository(root: string): Promise<void> {
  const result = await runGit(["init", "-b", "main"], { cwd: root });
  assert(result.success, result.stderr);
  await git(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "Initialize",
  );
}

Deno.test("an expired completion claim is cancelled atomically and its old fence stays closed", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const attempt = completionFixtures().attempt;
    assert(attempt.kind === "attempt");
    const written = await writeCompletionRecord(
      root,
      attempt,
      null,
      undefined,
      COMPLETION_CLOCK,
    );
    assert(written.kind === "written", JSON.stringify(written));

    const recovered = await recoverAbandonedAttempts(root, {
      clock: { ...COMPLETION_CLOCK, wallNow: () => 100_000 },
      ownerState: () => Promise.resolve("unknown"),
    });
    assertEquals(recovered, [attempt.id]);
    const current = await readCompletionRecord(root, attempt);
    assert(current.kind === "recorded" && current.record.kind === "attempt");
    assertEquals(current.record.data.state, {
      kind: "finished",
      outcome: "cancelled",
      finished_at: 100_000,
    });

    const fixture = completionFixtures().evidence;
    assertEquals(
      (await writeCompletionRecord(
        root,
        fixture,
        null,
        {
          attempt_id: attempt.id,
          token: attempt.data.state.kind === "claimed"
            ? attempt.data.state.claim.token
            : "unreachable",
        },
        COMPLETION_CLOCK,
      )).kind,
      "claim-lost",
    );
  });
});

Deno.test("a live claim renews independently of project timeout budgets", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    let now = 1_000;
    const clock = {
      wallNow: (): number => now,
      monotonicNow: (): number => now,
    };
    const reserved = await reserveAttempt(
      root,
      {
        candidate_id: completionId(40),
        executor: {
          operation_id: completionId(41),
          originating_effort: "effort-a",
          started_at: now,
          operation_handle: "R1-AAAA-AAAA-AA",
        },
        rerun_of: null,
        mode: "strict",
      },
      clock,
      fakeSecureEntropy({
        uuids: [completionId(42), completionId(43)],
      }),
    );
    assert(reserved.attempt.state.kind === "planning");
    assertEquals(
      reserved.attempt.state.claim.expires_at,
      now + ATTEMPT_CLAIM_LEASE_MS,
    );

    now += 10_000;
    const renewed = await renewAttemptClaim(root, reserved.fence, clock);
    assertEquals(renewed.kind, "written");
    const current = await readCompletionRecord(root, {
      kind: "attempt",
      id: reserved.attempt.identity.id,
    });
    assert(current.kind === "recorded");
    assert(current.record.kind === "attempt");
    assert(current.record.data.state.kind === "planning");
    assertEquals(current.record.data.state.claim.renewed_at, now);
    assertEquals(
      current.record.data.state.claim.expires_at,
      now + ATTEMPT_CLAIM_LEASE_MS,
    );
    const archivedHeartbeat = await completionRecordPath(
      root,
      current.record,
      1,
    );
    assert(archivedHeartbeat !== undefined);
    let heartbeatArchived = true;
    try {
      await Deno.stat(archivedHeartbeat);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      heartbeatArchived = false;
    }
    assertEquals(heartbeatArchived, false);

    assertEquals(
      await recoverAbandonedAttempts(root, {
        clock,
        ownerState: () => Promise.resolve("running"),
      }),
      [],
    );
    assertEquals(
      await recoverAbandonedAttempts(root, {
        clock,
        ownerState: () => Promise.resolve("gone"),
      }),
      [reserved.attempt.identity.id],
    );
  });
});

Deno.test("a claim linked to a gone journal executor is recovered before lease expiry", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const journal = await openOperationJournal(
      root,
      { verb: "done", path: root },
      { pid: 2_000_000_000 },
    );
    assert(journal !== undefined);
    const reserved = await reserveAttempt(
      root,
      {
        candidate_id: completionId(50),
        executor: {
          operation_id: completionId(51),
          originating_effort: "effort-a",
          started_at: COMPLETION_CLOCK.wallNow(),
          operation_handle: journal.handle,
        },
        rerun_of: null,
        mode: "strict",
      },
      COMPLETION_CLOCK,
      fakeSecureEntropy({
        uuids: [completionId(52), completionId(53)],
      }),
    );

    assertEquals(
      await recoverAbandonedAttempts(root, { clock: COMPLETION_CLOCK }),
      [reserved.attempt.identity.id],
    );
  });
});

Deno.test("a graceful executor failure settles its claim before returning", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const reserved = await reserveAttempt(
      root,
      {
        candidate_id: completionId(60),
        executor: {
          operation_id: completionId(61),
          originating_effort: "effort-a",
          started_at: COMPLETION_CLOCK.wallNow(),
        },
        rerun_of: null,
        mode: "strict",
      },
      COMPLETION_CLOCK,
      fakeSecureEntropy({
        uuids: [completionId(62), completionId(63)],
      }),
    );
    await assertRejects(() =>
      withAttemptClaim(
        root,
        reserved.fence,
        new AbortController().signal,
        () => Promise.reject(new Error("fixture failure")),
        { clock: COMPLETION_CLOCK },
      )
    );
    const current = await readCompletionRecord(root, {
      kind: "attempt",
      id: reserved.attempt.identity.id,
    });
    assert(current.kind === "recorded" && current.record.kind === "attempt");
    assertEquals(current.record.data.state, {
      kind: "finished",
      outcome: "failed",
      finished_at: COMPLETION_CLOCK.wallNow(),
    });
  });
});

Deno.test("the live coordinator renews before settlement and retains only the semantic revision", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    let now = 1_000;
    const clock = {
      wallNow: (): number => now,
      monotonicNow: (): number => now,
    };
    let heartbeat: (() => void) | undefined;
    const scheduler: Scheduler = {
      scheduleInterval(callback): IntervalHandle {
        heartbeat = callback;
        return 1;
      },
      cancelInterval(): void {},
      scheduleTimeout(): TimeoutHandle {
        throw new Error("unexpected timeout");
      },
      cancelTimeout(): void {},
    };
    const reserved = await reserveAttempt(
      root,
      {
        candidate_id: completionId(70),
        executor: {
          operation_id: completionId(71),
          originating_effort: "effort-a",
          started_at: now,
        },
        rerun_of: null,
        mode: "strict",
      },
      clock,
      fakeSecureEntropy({
        uuids: [completionId(72), completionId(73)],
      }),
    );

    await withAttemptClaim(
      root,
      reserved.fence,
      new AbortController().signal,
      async (_signal, settle) => {
        now += 10_000;
        assert(heartbeat !== undefined);
        heartbeat();
        await settle("passed");
      },
      { clock, scheduler },
    );
    const renewed = await readCompletionRecord(
      root,
      { kind: "attempt", id: reserved.attempt.identity.id },
      2,
    );
    assert(renewed.kind === "recorded" && renewed.record.kind === "attempt");
    assert(renewed.record.data.state.kind === "planning");
    assertEquals(renewed.record.data.state.claim.renewed_at, now);
    const current = await readCompletionRecord(root, {
      kind: "attempt",
      id: reserved.attempt.identity.id,
    });
    assert(current.kind === "recorded" && current.record.kind === "attempt");
    assertEquals(current.record.data.state, {
      kind: "finished",
      outcome: "passed",
      finished_at: now,
    });
  });
});
