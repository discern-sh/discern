/**
 * Engine coverage for the unified `discern setup` / `setup done` command pair
 * (ADR 0036) — driven through the real CLI so Cliffy parsing, the skeleton
 * scaffolding, the `done` validator, the `[meta].bootstrapped` marker, the pre-setup
 * hard redirect, the bare-`discern` setup trigger, the `init`/`bootstrap` back-compat
 * redirect, and the self-hiding from help are all exercised end-to-end.
 *
 * `scaffoldEngine` marks the install set up by default, so these tests pass
 * `{ bootstrapped: false }` whenever they need the un-set-up state.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import { gitInit, runAgent, scaffoldEngine } from "./engine_helpers.ts";

/** The H1 of the printed setup instructions (templates/setup/instructions.md). */
const INSTRUCTIONS_H1 = "# Set up the harness";
/** The setup command's help description — present in `--help` only when shown. */
const HELP_DESC = "Set up the harness here";

Deno.test("discern setup lays the doc skeletons when absent and prints the instructions", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    assertEquals(await exists(join(dir, "docs")), false);
    // The setup assets are binary-embedded, never seeded into the project (ADR
    // 0024/0036): a fresh install must carry neither a `setup/` nor `bootstrap/` tree.
    assertEquals(await exists(join(dir, "setup")), false);
    assertEquals(await exists(join(dir, "bootstrap")), false);

    const r = await runAgent(dir, ["setup"]);
    assertEquals(r.code, 0, r.output);
    // The instructions are printed for the agent in the loop to act on.
    assertStringIncludes(r.stdout, INSTRUCTIONS_H1);
    assertStringIncludes(r.stdout, "Scaffolded docs/");
    // The skeleton tree is laid, with `{{project_name}}` substituted from the slug.
    assert(await exists(join(dir, "docs/00-orientation/design-principles.md")));
    const readme = await Deno.readTextFile(join(dir, "docs/README.md"));
    assertStringIncludes(readme, "Engine Test"); // slug "engine-test" → display name
    assert(!readme.includes("{{project_name}}"));

    // Re-running is non-destructive: docs/ now exists, so it is left untouched.
    const again = await runAgent(dir, ["setup"]);
    assertStringIncludes(again.stdout, "Left your existing docs/");
  });
});

Deno.test("discern setup never overwrites an existing docs/ tree (seamless DX)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "MY OWN DOCS\n");

    const r = await runAgent(dir, ["setup"]);
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

Deno.test("discern setup done refuses while skeleton markers remain; --force overrides", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup"]); // lay the skeletons (markers present)

    const blocked = await runAgent(dir, ["setup", "done"]);
    assertEquals(blocked.code, 1, blocked.output);
    assertStringIncludes(blocked.stderr, "not finished");
    assertStringIncludes(blocked.stderr, "design-principles.md");
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "the marker must not be set while validation fails",
    );

    const forced = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertStringIncludes(forced.stdout, "Setup complete");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("the setup redirect and the command retire once setup is recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });

    // Before: a work verb hard-redirects (exit≠0, on stderr), and setup shows in help.
    const preFinish = await runAgent(dir, ["finish"]);
    assertEquals(preFinish.code, 1, preFinish.output);
    assertStringIncludes(preFinish.stderr, "isn't set up yet");
    const preHelp = await runAgent(dir, ["--help"]);
    assertStringIncludes(preHelp.stdout, HELP_DESC);

    // Set up, then clear the skeleton markers so `done` validates cleanly.
    await runAgent(dir, ["setup"]);
    await Deno.remove(join(dir, "docs"), { recursive: true });
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# Real docs\n");
    const done = await runAgent(dir, ["setup", "done"]);
    assertEquals(done.code, 0, done.output);

    // After: the same verb runs (no redirect), and setup is hidden from help.
    const postFinish = await runAgent(dir, ["finish"]);
    assertEquals(postFinish.code, 0, postFinish.output);
    assert(!postFinish.stderr.includes("isn't set up yet"));
    const postHelp = await runAgent(dir, ["--help"]);
    assert(
      !postHelp.stdout.includes(HELP_DESC),
      "setup should be hidden from help once recorded",
    );
  });
});

Deno.test("the redirect fires on work verbs but not on plumbing verbs", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // un-set-up
    const finish = await runAgent(dir, ["finish"]);
    assertEquals(finish.code, 1, finish.output);
    assertStringIncludes(finish.stderr, "isn't set up yet");
    // `refresh` is machinery (and `discern setup` itself runs it) — no redirect,
    // so it never leaks into the regen/hook path.
    const refresh = await runAgent(dir, ["refresh"]);
    assert(!refresh.stderr.includes("isn't set up yet"));
    assertEquals(refresh.code, 0, refresh.output);
  });
});

Deno.test("docs is gated pre-setup but help is not", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // un-set-up

    // `docs` now redirects: there is no project doc tree to browse until setup
    // seeds and fills it.
    const docs = await runAgent(dir, ["docs", "--json"]);
    assertEquals(docs.code, 1, docs.output);
    assertEquals(JSON.parse(docs.stdout).error, "not_set_up");

    // `help` (discern's own documentation) stays open — it is exactly what you
    // consult at this point. It serves discern's bundled docs, not the project's.
    const help = await runAgent(dir, ["help", "--list"]);
    assertEquals(help.code, 0, help.output);
    assert(!help.stderr.includes("isn't set up yet"));
    assertStringIncludes(help.stdout, "discern help");
  });
});

Deno.test("the pre-setup redirect is a structured not_set_up result under --json", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["finish", "--json"]);
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "finish");
    assertEquals(res.error, "not_set_up");
  });
});

Deno.test("an unparseable config surfaces its TOML error without the setup redirect", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "this is = not valid toml [[[\n",
    );
    const r = await runAgent(dir, ["finish"]);
    assertEquals(r.code, 1, r.output);
    assert(
      !r.stderr.includes("isn't set up yet"),
      "the redirect must not bury the real TOML parse error",
    );
  });
});

Deno.test("bare `discern` runs setup in an un-set-up project, but shows help once set up", async () => {
  await withTempDir(async (dir) => {
    // Un-set-up project: bare `discern` is the setup trigger.
    await scaffoldEngine(dir, { bootstrapped: false });
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assertStringIncludes(bare.stdout, INSTRUCTIONS_H1);
  });

  await withTempDir(async (dir) => {
    // Set-up project: bare `discern` shows help, not setup.
    await scaffoldEngine(dir); // bootstrapped by default
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assert(
      !bare.stdout.includes(INSTRUCTIONS_H1),
      "a set-up project should show help, not re-run setup",
    );
    assertStringIncludes(bare.stdout, "Usage:");
  });
});

Deno.test("bare `discern` outside a project runs setup only inside a git work tree", async () => {
  // No discern.toml, but a git repo → bare `discern` scaffolds (the fresh-install
  // path). A repo with a file (so the initial commit has content) and no discern
  // project up the tree.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.py"), "print('hi')\n");
    await gitInit(dir);
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assertStringIncludes(bare.stdout, INSTRUCTIONS_H1);
    assert(
      await exists(join(dir, "discern.toml")),
      "setup scaffolds the config",
    );
  });
});

Deno.test("`discern init` and `discern bootstrap` redirect to setup with a note", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });

    const init = await runAgent(dir, ["init"]);
    assertEquals(init.code, 0, init.output);
    assertStringIncludes(init.stderr, "is now `discern setup`");
    assertStringIncludes(init.stdout, INSTRUCTIONS_H1);

    const bootstrap = await runAgent(dir, ["bootstrap"]);
    assertEquals(bootstrap.code, 0, bootstrap.output);
    assertStringIncludes(bootstrap.stderr, "is now `discern setup`");
  });
});

Deno.test("discern setup is still callable with --force after it is recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // bootstrapped by default

    // Bare invocation now reports it is already done...
    const bare = await runAgent(dir, ["setup"]);
    assertEquals(bare.code, 0, bare.output);
    assertStringIncludes(bare.stdout, "already set up");

    // ...but --force re-seeds (and reprints the instructions).
    const forced = await runAgent(dir, ["setup", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertStringIncludes(forced.stdout, INSTRUCTIONS_H1);
  });
});

Deno.test("discern setup done ignores a real doc that merely mentions EXAMPLE", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    // A genuine doc (no skeleton) that happens to contain the bare word EXAMPLE
    // and an open paren — the validator must not mistake it for the skeleton's
    // `_(EXAMPLE — replace during ...)_` placeholder heading.
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(
      join(dir, "docs/README.md"),
      "# Docs\n\nSee the sample config (EXAMPLE) in the appendix.\n",
    );
    const done = await runAgent(dir, ["setup", "done"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("discern setup --json emits the DiscernResult envelope", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["setup", "--json"]);
    assertEquals(r.code, 0, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "setup");
    assert(res.data.skeletons.includes("docs/"));
    assert(
      typeof res.data.instructions === "string" &&
        res.data.instructions.length > 0,
    );
  });
});
