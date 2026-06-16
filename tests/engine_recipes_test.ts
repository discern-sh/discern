/**
 * Engine tests for project-owned recipes (ADR 0001).
 *
 * `bin/agent` resolves the kit-managed engine first, then an unmanaged
 * project-recipes dir (`[recipes].dir`, default `.icculus/recipes`). These tests
 * drive the real dispatcher: a project recipe runs and lists in --help; a
 * name-collision is shadowed (engine wins) with a warning; a relocated dir is
 * honoured; and a recipe can use the engine library.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";

const SLUG_RECIPE = `#!/usr/bin/env sh
# desc: print the project slug
. "$ICCULUS_LIB/bootstrap.sh"
printf 'SLUG=%s\\n' "$(config_get project.slug)"
`;

Deno.test("recipes: a project recipe runs via agent <name>", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, ".icculus/recipes/hello"),
      "#!/usr/bin/env sh\n# desc: say hello\necho HELLO-FROM-PROJECT\n",
    );
    const r = await runAgent(dir, ["hello"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "HELLO-FROM-PROJECT");
  });
});

Deno.test("recipes: a project recipe is listed under --help", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, ".icculus/recipes/hello"),
      "#!/usr/bin/env sh\n# desc: say hello\necho hi\n",
    );
    const r = await runAgent(dir, ["--help"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Project recipes");
    assertStringIncludes(r.stdout, "hello");
    assertStringIncludes(r.stdout, "say hello");
  });
});

Deno.test("recipes: a project recipe can source the engine library", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(join(dir, ".icculus/recipes/show-slug"), SLUG_RECIPE);
    const r = await runAgent(dir, ["show-slug"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "SLUG=engine-test");
  });
});

Deno.test("recipes: a name colliding with an engine recipe is shadowed (engine wins)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A project recipe named `finish` must NOT override the gate.
    await writeExecutable(
      join(dir, ".icculus/recipes/finish"),
      "#!/usr/bin/env sh\n# desc: not the real finish\necho PROJECT-FINISH-RAN\n",
    );
    const r = await runAgent(dir, ["finish"]);
    // The engine finish ran (no-op gate), not the project file.
    assert(
      !r.output.includes("PROJECT-FINISH-RAN"),
      "the shadowed project recipe must not run",
    );
    assertStringIncludes(r.stdout, "no-op");
    assertStringIncludes(r.stderr, "shadowed");
  });
});

Deno.test("recipes: a shadowed name is omitted from the --help project listing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, ".icculus/recipes/finish"),
      "#!/usr/bin/env sh\n# desc: not the real finish\necho hi\n",
    );
    const r = await runAgent(dir, ["--help"]);
    assertEquals(r.code, 0, r.output);
    // The only `finish` shown is the engine's; no "Project recipes" group for it.
    assert(
      !r.stdout.includes("Project recipes"),
      "a solely-shadowed dir should produce no project-recipes group",
    );
  });
});

Deno.test("recipes: a non-executable project recipe is reported, not run", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.writeTextFile(
      join(dir, ".icculus/recipes/deploy"),
      "#!/usr/bin/env sh\n# desc: deploy\necho deployed\n",
    );
    // No chmod +x.
    const r = await runAgent(dir, ["deploy"]);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "not executable");
  });
});

Deno.test("recipes: [recipes].dir relocates the project recipes directory", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'branch_prefix = "agent/"',
        'main_branch = "main"',
        'agents = ["claude_code"]',
        "",
        "[recipes]",
        'dir = "tools"',
        "",
      ].join("\n"),
    );
    await writeExecutable(
      join(dir, "tools/build-thing"),
      "#!/usr/bin/env sh\n# desc: build a thing\necho BUILT-THE-THING\n",
    );
    const r = await runAgent(dir, ["build-thing"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "BUILT-THE-THING");

    const help = await runAgent(dir, ["--help"]);
    assertStringIncludes(help.stdout, "Project recipes (from tools)");
  });
});

Deno.test("recipes: an unknown verb suggests a near-match project recipe", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, ".icculus/recipes/deploy"),
      "#!/usr/bin/env sh\n# desc: deploy\necho deployed\n",
    );
    const r = await runAgent(dir, ["deplyo"]); // transposed typo
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "deploy");
  });
});
