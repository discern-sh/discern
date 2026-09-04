/**
 * Landing authority at the lifecycle moments that route an agent: start,
 * green done, local status, and the fleet survey. Every assertion drives the
 * real verb cores through the CLI; the structural guard keeps grant reads
 * behind the one resolver those cores share with accept.
 */

import { assert, assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import type { DiscernResult } from "../src/shared/result.ts";
import type {
  GateWireData,
  StartData,
  StatusWireData,
} from "../src/shared/result_schemas.ts";
import { HINTS } from "../src/shared/hints.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { readySentinelPath } from "../src/engine/worktree/git.ts";
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
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

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

type StartResult = CliResultForCommand<"start"> & { data: StartData };
type DoneResult = CliResultForCommand<"done"> & { data: GateWireData };
type StatusResult = CliResultForCommand<"status"> & { data: StatusWireData };

/** Decode a lifecycle envelope and require its command-specific normal payload. */
function parseResult(stdout: string, command: "start"): StartResult;
/** Decode a done envelope and require its normal Gate payload. */
function parseResult(stdout: string, command: "done"): DoneResult;
/** Decode a status envelope and require its normal status payload. */
function parseResult(stdout: string, command: "status"): StatusResult;
/** Select the registered lifecycle decoder and require its normal data branch. */
function parseResult(
  stdout: string,
  command: "start" | "done" | "status",
): StartResult | DoneResult | StatusResult {
  if (command === "start") {
    const result = decodeCliResult(stdout, "start");
    assertResultDataKey(result, "path");
    return result;
  }
  if (command === "done") {
    const result = decodeCliResult(stdout, "done");
    assertResultDataKey(result, "failed_stage");
    return result;
  }
  const result = decodeCliResult(stdout, "status");
  assertResultDataKey(result, "location");
  return result;
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
  status: StatusResult,
  branch: string,
): NonNullable<StatusWireData["fleet"]>[number] {
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

    const plain = parseResult(
      (await runAgent(dir, ["start", "--name", "plain", "--json"])).stdout,
      "start",
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

    const started = parseResult(
      (await runAgent(dir, ["start", "--name", "docs", "--json"])).stdout,
      "start",
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
    const marker = await readySentinelPath(worktree);
    assert(marker !== undefined);
    await Deno.mkdir(join(marker, ".."), { recursive: true });
    await Deno.writeTextFile(marker, "");
    await commitPath(worktree, "docs/guide.md", "covered\n");

    const done = parseResult(
      (await runAgent(worktree, ["done", "--json"])).stdout,
      "done",
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
    assertLacksHint(done, HINTS["gate-relay-proof"]);

    const local = parseResult(
      (await runAgent(worktree, ["status", "--json"])).stdout,
      "status",
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

    const fleet = parseResult(
      (await runAgent(dir, ["status", "--json"])).stdout,
      "status",
    );
    assertEquals(
      fleetRow(fleet, "agent/covered").landing_authority,
      done.data?.landing_authority,
    );
    assertHasHint(fleet, HINTS["status-fleet-authorized-landings"], {
      total: 1,
      names: ["covered"],
    });
    const human = await runAgent(dir, ["status", "--verbose"]);
    assertTerminalTextIncludes(human.output, "Landing: granted");
    assertTerminalTextIncludes(human.output, "standing grant for map");
  });
});

Deno.test("partial standing authority names the same uncovered path at done and status", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STANDING_CONFIG);
    await gitInit(dir);
    const worktree = await addWorktree(dir, "partial");
    await commitPath(worktree, "src/main.ts", "export {};\n");

    const done = parseResult(
      (await runAgent(worktree, ["done", "--json"])).stdout,
      "done",
    );
    assertEquals(done.data?.landing_authority, {
      kind: "conversation-required",
      standing_scopes: ["map"],
      uncovered: [{ path: "src/main.ts", scopes: ["engine"] }],
      uncovered_scopes: ["engine"],
      uncovered_total: 1,
    });
    assertHasHint(done, HINTS["gate-relay-uncovered-authority"]);
    assertLacksHint(done, HINTS["gate-land-under-verified-authority"], {
      source: "standing-grant",
      scopes: ["map"],
    });

    const status = parseResult(
      (await runAgent(worktree, ["status", "--json"])).stdout,
      "status",
    );
    assertEquals(status.data?.landing_authority, done.data?.landing_authority);
    assertHasHint(status, HINTS["status-ready-uncovered-authority"], {
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

    const done = parseResult(
      (await runAgent(worktree, ["done", "--json"])).stdout,
      "done",
    );
    assertEquals(done.data?.landing_authority, {
      kind: "authorized",
      source: "effort-grant",
    });
    assertHasHint(done, HINTS["gate-land-under-verified-authority"], {
      source: "effort-grant",
      scopes: [],
    });

    const local = parseResult(
      (await runAgent(worktree, ["status", "--json"])).stdout,
      "status",
    );
    assertEquals(local.data?.landing_authority, done.data?.landing_authority);
    assertHasHint(local, HINTS["status-land-under-verified-authority"], {
      source: "effort-grant",
      scopes: [],
    });

    const fleet = parseResult(
      (await runAgent(dir, ["status", "--json"])).stdout,
      "status",
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

    const done = parseResult(
      (await runAgent(worktree, ["done", "--json"])).stdout,
      "done",
    );
    assertEquals(done.data?.landing_authority, undefined);
    assertHasHint(done, HINTS["gate-relay-proof"]);

    const status = parseResult(
      (await runAgent(worktree, ["status", "--json"])).stdout,
      "status",
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

    const cliStart = parseResult(
      (await runAgent(dir, ["start", "--name", "cli-parity", "--json"]))
        .stdout,
      "start",
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
    // projections. The parity assertion is about the clean, proof-bearing
    // finish moment, not a first pass that may have just rewritten an artifact.
    const convergence = parseResult(
      (await runAgent(worktree, ["done", "--json"])).stdout,
      "done",
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
      GateWireData
    >;
    const cliDone = parseResult(
      (await runAgent(worktree, ["done", "--json"])).stdout,
      "done",
    );
    assertEquals(
      mcpDoneResult.data?.landing_authority,
      cliDone.data?.landing_authority,
    );

    const cliStatus = parseResult(
      (await runAgent(worktree, ["status", "--json"])).stdout,
      "status",
    );
    const mcpStatus = await runTool(
      mcpTool("discern_status"),
      new WorkingRoot(worktree),
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    const mcpStatusResult = mcpStatus
      .structuredContent as unknown as DiscernResult<StatusWireData>;
    assertEquals(
      mcpStatusResult.data?.landing_authority,
      cliStatus.data?.landing_authority,
    );
  });
});

Deno.test("landing authority has one runtime derivation boundary", async () => {
  const sourceFiles = await structuralGuardScope({
    guard:
      "tests/engine_lifecycle_authority_test.ts#landing-authority-boundary",
    universe: "authored-ts",
    narrow: {
      reason:
        "Landing-authority derivation is a production lifecycle boundary implemented beneath src.",
      include: (path) => path.startsWith("src/"),
    },
  });
  const readers: string[] = [];
  const directPolicyReaders: string[] = [];
  for (const path of sourceFiles) {
    const text = await Deno.readTextFile(join(REPO_ROOT, path));
    if (/\breadEffortGrant\s*\(/.test(text)) {
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
    "src/engine/worktree/effort_grant_cleanup.ts",
    "src/engine/worktree/effort_grant_writer.ts",
    "src/engine/worktree/landing_authority.ts",
  ]);
  assertEquals(directPolicyReaders, []);

  const consumers = new Set([
    "src/engine/gate/finish.ts",
    "src/engine/status/status.ts",
    "src/engine/worktree/lifecycle.ts",
  ]);
  const consumerFiles = sourceFiles.filter((rel) => consumers.has(rel));
  assertEquals(
    consumerFiles.length,
    consumers.size,
    "every declared landing-authority consumer belongs to the source universe",
  );
  for (const path of consumerFiles) {
    const text = await Deno.readTextFile(join(REPO_ROOT, path));
    assert(
      text.includes("inspectLandingAuthority"),
      `${
        relative(REPO_ROOT, join(REPO_ROOT, path))
      } bypasses the authority resolver`,
    );
  }
});
