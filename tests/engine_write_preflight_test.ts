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
import {
  ADMIN_STATE_FILES,
  preflightAdminStateWrites,
} from "../src/engine/gate/receipt.ts";

// deno-lint-ignore no-explicit-any
function parseJson(stdout: string): any {
  return JSON.parse(stdout.trim());
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

async function directoryEntryNames(path: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    names.push(entry.name);
  }
  return names.sort();
}

/** Resolve one admin-state path, then make its containing Git admin directory
 * unwritable for exactly one assertion. All current admin-state files share this
 * directory; production derives the complete set from its own registry. */
async function gitAdminPath(root: string, filename: string): Promise<string> {
  const raw = await gitOut(root, "rev-parse", "--git-path", filename);
  return isAbsolute(raw) ? raw : join(root, raw);
}

async function withUnwritableGitAdmin(
  root: string,
  fn: () => Promise<void>,
): Promise<void> {
  const path = await gitAdminPath(root, ADMIN_STATE_FILES.gateReceipt);
  const dir = dirname(path);
  const originalMode = (await Deno.stat(dir)).mode;
  assert(originalMode !== null, `could not read mode for ${dir}`);
  await Deno.chmod(dir, 0o555);
  try {
    await fn();
  } finally {
    await Deno.chmod(dir, originalMode & 0o777);
  }
}

function slowStandardConfig(marker: string): string {
  return [
    "[project]",
    'slug = "engine-test"',
    'main_branch = "main"',
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
        'main_branch = "main"',
        "",
        "[capabilities]",
        `test = "touch ${marker}"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    await withUnwritableGitAdmin(dir, async () => {
      const r = await runAgent(dir, ["done", "--json"]);
      assertEquals(r.code, 1, r.output);
      const obj = parseJson(r.stdout);
      assertEquals(obj.data.failed_stage, "write_access");
      assertEquals(obj.diagnostics?.[0]?.tool, "write-access");
      assertStringIncludes(obj.diagnostics?.[0]?.message ?? "", ".git");
      assertEquals(await pathExists(join(dir, marker)), false);
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
        const obj = parseJson(r.stdout);
        assertEquals(obj.error, "write_access");
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
      const obj = parseJson(r.stdout);
      assertEquals(obj.error, "write_access");
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
      const obj = parseJson(r.stdout);
      assertEquals(obj.error, "write_access");
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
for (const [role, filename] of Object.entries(ADMIN_STATE_FILES)) {
  Deno.test(`admin-state preflight auto-enrols the ${role} registry member`, async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      const target = await gitAdminPath(dir, filename);
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
    const adminDir = dirname(
      await gitAdminPath(dir, ADMIN_STATE_FILES.gateReceipt),
    );
    const before = await directoryEntryNames(adminDir);

    const result = await preflightAdminStateWrites(dir);
    assert(result.ok, JSON.stringify(result));
    const after = await directoryEntryNames(adminDir);
    assertEquals(after, before);
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
