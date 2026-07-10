/**
 * Unit tests for the path resolvers in `src/lib/paths.ts`:
 *   - {@link resolveTemplatesDir} — auto-discovery of the scaffold `templates/`
 *     tree, via the `DISCERN_TEMPLATES_DIR` override (validated to be a real
 *     directory, else a clear throw) and a walk-up from the module's location.
 *   - {@link resolveWorktreeRoot} — the placement convention for new worktrees:
 *     the sibling default and the relative/absolute `[worktree].root` overrides.
 *   - {@link resolveGuidanceSources} — `[guidance].sources` expansion, and the
 *     guarantee that the compiler's own generated outputs are never admitted
 *     as sources.
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
import {
  resolveGuidanceSources,
  resolveTemplatesDir,
  resolveWorktreeRoot,
} from "../src/lib/paths.ts";
import { allGuidanceFilePaths } from "../src/lib/providers.ts";
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

Deno.test("resolveGuidanceSources: never admits a generated agent file, for any provider — glob or explicit", async () => {
  // The compiler's own OUTPUTS must never round-trip back in as sources: a
  // pattern like "*.md" that also matches the AGENTS.md discern just wrote
  // would make every refresh embed the previous compiled body (unbounded
  // growth) and the currency check permanently stale — a gate whose own
  // remediation (`discern refresh`) can never clear it. Enumerated from the
  // provider registry (allGuidanceFilePaths), so a future provider's guidance
  // file auto-enrols in this guard.
  const outputs = allGuidanceFilePaths();
  assert(outputs.length > 0, "the registry must emit guidance files");
  await withTempDir(async (root) => {
    for (const rel of outputs) {
      await Deno.writeTextFile(join(root, rel), "generated body\n");
    }
    await Deno.writeTextFile(join(root, "notes.md"), "# mine\n");

    // A glob matching everything at the root admits only the genuine source.
    const globbed = await resolveGuidanceSources(
      root,
      parseConfigOrThrow('[guidance]\nsources = ["*.md"]\n'),
    );
    assertEquals(globbed, [join(root, "notes.md")]);

    // Even listed EXPLICITLY, an output is refused — it cannot be a source.
    for (const rel of outputs) {
      const explicit = await resolveGuidanceSources(
        root,
        parseConfigOrThrow(`[guidance]\nsources = ["${rel}"]\n`),
      );
      assertEquals(explicit, [], `${rel} must never resolve as a source`);
    }

    // But a like-named file OUTSIDE the root-level output location is a
    // legitimate source (the exclusion is by path, not by basename).
    await Deno.mkdir(join(root, "notes"));
    const nested = join("notes", outputs[0] ?? "AGENTS.md");
    await Deno.writeTextFile(join(root, nested), "# nested notes\n");
    assertEquals(
      await resolveGuidanceSources(
        root,
        parseConfigOrThrow(`[guidance]\nsources = ["${nested}"]\n`),
      ),
      [join(root, nested)],
    );
  });
});
