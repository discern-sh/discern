import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  removeTempTree,
  TEMP_DIR_OWNERSHIP_POLICIES,
  withTempDir,
} from "./temp_dir.ts";
import { fromFileUrl } from "@std/path";

const SUITE_TEMP_CHILD = fromFileUrl(
  new URL("fixtures/suite_temp_child.ts", import.meta.url),
);

Deno.test("withTempDir returns the callback value and removes the directory", async () => {
  let owned: string | undefined;
  const value = await withTempDir((dir) => {
    owned = dir;
    return { answer: 42 };
  });

  assertEquals(value, { answer: 42 });
  const removed = owned;
  assert(removed !== undefined);
  await assertRejects(() => Deno.stat(removed), Deno.errors.NotFound);
});

Deno.test("withTempDir removes the directory when the callback fails", async () => {
  let owned: string | undefined;
  await assertRejects(
    () =>
      withTempDir((dir) => {
        owned = dir;
        throw new Error("callback failed");
      }),
    Error,
    "callback failed",
  );

  const removed = owned;
  assert(removed !== undefined);
  await assertRejects(() => Deno.stat(removed), Deno.errors.NotFound);
});

Deno.test("withTempDir removes the sibling worktree directory", async () => {
  let sibling: string | undefined;
  await withTempDir(async (dir) => {
    sibling = `${dir}.worktrees`;
    await Deno.mkdir(sibling);
    await Deno.writeTextFile(`${sibling}/marker`, "owned\n");
  });

  const removed = sibling;
  assert(removed !== undefined);
  await assertRejects(() => Deno.stat(removed), Deno.errors.NotFound);
});

Deno.test("withTempDir owns an exact renamed fixture path", async () => {
  let renamed: string | undefined;
  await withTempDir(
    async (dir) => {
      renamed = dir;
      await Deno.writeTextFile(`${dir}/marker`, "owned\n");
    },
    {
      prefix: "discern-rename-source-",
      renamedPath: (created) => `${created}-renamed`,
    },
  );

  const removed = renamed;
  assert(removed !== undefined);
  assertStringIncludes(removed, "-renamed");
  await assertRejects(() => Deno.stat(removed), Deno.errors.NotFound);
});

Deno.test("removeTempTree retries the non-empty teardown race", async () => {
  let attempts = 0;
  await removeTempTree("synthetic-race", () => {
    attempts += 1;
    if (attempts < 3) {
      return Promise.reject(new Error("Directory not empty"));
    }
    return Promise.resolve();
  });
  assertEquals(attempts, 3);
});

Deno.test("every temp-directory ownership mode declares its boundary and reason", () => {
  for (const [mode, policy] of Object.entries(TEMP_DIR_OWNERSHIP_POLICIES)) {
    assert(
      policy.cleanupBoundary.length > 0,
      `${mode} has no cleanup boundary`,
    );
    assert(policy.reason.length > 0, `${mode} has no reason`);
  }
});

Deno.test({
  name: "suiteTempDir registers cleanup at normal process unload",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", SUITE_TEMP_CHILD],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const dir = new TextDecoder().decode(output.stdout).trim();
    await assertRejects(() => Deno.stat(dir), Deno.errors.NotFound);
  },
});

Deno.test({
  name: "a killed suite process leaves a registered reaper-family directory",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        SUITE_TEMP_CHILD,
        "keep-alive",
      ],
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const reader = child.stdout.getReader();
    const first = await reader.read();
    assert(first.value !== undefined);
    const dir = new TextDecoder().decode(first.value).trim();
    child.kill("SIGKILL");
    await child.status;
    await reader.cancel();

    assertEquals(dir.split("/").at(-1)?.startsWith("discern-test-"), true);
    assert((await Deno.stat(dir)).isDirectory);
    await removeTempTree(dir);
  },
});
