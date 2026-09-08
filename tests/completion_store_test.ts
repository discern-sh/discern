import { z } from "@zod/zod";
import { ExceptionClaimSchema } from "../src/engine/completion/exception_claim.ts";
import { countedAdminQueries } from "./git_admin_observer.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { RetirementEffectsSchema } from "../src/shared/accept_landing_state.ts";
import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  completionRecordPath,
  openCompletionRecordStore,
  parseCompletionRecord,
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import {
  COMPLETION_FAMILIES,
  type CompletionRecord,
  CompletionRecordSchema,
  recordTransitionAllowed,
} from "../src/engine/completion/records.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { applicabilitySubject } from "../src/engine/completion/evidence.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { withTempDir } from "./helpers.ts";
import { git } from "./engine_helpers.ts";
import {
  COMPLETION_CLAIM,
  COMPLETION_CLOCK,
  COMPLETION_RECOVERY,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

const fence = { attempt_id: completionId(2), token: COMPLETION_CLAIM.token };

/** Create a repository without importing any public completion configuration. */
async function initializeRepository(root: string): Promise<void> {
  const result = await runGit(["init", "-b", "main"], { cwd: root });
  assert(result.success, result.stderr);
}

/** Publish one fixture through the real claim and CAS boundary. */
async function writeFixture(
  root: string,
  record: CompletionRecord,
): Promise<string> {
  const result = await writeCompletionRecord(
    root,
    record,
    null,
    fence,
    COMPLETION_CLOCK,
  );
  assert(result.kind === "written", JSON.stringify(result));
  return result.stamp;
}

Deno.test("completion reads are effect-free and every family preserves newer and malformed bytes", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const directory = await gitAdminStatePath(root, "completionRecords");
    assert(directory !== undefined);
    for (const fixture of Object.values(completionFixtures())) {
      assertEquals(await readCompletionRecord(root, fixture), {
        kind: "missing",
      });
    }
    let exists = true;
    try {
      await Deno.stat(directory);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      exists = false;
    }
    assertEquals(exists, false);
    for (const fixture of Object.values(completionFixtures())) {
      const path = await completionRecordPath(root, fixture);
      assert(path !== undefined);
      await Deno.mkdir(dirname(path), { recursive: true });
      for (
        const [raw, kind] of [
          [
            JSON.stringify({
              version: ON_DISK_FORMATS.completionRecord.version + 1,
              opaque: ["future bytes"],
            }),
            "newer",
          ],
          [
            JSON.stringify({
              ...fixture,
              version: 1,
            }),
            "older",
          ],
          [JSON.stringify({ ...fixture, data: {} }), "invalid"],
          [JSON.stringify({ ...fixture, unknown_field: true }), "invalid"],
          ["{", "invalid"],
        ] as const
      ) {
        await Deno.writeTextFile(path, raw);
        assertEquals((await readCompletionRecord(root, fixture)).kind, kind);
        assertEquals(
          (await writeCompletionRecord(
            root,
            fixture,
            null,
            fence,
            COMPLETION_CLOCK,
          )).kind,
          kind,
        );
        assertEquals(await Deno.readTextFile(path), raw);
      }
    }
  });
});

Deno.test("completion publication uses live claims, exact subjects, immutable records, and optimistic revisions", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    await Deno.writeTextFile(
      join(root, "discern.toml"),
      "[project]\nslug = 'publication-fixture'\n",
    );
    const fixtures = completionFixtures();
    const attempt = await writeCompletionRecord(
      root,
      fixtures.attempt,
      null,
      undefined,
      COMPLETION_CLOCK,
    );
    assert(attempt.kind === "written", JSON.stringify(attempt));
    for (const record of Object.values(fixtures)) {
      if (record.kind === "attempt") continue;
      const publication = await countedAdminQueries(() =>
        writeFixture(root, record)
      );
      assertEquals(publication.queries, 3, record.kind);
      const stamp = publication.value;
      const observed = await readCompletionRecord(root, record);
      assert(observed.kind === "recorded");
      assertEquals(observed.stamp, stamp);
      assertEquals(observed.record, record);
      assertEquals(
        (await writeCompletionRecord(
          root,
          { ...record, revision: 2 },
          null,
          fence,
          COMPLETION_CLOCK,
        )).kind,
        "conflict",
      );
      if (COMPLETION_FAMILIES[record.kind].lifetime === "immutable") {
        assertEquals(
          (await writeCompletionRecord(
            root,
            { ...record, revision: 2 },
            stamp,
            fence,
            COMPLETION_CLOCK,
          )).kind,
          "transition-refused",
        );
      }
    }
    const evidence = COMPLETION_FAMILIES.evidence.schema.parse(
      fixtures.evidence,
    );
    const fresh = { ...evidence, id: completionId(32) };
    assertEquals(
      (await writeCompletionRecord(
        root,
        fresh,
        null,
        undefined,
        COMPLETION_CLOCK,
      )).kind,
      "claim-lost",
    );
    assertEquals(
      (await writeCompletionRecord(root, fresh, null, {
        ...fence,
        token: completionId(99),
      }, COMPLETION_CLOCK)).kind,
      "claim-lost",
    );
    assertEquals(
      (await writeCompletionRecord(root, fresh, null, fence, {
        ...COMPLETION_CLOCK,
        wallNow: () => 200,
      })).kind,
      "claim-lost",
    );
    const differentSubject = CompletionRecordSchema.parse({
      ...fresh,
      data: { ...fresh.data, candidate_id: completionId(90), artifacts: [] },
    });
    assertEquals(
      (await writeCompletionRecord(
        root,
        differentSubject,
        null,
        fence,
        COMPLETION_CLOCK,
      )).kind,
      "claim-lost",
    );
    const recordedAttempt = COMPLETION_FAMILIES.attempt.schema.parse(
      fixtures.attempt,
    );
    const recovery = CompletionRecordSchema.parse({
      ...recordedAttempt,
      revision: 2,
      data: {
        ...recordedAttempt.data,
        state: { kind: "recovery", recovery: COMPLETION_RECOVERY },
      },
    });
    const stopped = await writeCompletionRecord(
      root,
      recovery,
      attempt.stamp,
      fence,
      COMPLETION_CLOCK,
    );
    assert(stopped.kind === "written", JSON.stringify(stopped));
    assertEquals(
      (await writeCompletionRecord(root, fresh, null, fence, COMPLETION_CLOCK))
        .kind,
      "claim-lost",
    );
    assertEquals(
      (await writeCompletionRecord(
        root,
        { ...recovery, revision: 3 },
        attempt.stamp,
        undefined,
        COMPLETION_CLOCK,
      )).kind,
      "conflict",
    );
  });
});

Deno.test("completion records survive linked checkout removal and are observed through common administration", async () => {
  await withTempDir(async (root) => {
    const main = join(root, "main");
    const linked = join(root, "linked");
    await Deno.mkdir(main);
    await initializeRepository(main);
    await git(
      main,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "Initialize",
    );
    assert(
      (await runGit(["worktree", "add", "-b", "effort-a", linked], {
        cwd: main,
      })).success,
    );
    const fixture = completionFixtures().retirement;
    const written = await writeCompletionRecord(
      linked,
      fixture,
      null,
      undefined,
      COMPLETION_CLOCK,
    );
    assert(written.kind === "written", JSON.stringify(written));
    assertEquals(
      await completionRecordPath(main, fixture),
      await completionRecordPath(linked, fixture),
    );
    assert(
      (await runGit(["worktree", "remove", linked], { cwd: main })).success,
    );
    const reading = await readCompletionRecord(main, fixture);
    assert(reading.kind === "recorded");
    assertEquals(reading.record, fixture);
  });
});

Deno.test("one claimed attempt publishes every planned producer while preserving mode, purpose, and sequence", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const fixtures = completionFixtures();
    const first = COMPLETION_FAMILIES.evidence.schema.parse(fixtures.evidence);
    const second = COMPLETION_FAMILIES.evidence.schema.parse({
      ...first,
      id: completionId(31),
      data: {
        ...first.data,
        applicability: { ...first.data.applicability, producer: "jobs.check" },
        artifacts: [],
      },
    });
    const attempt = COMPLETION_FAMILIES.attempt.schema.parse(fixtures.attempt);
    const subjects = await Promise.all(
      [first, second].map((evidence) =>
        applicabilitySubject(evidence.data.applicability)
      ),
    );
    const claimed = await writeCompletionRecord(
      root,
      {
        ...attempt,
        data: { ...attempt.data, subjects },
      },
      null,
      undefined,
      COMPLETION_CLOCK,
    );
    assert(claimed.kind === "written", JSON.stringify(claimed));
    for (const evidence of [first, second]) await writeFixture(root, evidence);
    for (
      const data of [
        { ...first.data, sequence: first.data.sequence + 1 },
        { ...first.data, mode: "report" },
        { ...first.data, purpose: "diagnostic" },
        {
          ...first.data,
          applicability: {
            ...first.data.applicability,
            producer: "jobs.build",
          },
        },
      ]
    ) {
      const substituted = COMPLETION_FAMILIES.evidence.schema.parse({
        ...first,
        id: completionId(32),
        data,
      });
      assertEquals(
        (await writeCompletionRecord(
          root,
          substituted,
          null,
          fence,
          COMPLETION_CLOCK,
        )).kind,
        "claim-lost",
      );
    }
    const proof = COMPLETION_FAMILIES.proof.schema.parse(fixtures.proof);
    assertEquals(
      (await writeCompletionRecord(
        root,
        {
          ...proof,
          data: { ...proof.data, mode: "report" },
        },
        null,
        fence,
        COMPLETION_CLOCK,
      )).kind,
      "claim-lost",
    );
  });
});

Deno.test("completion revisions retain history and refuse a newer historical document", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const initial = completionFixtures().queue;
    const first = await writeCompletionRecord(
      root,
      initial,
      null,
      undefined,
      COMPLETION_CLOCK,
    );
    assert(first.kind === "written");
    const second = { ...initial, revision: 2 };
    assertEquals(
      (await writeCompletionRecord(
        root,
        second,
        first.stamp,
        undefined,
        COMPLETION_CLOCK,
      )).kind,
      "written",
    );
    const historical = await readCompletionRecord(root, initial, 1);
    assert(historical.kind === "recorded");
    assertEquals(historical.record, initial);
    const current = await readCompletionRecord(root, initial);
    assert(current.kind === "recorded");
    const archive = await completionRecordPath(root, initial, 2);
    assert(archive !== undefined);
    await Deno.mkdir(dirname(archive), { recursive: true });
    const future = JSON.stringify({
      version: ON_DISK_FORMATS.completionRecord.version + 1,
      future: "retained",
    });
    await Deno.writeTextFile(archive, future);
    assertEquals(
      (await writeCompletionRecord(
        root,
        { ...initial, revision: 3 },
        current.stamp,
        undefined,
        COMPLETION_CLOCK,
      )).kind,
      "transition-refused",
    );
    assertEquals(await Deno.readTextFile(archive), future);
    assertEquals((await readCompletionRecord(root, initial, 2)).kind, "newer");
    assertEquals(await readCompletionRecord(root, initial), current);
  });
});

Deno.test("completion aliases share the publication lock before any family is created", async () => {
  await withTempDir(async (root) => {
    const repository = join(root, "repository");
    const alias = join(root, "different-name");
    await Deno.mkdir(repository);
    await initializeRepository(repository);
    await Deno.symlink(repository, alias);
    for (const fixture of Object.values(completionFixtures())) {
      assertEquals(
        await completionRecordPath(alias, fixture),
        await completionRecordPath(repository, fixture),
      );
    }
    const fixture = completionFixtures().queue;
    const writes = await Promise.all([
      writeCompletionRecord(
        repository,
        fixture,
        null,
        undefined,
        COMPLETION_CLOCK,
      ),
      writeCompletionRecord(alias, fixture, null, undefined, COMPLETION_CLOCK),
    ]);
    assertEquals(
      writes.filter((result) => result.kind === "written").length,
      1,
    );
    assertEquals(
      writes.filter((result) =>
        result.kind === "busy" || result.kind === "conflict"
      ).length,
      1,
    );
  });
});

Deno.test("every recorded retirement effect is monotonic without changing ownership or landing", () => {
  const fixture = completionFixtures().retirement;
  assert(fixture.kind === "retirement");
  const previous = {
    ...fixture,
    data: {
      ...fixture.data,
      effects: { worktree_removed: true, branch_deleted: true },
    },
  };
  for (const field of Object.keys(RetirementEffectsSchema.shape)) {
    const next = {
      ...previous,
      revision: previous.revision + 1,
      data: {
        ...previous.data,
        effects: { ...previous.data.effects, [field]: false },
      },
    };
    assertEquals(recordTransitionAllowed(previous, next), false, field);
  }
  assertEquals(
    recordTransitionAllowed(previous, {
      ...previous,
      revision: previous.revision + 1,
      data: { ...previous.data, ownership: "changed" },
    }),
    false,
  );
  assertEquals(
    recordTransitionAllowed(previous, {
      ...previous,
      revision: previous.revision + 1,
      data: {
        ...previous.data,
        outcome: {
          kind: "recovery",
          recovery: {
            ...COMPLETION_RECOVERY,
            retained_paths: [...COMPLETION_RECOVERY.retained_paths],
            frozen_cleanup: [...COMPLETION_RECOVERY.frozen_cleanup],
          },
        },
      },
    }),
    true,
  );
});

Deno.test("completion inventory discovers its administration directory once across every family", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    await git(
      root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    );
    const fixtures = Object.values(completionFixtures());
    for (const fixture of fixtures) {
      const path = await completionRecordPath(root, fixture);
      assert(path !== undefined);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, JSON.stringify(fixture));
    }
    const observed = await countedAdminQueries(() =>
      observeCompletionRecords(root)
    );
    assertEquals(observed.value.records.length, fixtures.length);
    assert(
      observed.value.records.every((entry) =>
        entry.reading.kind === "recorded"
      ),
    );
    assertEquals(observed.queries, 1);
  });
});

Deno.test("completion revision history adds no administration discovery to publication", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    const fixture = completionFixtures().queue;
    const initial = await countedAdminQueries(() =>
      writeCompletionRecord(root, fixture, null, undefined, COMPLETION_CLOCK)
    );
    const published = initial.value;
    assert(published.kind === "written");
    const revised = await countedAdminQueries(() =>
      writeCompletionRecord(
        root,
        { ...fixture, revision: 2 },
        published.stamp,
        undefined,
        COMPLETION_CLOCK,
      )
    );
    assertEquals(revised.value.kind, "written");
    assertEquals(
      initial.queries,
      3,
      "queue identity, acquisition identity, and one store resolution",
    );
    assertEquals(revised.queries, initial.queries);
    const historic = await readCompletionRecord(root, fixture, 1);
    assert(historic.kind === "recorded");
    assertEquals(historic.record, fixture);
  });
});

Deno.test("a resolved completion store keeps reads fresh and later operations follow repository aliases", async () => {
  await withTempDir(async (root) => {
    const first = join(root, "first");
    const second = join(root, "second");
    const alias = join(root, "alias");
    await Deno.mkdir(first);
    await Deno.mkdir(second);
    await initializeRepository(first);
    await initializeRepository(second);
    await Deno.symlink(first, alias);
    const store = await openCompletionRecordStore(alias);
    assert(store !== undefined);
    const fixture = completionFixtures().queue;
    assertEquals((await store.read(fixture)).kind, "missing");
    const path = store.path(fixture);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, JSON.stringify(fixture));
    assertEquals((await store.read(fixture)).kind, "recorded");
    await Deno.writeTextFile(path, "{");
    assertEquals((await store.read(fixture)).kind, "invalid");
    await Deno.remove(alias);
    await Deno.symlink(second, alias);
    assertEquals((await readCompletionRecord(alias, fixture)).kind, "missing");
    const reopened = await openCompletionRecordStore(alias);
    assert(reopened !== undefined);
    assert(reopened.directory !== store.directory);
  });
});

Deno.test("reviewed version 2 records normalize without granting authority or rewriting observation", async () => {
  await withTempDir(async (root) => {
    await initializeRepository(root);
    for (const fixture of Object.values(completionFixtures())) {
      const raw = JSON.stringify({ ...fixture, version: 2 }, null, 2);
      const path = await completionRecordPath(root, fixture);
      assert(path !== undefined);
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, raw);
      const observed = await readCompletionRecord(root, fixture);
      assert(observed.kind === "recorded", JSON.stringify(observed));
      assertEquals(observed.record, fixture);
      assertEquals(await Deno.readTextFile(path), raw);
      if (
        COMPLETION_FAMILIES[fixture.kind].lifetime === "mutable" &&
        fixture.kind !== "attempt"
      ) {
        assertEquals(
          (await writeCompletionRecord(
            root,
            { ...fixture, revision: 2 },
            observed.stamp,
            undefined,
            COMPLETION_CLOCK,
          )).kind,
          "written",
        );
        const archive = await completionRecordPath(root, fixture, 1);
        assert(archive !== undefined);
        assertEquals(await Deno.readTextFile(archive), raw);
      }
    }
  });
});

Deno.test("completion version distinguishes the two strict-reader extensions from corruption", async () => {
  assert(
    ON_DISK_FORMATS.completionRecord.version > 2,
    "strict schema extensions require an explicit compatibility revision",
  );
  const environment = COMPLETION_FAMILIES.environment.schema.parse(
    completionFixtures().environment,
  );
  const extended = {
    ...environment,
    data: {
      ...environment.data,
      state: { kind: "idle" as const, returned_attempt_id: completionId(2) },
    },
  };
  for (const value of [environment, extended]) {
    const result = await parseCompletionRecord(
      JSON.stringify({ ...value, version: 2 }),
      value,
    );
    assert(result.kind === "recorded", JSON.stringify(result));
    assertEquals(result.record.data, value.data);
  }
  assertEquals(
    (await parseCompletionRecord(
      JSON.stringify({ ...extended, version: 2, surprise: true }),
      extended,
    )).kind,
    "invalid",
  );
});

Deno.test("strict version-2 readers reject optional additions accepted by the reviewed compatibility reader", async () => {
  const fixtures = completionFixtures();
  assert(
    fixtures.environment.kind === "environment" &&
      fixtures.landing.kind === "landing" &&
      fixtures.evidence.kind === "evidence",
  );
  // These are the two strict shapes from f6d709fc9; each changed without a version bump.
  const oldIdle = z.strictObject({ kind: z.literal("idle") });
  assert(oldIdle.safeParse({ kind: "idle" }).success);
  const idle = { kind: "idle", returned_attempt_id: completionId(2) };
  assertEquals(oldIdle.safeParse(idle).success, false);
  const oldException = z.strictObject(
    Object.fromEntries(
      Object.entries(ExceptionClaimSchema.shape).filter(([key]) =>
        key !== "review"
      ),
    ),
  );
  const landing = fixtures.landing;
  const claim = {
    kind: "exception",
    authorization_id: completionId(80),
    authorized_at: 100,
    actual_trunk: landing.data.expected_trunk,
    source: landing.data.source,
    candidate_id: landing.data.candidate_id,
    candidate_head: landing.data.target,
    policy: landing.data.policy,
    reason: "Recorded owner exception",
    exceptions: [{
      requirement: {
        id: "coverage",
        context: "local",
        kind: "standard",
        definition: "a".repeat(64),
      },
      state: "unrun",
      evidence_id: null,
    }],
  };
  assert(oldException.safeParse(claim).success);
  const artifact = fixtures.evidence.data.artifacts[0];
  assert(artifact !== undefined);
  const extended = {
    ...claim,
    review: {
      ...artifact,
      candidate_id: landing.data.candidate_id,
      context: "local",
      path: "environment/emergency-review.json",
    },
  };
  assertEquals(oldException.safeParse(extended).success, false);
  for (const value of [claim, extended]) {
    const raw = JSON.stringify({
      ...landing,
      version: 2,
      data: { ...landing.data, claim: value },
    });
    const observed = await parseCompletionRecord(raw, landing);
    assert(observed.kind === "recorded", JSON.stringify(observed));
    assert(observed.record.kind === "landing");
    assertEquals(observed.record.data.claim.kind, "exception");
  }
});
