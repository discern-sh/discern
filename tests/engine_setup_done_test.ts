/**
 * Engine tests for the `setup done` flow and its follow-through: the gate
 * proof, the worktree probe, the completion-marker commits, pre-existing
 * agent-file migration, agent detection, the laid docs, branch isolation, and
 * the setup brief's teaching. Split from `engine_setup_test.ts` so
 * `deno test --parallel` (which distributes per FILE) can spread these serial
 * setup runs across workers.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, relative } from "@std/path";
import { exists, walk } from "@std/fs";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
import {
  defaultMapPath,
  git,
  gitInit,
  gitOut,
  parsedCommitTrailers,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import {
  AGENT_NAMES,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { allGuidanceFilePaths, providerFor } from "../src/lib/providers.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { DISCERN_BOT } from "../src/shared/brand.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { INSTRUCTIONS_H1 } from "./engine_setup_shared.ts";

async function readyForDone(
  dir: string,
  cmd: string,
  env: Record<string, string> = {},
): Promise<void> {
  await scaffoldEngine(dir, { bootstrapped: false });
  await gitInit(dir);
  await runAgent(dir, ["setup", "begin", "--confirmed"], { env }); // lay the skeletons
  // Replace the marker-carrying skeletons with real, marker-free content. The
  // guidance.md carries a real pitch and a Conventions section so the per-step
  // guidance check (ADR 0078) passes; design-principles is left absent (N/A).
  await Deno.remove(defaultMapPath(dir), { recursive: true });
  await Deno.mkdir(defaultMapPath(dir));
  await Deno.writeTextFile(
    defaultMapPath(dir, "README.md"),
    "# Real docs\n",
  );
  await Deno.writeTextFile(
    join(dir, "discern/guidance.md"),
    "# Project guidance\n\nA real pitch describing the project and who it serves.\n\n## Conventions\n\nReal, project-specific conventions.\n",
  );
  const wired = await runAgent(dir, ["config", "set-job", "test", cmd], {
    env,
  });
  assertEquals(wired.code, 0, wired.output);
}

Deno.test("setup done runs the gate and records bootstrapped only when green (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // a passing gate
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

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

Deno.test("setup done blocks when the refresh proof only partially completes", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(dir, ".mcp.json"), malformed);
    // Committed sabotage: the clean-tree precondition passes, so the failure
    // surfaces at the refresh stage of the proof, not as uncommitted work.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "gate_failed");
    assertEquals(res.data.stage, "refresh");
    assertStringIncludes(res.message, "malformed JSON");
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "setup done must not record completion after a partial refresh",
    );
  });
});

// ── the clean-tree precondition + the worktree-viability probe (ADR 0090) ────────
// `setup done` proves the gate in the main checkout AND in a throwaway worktree — the
// copy every future task runs in — so an env-anchored app can't pass setup and then
// break on the first real task. The probe branches from the current (unlanded) HEAD,
// so the agent's setup work must be committed for it to travel — which the clean-tree
// precondition enforces: `done` refuses while tracked changes (anywhere) or untracked
// authored-setup files sit uncommitted, so the probe always proves the tree the agent
// actually authored, never a thinner one.

Deno.test("setup done refuses while the authored setup is uncommitted, naming what to commit", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // authored — but nothing committed since scaffold

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "uncommitted_changes");
    const uncommitted: string[] = res.data.uncommitted;
    assert(
      uncommitted.some((l) => l.includes("discern.toml")),
      `the wired config must be listed:\n${done.stdout}`,
    );
    assert(
      uncommitted.some((l) => l.includes("discern/")),
      `the authored docs/guidance must be listed:\n${done.stdout}`,
    );
    assertStringIncludes(res.message, "Commit these as your authoring commits");
    // Nothing recorded — status keeps reporting setup unfinished.
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "an uncommitted setup must not record completion",
    );

    // Commit the authoring work; the same `done` now proceeds to the proof and passes.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");
    const again = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(again.code, 0, again.output);
    assertEquals(JSON.parse(again.stdout).data.bootstrapped, true);
  });
});

Deno.test("setup done catches an untracked footprint file whose path git quotes (B50)", async () => {
  // git C-quotes any path with non-ASCII bytes in line-oriented `--porcelain` output
  // (core.quotePath defaults on): `?? "discern/map/d\303\251cisions.md"`. A clean-tree
  // check that de-quotes by hand — slice(2).trim() then startsWith the unquoted footprint
  // prefix — never matches the quoted form, so `done` would proceed and record completion
  // over uncommitted authored work. The end-to-end guard for the `-z` porcelain parsing:
  // a real non-ASCII authored doc must still block completion. Pairs with the unit
  // coverage in git_paths_test.ts and the structural -z guard in git_path_quoting_test.ts.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");

    // Commit ALL the authored setup, so the ONLY uncommitted thing is the non-ASCII doc
    // below — the clean-tree check has exactly one path to catch, and it is a quoted one.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    // An untracked authored doc inside the footprint (the configured map tree) whose
    // name carries a non-ASCII byte, so git quotes it in line-oriented porcelain output.
    const quotedName = "décisions.md";
    await Deno.writeTextFile(
      defaultMapPath(dir, quotedName),
      "# A real authored decision\n",
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.ok, false);
    assertEquals(
      res.error,
      "uncommitted_changes",
      `a quoted-path untracked footprint file must block completion; got ${done.stdout}`,
    );
    const uncommitted: string[] = res.data.uncommitted;
    assert(
      uncommitted.some((l) => l.includes(quotedName)),
      `the non-ASCII authored doc must be named as uncommitted (verbatim, not a ` +
        `C-quoted mangling):\n${JSON.stringify(uncommitted)}`,
    );
    // Nothing recorded — completion cannot be stamped over the uncommitted authored file.
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "completion must not be recorded over an uncommitted quoted-path footprint file",
    );
  });
});

Deno.test("the worktree probe proves the CONFIGURED gate against the authored setup, not an empty tree", async () => {
  await withTempDir(async (dir) => {
    // A gate that can only pass when the AUTHORED content traveled into the probe:
    // before the clean-tree precondition, the probe branched from a HEAD holding
    // none of it and "proved" a vacuously green gate.
    await readyForDone(dir, "grep -q Conventions discern/guidance.md");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(
      res.data.worktree_proven,
      true,
      "the probe must run the configured gate against the authored tree",
    );
  });
});

Deno.test("setup done proves the project viable in a worktree and reports it, then tears the probe down (ADR 0090)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // a marker-free project with a passing gate
    // Commit the setup work so the probe worktree (branched from HEAD) sees the wired
    // config — the atomic-commit discipline the brief asks of the agent.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(
      res.data.worktree_proven,
      true,
      "the probe proved the gate green in a worktree",
    );
    // The throwaway probe left nothing behind — no worktree, no `agent/` branch.
    const worktrees = await gitOut(dir, "worktree", "list", "--porcelain");
    assert(
      !worktrees.includes(".worktrees"),
      `the probe worktree leaked:\n${worktrees}`,
    );
    assertEquals(
      (await gitOut(dir, "branch", "--list", "agent/*")).trim(),
      "",
      "the probe branch leaked",
    );
  });

  // The human render claims the coverage it earned.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");
    const done = await runAgent(dir, ["setup", "done"]);
    assertEquals(done.code, 0, done.output);
    assertStringIncludes(done.stdout, "runs inside a worktree");
  });
});

Deno.test("setup done blocks when the gate is green here but red in a worktree — the env-anchored app (ADR 0090)", async () => {
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    // A smoke check that needs a file present only in the main checkout — the shape of an
    // env-anchored app (an untracked `.env`, an uninstalled dependency dir): it passes
    // here, but the file never travels into a fresh worktree.
    const wired = await runAgent(dir, [
      "config",
      "set-job",
      "smoke",
      "test -f PROBE_ANCHOR",
    ]);
    assertEquals(wired.code, 0, wired.output);
    // Commit the config so `smoke` travels to the probe, but create the anchor AFTER the
    // commit so it stays untracked — present here, absent in the copy.
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "setup work", "--no-gpg-sign");
    await Deno.writeTextFile(join(dir, "PROBE_ANCHOR"), "present only here\n");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "gate_failed");
    assertEquals(
      res.data.stage,
      "worktree_probe",
      "the failure names the probe stage, not the main-checkout gate",
    );
    // The proof failed, so completion is NOT recorded — status keeps reporting unfinished.
    assert(
      !(await Deno.readTextFile(join(dir, "discern.toml"))).includes(
        "bootstrapped = true",
      ),
      "bootstrapped must not be recorded when the probe is red",
    );
    // And the probe was still torn down (a red probe must not strand its worktree).
    assert(
      !(await gitOut(dir, "worktree", "list", "--porcelain")).includes(
        ".worktrees",
      ),
      "the red probe leaked its worktree",
    );
  });
});

Deno.test("setup done commits the completion marker when discern.toml is the only tracked change", async () => {
  // The completion marker [meta].bootstrapped was written but never committed, so a
  // diligent atomic-commit setup still ended with a dirty tree. Untracked local
  // scratch files (for example an agent's permission/session file) must not block
  // the marker commit: the commit is pathspec-limited to discern.toml.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true"); // gitInits + lays a passing, marker-free project
    // Simulate the agent's atomic commits: wire the harness (MCP etc.) and commit
    // everything, so the marker is the only change `done` introduces.
    await runAgent(dir, ["refresh"]);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    await Deno.mkdir(join(dir, ".codex"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/session.local.toml"),
      "permission = 'local'\n",
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(res.data.marker_committed, true);
    // The marker landed in its own commit; the unrelated local scratch remains.
    const status = await gitOut(dir, "status", "--porcelain");
    assertEquals(
      status.includes("discern.toml"),
      false,
      `the marker should be committed independently\n${status}`,
    );
    assertStringIncludes(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "Mark discern setup complete",
    );
    assertEquals(await parsedCommitTrailers(dir), DISCERN_BOT.trailer);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern.toml")),
      "bootstrapped = true",
    );
    assertStringIncludes(
      status,
      "?? .codex/",
    );
  });
});

Deno.test("setup-authored commits omit attribution when DISCERN_NO_ATTRIBUTION is set", async () => {
  await withTempDir(async (dir) => {
    const env = { [DISCERN_NO_ATTRIBUTION]: "1" };
    await readyForDone(dir, "true", env);
    assertEquals(
      await parsedCommitTrailers(dir),
      "",
      "the scaffold-wiring commit should honor the environment opt-out",
    );

    await runAgent(dir, ["refresh"], { env });
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    const done = await runAgent(dir, ["setup", "done", "--json"], { env });
    assertEquals(done.code, 0, done.output);
    assertEquals(JSON.parse(done.stdout).data.marker_committed, true);
    assertEquals(
      await parsedCommitTrailers(dir),
      "",
      "the setup-completion commit should honor the environment opt-out",
    );
  });
});

Deno.test("setup done refuses on an uncommitted tracked change; --force still commits only the marker", async () => {
  // A tracked edit anywhere blocks `done` (the clean-tree precondition). Under
  // `--force` — which skips the whole proof — the marker auto-commit's narrower
  // safety invariant still holds: the marker commit includes only discern.toml,
  // and the unrelated edit is left for the agent's own tidy commit.
  await withTempDir(async (dir) => {
    await readyForDone(dir, "true");
    await runAgent(dir, ["refresh"]);
    await git(dir, "add", "-A");
    await git(dir, "commit", "-m", "setup work");
    // An unrelated uncommitted change present at `done` time.
    await Deno.writeTextFile(
      defaultMapPath(dir, "README.md"),
      "# changed again\n",
    );

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const refused = JSON.parse(done.stdout);
    assertEquals(refused.error, "uncommitted_changes");
    assert(
      refused.data.uncommitted.some((l: string) =>
        l.includes(`${SOURCE_PATHS.map.defaultPath}README.md`)
      ),
      `the tracked edit must be listed:\n${done.stdout}`,
    );

    const forced = await runAgent(dir, ["setup", "done", "--force", "--json"]);
    assertEquals(forced.code, 0, forced.output);
    const res = JSON.parse(forced.stdout);
    assertEquals(res.data.bootstrapped, true);
    assertEquals(res.data.marker_committed, true);
    assertStringIncludes(
      await gitOut(dir, "log", "-1", "--format=%s"),
      "Mark discern setup complete",
    );
    const status = await gitOut(dir, "status", "--porcelain");
    assertEquals(
      status.includes("discern.toml"),
      false,
      `the marker should be committed independently\n${status}`,
    );
    assertStringIncludes(
      status,
      `M ${SOURCE_PATHS.map.defaultPath}README.md`,
      "the unrelated edit must be left for the agent's own tidy commit",
    );
  });
});

Deno.test("a forced done fails open when discern.toml carries an extra uncommitted edit beyond the marker", async () => {
  // discern.toml is the lone changed file, but it has more than the marker line dirty
  // (config the agent didn't commit). Only "that one dirty line" earns the auto-commit.
  // Reached via --force — the clean-tree precondition refuses this state otherwise.
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

    const done = await runAgent(dir, ["setup", "done", "--force", "--json"]);
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
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "author the setup", "--no-gpg-sign");

    const done = await runAgent(dir, ["setup", "done", "--json"]);
    assertEquals(done.code, 1, done.output);
    const res = JSON.parse(done.stdout);
    assertEquals(res.error, "gate_failed");
    assertEquals(res.data.stage, "done");
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

    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // The user's instruction survives in the tracked source...
    const guidance = await Deno.readTextFile(join(dir, "discern/guidance.md"));
    assertStringIncludes(guidance, rule);
    assertStringIncludes(guidance, "Imported from CLAUDE.md");

    // ...and is re-emitted into the agent files (the compile folds
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

Deno.test("discern setup migrates EVERY provider's pre-existing instruction file — configured or not (the verify promise)", async () => {
  // `setup verify` names the pre-existing instruction files of ALL known
  // providers and promises "begin preserves them by folding their content into
  // the guidance source — nothing is lost". The migration must therefore cover
  // the full provider registry, not just the configured agent set: a
  // hand-authored file for an unwired agent is otherwise never folded, becomes
  // gitignored by the scaffold, and a later `discern uninstall` deletes it.
  // Driven off allGuidanceFilePaths() (the registry aggregator `verify` reads),
  // so a new provider's instruction path auto-enrols in this guard.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);
    // Written AFTER the init commit, so each file is UNTRACKED — the fresh-repo
    // shape where a dropped migration is unrecoverable (no git history holds it).
    const paths = allGuidanceFilePaths();
    for (const rel of paths) {
      await Deno.writeTextFile(
        join(dir, rel),
        `# ${rel}\n\nHOUSE RULE from ${rel}: never break userspace.\n`,
      );
    }
    // Wire ONLY claude_code, so every other provider's file belongs to an
    // unconfigured agent — the set the migration used to silently skip.
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);

    const guidance = await Deno.readTextFile(join(dir, "discern/guidance.md"));
    for (const rel of paths) {
      assertStringIncludes(
        guidance,
        `HOUSE RULE from ${rel}`,
        `the pre-existing ${rel} must be folded into guidance.md whether or not ` +
          `its agent is configured — verify promised the user nothing is lost.`,
      );
      assertStringIncludes(guidance, `Imported from ${rel}`);
    }
  });
});

/**
 * Plant a fake executable named `name` in a fresh temp "bin" dir and return a PATH
 * with that dir prepended to the real one. The executable may be a terminal-agent
 * launcher or a setup-only editor command. The caller removes `bin` when done.
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

Deno.test("discern setup persists an editor-only Cursor installation into [project].agents", async () => {
  // The resolver is unit-tested; this proves the SETUP WIRING — freshInstall &&
  // no --agents → write the detected set into discern.toml — actually lands, so a
  // future setup refactor cannot silently drop IDE installation evidence.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // a clean repo → setup runs its normal fresh-install path

    // `cursor` is the editor shell command, not the separate `cursor-agent`
    // terminal launcher. This is the end-to-end form of the reported regression.
    const { path, bin } = await pathWithFakeAgent("cursor");
    try {
      const r = await runAgent(
        dir,
        ["setup", "begin", "--confirmed", "--json"],
        {
          env: { PATH: path },
        },
      );
      assertEquals(r.code, 0, r.output);

      // cursor ∉ DEFAULT_AGENTS, so it is in the WRITTEN config only via detection.
      // `[project].agents` is optional (unset ≠ explicit []); detection writes an
      // explicit list, so it must be present here — an absent key would itself be
      // the regression this guards.
      const agents = parseConfigOrThrow(
        await Deno.readTextFile(join(dir, "discern.toml")),
      ).project.agents;
      assert(
        agents !== undefined && agents.includes("cursor"),
        `the editor-only Cursor installation must be persisted to [project].agents — ` +
          `a setup refactor dropping IDE evidence fails here. Got: ${
            JSON.stringify(agents)
          }`,
      );
    } finally {
      await Deno.remove(bin, { recursive: true });
    }
  });
});

Deno.test("discern setup honours an explicit --agents over installation detection (the agents-unset guard)", async () => {
  // The other half of the condition: when the user NAMES agents, detection is
  // skipped (`effectiveFlags.agents === undefined` is false), so a detected-but-
  // unrequested agent never sneaks into the config.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir);

    const { path, bin } = await pathWithFakeAgent("gemini"); // detected as installed…
    try {
      const r = await runAgent(
        dir,
        ["setup", "--confirmed", "--json", "--agents", "claude_code"], // …but the user named agents
        { env: { PATH: path } },
      );
      assertEquals(r.code, 0, r.output);

      const agents = parseConfigOrThrow(
        await Deno.readTextFile(join(dir, "discern.toml")),
      ).project.agents;
      assertEquals(
        agents,
        ["claude_code"],
        `an explicit --agents must win over detection (gemini is installed but unrequested); got: ${
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
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // The stub exists and carries the marker, so it is a real "flesh out the stub".
    const guidance = await Deno.readTextFile(join(dir, "discern/guidance.md"));
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

    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    // TODO.md carries the original casing, not the slug-reconstructed
    // "Listoflistsoflists".
    const todo = await Deno.readTextFile(join(dir, "discern/TODO.md"));
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
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    const todo = await Deno.readTextFile(join(dir, "discern/TODO.md"));
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
    const r = await runAgent(dir, ["setup", "begin", "--confirmed"]);
    assertEquals(r.code, 0, r.output);

    const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    const dead: string[] = [];
    for await (
      const entry of walk(defaultMapPath(dir), {
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

    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"]);
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

Deno.test("discern setup begin refuses to start from a feature branch when the trunk exists", async () => {
  // A setup branch forks from the CURRENT HEAD, and `setup accept` later
  // fast-forwards the integration branch to it — so a setup begun on a
  // feature branch would sweep that branch's unmerged commits onto `main`.
  // begin must refuse and name the exact recovery, leaving the tree untouched.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "main.ts"), "console.log('hi');\n");
    await gitInit(dir); // commits on `main`
    // A remote default branch so detection picks `main` even from feature-x.
    const sha = await gitOut(dir, "rev-parse", "main");
    await git(dir, "update-ref", "refs/remotes/origin/main", sha);
    await git(
      dir,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    await git(dir, "checkout", "-q", "-b", "feature-x");
    await Deno.writeTextFile(join(dir, "wip.txt"), "unfinished feature\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "feature WIP", "--no-gpg-sign");

    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEquals(JSON.parse(r.stdout).error, "not_on_trunk");

    // Nothing was scaffolded and no setup branch was created.
    assert(!(await exists(join(dir, "discern.toml"))));
    assertEquals(await gitOut(dir, "branch", "--show-current"), "feature-x");
    const branches = await gitOut(dir, "branch", "--format=%(refname:short)");
    assert(!branches.includes("discern-setup"));
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
      "--confirmed",
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
      "discern: scaffold wiring",
    );
    assertEquals(await parsedCommitTrailers(dir), DISCERN_BOT.trailer);
    assertEquals(
      await gitOut(
        dir,
        "log",
        "-1",
        "--format=%an <%ae>|%cn <%ce>",
      ),
      "Engine Test <engine-test@example.com>|Engine Test <engine-test@example.com>",
      "discern must leave the invoking user's author and committer identities intact",
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
    // -uall expands the untracked discern/ dir so each seed is listed per-file.
    const untracked = await gitOut(dir, "status", "--porcelain", "-uall");
    for (
      const seed of [
        "discern/guidance.md",
        "discern/TODO.md",
        SOURCE_PATHS.map.defaultPath,
      ]
    ) {
      assertStringIncludes(untracked, seed);
    }
  });
});

Deno.test("discern setup begin commits EVERY registry-listed agent's scaffoldable config file (B10)", async () => {
  // Structural guard, in the spirit of agent_parity_test.ts: derive each agent's
  // expected machinery files from PROVIDERS itself — never a hand-copied list — so
  // a provider whose config file doesn't make it into the machinery commit fails
  // HERE automatically. This is the regression class for provider wiring categories
  // (Codex environment.toml, project rules, or a future surface) being silently
  // excluded: the committed set must be the full union of what discern actually
  // scaffolds, not a couple of named fields.
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
      if (p.projectRules !== undefined) {
        expected.push(p.projectRules.rulesFile);
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
      "--confirmed",
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
      "--confirmed",
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
      "--confirmed",
      "--json",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output); // begin did not error
    const res = JSON.parse(r.stdout);
    assertEquals(res.data.branch, "discern-setup"); // the branch was still created
    assertEquals(res.data.machinery_committed, false); // but the commit fell open

    // No `discern: scaffold wiring` commit was authored (only the gitInit baseline),
    // and the machinery is left in the working tree for the agent to commit by hand.
    assertEquals(await gitOut(dir, "rev-list", "--count", "HEAD"), "1");
    assertStringIncludes(
      await gitOut(dir, "status", "--porcelain"),
      "discern.toml",
    );
  });
});

Deno.test("begin reports the scaffold by category, never the old flat count", async () => {
  // "Harness files written: 6" undercounted what the scaffold commit contains
  // (the provider wiring), reading as a false containment claim. The summary now
  // counts per category, derived from the same ScaffoldOutcome arrays the
  // machinery commit is built from.
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
    await gitInit(dir);
    // Pin the agent set so the wired categories are deterministic.
    const r = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--agents",
      "claude_code",
    ]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "Files written into");
    assertStringIncludes(r.stdout, "seed file");
    assertStringIncludes(r.stdout, "agent file");
    assertStringIncludes(r.stdout, "MCP config");
    assert(
      !r.stdout.includes("files written:"),
      "the flat count must not survive",
    );
  });
});

Deno.test("a fresh begin without --confirmed refuses with awaiting_consent, re-serving verify's message (ADR 0086)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
    await gitInit(dir);

    // The consent attestation is required for a fresh, non-declarative scaffold. Absent
    // it, begin refuses BEFORE writing anything — the error path is the teaching path.
    const blocked = await runAgent(dir, ["setup", "begin", "--json"]);
    assertEquals(blocked.code, 1, blocked.output);
    const res = JSON.parse(blocked.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "awaiting_consent");
    assertStringIncludes(res.data.command, "--confirmed");
    // Nothing was written — the read-only→destructive boundary held.
    assert(
      !(await exists(join(dir, "discern.toml"))),
      "awaiting_consent must write nothing",
    );

    // Single source: the refusal's guidance is byte-identical to what `verify` serves,
    // so an agent that skipped verify is handed the very same conversation (ADR 0086).
    const verifyGuidance = JSON.parse(
      (await runAgent(dir, ["setup", "verify", "--json"])).stdout,
    ).data.guidance;
    assertEquals(res.data.guidance, verifyGuidance);
    assertStringIncludes(res.data.guidance, "Am I your most capable model");

    // The human render carries the same message verbatim (dual-addressed, ADR 0078),
    // and still writes nothing.
    const human = await runAgent(dir, ["setup", "begin"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.stdout, res.data.guidance);
    assert(!(await exists(join(dir, "discern.toml"))));

    // --dry-run is exempt: consent gates writes, and a dry run writes nothing —
    // a preview refusing without --confirmed made the consent gate look arbitrary.
    const preview = await runAgent(dir, [
      "setup",
      "begin",
      "--dry-run",
      "--json",
    ]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(JSON.parse(preview.stdout).dry_run, true);
    assert(
      !(await exists(join(dir, "discern.toml"))),
      "a dry run must still write nothing",
    );
  });
});

Deno.test("discern setup refuses on a dirty tree, writing nothing; --allow-dirty overrides (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 1;\n");
    await gitInit(dir);
    // An uncommitted change to a TRACKED file makes the tree dirty.
    await Deno.writeTextFile(join(dir, "app.ts"), "export const v = 2;\n");

    const blocked = await runAgent(dir, [
      "setup",
      "begin",
      "--confirmed",
      "--json",
    ]);
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
    const r = await runAgent(dir, ["done"]);
    assertEquals(r.code, 1, r.output);
    assert(
      !r.stderr.includes("isn't set up yet"),
      "the redirect must not bury the real TOML parse error",
    );
  });
});

Deno.test("bare `discern` shows the setup welcome in an un-set-up project, but help once set up", async () => {
  await withTempDir(async (dir) => {
    // Un-set-up project (config present, not set up): bare `discern` shows the
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
    await Deno.mkdir(defaultMapPath(dir), { recursive: true });
    await Deno.writeTextFile(
      defaultMapPath(dir, "README.md"),
      "# Docs\n\nSee the sample config (EXAMPLE) in the appendix.\n",
    );
    // ADR 0078: `done` also requires ≥1 wired capability (a derived per-step check).
    await runAgent(dir, ["config", "set-job", "test", "true"]);
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
    const r = await runAgent(dir, ["setup", "begin", "--confirmed", "--json"]);
    assertEquals(r.code, 0, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.verb, "setup");
    assert(res.data.skeletons.includes(SOURCE_PATHS.map.defaultPath));
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

  // Step 0 is a CHECKPOINT: `verify` serves the model question in its consent message,
  // and Step 0 confirms it actually reached the human (asking now if it was skipped) —
  // not a self-assessment the agent can rationalize past (ADR 0086).
  assertStringIncludes(brief, "am I your most capable model");
  assertStringIncludes(brief, "## Step 0 — Checkpoint");
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
  // genuine additions/forks; the obvious jobs batch into one recommendation.
  assertStringIncludes(brief, "Reserve the full five beats");
  assertStringIncludes(brief, "concise recommendation");
});

Deno.test("the brief wires the gate before any authoring, with a refresh before the first gate run (ADR 0077)", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  // The gate step precedes every authoring step, so a setup session that dies
  // mid-authoring still leaves the project protected — and the format job's
  // whole-tree sweep lands on the unauthored scaffold, keeping later content
  // commits clean. Guards against the job step drifting back behind the
  // authoring steps.
  const gateStep = brief.indexOf(
    "## Step 2 — Sniff the stack and recommend the jobs",
  );
  const firstAuthoringStep = brief.indexOf(
    "## Step 4 — Draft the design principles",
  );
  assert(gateStep !== -1 && firstAuthoringStep !== -1);
  assert(
    gateStep < firstAuthoringStep,
    "the job step must precede the authoring steps",
  );
  assertStringIncludes(brief, "Wire the project's formatter first");

  // Stale generated files fail `done`'s currency check, so the brief must sequence
  // `discern refresh` before the first gate run in the wiring step — otherwise the
  // first gate run is a guaranteed failure.
  assertStringIncludes(brief, "run `discern refresh`");
  assertStringIncludes(brief, "currency check");
});

Deno.test("the brief keeps wired commands honest: exit-on-its-own, install consent, worktree convergence", async () => {
  const brief = await Deno.readTextFile(
    join(REAL_TEMPLATES, "setup", "instructions.md"),
  );

  // Step 7: every wired command must terminate non-interactively — watch-mode
  // runners in their single-run form — so a watcher trips the gate's timeout in
  // authoring, not on every later run.
  assertStringIncludes(brief, "must exit on its own");
  assertStringIncludes(brief, "single-run form");

  // Step 7: installing a NEW dependency is a batched consent point (ADR 0113),
  // while wiring an existing tool stays narrate-and-proceed.
  assertStringIncludes(
    brief,
    "installing a new dependency is a genuine decision",
  );
  assertStringIncludes(brief, "never a narrate-and-proceed");
  assertStringIncludes(
    brief,
    "_Wiring a tool the project already has_ stays narrate-and-proceed",
  );

  // Step 8: convergence is check-then-install (the template's own
  // fast-when-current rule), env inheritance and the database rows are in the
  // culprits table, and hosted databases get honesty rather than magic.
  assertStringIncludes(brief, "fast when current");
  assertStringIncludes(brief, "check-then-install");
  assertStringIncludes(brief, "env-file secrets (any stack)");
  assertStringIncludes(brief, "a file-based database");
  assertStringIncludes(
    brief,
    "discern can't conjure isolated copies of a hosted service",
  );

  // The config template's smoke example is a placeholder that fails loudly if
  // copied verbatim — the old `node -e 'require(\"./\")'` silently failed on
  // ESM-first projects.
  const tmpl = await Deno.readTextFile(
    join(REAL_TEMPLATES, "discern.toml.tmpl"),
  );
  assertStringIncludes(tmpl, '# smoke     = "your-app --version"');
  assertStringIncludes(
    tmpl,
    "`discern done` and `discern test` run it in the same fail-fast test group",
  );
  assert(
    !tmpl.includes("node -e"),
    "the copy-paste-wrong smoke example must not return",
  );
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
