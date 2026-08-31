/**
 * Project script command tests: discovery, listing, execution, argument/env
 * forwarding, custom directories, and the retired root-command behavior.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  inspectDeskProjectScriptsWithConfig,
  runProjectScriptAt,
} from "../src/engine/project_scripts.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";

const SLUG_SCRIPT = `#!/usr/bin/env sh
# desc: print the project slug
printf 'SLUG=%s\\n' "$(discern config get project.slug)"
`;

Deno.test("scripts: a project script runs under the script command with its raw argument tail", async () => {
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
      "scripts",
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

Deno.test("Desk script discovery retains a non-executable command with safely quoted recovery", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const config = await loadConfig(dir);
    const initial = await inspectDeskProjectScriptsWithConfig(dir, config);
    await Deno.mkdir(initial.directory, { recursive: true });
    const path = join(initial.directory, "$release task");
    await Deno.writeTextFile(path, "#!/usr/bin/env sh\n");

    const inventory = await inspectDeskProjectScriptsWithConfig(
      dir,
      config,
    );
    const script = inventory.scripts.find((candidate) =>
      candidate.name === "$release task"
    );
    assert(script !== undefined);
    assertEquals(script.availability, "disabled");
    assertStringIncludes(
      script.reason ?? "",
      `chmod +x '${path}'`,
    );
  });
});

Deno.test("Desk script discovery does not offer the executable bit to a module", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const config = await loadConfig(dir);
    const initial = await inspectDeskProjectScriptsWithConfig(dir, config);
    await Deno.mkdir(initial.directory, { recursive: true });
    const path = join(initial.directory, "matcher.ts");
    await Deno.writeTextFile(path, 'import { thing } from "./other.ts";\n');

    const inventory = await inspectDeskProjectScriptsWithConfig(dir, config);
    const script = inventory.scripts.find((candidate) =>
      candidate.name === "matcher.ts"
    );
    assert(script !== undefined);
    assertEquals(script.availability, "disabled");
    assertStringIncludes(script.reason ?? "", "names no interpreter");
    // Setting the bit would list a command that still cannot run, so the
    // remedy must send the author out of the directory instead.
    assertEquals(script.reason?.includes("chmod") ?? false, false);
  });
});

Deno.test("scripts lists every executable project script in deterministic order", async () => {
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

    const r = await runAgent(dir, ["scripts"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(
      r.stdout,
      "Project scripts (from discern/scripts)",
    );
    assertStringIncludes(r.stdout, "a-first");
    assertTerminalTextIncludes(r.stdout, "first script");
    assertStringIncludes(r.stdout, "z-last");
    assert(
      r.stdout.indexOf("a-first") < r.stdout.indexOf("z-last"),
      `scripts must sort script names:\n${r.stdout}`,
    );
    assert(
      !r.stdout.includes("not-executable"),
      `non-executable files are not listable:\n${r.stdout}`,
    );
  });
});

Deno.test("script (singular) folds silently to the scripts dispatch", async () => {
  // The singular is an accepted input variant, not a retired command: typed
  // input folds to the canonical verb with no notice, while every surface
  // discern writes spells `scripts` (the term registry bans the singular
  // invocation from written surfaces, and verb parity pins the registration).
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/deploy"),
      "#!/usr/bin/env sh\n# desc: deploy\necho SINGULAR-RAN-$1\n",
    );

    // Running one script through the singular dispatches it, arguments intact.
    const run = await runAgent(dir, ["script", "deploy", "staging"]);
    assertEquals(run.code, 0, run.output);
    assertStringIncludes(run.stdout, "SINGULAR-RAN-staging");

    // The bare singular reaches the same listing, and the envelope carries the
    // canonical verb — folding rewrites the spelling before dispatch.
    const list = await runAgent(dir, ["script", "--json"]);
    assertEquals(list.code, 0, list.output);
    const envelope = decodeCliResult(list.stdout, "scripts");
    assertResultDataKey(envelope, "scripts");
    assertEquals(envelope.verb, "scripts");
    assertEquals(envelope.data.scripts, [{
      name: "deploy",
      description: "deploy",
    }]);
  });
});

Deno.test("scripts: --json lists project scripts as one structured result", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      join(dir, "discern/scripts/hello"),
      "#!/usr/bin/env sh\n# desc: say hello\necho hi\n",
    );
    for (const args of [["--json", "scripts"], ["scripts", "--json"]]) {
      const r = await runAgent(dir, args);
      assertEquals(r.code, 0, r.output);
      const result = decodeCliResult(r.stdout, "scripts");
      assertResultDataKey(result, "scripts");
      assertEquals(result.ok, true);
      assertEquals(result.verb, "scripts");
      assertEquals(result.data.scripts, [{
        name: "hello",
        description: "say hello",
      }]);
    }
  });
});

Deno.test("scripts: a project script reads config and receives the script environment", async () => {
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

    const slug = await runAgent(dir, ["scripts", "show-slug"]);
    assertEquals(slug.code, 0, slug.output);
    assertStringIncludes(slug.stdout, "SLUG=engine-test");

    const env = await runAgent(dir, ["scripts", "show-env"]);
    assertEquals(env.code, 0, env.output);
    assertStringIncludes(env.stdout, "/discern/scripts");
    assertStringIncludes(env.stdout, "SCRIPTS_DIR=discern/scripts");
    assert(!env.stdout.includes("RECIPES="), env.output);
  });
});

Deno.test("scripts: project scripts retain normal executable shell behavior", async () => {
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
    const r = await runAgent(dir, ["scripts", "globby"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "GLOB_COUNT=2");
  });
});

Deno.test("scripts: child flags cannot select discern global modes", async () => {
  await withTempDir(async (dir) => {
    await writeConfig(dir, "[project\n");
    const result = await runAgent(dir, ["scripts", "unreached", "--json"]);
    assertEquals(result.code, 1, result.output);
    assertEquals(result.stdout, "");
    assertTerminalTextIncludes(result.stderr, "syntax error near line 1");
  });
});

Deno.test("scripts: a missing project script keeps the scripts JSON contract", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const result = await runAgent(dir, ["--json", "scripts", "missing"]);
    assertEquals(result.code, 1, result.output);
    const envelope = decodeCliResult(result.stdout, "scripts");
    assertEquals(envelope.verb, "scripts");
    assertEquals(envelope.error, "unknown_command");
    assertEquals(envelope.message, 'unknown command "scripts missing".');
    assertHasHint(envelope, HINTS["unknown-command-help"]);
  });
});

Deno.test("scripts: an existing non-executable file is reported, not run", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.mkdir(join(dir, "discern/scripts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/scripts/deploy"),
      "#!/usr/bin/env sh\necho deployed\n",
    );
    const r = await runAgent(dir, ["scripts", "deploy"]);
    assertEquals(r.code, 1);
    assertTerminalTextIncludes(
      r.stderr,
      'script "deploy" exists but is not executable',
    );
    assertTerminalTextIncludes(r.stderr, "chmod +x");
  });
});

Deno.test("scripts: a file that names no interpreter is not offered the executable bit", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.mkdir(join(dir, "discern/scripts"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/scripts/matcher.ts"),
      'import { thing } from "./other.ts";\nthing();\n',
    );
    const r = await runAgent(dir, ["scripts", "matcher.ts"]);
    assertEquals(r.code, 1);
    assertTerminalTextIncludes(
      r.stderr,
      'script "matcher.ts" is not a runnable Project Script',
    );
    assertTerminalTextIncludes(r.stderr, "names no interpreter");
    assertEquals(
      r.stderr.includes("chmod +x"),
      false,
      "setting the bit would leave a listed command that still cannot run",
    );
  });
});

Deno.test("scripts: [scripts].dir relocates the project scripts directory", async () => {
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

    const run = await runAgent(dir, ["scripts", "build-thing"]);
    assertEquals(run.code, 0, run.output);
    assertStringIncludes(run.stdout, "BUILT-THE-THING");
    const list = await runAgent(dir, ["scripts"]);
    assertTerminalTextIncludes(list.stdout, "Project scripts (from tools)");
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
    assertTerminalTextIncludes(
      exact.stderr,
      "Did you mean `discern scripts deploy`?",
    );

    const typo = await runAgent(dir, ["deplyo"]);
    assertEquals(typo.code, 1, typo.output);
    assertTerminalTextIncludes(
      typo.stderr,
      "Did you mean `discern scripts deploy`?",
    );
  });
});
