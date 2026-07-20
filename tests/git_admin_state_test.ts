/** Class guard for Discern-owned paths inside Git's administrative area. */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { dirname, fromFileUrl, isAbsolute, join, relative } from "@std/path";
import {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_KEYS,
  GIT_ADMIN_STATE_NAMESPACE,
  gitAdminStatePath,
} from "../src/shared/git_admin_state.ts";
import { addWorktree, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

function absoluteFrom(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

Deno.test("every registered Git-admin artifact is contained by the discern namespace", () => {
  const paths = GIT_ADMIN_STATE_KEYS.map((key) => GIT_ADMIN_STATE[key].path);
  assertEquals(
    new Set(paths).size,
    paths.length,
    "registry paths must be unique",
  );
  for (const path of paths) {
    assert(
      path.startsWith(`${GIT_ADMIN_STATE_NAMESPACE}/`),
      `${path} escapes the ${GIT_ADMIN_STATE_NAMESPACE}/ namespace`,
    );
    assert(
      !isAbsolute(path),
      `${path} must remain relative to Git admin state`,
    );
    assert(
      !path.split("/").includes(".."),
      `${path} must not traverse out of its namespace`,
    );
  }
});

for (const checkout of ["plain", "linked"] as const) {
  Deno.test(`the registry resolves ${checkout}-checkout lifetimes through Git`, async () => {
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
      await gitInit(dir);
      const cwd = checkout === "linked"
        ? await addWorktree(dir, "admin-state")
        : dir;
      const commonDir = absoluteFrom(
        cwd,
        await gitOut(cwd, "rev-parse", "--git-common-dir"),
      );

      for (const key of GIT_ADMIN_STATE_KEYS) {
        const entry = GIT_ADMIN_STATE[key];
        const expected = entry.scope === "worktree"
          ? absoluteFrom(
            cwd,
            await gitOut(cwd, "rev-parse", "--git-path", entry.path),
          )
          : join(commonDir, entry.path);
        assertEquals(await gitAdminStatePath(cwd, key), expected, key);
      }
    });
  });
}

Deno.test("Git-admin paths are unavailable outside a repository", async () => {
  await withTempDir(async (dir) => {
    for (const key of GIT_ADMIN_STATE_KEYS) {
      assertEquals(await gitAdminStatePath(dir, key), undefined, key);
    }
  });
});

Deno.test("only the Git-admin registry resolver may invoke --git-path", async () => {
  const allowed = "src/shared/git_admin_state.ts";
  const offenders: string[] = [];
  for await (
    const entry of walk(join(REPO_ROOT, "src"), {
      includeDirs: false,
      exts: [".ts"],
    })
  ) {
    const text = await Deno.readTextFile(entry.path);
    if (/['"]--git-path['"]/.test(text)) {
      const path = relative(REPO_ROOT, entry.path);
      if (path !== allowed) {
        offenders.push(path);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    "register the artifact and resolve it through gitAdminStatePath",
  );
});
