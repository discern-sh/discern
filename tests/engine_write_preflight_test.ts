/**
 * Fail-fast write-authority guards for slow workflows.
 *
 * The class invariant: if a workflow will persist Discern-owned state after a
 * potentially slow project command, it proves that write authority before the
 * project command starts. A sandbox or filesystem denial therefore costs one
 * tiny probe, never a complete gate or metric pass followed by a retry.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, isAbsolute, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { preflightAdminStateWrites } from "../src/engine/gate/proof.ts";
import {
  GIT_ADMIN_STATE,
  type GitAdminStateKey,
  gitAdminStatePath,
  VALIDATION_ADMIN_STATE_KEYS,
} from "../src/shared/git_admin_state.ts";
import {
  preflightSetupEffects,
  setupEffectPlan,
  setupPlannedWrites,
  setupRequiredEffect,
} from "../src/shared/setup_effects.ts";
import { preflightPlannedWrites } from "../src/shared/write_preflight.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import {
  assertResultDataKey,
  type CliJsonResultCommand,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

/** Decode a preflight refusal envelope before asserting that no later effect ran. */
function parseJson<Command extends CliJsonResultCommand>(
  stdout: string,
  command: Command,
): CliResultForCommand<Command> {
  return decodeCliResult(stdout, command);
}

/** Read directory members in stable order when asserting a refusal left no debris. */
async function directoryEntryNames(path: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    names.push(entry.name);
  }
  return names.sort();
}

/** Resolve one registered admin-state path through the production resolver —
 * this suite exercises preflight behaviour at those paths, not the resolution
 * itself, which has its own independent oracle in git_admin_state_test.ts. */
async function gitAdminPath(
  root: string,
  key: GitAdminStateKey,
): Promise<string> {
  const path = await gitAdminStatePath(root, key);
  assert(path !== undefined, `expected a Git repository at ${root}`);
  return path;
}

/** Make the proof directory read-only for one operation and always restore its original mode. */
async function withUnwritableGitAdmin(
  root: string,
  fn: () => Promise<void>,
): Promise<void> {
  const path = await gitAdminPath(root, "gateProof");
  const dir = dirname(path);
  await Deno.mkdir(dir, { recursive: true });
  const originalMode = (await Deno.stat(dir)).mode;
  assert(originalMode !== null, `could not read mode for ${dir}`);
  await Deno.chmod(dir, 0o555);
  try {
    await fn();
  } finally {
    await Deno.chmod(dir, originalMode & 0o777);
  }
}

/** Make one existing directory read-only for an operation and always restore it. */
async function withUnwritableDirectory(
  dir: string,
  fn: () => Promise<void>,
): Promise<void> {
  const originalMode = (await Deno.stat(dir)).mode;
  assert(originalMode !== null, `could not read mode for ${dir}`);
  await Deno.chmod(dir, 0o555);
  try {
    await fn();
  } finally {
    await Deno.chmod(dir, originalMode & 0o777);
  }
}

/** Render a measurement job whose marker proves whether preflight failed before gate execution. */
function slowStandardConfig(marker: string): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[standards.score]",
    'direction = "up"',
    "limit = 0",
    `run = "touch ${marker}; echo 'DISCERN_METRIC score 1'"`,
    "",
  ].join("\n");
}

Deno.test("done fails before any gate job when its later Git-admin write is unavailable", async () => {
  await withTempDir(async (dir) => {
    const marker = "gate-job-ran";
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[jobs]",
        `test = "touch ${marker}"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    await withUnwritableGitAdmin(dir, async () => {
      const r = await runAgent(dir, ["done", "--json"]);
      assertEquals(r.code, 1, r.output);
      const obj = parseJson(r.stdout, "done");
      assertResultDataKey(obj, "failed_stage");
      assertEquals(obj.data.failed_stage, "write_denied");
      assertEquals(obj.diagnostics?.[0]?.tool, "write-access");
      assertStringIncludes(obj.diagnostics?.[0]?.message ?? "", ".git");
      assertEquals(await pathExists(join(dir, marker)), false);
    });
  });
});

Deno.test("start proves its complete write plan before Git creates a branch or worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const refs = join(dir, ".git", "refs", "heads");
    const branchesBefore = await gitOut(
      dir,
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
    );
    const worktreesBefore = await gitOut(
      dir,
      "worktree",
      "list",
      "--porcelain",
    );

    await withUnwritableDirectory(refs, async () => {
      const run = await runAgent(dir, [
        "start",
        "--name",
        "denied-authority",
        "--json",
      ]);
      assertEquals(run.code, 1, run.output);
      const envelope = parseJson(run.stdout, "start");
      assertEquals(envelope.error, "write_denied");
      assertEquals(envelope.diagnostics?.[0]?.tool, "write-access");
      assertEquals(
        envelope.diagnostics?.[0]?.reproduce_cmd,
        "discern start --name denied-authority",
      );
      assertStringIncludes(envelope.message ?? "", refs);
      assert(
        !(envelope.message ?? "").includes("teardown"),
        `a pre-creation denial must not claim teardown failed\n${run.output}`,
      );
    });

    assertEquals(
      await gitOut(
        dir,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads",
      ),
      branchesBefore,
    );
    assertEquals(
      await gitOut(dir, "worktree", "list", "--porcelain"),
      worktreesBefore,
    );
    assertEquals(await pathExists(`${dir}.worktrees`), false);
  });
});

Deno.test("start proves the dynamic destination tree before creating its branch", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const worktreeRoot = `${dir}.worktrees`;
    await Deno.mkdir(worktreeRoot);

    await withUnwritableDirectory(worktreeRoot, async () => {
      const run = await runAgent(dir, [
        "start",
        "--name",
        "denied-destination",
        "--json",
      ]);
      assertEquals(run.code, 1, run.output);
      const envelope = parseJson(run.stdout, "start");
      assertEquals(envelope.error, "write_denied");
      assertEquals(
        envelope.diagnostics?.[0]?.reproduce_cmd,
        "discern start --name denied-destination",
      );
      assertStringIncludes(envelope.message ?? "", worktreeRoot);
    });

    assertEquals(
      await gitOut(
        dir,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads/agent/denied-destination",
      ),
      "",
    );
    assertEquals(
      await pathExists(join(worktreeRoot, "denied-destination")),
      false,
    );
  });
});

Deno.test("a Git repository without discern keeps the command's not-initialized refusal", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const gitAdmin = join(dir, ".git");

    await withUnwritableDirectory(gitAdmin, async () => {
      const run = await runAgent(dir, ["update", "--json"]);
      assertEquals(run.code, 1, run.output);
      const envelope = parseJson(run.stdout, "update");
      assertEquals(envelope.error, "no_project");
    });
  });
});

Deno.test("the CLI Git boundary preserves the invoked retry and omits presentation flags", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const gitAdmin = join(dir, ".git");

    await withUnwritableDirectory(gitAdmin, async () => {
      const run = await runAgent(dir, [
        "update",
        "--from",
        "HEAD",
        "--json",
      ]);
      assertEquals(run.code, 1, run.output);
      const envelope = parseJson(run.stdout, "update");
      assertEquals(envelope.error, "write_denied");
      assertEquals(
        envelope.diagnostics?.[0]?.reproduce_cmd,
        "discern update --from HEAD",
      );
    });
  });
});

for (
  const args of [
    ["standards", "--json"],
    ["standards", "--pin", "--json"],
  ]
) {
  const label = args.includes("--pin") ? "standards --pin" : "standards";
  Deno.test(`${label} fails before measuring when its later Git-admin write is unavailable`, async () => {
    await withTempDir(async (dir) => {
      const marker = "standards-job-ran";
      await scaffoldEngine(dir);
      await writeConfig(dir, slowStandardConfig(marker));
      await gitInit(dir);

      await withUnwritableGitAdmin(dir, async () => {
        const r = await runAgent(dir, args);
        assertEquals(r.code, 1, r.output);
        const obj = parseJson(r.stdout, "standards");
        assertEquals(obj.error, "write_denied");
        assertEquals(obj.diagnostics?.[0]?.tool, "write-access");
        assertStringIncludes(obj.message ?? "", ".git");
        assertEquals(await pathExists(join(dir, marker)), false);
      });
    });
  });
}

Deno.test("standards --pin fails before measuring when discern.toml cannot be rewritten", async () => {
  await withTempDir(async (dir) => {
    const marker = "standards-job-ran";
    await scaffoldEngine(dir);
    await writeConfig(dir, slowStandardConfig(marker));
    await gitInit(dir);
    const configPath = join(dir, "discern.toml");
    const originalMode = (await Deno.stat(configPath)).mode;
    assert(originalMode !== null, `could not read mode for ${configPath}`);
    await Deno.chmod(configPath, 0o444);
    try {
      const r = await runAgent(dir, ["standards", "--pin", "--json"]);
      assertEquals(r.code, 1, r.output);
      const obj = parseJson(r.stdout, "standards");
      assertEquals(obj.error, "write_denied");
      assertEquals(obj.diagnostics?.[0]?.tool, "write-access");
      assertStringIncludes(obj.message ?? "", "discern.toml");
      assertEquals(await pathExists(join(dir, marker)), false);
    } finally {
      await Deno.chmod(configPath, originalMode & 0o777);
    }
  });
});

Deno.test("standards --pin probes the common Git directory before measuring in a linked worktree", async () => {
  await withTempDir(async (dir) => {
    const marker = "standards-job-ran";
    await scaffoldEngine(dir);
    await writeConfig(dir, slowStandardConfig(marker));
    await gitInit(dir);
    const wt = await addWorktree(dir, "pin-common-dir");
    const commonRaw = await gitOut(wt, "rev-parse", "--git-common-dir");
    const commonDir = isAbsolute(commonRaw) ? commonRaw : join(wt, commonRaw);
    const originalMode = (await Deno.stat(commonDir)).mode;
    assert(originalMode !== null, `could not read mode for ${commonDir}`);
    await Deno.chmod(commonDir, 0o555);
    try {
      const r = await runAgent(wt, ["standards", "--pin", "--json"]);
      assertEquals(r.code, 1, r.output);
      const obj = parseJson(r.stdout, "standards");
      assertEquals(obj.error, "write_denied");
      assertEquals(obj.diagnostics?.[0]?.tool, "write-access");
      assertEquals(
        obj.diagnostics?.[0]?.reproduce_cmd,
        "discern standards --pin",
      );
      assertStringIncludes(obj.message ?? "", commonDir);
      assertEquals(await pathExists(join(wt, marker)), false);
    } finally {
      await Deno.chmod(commonDir, originalMode & 0o777);
    }
  });
});

// The future-sibling guard: the cases derive from the production registry. Add a
// new admin-state file under any unrelated name and this test auto-enrols it,
// proving the common preflight actually reaches its resolved path.
for (const role of VALIDATION_ADMIN_STATE_KEYS) {
  const filename = GIT_ADMIN_STATE[role].path;
  Deno.test(`admin-state preflight auto-enrols the ${role} registry member`, async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const target = await gitAdminPath(dir, role);
      await Deno.mkdir(dirname(target), { recursive: true });
      await Deno.mkdir(target);

      const result = await preflightAdminStateWrites(dir);
      assert(!result.ok, `expected ${filename} to block the preflight`);
      assertEquals(result.path, target);
    });
  });
}

Deno.test("a successful admin-state preflight removes every temporary probe", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const adminDir = dirname(await gitAdminPath(dir, "gateProof"));
    assertEquals(await pathExists(adminDir), false);

    const result = await preflightAdminStateWrites(dir);
    assert(result.ok, JSON.stringify(result));
    const after = await directoryEntryNames(adminDir);
    assertEquals(after, []);
    assert(
      after.every((name) => !name.startsWith(".discern-write-probe-")),
      `write probe leaked into ${adminDir}: ${after.join(", ")}`,
    );
  });
});

Deno.test("admin-state preflight is non-applicable before a checkout has Git metadata", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const result = await preflightAdminStateWrites(dir);
    assert(
      result.ok,
      `a checkout with no Git target has no delayed admin write: ${
        JSON.stringify(result)
      }`,
    );
  });
});

Deno.test("directory-tree probes a missing target without debris or marker changes", async () => {
  await withTempDir(async (dir) => {
    const parent = join(dir, "writable-parent");
    const target = join(parent, "future", "worktrees");
    await Deno.mkdir(parent);
    const marker = join(parent, "existing-marker");
    await Deno.writeTextFile(marker, "unchanged\n");
    const before = await directoryEntryNames(parent);

    const result = await preflightPlannedWrites([{
      kind: "directory-tree",
      path: target,
      description: "future worktree root",
    }]);
    assert(result.ok, JSON.stringify(result));
    assertEquals(await pathExists(target), false);
    assertEquals(await directoryEntryNames(parent), before);
    assertEquals(await Deno.readTextFile(marker), "unchanged\n");
  });
});

Deno.test("a fixture-added setup effect automatically supplies the probe population", async () => {
  await withTempDir(async (dir) => {
    const blocked = join(dir, "planned-target");
    await Deno.writeTextFile(blocked, "not a directory\n");
    const effect = setupRequiredEffect("begin-scaffold", {
      kind: "directory-tree",
      path: blocked,
      description: "fixture-added setup effect",
    });
    const plan = setupEffectPlan("begin", [effect]);
    assertEquals(setupPlannedWrites(plan), [...effect.writes]);

    const result = await preflightSetupEffects(plan);
    assert(!result.ok);
    assertEquals(result.path, blocked);
  });
});
