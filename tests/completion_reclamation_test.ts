import { completionFixtures } from "./completion_fixtures.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
/** The graph follows reference shapes through active recovery and historical consumers. */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  executionArtifactReferences,
  planRecoveryReclamation,
  reclaimExecutionStorage,
} from "../src/engine/execution/reclamation.ts";
import { saveEnvironmentArtifact } from "../src/engine/execution/artifacts.ts";
import { artifactPath } from "../src/engine/execution/artifact_read.ts";
import {
  observeRecoveryPayload,
  recoveryPayloadPath,
} from "../src/engine/execution/payloads.ts";
import { join } from "@std/path";
import { writeCompletionRecord } from "../src/engine/completion/store.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { recoveryFor } from "../src/engine/execution/types.ts";
import { recoveryStoragePath } from "../src/engine/execution/storage_lifetime.ts";
import { withTempDir } from "./helpers.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import {
  replaceEnvironment,
  requireEnvironment,
  retireBorrowedEnrollment,
} from "../src/engine/execution/registry.ts";

Deno.test("reclamation follows shared payloads and arbitrarily nested historical artifact references", () => {
  const shared = `sha256:${"a".repeat(64)}:4`;
  const unused = `sha256:${"b".repeat(64)}:9`;
  const reference = {
    attempt_id: "11111111-1111-4111-8111-111111111111",
    candidate_id: "22222222-2222-4222-8222-222222222222",
    context: "local",
    path: "environment/kept.json",
    digest: "c".repeat(64),
    bytes: 12,
  };
  const roots = executionArtifactReferences({
    unrelatedFutureContainer: { histories: [{ convergence: reference }] },
  }).artifacts;
  const kept = roots[0] ?? "";
  const nodes = [
    { coordinate: kept, artifacts: ["child"], payloads: [], bytes: 12 },
    { coordinate: "child", artifacts: [], payloads: [shared], bytes: 4 },
    {
      coordinate: "discard",
      artifacts: [],
      payloads: [shared, unused],
      bytes: 9,
    },
  ];
  assertEquals(
    planRecoveryReclamation(
      nodes,
      roots,
      new Set(nodes.map((node) => node.coordinate)),
    ),
    { manifests: ["discard"], payloads: [unused], retained: [kept, "child"] },
  );
  assertThrows(
    () =>
      planRecoveryReclamation(nodes, ["missing-history"], new Set(["discard"])),
    Error,
    "Unknown artifact reference",
  );
  assertThrows(
    () => executionArtifactReferences({ format: "unknown-recovery-v9" }),
    Error,
    "unknown recovery format",
  );
  assertThrows(() =>
    executionArtifactReferences({
      format: "execution-git-manifest-v2",
      index: "sha256:unrecognized",
    })
  );
});

Deno.test("bounded reclamation retains payload edges from the next batch", () => {
  const shared = `sha256:${"a".repeat(64)}:4`;
  const nodes = [
    { coordinate: "first", artifacts: [], payloads: [shared], bytes: 4 },
    { coordinate: "second", artifacts: [], payloads: [shared], bytes: 4 },
  ];
  assertEquals(
    planRecoveryReclamation(nodes, [], new Set(["first", "second"]), 1),
    {
      manifests: ["first"],
      payloads: [],
      retained: ["second"],
      deferred: ["batch-limit"],
    },
  );
  const dependent = [
    { coordinate: "child", artifacts: [], payloads: [shared], bytes: 4 },
    { coordinate: "parent", artifacts: ["child"], payloads: [], bytes: 4 },
  ];
  assertEquals(
    planRecoveryReclamation(dependent, [], new Set(["child", "parent"]), 1),
    {
      manifests: ["parent"],
      payloads: [],
      retained: ["child"],
      deferred: ["batch-limit"],
    },
  );
  const converging = [
    { coordinate: "child", artifacts: [], payloads: [shared], bytes: 4 },
    { coordinate: "short", artifacts: ["child"], payloads: [], bytes: 4 },
    { coordinate: "middle", artifacts: ["child"], payloads: [], bytes: 4 },
    { coordinate: "long", artifacts: ["middle"], payloads: [], bytes: 4 },
  ];
  for (const graph of [dependent, converging]) {
    const complete = planRecoveryReclamation(
      graph,
      [],
      new Set(graph.map((node) => node.coordinate)),
    );
    for (let prefix = 1; prefix <= complete.manifests.length; prefix++) {
      const deleted = new Set(complete.manifests.slice(0, prefix));
      const remaining = graph.filter((node) => !deleted.has(node.coordinate));
      // Every interrupted prefix must leave a complete graph for the next pass.
      planRecoveryReclamation(
        remaining,
        [],
        new Set(remaining.map((node) => node.coordinate)),
      );
    }
  }
  assertThrows(
    () =>
      planRecoveryReclamation(
        [
          { coordinate: "a", artifacts: ["b"], payloads: [], bytes: 1 },
          { coordinate: "b", artifacts: ["a"], payloads: [], bytes: 1 },
        ],
        [],
        new Set(["a", "b"]),
      ),
    Error,
    "cyclic recovery artifact graph",
  );
  const identity = {
    head: "a".repeat(40),
    tree: "b".repeat(40),
    branch: null,
    git_dir: "/checkout/.git",
    index_path: "/checkout/.git/index",
    index: shared,
    index_entries: "",
    staged_patch: "",
    status: "",
    files: [],
  };
  assertEquals(
    executionArtifactReferences({
      ...identity,
      format: "execution-release-observation-v2",
    }).payloads,
    [],
  );
  assertEquals(
    executionArtifactReferences({
      ...identity,
      format: "execution-git-manifest-v2",
    }).payloads,
    [shared],
  );
});

Deno.test("live reclamation retains the current return and reclaims it only after owned enrollment retirement", async () => {
  await withTempDir(async (root) => {
    const fixture = await environmentFixture(root);
    const claimed = await fixture.claim();
    await assertRejects(
      () => reclaimExecutionStorage(fixture.root, [claimed.fence.attempt_id]),
      Error,
      "no finished record",
    );
    const binary = join(fixture.path, "binary");
    const sourceBinary = await Deno.readFile(binary);
    const drift = Uint8Array.of(0, 255, 1, 2);
    let driftReference = "";
    const returned = await fixture.executor.execute(claimed, async () => {
      await Deno.writeFile(binary, drift);
      driftReference = (await observeRecoveryPayload(
        fixture.root,
        binary,
        drift.length,
        false,
      )).reference;
      return true;
    });
    assertEquals(returned.returned.kind, "restored");
    assertEquals(await Deno.readFile(binary), sourceBinary);
    const driftPath = await recoveryPayloadPath(fixture.root, driftReference);
    assertEquals(await Deno.readFile(driftPath), drift);
    assertEquals(
      (await reclaimExecutionStorage(
        fixture.root,
        [claimed.fence.attempt_id],
        true,
      )).manifests,
      [],
    );
    const recordDirectory = await gitAdminStatePath(
      fixture.root,
      "completionRecords",
    );
    const readDir = Deno.readDir;
    Deno.readDir = function (path: string | URL): AsyncIterable<Deno.DirEntry> {
      return path === recordDirectory
        ? (async function* (): AsyncGenerator<Deno.DirEntry> {
          for (let index = 0; index < 100_001; index++) {
            yield {
              name: `entry-${index}`,
              isFile: true,
              isDirectory: false,
              isSymlink: false,
            };
          }
        })()
        : readDir(path);
    };
    try {
      await assertRejects(
        () =>
          reclaimExecutionStorage(
            fixture.root,
            [claimed.fence.attempt_id],
            true,
          ),
        Error,
        "Recovery directory inventory exceeds its entry bound",
      );
    } finally {
      Deno.readDir = readDir;
    }
    const current = await requireEnvironment(fixture.root, fixture.id);
    const snapshot = await fixture.workspace.inspect(
      current.record.data,
      fixture.declaration,
      "recovery",
    );
    const subject = {
      attempt_id: claimed.fence.attempt_id,
      candidate_id: claimed.candidate_id,
      context: "local",
    };
    const kept = await saveEnvironmentArtifact(
      fixture.root,
      subject,
      "historical",
      snapshot,
    );
    await saveEnvironmentArtifact(
      fixture.root,
      subject,
      "shared-unused",
      snapshot,
    );
    const history = await replaceEnvironment(fixture.root, current, {
      ...current.record.data,
      state: {
        kind: "recovery",
        attempt_id: claimed.fence.attempt_id,
        recovery: recoveryFor(
          "capture",
          "retained recovery evidence",
          fixture.path,
          [],
          true,
          {
            kind: "captured",
            artifacts: [kept],
          },
        ),
      },
    }, fixture.clock);
    const restored = await replaceEnvironment(
      fixture.root,
      history,
      current.record.data,
      fixture.clock,
    );
    await retireBorrowedEnrollment(
      fixture.root,
      fixture.id,
      restored.stamp,
      fixture.actor,
      fixture.lifetime,
    );
    const abandoned = await recoveryStoragePath(
      fixture.root,
      "staging/33333333-3333-4333-8333-333333333333",
    );
    await Deno.mkdir(abandoned.slice(0, abandoned.lastIndexOf("/")), {
      recursive: true,
    });
    await Deno.writeTextFile(abandoned, "interrupted partial bytes");
    const activeId = "44444444-4444-4444-8444-444444444444";
    const active = {
      version: ON_DISK_FORMATS.completionRecord.version,
      kind: "attempt" as const,
      id: activeId,
      revision: 1,
      data: {
        ...claimed.attempt,
        identity: {
          ...claimed.attempt.identity,
          id: activeId,
          sequence: claimed.attempt.identity.sequence + 1,
        },
        state: { kind: "planned" as const },
      },
    };
    const published = await writeCompletionRecord(fixture.root, active, null);
    assertEquals(published.kind, "written");
    if (published.kind !== "written") {
      throw new Error("Fixture publication failed");
    }
    const duringRecovery = await reclaimExecutionStorage(fixture.root, [
      claimed.fence.attempt_id,
    ], true);
    assertEquals(duringRecovery.deferred, ["unfinished-execution"]);
    assertEquals(duringRecovery.staging, []);
    assertEquals(duringRecovery.payloads, []);
    assertEquals(
      (await writeCompletionRecord(fixture.root, {
        ...active,
        revision: 2,
        data: {
          ...active.data,
          state: {
            kind: "finished",
            outcome: "cancelled",
            finished_at: fixture.clock.wallNow(),
          },
        },
      }, published.stamp)).kind,
      "written",
    );
    const keptPath = await artifactPath(
      fixture.root,
      kept.attempt_id,
      kept.path,
    );
    const intact = await Deno.readTextFile(keptPath);
    await Deno.writeTextFile(
      keptPath,
      JSON.stringify({ format: "future-storage-v8" }),
    );
    await assertRejects(
      () => reclaimExecutionStorage(fixture.root, [claimed.fence.attempt_id]),
      Error,
      "unknown recovery format",
    );
    await Deno.writeTextFile(keptPath, intact);
    const references = executionArtifactReferences(snapshot);
    const reference = references.payloads[0];
    assertEquals(typeof reference, "string");
    if (reference === undefined) {
      throw new Error("Fixture requires a stored recovery payload");
    }
    const payload = await recoveryPayloadPath(fixture.root, reference);
    const bytes = await Deno.readFile(payload);
    await Deno.writeFile(payload, new Uint8Array(bytes.length + 1));
    await assertRejects(
      () => reclaimExecutionStorage(fixture.root, [claimed.fence.attempt_id]),
      Error,
      "retained recovery payload is unavailable",
    );
    await Deno.writeFile(payload, bytes);
    const unknownStorage = await recoveryStoragePath(
      fixture.root,
      "future-references.json",
    );
    await Deno.writeTextFile(unknownStorage, "{}");
    try {
      await assertRejects(
        () => reclaimExecutionStorage(fixture.root, [claimed.fence.attempt_id]),
        Error,
        "Unknown recovery storage entry",
      );
    } finally {
      await Deno.remove(unknownStorage);
    }
    const historyPath = join(
      recordDirectory ?? "",
      "environment",
      fixture.id,
      "1.json",
    );
    const historicalBytes = await Deno.readFile(historyPath);
    await Deno.remove(historyPath);
    try {
      await assertRejects(
        () => reclaimExecutionStorage(fixture.root, [claimed.fence.attempt_id]),
        Error,
        "history is incomplete",
      );
      assertEquals(await Deno.readFile(driftPath), drift);
    } finally {
      await Deno.writeFile(historyPath, historicalBytes);
    }
    // Suspend inventory, publish a new reference, then require a fresh observation.
    const reached = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    let suspended = false;
    Deno.readDir = function (path: string | URL): AsyncIterable<Deno.DirEntry> {
      return (async function* (): AsyncGenerator<Deno.DirEntry> {
        if (path === recordDirectory && !suspended) {
          suspended = true;
          reached.resolve();
          await resume.promise;
        }
        for await (const entry of readDir(path)) yield entry;
      })();
    };
    const observing = reclaimExecutionStorage(fixture.root, [
      claimed.fence.attempt_id,
    ]);
    try {
      await Promise.race([reached.promise, observing]);
      await saveEnvironmentArtifact(
        fixture.root,
        subject,
        "published-during-inventory",
        snapshot,
      );
      resume.resolve();
      await assertRejects(() => observing, Error, "reference graph changed");
      assertEquals(
        await Deno.readTextFile(abandoned),
        "interrupted partial bytes",
      );
    } finally {
      resume.resolve();
      Deno.readDir = readDir;
    }
    const plan = await reclaimExecutionStorage(fixture.root, [
      claimed.fence.attempt_id,
    ]);
    assertEquals(plan.staging, [abandoned]);
    await assertRejects(() => Deno.stat(abandoned), Deno.errors.NotFound);
    assertEquals(plan.manifests.length > 0, true);
    assertEquals(
      plan.retained.includes(`${kept.attempt_id}/${kept.path}`),
      true,
    );
    assertEquals(await Deno.readTextFile(keptPath), intact);
    assertEquals(await Deno.readFile(payload), bytes);
    assertEquals(
      await Deno.readFile(driftPath),
      drift,
    );
    assertEquals(
      (await reclaimExecutionStorage(fixture.root, [claimed.fence.attempt_id]))
        .manifests,
      [],
    );
  });
});

Deno.test("canonical landing references survive history and resource names are not format headers", () => {
  const fixtures = completionFixtures();
  const landing = COMPLETION_FAMILIES.landing.schema.parse(fixtures.landing);
  const artifact = {
    attempt_id: landing.data.attempt_id,
    candidate_id: landing.data.candidate_id,
    context: "local",
    path: "environment/historical-convergence.json",
    digest: "a".repeat(64),
    bytes: 4,
  };
  const historical = COMPLETION_FAMILIES.landing.schema.parse({
    ...landing,
    data: {
      ...landing.data,
      note_result: artifact,
      convergence_result: artifact,
    },
  });
  assertEquals(executionArtifactReferences(historical).artifacts, [
    `${artifact.attempt_id}/${artifact.path}`,
  ]);
  const environment = COMPLETION_FAMILIES.environment.schema.parse(
    fixtures.environment,
  );
  assertEquals(environment.data.ownership.kind, "borrowed");
  if (environment.data.ownership.kind !== "borrowed") {
    throw new Error("Borrowed fixture required");
  }
  assertEquals(
    executionArtifactReferences({
      ...environment,
      data: {
        ...environment.data,
        ownership: {
          ...environment.data.ownership,
          identity: {
            ...environment.data.ownership.identity,
            resources: { format: "owned-resource" },
          },
        },
      },
    }).artifacts,
    [],
  );
});
