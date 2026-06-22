/**
 * Engine coverage for the `discern bootstrap` / `bootstrap done` command pair
 * (ADR 0024) — driven through the real CLI so Cliffy parsing, the skeleton
 * scaffolding, the `done` validator, the `[meta].bootstrapped` marker, the setup
 * nudge, and the self-hiding from help are all exercised end-to-end.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine } from "./engine_helpers.ts";

/** The bootstrap command's help description — present in `--help` only when shown. */
const HELP_DESC = "Seed a freshly-installed harness from the project brief";

Deno.test("discern bootstrap lays the doc skeletons when absent and prints the instructions", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    assertEquals(await exists(join(dir, "docs")), false);

    const r = await runAgent(dir, ["bootstrap"]);
    assertEquals(r.code, 0, r.output);
    // The instructions are printed for the agent in the loop to act on.
    assertStringIncludes(r.stdout, "# Bootstrap the harness");
    assertStringIncludes(r.stdout, "Scaffolded docs/");
    // The skeleton tree is laid, with `{{project_name}}` substituted from the slug.
    assert(await exists(join(dir, "docs/00-orientation/design-principles.md")));
    const readme = await Deno.readTextFile(join(dir, "docs/README.md"));
    assertStringIncludes(readme, "Engine Test"); // slug "engine-test" → display name
    assert(!readme.includes("{{project_name}}"));

    // Re-running is non-destructive: docs/ now exists, so it is left untouched.
    const again = await runAgent(dir, ["bootstrap"]);
    assertStringIncludes(again.stdout, "Left your existing docs/");
  });
});

Deno.test("discern bootstrap never overwrites an existing docs/ tree (seamless DX)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "MY OWN DOCS\n");

    const r = await runAgent(dir, ["bootstrap"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Left your existing docs/");
    // The user's file is intact and no skeleton was laid over it.
    assertEquals(
      await Deno.readTextFile(join(dir, "docs/README.md")),
      "MY OWN DOCS\n",
    );
    assertEquals(await exists(join(dir, "docs/00-orientation")), false);
  });
});

Deno.test("discern bootstrap done refuses while skeleton markers remain; --force overrides", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await runAgent(dir, ["bootstrap"]); // lay the skeletons (markers present)

    const blocked = await runAgent(dir, ["bootstrap", "done"]);
    assertEquals(blocked.code, 1, blocked.output);
    assertStringIncludes(blocked.stderr, "not finished");
    assertStringIncludes(blocked.stderr, "design-principles.md");
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "the marker must not be set while validation fails",
    );

    const forced = await runAgent(dir, ["bootstrap", "done", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertStringIncludes(forced.stdout, "Bootstrap complete");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("the bootstrap nudge and the command retire once setup is recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    // Before: a work verb nudges (on stderr), and bootstrap shows in help.
    const preFinish = await runAgent(dir, ["finish"]);
    assertStringIncludes(preFinish.stderr, "isn't bootstrapped yet");
    const preHelp = await runAgent(dir, ["--help"]);
    assertStringIncludes(preHelp.stdout, HELP_DESC);

    // Bootstrap, then clear the skeleton markers so `done` validates cleanly.
    await runAgent(dir, ["bootstrap"]);
    await Deno.remove(join(dir, "docs"), { recursive: true });
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# Real docs\n");
    const done = await runAgent(dir, ["bootstrap", "done"]);
    assertEquals(done.code, 0, done.output);

    // After: no nudge on the same verb, and bootstrap is hidden from help.
    const postFinish = await runAgent(dir, ["finish"]);
    assert(!postFinish.stderr.includes("isn't bootstrapped yet"));
    const postHelp = await runAgent(dir, ["--help"]);
    assert(
      !postHelp.stdout.includes(HELP_DESC),
      "bootstrap should be hidden from help once recorded",
    );
  });
});

Deno.test("discern bootstrap is still callable with --force after it is recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await runAgent(dir, ["bootstrap"]);
    await runAgent(dir, ["bootstrap", "done", "--force"]);

    // Bare invocation now reports it is already done...
    const bare = await runAgent(dir, ["bootstrap"]);
    assertEquals(bare.code, 0, bare.output);
    assertStringIncludes(bare.stdout, "already bootstrapped");

    // ...but --force re-seeds (and reprints the instructions).
    const forced = await runAgent(dir, ["bootstrap", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertStringIncludes(forced.stdout, "# Bootstrap the harness");
  });
});

Deno.test("discern bootstrap --json emits structured output", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const r = await runAgent(dir, ["bootstrap", "--json"]);
    assertEquals(r.code, 0, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assert(res.scaffolded.includes("docs/"));
    assert(typeof res.instructions === "string" && res.instructions.length > 0);
  });
});
