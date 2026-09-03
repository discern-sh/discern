/** Git-specific safety diagnostics surfaced by `discern doctor`. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";
import { addWorktree, git, gitInit } from "./engine_helpers.ts";
import { classifyRepositoryProbeFailure } from "../src/engine/doctor/git_health.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

interface DoctorCheck {
  readonly name: string;
  readonly status: "ok" | "warn" | "fail";
  readonly detail: string;
  readonly fix?: string | undefined;
}

interface DoctorPayload {
  readonly data: { readonly checks: readonly DoctorCheck[] };
}

const GIT_ISOLATION = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

/** Scaffold one configured repository without the separate logbook assertion. */
async function setupRepository(dir: string): Promise<void> {
  const setup = await runCli([
    "setup",
    "--confirmed",
    "--yes",
    "--slug",
    "doctor-git-health",
  ], dir);
  assertEquals(setup.code, 0, setup.stderr);
  const configPath = join(dir, "discern.toml");
  await Deno.writeTextFile(
    configPath,
    (await Deno.readTextFile(configPath)).replace(
      "logbook = true",
      "logbook = false",
    ),
  );
  await gitInit(dir);
}

/** Run doctor's JSON surface with optional process-environment overrides. */
async function doctor(
  dir: string,
  env: Record<string, string> = {},
): Promise<{ code: number; payload: DoctorPayload }> {
  const result = await runCli(["doctor", "--json"], dir, env);
  const payload = decodeCliResult(result.stdout, "doctor");
  assert(payload.data !== undefined && "checks" in payload.data);
  return {
    code: result.code,
    payload: { ...payload, data: payload.data },
  };
}

/** Resolve one named doctor row and fail the test when it is absent. */
function named(payload: DoctorPayload, name: string): DoctorCheck {
  const found = payload.data.checks.find((entry) => entry.name === name);
  assert(found !== undefined, `expected doctor check '${name}'`);
  return found;
}

Deno.test("doctor: Git safety defaults are reported as healthy", async () => {
  await withTempDir(async (dir) => {
    await setupRepository(dir);
    await addWorktree(dir, "healthy-checkout");
    const result = await doctor(dir, GIT_ISOLATION);
    assertEquals(result.code, 0);
    for (
      const name of [
        "Git recovery",
        "commit identity",
        "commit signing",
        "index visibility",
        "worktree Git config",
        "repository ownership",
      ]
    ) {
      assertEquals(named(result.payload, name).status, "ok", name);
    }
  });
});

Deno.test("doctor: disabled reflogs and short expiry windows warn across worktrees", async () => {
  await withTempDir(async (dir) => {
    await setupRepository(dir);
    await git(dir, "config", "extensions.worktreeConfig", "true");
    const wt = await addWorktree(dir, "recovery-health");
    await git(dir, "config", "core.logAllRefUpdates", "false");
    await git(dir, "config", "gc.reflogExpireUnreachable", "now");
    await git(dir, "config", "gc.pruneExpire", "1.day.ago");
    await git(dir, "config", "gc.worktreePruneExpire", "1.day.ago");
    await git(
      dir,
      "config",
      "gc.refs/heads/agent/*.reflogExpire",
      "1.day.ago",
    );
    await git(wt, "config", "--worktree", "gc.reflogExpire", "2.days.ago");

    const result = await doctor(dir, GIT_ISOLATION);
    const recovery = named(result.payload, "Git recovery");
    assertEquals(recovery.status, "warn");
    assertStringIncludes(recovery.detail, "core.logAllRefUpdates=false");
    assertStringIncludes(recovery.detail, "gc.reflogExpire=2.days.ago");
    assertStringIncludes(recovery.detail, "gc.pruneExpire=1.day.ago");
    assertStringIncludes(recovery.detail, "refs/heads/agent/*");
    assertStringIncludes(recovery.detail, "recovery-health");
    assertStringIncludes(recovery.fix ?? "", "90.days.ago");
    assertEquals(result.code, 0, "recovery advice must not fail doctor");
  });
});

Deno.test("doctor: commit identity and an enabled missing signer fail precisely", async () => {
  await withTempDir(async (dir) => {
    await setupRepository(dir);
    await git(dir, "config", "--unset-all", "user.name");
    await git(dir, "config", "--unset-all", "user.email");
    await git(dir, "config", "user.useConfigOnly", "true");

    const missingIdentity = await doctor(dir, GIT_ISOLATION);
    const identity = named(missingIdentity.payload, "commit identity");
    assertEquals(identity.status, "fail");
    assertStringIncludes(identity.fix ?? "", "git config user.name");
    assertStringIncludes(identity.fix ?? "", "git config user.email");

    await git(dir, "config", "user.name", "Doctor Test");
    await git(dir, "config", "user.email", "doctor@example.com");
    await git(dir, "config", "commit.gpgSign", "true");
    await git(dir, "config", "gpg.program", "missing-signer-for-discern-test");
    const missingSigner = await doctor(dir, GIT_ISOLATION);
    const signing = named(missingSigner.payload, "commit signing");
    assertEquals(signing.status, "fail");
    assertStringIncludes(signing.detail, "missing-signer-for-discern-test");
    assertStringIncludes(signing.fix ?? "", "commit.gpgSign");

    await git(dir, "config", "gpg.format", "ssh");
    await git(dir, "config", "gpg.ssh.program", "sh");
    const missingSshKey = await doctor(dir, GIT_ISOLATION);
    assertStringIncludes(
      named(missingSshKey.payload, "commit signing").detail,
      "user.signingKey",
    );
  });
});

Deno.test("doctor: hidden index flags fail and name the affected paths", async () => {
  await withTempDir(async (dir) => {
    await setupRepository(dir);
    await Deno.writeTextFile(join(dir, "assumed.txt"), "assumed\n");
    await Deno.writeTextFile(join(dir, "skipped.txt"), "skipped\n");
    await git(dir, "add", "assumed.txt", "skipped.txt");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "add index fixtures",
      "--no-gpg-sign",
    );
    await git(dir, "update-index", "--assume-unchanged", "assumed.txt");
    await git(dir, "update-index", "--skip-worktree", "skipped.txt");
    await git(dir, "config", "core.ignoreStat", "true");

    const result = await doctor(dir, GIT_ISOLATION);
    const visibility = named(result.payload, "index visibility");
    assertEquals(visibility.status, "fail");
    assertStringIncludes(visibility.detail, "assumed.txt");
    assertStringIncludes(visibility.detail, "skipped.txt");
    assertStringIncludes(visibility.detail, "core.ignoreStat=true");
    assertStringIncludes(visibility.fix ?? "", "--no-assume-unchanged");
    assertStringIncludes(visibility.fix ?? "", "--no-skip-worktree");
  });
});

Deno.test("doctor: linked worktrees reject checkout-specific keys in common config", async () => {
  await withTempDir(async (dir) => {
    await setupRepository(dir);
    await addWorktree(dir, "config-health");
    await git(dir, "config", "core.worktree", "..");
    await git(dir, "config", "core.sparseCheckout", "false");

    const result = await doctor(dir, GIT_ISOLATION);
    const config = named(result.payload, "worktree Git config");
    assertEquals(config.status, "fail");
    assertStringIncludes(config.detail, "core.worktree");
    assertStringIncludes(config.detail, "core.sparseCheckout");
    assertStringIncludes(config.fix ?? "", "extensions.worktreeConfig true");
  });
});

Deno.test("doctor: a deliberate sparse checkout is visible as advice", async () => {
  await withTempDir(async (dir) => {
    await setupRepository(dir);
    await git(dir, "sparse-checkout", "init", "--cone");
    await git(dir, "sparse-checkout", "set", "discern");

    const result = await doctor(dir, GIT_ISOLATION);
    const visibility = named(result.payload, "index visibility");
    assertEquals(visibility.status, "warn");
    assertStringIncludes(visibility.detail, "sparse checkout");
    assertStringIncludes(visibility.fix ?? "", "sparse-checkout disable");
  });
});

Deno.test("dubious-ownership diagnostics are distinguished from a non-repository", () => {
  assertEquals(
    classifyRepositoryProbeFailure(
      "fatal: detected dubious ownership in repository at '/tmp/project'",
    ),
    "dubious-ownership",
  );
  assertEquals(
    classifyRepositoryProbeFailure("fatal: not a git repository"),
    "not-repository",
  );
  assertEquals(
    classifyRepositoryProbeFailure(
      "fatal: unable to read current working directory",
    ),
    "other",
  );
});

Deno.test("doctor: dubious ownership gets the exact-path trust remedy", async () => {
  await withTempDir(async (dir) => {
    const setup = await runCli([
      "setup",
      "--confirmed",
      "--yes",
      "--slug",
      "doctor-dubious-ownership",
    ], dir);
    assertEquals(setup.code, 0, setup.stderr);
    const fakeGit = join(dir, "dubious-git");
    await Deno.writeTextFile(
      fakeGit,
      "#!/bin/sh\n" +
        'if [ "$1" = "--version" ]; then\n' +
        '  echo "git version 2.50.0"\n' +
        "  exit 0\n" +
        "fi\n" +
        `echo "fatal: detected dubious ownership in repository at '${dir}'" >&2\n` +
        "exit 128\n",
    );
    await Deno.chmod(fakeGit, 0o755);

    const result = await doctor(dir, { GIT_BIN: fakeGit });
    const ownership = named(result.payload, "repository ownership");
    assertEquals(ownership.status, "fail");
    assertStringIncludes(ownership.fix ?? "", "safe.directory");
    assertStringIncludes(ownership.fix ?? "", dir);
    assertEquals(
      result.payload.data.checks.find((entry) =>
        entry.name === "repository shape" &&
        entry.detail.includes("not a git repository")
      ),
      undefined,
    );
  });
});
