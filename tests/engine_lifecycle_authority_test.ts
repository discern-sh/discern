/**
 * Landing authority at the lifecycle moments that route an agent: start,
 * green done, local status, and the fleet survey. Every assertion drives the
 * real verb cores through the CLI; the structural guard keeps grant reads
 * behind the one resolver those cores share with accept.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, relative } from "@std/path";
import type { DiscernResult } from "../src/shared/result.ts";
import type {
  GateData,
  StartData,
  StatusData,
} from "../src/shared/result_schemas.ts";
import { HINTS } from "../src/shared/hints.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

const BASE_CONFIG = [
  "[project]",
  'slug = "authority-test"',
  "",
  "[meta]",
  "bootstrapped = true",
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'test = "true"',
  "",
  "[scopes.map]",
  'paths = ["docs/**"]',
  "neutral = true",
  "",
  "[scopes.engine]",
  'paths = ["src/**"]',
  "",
].join("\n");

const STANDING_CONFIG = [
  BASE_CONFIG,
  "[acceptance]",
  'pre_authorized = ["map"]',
  "",
].join("\n");

/** Decode a lifecycle envelope while preserving its command-specific data type. */
function parseResult<T>(stdout: string): DiscernResult<T> {
  return JSON.parse(stdout.trim()) as DiscernResult<T>;
}

/** Create and commit one classified path on the acceptance branch. */
async function commitPath(
  worktree: string,
  path: string,
  body: string,
): Promise<void> {
  const target = join(worktree, path);
  await Deno.mkdir(join(target, ".."), { recursive: true });
  await Deno.writeTextFile(target, body);
  await git(worktree, "add", "-A");
  await git(
    worktree,
    "commit",
    "-q",
    "-m",
    `change ${path}`,
    "--no-gpg-sign",
  );
}

/** Select a branch from status fleet data and fail with the missing branch name. */
function fleetRow(
  status: DiscernResult<StatusData>,
  branch: string,
): NonNullable<StatusData["fleet"]>[number] {
  const row = status.data?.fleet?.find((entry) => entry.branch === branch);
  assert(row !== undefined, `expected ${branch} in fleet`);
  return row;
}

/** Resolve a tool from the canonical MCP registry so new surface metadata is tested in place. */
function mcpTool(name: string): (typeof TOOLS)[number] {
  const tool = TOOLS.find((entry) => entry.name === name);
  assert(tool !== undefined, `expected MCP tool ${name}`);
  return tool;
}

Deno.test("start reports prospective standing authority while the unconfigured default stays byte-inert", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, BASE_CONFIG);
    await gitInit(dir);

    const plain = parseResult<StartData>(
      (await runAgent(dir, ["start", "--name", "plain", "--json"])).stdout,
    );
    assertEquals(plain.data?.landing_authority, undefined);
    assertLacksHint(plain, HINTS["start-landing-authority"], {
      source: undefined,
      standingScopes: [],
      warnings: [],
    });
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STANDING_CONFIG);
    await gitInit(dir);

    const started = parseResult<StartData>(
      (await runAgent(dir, ["start", "--name", "docs", "--json"])).stdout,
    );
    assertEquals(started.data?.landing_authority, {
      kind: "conversation-required",
      standing_scopes: ["map"],
    });
    assertHasHint(started, HINTS["start-landing-authority"], {
      source: undefined,
      standingScopes: ["map"],
      warnings: [],
    });
  });
});

Deno.test("covered standing authority agrees across green done, local status, and fleet status", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STANDING_CONFIG);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "covered");
    await commitPath(worktree, "docs/guide.md", "covered\n");

    const done = parseResult<GateData>(
      (await runAgent(worktree, ["done", "--json"])).stdout,
    );
    assertEquals(done.ok, true);
    assertEquals(done.data?.landing_authority, {
      kind: "authorized",
      source: "standing-grant",
      scopes: ["map"],
      standing_scopes: ["map"],
    });
    assertHasHint(done, HINTS["gate-land-under-verified-authority"], {
      source: "standing-grant",
      scopes: ["map"],
    });
    assertLacksHint(done, HINTS["gate-relay-receipt"]);

    const local = parseResult<StatusData>(
      (await runAgent(worktree, ["status", "--json"])).stdout,
    );
    assertEquals(local.data?.landing_authority, done.data?.landing_authority);
    assertHasHint(local, HINTS["status-land-under-verified-authority"], {
      source: "standing-grant",
      scopes: ["map"],
    });
    assertLacksHint(local, HINTS["status-ready-for-review"], {
      trunk: "main",
      branch: "agent/covered",
    });

    const fleet = parseResult<StatusData>(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assertEquals(
      fleetRow(fleet, "agent/covered").landing_authority,
      done.data?.landing_authority,
    );
    assertHasHint(fleet, HINTS["status-fleet-authorized-landings"], {
      total: 1,
      names: ["covered"],
    });
    const human = await runAgent(dir, ["status"]);
    assertStringIncludes(human.output, "AUTHORITY");
    assertStringIncludes(human.output, "standing grant: map");
  });
});

Deno.test("partial standing authority names the same uncovered path at done and status", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STANDING_CONFIG);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "partial");
    await commitPath(worktree, "src/main.ts", "export {};\n");

    const done = parseResult<GateData>(
      (await runAgent(worktree, ["done", "--json"])).stdout,
    );
    assertEquals(done.data?.landing_authority, {
      kind: "conversation-required",
      standing_scopes: ["map"],
      uncovered: [{ path: "src/main.ts", scopes: ["engine"] }],
    });
    assertHasHint(done, HINTS["gate-relay-uncovered-authority"], {
      uncovered: ["`src/main.ts` (scopes: engine)"],
      warnings: [],
    });
    assertLacksHint(done, HINTS["gate-land-under-verified-authority"], {
      source: "standing-grant",
      scopes: ["map"],
    });

    const status = parseResult<StatusData>(
      (await runAgent(worktree, ["status", "--json"])).stdout,
    );
    assertEquals(status.data?.landing_authority, done.data?.landing_authority);
    assertHasHint(status, HINTS["status-ready-uncovered-authority"], {
      uncovered: ["`src/main.ts` (scopes: engine)"],
      warnings: [],
      trunk: "main",
      branch: "agent/partial",
    });
  });
});

Deno.test("an effort grant is distinct and visible at done, local status, and the fleet", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, BASE_CONFIG);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "effort");
    await commitPath(worktree, "src/main.ts", "export {};\n");
    await grantEffort(worktree, "agent/effort", "2026-07-28T01:00:00.000Z");

    const done = parseResult<GateData>(
      (await runAgent(worktree, ["done", "--json"])).stdout,
    );
    assertEquals(done.data?.landing_authority, {
      kind: "authorized",
      source: "effort-grant",
    });
    assertHasHint(done, HINTS["gate-land-under-verified-authority"], {
      source: "effort-grant",
      scopes: [],
    });

    const local = parseResult<StatusData>(
      (await runAgent(worktree, ["status", "--json"])).stdout,
    );
    assertEquals(local.data?.landing_authority, done.data?.landing_authority);
    assertHasHint(local, HINTS["status-land-under-verified-authority"], {
      source: "effort-grant",
      scopes: [],
    });

    const fleet = parseResult<StatusData>(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assertEquals(
      fleetRow(fleet, "agent/effort").landing_authority,
      done.data?.landing_authority,
    );
  });
});

Deno.test("no grant preserves the existing relay fork at done and status", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, BASE_CONFIG);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "review");
    await commitPath(worktree, "src/main.ts", "export {};\n");

    const done = parseResult<GateData>(
      (await runAgent(worktree, ["done", "--json"])).stdout,
    );
    assertEquals(done.data?.landing_authority, undefined);
    assertHasHint(done, HINTS["gate-relay-receipt"]);

    const status = parseResult<StatusData>(
      (await runAgent(worktree, ["status", "--json"])).stdout,
    );
    assertEquals(status.data?.landing_authority, undefined);
    assertHasHint(status, HINTS["status-ready-for-review"], {
      trunk: "main",
      branch: "agent/review",
    });
  });
});

Deno.test("MCP and CLI carry the same authority projection at every lifecycle moment", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STANDING_CONFIG);
    await gitInit(dir);

    const cliStart = parseResult<StartData>(
      (await runAgent(dir, ["start", "--name", "cli-parity", "--json"]))
        .stdout,
    );
    const working = new WorkingRoot(dir);
    const mcpStart = await runTool(
      mcpTool("discern_start"),
      working,
      { name: "mcp-parity" },
      undefined,
      () => Promise.resolve(undefined),
    );
    const mcpStartResult = mcpStart
      .structuredContent as unknown as DiscernResult<
        StartData
      >;
    assertEquals(
      mcpStartResult.data?.landing_authority,
      cliStart.data?.landing_authority,
    );
  });

  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STANDING_CONFIG);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "parity");
    await commitPath(worktree, "docs/parity.md", "covered\n");

    // Let the gate's fix stage converge before comparing the two wire
    // projections. The parity assertion is about the clean, receipt-bearing
    // finish moment, not a first pass that may have just rewritten an artifact.
    const convergence = parseResult<GateData>(
      (await runAgent(worktree, ["done", "--json"])).stdout,
    );
    assertEquals(convergence.ok, true, JSON.stringify(convergence));
    const mcpDone = await runTool(
      mcpTool("discern_done"),
      new WorkingRoot(worktree),
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    const mcpDoneResult = mcpDone.structuredContent as unknown as DiscernResult<
      GateData
    >;
    const cliDone = parseResult<GateData>(
      (await runAgent(worktree, ["done", "--json"])).stdout,
    );
    assertEquals(
      mcpDoneResult.data?.landing_authority,
      cliDone.data?.landing_authority,
    );

    const cliStatus = parseResult<StatusData>(
      (await runAgent(worktree, ["status", "--json"])).stdout,
    );
    const mcpStatus = await runTool(
      mcpTool("discern_status"),
      new WorkingRoot(worktree),
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    const mcpStatusResult = mcpStatus
      .structuredContent as unknown as DiscernResult<StatusData>;
    assertEquals(
      mcpStatusResult.data?.landing_authority,
      cliStatus.data?.landing_authority,
    );
  });
});

Deno.test("landing authority has one runtime derivation boundary", async () => {
  const sourceFiles = AUTHORED_TS_FILES.filter((path) =>
    path.startsWith("src/")
  );
  const readers: string[] = [];
  const directPolicyReaders: string[] = [];
  for (const path of sourceFiles) {
    const text = await Deno.readTextFile(join(REPO_ROOT, path));
    if (/\breadEffortGrant\b/.test(text)) {
      readers.push(path);
    }
    if (
      path.startsWith("src/engine/") &&
      path !== "src/engine/worktree/landing_authority.ts" &&
      text.includes(".acceptance.pre_authorized")
    ) {
      directPolicyReaders.push(path);
    }
  }
  assertEquals(readers.sort(), [
    "src/engine/worktree/effort_grant.ts",
    "src/engine/worktree/effort_grant_writer.ts",
    "src/engine/worktree/landing_authority.ts",
  ]);
  assertEquals(directPolicyReaders, []);

  for (
    const path of [
      "src/engine/gate/finish.ts",
      "src/engine/status/status.ts",
      "src/engine/worktree/lifecycle.ts",
    ]
  ) {
    const text = await Deno.readTextFile(join(REPO_ROOT, path));
    assert(
      text.includes("inspectLandingAuthority"),
      `${
        relative(REPO_ROOT, join(REPO_ROOT, path))
      } bypasses the authority resolver`,
    );
  }
});
