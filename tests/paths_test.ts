/**
 * Unit tests for {@link resolveTemplatesDir} — the auto-discovery of the
 * scaffold `templates/` tree.
 *
 * Two resolution paths exist: an `ICCULUS_TEMPLATES_DIR` override (validated to
 * be a real directory, else a clear throw) and a walk-up from the module's own
 * location. We drive the override branch in both directions — a valid dir is
 * returned verbatim, a non-directory is rejected with a message that names the
 * escape hatch — and confirm the walk-up finds the repo's real `templates/` when
 * no override is present.
 *
 * Each test owns its env: the override is saved and restored so the suite's
 * parallel tests do not leak state into one another.
 */

import { assert, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { resolveTemplatesDir } from "../src/lib/paths.ts";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";

const OVERRIDE = "ICCULUS_TEMPLATES_DIR";

/** Run `fn` with `ICCULUS_TEMPLATES_DIR` set to `value`, restoring it after. */
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

/** Run `fn` with `ICCULUS_TEMPLATES_DIR` removed, restoring it after. */
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
