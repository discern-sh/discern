/**
 * Engine test for the worktree adapter RUNTIME tokens (`@db@`, `@site@`, …).
 *
 * 1.0 moved these off the `{{…}}` delimiter (which the installer owns for
 * content tokens) onto `@…@`, so the two layers can't collide and the installer
 * needs no pass-through special-case. This drives `wt_expand_tokens` through a
 * tiny project recipe and asserts the new delimiter expands while the old one is
 * left literal.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

const PROBE = `#!/usr/bin/env sh
# desc: probe worktree token expansion
. "$(dirname "$0")/../engine/lib/bootstrap.sh"
. "$ICCULUS_LIB/worktree.sh"
wt_expand_tokens "new=@project_slug@ old={{project_slug}}"
printf '\\n'
`;

Deno.test("worktree tokens: @project_slug@ expands; the old {{project_slug}} does not", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'main_branch = "main"',
        "",
        "[scopes]",
        'neutral = ["docs/"]',
        'web = ["src/**"]',
        "",
      ].join("\n"),
    );
    await writeExecutable(join(dir, ".icculus/recipes/probe"), PROBE);

    const r = await runAgent(dir, ["probe"]);
    assertEquals(r.code, 0, r.output);
    // The @…@ runtime token resolves to the slug...
    assertStringIncludes(r.stdout, "new=engine-test");
    // ...while a stray {{…}} is NOT a runtime token: left exactly as written.
    assertStringIncludes(r.stdout, "old={{project_slug}}");
  });
});
