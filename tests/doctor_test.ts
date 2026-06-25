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

/** One check in the `doctor --json` payload. */
interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  warn?: boolean;
}

/** The `doctor --json` payload shape we assert against. */
interface DoctorPayload {
  ok: boolean;
  verb: string;
  data: {
    kit_version: string;
    environment: { discern: string; platform: string; git?: string };
    checks: DoctorCheck[];
  };
}

/** Scaffold a healthy install in `dir`; assert it succeeded. */
async function initInstall(dir: string, slug = "doc-demo"): Promise<void> {
  const { code } = await runCli(["init", "--yes", "--slug", slug], dir);
  assertEquals(code, 0, "init should scaffold a healthy install");
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

/** Rewrite an install's recorded `[meta].schema_version`. */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
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

Deno.test("doctor --json: a fresh install is fully healthy and exits 0", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
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

Deno.test("doctor: the git check fails with a fix when git is unreachable", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
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

Deno.test("doctor: human (non-json) output reports a clean bill on stderr, exit 0", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "discern doctor");
    // The environment header gives at-a-glance triage context.
    assertStringIncludes(stderr, "discern 1.0.0 ·");
    assertStringIncludes(stderr, "discern.toml: present and valid TOML");
    assertStringIncludes(stderr, "schema 10 (current)");
    assertStringIncludes(stderr, "git: ");
    assertStringIncludes(stderr, "All checks passed.");
  });
});

Deno.test("doctor: invalid (malformed) discern.toml is flagged with a syntax fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
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

Deno.test("doctor: a missing config is flagged as not initialized", async () => {
  await withTempDir(async (dir) => {
    // No `init` here — the dir has no discern.toml.
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
    await initInstall(dir);
    await setSchema(dir, 1);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const schema = check(payload, "schema version");
    assertEquals(schema.ok, false);
    assertStringIncludes(schema.detail, "v1");
    assertStringIncludes(schema.detail, "v10");
    assertStringIncludes(schema.fix ?? "", "discern upgrade");
  });
});

Deno.test("doctor: human output for a stale schema prints the fix and a failure summary", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
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
    await initInstall(dir);
    // Inject a capability key outside the known vocabulary. Still valid TOML, so
    // the syntax check passes — but the schema check (the closed [capabilities]
    // vocabulary) flags it with the rename/move-to-[checks] guidance.
    await addCapability(dir, "bogus", "echo hi");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(check(payload, "discern.toml").ok, true);
    const schema = check(payload, "config schema");
    assertEquals(schema.ok, false);
    assertStringIncludes(schema.detail, "bogus");
    assertStringIncludes(schema.detail, "known capability");
  });
});

Deno.test("doctor: a fresh install reports its wired capabilities", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // The default scaffold ships none wired; add a known one.
    await addCapability(dir, "test", "echo ok");
    const { payload } = await runDoctorJson(dir);
    const caps = check(payload, "capabilities");
    assertEquals(caps.ok, true);
    assertStringIncludes(caps.detail, "test");
  });
});

Deno.test("doctor: a fresh install passes the recipe-contract check (no recipes seeded)", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // A fresh install seeds no recipes dir at all, so there is nothing sourcing
    // the retired shell library.
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(check(payload, "recipe contract").ok, true);
  });
});

Deno.test("doctor: a recipe sourcing the retired shell library is flagged with the new-contract fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // A recipe carried forward from a pre-binary install: it sources the engine
    // library that no longer exists, so it would break at runtime. (The default
    // [recipes].dir is ./recipes; a fresh install seeds no recipes dir.)
    await Deno.mkdir(join(dir, "recipes"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "recipes/reset"),
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
    await initInstall(dir);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(check(payload, "sh").ok, true);
  });
});

Deno.test("doctor: a foreign worktree hook is an advisory warning, not a failure", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
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
    assertEquals(wt.ok, true);
    assertEquals(wt.warn, true);
  });
});

Deno.test("doctor: reports the [features] toggle state and reflects a disabled feature", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    const fresh = await runDoctorJson(dir);
    assertEquals(fresh.code, 0);
    const f = check(fresh.payload, "features");
    assertEquals(f.ok, true);
    assertStringIncludes(f.detail, "all on");

    // Disable one feature via the real config surface; doctor must surface it.
    assertEquals(
      (await runCli(["config", "set", "features.worktrees", "false"], dir))
        .code,
      0,
    );
    const after = await runDoctorJson(dir);
    assertEquals(after.code, 0); // a disabled feature is healthy, just reported
    assertStringIncludes(
      check(after.payload, "features").detail,
      "off: worktrees",
    );
  });
});

Deno.test("doctor: nudges a [checks.x] that mirrors a standard capability (advisory)", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // A standard capability wired as a check: name `lint` at its canonical stage.
    // `echo` resolves on PATH so the command check passes — isolating the nudge.
    await addCheck(dir, "lint", "check", "echo lint");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0); // advisory — the install is healthy
    assertEquals(payload.ok, true);
    const nudge = check(payload, "capability-shaped checks");
    assertEquals(nudge.warn, true);
    assertStringIncludes(nudge.detail, "[checks.lint]");
    assertStringIncludes(nudge.fix ?? "", "[capabilities].lint");
  });
});

Deno.test("doctor: does NOT nudge a custom-named check, or one at a non-canonical stage", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
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
    await initInstall(dir);
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
    await initInstall(dir);
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
    await initInstall(dir);
    // A guidance source + an authored skill exercise the "populated" branch of
    // both checks (a fresh install only hits the "none yet" branch).
    await Deno.writeTextFile(join(dir, "guidance.md"), "# project guidance\n");
    await Deno.mkdir(join(dir, "skills/my-skill"), { recursive: true });
    await Deno.writeTextFile(join(dir, "skills/my-skill/SKILL.md"), "# mine\n");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertStringIncludes(check(payload, "guidance sources").detail, "resolve");
    assertStringIncludes(check(payload, "skills").detail, "1 authored skill");
  });
});

Deno.test("doctor: surfaces per-agent integration coverage (MCP/hooks Claude-only, by design)", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir); // default agents: claude_code + codex
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0); // a registry-described divergence is healthy, just reported

    // Claude Code wires every surface.
    const claude = check(payload, "agent: Claude Code");
    assertEquals(claude.ok, true);
    assertStringIncludes(claude.detail, "guidance CLAUDE.md");
    assertStringIncludes(claude.detail, "mcp");
    assertStringIncludes(claude.detail, "hooks");

    // Codex's MCP/hooks use their own mechanism — surfaced explicitly, not a silent
    // gap (the EXPECTED divergence made visible).
    const codex = check(payload, "agent: Codex");
    assertEquals(codex.ok, true);
    assertStringIncludes(codex.detail, "guidance AGENTS.md");
    assertStringIncludes(codex.detail, "not wired");
  });
});
