/**
 * Installer `doctor` surface tests: drive `src/main.ts doctor` as a subprocess
 * (so Cliffy parsing, JSON vs human rendering, the per-check diagnostics, and the
 * exit code are all exercised for real). With the committed engine gone, the
 * checks are in-process and few: the config parses, the recorded schema is
 * current (`[meta].schema_version`), and the capabilities resolve.
 *
 * Two output channels matter. `--json` prints the payload to STDOUT. The human
 * render (no `--json`) goes to STDERR: the `Logger` writes headings, ok/error
 * lines and fix details with `console.error`; only the trailing blank `line()`
 * lands on stdout. So the human-path assertions read `stderr`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";
import { renderAgentFiles } from "../src/engine/guidance_render.ts";
import { providerFor, providersWithHooks } from "../src/lib/providers.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";

/** One check in the `doctor --json` payload. */
interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  ok: boolean;
  detail: string;
  fix?: string;
  warn?: boolean;
}

/** One annotated step in a verb's execution model. */
interface ExecStep {
  kind: string;
  label: string;
  actor: "project" | "discern";
  note?: string;
  hint?: string;
  condition?: string;
}

/** One verb's execution model. */
interface ExecVerb {
  verb: string;
  when: string;
  steps: ExecStep[];
}

/** The `doctor --json` payload shape we assert against. */
interface DoctorPayload {
  ok: boolean;
  verb: string;
  data: {
    kit_version: string;
    environment: { discern: string; platform: string; git?: string };
    checks: DoctorCheck[];
    execution_model?: ExecVerb[];
  };
}

/** Scaffold a healthy install in `dir`; assert it succeeded. */
async function setupInstall(dir: string, slug = "doc-demo"): Promise<void> {
  const { code } = await runCli([
    "setup",
    "--confirmed",
    "--yes",
    "--slug",
    slug,
  ], dir);
  assertEquals(code, 0, "setup should scaffold a healthy install");
}

/** Run `doctor --json` and return the parsed payload alongside the exit code. */
async function runDoctorJson(
  dir: string,
): Promise<{ code: number; payload: DoctorPayload }> {
  const { code, stdout } = await runCli(["doctor", "--json"], dir);
  return { code, payload: JSON.parse(stdout) as DoctorPayload };
}

/** Find a named check in a payload, asserting it is present. */
function check(payload: DoctorPayload, name: string): DoctorCheck {
  const found = payload.data.checks.find((c) => c.name === name);
  assert(found !== undefined, `expected a '${name}' check`);
  return found;
}

/** Find a verb in the execution model, asserting it (and the model) is present. */
function modelVerb(payload: DoctorPayload, verb: string): ExecVerb {
  const model = payload.data.execution_model;
  assert(model !== undefined, "expected an execution_model in the payload");
  const found = model.find((v) => v.verb === verb);
  assert(
    found !== undefined,
    `expected a '${verb}' verb in the execution model`,
  );
  return found;
}

/** Append a TOML fragment to the scaffold's config (e.g. a worktree resource). */
async function appendConfig(dir: string, toml: string): Promise<void> {
  const p = join(dir, "discern.toml");
  await Deno.writeTextFile(p, `${await Deno.readTextFile(p)}\n${toml}`);
}

/** Rewrite an install's recorded `[meta].schema_version`. */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
  );
}

/** Replace the scaffold's configured agent set. */
async function setAgents(dir: string, agents: string): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/agents = \[[^\]]*\]/, `agents = ${agents}`),
  );
}

/** Add a key under the scaffold's existing `[capabilities]` table. */
async function addCapability(
  dir: string,
  key: string,
  value: string,
): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/\[capabilities\]\n/, `[capabilities]\n${key} = "${value}"\n`),
  );
}

/** Append a `[checks.<name>]` table to the scaffold's config. */
async function addCheck(
  dir: string,
  name: string,
  stage: string,
  run: string,
): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    `${text}\n[checks.${name}]\nstage = "${stage}"\nrun = "${run}"\n`,
  );
}

Deno.test("doctor --json: a fresh install exits 0 and warns when no capabilities are wired", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(payload.ok, true);
    assertEquals(payload.verb, "doctor");
    assertEquals(payload.data.kit_version, "1.0.0");
    for (
      const name of ["discern.toml", "schema version", "capabilities", "git"]
    ) {
      assertEquals(check(payload, name).ok, true, `${name} should pass`);
    }
    for (const c of payload.data.checks) {
      assert(
        c.status === "ok" || c.status === "warn" || c.status === "fail",
        `${c.name} should carry a closed status`,
      );
    }
    const capabilities = check(payload, "capabilities");
    assertEquals(capabilities.status, "warn");
    assertEquals(capabilities.warn, true);
    assertStringIncludes(capabilities.detail, "none wired yet");
    assertStringIncludes(capabilities.fix ?? "", "[capabilities]");
    // The schema check names the current version.
    assertStringIncludes(check(payload, "schema version").detail, "current");
    // The git check reports the resolved version (triage context).
    assertStringIncludes(check(payload, "git").detail, ".");
    // The environment block is populated for bug-report triage.
    assertEquals(payload.data.environment.discern, "1.0.0");
    assert(
      payload.data.environment.platform.includes("/"),
      "platform should be os/arch",
    );
  });
});

Deno.test("every failing doctor check names a fix (shape guard over the emitted set)", async () => {
  // The per-check tests pin fix-presence one check at a time (schema version, git,
  // recipe contract, gotchas, the capability nudge…). This ties the invariant to the
  // whole emitted set: degrade the install so a broad set of checks trips at once,
  // then assert every check carries a closed status and every FAILING one names a
  // non-empty fix — an unactionable failure is a dead end. A new check that fails
  // without a remedy red-lights here rather than shipping silently.
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const cfgPath = join(dir, "discern.toml");
    let toml = await Deno.readTextFile(cfgPath);
    toml = toml.replace(/schema_version = \d+/, "schema_version = 1"); // stale → fails
    toml = toml.replace(/agents = \[[^\]]*\]/, 'agents = ["bogus_agent"]'); // unknown → fails
    await Deno.writeTextFile(cfgPath, toml);

    const { payload } = await runDoctorJson(dir);
    const failing = payload.data.checks.filter((c) => c.status === "fail");
    assert(
      failing.length >= 1,
      `the degraded fixture should fail at least one check, got: ${
        payload.data.checks.map((c) => `${c.name}:${c.status}`).join(", ")
      }`,
    );
    for (const c of payload.data.checks) {
      assert(
        c.status === "ok" || c.status === "warn" || c.status === "fail",
        `${c.name}: must carry a closed status, got "${c.status}"`,
      );
      if (c.status === "fail") {
        assert(
          (c.fix ?? "").trim().length > 0,
          `${c.name}: a failing check must name a fix (it is a dead end otherwise)`,
        );
      }
    }
  });
});

Deno.test("doctor: the git check fails with a fix when git is unreachable", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Point GIT_BIN at a name that does not resolve, so the git probe fails the
    // same way a machine with no git would — without touching the real PATH.
    const { code, stdout } = await runCli(["doctor", "--json"], dir, {
      GIT_BIN: "definitely-not-git-12345",
    });
    const payload = JSON.parse(stdout) as DoctorPayload;
    assertEquals(code, 1);
    const git = check(payload, "git");
    assertEquals(git.ok, false);
    assertStringIncludes(git.fix ?? "", "install git");
    // The environment block records git as absent (omitted) rather than crashing.
    assertEquals(payload.data.environment.git, undefined);
  });
});

Deno.test("doctor: human output reports advisories separately from failures", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "discern doctor");
    // The environment header gives at-a-glance triage context.
    assertStringIncludes(stderr, "discern 1.0.0 ·");
    assertStringIncludes(stderr, "discern.toml: present and valid TOML");
    assertStringIncludes(stderr, "schema 17 (current)");
    assertStringIncludes(stderr, "capabilities: none wired yet");
    assertStringIncludes(stderr, "git: ");
    assertStringIncludes(stderr, "All checks passed (see the advisory above).");
    const modelAt = stderr.indexOf("Execution model");
    const checksAt = stderr.indexOf("Doctor checks");
    const firstCheckAt = stderr.indexOf("discern.toml: present and valid TOML");
    const summaryAt = stderr.indexOf("All checks passed");
    assert(modelAt >= 0, "doctor should render the execution model");
    assert(checksAt > modelAt, "doctor checks should follow the model");
    assert(firstCheckAt > checksAt, "checks should render under their heading");
    assert(summaryAt > firstCheckAt, "the summary should close the output");
  });
});

Deno.test("doctor: invalid (malformed) discern.toml is flagged with a syntax fix", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    const toml = check(payload, "discern.toml");
    assertEquals(toml.ok, false);
    assertStringIncludes(toml.detail, "invalid");
    assertEquals(toml.fix, "fix the TOML syntax in discern.toml");
    // With an unparseable config the later checks have nothing to read, so they
    // are not emitted.
    assertEquals(
      payload.data.checks.find((c) => c.name === "schema version"),
      undefined,
    );
  });
});

Deno.test("doctor: human output still prints checks when the execution model cannot load", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );

    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 1);
    assert(
      !stderr.includes("Execution model"),
      "invalid config should omit the execution model",
    );
    assertStringIncludes(stderr, "Doctor checks");
    assertStringIncludes(stderr, "discern.toml: invalid");
    assertStringIncludes(stderr, "fix: fix the TOML syntax in discern.toml");
    assertStringIncludes(stderr, "1 check failed — see the fixes above.");
  });
});

Deno.test("doctor: a missing config is flagged as not initialized", async () => {
  await withTempDir(async (dir) => {
    // No `setup` here — the dir has no discern.toml.
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    const toml = check(payload, "discern.toml");
    assertEquals(toml.ok, false);
    assertStringIncludes(toml.detail, "not found");
    assertStringIncludes(toml.fix ?? "", "discern setup");
  });
});

Deno.test("doctor: a stale schema is flagged with an upgrade fix", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await setSchema(dir, 1);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const schema = check(payload, "schema version");
    assertEquals(schema.status, "fail");
    assertEquals(schema.ok, false);
    assertStringIncludes(schema.detail, "v1");
    assertStringIncludes(schema.detail, "v17");
    assertStringIncludes(schema.fix ?? "", "discern upgrade");
  });
});

Deno.test("doctor: human output for a stale schema prints the fix and a failure summary", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await setSchema(dir, 1);

    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 1);
    assertStringIncludes(stderr, "schema version:");
    assertStringIncludes(stderr, "fix: ");
    assertStringIncludes(stderr, "discern upgrade");
    // The failure summary counts the failed checks.
    assertStringIncludes(stderr, "1 check failed — see the fixes above.");
  });
});

Deno.test("doctor: an unknown capability key is flagged with a rename fix", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Inject a capability key outside the known vocabulary. Still valid TOML, so
    // the syntax check passes — but the schema check (the closed [capabilities]
    // vocabulary) flags it with the rename/move-to-[checks] guidance.
    await addCapability(dir, "bogus", "echo hi");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(check(payload, "discern.toml").ok, true);
    const schema = check(payload, "config schema");
    assertEquals(schema.status, "fail");
    assertEquals(schema.ok, false);
    assertStringIncludes(schema.detail, "bogus");
    assertStringIncludes(schema.detail, "known capability");
  });
});

Deno.test("doctor: a fresh install reports its wired capabilities", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // The default scaffold ships none wired; add a known one.
    await addCapability(dir, "test", "echo ok");
    const { payload } = await runDoctorJson(dir);
    const caps = check(payload, "capabilities");
    assertEquals(caps.status, "ok");
    assertEquals(caps.ok, true);
    assertStringIncludes(caps.detail, "test");
  });
});

Deno.test("doctor: a fresh install passes the recipe-contract check (no recipes seeded)", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // A fresh install seeds no recipes dir at all, so there is nothing sourcing
    // the retired shell library.
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(check(payload, "recipe contract").ok, true);
  });
});

Deno.test("doctor: a recipe sourcing the retired shell library is flagged with the new-contract fix", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // A recipe carried forward from a pre-binary install: it sources the engine
    // library that no longer exists, so it would break at runtime. (The default
    // [recipes].dir is discern/recipes; a fresh install seeds no recipes dir.)
    await Deno.mkdir(join(dir, "discern/recipes"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/recipes/reset"),
      '#!/usr/bin/env sh\n# desc: reset fixtures\n. "$DISCERN_LIB/bootstrap.sh"\nok done\n',
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const recipe = check(payload, "recipe contract");
    assertEquals(recipe.ok, false);
    assertStringIncludes(recipe.detail, "reset");
    assertStringIncludes(recipe.fix ?? "", "discern config get");
  });
});

Deno.test("doctor: a fresh install confirms `sh` resolves on PATH", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(check(payload, "sh").ok, true);
  });
});

Deno.test("doctor: a foreign worktree hook is an advisory warning, not a failure", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Inject another tool's worktree automation alongside the harness's own hooks
    // (which call `discern`); the harness's stay, this one is foreign.
    const p = join(dir, ".claude/settings.json");
    // deno-lint-ignore no-explicit-any
    const settings = JSON.parse(await Deno.readTextFile(p)) as any;
    settings.hooks ??= {};
    (settings.hooks.WorktreeCreate ??= []).push({
      hooks: [{ type: "command", command: "other-tool worktree-setup" }],
    });
    await Deno.writeTextFile(p, `${JSON.stringify(settings, null, 2)}\n`);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0); // an advisory does NOT make doctor unhealthy
    assertEquals(payload.ok, true);
    const wt = check(payload, "worktree automation");
    assertEquals(wt.status, "warn");
    assertEquals(wt.ok, true);
    assertEquals(wt.warn, true);
  });
});

Deno.test("doctor: nudges a [checks.x] that mirrors a standard capability (advisory)", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // A standard capability wired as a check: name `lint` at its canonical stage.
    // `echo` resolves on PATH so the command check passes — isolating the nudge.
    await addCheck(dir, "lint", "check", "echo lint");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0); // advisory — the install is healthy
    assertEquals(payload.ok, true);
    const nudge = check(payload, "capability-shaped checks");
    assertEquals(nudge.status, "warn");
    assertEquals(nudge.warn, true);
    assertStringIncludes(nudge.detail, "[checks.lint]");
    assertStringIncludes(nudge.fix ?? "", "[capabilities].lint");
  });
});

Deno.test("doctor: does NOT nudge a custom-named check, or one at a non-canonical stage", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // `licenses` is not a capability name; `lint` at stage `test` is not lint's
    // canonical stage — neither is a misfiled capability.
    await addCheck(dir, "licenses", "check", "license-scan");
    await addCheck(dir, "lint", "test", "weird");

    const { payload } = await runDoctorJson(dir);
    assertEquals(
      payload.data.checks.find((c) => c.name === "capability-shaped checks"),
      undefined,
      "no nudge for a legitimately custom check",
    );
  });
});

Deno.test("doctor: does NOT nudge when the capability slot is already wired", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // [capabilities].lint is taken, so [checks.lint] can't move there — no nudge.
    await addCapability(dir, "lint", "eslint .");
    await addCheck(dir, "lint", "check", "stylelint .");

    const { payload } = await runDoctorJson(dir);
    assertEquals(
      payload.data.checks.find((c) => c.name === "capability-shaped checks"),
      undefined,
    );
  });
});

Deno.test("doctor: flags a gotchas_doc that points at a missing file", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    assertEquals(
      (await runCli(
        ["config", "set", "project.gotchas_doc", "docs/nope.md"],
        dir,
      )).code,
      0,
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const g = check(payload, "gotchas doc");
    assertEquals(g.ok, false);
    assertStringIncludes(g.detail, "does not exist");
    assertStringIncludes(g.fix ?? "", "gotchas_doc");
  });
});

Deno.test("doctor: reports resolved guidance sources and authored skills when present", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // A guidance source + an authored skill exercise the "populated" branch of
    // both checks (a fresh install only hits the "none yet" branch).
    await Deno.writeTextFile(
      join(dir, "discern/guidance.md"),
      "# project guidance\n",
    );
    await Deno.mkdir(join(dir, "discern/skills/my-skill"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern/skills/my-skill/SKILL.md"),
      "# mine\n",
    );

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertStringIncludes(check(payload, "guidance sources").detail, "resolve");
    assertStringIncludes(check(payload, "skills").detail, "1 authored skill");
  });
});

Deno.test("doctor: surfaces per-agent integration coverage (MCP + hooks wired for all three)", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir); // default agents: claude_code + codex
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0); // a registry-described divergence is healthy, just reported

    // Claude Code wires every surface, and needs no separate trust step (discern
    // pre-approves its MCP server) — surfaced so the gap between "wired" and "active"
    // is visible (deliverable 5).
    const claude = check(payload, "agent: Claude Code");
    assertEquals(claude.ok, true);
    assertStringIncludes(claude.detail, "guidance CLAUDE.md");
    assertStringIncludes(claude.detail, "mcp");
    assertStringIncludes(claude.detail, "hooks");
    assertStringIncludes(claude.detail, "trust: not required");

    // Codex's MCP + SessionStart hooks are now WIRED (Phase B) — reported as wired, no
    // longer a pending gap — plus the one-time directory/hook trust it still needs for
    // the committed config to fire (the typed McpStatus + TrustGate made visible).
    const codex = check(payload, "agent: Codex");
    assertEquals(codex.ok, true);
    assertStringIncludes(codex.detail, "guidance AGENTS.md");
    assertStringIncludes(codex.detail, "mcp");
    assertStringIncludes(codex.detail, "hooks");
    assertEquals(
      codex.detail.includes("not wired"),
      false,
      `Codex MCP + hooks are wired now; detail should carry no "not wired" clause: ${codex.detail}`,
    );
    assertStringIncludes(codex.detail, "trust: one-time");
    assertStringIncludes(codex.detail, "--dangerously-bypass-hook-trust");
  });
});

Deno.test("doctor: fails when configured provider hook files are missing", async () => {
  await withTempDir(async (dir) => {
    const hookProviders = providersWithHooks();
    const { code: setupCode } = await runCli([
      "setup",
      "--confirmed",
      "--yes",
      "--slug",
      "doctor-hooks",
      "--agents",
      hookProviders.map((p) => p.name).join(","),
    ], dir);
    assertEquals(setupCode, 0, "setup should scaffold every hooks provider");

    for (const provider of hookProviders) {
      const hooks = provider.hooks;
      assert(hooks !== undefined);
      await Deno.remove(join(dir, hooks.settingsFile));
    }

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    for (const provider of hookProviders) {
      const hooks = provider.hooks;
      assert(hooks !== undefined);
      const hookCheck = check(payload, `agent hooks: ${provider.label}`);
      assertEquals(hookCheck.status, "fail");
      assertStringIncludes(hookCheck.detail, hooks.settingsFile);
      assertStringIncludes(hookCheck.detail, "missing");
      assertStringIncludes(hookCheck.fix ?? "", "discern refresh");
    }
  });
});

Deno.test("doctor: Cursor-only guidance report is backed by compiled AGENTS.md output", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await setAgents(dir, '["cursor"]');
    const refresh = await runCli(["refresh", "--json"], dir);
    assertEquals(refresh.code, 0, refresh.stdout + refresh.stderr);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    const cursor = check(payload, "agent: Cursor");
    assertEquals(cursor.ok, true);
    assertStringIncludes(cursor.detail, "guidance AGENTS.md");

    const rendered = await renderAgentFiles(dir);
    assertEquals(
      rendered.has("AGENTS.md"),
      true,
      "doctor must not report guidance wired for a file refresh would not render",
    );
  });
});

Deno.test("doctor: surfaces Gemini's one-time trust step and the bypass action", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Configure Gemini so its per-agent coverage row appears, then re-run doctor.
    await setAgents(dir, '["gemini"]');
    const { payload } = await runDoctorJson(dir);
    const gemini = check(payload, "agent: Gemini");
    assertEquals(gemini.ok, true);
    // The committable target, the one-time trust, and the exact bypass action.
    assertStringIncludes(gemini.detail, ".gemini/settings.json");
    assertStringIncludes(gemini.detail, "trust: one-time");
    assertStringIncludes(gemini.detail, "GEMINI_CLI_TRUST_WORKSPACE=true");
    assertStringIncludes(gemini.detail, "hooksConfig.enabled = true");
  });
});

Deno.test("doctor surfaces an integration-coverage row for EVERY configured agent", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // Configure every known agent, so each must produce its `agent: <label>` row.
    // The per-agent tests above pin each provider's specific detail; this ties the
    // ROW's existence to the registry (AGENT_NAMES), so a new agent auto-enrols —
    // the coverage loop can't quietly omit it.
    await setAgents(dir, JSON.stringify([...AGENT_NAMES]));
    const { payload } = await runDoctorJson(dir);
    for (const name of AGENT_NAMES) {
      const label = providerFor(name)?.label;
      assert(label !== undefined, `no provider label for ${name}`);
      const row = check(payload, `agent: ${label}`);
      assertEquals(
        row.ok,
        true,
        `${name}: doctor's per-agent coverage row must be ok (a divergence is reported, not failed)`,
      );
      assert(
        row.detail.trim().length > 0,
        `${name}: the coverage row must carry a non-empty detail naming its surfaces`,
      );
    }
  });
});

Deno.test("doctor --json: carries the execution model, each step marked project/discern with a hint", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await addCapability(dir, "lint", "echo lint"); // a real [project] gate command
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    // Every configurable verb the issue-template goal needs is covered.
    for (
      const v of [
        "finish",
        "prepare",
        "test",
        "ratchets",
        "start",
        "worktree ensure",
        "integrate",
        "graduate",
        "worktree prune",
      ]
    ) {
      modelVerb(payload, v);
    }
    const finish = modelVerb(payload, "finish");
    // A built-in precondition is discern's, and every step carries a hint.
    const merge = finish.steps.find((s) => s.label === "merge-check");
    assert(merge !== undefined, "finish should run the merge-check");
    assertEquals(merge.actor, "discern");
    assert((merge.hint ?? "").length > 0, "every step should carry a hint");
    // The lint capability we wired is the user's own command.
    const lint = finish.steps.find((s) => s.label === "lint");
    assert(lint !== undefined, "finish should run the lint capability");
    assertEquals(lint.actor, "project");
    assertEquals(lint.note, "echo lint");
  });
});

Deno.test("doctor --json: a per-worktree resource shows its teardown step with the user's command", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    await appendConfig(
      dir,
      '[worktree.resources.db]\ncreate = "createdb x"\ndestroy = "dropdb x"\n',
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    // The user's destroy command is surfaced verbatim as a [project] teardown step — the
    // motivating "why did graduate tear down my database?" answered up front.
    const grad = modelVerb(payload, "graduate");
    const destroy = grad.steps.find((s) => s.kind === "resource-destroy");
    assert(destroy !== undefined, "graduate should tear the resource down");
    assertEquals(destroy.actor, "project");
    assertEquals(destroy.note, "dropdb x");
  });
});

Deno.test("doctor: human output prints the execution-model section on stderr", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    // The human render goes to stderr like the rest of doctor's narration.
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "Execution model");
    assertStringIncludes(stderr, "[discern] merge-check");
    assertStringIncludes(stderr, "\ngraduate\n");
  });
});

Deno.test("doctor: human output hides step hints by default and points to --verbose (top and foot)", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    // Step lines are present; their explanatory hints are not — the default render stays
    // a scannable sequence before the actionable checks close the output.
    assertStringIncludes(stderr, "[discern] merge-check");
    assert(
      !stderr.includes("A built-in git mutation"),
      "a step hint must not appear in the default (non-verbose) render",
    );
    // The opt-in pointer is shown twice: at the top of the section and at its foot (the
    // model is long enough to scroll past the first).
    const pointers =
      stderr.split("to show hints explaining each execution step").length - 1;
    assertEquals(
      pointers,
      2,
      "the --verbose pointer should appear at the top and the foot",
    );
  });
});

Deno.test("doctor --verbose: shows every step's hint, undeduplicated, and drops the pointer", async () => {
  await withTempDir(async (dir) => {
    await setupInstall(dir);
    const { code, stderr } = await runCli(["doctor", "--verbose"], dir);
    assertEquals(code, 0);
    // Hints are shown and never deduplicated: the git hint recurs on every git step
    // within a single verb (graduate runs several), so it appears more than
    // once in that one section — the ambiguity a per-verb dedup would introduce.
    const start = stderr.indexOf("\ngraduate\n");
    const section = stderr.slice(
      start,
      stderr.indexOf("worktree prune", start),
    );
    const gitHints = section.split("A built-in git mutation").length - 1;
    assert(
      gitHints > 1,
      `the git hint should repeat within a verb (no dedup); saw ${gitHints}`,
    );
    // The pointer is for the default render only — with hints shown it would be noise.
    assert(
      !stderr.includes("to show hints explaining each execution step"),
      "the --verbose pointer should not appear when hints are already shown",
    );
  });
});

Deno.test("doctor --json: omits the execution model when there is no readable config", async () => {
  await withTempDir(async (dir) => {
    // No init — no discern.toml to derive a model from, so the field is omitted
    // (the failing checks are the actionable report; a defaults-derived model would
    // only add noise to a broken install).
    const { payload } = await runDoctorJson(dir);
    assertEquals(payload.data.execution_model, undefined);
  });
});
