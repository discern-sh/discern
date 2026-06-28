/**
 * Unit tests for the path resolvers in `src/lib/paths.ts`:
 *   - {@link resolveTemplatesDir} — auto-discovery of the scaffold `templates/`
 *     tree, via the `DISCERN_TEMPLATES_DIR` override (validated to be a real
 *     directory, else a clear throw) and a walk-up from the module's location.
 *   - {@link resolveWorktreeRoot} — the placement convention for new worktrees:
 *     the sibling default and the relative/absolute `[worktree].root` overrides.
 *
 * Each override test injects a fake env reader, supplying `DISCERN_TEMPLATES_DIR`
 * to the resolver directly rather than mutating the process env — so the tests
 * carry no shared state and stay safe to run in parallel.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { resolveTemplatesDir, resolveWorktreeRoot } from "../src/lib/paths.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { fakeEnv, REAL_TEMPLATES, withTempDir } from "./helpers.ts";

/** A fully-defaulted config carrying the given `[worktree].root` (empty ⇒ default). */
function configWithRoot(root: string): ReturnType<typeof parseConfigOrThrow> {
  return parseConfigOrThrow(
    root === "" ? "" : `[worktree]\nroot = "${root}"\n`,
  );
}

const OVERRIDE = "DISCERN_TEMPLATES_DIR";

Deno.test("override pointing at a real directory is returned verbatim", async () => {
  await withTempDir(async (dir) => {
    assert((await resolveTemplatesDir(fakeEnv({ [OVERRIDE]: dir }))) === dir);
  });
});

Deno.test("override pointing at a non-existent path throws a clear, named error", async () => {
  await withTempDir(async (dir) => {
    const missing = join(dir, "does-not-exist");
    const err = await assertRejects(
      () => resolveTemplatesDir(fakeEnv({ [OVERRIDE]: missing })),
      Error,
    );
    assertStringIncludes(err.message, OVERRIDE);
    assertStringIncludes(err.message, missing);
    assertStringIncludes(err.message, "not a directory");
  });
});

Deno.test("override pointing at a regular file (not a dir) is rejected", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "a-file");
    await Deno.writeTextFile(file, "not a directory");
    const err = await assertRejects(
      () => resolveTemplatesDir(fakeEnv({ [OVERRIDE]: file })),
      Error,
    );
    assertStringIncludes(err.message, "not a directory");
    assertStringIncludes(err.message, file);
  });
});

Deno.test("with no override, the walk-up discovers the repo's real templates/", async () => {
  // An empty fake env carries no override, so the walk-up path is taken: walking
  // up from src/lib/paths.ts lands on the repo's own templates/. Compare via
  // realPath so a symlinked tmp/checkout root can't cause a spurious mismatch.
  const resolved = await resolveTemplatesDir(fakeEnv());
  assert(
    (await Deno.realPath(resolved)) === (await Deno.realPath(REAL_TEMPLATES)),
    `expected ${REAL_TEMPLATES}, got ${resolved}`,
  );
});

Deno.test("resolveWorktreeRoot: an empty [worktree].root ⇒ a sibling of the repo", () => {
  // The default places worktrees in "<repo>.worktrees" — adjacent, NOT nested
  // inside the checkout (the anti-pattern this convention exists to avoid).
  assertEquals(
    resolveWorktreeRoot("/a/b/myrepo", configWithRoot("")),
    "/a/b/myrepo.worktrees",
  );
});

Deno.test("resolveWorktreeRoot: a relative root resolves against the repo root", () => {
  // The escape hatch that restores the old nested placement.
  assertEquals(
    resolveWorktreeRoot("/a/b/myrepo", configWithRoot(".claude/worktrees")),
    "/a/b/myrepo/.claude/worktrees",
  );
  // A custom sibling via `..` — join() normalises the traversal.
  assertEquals(
    resolveWorktreeRoot("/a/b/myrepo", configWithRoot("../wts")),
    "/a/b/wts",
  );
});

Deno.test("resolveWorktreeRoot: an absolute root is used as-is", () => {
  assertEquals(
    resolveWorktreeRoot("/a/b/myrepo", configWithRoot("/srv/worktrees")),
    "/srv/worktrees",
  );
});
