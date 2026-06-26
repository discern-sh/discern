/**
 * Unit tests for the path resolvers in `src/lib/paths.ts`:
 *   - {@link resolveTemplatesDir} — auto-discovery of the scaffold `templates/`
 *     tree, via the `DISCERN_TEMPLATES_DIR` override (validated to be a real
 *     directory, else a clear throw) and a walk-up from the module's location.
 *   - {@link resolveWorktreeRoot} — the placement convention for new worktrees:
 *     the sibling default and the relative/absolute `[worktree].root` overrides.
 *
 * Each env-touching test owns its env: the override is saved and restored so the
 * suite's parallel tests do not leak state into one another.
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
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";

/** A fully-defaulted config carrying the given `[worktree].root` (empty ⇒ default). */
function configWithRoot(root: string): ReturnType<typeof parseConfigOrThrow> {
  return parseConfigOrThrow(root === "" ? "" : `[worktree]\nroot = "${root}"\n`);
}

const OVERRIDE = "DISCERN_TEMPLATES_DIR";

/** Run `fn` with `DISCERN_TEMPLATES_DIR` set to `value`, restoring it after. */
async function withOverride(
  value: string,
  fn: () => Promise<void>,
): Promise<void> {
  const had = Deno.env.get(OVERRIDE);
  Deno.env.set(OVERRIDE, value);
  try {
    await fn();
  } finally {
    if (had === undefined) Deno.env.delete(OVERRIDE);
    else Deno.env.set(OVERRIDE, had);
  }
}

/** Run `fn` with `DISCERN_TEMPLATES_DIR` removed, restoring it after. */
async function withoutOverride(fn: () => Promise<void>): Promise<void> {
  const had = Deno.env.get(OVERRIDE);
  Deno.env.delete(OVERRIDE);
  try {
    await fn();
  } finally {
    if (had !== undefined) Deno.env.set(OVERRIDE, had);
  }
}

Deno.test("override pointing at a real directory is returned verbatim", async () => {
  await withTempDir(async (dir) => {
    await withOverride(dir, async () => {
      assert((await resolveTemplatesDir()) === dir);
    });
  });
});

Deno.test("override pointing at a non-existent path throws a clear, named error", async () => {
  await withTempDir(async (dir) => {
    const missing = join(dir, "does-not-exist");
    await withOverride(missing, async () => {
      const err = await assertRejects(
        () => resolveTemplatesDir(),
        Error,
      );
      assertStringIncludes(err.message, OVERRIDE);
      assertStringIncludes(err.message, missing);
      assertStringIncludes(err.message, "not a directory");
    });
  });
});

Deno.test("override pointing at a regular file (not a dir) is rejected", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "a-file");
    await Deno.writeTextFile(file, "not a directory");
    await withOverride(file, async () => {
      const err = await assertRejects(() => resolveTemplatesDir(), Error);
      assertStringIncludes(err.message, "not a directory");
      assertStringIncludes(err.message, file);
    });
  });
});

Deno.test("with no override, the walk-up discovers the repo's real templates/", async () => {
  await withoutOverride(async () => {
    const resolved = await resolveTemplatesDir();
    // Walking up from src/lib/paths.ts lands on the repo's own templates/.
    // Compare via realPath so a symlinked tmp/checkout root can't cause a
    // spurious string mismatch.
    assert(
      (await Deno.realPath(resolved)) === (await Deno.realPath(REAL_TEMPLATES)),
      `expected ${REAL_TEMPLATES}, got ${resolved}`,
    );
  });
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
