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
    // The bootstrap assets are binary-embedded, never seeded into the project
    // (ADR 0024): a fresh install must not carry a `bootstrap/` tree.
    assertEquals(await exists(join(dir, "bootstrap")), false);

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

Deno.test("the nudge fires on work verbs but not on plumbing verbs", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // unbootstrapped
    const finish = await runAgent(dir, ["finish"]);
    assertStringIncludes(finish.stderr, "isn't bootstrapped yet");
    // `refresh` is machinery (and `discern bootstrap` itself runs it) — no nudge,
    // so the reminder never leaks into the regen/hook path.
    const refresh = await runAgent(dir, ["refresh"]);
    assert(!refresh.stderr.includes("isn't bootstrapped yet"));
  });
});

Deno.test("an unparseable config surfaces its TOML error without the bootstrap nudge", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // unbootstrapped
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "this is = not valid toml [[[\n",
    );
    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 1, r.output);
    assert(
      !r.stderr.includes("isn't bootstrapped yet"),
      "the nudge must not bury the real TOML parse error",
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

Deno.test("discern bootstrap done ignores a real doc that merely mentions EXAMPLE", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A genuine doc (no skeleton) that happens to contain the bare word EXAMPLE
    // and an open paren — the validator must not mistake it for the skeleton's
    // `_(EXAMPLE — replace during ...)_` placeholder heading.
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(
      join(dir, "docs/README.md"),
      "# Docs\n\nSee the sample config (EXAMPLE) in the appendix.\n",
    );
    const done = await runAgent(dir, ["bootstrap", "done"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
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
