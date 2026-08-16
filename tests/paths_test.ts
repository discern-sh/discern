/**
 * Unit tests for the path resolvers in `src/lib/paths.ts`:
 *   - {@link resolveTemplatesDir} — auto-discovery of the scaffold `templates/`
 *     tree, via the `DISCERN_TEMPLATES_DIR` override (validated to be a real
 *     directory, else a clear throw) and a walk-up from the module's location.
 *   - {@link resolveConfigPath} — root `discern.toml` as the sole install
 *     marker.
 *   - {@link resolveWorktreeRoot} — the placement convention for new worktrees:
 *     the sibling default and the relative/absolute `[worktree].root` overrides.
 *   - {@link resolveInstructionSources} — `[instructions].sources` expansion, and the
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
import { dirname, join } from "@std/path";
import {
  resolveConfigPath,
  resolveInstructionSources,
  resolveTemplatesDir,
  resolveWorktreeRoot,
} from "../src/lib/paths.ts";
import { allInstructionFilePaths } from "../src/lib/providers.ts";
import { CONFIG_REL, findRoot, installedConfigRel } from "../src/shared/env.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { fakeEnv, REAL_TEMPLATES, withTempDir } from "./helpers.ts";

/** A fully-defaulted config carrying the given `[worktree].root` (empty ⇒ default). */
function configWithRoot(root: string): ReturnType<typeof parseConfigOrThrow> {
  return parseConfigOrThrow(
    root === "" ? "" : `[worktree]\nroot = "${root}"\n`,
  );
}

const OVERRIDE = "DISCERN_TEMPLATES_DIR";

Deno.test("root discern.toml is the only install marker", async () => {
  await withTempDir(async (dir) => {
    const nested = join(dir, "nested");
    await Deno.mkdir(join(dir, ".discern"), { recursive: true });
    await Deno.mkdir(nested);
    await Deno.writeTextFile(
      join(dir, ".discern/config.toml"),
      "[meta]\nschema_version = 24\n",
    );

    assertEquals(await installedConfigRel(dir), undefined);
    assertEquals(await resolveConfigPath(dir), undefined);
    assertEquals(await findRoot(nested), undefined);

    await Deno.writeTextFile(
      join(dir, CONFIG_REL),
      "[meta]\nschema_version = 1\n",
    );
    assertEquals(await installedConfigRel(dir), CONFIG_REL);
    assertEquals(await resolveConfigPath(dir), join(dir, CONFIG_REL));
    assertEquals(await findRoot(nested), dir);
  });
});

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

Deno.test("resolveInstructionSources: a root whose path contains glob metacharacters still compiles its instructions", async () => {
  // The class: a user-controlled path segment (the absolute project root) fed
  // into a pattern language. Building the glob as `join(root, pattern)` parses
  // the root itself as glob syntax, so a directory named `re[po]` / `pr{o}j` /
  // `pa(re)n` / `my app` / `star*` matches NOTHING — the compile then proceeds
  // with zero user instructions and no error. The `root` option keeps the root
  // literal; this parameterises over every metacharacter family so a regression
  // in any one of them fails here. The pre-fix code fails EVERY case.
  const families = ["re[po]", "pr{o}j", "pa(re)n", "my app", "star*name"];
  for (const name of families) {
    await withTempDir(async (parent) => {
      const root = join(parent, name);
      await Deno.mkdir(root);

      // The registry's default source lives at a nested path (`discern/…`); seed
      // it so the no-config (default sources) case has a file to find.
      const defaultRel = SOURCE_PATHS.instructions.defaultPath;
      const defaultAbs = join(root, defaultRel);
      await Deno.mkdir(join(root, dirname(defaultRel)), { recursive: true });
      await Deno.writeTextFile(defaultAbs, "# real instructions\n");
      // And a root-level file for the explicit-glob case.
      const rootLevel = join(root, "notes.md");
      await Deno.writeTextFile(rootLevel, "# more instructions\n");

      // Default sources (no config): the registry instruction path resolves under
      // the awkward root.
      assertEquals(
        await resolveInstructionSources(root, parseConfigOrThrow("")),
        [defaultAbs],
        `default sources dropped under root '${name}'`,
      );

      // An explicit glob pattern also resolves files under the awkward root.
      assertEquals(
        await resolveInstructionSources(
          root,
          parseConfigOrThrow('[instructions]\nsources = ["*.md"]\n'),
        ),
        [rootLevel],
        `glob '*.md' dropped under root '${name}'`,
      );
    });
  }
});

Deno.test("resolveInstructionSources: never admits an agent file, for any provider — glob or explicit", async () => {
  // The compiler's own OUTPUTS must never round-trip back in as sources: a
  // pattern like "*.md" that also matches the AGENTS.md discern just wrote
  // would make every refresh embed the previous compiled body (unbounded
  // growth) and the currency check permanently stale — a gate whose own
  // remediation (`discern refresh`) can never clear it. Enumerated from the
  // provider registry (allInstructionFilePaths), so a future provider's instructions
  // file auto-enrols in this guard.
  const outputs = allInstructionFilePaths();
  assert(outputs.length > 0, "the registry must emit instruction files");
  await withTempDir(async (root) => {
    for (const rel of outputs) {
      await Deno.writeTextFile(join(root, rel), "generated body\n");
    }
    await Deno.writeTextFile(join(root, "notes.md"), "# mine\n");

    // A glob matching everything at the root admits only the genuine source.
    const globbed = await resolveInstructionSources(
      root,
      parseConfigOrThrow('[instructions]\nsources = ["*.md"]\n'),
    );
    assertEquals(globbed, [join(root, "notes.md")]);

    // Even listed EXPLICITLY, an output is refused — it cannot be a source.
    for (const rel of outputs) {
      const explicit = await resolveInstructionSources(
        root,
        parseConfigOrThrow(`[instructions]\nsources = ["${rel}"]\n`),
      );
      assertEquals(explicit, [], `${rel} must never resolve as a source`);
    }

    // But a like-named file OUTSIDE the root-level output location is a
    // legitimate source (the exclusion is by path, not by basename).
    await Deno.mkdir(join(root, "notes"));
    const nested = join("notes", outputs[0] ?? "AGENTS.md");
    await Deno.writeTextFile(join(root, nested), "# nested notes\n");
    assertEquals(
      await resolveInstructionSources(
        root,
        parseConfigOrThrow(`[instructions]\nsources = ["${nested}"]\n`),
      ),
      [join(root, nested)],
    );
  });
});
