/**
 * Engine coverage for the staged `discern setup` handshake (ADR 0036/0075) — driven
 * through the real CLI so Cliffy parsing, the `begin` skeleton scaffolding, the `done`
 * validator, the `[meta].bootstrapped` marker, the pre-setup hard redirect, the
 * bare-`discern` welcome, the `init`/`bootstrap` back-compat redirect, and the
 * self-hiding from help are all exercised end-to-end. The read-only welcome surface
 * itself (the three states, the dual-address) is covered in engine_setup_welcome_test.
 *
 * `scaffoldEngine` marks the install set up by default, so these tests pass
 * `{ bootstrapped: false }` whenever they need the un-set-up state.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, relative } from "@std/path";
import { exists, walk } from "@std/fs";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import {
  AGENT_NAMES,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { providerFor } from "../src/lib/providers.ts";

/** The H1 of the printed setup instructions (templates/setup/instructions.md). */
const INSTRUCTIONS_H1 = "# Set up the harness";
/** The setup command's help description — present in `--help` only when shown. */
const HELP_DESC = "Set up the harness here";

Deno.test("setup begin from a subdirectory in a fresh git repo scaffolds at the repo root", async () => {
  await withTempDir(async (dir) => {
    const nested = join(dir, "packages", "app");
    await Deno.mkdir(nested, { recursive: true });
    await Deno.writeTextFile(join(nested, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(
      dir,
      ["setup", "begin", "--json", "--agents", "claude_code"],
      { cwd: nested },
    );
    assertEquals(r.code, 0, r.output);
    assert(await exists(join(dir, "discern.toml")));
    assert(!(await exists(join(nested, "discern.toml"))));
    assert(await exists(join(dir, "docs", "README.md")));
    assert(!(await exists(join(nested, "docs"))));
  });
});

Deno.test("setup begin from a subdirectory in a mid-setup install reuses the install root", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    const nested = join(dir, "packages", "app");
    await Deno.mkdir(nested, { recursive: true });

    const r = await runAgent(dir, ["setup", "begin", "--json"], {
      cwd: nested,
    });
    assertEquals(r.code, 0, r.output);
    assert(await exists(join(dir, "docs", "README.md")));
    assert(!(await exists(join(nested, "discern.toml"))));
    assert(!(await exists(join(nested, "docs"))));
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
      "--json",
      "--agents",
      AGENT_NAMES.join(","),
    ]);
    assertEquals(recovered.code, 0, recovered.output);
    assert(await exists(join(dir, "discern.toml")));
    assert(await exists(join(dir, "docs", "README.md")));
    const settings = JSON.parse(await Deno.readTextFile(gemini));
    assertEquals(settings.mcpServers.other.command, "other");
    assertEquals(settings.mcpServers.discern.command, "discern");
  });
});

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
    assertEquals(await exists(join(dir, "docs")), false);
    // The setup assets are binary-embedded, never seeded into the project (ADR
    // 0024/0036): a fresh install must carry neither a `setup/` nor `bootstrap/` tree.
    assertEquals(await exists(join(dir, "setup")), false);
    assertEquals(await exists(join(dir, "bootstrap")), false);

    const r = await runAgent(dir, ["setup", "begin"]);
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
    const again = await runAgent(dir, ["setup", "begin"]);
    assertStringIncludes(again.stdout, "Left your existing docs/");
  });
});

Deno.test("setup begin --docs persists and scaffolds a separate agent docs tree", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# Human docs\n");

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--docs",
      "docs/discern/",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Project skeletons laid: docs/discern/");
    const step = await runAgent(dir, ["setup", "step", "3"]);
    assertStringIncludes(
      step.stdout,
      "docs/discern/00-orientation/design-principles.md",
    );

    const config = parseConfigOrThrow(
      await Deno.readTextFile(join(dir, "discern.toml")),
    );
    assertEquals(config.docs.dir, "docs/discern/");
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

Deno.test("the scaffolded dev-loop docs name the canonical worktree verb (discern start, not bare discern worktree)", async () => {
  // `discern start` (from the main checkout) is how you begin a new line of work;
  // `discern worktree` is the in-worktree convergence command. The skeleton dev-loop
  // docs used the latter for "set up a checkout for a change", which a cold run read as
  // an inconsistency with the `discern start` that status/doctor surface. Guard that
  // the shipped skeletons point at `discern start` and never bare `discern worktree`.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await runAgent(dir, ["setup", "begin"]); // lays the docs skeletons
    for (
      const rel of [
        "docs/80-development/getting-started.md",
        "docs/80-development/README.md",
      ]
    ) {
      const body = await Deno.readTextFile(join(dir, rel));
      assertStringIncludes(body, "discern start");
      assert(
        !body.includes("discern worktree"),
        `${rel} must use 'discern start' for beginning work, not bare 'discern worktree':\n${body}`,
      );
    }
  });
});

Deno.test("discern setup never overwrites an existing docs/ tree (seamless DX)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "MY OWN DOCS\n");

    const r = await runAgent(dir, ["setup", "begin"]);
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
    await runAgent(dir, ["setup", "begin"]); // lay the skeletons (markers present)

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
    await runAgent(dir, ["setup", "begin"]);
    await Deno.remove(join(dir, "docs"), { recursive: true });
    await Deno.mkdir(join(dir, "docs"));
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# Real docs\n");
    // ADR 0078: `done` also requires ≥1 wired capability (a derived per-step check).
    await runAgent(dir, ["config", "set-capability", "test", "true"]);
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

Deno.test("finish/prepare/test/ratchets run before setup is recorded, carrying the in-progress hint (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    // The gate proof verbs are usable during setup so the agent can iterate while
    // wiring capabilities (and test a ratchet it wires) — but each leads with the
    // "setup unfinished" advisory so a green run can't be mistaken for done.
    for (const verb of ["finish", "prepare", "test", "ratchets"]) {
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

/** Lay a clean project state so `setup done`'s marker check AND its derived per-step
 * checks (ADR 0078) pass, leaving only the GATE to decide the outcome: real docs, a
 * guidance.md with a pitch + a Conventions section, and `test` wired to `cmd` (a
 * shell command whose exit status is the gate's verdict). */
async function readyForDone(dir: string, cmd: string): Promise<void> {
  await scaffoldEngine(dir, { bootstrapped: false });
  await gitInit(dir);
  await runAgent(dir, ["setup", "begin"]); // lay the skeletons
  // Replace the marker-carrying skeletons with real, marker-free content. The
  // guidance.md carries a real pitch and a Conventions section so the per-step
  // guidance check (ADR 0078) passes; design-principles is left absent (N/A).
  await Deno.remove(join(dir, "docs"), { recursive: true });
  await Deno.mkdir(join(dir, "docs"));
  await Deno.writeTextFile(join(dir, "docs/README.md"), "# Real docs\n");
  await Deno.writeTextFile(
    join(dir, "guidance.md"),
    "# Project guidance\n\nA real pitch describing the project and who it serves.\n\n## Conventions\n\nReal, project-specific conventions.\n",
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

Deno.test("setup done commits the completion marker when discern.toml is the only change", async () => {
  // The completion marker [meta].bootstrapped was written but never committed, so a
  // diligent atomic-commit setup still ended with a dirty tree. When discern.toml is
  // the lone change, `done` commits it on the agent's behalf.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // gitInits + lays a passing, marker-free project
    // Simulate the agent's atomic commits: wire the harness (MCP etc.) and commit
    // everything, so the marker is the only change `done` introduces.
    await runAgent(dir, ["refresh"]);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(res.data.marker_committed, true);
    // The marker landed in its own commit and the tree is clean.
    assertEquals(await gitOut(dir, "status", "--porcelain"), "");
    assertStringIncludes(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "Mark discern setup complete",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
  });
});

Deno.test("setup done leaves the marker uncommitted (fail open) when the tree has other changes", async () => {
  // Anything beyond discern.toml is unexpected, so `done` must not sweep it into the
  // marker commit — it records completion, leaves the marker dirty, and says to commit.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await runAgent(dir, ["refresh"]);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    // An unrelated uncommitted change present at `done` time.
    await Deno.writeTextFile(join(dir, "docs/README.md"), "# changed again\n");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.data.bootstrapped, true); // completion still recorded
    assertEquals(res.data.marker_committed, false); // but not auto-committed
    // The marker is left in the working tree for the agent to commit deliberately.
    assert(
      (await gitOut(dir, "status", "--porcelain")).includes("discern.toml"),
      "the marker should be left dirty when other changes are present",
    );
  });
});

Deno.test("setup done fails open when discern.toml carries an extra uncommitted edit beyond the marker", async () => {
  // discern.toml is the lone changed file, but it has more than the marker line dirty
  // (config the agent didn't commit). Only "that one dirty line" earns the auto-commit.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await runAgent(dir, ["refresh"]);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    // A stray uncommitted edit to discern.toml itself (a comment), beyond the marker.
    const toml = await Deno.readTextFile(join(dir, "discern.toml"));
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `${toml}\n# stray edit\n`,
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(res.data.marker_committed, false);
    assert(
      (await gitOut(dir, "status", "--porcelain")).includes("discern.toml"),
      "discern.toml should stay dirty when more than the marker line changed",
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
    assertStringIncludes(forced.stdout, "the gate was not proven");
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

    const r = await runAgent(dir, ["setup", "begin"]);
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

/**
 * Plant a fake, executable agent binary named `name` in a fresh temp "bin" dir and
 * return a PATH with that dir prepended to the real one — so PATH auto-detect finds
 * an agent this machine may not actually have installed. `gemini` is the natural
 * choice: it is NOT in `DEFAULT_AGENTS`, so its presence in a written config can
 * ONLY have come from detection, whatever real agents the CI host has. The caller
 * removes `bin` when done.
 */
async function pathWithFakeAgent(
  name: string,
): Promise<{ path: string; bin: string }> {
  const bin = await Deno.makeTempDir({ prefix: "discern-fakebin-" });
  const exe = join(bin, name);
  await Deno.writeTextFile(exe, "#!/bin/sh\n");
  await Deno.chmod(exe, 0o755);
  return { path: `${bin}:${Deno.env.get("PATH") ?? ""}`, bin };
}

Deno.test("discern setup persists the PATH-detected agent set into [guidance].agents (auto-detect, end-to-end)", async () => {
  // The resolver is unit-tested; this proves the SETUP WIRING — freshInstall &&
  // no --agents → write the detected set into discern.toml — actually lands, so a
  // future setup refactor can't silently drop the auto-detect feature (the
  // regression this is cheap insurance against).
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // a clean repo → setup runs its normal fresh-install path

    const { path, bin } = await pathWithFakeAgent("gemini");
    try {
      const r = await runAgent(dir, ["setup", "begin", "--json"], {
        env: { PATH: path },
      });
      assertEquals(r.code, 0, r.output);

      // gemini ∉ DEFAULT_AGENTS, so it is in the WRITTEN config only via detection.
      const agents = parseConfigOrThrow(
        await Deno.readTextFile(join(dir, "discern.toml")),
      ).guidance.agents;
      assert(
        agents.includes("gemini"),
        `the PATH-detected gemini must be persisted to [guidance].agents — a setup ` +
          `refactor dropping the auto-detect wiring fails here. Got: ${
            JSON.stringify(agents)
          }`,
      );
    } finally {
      await Deno.remove(bin, { recursive: true });
    }
  });
});

Deno.test("discern setup honours an explicit --agents over PATH detection (the agents-unset guard)", async () => {
  // The other half of the condition: when the user NAMES agents, detection is
  // skipped (`effectiveFlags.agents === undefined` is false), so a detected-but-
  // unrequested agent never sneaks into the config.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const { path, bin } = await pathWithFakeAgent("gemini"); // present on PATH…
    try {
      const r = await runAgent(
        dir,
        ["setup", "--json", "--agents", "claude_code"], // …but the user named agents
        { env: { PATH: path } },
      );
      assertEquals(r.code, 0, r.output);

      const agents = parseConfigOrThrow(
        await Deno.readTextFile(join(dir, "discern.toml")),
      ).guidance.agents;
      assertEquals(
        agents,
        ["claude_code"],
        `an explicit --agents must win over detection (gemini is on PATH but unrequested); got: ${
          JSON.stringify(agents)
        }`,
      );
    } finally {
      await Deno.remove(bin, { recursive: true });
    }
  });
});

Deno.test("discern setup lays a marked guidance.md stub that setup done enforces (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, ["setup", "begin"]);
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

    const r = await runAgent(dir, ["setup", "begin"]);
    assertEquals(r.code, 0, r.output);

    // TODO.md carries the original casing, not the slug-reconstructed
    // "Listoflistsoflists".
    const todo = await Deno.readTextFile(join(dir, "TODO.md"));
    assertStringIncludes(todo, "ListOfListsOfLists");
    assert(!todo.includes("Listoflistsoflists"), todo);
  });
});

Deno.test("the laid TODO.md records the deferred discern-document-subsystem work (so the doc subtrees get filled)", async () => {
  // The numbered doc subtrees ship as stubs from setup; cold runs kept mentioning the
  // deferral in passing and losing it. The skeleton now bakes it in structurally, so a
  // freshly-laid TODO always points the next session at the `discern-document-subsystem` skill.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, ["setup", "begin"]);
    assertEquals(r.code, 0, r.output);

    const todo = await Deno.readTextFile(join(dir, "TODO.md"));
    assertStringIncludes(todo, "discern-document-subsystem");
  });
});

Deno.test("setup's _adr skeleton is byte-identical to the discern-write-adr skill's (single source)", async () => {
  for (const f of ["README.md", "0000-template.md"]) {
    const setupCopy = await Deno.readTextFile(
      join(REAL_TEMPLATES, "setup", "skeleton", "docs", "_adr", f),
    );
    const skillCopy = await Deno.readTextFile(
      join(
        REAL_TEMPLATES,
        "skills",
        "discern-write-adr",
        "skeleton",
        "docs",
        "_adr",
        f,
      ),
    );
    assertEquals(
      setupCopy,
      skillCopy,
      `templates/setup/skeleton/docs/_adr/${f} must stay identical to the discern-write-adr skill's copy`,
    );
  }
});

Deno.test("scaffolded docs contain no dead relative links — setup ships what it references (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    const r = await runAgent(dir, ["setup", "begin"]);
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

Deno.test("discern setup isolates a fresh install on the discern-setup branch (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // commits everything → a clean tree on `main`
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "main",
    );

    const r = await runAgent(dir, ["setup", "begin", "--json"]);
    assertEquals(r.code, 0, r.output);
    // Setup created and checked out a dedicated branch, off the user's `main`, so
    // the scaffold's commits never land on it.
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "discern-setup",
    );
    assertEquals(JSON.parse(r.stdout).data.branch, "discern-setup");
    assert(await exists(join(dir, "discern.toml")));
  });
});

Deno.test("discern setup begin commits the scaffolded machinery, leaving docs/guidance/TODO for the agent", async () => {
  // The cold-setup failure this fixes: a coding agent's safety classifier refuses to
  // commit discern's own permission-widening wiring (.mcp.json / .claude/settings.json
  // pre-approve an MCP server), so setup ended on a dirty tree with discern's essentials
  // uncommitted. `begin` now OWNS that commit — extending the `setup done` marker-commit
  // precedent — committing exactly the machinery and nothing the agent authors.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // clean tree on `main`

    // Pin the agent set so the machinery footprint is deterministic (claude_code →
    // .mcp.json + .claude/settings.json), not whatever the CI host has on PATH.
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    assertEquals(JSON.parse(r.stdout).data.machinery_committed, true);

    // One commit, on the isolated branch, with the agreed message.
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "discern-setup",
    );
    assertStringIncludes(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "discern: scaffold harness",
    );

    // The commit holds EXACTLY discern's machinery — the config, the gitignore fragment,
    // and the per-agent MCP + hooks files — so an exact match proves both that the
    // wiring is committed AND that no authored content was swept in.
    const committed =
      (await gitOut(dir, "show", "--name-only", "--format=", "HEAD"))
        .split("\n").map((s) => s.trim()).filter(Boolean).sort();
    assertEquals(committed, [
      ".claude/settings.json",
      ".gitignore",
      ".mcp.json",
      "discern.toml",
    ]);

    // The authored-content seeds the agent fills are deliberately left UNCOMMITTED
    // (untracked) — discern committed its wiring, not the agent's canvas.
    const untracked = await gitOut(dir, "status", "--porcelain");
    for (const seed of ["guidance.md", "TODO.md", "docs/"]) {
      assertStringIncludes(untracked, seed);
    }
  });
});

Deno.test("discern setup begin commits EVERY registry-listed agent's scaffoldable config file (B10)", async () => {
  // Structural guard, in the spirit of agent_parity_test.ts: derive each agent's
  // expected machinery files from PROVIDERS itself — never a hand-copied list — so
  // a provider whose config file doesn't make it into the machinery commit fails
  // HERE automatically. This is the regression for Codex's environment.toml (the
  // worktreeApp co-managed file) being silently excluded: the committed set was
  // built from a couple of named ScaffoldOutcome fields rather than the full union
  // of what discern actually scaffolds, so a category like worktreeApp could be
  // dropped without any test noticing. Configuring every known agent at once means
  // a FUTURE provider — or a future wiring category, the same way worktreeApp once
  // joined mcp/hooks — red-lights this test the moment it isn't folded into the
  // commit, with no edit needed here to cover it.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--json",
      "--agents",
      AGENT_NAMES.join(","),
    ]);
    assertEquals(r.code, 0, r.output);
    assertEquals(JSON.parse(r.stdout).data.machinery_committed, true);

    const committed = new Set(
      (await gitOut(dir, "show", "--name-only", "--format=", "HEAD"))
        .split("\n").map((s) => s.trim()).filter(Boolean),
    );

    for (const name of AGENT_NAMES) {
      const p = providerFor(name);
      assert(p !== undefined, `no provider for ${name}`);
      const expected: string[] = [];
      if (p.mcp.kind === "wired") {
        expected.push(p.mcp.integration.configFile);
      }
      if (p.hooks !== undefined) {
        expected.push(p.hooks.settingsFile);
      }
      if (p.worktreeApp !== undefined) {
        expected.push(p.worktreeApp.configFile);
      }
      for (const file of expected) {
        assert(
          committed.has(file),
          `${name}'s scaffolded config file ${file} was not committed by ` +
            `setup begin — committed: ${
              [...committed].sort().join(", ")
            }. A new wiring category must flow into ScaffoldOutcome and ` +
            `commitScaffoldedMachinery's path union, not just get written to disk.`,
        );
      }
    }
  });
});

Deno.test("discern setup begin fails open (commits nothing, no error) when there is no setup branch", async () => {
  // The machinery auto-commit only runs when `begin` created the `discern-setup` branch.
  // With --allow-dirty (setup proceeds in place, no branch) it must NOT commit — and must
  // NOT error: the agent commits as before. Mirrors commitCompletionMarker's fail-open.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--json",
      "--allow-dirty",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.data.branch, null); // no isolated branch was created
    assertEquals(res.data.machinery_committed, false);

    // Still on `main`, and `begin` authored no commit — only the gitInit baseline exists,
    // so the scaffolded machinery sits uncommitted in the working tree for the agent.
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "main",
    );
    assertEquals(await gitOut(dir, "rev-list", "--count", "HEAD"), "1");
    assertStringIncludes(
      await gitOut(dir, "status", "--porcelain"),
      "discern.toml",
    );
  });

  // No git repo at all — also no branch — `begin` still succeeds, committing nothing.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.data.branch, null);
    assertEquals(res.data.machinery_committed, false);
  });
});

Deno.test("discern setup begin fails open (no error) when the machinery commit itself fails", async () => {
  // The auto-commit is best-effort: if the commit can't be made (e.g. commit signing,
  // simulated here by a failing pre-commit hook), `begin` must NOT error — it falls back
  // to today's behaviour, leaving the machinery for the agent to commit by hand.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    // A pre-commit hook that always fails, so the machinery commit cannot be created.
    const hook = join(dir, ".git", "hooks", "pre-commit");
    await Deno.writeTextFile(hook, "#!/bin/sh\nexit 1\n");
    await Deno.chmod(hook, 0o755);

    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output); // begin did not error
    const res = JSON.parse(r.stdout);
    assertEquals(res.data.branch, "discern-setup"); // the branch was still created
    assertEquals(res.data.machinery_committed, false); // but the commit fell open

    // No `discern: scaffold harness` commit was authored (only the gitInit baseline),
    // and the machinery is left in the working tree for the agent to commit by hand.
    assertEquals(await gitOut(dir, "rev-list", "--count", "HEAD"), "1");
    assertStringIncludes(
      await gitOut(dir, "status", "--porcelain"),
      "discern.toml",
    );
  });
});

Deno.test("discern setup refuses on a dirty tree, writing nothing; --allow-dirty overrides (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
    await gitInit(dir);
    // An uncommitted change to a TRACKED file makes the tree dirty.
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 2;\n");

    const blocked = await runAgent(dir, ["setup", "begin", "--json"]);
    assertEquals(blocked.code, 1, blocked.output);
    assertEquals(JSON.parse(blocked.stdout).error, "dirty_worktree");
    assert(
      !(await exists(join(dir, "discern.toml"))),
      "nothing must be written when setup refuses a dirty tree",
    );
    // No branch was created — still on the original branch.
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "main",
    );

    // --allow-dirty proceeds in place: no branch, scaffolds onto the current branch.
    const forced = await runAgent(dir, ["setup", "--allow-dirty"]);
    assertEquals(forced.code, 0, forced.output);
    assertEquals(
      await gitOut(dir, "rev-parse", "--abbrev-ref", "HEAD"),
      "main",
    );
    assert(await exists(join(dir, "discern.toml")));
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

Deno.test("bare `discern` shows the setup welcome in an un-set-up project, but help once set up", async () => {
  await withTempDir(async (dir) => {
    // Un-set-up project (config present, not bootstrapped): bare `discern` shows the
    // read-only welcome (in-progress), NOT the brief and NOT a scaffold (ADR 0075).
    await scaffoldEngine(dir, { bootstrapped: false });
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assertStringIncludes(bare.stdout, "IN PROGRESS");
    assert(
      !bare.stdout.includes(INSTRUCTIONS_H1),
      "the welcome is not the brief — bare `discern` must not print the brief",
    );
  });

  await withTempDir(async (dir) => {
    // Set-up project: bare `discern` shows help, not the welcome.
    await scaffoldEngine(dir); // bootstrapped by default
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assert(
      !bare.stdout.includes(INSTRUCTIONS_H1),
      "a set-up project should show help, not the welcome",
    );
    assertStringIncludes(bare.stdout, "Usage:");
  });
});

Deno.test("bare `discern` shows the fresh welcome inside a git work tree, writing nothing", async () => {
  // No discern.toml, but a git repo → bare `discern` shows the FRESH welcome (the
  // first-contact path). It is READ-ONLY: nothing is scaffolded until `setup begin`.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.py"), "print('hi')\n");
    await gitInit(dir);
    const bare = await runAgent(dir, []);
    assertEquals(bare.code, 0, bare.output);
    assertStringIncludes(bare.stdout, "isn't set up yet");
    assert(
      !(await exists(join(dir, "discern.toml"))),
      "the welcome is read-only — bare `discern` must not scaffold",
    );
  });
});

Deno.test("`discern init` and `discern bootstrap` redirect to setup with a note", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });

    const init = await runAgent(dir, ["init"]);
    assertEquals(init.code, 0, init.output);
    assertStringIncludes(init.stderr, "is now `discern setup`");
    // init/bootstrap now land on the staged `setup` welcome (in-progress here), not
    // the brief — they redirect to `setup`, which is the read-only welcome (ADR 0075).
    assertStringIncludes(init.stdout, "IN PROGRESS");

    const bootstrap = await runAgent(dir, ["bootstrap"]);
    assertEquals(bootstrap.code, 0, bootstrap.output);
    assertStringIncludes(bootstrap.stderr, "is now `discern setup`");
  });
});

Deno.test("discern setup is still callable with --force after it is recorded", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // bootstrapped by default

    // Bare `discern setup` (the welcome) now reports it is already done...
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
    // ADR 0078: `done` also requires ≥1 wired capability (a derived per-step check).
    await runAgent(dir, ["config", "set-capability", "test", "true"]);
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
    const r = await runAgent(dir, ["setup", "begin", "--json"]);
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

Deno.test("the brief teaches transparency-not-interrogation (narrate + atomic commits), not a per-step confirm gate (ADR 0044/0077)", async () => {
  // Read the printed brief directly — `templates/` is excluded from `deno fmt`,
  // so these anchors stay on one line and won't be reflowed out from under us.
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  // The interaction model is taught: the agent is the configuration engine and the
  // stance is transparency-not-interrogation (ADR 0077's revision of 0044), the
  // five-beat narration pattern, discern named as the source of the recommendation,
  // per-stage atomic commits, and the explicit carve-out for a genuine decision.
  assertStringIncludes(brief, "configuration engine");
  assertStringIncludes(brief, "transparency, not interrogation");
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

Deno.test("the brief reframes Step 0 as a relayed model question, states WHY docs, and resolves five-beats vs volume to one rule (ADR 0077)", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  // Step 0 is reframed from a self-assessment the agent can rationalize past
  // ("are you capable?") into a REQUIRED question it RELAYS to its human — setup
  // quality is bounded by the model, so the choice is the user's to make.
  assertStringIncludes(brief, "am I your most capable model");
  assert(
    !brief.includes("right tool for this job"),
    "Step 0's self-assessment framing must not return — it is now a relayed question",
  );

  // WHY documentation: the docs/guidance are the single source of truth that every
  // future agent session and discern itself read from — load-bearing infrastructure,
  // not prose for human readers. Stated before authoring AND in the closing summary.
  assertStringIncludes(brief, "single source of truth");
  assertStringIncludes(brief, "not prose for human readers");

  // The five-beats/volume tension resolves to ONE rule: the full five beats only for
  // genuine additions/forks; the obvious capabilities batch into one recommendation.
  assertStringIncludes(brief, "Reserve the full five beats");
  assertStringIncludes(brief, "concise recommendation");
});

Deno.test("the brief sequences a refresh before the first gate run and a format sweep before authoring (ADR 0077)", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  // Editing guidance.md leaves the generated agent files stale, so the brief must
  // sequence `discern refresh` before the first finish/prepare in the wiring step —
  // otherwise finish's currency check is a guaranteed first-gate failure.
  assertStringIncludes(brief, "run `discern refresh`");
  assertStringIncludes(brief, "currency check");

  // The format capability is recommended first (before authoring), so its whole-tree
  // reflow lands on the empty scaffold and later content commits stay clean.
  assertStringIncludes(brief, "ordering tip");
  assertStringIncludes(brief, "set-capability format");
});

Deno.test("the brief frames setup as a chance to add missing well-established tooling, not just wire existing tools", async () => {
  // Setup should raise the project's quality floor: a standard tool the stack is
  // MISSING is a proactive recommendation (walked through the five beats), not a
  // slot left blank. Guards against the brief drifting back to detection-only.
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );
  assertStringIncludes(brief, "raise the project's floor");
  assertStringIncludes(brief, "intend to add one");
  // The "leave unset" guidance is scoped to genuine absence, not un-adopted tools.
  assertStringIncludes(brief, "genuinely has no standard tool");
});
