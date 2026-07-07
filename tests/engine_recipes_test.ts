/**
 * Engine tests for project-owned recipes (ADR 0001).
 *
 * `agent` resolves the kit-managed engine first, then an unmanaged
 * project-recipes dir (`[recipes].dir`, default `recipes`). These tests
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
printf 'SLUG=%s\\n' "$(discern config get project.slug)"
`;

Deno.test("recipes: a project recipe runs via agent <name>", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/recipes/hello"),
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
      join(dir, "discern/recipes/hello"),
      "#!/usr/bin/env sh\n# desc: say hello\necho hi\n",
    );
    const r = await runAgent(dir, ["--help"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Project recipes");
    assertStringIncludes(r.stdout, "hello");
    assertStringIncludes(r.stdout, "say hello");
  });
});

Deno.test("recipes: a project recipe reads config via discern config get", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(join(dir, "discern/recipes/show-slug"), SLUG_RECIPE);
    const r = await runAgent(dir, ["show-slug"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "SLUG=engine-test");
  });
});

Deno.test("recipes: a project recipe uses normal shell globbing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Files for the recipe to glob over.
    await writeExecutable(join(dir, "glob-fixture/a.txt"), "a");
    await writeExecutable(join(dir, "glob-fixture/b.txt"), "b");
    await writeExecutable(join(dir, "glob-fixture/c.txt"), "c");
    // A project recipe is a standalone executable with normal shell globbing —
    // the exact shape of a native sub-app recipe like `ls "$dir"/*.xcodeproj`. It
    // reads DISCERN_ROOT from the environment the dispatcher exports.
    await writeExecutable(
      join(dir, "discern/recipes/globby"),
      [
        "#!/usr/bin/env sh",
        "# desc: count files via a shell glob",
        "_n=0",
        'for _f in "$DISCERN_ROOT"/glob-fixture/*.txt; do',
        '    [ -e "$_f" ] || continue',
        "    _n=$((_n + 1))",
        "done",
        "printf 'GLOB_COUNT=%s\\n' \"$_n\"",
        "",
      ].join("\n"),
    );
    const r = await runAgent(dir, ["globby"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "GLOB_COUNT=3");
  });
});

Deno.test("recipes: a name colliding with an engine recipe is shadowed (engine wins)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // A project recipe named `finish` must NOT override the gate.
    await writeExecutable(
      join(dir, "discern/recipes/finish"),
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
      join(dir, "discern/recipes/finish"),
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
    // The recipes dir is opt-in (no longer scaffolded), so create it before
    // dropping a non-executable file straight in (writeExecutable would chmod +x).
    await Deno.mkdir(join(dir, "discern/recipes"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/recipes/deploy"),
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

Deno.test("recipes: DISCERN_RECIPES is exported into a recipe's environment", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/recipes/show-recipes-dir"),
      "#!/usr/bin/env sh\n# desc: print the recipes dir\nprintf 'RECIPES=%s\\n' \"$DISCERN_RECIPES\"\n",
    );
    const r = await runAgent(dir, ["show-recipes-dir"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "/recipes");
  });
});

Deno.test("recipes: an unknown verb suggests a near-match project recipe", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/recipes/deploy"),
      "#!/usr/bin/env sh\n# desc: deploy\necho deployed\n",
    );
    const r = await runAgent(dir, ["deplyo"]); // transposed typo
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "deploy");
  });
});
