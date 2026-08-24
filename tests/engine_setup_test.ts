/**
 * Engine coverage for the staged `discern setup` handshake (ADR 0036/0075) — driven
 * through the real CLI so Cliffy parsing, the `begin` skeleton scaffolding, the `done`
 * validator, the `[meta].bootstrapped` marker, the pre-setup hard redirect, the
 * bare-`discern` welcome, the `setup`/`setup` back-compat redirect, and the
 * self-hiding from help are all exercised end-to-end. The read-only welcome surface
 * itself (the three states, the dual-address) is covered in engine_setup_welcome_test.
 *
 * `scaffoldEngine` marks the install set up by default, so these tests pass
 * `{ bootstrapped: false }` whenever they need the un-set-up state.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, relative } from "@std/path";
import { exists, walk } from "@std/fs";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  defaultMapPath,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import {
  AGENT_NAMES,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { HINTS } from "../src/shared/hints.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { INSTRUCTIONS_H1 } from "./engine_setup_shared.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { assertDiscernTomlTidy } from "./tidy_helpers.ts";

/** The H1 of the printed setup instructions (templates/setup/instructions.md). */
/** The setup command's help description — present in `--help` only when shown. */
const HELP_DESC = "Set up discern here";

Deno.test("setup begin from a subdirectory in a fresh git repo scaffolds at the repo root", async () => {
  await withTempDir(async (dir) => {
    const nested = join(dir, "packages", "app");
    await Deno.mkdir(nested, { recursive: true });
    await Deno.writeTextFile(join(nested, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(
      dir,
      ["setup", "begin", "--confirmed", "--json", "--agents", "claude_code"],
      { cwd: nested },
    );
    assertEquals(r.code, 0, r.output);
    assert(await exists(join(dir, "discern.toml")));
    assert(!(await exists(join(nested, "discern.toml"))));
    assert(await exists(defaultMapPath(dir, "README.md")));
    assert(!(await exists(join(nested, "discern"))));
  });
});

Deno.test("setup begin from a subdirectory in a mid-setup install reuses the install root", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const nested = join(dir, "packages", "app");
    await Deno.mkdir(nested, { recursive: true });

    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"], {
      cwd: nested,
    });
    assertEquals(r.code, 0, r.output);
    assert(await exists(defaultMapPath(dir, "README.md")));
    assert(!(await exists(join(nested, "discern.toml"))));
    assert(!(await exists(join(nested, "discern"))));
  });
});

Deno.test("setup begin refuses malformed existing settings JSON and names the file", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    const malformed = '{ "permissions": { "deny": [] }, }\n';
    await Deno.writeTextFile(join(dir, ".claude/settings.json"), malformed);
    await gitInit(dir);

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertStringIncludes(res.message, ".claude/settings.json");
    assertStringIncludes(res.message, "malformed JSON");
    assert(!res.message.includes("--config"), res.message);
    assertEquals(
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
      malformed,
    );
    assert(!(await exists(join(dir, "discern.toml"))));
  });
});

Deno.test("setup begin reports apply failures cleanly and reruns from the partial state", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await Deno.mkdir(join(dir, ".gemini"), { recursive: true });
    const gemini = join(dir, ".gemini/settings.json");
    const original = '{ "mcpServers": { "other": { "command": "other" } } }\n';
    await Deno.writeTextFile(gemini, original);
    await gitInit(dir);
    await Deno.chmod(gemini, 0o444);

    const blocked = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      AGENT_NAMES.join(","),
    ]);
    assertEquals(blocked.code, 1, blocked.output);
    const failure = JSON.parse(blocked.stdout);
    assertEquals(failure.ok, false);
    assertStringIncludes(failure.message, ".gemini/settings.json");
    assertStringIncludes(failure.message, "write");
    assert(!blocked.output.includes("Uncaught"), blocked.output);
    assert(!blocked.output.includes("\n    at "), blocked.output);
    assertEquals(await Deno.readTextFile(gemini), original);

    await Deno.chmod(gemini, 0o644);
    const recovered = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      AGENT_NAMES.join(","),
    ]);
    assertEquals(recovered.code, 0, recovered.output);
    assert(await exists(join(dir, "discern.toml")));
    assert(await exists(defaultMapPath(dir, "README.md")));
    const settings = JSON.parse(await Deno.readTextFile(gemini));
    assertEquals(settings.mcpServers.other.command, "other");
    assertEquals(settings.mcpServers.discern.command, "discern");
  });
});

/** Enumerate seeded text files from either a single file target or a whole setup directory. */
async function setupTextFilesUnder(
  root: string,
  rel: string,
): Promise<string[]> {
  const abs = join(root, rel);
  const stat = await Deno.stat(abs);
  if (stat.isFile) {
    return [rel];
  }
  const files: string[] = [];
  for await (const entry of walk(abs, { includeDirs: false })) {
    files.push(relative(root, entry.path).replaceAll("\\", "/"));
  }
  return files.sort();
}

Deno.test("real setup begin leaves no unresolved template tokens in seeded or skeleton files", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
      "--agents",
      AGENT_NAMES.join(","),
    ]);
    assertEquals(r.code, 0, r.output);
    const data = JSON.parse(r.stdout).data;
    const rels = new Set<string>();
    for (
      const rel of [
        ...data.written,
        ...data.mcp_wired,
        ...(data.worktree_app_wired ?? []),
        ...(data.project_rules_wired ?? []),
      ] as string[]
    ) {
      rels.add(rel);
    }
    for (const rel of data.skeletons as string[]) {
      for (const file of await setupTextFilesUnder(dir, rel)) {
        rels.add(file);
      }
    }

    const leaked: string[] = [];
    for (const rel of [...rels].sort()) {
      const text = await Deno.readTextFile(join(dir, rel));
      for (const match of text.matchAll(/\{\{[^}\n]+\}\}/g)) {
        leaked.push(`${rel}: ${match[0]}`);
      }
    }
    assertEquals(
      leaked,
      [],
      `unresolved setup token(s):\n${leaked.join("\n")}`,
    );
  });
});

Deno.test("discern setup lays the doc skeletons when absent and prints the instructions", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    assertEquals(await exists(defaultMapPath(dir)), false);
    // The setup assets are binary-embedded, never seeded into the project (ADR
    // 0024/0036): a fresh install must carry neither a `setup/` nor `bootstrap/` tree.
    assertEquals(await exists(join(dir, "setup")), false);
    assertEquals(await exists(join(dir, "bootstrap")), false);

    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    // The instructions are printed for the agent in the loop to act on.
    assertStringIncludes(r.stdout, INSTRUCTIONS_H1);
    assertTerminalTextIncludes(
      r.stdout,
      `Project skeletons laid: ${SOURCE_PATHS.map.defaultPath}`,
    );
    // The skeleton tree is laid, with `{{project_name}}` substituted from the slug.
    assert(
      await exists(
        defaultMapPath(dir, "00-orientation", "design-principles.md"),
      ),
    );
    const readme = await Deno.readTextFile(
      defaultMapPath(dir, "README.md"),
    );
    assertStringIncludes(readme, "Engine Test"); // slug "engine-test" → display name
    assert(!readme.includes("{{project_name}}"));

    // Re-running is non-destructive: the map now exists, so it is left untouched.
    const again = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertTerminalTextIncludes(
      again.stdout,
      `Left your existing ${SOURCE_PATHS.map.defaultPath}`,
    );
  });
});

Deno.test("setup begin --map persists and scaffolds a separate map tree", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# Human docs\n");

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--map",
      "docs/discern/",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(
      r.stdout,
      "Project skeletons laid: docs/discern/",
    );
    const step = await runAgent(dir, ["setup", "step", "4"]);
    assertStringIncludes(
      step.stdout,
      "docs/discern/00-orientation/design-principles.md",
    );

    const config = parseConfigOrThrow(
      await Deno.readTextFile(join(dir, "discern.toml")),
    );
    assertEquals(config.map.dir, "docs/discern/");
    assert(
      await exists(
        join(dir, "docs/discern/00-orientation/design-principles.md"),
      ),
    );
    assertEquals(
      await Deno.readTextFile(join(dir, "docs/README.md")),
      "# Human docs\n",
    );
    const blocked = await runAgent(dir, ["setup", "done"]);
    assertEquals(blocked.code, 1, blocked.output);
    assertStringIncludes(
      blocked.stderr,
      "docs/discern/00-orientation/design-principles.md",
    );
  });
});

Deno.test("the scaffolded dev-loop docs name the canonical worktree verb (discern start, not the help-only worktree parent)", async () => {
  // `discern start` (from the main checkout) is how you begin a new line of work;
  // `discern worktree setup` is the in-worktree convergence command. The skeleton dev-loop
  // docs used the latter for "set up a checkout for a change", which a cold run read as
  // an inconsistency with the `discern start` that status/doctor surface. Guard that
  // the shipped skeletons point at `discern start` and never the help-only worktree parent for starting work.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]); // lays the docs skeletons
    for (
      const rel of [
        `${SOURCE_PATHS.map.defaultPath}80-development/getting-started.md`,
        `${SOURCE_PATHS.map.defaultPath}80-development/README.md`,
      ]
    ) {
      const body = await Deno.readTextFile(join(dir, rel));
      assertStringIncludes(body, "discern start");
      assert(
        !/discern worktree(?! (setup|ensure|create|remove|teardown|prune))/
          .test(body),
        `${rel} must use 'discern start' for beginning work, not the help-only worktree parent:\n${body}`,
      );
    }
  });
});

Deno.test("discern setup never overwrites an existing configured map tree (seamless DX)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await Deno.mkdir(defaultMapPath(dir), { recursive: true });
    await Deno.writeTextFile(
      defaultMapPath(dir, "README.md"),
      "MY OWN DOCS\n",
    );

    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(
      r.stdout,
      `Left your existing ${SOURCE_PATHS.map.defaultPath}`,
    );
    // The user's file is intact and no skeleton was laid over it.
    assertEquals(
      await Deno.readTextFile(defaultMapPath(dir, "README.md")),
      "MY OWN DOCS\n",
    );
    assertEquals(
      await exists(defaultMapPath(dir, "00-orientation")),
      false,
    );
  });
});

Deno.test("a project's own root docs/ no longer collides with the default skeleton (ADR 0099)", async () => {
  // The namespace default dissolved the existing-docs conflict: a human-authored
  // root docs/ tree and discern's map coexist by construction.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "MY OWN DOCS\n");

    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    // The skeleton lands at the namespace default; the user's tree is untouched.
    assertTerminalTextIncludes(
      r.stdout,
      `Project skeletons laid: ${SOURCE_PATHS.map.defaultPath}`,
    );
    assert(await exists(defaultMapPath(dir, "README.md")));
    assertEquals(
      await Deno.readTextFile(join(dir, "docs/README.md")),
      "MY OWN DOCS\n",
    );
  });
});

Deno.test("a project's own root map/ does not collide with discern's default map (ADR 0195)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await Deno.mkdir(join(dir, "map"));
    await Deno.writeTextFile(
      join(dir, "map/README.md"),
      "# Product geography\n",
    );

    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(
      r.stdout,
      `Project skeletons laid: ${SOURCE_PATHS.map.defaultPath}`,
    );
    assert(await exists(defaultMapPath(dir, "README.md")));
    assertEquals(
      await Deno.readTextFile(join(dir, "map/README.md")),
      "# Product geography\n",
    );
  });
});

Deno.test("discern setup done refuses while skeleton markers remain; --force overrides", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin", "--confirmed"]); // lay the skeletons (markers present)

    const blocked = await runAgent(dir, ["setup", "done"]);
    assertEquals(blocked.code, 1, blocked.output);
    assertTerminalTextIncludes(blocked.stderr, "not finished");
    assertStringIncludes(blocked.stderr, "design-principles.md");
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "the marker must not be set while validation fails",
    );

    const forced = await runAgent(dir, ["setup", "done", "--force"]);
    assertEquals(forced.code, 0, forced.output);
    assertTerminalTextIncludes(forced.stdout, "Setup complete");
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
    await assertDiscernTomlTidy(dir, "setup completion marker");
  });
});

// The class behind B49: `setup done` must NOT record `[meta].bootstrapped` while any
// completion precondition is unmet — and a config discern can't even parse is the floor,
// because the parse-tolerant marker writer would happily stamp `bootstrapped = true` and
// only THEN hit the failure the run reports, leaving completion recorded by a failing run.
// The class INVARIANT both done modes must hold — the checks-and-proof path AND the --force
// escape hatch that deliberately skips it — is: refuse (exit 1) and write no marker. The
// non-force path already refuses via the gate proof (which loads the config); --force, which
// skips the proof, previously sailed through to the write, so it must now refuse too. Driving
// this off the mode list means a future done variant is a one-line enrolment, not a silent gap.
const DONE_MODES: ReadonlyArray<{ label: string; args: string[] }> = [
  { label: "plain", args: ["setup", "done"] },
  { label: "--force", args: ["setup", "done", "--force"] },
];

for (const mode of DONE_MODES) {
  Deno.test(`setup done (${mode.label}) refuses an unparseable config and records nothing (B49)`, async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir, { bootstrapped: false });

      // Corrupt discern.toml so it no longer parses. The marker writer (a line-based,
      // parse-tolerant editor) would otherwise stamp the marker regardless.
      const cfgPath = join(dir, "discern.toml");
      const broken = () => Deno.readTextFile(cfgPath);
      await Deno.writeTextFile(
        cfgPath,
        await broken() + "\nthis is = = not valid [[[\n",
      );

      // The class invariant: the run refuses (exit 1) and records no marker — whichever
      // refusal path (gate proof or the --force config-parse floor) it takes.
      const json = await runAgent(dir, [...mode.args, "--json"]);
      assertEquals(json.code, 1, json.output);
      assertEquals(JSON.parse(json.stdout).ok, false);
      assert(
        !(await broken()).includes("bootstrapped = true"),
        `setup done (${mode.label}) recorded completion over an unparseable config`,
      );

      // The human surface refuses on stderr too, still recording nothing.
      const human = await runAgent(dir, mode.args);
      assertEquals(human.code, 1, human.output);
      assert(
        !(await broken()).includes("bootstrapped = true"),
        `setup done (${mode.label}, human) recorded completion over an unparseable config`,
      );
    });
  });
}

// The B49 pivot itself: --force skips the completeness checks and the gate proof, so ONLY
// this run reaches the marker write with an unparseable config — the exact regression is
// that write landing ahead of the failure. Pin the specific refusal so it can't silently
// revert to stamping the marker: --force on a broken config returns the `invalid_config`
// refusal, names the parse problem, and records nothing.
Deno.test("setup done --force is refused by the config-parse floor it cannot override (B49)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const cfgPath = join(dir, "discern.toml");
    await Deno.writeTextFile(
      cfgPath,
      await Deno.readTextFile(cfgPath) + "\nthis is = = not valid [[[\n",
    );

    const res = JSON.parse(
      (await runAgent(dir, ["setup", "done", "--force", "--json"])).stdout,
    );
    assertEquals(res.ok, false);
    assertEquals(
      res.error,
      "invalid_config",
      `--force on a broken config must hit the config-parse floor, not stamp completion; got ${
        JSON.stringify(res)
      }`,
    );
    assertStringIncludes(res.message, "parse");
    assert(
      !(await Deno.readTextFile(cfgPath)).includes("bootstrapped = true"),
      "the marker must not be written by the refused --force run",
    );
  });
});

Deno.test("the setup redirect and the command retire once setup is recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    await git(dir, "checkout", "-b", "discern-setup");

    // Before: a still-gated work verb (`docs`) hard-redirects (exit≠0, on stderr),
    // and setup shows in help. (`done` is no longer gated — ADR 0065.)
    const preDocs = await runAgent(dir, ["map"]);
    assertEquals(preDocs.code, 1, preDocs.output);
    assertTerminalTextIncludes(preDocs.stderr, "isn't set up yet");
    const preHelp = await runAgent(dir, ["--help"]);
    assertStringIncludes(preHelp.stdout, HELP_DESC);

    // Set up, then clear the skeleton markers so `done` validates cleanly.
    await runAgent(dir, ["setup", "begin", "--confirmed"]);
    await Deno.remove(defaultMapPath(dir), { recursive: true });
    await Deno.mkdir(defaultMapPath(dir), { recursive: true });
    await Deno.writeTextFile(
      defaultMapPath(dir, "README.md"),
      "# Real docs\n",
    );
    await Deno.mkdir(defaultMapPath(dir, "10-runtime"), { recursive: true });
    await Deno.writeTextFile(
      defaultMapPath(dir, "10-runtime", "README.md"),
      "# Runtime\n\n## Start here\n\nBegin at `main.ts`.\n\n" +
        "## Boundary\n\nThe runtime owns project execution.\n\n" +
        "## Non-obvious invariant\n\nPreserve the configured command's exit status.\n",
    );
    // ADR 0078: `done` also requires ≥1 wired capability (a derived per-step check).
    await runAgent(dir, ["config", "set-job", "test", "true"]);
    const tidied = await runAgent(dir, ["tidy", "--json"]);
    assertEquals(tidied.code, 0, tidied.output);
    const refreshed = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "author setup",
      "--no-gpg-sign",
    );
    const done = await runAgent(dir, ["setup", "done"]);
    assertEquals(done.code, 0, done.output);

    // After: the same verb runs (no redirect), and setup is hidden from help.
    const postDocs = await runAgent(dir, ["map"]);
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
    const docs = await runAgent(dir, ["map"]);
    assertEquals(docs.code, 1, docs.output);
    assertTerminalTextIncludes(docs.stderr, "isn't set up yet");
    // `refresh` is machinery (and `discern setup` itself runs it) — no redirect,
    // so it never leaks into the regen/hook path.
    const refresh = await runAgent(dir, ["refresh"]);
    assert(!refresh.stderr.includes("isn't set up yet"));
    assertEquals(refresh.code, 0, refresh.output);
    // `tidy` is prewired into the fresh format job, so setup's own gate must be
    // able to invoke it before the completion marker exists.
    const tidy = await runAgent(dir, ["tidy", "--json"]);
    assert(!tidy.stderr.includes("isn't set up yet"));
    assertEquals(tidy.code, 0, tidy.output);
    // `done` is a gate PROOF verb — ADR 0065 un-gates it so the agent can
    // iterate while wiring capabilities during setup; it must NOT redirect.
    const finish = await runAgent(dir, ["done"]);
    assert(
      !finish.stderr.includes("isn't set up yet"),
      `finish must run during setup: ${finish.output}`,
    );
  });
});

Deno.test("map is gated pre-setup but docs and help are not", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // un-set-up

    // There is no project map to browse until setup seeds and fills it.
    const map = await runAgent(dir, ["map", "--json"]);
    assertEquals(map.code, 1, map.output);
    assertEquals(JSON.parse(map.stdout).error, "not_set_up");

    // `docs` stays open because it serves discern's bundled manual, not the
    // project's map.
    const docs = await runAgent(dir, ["docs", "--list"]);
    assertEquals(docs.code, 0, docs.output);
    assert(!docs.stderr.includes("isn't set up yet"));
    assertTerminalTextIncludes(docs.stdout, "discern docs");

    const help = await runAgent(dir, ["help"]);
    assertEquals(help.code, 0, help.output);
    assertStringIncludes(help.stdout, "Commands:");
  });
});

Deno.test("the map gate is a structured not_set_up result under --json", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const r = await runAgent(dir, ["map", "--json"]);
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.verb, "map");
    assertEquals(res.error, "not_set_up");
  });
});

Deno.test("done/prepare/test/standards run before setup is recorded, carrying the in-progress hint (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    // The gate proof verbs are usable during setup so the agent can iterate while
    // wiring capabilities (and test a standard it wires) — but each leads with the
    // "setup unfinished" advisory so a green run can't be mistaken for done.
    for (const verb of ["done", "prepare", "test", "standards"]) {
      const r = await runAgent(dir, [verb, "--json"]);
      const res = JSON.parse(r.stdout);
      assertEquals(res.verb, verb, r.output);
      assert(
        res.error !== "not_set_up",
        `${verb} must not redirect to setup pre-setup: ${r.output}`,
      );
      assertHasHint(res, HINTS["setup-unfinished-gate"]);
    }
  });
});

/** Lay a clean project state so `setup done`'s marker check AND its derived per-step
 * checks (ADR 0078) pass, leaving only the GATE to decide the outcome: real docs, a
 * instructions.md with a pitch + a Conventions section, and `test` wired to `cmd` (a
 * shell command whose exit status is the gate's verdict). */
