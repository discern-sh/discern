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
  kit_version: string;
  checks: DoctorCheck[];
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
  const found = payload.checks.find((c) => c.name === name);
  assert(found !== undefined, `expected a '${name}' check`);
  return found;
}

/** Rewrite an install's recorded `[meta].schema_version`. */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, ".icculus/config.toml");
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
  const p = join(dir, ".icculus/config.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/\[capabilities\]\n/, `[capabilities]\n${key} = "${value}"\n`),
  );
}

Deno.test("doctor --json: a fresh install is fully healthy and exits 0", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(payload.ok, true);
    assertEquals(payload.kit_version, "1.0.0");
    for (
      const name of [".icculus/config.toml", "schema version", "capabilities"]
    ) {
      assertEquals(check(payload, name).ok, true, `${name} should pass`);
    }
    // The schema check names the current version.
    assertStringIncludes(check(payload, "schema version").detail, "current");
  });
});

Deno.test("doctor: human (non-json) output reports a clean bill on stderr, exit 0", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "icculus doctor");
    assertStringIncludes(
      stderr,
      ".icculus/config.toml: present and valid TOML",
    );
    assertStringIncludes(stderr, "schema 5 (current)");
    assertStringIncludes(stderr, "All checks passed.");
  });
});

Deno.test("doctor: invalid (malformed) .icculus/config.toml is flagged with a syntax fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    await Deno.writeTextFile(
      join(dir, ".icculus/config.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    const toml = check(payload, ".icculus/config.toml");
    assertEquals(toml.ok, false);
    assertStringIncludes(toml.detail, "invalid");
    assertEquals(toml.fix, "fix the TOML syntax in .icculus/config.toml");
    // With an unparseable config the later checks have nothing to read, so they
    // are not emitted.
    assertEquals(
      payload.checks.find((c) => c.name === "schema version"),
      undefined,
    );
  });
});

Deno.test("doctor: a missing config is flagged as not initialized", async () => {
  await withTempDir(async (dir) => {
    // No `init` here — the dir has no .icculus/config.toml.
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    const toml = check(payload, ".icculus/config.toml");
    assertEquals(toml.ok, false);
    assertStringIncludes(toml.detail, "not found");
    assertStringIncludes(toml.fix ?? "", "icculus init");
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
    assertStringIncludes(schema.detail, "v5");
    assertStringIncludes(schema.fix ?? "", "icculus upgrade");
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
    assertStringIncludes(stderr, "icculus upgrade");
    assertStringIncludes(stderr, "Some checks failed");
  });
});

Deno.test("doctor: an unknown capability key is flagged with a rename fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // Inject a capability key outside the known vocabulary. Still valid TOML, so
    // the config check passes — but the capabilities check flags it.
    await addCapability(dir, "bogus", "echo hi");

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(check(payload, ".icculus/config.toml").ok, true);
    const caps = check(payload, "capabilities");
    assertEquals(caps.ok, false);
    assertStringIncludes(caps.detail, "bogus");
    assertStringIncludes(caps.fix ?? "", "known capability");
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

Deno.test("doctor: a fresh install passes the recipe-contract check (README is not a recipe)", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // The scaffold ships only .icculus/recipes/README.md, which is docs, not a
    // recipe — so there is nothing sourcing the retired shell library.
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(check(payload, "recipe contract").ok, true);
  });
});

Deno.test("doctor: a recipe sourcing the retired shell library is flagged with the new-contract fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // A recipe carried forward from a pre-binary install: it sources the engine
    // library that no longer exists, so it would break at runtime.
    await Deno.writeTextFile(
      join(dir, ".icculus/recipes/reset"),
      '#!/usr/bin/env sh\n# desc: reset fixtures\n. "$ICCULUS_LIB/bootstrap.sh"\nok done\n',
    );
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const recipe = check(payload, "recipe contract");
    assertEquals(recipe.ok, false);
    assertStringIncludes(recipe.detail, "reset");
    assertStringIncludes(recipe.fix ?? "", "icculus config get");
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
    // (which call `icculus`); the harness's stay, this one is foreign.
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
