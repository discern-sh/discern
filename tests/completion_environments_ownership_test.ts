import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitOut } from "./engine_helpers.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import { completionId } from "./completion_fixtures.ts";
import { createEnvironmentExecutor } from "../src/engine/execution/executor.ts";
import {
  registerExecutionEnvironment,
  releaseExecutionEnvironment,
  requireEnvironment,
  retireBorrowedEnrollment,
} from "../src/engine/execution/registry.ts";
import {
  loadIdentitySettings,
  resolveIdentity,
} from "../src/engine/worktree/identity.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { captureGitSnapshot } from "../src/engine/execution/snapshot.ts";
import {
  readEnvironmentArtifact,
  saveEnvironmentArtifact,
} from "../src/engine/execution/artifacts.ts";

Deno.test("V02 detached child identity ignores candidate settings and environment overrides", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    await Deno.writeTextFile(
      join(f.root, "discern.toml"),
      '[project]\nslug = "candidate-slug"\n[repository]\nbranch_prefix = "candidate/"\n',
    );
    await git(f.root, "add", "discern.toml");
    await git(f.root, "commit", "-m", "change candidate identity settings");
    const candidate = {
      ...f.candidate,
      head: await gitOut(f.root, "rev-parse", "HEAD"),
      tree: await gitOut(f.root, "rev-parse", "HEAD^{tree}"),
    };
    const execution = await f.claim(f.plan(candidate));
    const result = await f.executor.execute(execution, async () => {
      const settings = await loadIdentitySettings(f.path, {
        get: () => "override",
      });
      assertEquals(settings.slug, "sample");
      assertEquals(settings.branchPrefix, "agent/");
      const identity = await resolveIdentity(f.path, f.path);
      assert(execution.environment.ownership.kind === "borrowed");
      assertEquals(
        identity.id,
        execution.environment.ownership.identity.worktree_id,
      );
      assertEquals(
        identity.seed,
        execution.environment.ownership.identity.seed,
      );
      return true;
    });
    assertEquals(result.validation, true, JSON.stringify(result));
    assertEquals(result.returned.kind, "restored", JSON.stringify(result));
    assertEquals(await gitOut(f.path, "symbolic-ref", "HEAD"), f.source.branch);
  });
});

Deno.test("V04 source owner retires only the idle enrollment before enrolling another source revision", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const execution = await f.claim();
    const active = await requireEnvironment(f.root, f.id);
    await assertRejects(
      () =>
        retireBorrowedEnrollment(
          f.root,
          f.id,
          active.stamp,
          f.actor,
          f.lifetime,
          f.clock,
        ),
      Error,
      "finish that return",
    );
    assertEquals(
      (await f.executor.execute(execution, () => Promise.resolve(true)))
        .returned.kind,
      "restored",
    );
    await Deno.writeTextFile(join(f.path, "schema"), "3\n");
    await git(f.path, "add", "schema");
    await git(f.path, "commit", "-m", "author next source");
    const idle = await requireEnvironment(f.root, f.id);
    await assertRejects(
      () =>
        retireBorrowedEnrollment(
          f.root,
          f.id,
          idle.stamp,
          { ...f.actor, originating_effort: "another-author" },
          f.lifetime,
          f.clock,
        ),
      Error,
      "source owner",
    );
    const closed = await retireBorrowedEnrollment(
      f.root,
      f.id,
      idle.stamp,
      f.actor,
      f.lifetime,
      f.clock,
    );
    assertEquals(closed.record.data.state.kind, "disposed");
    assertEquals(await Deno.readTextFile(f.resourcePath), "1\n");
    assertEquals(await Deno.readTextFile(join(f.path, "schema")), "3\n");
    const ownership = idle.record.data.ownership;
    assert(ownership.kind === "borrowed");
    const id = completionId(51);
    await registerExecutionEnvironment(
      f.root,
      id,
      {
        path: f.path,
        ownership: {
          ...ownership,
          source: {
            ...f.source,
            head: await gitOut(f.path, "rev-parse", "HEAD"),
            tree: await gitOut(f.path, "rev-parse", "HEAD^{tree}"),
          },
        },
      },
      f.declaration,
      f.clock,
    );
    const next = await requireEnvironment(f.root, id);
    const released = await releaseExecutionEnvironment(
      f.root,
      id,
      next.stamp,
      f.actor,
      f.declaration,
      { lifetime: f.lifetime, workspace: f.workspace },
      { clock: f.clock },
    );
    assertEquals(released.record.data.release.kind, "released");
  });
});

Deno.test("V05 writes after drift capture are preserved before any restoration effect", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const executor = createEnvironmentExecutor({
      ...f.options,
      afterPhase: async (phase) => {
        if (phase === "restore") {
          await Deno.writeTextFile(
            join(f.path, "late-writer"),
            "unfamiliar bytes",
          );
        }
      },
    });
    const execution = await f.claim(f.plan(), executor);
    const result = await executor.execute(
      execution,
      () => Promise.resolve(true),
    );
    assertEquals(result.returned.kind, "recovery-incomplete");
    assertEquals(
      await Deno.readTextFile(join(f.path, "late-writer")),
      "unfamiliar bytes",
    );
    assertEquals(await gitOut(f.path, "rev-parse", "HEAD"), f.candidate.head);
  });
});

Deno.test("V04 source changes after the install phase is recorded prevent detachment", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const executor = createEnvironmentExecutor({
      ...f.options,
      afterPhase: async (phase) => {
        if (phase === "install") {
          await Deno.writeTextFile(
            join(f.path, "source-write"),
            "author still writing",
          );
        }
      },
    });
    const execution = await f.claim(f.plan(), executor);
    const result = await executor.execute(
      execution,
      () => Promise.resolve(true),
    );
    assertEquals(result.validation, null);
    assertEquals(result.returned.kind, "recovery-incomplete");
    assertEquals(await gitOut(f.path, "symbolic-ref", "HEAD"), f.source.branch);
    assertEquals(
      await Deno.readTextFile(join(f.path, "source-write")),
      "author still writing",
    );
  });
});

Deno.test("V05 incomplete bounded capture and symlink ancestors refuse without removing files", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const bounds = { maxFiles: 1, maxBytes: 1024, gitTimeoutMs: 5000 };
    await assertRejects(
      () => captureGitSnapshot(f.path, bounds),
      Error,
      "capture",
    );
    await Deno.mkdir(join(f.path, "alias-target"));
    await Deno.writeTextFile(join(f.path, "alias-target", "bytes"), "preserve");
    await Deno.symlink("alias-target", join(f.path, "alias"));
    await git(f.path, "add", "alias-target/bytes");
    // A tracked ancestor is replaced after indexing; capture must not follow it.
    await Deno.rename(join(f.path, "alias-target"), join(f.path, "retained"));
    await Deno.symlink("retained", join(f.path, "alias-target"));
    await assertRejects(
      () => captureGitSnapshot(f.path, { ...bounds, maxFiles: 100 }),
      Error,
      "ancestor",
    );
    assertEquals(
      await Deno.readTextFile(join(f.path, "retained", "bytes")),
      "preserve",
    );
  });
});

Deno.test("V07 missing installation receipt retains isolated checkout and malformed intent makes no effects", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base, "isolated");
    const execution = await f.claim();
    const artifacts = await gitAdminStatePath(f.root, "completionArtifacts");
    assert(artifacts !== undefined);
    const installed = join(
      artifacts,
      execution.fence.attempt_id,
      "environment",
      "installed.json",
    );
    let receipt = "";
    const result = await f.executor.execute(execution, async () => {
      receipt = await Deno.readTextFile(installed);
      await Deno.remove(installed);
      await Deno.writeTextFile(join(f.path, "kept"), "capture incomplete");
      return true;
    });
    assertEquals(result.returned.kind, "recovery-incomplete");
    if (result.returned.kind === "recovery-incomplete") {
      assertStringIncludes(
        result.returned.recovery.reason,
        "installation receipt",
      );
    }
    assertEquals(
      await Deno.readTextFile(join(f.path, "kept")),
      "capture incomplete",
    );
    await Deno.writeTextFile(installed, receipt);
    const current = await requireEnvironment(f.root, f.id);
    const intent = join(
      artifacts,
      execution.fence.attempt_id,
      "environment",
      "intent.json",
    );
    const raw = await Deno.readTextFile(intent);
    await Deno.writeTextFile(intent, '{"format":"future-version"}');
    const blocked = await f.executor.recover(f.id, current.stamp, f.actor);
    assertEquals(blocked.kind, "recovery-incomplete");
    const blockedExecution = await f.executor.execute(
      execution,
      () => Promise.resolve(true),
    );
    assertEquals(blockedExecution.returned.kind, "recovery-incomplete");
    assertEquals((await requireEnvironment(f.root, f.id)).stamp, current.stamp);
    assertEquals(
      await Deno.readTextFile(join(f.path, "kept")),
      "capture incomplete",
    );
    await Deno.writeTextFile(intent, raw);
    assertEquals(
      (await f.executor.recover(f.id, current.stamp, f.actor)).kind,
      "reset",
    );
  });
});

Deno.test("V07 interruption before isolated installation closes only the unused reservation", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base, "isolated");
    const executor = createEnvironmentExecutor({
      ...f.options,
      afterPhase: (phase) => {
        if (phase === "install") throw new Error("stop before provisioning");
        return Promise.resolve();
      },
    });
    const execution = await f.claim(f.plan(), executor);
    const result = await executor.execute(
      execution,
      () => Promise.resolve(true),
    );
    assertEquals(result.validation, null);
    assertEquals(result.returned.kind, "disposed", JSON.stringify(result));
    await assertRejects(() => Deno.stat(f.path), Deno.errors.NotFound);
    await assertRejects(() => Deno.stat(f.resourcePath), Deno.errors.NotFound);
    const original = execution.environment;
    await registerExecutionEnvironment(
      f.root,
      completionId(51),
      { path: f.path, ownership: original.ownership },
      f.declaration,
      f.clock,
    );
  });
});

Deno.test("V05 hidden tracked changes and concurrent artifact writers cannot authorize overwritten bytes", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    await git(f.path, "update-index", "--assume-unchanged", "binary");
    await Deno.writeTextFile(join(f.path, "binary"), "hidden source work");
    await assertRejects(() => f.claim(), Error, "restoration contract");
    assertEquals(
      await Deno.readTextFile(join(f.path, "binary")),
      "hidden source work",
    );
    const subject = {
      attempt_id: completionId(300),
      candidate_id: completionId(1),
      context: "local",
    };
    const values = ["first", "second"];
    const publications = await Promise.allSettled(
      values.map((value) =>
        saveEnvironmentArtifact(f.root, subject, "concurrent", value)
      ),
    );
    const successful = publications.flatMap((result, index) =>
      result.status === "fulfilled"
        ? [{ receipt: result.value, value: values[index] }]
        : []
    );
    assertEquals(successful.length, 1);
    const winner = successful[0];
    assert(winner !== undefined);
    assertEquals(
      await readEnvironmentArtifact(f.root, winner.receipt),
      winner.value,
    );
    await assertRejects(
      () =>
        saveEnvironmentArtifact(f.root, subject, "concurrent", "replacement"),
      Error,
      "different bytes",
    );
  });
});
