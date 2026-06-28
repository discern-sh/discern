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
import { dirname, join, relative } from "@std/path";
import { exists, walk } from "@std/fs";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
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
    assertStringIncludes(r.stdout, "Project skeletons laid: docs/");
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

    // Before: a still-gated work verb (`docs`) hard-redirects (exit≠0, on stderr),
    // and setup shows in help. (`finish` is no longer gated — ADR 0065.)
    const preDocs = await runAgent(dir, ["docs"]);
    assertEquals(preDocs.code, 1, preDocs.output);
    assertStringIncludes(preDocs.stderr, "isn't set up yet");
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
    const postDocs = await runAgent(dir, ["docs"]);
    assert(!postDocs.stderr.includes("isn't set up yet"), postDocs.output);
    const postHelp = await runAgent(dir, ["--help"]);
    assert(
      !postHelp.stdout.includes(HELP_DESC),
      "setup should be hidden from help once recorded",
    );
  });
});

Deno.test("the redirect fires on still-gated work verbs but not on plumbing or proof verbs", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // un-set-up
    // `docs` browses the project's own tree — empty until setup fills it — so it
    // stays gated.
    const docs = await runAgent(dir, ["docs"]);
    assertEquals(docs.code, 1, docs.output);
    assertStringIncludes(docs.stderr, "isn't set up yet");
    // `refresh` is machinery (and `discern setup` itself runs it) — no redirect,
    // so it never leaks into the regen/hook path.
    const refresh = await runAgent(dir, ["refresh"]);
    assert(!refresh.stderr.includes("isn't set up yet"));
    assertEquals(refresh.code, 0, refresh.output);
    // `finish` is a gate PROOF verb — ADR 0065 un-gates it so the agent can
    // iterate while wiring capabilities during setup; it must NOT redirect.
    const finish = await runAgent(dir, ["finish"]);
    assert(
      !finish.stderr.includes("isn't set up yet"),
      `finish must run during setup: ${finish.output}`,
    );
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

Deno.test("the docs redirect is a structured not_set_up result under --json", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["docs", "--json"]);
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "docs");
    assertEquals(res.error, "not_set_up");
  });
});

Deno.test("finish/prepare/test run before setup is recorded, carrying the in-progress hint (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    // The gate proof verbs are usable during setup so the agent can iterate while
    // wiring capabilities — but each leads with the "setup unfinished" advisory so
    // a green run can't be mistaken for a finished project.
    for (const verb of ["finish", "prepare", "test"]) {
      const r = await runAgent(dir, [verb, "--json"]);
      const res = JSON.parse(r.stdout);
      assertEquals(res.verb, verb, r.output);
      assert(
        res.error !== "not_set_up",
        `${verb} must not redirect to setup pre-bootstrap: ${r.output}`,
      );
      assert(
        (res.hints ?? []).some((h: string) =>
          h.includes("Setup is not finished")
        ),
        `${verb} must carry the setup-in-progress hint: ${r.stdout}`,
      );
    }
  });
});

/** Lay a clean, marker-free project state so `setup done`'s marker check passes and
 * only the GATE decides the outcome: real docs, a real guidance.md, and `test` wired
 * to `cmd` (a shell command whose exit status is the gate's verdict). */
async function readyForDone(dir: string, cmd: string): Promise<void> {
  await scaffoldEngine(dir, { bootstrapped: false });
  await gitInit(dir);
  await runAgent(dir, ["setup"]); // lay the skeletons
  // Replace the marker-carrying skeletons with real, marker-free content.
  await Deno.remove(join(dir, "docs"), { recursive: true });
  await Deno.mkdir(join(dir, "docs"));
  await Deno.writeTextFile(join(dir, "docs/README.md"), "# Real docs\n");
  await Deno.writeTextFile(
    join(dir, "guidance.md"),
    "# Project guidance\n\nReal conventions.\n",
  );
  const wired = await runAgent(dir, ["config", "set-capability", "test", cmd]);
  assertEquals(wired.code, 0, wired.output);
}

Deno.test("setup done runs the gate and records bootstrapped only when green (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // a passing gate

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(
      res.data.gate_proven,
      true,
      "the gate was the completion proof",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("setup done refuses when the gate is red, recording nothing; --force overrides (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "false"); // a failing gate

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.error, "gate_failed");
    assertEquals(res.data.stage, "finish");
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "a red gate must NOT record completion",
    );

    // --force is the escape hatch: it skips the proof and records anyway.
    const forced = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertStringIncludes(forced.stdout, "gate not proven");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("discern setup migrates a pre-existing agent file into guidance.md, never destroying it (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    // A project with its own hand-written CLAUDE.md, harnessed by discern for the
    // first time (a true fresh install — no discern.toml).
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const rule = "ALWAYS RUN THE LINTER FIRST — this is my own house rule.";
    await Deno.writeTextFile(
      join(dir, "CLAUDE.md"),
      `# My project\n\n${rule}\n`,
    );

    const r = await runAgent(dir, ["setup"]);
    assertEquals(r.code, 0, r.output);

    // The user's instruction survives in the tracked source...
    const guidance = await Deno.readTextFile(join(dir, "guidance.md"));
    assertStringIncludes(guidance, rule);
    assertStringIncludes(guidance, "Imported from CLAUDE.md");

    // ...and is re-emitted into the compiled agent files (the compile folds
    // guidance.md into the canonical AGENTS.md, which CLAUDE.md then points at), so
    // reading the agent guidance still shows it — nothing was lost.
    const compiled = (await Promise.all(
      ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].map((f) =>
        Deno.readTextFile(join(dir, f)).catch(() => "")
      ),
    )).join("\n");
    assertStringIncludes(compiled, rule);
  });
});

Deno.test("discern setup lays a marked guidance.md stub that setup done enforces (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, ["setup"]);
    assertEquals(r.code, 0, r.output);

    // The stub exists and carries the marker, so it is a real "flesh out the stub".
    const guidance = await Deno.readTextFile(join(dir, "guidance.md"));
    assertStringIncludes(guidance, "setup fills this");

    // setup done refuses while the guidance stub is unfilled — the existing marker
    // check now enforces guidance.md, with no second code path.
    const blocked = await runAgent(dir, ["setup", "done"]);
    assertEquals(blocked.code, 1, blocked.output);
    assertStringIncludes(blocked.stderr, "guidance.md");
  });
});

Deno.test("discern setup preserves the project name's casing in the scaffolded files (ADR 0065)", async () => {
  await withTempDir(async (parent) => {
    // A directory whose name carries deliberate camelCase the lowercase slug loses.
    const dir = join(parent, "ListOfListsOfLists");
    await Deno.mkdir(dir);
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(dir, ["setup"]);
    assertEquals(r.code, 0, r.output);

    // TODO.md carries the original casing, not the slug-reconstructed
    // "Listoflistsoflists".
    const todo = await Deno.readTextFile(join(dir, "TODO.md"));
    assertStringIncludes(todo, "ListOfListsOfLists");
    assert(!todo.includes("Listoflistsoflists"), todo);
  });
});

Deno.test("setup's _adr skeleton is byte-identical to the write-adr skill's (single source)", async () => {
  for (const f of ["README.md", "0000-template.md"]) {
    const setupCopy = await Deno.readTextFile(
      join(REAL_TEMPLATES, "setup", "skeleton", "docs", "_adr", f),
    );
    const skillCopy = await Deno.readTextFile(
      join(
        REAL_TEMPLATES,
        "skills",
        "write-adr",
        "skeleton",
        "docs",
        "_adr",
        f,
      ),
    );
    assertEquals(
      setupCopy,
      skillCopy,
      `templates/setup/skeleton/docs/_adr/${f} must stay identical to the write-adr skill's copy`,
    );
  }
});

Deno.test("scaffolded docs contain no dead relative links — setup ships what it references (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, ["setup"]);
    assertEquals(r.code, 0, r.output);

    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    const dead: string[] = [];
    for await (
      const entry of walk(join(dir, "docs"), {
        exts: [".md"],
        includeDirs: false,
      })
    ) {
      // Strip code (fenced + inline) first, so an illustrative link inside a code
      // example — `[some module](../src/path/Thing.ext)` — isn't read as a real link.
      const text = (await Deno.readTextFile(entry.path))
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`]*`/g, "");
      for (const m of text.matchAll(linkRe)) {
        const raw = m[1];
        if (raw === undefined) continue;
        // The bare URL: drop any "title" suffix and trailing #anchor.
        const target = (raw.trim().split(/\s+/)[0] ?? "").split("#")[0] ?? "";
        if (target === "" || /^(https?:|mailto:)/.test(target)) continue;
        // A leading "/" is repo-root-relative; otherwise relative to the file.
        const resolved = target.startsWith("/")
          ? join(dir, target.slice(1))
          : join(dirname(entry.path), target);
        if (!(await exists(resolved))) {
          dead.push(`${relative(dir, entry.path)} → ${raw}`);
        }
      }
    }
    assertEquals(
      dead,
      [],
      `dead links in scaffolded docs:\n${dead.join("\n")}`,
    );
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

Deno.test("the brief teaches involve-don't-gate (narrate + atomic commits), not a per-step confirm gate (ADR 0044)", async () => {
  // Read the printed brief directly — `templates/` is excluded from `deno fmt`,
  // so these anchors stay on one line and won't be reflowed out from under us.
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  // The interaction model is taught: a named stance, the five-beat narration
  // pattern, discern named as the source of the recommendation, per-stage atomic
  // commits, and the explicit carve-out for decisions that DO warrant a pause.
  assertStringIncludes(brief, "involve, don't gate");
  assertStringIncludes(brief, "five beats");
  assertStringIncludes(brief, "Name `discern` as the source");
  assertStringIncludes(brief, "atomic commit");
  assertStringIncludes(brief, "genuine decision");

  // Reversibility-IS-safety is spelled out — the commit is the undo — so
  // "proceed without asking" can never be read as "act irreversibly".
  assertStringIncludes(brief, "the undo");

  // The old propose-and-confirm gate is reconciled away in EVERY place it lived:
  // the operating principle, the Step 7 capability gate, and the stop-condition.
  // These are the structural guards that keep the consent gate from creeping back.
  assert(
    !brief.includes("Propose, don't overwrite"),
    "the propose-and-confirm operating principle must not return",
  );
  assert(
    !brief.includes("let them confirm"),
    "per-step confirm-gating language must not return",
  );
  assert(
    !brief.includes("committed only if the user confirms"),
    "the capability-fill confirm gate must not return in the stop-conditions",
  );

  // The warmer narration must NOT soften the incompleteness signal (ADR 0037):
  // per-stage commits are transparency during setup, not "setup complete".
  assertStringIncludes(brief, "Narration is not completion");
  assertStringIncludes(brief, "You are not done until all of these are true");
});
