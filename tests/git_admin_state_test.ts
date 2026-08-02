/** Class guard for Discern-owned paths inside Git's administrative area. */

import { assert, assertEquals } from "@std/assert";
import { isAbsolute, join } from "@std/path";
import {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_KEYS,
  GIT_ADMIN_STATE_NAMESPACE,
  gitAdminStatePath,
} from "../src/shared/git_admin_state.ts";
import { addWorktree, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import {
  AUTHORED_TS_FILES,
  authoredTsFiles,
  REPO_ROOT,
} from "./repo_authored_paths.ts";

/** Resolve Git's possibly relative admin path against the command checkout. */
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

/** Every listed TypeScript source invoking `--git-path`, minus `allowed`. */
async function gitPathInvokers(
  root: string,
  files: string[],
  allowed: readonly string[],
): Promise<string[]> {
  const offenders: string[] = [];
  for (const rel of files) {
    if (allowed.includes(rel)) continue;
    const text = await Deno.readTextFile(join(root, rel));
    if (/['"]--git-path['"]/.test(text)) {
      offenders.push(rel);
    }
  }
  return offenders.sort();
}

const GIT_PATH_ALLOWED = [
  // The registry resolver itself — the one production `--git-path` call.
  "src/shared/git_admin_state.ts",
  // This file: the resolver's independent oracle must resolve the same
  // artifacts without going through the code under test.
  "tests/git_admin_state_test.ts",
];

Deno.test("only the Git-admin registry resolver may invoke --git-path", async () => {
  assertEquals(
    await gitPathInvokers(REPO_ROOT, AUTHORED_TS_FILES, GIT_PATH_ALLOWED),
    [],
    "register the artifact and resolve it through gitAdminStatePath",
  );
});

Deno.test("the --git-path guard enrolls a fresh caller in any authored tree", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    await Deno.mkdir(join(dir, "scripts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "scripts", "fresh_probe.ts"),
      `await run("git", ["rev-parse", "--git-path", "hooks"]);\n`,
    );
    assertEquals(
      await gitPathInvokers(dir, await authoredTsFiles(dir), []),
      ["scripts/fresh_probe.ts"],
    );
  });
});
