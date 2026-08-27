/** Lifecycle coverage for command-scoped tooling scratch directories. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { basename, join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import {
  createToolTempDirCapability,
  TOOL_TEMP_DIR_KINDS,
  ToolTempDirCleanupError,
  type ToolTempDirKind,
  withToolTempDir,
} from "../scripts/temp_dir.ts";
import {
  FUTURE_TOOL_TEMP_DIR_KINDS,
  futureToolTempDirCapability,
} from "./fixtures/tool_temp_dir_future_member.ts";

/** Every live kind creates securely, removes recursive content, and returns data. */
Deno.test("tool temp directories: every registered kind owns creation and cleanup", async () => {
  for (const kind of Object.keys(TOOL_TEMP_DIR_KINDS) as ToolTempDirKind[]) {
    let created = "";
    const result = await withToolTempDir(kind, async (dir) => {
      created = dir;
      assert(
        basename(dir).startsWith(TOOL_TEMP_DIR_KINDS[kind].prefix),
        `${kind} did not use its registered prefix: ${dir}`,
      );
      await Deno.mkdir(join(dir, "nested", "content"), { recursive: true });
      await Deno.writeTextFile(
        join(dir, "nested", "content", "proof.txt"),
        "owned\n",
      );
      return `completed:${kind}`;
    });
    assertEquals(result, `completed:${kind}`);
    assertEquals(
      await targetExists(created),
      false,
      `${kind} leaked ${created}`,
    );
  }
});

Deno.test("tool temp directories: callback and abort failures keep their identity after cleanup", async () => {
  for (
    const failure of [
      new Error("callback failed"),
      new DOMException("interrupted", "AbortError"),
    ]
  ) {
    let created = "";
    let caught: unknown;
    try {
      await withToolTempDir("coverage-profile", (dir) => {
        created = dir;
        throw failure;
      });
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, failure);
    assertEquals(await targetExists(created), false);
  }
});

Deno.test("tool temp directories: creation failure has no callback or cleanup side effect", async () => {
  const creationFailure = new Error("creation denied");
  let calledBack = false;
  let removed = false;
  const capability = createToolTempDirCapability(TOOL_TEMP_DIR_KINDS, {
    makeTempDir: () => Promise.reject(creationFailure),
    remove: () => {
      removed = true;
      return Promise.resolve();
    },
  });
  let caught: unknown;
  try {
    await capability("coverage-profile", () => {
      calledBack = true;
    });
  } catch (error) {
    caught = error;
  }
  assertStrictEquals(caught, creationFailure);
  assertEquals(calledBack, false);
  assertEquals(removed, false);
});

Deno.test("tool temp directories: cleanup failure fails success with an exact diagnostic", async () => {
  const cleanupFailure = new Error("cleanup denied");
  const capability = createToolTempDirCapability(TOOL_TEMP_DIR_KINDS, {
    makeTempDir: () => Promise.resolve("/tmp/discern-coverage-planted"),
    remove: () => Promise.reject(cleanupFailure),
  });
  const error = await assertRejects(
    () => capability("coverage-profile", () => 42),
    ToolTempDirCleanupError,
    "cleanup denied",
  );
  assertEquals(error.kind, "coverage-profile");
  assertEquals(error.path, "/tmp/discern-coverage-planted");
  assertStrictEquals(error.cause, cleanupFailure);
});

Deno.test("tool temp directories: cleanup failure reports but never masks a primary failure", async () => {
  const primary = new Error("primary callback failure");
  const reports: string[] = [];
  const capability = createToolTempDirCapability(TOOL_TEMP_DIR_KINDS, {
    makeTempDir: () => Promise.resolve("/tmp/discern-coverage-planted"),
    remove: () => Promise.reject(new Error("cleanup denied")),
    report: (message) => reports.push(message),
  });
  let caught: unknown;
  try {
    await capability("coverage-profile", () => {
      throw primary;
    });
  } catch (error) {
    caught = error;
  }
  assertStrictEquals(caught, primary);
  assertEquals(reports.length, 1);
  assertStringIncludes(reports[0] ?? "", "cleanup denied");
  assertStringIncludes(reports[0] ?? "", "preserving primary failure");
  assertStringIncludes(reports[0] ?? "", "/tmp/discern-coverage-planted");
});

Deno.test("tool temp directories: concurrent uses of one kind stay isolated", async () => {
  const bothEntered = Promise.withResolvers<void>();
  const created: string[] = [];
  const use = async (): Promise<void> => {
    await withToolTempDir("coverage-profile", async (dir) => {
      created.push(dir);
      if (created.length === 2) bothEntered.resolve();
      await bothEntered.promise;
      assertEquals(await targetExists(dir), true);
    });
  };
  await Promise.all([use(), use()]);
  assertEquals(new Set(created).size, 2);
  for (const dir of created) assertEquals(await targetExists(dir), false);
});

Deno.test("tool temp directories: only an opted-in kind accepts a caller parent", async () => {
  let createdWith:
    | { readonly dir?: string; readonly prefix: string }
    | undefined;
  const capability = createToolTempDirCapability(TOOL_TEMP_DIR_KINDS, {
    makeTempDir: (options) => {
      createdWith = options;
      return Promise.resolve("/tmp/discern-manual-stage-planted");
    },
    remove: () => Promise.resolve(),
  });
  await capability("manual-build-stage", () => undefined, {
    parent: "/tmp/manual-parent",
  });
  assertEquals(createdWith, {
    dir: "/tmp/manual-parent",
    prefix: "discern-manual-stage-",
  });
  await assertRejects(
    () =>
      capability("coverage-profile", () => undefined, {
        parent: "/tmp/unregistered-parent",
      }),
    TypeError,
    "does not accept a caller parent",
  );
});

Deno.test("tool temp directories: a future member enrolls in creation, prefix, cleanup, and preservation", async () => {
  const reports: string[] = [];
  const capability = futureToolTempDirCapability({
    report: (message) => reports.push(message),
  });
  let successPath = "";
  await capability("future-evidence", async (dir) => {
    successPath = dir;
    assert(
      basename(dir).startsWith(
        FUTURE_TOOL_TEMP_DIR_KINDS["future-evidence"].prefix,
      ),
    );
    await Deno.writeTextFile(join(dir, "evidence.txt"), "future\n");
  });
  assertEquals(await targetExists(successPath), false);

  const primary = new Error("future command failed");
  let retained = "";
  let caught: unknown;
  try {
    await capability("future-evidence", (dir) => {
      retained = dir;
      throw primary;
    });
  } catch (error) {
    caught = error;
  }
  try {
    assertStrictEquals(caught, primary);
    assertEquals(await targetExists(retained), true);
    assertEquals(reports.length, 1);
    assertStringIncludes(reports[0] ?? "", retained);
    assertStringIncludes(reports[0] ?? "", "retained tool temp directory");
  } finally {
    if (retained !== "") await Deno.remove(retained, { recursive: true });
  }
});
