import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { git, gitOut } from "./engine_helpers.ts";
import {
  environmentFixture,
  planWithEvidence,
} from "./completion_environments_fixture.ts";
import { createEnvironmentExecutor } from "../src/engine/execution/executor.ts";
import {
  registerExecutionEnvironment,
  requireEnvironment,
} from "../src/engine/execution/registry.ts";
import {
  readEnvironmentArtifact,
  readExecutionDocument,
} from "../src/engine/execution/artifact_read.ts";
import { saveEnvironmentArtifact } from "../src/engine/execution/artifacts.ts";
import { SnapshotSchema } from "../src/engine/execution/snapshot_schema.ts";
import { WorkspaceStateSchema } from "../src/engine/execution/workspace_state.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { parsePorcelainZ } from "../src/shared/git_paths.ts";
import { verifyRecoveryPayload } from "../src/engine/execution/payloads.ts";
import { completionFixtures, completionId } from "./completion_fixtures.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import {
  completionRecordPath,
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";

Deno.test("V01 undeclared temporary composition refuses while current source validation preserves authoring state", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base, "undeclared");
    const observation = {
      trunk: "main",
      observed_at: 100,
      records: [{
        selector: { kind: "environment" as const, id: f.id },
        reading: await f.executor.observe(f.id),
      }],
    };
    const blocked = f.executor.plan(observation, f.plan());
    assert("kind" in blocked && blocked.kind === "environment-unavailable");
    assertStringIncludes(blocked.reason, "forward update");
    assertEquals(await gitOut(f.path, "rev-parse", "HEAD"), f.source.head);
    const source = { ...f.candidate, head: f.source.head, tree: f.source.tree };
    const execution = await f.claim(f.plan(source));
    const result = await f.executor.execute(
      execution,
      () => Promise.resolve(true),
    );
    assertEquals(result.returned.kind, "restored");
    assertEquals(await gitOut(f.path, "symbolic-ref", "HEAD"), f.source.branch);
  });
});

Deno.test("V02 borrowed schema-v2 candidate returns schema-v1 source with frozen identity, resource, and index", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const execution = await f.claim();
    const original = await readExecutionDocument(
      f.root,
      execution.fence.attempt_id,
      "intent",
    );
    const result = await f.executor.execute(execution, async (active) => {
      assertEquals(await Deno.readTextFile(f.resourcePath), "2\n");
      assertEquals(await gitOut(f.path, "rev-parse", "HEAD"), f.candidate.head);
      assertEquals(
        active.environment.ownership,
        execution.environment.ownership,
      );
      return true;
    });
    assertEquals(result.returned.kind, "restored", JSON.stringify(result));
    assertEquals(await Deno.readTextFile(f.resourcePath), "1\n");
    assertEquals(await Deno.readTextFile(join(f.path, "cache.dat")), "1\n");
    assertEquals(await gitOut(f.path, "symbolic-ref", "HEAD"), f.source.branch);
    assertEquals(
      await readExecutionDocument(f.root, execution.fence.attempt_id, "intent"),
      original,
    );
    assertEquals(
      (await requireEnvironment(f.root, f.id)).record.data.release.kind,
      "held",
    );
  });
});

Deno.test("V03 isolated capacity and reset permit schema-v2 then schema-v1 without borrowing author resources", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base, "isolated");
    const environment = (await requireEnvironment(f.root, f.id)).record.data;
    await assertRejects(
      () =>
        registerExecutionEnvironment(f.root, completionId(51), {
          path: join(base, "another-slot"),
          ownership: environment.ownership,
        }, f.declaration),
      Error,
      "capacity",
    );
    for (
      const candidate of [f.candidate, {
        ...f.candidate,
        head: f.source.head,
        tree: f.source.tree,
      }]
    ) {
      const execution = await f.claim(f.plan(candidate));
      const result = await f.executor.execute(execution, async () => {
        assertEquals(
          await Deno.readTextFile(f.resourcePath),
          candidate.head === f.candidate.head ? "2\n" : "1\n",
        );
        return true;
      });
      assertEquals(result.returned.kind, "reset", JSON.stringify(result));
      assertEquals(await Deno.readTextFile(f.resourcePath), "0\n");
    }
    const current = await requireEnvironment(f.root, f.id);
    const path = await completionRecordPath(f.root, {
      kind: "environment",
      id: f.id,
    });
    assert(path !== undefined);
    const malformed = JSON.stringify({
      ...current.record,
      revision: "invalid",
      data: { ...current.record.data, state: { kind: "disposed", at: 100 } },
    });
    await Deno.writeTextFile(path, malformed);
    await assertRejects(
      () =>
        registerExecutionEnvironment(f.root, completionId(52), {
          path: join(base, "blocked-slot"),
          ownership: environment.ownership,
        }, f.declaration),
      Error,
      "invalid",
    );
    assertEquals(await Deno.readTextFile(path), malformed);
  });
});

Deno.test("V04 changed source, competing claim, and active use refuse before effects", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    f.lifetime.occupied = true;
    await assertRejects(() => f.claim(), Error, "conflicting");
    f.lifetime.occupied = false;
    await Deno.writeTextFile(join(f.path, "unfamiliar"), "owner work");
    await assertRejects(() => f.claim(), Error, "source");
    assertEquals(
      await Deno.readTextFile(join(f.path, "unfamiliar")),
      "owner work",
    );
    await Deno.remove(join(f.path, "unfamiliar"));
    const execution = await f.claim();
    await assertRejects(() => f.claim(), Error, "waiting-for-operation");
    const result = await f.executor.execute(
      execution,
      () => Promise.resolve(true),
    );
    assertEquals(result.returned.kind, "restored");
  });
});

Deno.test("V05 staged binary and new files are captured before return and cannot leak into source", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const execution = await f.claim();
    const bytes = new Uint8Array([0, 255, 12, 67]);
    const newFiles = ["new-file", "new file π"];
    const result = await f.executor.execute(execution, async () => {
      await Deno.writeFile(join(f.path, "binary"), bytes);
      await git(f.path, "add", "binary");
      await Deno.writeFile(join(f.path, "binary"), new Uint8Array([0, 1, 2]));
      for (const path of newFiles) {
        await Deno.writeTextFile(join(f.path, path), "candidate write");
      }
      return false;
    });
    assertEquals(result.returned.kind, "restored", JSON.stringify(result));
    assertEquals(await Deno.readTextFile(join(f.path, "binary")), "original\n");
    for (const path of newFiles) {
      await assertRejects(
        () => Deno.readFile(join(f.path, path)),
        Deno.errors.NotFound,
      );
    }
    // The snapshot artifact keeps binary payloads independently of Git's index objects.
    const directory = await gitAdminStatePath(f.root, "completionArtifacts");
    assert(directory !== undefined);
    const artifacts = join(
      directory,
      execution.fence.attempt_id,
      "environment",
    );
    const names = [];
    for await (const entry of Deno.readDir(artifacts)) {
      if (entry.name.startsWith("drift-")) names.push(entry.name);
    }
    assertEquals(names.length, 1);
    const name = names[0];
    assert(name !== undefined);
    const capture = WorkspaceStateSchema.parse(
      decodeWith(
        SnapshotSchema,
        await Deno.readTextFile(join(artifacts, name)),
      ).value,
    );
    assert(capture.git !== null);
    assertStringIncludes(capture.git.staged_patch, "GIT binary patch");
    assertEquals(
      await Deno.readFile(
        await verifyRecoveryPayload(
          f.root,
          capture.git.files.find((file) => file.path === "binary")?.contents ??
            "",
        ),
      ),
      new Uint8Array([0, 1, 2]),
    );
    const status = parsePorcelainZ(capture.git.status);
    for (const path of newFiles) {
      assertEquals(status.find((entry) => entry.path === path)?.status, "??");
      assertEquals(
        new TextDecoder().decode(
          await Deno.readFile(
            await verifyRecoveryPayload(
              f.root,
              capture.git.files.find((file) => file.path === path)?.contents ??
                "",
            ),
          ),
        ),
        "candidate write",
      );
    }
    const record = await readCompletionRecord(f.root, {
      kind: "attempt",
      id: execution.fence.attempt_id,
    });
    assert(record.kind === "recorded" && record.record.kind === "attempt");
    assertEquals(record.record.data.state.kind, "finished");
    if (record.record.data.state.kind === "finished") {
      assertEquals(record.record.data.state.outcome, "failed");
    }
  });
});

Deno.test("V06 failed capture preserves candidate writes and replacement recovery restores after complete capture", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    let fail = true;
    const workspace = {
      ...f.workspace,
      inspect: f.workspace.inspect.bind(f.workspace),
      verify: f.workspace.verify.bind(f.workspace),
      install: f.workspace.install.bind(f.workspace),
      unprovisioned: f.workspace.unprovisioned.bind(f.workspace),
      run: f.workspace.run.bind(f.workspace),
      restore: f.workspace.restore.bind(f.workspace),
      verifyReturned: f.workspace.verifyReturned.bind(f.workspace),
      dispose: f.workspace.dispose.bind(f.workspace),
      capture: async (...args: Parameters<typeof f.workspace.capture>) => {
        if (fail) throw new Error("injected incomplete capture");
        return await f.workspace.capture(...args);
      },
    };
    const executor = createEnvironmentExecutor({ ...f.options, workspace });
    const execution = await f.claim(f.plan(), executor);
    const result = await executor.execute(execution, async () => {
      await Deno.writeFile(
        join(f.path, "new-binary"),
        new Uint8Array([0, 255]),
      );
      return true;
    });
    assertEquals(result.returned.kind, "recovery-incomplete");
    assertEquals(await gitOut(f.path, "rev-parse", "HEAD"), f.candidate.head);
    assertEquals(
      await Deno.readFile(join(f.path, "new-binary")),
      new Uint8Array([0, 255]),
    );
    fail = false;
    const recovery = await requireEnvironment(f.root, f.id);
    const replacement = createEnvironmentExecutor({ ...f.options, workspace });
    const restored = await replacement.recover(f.id, recovery.stamp, {
      ...f.actor,
      operation_id: completionId(99),
    });
    assertEquals(restored.kind, "restored", JSON.stringify(restored));
    assertEquals(await gitOut(f.path, "symbolic-ref", "HEAD"), f.source.branch);
  });
});

Deno.test("V08 standalone diagnostic identity is retained and finished attempts reject stale evidence publishers", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const fixture = COMPLETION_FAMILIES.evidence.schema.parse(
      completionFixtures().evidence,
    );
    const basePlan = planWithEvidence(f.plan());
    const execution = await f.claim({
      ...basePlan,
      demand: {
        kind: "diagnostic",
        source: f.source,
        base: f.source.head,
        context: "local",
        mode: "strict",
        failing_requirement: {
          id: "test",
          context: "local",
          kind: "job",
          definition: fixture.data.applicability.policy,
        },
      },
    });
    assertEquals(execution.attempt.purpose, "diagnostic");
    await f.executor.execute(execution, () => Promise.resolve(true));
    const written = await writeCompletionRecord(
      f.root,
      {
        ...fixture,
        id: completionId(901),
        data: {
          ...fixture.data,
          artifacts: [],
          attempt_id: execution.fence.attempt_id,
          candidate_id: execution.candidate_id,
          sequence: execution.attempt.identity.sequence,
          purpose: "diagnostic",
        },
      },
      null,
      execution.fence,
      f.clock,
    );
    assertEquals(written.kind, "claim-lost");
    const artifact = await saveEnvironmentArtifact(
      f.root,
      {
        attempt_id: execution.fence.attempt_id,
        candidate_id: execution.candidate_id,
        context: "local",
      },
      "comparison",
      { base: f.source.head, source: f.source },
    );
    assertEquals(await readEnvironmentArtifact(f.root, artifact), {
      base: f.source.head,
      source: f.source,
    });
  });
});
