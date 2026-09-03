/**
 * Engine coverage for generated-artifact merge attributes: refresh follows the
 * declarations, reconciliation installs one clone-local keep-current driver,
 * raw Git merges use it, and an unreconciled clone retains Git's normal
 * conflict path.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { DISCERN_GENERATED_MERGE_DRIVER } from "../src/lib/agent_gitattributes.ts";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  engineEnv,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";

const GENERATED_PATH = "generated/bundle.txt";
const DRIVER_KEY = `merge.${DISCERN_GENERATED_MERGE_DRIVER}.driver`;
const DECODER = new TextDecoder();

interface RawGitResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run Git and return decoded output without asserting success. */
async function rawGit(
  cwd: string,
  ...args: string[]
): Promise<RawGitResult> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    env: await engineEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    success: output.success,
    stdout: DECODER.decode(output.stdout),
    stderr: DECODER.decode(output.stderr),
  };
}

/** Write a fixture file after creating its parent directory. */
async function write(root: string, path: string, body: string): Promise<void> {
  const absolute = join(root, path);
  await Deno.mkdir(dirname(absolute), { recursive: true });
  await Deno.writeTextFile(absolute, body);
}

/** Run the fixture's generated-artifact command and assert success. */
async function regenerate(root: string): Promise<void> {
  const output = await new Deno.Command("sh", {
    args: ["tools/generate.sh"],
    cwd: root,
    env: await engineEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assert(
    output.success,
    `generator failed: ${DECODER.decode(output.stderr)}`,
  );
}

/** Commit every staged and unstaged fixture change. */
async function commitAll(root: string, message: string): Promise<void> {
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", message, "--no-gpg-sign");
}

/** Scaffold a project with one declared generated artifact. */
async function scaffoldGeneratedProject(dir: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      'agents = ["claude_code"]',
      "",
      "[repository]",
      'trunk = "main"',
      "",
      "[generated.bundle]",
      'paths = ["generated/**"]',
      'run = "sh tools/generate.sh"',
      "linguist_generated = true",
      "timeout = 10",
      "",
    ].join("\n"),
  );
  await write(dir, "source/left.txt", "base-left\n");
  await write(dir, "source/right.txt", "base-right\n");
  await write(
    dir,
    "tools/generate.sh",
    [
      "#!/bin/sh",
      "set -eu",
      "mkdir -p generated",
      "left=$(cat source/left.txt)",
      "right=$(cat source/right.txt)",
      'printf \'left=%s|right=%s\\n\' "$left" "$right" > generated/bundle.txt',
      "",
    ].join("\n"),
  );
  await regenerate(dir);

  const firstRefresh = await runAgent(dir, ["refresh", "--json"]);
  assertEquals(firstRefresh.code, 0, firstRefresh.output);
  assertStringIncludes(
    await Deno.readTextFile(join(dir, ".gitattributes")),
    "generated/** merge=discern-generated linguist-generated",
  );
  await gitInit(dir);
  assertEquals(
    await gitOut(
      dir,
      "check-attr",
      "linguist-generated",
      "--",
      GENERATED_PATH,
    ),
    `${GENERATED_PATH}: linguist-generated: set`,
  );
  assertEquals(
    await gitOut(
      dir,
      "check-attr",
      "diff",
      "--",
      "discern/map/README.md",
      "README.md",
    ),
    [
      "discern/map/README.md: diff: unspecified",
      "README.md: diff: unspecified",
    ].join("\n"),
  );

  // Tracking the compiled Agent file leaves the one-pass block unchanged.
  const trackedRefresh = await runAgent(dir, ["refresh", "--json"]);
  assertEquals(trackedRefresh.code, 0, trackedRefresh.output);
  assertStringIncludes(
    await Deno.readTextFile(join(dir, ".gitattributes")),
    "/CLAUDE.md merge=discern-generated",
  );
  assertEquals(await gitOut(dir, "status", "--porcelain"), "");
}

Deno.test("refresh regenerates the managed block after a config edit", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const configPath = join(dir, "discern.toml");
    const config = await Deno.readTextFile(configPath);
    await Deno.writeTextFile(
      configPath,
      config.replace('paths = ["generated/**"]', 'paths = ["artifacts/**"]'),
    );

    const refresh = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refresh.code, 0, refresh.output);
    const attributes = await Deno.readTextFile(join(dir, ".gitattributes"));
    assertStringIncludes(attributes, "artifacts/** merge=discern-generated");
    assertEquals(attributes.includes("generated/** merge="), false);
  });
});

Deno.test("done refuses a tracked refresh artifact made stale by config", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const configPath = join(dir, "discern.toml");
    const config = await Deno.readTextFile(configPath);
    await Deno.writeTextFile(
      configPath,
      config.replace('paths = ["generated/**"]', 'paths = ["artifacts/**"]'),
    );
    const before = await Deno.readTextFile(join(dir, ".gitattributes"));

    const status = await runAgent(dir, ["status", "--local", "--json"]);
    assertEquals(status.code, 0, status.output);
    const statusResult = decodeCliResult(status.stdout, "status");
    assertResultDataKey(statusResult, "pending_tracked_refresh");
    assertEquals(statusResult.data.pending_tracked_refresh, [
      ".gitattributes",
    ]);

    const done = await runAgent(dir, ["done", "--json"]);

    assertEquals(done.code, 1, done.output);
    const result = decodeCliResult(done.stdout, "done");
    assertResultDataKey(result, "failed_stage");
    assertExists(result.diagnostics);
    assertEquals(result.data.failed_stage, "refresh_drift");
    assertEquals(
      result.diagnostics.some((diagnostic) =>
        diagnostic.output?.includes(".gitattributes") === true
      ),
      true,
      done.output,
    );
    assertEquals(
      await Deno.readTextFile(join(dir, ".gitattributes")),
      before,
      "the read-only convergence check must not repair the file",
    );
  });
});

Deno.test("done refuses mode-only drift in a tracked refresh artifact", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const instructionPath = join(dir, "CLAUDE.md");
    await Deno.chmod(instructionPath, 0o755);

    const done = await runAgent(dir, ["done", "--json"]);

    assertEquals(done.code, 1, done.output);
    const result = decodeCliResult(done.stdout, "done");
    assertResultDataKey(result, "failed_stage");
    assertExists(result.diagnostics);
    assertEquals(result.data.failed_stage, "refresh_drift");
    assertEquals(
      result.diagnostics.some((diagnostic) =>
        diagnostic.output?.includes("CLAUDE.md") === true
      ),
      true,
      done.output,
    );
    const mode = (await Deno.stat(instructionPath)).mode;
    assert(mode !== null && (mode & 0o111) !== 0);
  });
});

Deno.test("a provisioned worktree raw-merges generated conflicts and the gate regenerates", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const worktree = await addWorktree(dir, "raw-generated-merge");
    // Model the private-era footprint: the driver lived in config.worktree and
    // the common definition was absent. Any normal reconciliation must migrate
    // it without waiting for a special setup-only path.
    await git(dir, "config", "--unset-all", DRIVER_KEY);
    await git(dir, "config", "extensions.worktreeConfig", "true");
    await git(worktree, "config", "--worktree", DRIVER_KEY, "true");
    const setup = await runAgent(worktree, ["worktree", "setup", "--json"]);
    assertEquals(setup.code, 0, setup.output);

    for (const checkout of [dir, worktree]) {
      const driver = await rawGit(checkout, "config", "--get", DRIVER_KEY);
      assertEquals(driver.success, true, driver.stderr);
      assertEquals(driver.stdout.trim(), "true");
    }
    const commonDriver = await rawGit(
      dir,
      "config",
      "--file",
      join(dir, ".git", "config"),
      "--get",
      DRIVER_KEY,
    );
    assertEquals(commonDriver.success, true, commonDriver.stderr);
    assertEquals(commonDriver.stdout.trim(), "true");
    const staleDriver = await rawGit(
      worktree,
      "config",
      "--worktree",
      "--get",
      DRIVER_KEY,
    );
    assertEquals(staleDriver.success, false, staleDriver.stdout);
    const extension = await rawGit(
      dir,
      "config",
      "--get",
      "extensions.worktreeConfig",
    );
    assertEquals(extension.success, false, extension.stdout);

    await write(worktree, "source/left.txt", "worktree-left\n");
    await regenerate(worktree);
    await commitAll(worktree, "change left source");

    await write(dir, "source/right.txt", "main-right\n");
    await regenerate(dir);
    await commitAll(dir, "change right source");

    const merge = await rawGit(
      worktree,
      "merge",
      "main",
      "--no-edit",
      "--no-gpg-sign",
    );
    assert(merge.success, `${merge.stdout}\n${merge.stderr}`);
    assertEquals(
      await gitOut(worktree, "diff", "--name-only", "--diff-filter=U"),
      "",
    );
    const kept = await Deno.readTextFile(join(worktree, GENERATED_PATH));
    assertEquals(kept, "left=worktree-left|right=base-right\n");
    assertEquals(kept.includes("<<<<<<<"), false);

    const gate = await runAgent(worktree, ["done", "--json"]);
    assertEquals(gate.code, 1, gate.output);
    const gateResult = decodeCliResult(gate.stdout, "done");
    assertResultDataKey(gateResult, "failed_stage");
    assertEquals(
      gateResult.data.failed_stage,
      "generated_drift",
    );
    const converged = await Deno.readTextFile(join(worktree, GENERATED_PATH));
    assertEquals(converged, "left=worktree-left|right=main-right\n");
    assertEquals(converged.includes("<<<<<<<"), false);
  });
});

Deno.test("a plain clone without the driver falls back to a normal conflict", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const clone = join(dir, "plain-clone");
    const cloned = await rawGit(dir, "clone", "--quiet", dir, clone);
    assert(cloned.success, cloned.stderr);
    await git(clone, "config", "user.name", "Engine Test");
    await git(clone, "config", "user.email", "engine-test@example.com");
    await git(clone, "config", "commit.gpgsign", "false");

    const driver = await rawGit(clone, "config", "--get", DRIVER_KEY);
    assertEquals(driver.success, false, driver.stdout);
    await git(clone, "checkout", "-q", "-b", "plain-topic");
    await write(clone, "source/left.txt", "clone-left\n");
    await regenerate(clone);
    await commitAll(clone, "change clone left source");

    await git(clone, "checkout", "-q", "main");
    await write(clone, "source/right.txt", "clone-right\n");
    await regenerate(clone);
    await commitAll(clone, "change clone right source");
    await git(clone, "checkout", "-q", "plain-topic");

    const merge = await rawGit(
      clone,
      "merge",
      "main",
      "--no-edit",
      "--no-gpg-sign",
    );
    assertEquals(merge.success, false, `${merge.stdout}\n${merge.stderr}`);
    assertStringIncludes(
      await Deno.readTextFile(join(clone, GENERATED_PATH)),
      "<<<<<<<",
    );
    assertStringIncludes(
      await gitOut(clone, "diff", "--name-only", "--diff-filter=U"),
      GENERATED_PATH,
    );
  });
});

Deno.test("a fresh clone gains the shared driver only after reconciliation", async () => {
  await withTempDir(async (dir) => {
    await scaffoldGeneratedProject(dir);
    const clone = join(dir, "reconciled-clone");
    const cloned = await rawGit(dir, "clone", "--quiet", dir, clone);
    assert(cloned.success, cloned.stderr);

    const before = await rawGit(clone, "config", "--get", DRIVER_KEY);
    assertEquals(before.success, false, before.stdout);

    const refresh = await runAgent(clone, ["refresh", "--json"]);
    assertEquals(refresh.code, 0, refresh.output);
    const after = await rawGit(clone, "config", "--get", DRIVER_KEY);
    assertEquals(after.success, true, after.stderr);
    assertEquals(after.stdout.trim(), "true");
  });
});

Deno.test("first setup installs no driver when no generated candidate exists", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: [] });
    await gitInit(dir);
    const worktree = await addWorktree(dir, "no-generated-paths");
    const setup = await runAgent(worktree, ["worktree", "setup", "--json"]);
    assertEquals(setup.code, 0, setup.output);
    const driver = await rawGit(worktree, "config", "--get", DRIVER_KEY);
    assertEquals(driver.success, false, driver.stdout);
    const attributes = await rawGit(
      worktree,
      "status",
      "--porcelain",
      "--",
      ".gitattributes",
    );
    assertEquals(attributes.stdout.trim(), "");
  });
});
