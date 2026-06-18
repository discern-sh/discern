/**
 * Installer `doctor` surface tests: drive `src/main.ts doctor` as a subprocess
 * (so Cliffy parsing, JSON vs human rendering, the per-check diagnostics, the
 * delegation to the harness's own `bin/agent doctor`, and the exit code are all
 * exercised for real). These complement the few `doctor` cases in `cli_test.ts`
 * — here we drive each *failure* branch of `src/commands/doctor.ts` and both
 * output paths.
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

Deno.test("doctor --json: a fresh install is fully healthy and exits 0", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(payload.ok, true);
    assertEquals(payload.kit_version, "1.0.0");
    // Every installer check passes…
    for (
      const name of ["icculus.toml", "bin/agent", "manifest", "schema version"]
    ) {
      assertEquals(check(payload, name).ok, true, `${name} should pass`);
    }
    // …and the delegation to the real engine `doctor` recipe ran and passed,
    // folding its summary into the detail (exercises the code===0 branch).
    const delegated = check(payload, "bin/agent doctor");
    assertEquals(delegated.ok, true);
    assert(delegated.detail.length > 0, "delegated detail should not be empty");
  });
});

Deno.test("doctor: human (non-json) output reports a clean bill on stderr, exit 0", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // The human render goes to stderr; stdout only carries the trailing blank.
    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 0);
    assertStringIncludes(stderr, "icculus doctor");
    assertStringIncludes(stderr, "icculus.toml: present and valid TOML");
    assertStringIncludes(stderr, "bin/agent: present and executable");
    assertStringIncludes(stderr, "schema 2 (current)");
    assertStringIncludes(stderr, "All checks passed.");
  });
});

Deno.test("doctor: invalid (malformed) icculus.toml is flagged with a syntax fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // Present but not valid TOML — the not-NotFound branch of the toml check.
    await Deno.writeTextFile(
      join(dir, "icculus.toml"),
      'this is = not valid toml [[[\n"unterminated\n',
    );

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    assertEquals(payload.ok, false);
    const toml = check(payload, "icculus.toml");
    assertEquals(toml.ok, false);
    assertStringIncludes(toml.detail, "invalid");
    assertEquals(toml.fix, "fix the TOML syntax in icculus.toml");
  });
});

Deno.test("doctor: bin/agent present but not executable is flagged with a chmod fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    const agentPath = join(dir, "bin/agent");
    await Deno.chmod(agentPath, 0o644);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const agent = check(payload, "bin/agent");
    assertEquals(agent.ok, false);
    assertEquals(agent.detail, "present but not executable");
    assertStringIncludes(agent.fix ?? "", "chmod +x");
    assertStringIncludes(agent.fix ?? "", agentPath);
    // A non-executable dispatcher means delegation is skipped entirely (it
    // returns undefined), so there is no "bin/agent doctor" check.
    assertEquals(
      payload.checks.find((c) => c.name === "bin/agent doctor"),
      undefined,
    );
  });
});

Deno.test("doctor: a missing bin/agent is flagged with a restore fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // Entirely absent (the stat-returns-undefined branch), distinct from the
    // present-but-not-executable case above.
    await Deno.remove(join(dir, "bin/agent"));

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const agent = check(payload, "bin/agent");
    assertEquals(agent.ok, false);
    assertEquals(agent.detail, "not found");
    assertStringIncludes(agent.fix ?? "", "restore bin/agent");
    // With no dispatcher present, delegation is skipped (no doctor check).
    assertEquals(
      payload.checks.find((c) => c.name === "bin/agent doctor"),
      undefined,
    );
  });
});

Deno.test("doctor: human output for a broken install prints the fix and a failure summary", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    await Deno.chmod(join(dir, "bin/agent"), 0o644);

    const { code, stderr } = await runCli(["doctor"], dir);
    assertEquals(code, 1);
    assertStringIncludes(stderr, "bin/agent: present but not executable");
    assertStringIncludes(stderr, "fix: ");
    assertStringIncludes(stderr, "chmod +x");
    assertStringIncludes(stderr, "Some checks failed");
  });
});

Deno.test("doctor: a manifest from a different kit version is flagged with a refresh fix", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    const manifestPath = join(dir, ".icculus/manifest.json");
    const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
    manifest.kit_version = "0.0.1-old";
    await Deno.writeTextFile(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const m = check(payload, "manifest");
    assertEquals(m.ok, false);
    assertStringIncludes(m.detail, "0.0.1-old");
    assertStringIncludes(m.detail, "1.0.0");
    // Outside this repo there is no `selfsync` task, so the hint is the product
    // vocabulary (`icculus upgrade`).
    assertStringIncludes(m.fix ?? "", "upgrade");
  });
});

Deno.test("doctor: a missing manifest is flagged and reported as not initialized", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    await Deno.remove(join(dir, ".icculus/manifest.json"));

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    const m = check(payload, "manifest");
    assertEquals(m.ok, false);
    assertStringIncludes(m.detail, "not found");
    assertStringIncludes(m.fix ?? "", "manifest.json");
    // The schema-version check is only emitted when the manifest parsed; a
    // missing manifest means no separate schema check.
    assertEquals(
      payload.checks.find((c) => c.name === "schema version"),
      undefined,
    );
  });
});

Deno.test("doctor: delegation soft-skips when the harness has no doctor recipe", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // Remove the engine `doctor` recipe but leave bin/agent executable: the
    // dispatcher prints "unknown recipe", which folds in as a benign skip.
    await Deno.remove(join(dir, ".icculus/engine/doctor"));

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 0);
    assertEquals(payload.ok, true);
    const delegated = check(payload, "bin/agent doctor");
    assertEquals(delegated.ok, true);
    assertStringIncludes(delegated.detail, "no doctor recipe yet");
  });
});

Deno.test("doctor: a failing engine doctor folds in as a failed check (not unknown recipe)", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // An invalid project.slug is valid TOML (so the installer's own toml check
    // still passes) but makes the engine `doctor` recipe exit non-zero with a
    // real failure on stderr — the harness-failure branch of the delegation.
    const tomlPath = join(dir, "icculus.toml");
    const toml = await Deno.readTextFile(tomlPath);
    await Deno.writeTextFile(
      tomlPath,
      toml.replace(/slug\s*=\s*"[^"]*"/, 'slug = "Not A Slug!"'),
    );

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    // The installer's own toml check still passes (syntactically valid).
    assertEquals(check(payload, "icculus.toml").ok, true);
    // The delegated harness check fails and carries an actionable fix.
    const delegated = check(payload, "bin/agent doctor");
    assertEquals(delegated.ok, false);
    assertStringIncludes(delegated.fix ?? "", "harness self-check");
  });
});

Deno.test("doctor: a bin/agent that cannot be spawned is reported as un-runnable", async () => {
  await withTempDir(async (dir) => {
    await initInstall(dir);
    // Replace bin/agent with an EXECUTABLE directory: the installer's stat-based
    // check sees mode bits and reports it present+executable, but spawning it
    // throws — exercising the catch branch of the delegation.
    const agentPath = join(dir, "bin/agent");
    await Deno.remove(agentPath);
    await Deno.mkdir(agentPath);
    await Deno.chmod(agentPath, 0o755);

    const { code, payload } = await runDoctorJson(dir);
    assertEquals(code, 1);
    // The cheap stat check still calls it executable…
    assertEquals(check(payload, "bin/agent").ok, true);
    // …but the actual spawn fails and is reported, with a runnable-script fix.
    const delegated = check(payload, "bin/agent doctor");
    assertEquals(delegated.ok, false);
    assertStringIncludes(delegated.detail, "could not run bin/agent");
    assertEquals(delegated.fix, "ensure bin/agent is a runnable POSIX script");
  });
});
