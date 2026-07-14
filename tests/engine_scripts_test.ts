/**
 * Project script command tests: discovery, listing, execution, argument/env
 * forwarding, custom directories, and the retired root-command behavior.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { runProjectScriptAt } from "../src/engine/project_scripts.ts";

const SLUG_SCRIPT = `#!/usr/bin/env sh
# desc: print the project slug
printf 'SLUG=%s\\n' "$(discern config get project.slug)"
`;

Deno.test("script: a project script runs under the script command with its raw argument tail", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/deploy"),
      [
        "#!/usr/bin/env sh",
        "# desc: deploy the project",
        'printf \'ARGS=%s|%s|%s\\n\' "$1" "$2" "$3"',
        "",
      ].join("\n"),
    );

    const r = await runAgent(dir, [
      "script",
      "deploy",
      "--target",
      "staging",
      "--json",
    ]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "ARGS=--target|staging|--json");
  });
});

Deno.test("Project Script core runs in an explicitly selected worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/mark-cwd"),
      [
        "#!/usr/bin/env sh",
        "printf '%s\\n' \"$PWD\" > ran-from-here.txt",
        "",
      ].join("\n"),
    );

    assertEquals(
      await runProjectScriptAt(dir, "mark-cwd", [], { cwd: dir }),
      0,
    );
    const recorded = (await Deno.readTextFile(join(dir, "ran-from-here.txt")))
      .trim();
    assertEquals(await Deno.realPath(recorded), await Deno.realPath(dir));
  });
});

Deno.test("script and scripts list every executable project script in deterministic order", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/z-last"),
      "#!/usr/bin/env sh\necho last\n",
    );
    await writeExecutable(
      join(dir, "discern/scripts/a-first"),
      "#!/usr/bin/env sh\n# desc: first script\necho first\n",
    );
    await Deno.writeTextFile(
      join(dir, "discern/scripts/not-executable"),
      "#!/usr/bin/env sh\necho no\n",
    );

    for (const command of ["script", "scripts"]) {
      const r = await runAgent(dir, [command]);
      assertEquals(r.code, 0, r.output);
      assertStringIncludes(r.stdout, "Project scripts (from discern/scripts)");
      assertStringIncludes(r.stdout, "a-first");
      assertStringIncludes(r.stdout, "first script");
      assertStringIncludes(r.stdout, "z-last");
      assert(
        r.stdout.indexOf("a-first") < r.stdout.indexOf("z-last"),
        `${command} must sort script names:\n${r.stdout}`,
      );
      assert(
        !r.stdout.includes("not-executable"),
        `non-executable files are not listable:\n${r.stdout}`,
      );
    }
  });
});

Deno.test("script: --json lists project scripts as one structured result", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/hello"),
      "#!/usr/bin/env sh\n# desc: say hello\necho hi\n",
    );
    for (const args of [["--json", "script"], ["script", "--json"]]) {
      const r = await runAgent(dir, args);
      assertEquals(r.code, 0, r.output);
      const result = JSON.parse(r.stdout);
      assertEquals(result.ok, true);
      assertEquals(result.verb, "script");
      assertEquals(result.data.scripts, [{
        name: "hello",
        description: "say hello",
      }]);
    }
  });
});

Deno.test("script: a project script reads config and receives the script environment", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(join(dir, "discern/scripts/show-slug"), SLUG_SCRIPT);
    await writeExecutable(
      join(dir, "discern/scripts/show-env"),
      [
        "#!/usr/bin/env sh",
        "printf 'SCRIPTS=%s\\n' \"$DISCERN_SCRIPTS\"",
        "printf 'SCRIPTS_DIR=%s\\n' \"$DISCERN_SCRIPTS_DIR\"",
        "",
      ].join("\n"),
    );

    const slug = await runAgent(dir, ["script", "show-slug"]);
    assertEquals(slug.code, 0, slug.output);
    assertStringIncludes(slug.stdout, "SLUG=engine-test");

    const env = await runAgent(dir, ["script", "show-env"]);
    assertEquals(env.code, 0, env.output);
    assertStringIncludes(env.stdout, "/discern/scripts");
    assertStringIncludes(env.stdout, "SCRIPTS_DIR=discern/scripts");
    assert(!env.stdout.includes("RECIPES="), env.output);
  });
});

Deno.test("script: project scripts retain normal executable shell behavior", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(join(dir, "glob-fixture/a.txt"), "a");
    await writeExecutable(join(dir, "glob-fixture/b.txt"), "b");
    await writeExecutable(
      join(dir, "discern/scripts/globby"),
      [
        "#!/usr/bin/env sh",
        "_n=0",
        'for _f in "$DISCERN_ROOT"/glob-fixture/*.txt; do',
        '    [ -e "$_f" ] || continue',
        "    _n=$((_n + 1))",
        "done",
        "printf 'GLOB_COUNT=%s\\n' \"$_n\"",
        "",
      ].join("\n"),
    );
    const r = await runAgent(dir, ["script", "globby"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "GLOB_COUNT=2");
  });
});

Deno.test("script: an existing non-executable file is reported, not run", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.mkdir(join(dir, "discern/scripts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/scripts/deploy"),
      "#!/usr/bin/env sh\necho deployed\n",
    );
    const r = await runAgent(dir, ["script", "deploy"]);
    assertEquals(r.code, 1);
    assertStringIncludes(
      r.stderr,
      'script "deploy" exists but is not executable',
    );
    assertStringIncludes(r.stderr, "chmod +x");
  });
});

Deno.test("script: [scripts].dir relocates the project scripts directory", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[scripts]",
        'dir = "tools"',
        "",
      ].join("\n"),
    );
    await writeExecutable(
      join(dir, "tools/build-thing"),
      "#!/usr/bin/env sh\n# desc: build a thing\necho BUILT-THE-THING\n",
    );

    const run = await runAgent(dir, ["script", "build-thing"]);
    assertEquals(run.code, 0, run.output);
    assertStringIncludes(run.stdout, "BUILT-THE-THING");
    const list = await runAgent(dir, ["script"]);
    assertStringIncludes(list.stdout, "Project scripts (from tools)");
  });
});

Deno.test("a former root-level project script is unknown and points to the namespace", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/deploy"),
      "#!/usr/bin/env sh\necho PROJECT-SCRIPT-RAN\n",
    );

    const exact = await runAgent(dir, ["deploy"]);
    assertEquals(exact.code, 1, exact.output);
    assert(!exact.output.includes("PROJECT-SCRIPT-RAN"), exact.output);
    assertStringIncludes(exact.stderr, "Did you mean `discern script deploy`?");

    const typo = await runAgent(dir, ["deplyo"]);
    assertEquals(typo.code, 1, typo.output);
    assertStringIncludes(typo.stderr, "Did you mean `discern script deploy`?");
  });
});
