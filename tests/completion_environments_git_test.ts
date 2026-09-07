import { gitPathRecord } from "../src/shared/git_paths.ts";
/** Real bounded Git failures remain actionable in an environment's recovery. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  captureGitSnapshot,
  containedFile,
  executionGit,
  requireRestorableSnapshot,
} from "../src/engine/execution/snapshot.ts";
import { CheckoutPathSchema } from "../src/engine/execution/snapshot_schema.ts";
import { ArtifactPathSchema } from "../src/engine/completion/evidence.ts";
import { SYSTEM_SCHEDULER } from "../src/shared/scheduler.ts";
import { GIT_OUTPUT_LIMIT_EXCEEDED } from "../src/shared/subprocess.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "./waiting.ts";

Deno.test("V06 bounded Git failures retain deadline, output ceiling, and exit evidence", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "source"), "source bytes\n");
    await gitInit(root);
    const bounds = {
      maxFiles: 100,
      maxBytes: 1024 * 1024,
      gitTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
    };
    const timedOut = await assertRejects(
      () =>
        executionGit(root, ["rev-parse", "HEAD"], {
          ...bounds,
          gitTimeoutMs: 37,
        }, {
          allowedExitCodes: [124],
          scheduler: {
            ...SYSTEM_SCHEDULER,
            scheduleTimeout: (callback) => {
              callback();
              return 0;
            },
            cancelTimeout: () => {},
          },
        }),
      Error,
      "time limit 37 ms",
    );
    assertStringIncludes(timedOut.message, "exit 124");
    assertStringIncludes(timedOut.message, "Preserve the environment");
    const limited = await assertRejects(
      () =>
        executionGit(root, ["rev-parse", "HEAD"], {
          ...bounds,
          maxBytes: 1,
        }, { allowedExitCodes: [GIT_OUTPUT_LIMIT_EXCEEDED] }),
      Error,
      "output limit 1 bytes",
    );
    assertStringIncludes(limited.message, `exit ${GIT_OUTPUT_LIMIT_EXCEEDED}`);
    const failed = await assertRejects(
      () =>
        executionGit(
          root,
          ["rev-parse", "--verify", "refs/heads/missing"],
          bounds,
        ),
      Error,
      "exit 128",
    );
    assertStringIncludes(failed.message, "Preserve the environment");

    await git(root, "switch", "--detach", "HEAD");
    assertEquals(
      await executionGit(root, ["symbolic-ref", "-q", "HEAD"], bounds, {
        allowedExitCodes: [1],
      }),
      "",
    );
  });
});

Deno.test("V08 checkout capture preserves literal native filenames and rejects traversal", async () => {
  await withTempDir(async (root) => {
    const names = Deno.build.os === "windows" ? ["with space", "café"] : [
      "*bold*.txt",
      "line\nbreak",
      "tab\tname",
      " leading",
      "trailing ",
      "café",
      "back\\slash",
    ];
    for (const name of names) await Deno.writeTextFile(join(root, name), name);
    await gitInit(root);
    const snapshot = await captureGitSnapshot(root, {
      maxFiles: 100,
      maxBytes: 1024 * 1024,
      gitTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
    });
    assertEquals(
      snapshot.files.map((file) => file.path).sort(),
      [...names].sort(),
    );
    assertEquals(
      snapshot.index_entries,
      await gitOut(root, "ls-files", "--stage", "-z"),
    );
    assertEquals(snapshot.head, await gitOut(root, "rev-parse", "HEAD"));
    assertEquals(snapshot.tree, await gitOut(root, "rev-parse", "HEAD^{tree}"));
    for (const file of snapshot.files) {
      assertEquals(
        await Deno.readTextFile(await containedFile(root, file.path)),
        file.path,
      );
    }
    const tracked = names[0];
    if (tracked === undefined) throw new Error("native-name fixture is empty");
    const capture = () =>
      captureGitSnapshot(root, {
        maxFiles: 100,
        maxBytes: 1024 * 1024,
        gitTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
      });
    for (const flag of ["assume-unchanged", "skip-worktree"]) {
      await git(root, "update-index", `--${flag}`, "--", tracked);
      try {
        await assertRejects(
          capture,
          Error,
          "require their own restoration contract",
        );
      } finally {
        await git(root, "update-index", `--no-${flag}`, "--", tracked);
      }
    }
    await git(root, "update-index", "--split-index");
    try {
      await assertRejects(
        capture,
        Error,
        "require their own restoration contract",
      );
    } finally {
      await git(root, "update-index", "--no-split-index");
    }
    await git(
      root,
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${snapshot.head},submodule`,
    );
    try {
      await assertRejects(
        capture,
        Error,
        "Submodules or unresolved index stages",
      );
    } finally {
      await git(root, "update-index", "--force-remove", "submodule");
    }
    for (
      const name of [
        "../outside",
        "/outside",
        "a/../outside",
        "a/./b",
        "a//b",
        ".git/index",
        "a/.GIT/config",
        "a\0b",
      ]
    ) {
      assertEquals(CheckoutPathSchema.safeParse(name).success, false, name);
      await assertRejects(() => containedFile(root, name));
    }
    assertEquals(CheckoutPathSchema.safeParse("e\u0301").success, true);
    assertEquals(ArtifactPathSchema.safeParse("*bold*.txt").success, false);
    await Deno.symlink(root, join(root, "ancestor"), { type: "dir" });
    await assertRejects(
      () => containedFile(root, "ancestor/source"),
      Error,
      "non-directory ancestor",
    );
  });
});

Deno.test("Git capture batches native observations without changing fields or bounds", async () => {
  await withTempDir(async (root) => {
    await git(root, "init", "-q", "-b", "main");
    await git(
      root,
      "-c",
      "user.name=Snapshot",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-qm",
      "empty",
    );
    const bounds = {
      maxFiles: 100,
      maxBytes: Math.max(
        96,
        new TextEncoder().encode(
          await gitOut(root, "rev-parse", "--absolute-git-dir"),
        ).length + 1,
      ),
      gitTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
    };
    const Command = Deno.Command;
    let calls = 0;
    Deno.Command = class extends Command {
      /** Count real Git work in the complete two-observation capture. */
      constructor(command: string | URL, options?: Deno.CommandOptions) {
        super(command, options);
        if (command === "git") calls += 1;
      }
    };
    try {
      const snapshot = await captureGitSnapshot(root, bounds);
      assertEquals(snapshot.branch, "refs/heads/main");
      assertEquals(snapshot.index_entries, "");
      assertEquals(
        calls,
        16,
        "eight native queries in each of two complete observations",
      );
    } finally {
      Deno.Command = Command;
    }
    await git(root, "switch", "--detach", "HEAD");
    assertEquals((await captureGitSnapshot(root, bounds)).branch, null);
    await assertRejects(
      () => captureGitSnapshot(root, { ...bounds, maxBytes: 40 }),
      Error,
      "output limit 40 bytes",
    );
  }, {
    ...(Deno.build.os === "windows" ? {} : { parent: "/tmp" }),
    prefix: "discern-snapshot-",
  });
});

Deno.test("release identity ignores native index refresh while preserving actual checkout drift", async () => {
  const { environmentFixture } = await import(
    "./completion_environments_fixture.ts"
  );
  const { releasedSubject, releaseMatchesSnapshot } = await import(
    "../src/engine/execution/subjects.ts"
  );
  const { sha256Hex } = await import("../src/shared/sha256.ts");
  const { requireEnvironment } = await import(
    "../src/engine/execution/registry.ts"
  );
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const environment = (await requireEnvironment(f.root, f.id)).record.data;
    const before = await f.workspace.inspect(environment, f.declaration);
    const subject = await releasedSubject(environment, before);
    const released = {
      ...environment,
      release: {
        kind: "released" as const,
        subject,
        retirement: true,
        id: f.id,
        at: 1,
        owner: "fixture",
      },
    };
    const legacy = {
      ...released,
      release: {
        ...released.release,
        subject: await sha256Hex(JSON.stringify({
          path: environment.path,
          declaration: environment.declaration,
          ownership: environment.ownership,
          snapshot: before.digest,
        })),
      },
    };
    assertEquals(
      await releaseMatchesSnapshot({
        ...environment,
        release: { kind: "held" },
      }, before),
      false,
    );
    assertEquals(await releaseMatchesSnapshot(released, before), true);
    assertEquals(await releaseMatchesSnapshot(legacy, before), true);
    const path = join(f.path, "schema");
    await Deno.utime(path, 1234567890, 1234567890);
    await git(f.path, "status", "--porcelain");
    const after = await f.workspace.inspect(environment, f.declaration);
    assert(
      before.digest !== after.digest,
      "the raw restoration snapshot must retain the changed index bytes",
    );
    assertEquals(await releasedSubject(environment, after), subject);
    assertEquals(await releaseMatchesSnapshot(released, after), true);
    assertEquals(
      await releaseMatchesSnapshot(legacy, after),
      false,
      "older exact-byte releases cannot gain broader validity",
    );
    await Deno.writeTextFile(join(f.path, "cache.dat"), "new local data");
    const drift = await f.workspace.inspect(environment, f.declaration);
    assert(
      await releasedSubject(environment, drift) !== subject,
      "ignored file changes after release must remain protected",
    );
    assertEquals(await releaseMatchesSnapshot(released, drift), false);
    await Deno.writeTextFile(path, "changed source");
    await assertRejects(
      () => f.workspace.inspect(environment, f.declaration),
      Error,
      "clean source and index",
    );
  });
});

Deno.test("Git directory records preserve opaque ignored repositories without authorizing restoration", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      join(root, ".gitignore"),
      "cache/\nseparate-administration/\n",
    );
    await Deno.writeTextFile(join(root, "source"), "source\n");
    await gitInit(root);
    const bounds = {
      maxFiles: 100,
      maxBytes: 1024 * 1024,
      gitTimeoutMs: TEST_PROCESS_TIMEOUT_MS,
    };
    const nested = join(root, "cache", "package");
    await Deno.mkdir(nested, { recursive: true });
    await Deno.writeTextFile(join(nested, "content"), "package bytes");
    assertEquals(
      (await captureGitSnapshot(root, bounds)).opaque_ignored_repositories,
      undefined,
    );
    await git(nested, "init", "-q");
    const snapshot = await captureGitSnapshot(root, bounds);
    assertEquals(snapshot.opaque_ignored_repositories, [{
      path: "cache/package",
      administration: "directory",
    }]);
    assert(
      !snapshot.files.some((file) => file.path.startsWith("cache/package")),
    );
    assertThrows(
      () => requireRestorableSnapshot(snapshot),
      Error,
      "cache/package",
    );
    await assertRejects(
      () => captureGitSnapshot(root, { ...bounds, maxFiles: 2 }),
      Error,
      "file limit",
    );
    await assertRejects(
      () => containedFile(root, gitPathRecord("../escape/").path),
      Error,
      "Invalid checkout capture path",
    );
    assertEquals(gitPathRecord("cache//"), {
      kind: "directory",
      path: "cache/",
    });
    await assertRejects(
      () => containedFile(root, gitPathRecord("cache//").path),
      Error,
      "Invalid checkout capture path",
    );
    // A Git file is also administration, never content that can be restored as project bytes.
    await git(
      nested,
      "init",
      "--separate-git-dir",
      join(root, "separate-administration"),
    );
    const withFile = await captureGitSnapshot(root, bounds);
    assertEquals(withFile.opaque_ignored_repositories, [{
      path: "cache/package",
      administration: "file",
    }]);
    assertThrows(
      () => requireRestorableSnapshot(withFile),
      Error,
      "cache/package",
    );
  });
});
