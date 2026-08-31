/**
 * Engine coverage for `discern status` — the read-only situation/orientation verb
 * (ADR 0033). Drives the real verb via `deno task dev status` in scaffolded temp
 * repos and asserts on the `--json` DiscernResult envelope. Covers the
 * location-aware default (fleet-led from the main checkout, local from a worktree),
 * the `--all`/`--local` overrides, the not-initialized degradation, the advisory
 * hints, and — load-bearing — that `status` never mutates anything (pure
 * observation).
 */

import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { displayWidth } from "../src/lib/text.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  defaultMapPath,
  engineEnv,
  git,
  gitInit,
  runAgent,
  runAgentPty,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { HINTS } from "../src/shared/hints.ts";
import { KNOWN_JOBS, type KnownJob } from "../src/shared/capabilities.ts";
import { providersWithHooks } from "../src/lib/providers.ts";
import type { AgentName } from "../src/lib/config.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { configEpoch } from "../src/engine/logbook/epoch.ts";
import { appendEvent } from "../src/engine/logbook/store.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
} from "../src/engine/logbook/schema.ts";
import { DISCERN_TRIANGLE_GLYPHS } from "../art/terminal/triangle.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";
import { seedForBranch } from "../src/engine/worktree/identity.ts";
import { realPtyTest } from "./real_pty.ts";
import { readySentinelPath } from "../src/engine/worktree/git.ts";

const STATUS_ESCAPE = String.fromCharCode(27);

/** Add a healthy linked checkout for status cases unrelated to setup recovery. */
async function addReadyWorktree(root: string, name: string): Promise<string> {
  const worktree = await addWorktree(root, name);
  const marker = await readySentinelPath(worktree);
  assert(marker !== undefined);
  await ensureDir(dirname(marker));
  await Deno.writeTextFile(marker, "");
  return worktree;
}

type StatusResult = CliResultForCommand<"status">;
type StatusData = Exclude<
  NonNullable<StatusResult["data"]>,
  { issues: unknown }
>;
type ParsedStatusResult = StatusResult & { data: StatusData };

/** A config with a project slug and one gated scope (so scopes/gate have
 * something to classify), written before gitInit so a worktree inherits it. */
const SCOPE_CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[scopes.web]",
  'paths = ["web/**"]',
  'gate = "true"',
  "",
].join("\n");

/** Render known jobs, a custom check, and a scoped gate for status truth-table cases. */
function statusGateFactsConfig(
  wiredKnownJobs: readonly KnownJob[],
): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    ...wiredKnownJobs.map((name) => `${name} = "true"`),
    "",
    "[jobs.custom]",
    'stage = "check"',
    'run = "true"',
    "",
    "[scopes.web]",
    'paths = ["web/**"]',
    'gate = "true"',
    "",
    "[scopes.api]",
    'paths = ["api/**"]',
    'gate = "true"',
    "",
  ].join("\n");
}

/** Parse a `status --json` run, asserting it succeeded and carries the verb. */
function parseStatus(stdout: string): ParsedStatusResult {
  const obj = decodeCliResult(stdout, "status");
  assertEquals(obj.verb, "status");
  assertResultDataKey(obj, "location");
  return obj;
}

/** Collapse responsive wrapping before comparing one complete human fact. */
function normalized(text: string): string {
  return text.replaceAll(/\s+/gu, " ").trim();
}

/** Find one package section rule without pinning its capability-specific glyphs. */
function sectionRuleLine(output: string, label: string): string {
  const marker = ` ${label.toLocaleLowerCase()} `;
  const line = output.split("\n").find((candidate) => {
    const markerAt = candidate.toLocaleLowerCase().indexOf(marker);
    if (markerAt < 1) return false;
    const left = candidate.slice(0, markerAt);
    const right = candidate.slice(markerAt + marker.length);
    const decoration = right.replaceAll(/[ v]/gu, "");
    return left.trim().length > 0 && decoration.length > 0 &&
      !/[\p{L}\p{N}]/u.test(decoration);
  });
  assert(
    line !== undefined,
    `missing package section rule ${label}:\n${output}`,
  );
  return line;
}

/** Prove one labelled state fact without treating its status mark as data. */
function assertStatusFactLine(
  output: string,
  label: string,
  state: string,
): void {
  assert(
    output.split("\n").some((line) =>
      line.includes(label) && line.includes(state)
    ),
    `missing ${label} state ${state}:\n${output}`,
  );
}

Deno.test("status assertions accept either package glyph repertoire", () => {
  const triangles = DISCERN_TRIANGLE_GLYPHS;
  const unicodeRule =
    `${triangles.upRight}${triangles.downRight}${triangles.upLeft} ` +
    `CURRENT WORKTREE ` +
    `${triangles.upLeft}${triangles.downRight}${triangles.upRight}`;
  assertEquals(
    sectionRuleLine(">v<> CURRENT WORKTREE v><^", "Current worktree"),
    ">v<> CURRENT WORKTREE v><^",
  );
  assertEquals(
    sectionRuleLine(unicodeRule, "Current worktree"),
    unicodeRule,
  );
  assertStatusFactLine("Proof ... + honored", "Proof", "honored");
  assertStatusFactLine("Proof ... ✓ honored", "Proof", "honored");
});

Deno.test("status: the fleet view surfaces cross-worktree file collisions", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const alpha = await addWorktree(dir, "alpha");
    const beta = await addWorktree(dir, "beta");
    // Both efforts change the same file since their fork — a semantic
    // collision in the making even though each merges cleanly on its own.
    await Deno.writeTextFile(join(alpha, "shared.txt"), "alpha\n");
    await git(alpha, "add", "-A");
    await git(alpha, "commit", "-q", "-m", "alpha shared", "--no-gpg-sign");
    await Deno.writeTextFile(join(beta, "shared.txt"), "beta\n");
    await git(beta, "add", "-A");
    await git(beta, "commit", "-q", "-m", "beta shared", "--no-gpg-sign");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    const collisions = obj.data.fleet_collisions;
    assert(
      Array.isArray(collisions) && collisions.length === 1,
      `expected exactly one collision pair: ${r.stdout}`,
    );
    const collision = collisions[0];
    assertExists(collision);
    assertEquals("overlap" in collision, false);
    assertEquals(collision.total, 1);
    const [first, second] = collision.branches;
    assertHasHint(obj, HINTS["status-fleet-collisions"], {
      total: 1,
      pairs: [`${first} ↔ ${second}`],
    });

    const verbose = await runAgent(dir, ["status", "--verbose"]);
    assertEquals(verbose.code, 0, verbose.output);
    assertStringIncludes(verbose.output, "shared.txt");
  });
});

/** Commit one `0007-<slug>.md` record in a worktree — the "next free number"
 * pick that collides only number-wise, never path-wise. */
async function commitAdr(worktree: string, slug: string): Promise<void> {
  const adrDir = defaultMapPath(worktree, "_adr");
  await Deno.mkdir(adrDir, { recursive: true });
  await Deno.writeTextFile(join(adrDir, `0007-${slug}.md`), "# record\n");
  await git(worktree, "add", "-A");
  await git(worktree, "commit", "-q", "-m", slug, "--no-gpg-sign");
}

Deno.test("status: in-flight branches claiming one ADR number are surfaced — even when one has no worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const alpha = await addWorktree(dir, "alpha");
    const beta = await addWorktree(dir, "beta");
    // Both efforts pick the next free record number: DIFFERENT files, so the
    // changed-file collision scan sees nothing and both merge cleanly.
    await commitAdr(alpha, "alpha-take");
    await commitAdr(beta, "beta-take");
    // Park beta as an unlanded branch with no worktree — the claimant shape a
    // fleet pair scan would never see.
    await git(dir, "worktree", "remove", "--force", beta);

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    const collisions = obj.data.adr_collisions;
    assert(
      Array.isArray(collisions) && collisions.length === 1,
      `expected exactly one ADR collision: ${r.stdout}`,
    );
    const collision = collisions[0];
    assertExists(collision);
    assertEquals(collision.number, "0007");
    assertEquals(collision.branches, ["agent/alpha", "agent/beta"]);
    assertEquals("paths" in collision, false);
    assertHasHint(obj, HINTS["status-adr-number-collisions"], {
      total: 1,
      claims: ["0007 (agent/alpha ↔ agent/beta)"],
    });

    // The remaining worktree's LOCAL view carries the collision too — its own
    // branch is a party, and that session is the one that may need to renumber.
    const local = await runAgent(alpha, ["status", "--json"]);
    assertEquals(local.code, 0, local.output);
    const localObj = parseStatus(local.stdout);
    assertEquals(localObj.data.location, "worktree");
    assertEquals(localObj.data.adr_collisions?.length, 1);
    assertHasHint(localObj, HINTS["status-adr-number-collisions"], {
      total: 1,
      claims: ["0007 (agent/alpha ↔ agent/beta)"],
    });
  });
});

Deno.test("status: a worktree outside an ADR collision does not carry other branches' contested numbers", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const alpha = await addWorktree(dir, "alpha");
    const beta = await addWorktree(dir, "beta");
    const gamma = await addWorktree(dir, "gamma");
    await commitAdr(alpha, "alpha-take");
    await commitAdr(beta, "beta-take");

    // Gamma's local view: the 0007 contest is alpha↔beta's to resolve, not
    // gamma's — no rows, no hint.
    const r = await runAgent(gamma, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(obj.data.adr_collisions, undefined);
    assertLacksHint(obj, HINTS["status-adr-number-collisions"]);
  });
});

Deno.test("status: from the main checkout, the default leads with the fleet (and a main row)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(obj.data.location, "main");
    assertEquals(obj.data.projection.mode, "orientation");
    assertEquals(obj.data.project, "engine-test");
    assertExists(obj.data.worktree);
    assertEquals(obj.data.worktree.id, "main");
    assertEquals(obj.data.worktree.branch, "main");
    assertEquals(obj.data.worktree.seed, seedForBranch("main"));
    assert(Array.isArray(obj.data.fleet), `expected a fleet: ${r.stdout}`);
    assertExists(obj.data.fleet);
    assertEquals(obj.data.fleet_total, 1);
    assertHasHint(obj, HINTS["status-full-structured-detail"]);
    // The main checkout is always a row, so nothing is hidden…
    assert(
      obj.data.fleet.some((e: { is_main: boolean }) => e.is_main),
      `fleet must include the main row: ${JSON.stringify(obj.data.fleet)}`,
    );
    // …alongside the linked worktree.
    assert(
      obj.data.fleet.some((e: { is_main: boolean; branch: string }) =>
        !e.is_main && e.branch === "agent/alpha"
      ),
      `fleet must include the worktree row: ${JSON.stringify(obj.data.fleet)}`,
    );
    const alpha = obj.data.fleet.find(
      (e: { branch: string }) => e.branch === "agent/alpha",
    );
    assertExists(alpha);
    assertExists(alpha.gate_proof);
    assertEquals(alpha.gate_proof.status, "missing");
    // Every row carries a recent last_activity (an ISO timestamp).
    for (const e of obj.data.fleet) {
      assert(
        typeof e.last_activity === "string",
        `fleet row should carry last_activity: ${JSON.stringify(e)}`,
      );
      const ageMs = SYSTEM_CLOCK.wallNow() - Date.parse(e.last_activity);
      assert(
        ageMs >= 0 && ageMs < 5 * 60 * 1000,
        `last_activity should be recent, got ${e.last_activity}`,
      );
    }
    // Leading with the fleet omits the heavy local-only blocks.
    assertEquals(obj.data.gate, undefined);

    const full = await runAgent(dir, ["status", "--verbose", "--json"]);
    assertEquals(full.code, 0, full.output);
    const fullObj = parseStatus(full.stdout);
    assertEquals(fullObj.data.projection.mode, "full");
    assertExists(fullObj.data.fleet);
    assertEquals(fullObj.data.fleet.length, 2);
    assertLacksHint(fullObj, HINTS["status-full-structured-detail"]);
    assertEquals(obj.data.scopes, undefined);

    // --local suppresses the fleet and restores the local blocks.
    const local = await runAgent(dir, ["status", "--local", "--json"]);
    assertEquals(local.code, 0, local.output);
    const lobj = parseStatus(local.stdout);
    assertEquals(lobj.data.fleet, undefined);
    assert(
      lobj.data.gate,
      `--local must restore the gate block: ${local.stdout}`,
    );
    assert(Array.isArray(lobj.data.scopes));
  });
});

Deno.test("status fleet: logbook actions, live work, duration priors, and last-activity max reach each row", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addReadyWorktree(dir, "alpha");
    await addReadyWorktree(dir, "beta");
    const epoch = configEpoch(await loadConfig(dir)).fingerprint;
    const now = SYSTEM_CLOCK.wallNow();
    const at = (agoMs: number): string => new Date(now - agoMs).toISOString();
    const completion = (
      branch: string,
      invocation: string,
      atIso: string,
      durationMs: number,
      outcome: "ok" | "failed" = "ok",
      failedStage?: string,
    ): LogbookEvent => ({
      schema: LOGBOOK_SCHEMA_VERSION,
      at: atIso,
      writer: "test",
      kind: "verb",
      invocation,
      verb: "done",
      surface: "cli",
      driver: {},
      branch,
      head: "abc1234",
      clean: true,
      outcome,
      ...(failedStage !== undefined ? { failed_stage: failedStage } : {}),
      duration_ms: durationMs,
      epoch,
    });
    const commonGitDir = join(dir, ".git");
    for (
      const event of [
        completion("agent/alpha", "alpha-1", at(30 * 60_000), 180_000),
        completion("agent/alpha", "alpha-2", at(20 * 60_000), 300_000),
        completion(
          "agent/beta",
          "beta-1",
          at(12 * 60_000 + 30_000),
          240_000,
          "failed",
          "test",
        ),
        {
          schema: LOGBOOK_SCHEMA_VERSION,
          at: at(2 * 60_000 + 30_000),
          writer: "test",
          kind: "begin",
          invocation: "alpha-running",
          verb: "done",
          surface: "cli",
          driver: {},
          branch: "agent/alpha",
          head: "abc1234",
          epoch,
        },
        {
          schema: LOGBOOK_SCHEMA_VERSION,
          at: new Date(now + 60_000).toISOString(),
          writer: "test",
          kind: "config-change",
          branch: "agent/alpha",
          sections: ["jobs"],
          epoch,
        },
      ] satisfies LogbookEvent[]
    ) {
      await appendEvent(commonGitDir, event);
    }

    const run = await runAgent(dir, ["status", "--json"]);
    assertEquals(run.code, 0, run.output);
    const result = parseStatus(run.stdout);
    assertExists(result.data.fleet);
    const alpha = result.data.fleet.find((row: { branch: string }) =>
      row.branch === "agent/alpha"
    );
    const beta = result.data.fleet.find((row: { branch: string }) =>
      row.branch === "agent/beta"
    );
    assert(alpha !== undefined && beta !== undefined, run.stdout);
    assertExists(alpha.running);
    assertEquals(alpha.running.verb, "done");
    assertEquals(alpha.running.started, at(2 * 60_000 + 30_000));
    assert(
      alpha.running.elapsed_ms >= 150_000 &&
        alpha.running.elapsed_ms < 180_000,
      JSON.stringify(alpha.running),
    );
    assertEquals(alpha.running.typical_duration_ms, 240_000);
    assertEquals(
      alpha.last_activity,
      new Date(now + 60_000).toISOString(),
      "the newest branch event must outrank the git-derived timestamp",
    );
    assertEquals(beta.last_action, {
      verb: "done",
      outcome: "failed",
      at: at(12 * 60_000 + 30_000),
      failed_stage: "test",
    });
    assertEquals(beta.running, undefined);

    const human = await runAgent(dir, ["status", "--verbose"]);
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(human.output, "Gate running · 2m");
    assertTerminalTextIncludes(human.output, "Activity: just now · usually 4m");
    assertTerminalTextIncludes(human.output, "done failed at test");
  });
});

Deno.test("status fleet: logbook-off rows degrade to git activity and carry the point-of-use hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, "[project]\nlogbook = false\n");
    await gitInit(dir);
    await addReadyWorktree(dir, "alpha");

    const run = await runAgent(dir, ["status", "--json"]);
    assertEquals(run.code, 0, run.output);
    const result = parseStatus(run.stdout);
    assertExists(result.data.fleet);
    for (const row of result.data.fleet) {
      assertEquals(row.last_action, undefined);
      assertEquals(row.running, undefined);
      assert(
        typeof row.last_activity === "string",
        "git-derived last_activity remains available",
      );
    }
    const expected = assertHasHint(
      result,
      HINTS["status-fleet-logbook-disabled"],
    );
    const human = await runAgent(dir, ["status"]);
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(normalized(human.output), expected);
  });
});

Deno.test("status fleet: exactly the main row is is_current from the main checkout", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");
    await addWorktree(dir, "beta");

    const obj = parseStatus((await runAgent(dir, ["status", "--json"])).stdout);
    const fleet = obj.data.fleet as Array<
      { is_main: boolean; is_current: boolean; branch: string }
    >;
    // Every row carries the (required) boolean — never undefined.
    for (const e of fleet) {
      assertEquals(typeof e.is_current, "boolean", JSON.stringify(e));
    }
    // Exactly one row is current, and from the main checkout it is the main row;
    // every worktree row is explicitly not-current (not absent, not "available").
    const current = fleet.filter((e) => e.is_current);
    assertEquals(
      current.length,
      1,
      `exactly one current row: ${JSON.stringify(fleet)}`,
    );
    assert(current[0]?.is_main, "the current row from main is the main row");
    for (const e of fleet) {
      if (!e.is_main) {
        assertEquals(
          e.is_current,
          false,
          `worktree row not current: ${JSON.stringify(e)}`,
        );
      }
    }
  });
});

Deno.test("status fleet: under --all from a worktree, that worktree's row is is_current", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await addWorktree(dir, "beta");

    const obj = parseStatus(
      (await runAgent(wt, ["status", "--all", "--json"])).stdout,
    );
    const fleet = obj.data.fleet as Array<
      { is_main: boolean; is_current: boolean; branch: string }
    >;
    const current = fleet.filter((e) => e.is_current);
    assertEquals(
      current.length,
      1,
      `exactly one current row: ${JSON.stringify(fleet)}`,
    );
    assertEquals(
      current[0]?.branch,
      "agent/alpha",
      "the current row is this worktree",
    );
    assertEquals(current[0]?.is_main, false);
    // The sibling worktree and the main row are present but not current.
    assertEquals(
      fleet.find((e) => e.is_main)?.is_current,
      false,
      "the main row is not current from a worktree",
    );
    assertEquals(
      fleet.find((e) => e.branch === "agent/beta")?.is_current,
      false,
      "a sibling worktree is not current",
    );
  });
});

Deno.test("status fleet: the ownership rule rides in hints[] for an agent (main checkout)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const obj = parseStatus((await runAgent(dir, ["status", "--json"])).stdout);
    assertHasHint(obj, HINTS["fleet-ownership"]);
  });
});

Deno.test("status: a main-rooted follow-up leads with its existing effort before a new start", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const obj = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    const continuity = assertHasHint(obj, HINTS["status-start-on-trunk"]);
    const ownership = assertHasHint(obj, HINTS["fleet-ownership"]);
    assertStringIncludes(
      continuity,
      "If this effort already has a worktree, continue there using its recorded path",
    );
    assertStringIncludes(continuity, "Do not call `discern start` again");
    assertStringIncludes(
      ownership,
      "Continue a fleet worktree only if this effort created it",
    );
    const hints = obj.hints ?? [];
    assert(
      hints.indexOf(continuity) < hints.indexOf(ownership),
      `continuity must precede fleet ownership: ${JSON.stringify(hints)}`,
    );
  });
});

Deno.test("status fleet: the ownership rule rides in hints[] under --all from a worktree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await addWorktree(dir, "beta"); // a sibling → a line of work other than this one

    const obj = parseStatus(
      (await runAgent(wt, ["status", "--all", "--json"])).stdout,
    );
    assertHasHint(obj, HINTS["fleet-ownership"]);
  });
});

Deno.test("status: on the trunk, the discern start guardrail rides in hints[] for an agent", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // No worktrees yet — the agent is on the trunk with nowhere isolated to work.
    const obj = parseStatus((await runAgent(dir, ["status", "--json"])).stdout);
    assertEquals(obj.data.location, "main");
    assertHasHint(obj, HINTS["status-start-on-trunk"]);
  });
});

Deno.test("status: main checkout on a non-trunk branch never claims 'you're on the trunk' (B9)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // The main checkout (a working-copy LOCATION) and the trunk branch are
    // independent axes — simulate a stray branch checked out directly there (a
    // leftover `discern-setup` branch, a PR checked out without a worktree), the
    // exact shape a real cold run hit: location "main", branch != trunk.
    await git(dir, "checkout", "-b", "discern-setup");

    const obj = parseStatus((await runAgent(dir, ["status", "--json"])).stdout);
    assertEquals(obj.data.location, "main");
    assertExists(obj.data.git);
    assertEquals(obj.data.git.branch, "discern-setup");
    assertLacksHint(obj, HINTS["status-start-on-trunk"]);
    const expected = assertHasHint(obj, HINTS["status-start-off-trunk"], {
      branch: "discern-setup",
      trunk: "main",
    });

    // Still agent-only — a human running the CLI here isn't nagged with either
    // wording (exactly like the on-trunk guardrail).
    const human = await runAgent(dir, ["status"]);
    assertEquals(human.code, 0, human.output);
    assert(!human.output.includes(expected), human.output);
  });
});

Deno.test("status: the discern start guardrail is agent-only — the human CLI is not nagged", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const machine = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    const expected = assertHasHint(machine, HINTS["status-start-on-trunk"]);
    const r = await runAgent(dir, ["status"]); // human mode (no --json)
    assertEquals(r.code, 0, r.output);
    assert(!r.output.includes(expected), r.output);
  });
});

Deno.test("status: the discern start guardrail does NOT fire from a worktree (it's main-only)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");

    const obj = parseStatus(
      (await runAgent(wt, ["status", "--json"])).stdout,
    );
    assertEquals(obj.data.location, "worktree");
    assertLacksHint(obj, HINTS["status-start-on-trunk"]);
  });
});

Deno.test("status human output separates its semantic groups", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, statusGateFactsConfig(["lint", "test"]));
    await gitInit(dir);
    const wt = await addWorktree(dir, "grouped-status");

    const human = await runAgent(wt, ["status"]);
    assertEquals(human.code, 0, human.output);
    for (
      const section of [
        "Current worktree",
        "Next actions",
        "Checks",
        "Local environment",
      ]
    ) {
      const line = sectionRuleLine(human.stdout, section);
      const at = human.stdout.indexOf(line);
      assert(
        at === 0 || human.stdout.slice(0, at).endsWith("\n\n"),
        `${section} must start after a visible group boundary:\n${human.stdout}`,
      );
    }
  });
});

Deno.test("status: while setup is unfinished, the main-checkout worktree next-steps are suppressed (no contradiction)", async () => {
  // Setup runs in the main checkout (on the `discern-setup` branch). Until it is
  // recorded, the only correct "what now" is "finish setup here" — so the
  // `discern start` guardrail and the "no active worktrees" nudge must NOT fire,
  // or the agent is told to abandon setup and start a worktree (the contradiction a
  // real cold run hit). The class: NO "start work elsewhere" hint while
  // `setup_unfinished` is present.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false }); // un-set-up
    await gitInit(dir);

    const obj = parseStatus((await runAgent(dir, ["status", "--json"])).stdout);
    assertEquals(obj.data.location, "main");
    assert(
      obj.data.setup_unfinished !== undefined,
      "an un-bootstrapped project must report setup_unfinished",
    );
    assertLacksHint(obj, HINTS["status-start-on-trunk"]);
    assertLacksHint(obj, HINTS["status-no-active-worktrees"]);
  });
});

Deno.test("status JSON and terminal carry setup applicability and assurance counts", async () => {
  await withTempDir(async (dir) => {
    const applicableNames = Object.keys(KNOWN_JOBS).filter((name) =>
      name !== "build"
    );
    const applicableTotal = applicableNames.length;
    await scaffoldEngine(dir, { bootstrapped: false });
    await writeConfig(
      dir,
      [
        "[meta]",
        "bootstrapped = false",
        "",
        "[assurance]",
        'not_applicable = ["build"]',
        "",
        "[jobs]",
        ...applicableNames.map((name) => `${name} = "${name}"`),
      ].join("\n"),
    );
    await gitInit(dir);

    const json = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    const unfinished = json.data.setup_unfinished;
    assertExists(unfinished);
    assertExists(unfinished.assurance);
    assertEquals(unfinished.assurance.enforced, applicableTotal);
    assertEquals(unfinished.assurance.total, applicableTotal);
    assertEquals(
      unfinished.assurance.known_total,
      Object.keys(KNOWN_JOBS).length,
    );
    assertEquals(unfinished.assurance.not_applicable, 1);
    assertEquals(
      unfinished.known_jobs.find((job: { name: string }) =>
        job.name === "build"
      )?.not_applicable,
      true,
    );

    const terminal = await runAgent(dir, ["status"]);
    assertEquals(terminal.code, 0, terminal.output);
    assertTerminalTextIncludes(
      terminal.stdout,
      `Applicable protections: ${applicableTotal} of ${applicableTotal} enforced; 1 does not apply`,
    );
    assertTerminalTextIncludes(terminal.stdout, "does not apply: build");
  });
});

Deno.test("status fleet: ownership stays available without repeating in a routine supervisor survey", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const machine = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    const expected = assertHasHint(machine, HINTS["fleet-ownership"]);
    const r = await runAgent(dir, ["status"]); // human mode (no --json)
    assertEquals(r.code, 0, r.output);
    // The agent-channel hint text never appears in interactive output…
    assert(!r.output.includes(expected), r.output);
    // …and a routine main-checkout survey does not spend a repeated line on the
    // ownership rule. A worktree surveying siblings still gets the short safety
    // caption at its point of use.
    assert(
      !r.output.includes("Worktrees stay with the effort that created them"),
      `routine supervisor output repeated the ownership caption: ${r.output}`,
    );
    const wt = await addWorktree(dir, "beta");
    const survey = await runAgent(wt, ["status", "--all"]);
    assertEquals(survey.code, 0, survey.output);
    assertTerminalTextIncludes(
      survey.output,
      "Worktrees stay with the effort that created them",
    );
  });
});

Deno.test("status fleet (human): the wide brief is bounded and defers row evidence to verbose", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addReadyWorktree(dir, "alpha");

    const r = await runAgent(dir, ["status"], { env: { COLUMNS: "120" } });
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.output, "Worktrees");
    assert(!r.output.includes("STATE"), r.output);
    assert(!r.output.includes("ATTENTION"), r.output);
    assertEquals(r.output.match(/Git:/gu)?.length ?? 0, 0);
    assert(!r.output.includes("Proof"), r.output);
    assertStringIncludes(r.output, "Activity");
    assert(!r.output.includes("agent/alpha"), r.output);
    assertTerminalTextIncludes(r.output, "Alpha · Idle · DRIFT");
    assertEquals(r.output.match(/main checkout/giu)?.length, 1);
    assert(!r.output.includes("AHEAD/BEHIND"), r.output);
    for (const line of r.output.trimEnd().split("\n")) {
      assert(
        displayWidth(line) <= 104,
        `capped wide dashboard line exceeded 104 columns: ${line}`,
      );
    }

    const verbose = await runAgent(dir, ["status", "--verbose"], {
      env: { COLUMNS: "120" },
    });
    assertEquals(verbose.code, 0, verbose.output);
    assertStringIncludes(verbose.output, "Git:");
    assertStringIncludes(verbose.output, "Proof");
    assertStringIncludes(verbose.output, "Activity");
    assertTerminalTextIncludes(verbose.output, "Branch: agent/alpha");
  });
});

realPtyTest({
  name: "status fleet (human): a real PTY supplies width and terminal styling",
  contracts: ["control-rendering", "platform-transport"],
  canary: true,
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);
      await addReadyWorktree(dir, "alpha");
      const env = { COLUMNS: "48", CI: "false", NO_COLOR: "" };

      const colored = await runAgentPty(dir, ["status"], {
        env,
      });
      assertEquals(colored.code, 0, colored.output);
      assertStringIncludes(colored.output, `${STATUS_ESCAPE}[`);
      assertTerminalTextIncludes(colored.output, "Fleet · 1 active worktree");
      assert(!colored.output.includes("agent/alpha"), colored.output);
      assertStringIncludes(colored.output, "Alpha");
      assertStringIncludes(colored.output, "Idle");
      for (const line of colored.stdout.trimEnd().split("\n")) {
        assert(
          displayWidth(line) <= 48,
          `PTY dashboard line exceeded 48 columns: ${line}`,
        );
      }
    });
  },
});

Deno.test("status fleet (human): the brief stays bounded while verbose preserves long identities", async () => {
  // The class guard: generated identities cannot widen or dominate the brief.
  // The expanded view still preserves complete copyable Git identities.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const width = 48;
    const id = `long-${"identifier-".repeat(8)}end`;
    await addWorktree(dir, id);
    const branch = `agent/${id}`;

    const r = await runAgent(dir, ["status"], {
      env: { COLUMNS: String(width) },
    });
    assertEquals(r.code, 0, r.output);
    assert(!r.output.includes(id), r.output);
    assert(!r.output.includes(branch), r.output);
    for (const line of r.stdout.split("\n")) {
      assert(
        displayWidth(line) <= width,
        `ordinary ${width}-column line is ${
          displayWidth(line)
        } columns: ${line}`,
      );
    }

    const verbose = await runAgent(dir, ["status", "--verbose"], {
      env: { COLUMNS: String(width) },
    });
    assertEquals(verbose.code, 0, verbose.output);
    const reportText = verbose.stdout.split("\n").map((line) =>
      line
        .replace(/^[|│]\s?/u, "")
        .replace(/\s?[|│]$/u, "")
        .trim()
    ).join("");
    assertStringIncludes(reportText, `Worktree:${id}`);
    assertStringIncludes(reportText, `Branch:${branch}`);
  });
});

Deno.test("status: from a worktree, the default is local; --all adds the fleet", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");

    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(obj.data.location, "worktree");
    assertEquals(obj.data.fleet, undefined);
    // The local view carries the worktree identity + the heavy blocks.
    assert(obj.data.worktree, `expected a worktree block: ${r.stdout}`);
    assertEquals(obj.data.worktree.id, "alpha");
    assertEquals(
      obj.data.worktree.seed,
      seedForBranch("agent/alpha"),
    );
    assertExists(obj.data.git);
    assertEquals(obj.data.git.branch, "agent/alpha");
    assert(obj.data.gate);
    assert(Array.isArray(obj.data.scopes));
    const localHuman = await runAgent(wt, ["status"], {
      env: { COLUMNS: "72" },
    });
    const currentSection = sectionRuleLine(
      localHuman.output,
      "Current worktree",
    );
    const environmentSection = sectionRuleLine(
      localHuman.output,
      "Local environment",
    );
    assertStringIncludes(localHuman.output, "Port:");
    assert(!localHuman.output.includes("Change: code"), localHuman.output);
    const checksAt = localHuman.output.indexOf(
      sectionRuleLine(localHuman.output, "Checks"),
    );
    const environmentAt = localHuman.output.indexOf(environmentSection);
    assert(checksAt >= 0 && environmentAt > checksAt, localHuman.output);
    assert(
      !localHuman.output.slice(checksAt, environmentAt).includes("Port:"),
      localHuman.output,
    );
    assert(!localHuman.output.includes(" FLEET "), localHuman.output);
    assert(localHuman.output.indexOf(currentSection) >= 0);

    // --all from a worktree keeps the local blocks AND adds the fleet survey.
    const all = await runAgent(wt, ["status", "--all", "--json"]);
    assertEquals(all.code, 0, all.output);
    const aobj = parseStatus(all.stdout);
    assert(
      Array.isArray(aobj.data.fleet),
      `--all must add a fleet: ${all.stdout}`,
    );
    assert(aobj.data.gate, "--all from a worktree keeps the local gate block");
    assert(aobj.data.worktree);
    const allHuman = await runAgent(wt, ["status", "--all"], {
      env: { COLUMNS: "72" },
    });
    assertTerminalTextIncludes(allHuman.output, "Fleet · 1 active worktree");
    sectionRuleLine(allHuman.output, "Worktrees");
    sectionRuleLine(allHuman.output, "Main checkout");
  });
});

Deno.test("status: gate facts report declared jobs and triggered scope gates", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const allKnownJobs = Object.keys(KNOWN_JOBS) as KnownJob[];
    const wiredKnownJobs = allKnownJobs.filter((_, i) => i % 2 === 0);
    assert(
      wiredKnownJobs.length > 0 &&
        wiredKnownJobs.length < allKnownJobs.length,
      "the fixture must wire a real subset of the known-job vocabulary",
    );
    await writeConfig(dir, statusGateFactsConfig(wiredKnownJobs));
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");

    const clean = parseStatus(
      (await runAgent(wt, ["status", "--json"])).stdout,
    );
    assertExists(clean.data.gate);
    assertEquals(clean.data.gate.jobs, [...wiredKnownJobs, "custom"]);
    assertEquals(clean.data.gate.scope_gates, []);

    await writeExecutable(join(wt, "web/feature.txt"), "feature");
    const web = parseStatus((await runAgent(wt, ["status", "--json"])).stdout);
    assertExists(web.data.gate);
    assertEquals(web.data.gate.jobs, [...wiredKnownJobs, "custom"]);
    assertEquals(web.data.gate.scope_gates, ["web"]);
  });
});

Deno.test("status: --all and --local together is a refusal", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["status", "--all", "--local", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = decodeCliResult(r.stdout, "status");
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "status");
    assertEquals(obj.error, "invalid_arguments");

    // Human mode refuses with the same non-zero exit.
    const human = await runAgent(dir, ["status", "--all", "--local"]);
    assertEquals(human.code, 1, human.output);
  });
});

Deno.test("status: outside a discern project, the envelope is not_initialized", async () => {
  await withTempDir(async (dir) => {
    // No scaffold — there is no discern.toml in this dir or any parent.
    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 1, r.output);
    const obj = decodeCliResult(r.stdout, "status");
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "status");
    assertEquals(obj.error, "not_initialized");
    assertExists(obj.message);
    assertStringIncludes(obj.message, "no discern.toml");
    assertStringIncludes(obj.message, "discern setup");
    assertStringIncludes(obj.message, "move into an existing discern project");
  });
});

Deno.test("status: a dirty worktree hints to prepare while iterating and finish clean", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    // An uncommitted tracked change in the `web` scope.
    await writeExecutable(join(wt, "web/x.txt"), "x");
    await git(wt, "add", "web/x.txt");

    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertExists(obj.data.git);
    assertExists(obj.data.scopes);
    assertExists(obj.data.gate_proof);
    assertEquals(obj.data.git.clean, false);
    assert(
      obj.data.scopes.includes("web"),
      `expected 'web' among changed scopes: ${JSON.stringify(obj.data)}`,
    );
    assertHasHint(obj, HINTS["status-dirty-worktree-scoped"], {
      scopes: ["web"],
    });
    assertEquals(obj.data.gate_proof.status, "missing");
  });
});

Deno.test("status: an untracked project file makes local and fleet status dirty", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "scratch");
    await writeExecutable(join(wt, "tests/engine_hint_rules_test.ts"), "x");

    const local = await runAgent(wt, ["status", "--json"]);
    assertEquals(local.code, 0, local.output);
    const localObj = parseStatus(local.stdout);
    assertExists(localObj.data.git);
    assertEquals(localObj.data.git.clean, false);
    assertEquals(localObj.data.git.changed_files, 1);

    const fleet = await runAgent(dir, ["status", "--json"]);
    assertEquals(fleet.code, 0, fleet.output);
    const fleetObj = parseStatus(fleet.stdout);
    assertExists(fleetObj.data.fleet);
    const row = fleetObj.data.fleet.find((e: { branch: string }) =>
      e.branch === "agent/scratch"
    );
    assert(row, `expected agent/scratch in fleet: ${fleet.stdout}`);
    assertExists(row.gate_proof);
    assertEquals(row.clean, false);
    assertEquals(row.changed_files, 1);

    const human = await runAgent(dir, ["status", "--verbose"]);
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(human.output, "agent/scratch");
    assertTerminalTextIncludes(human.output, "1 file changed");
    assertEquals(row.gate_proof.status, "missing");
  });
});

Deno.test("status: ignored local scratch does not make a worktree read dirty", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "scratch");
    await Deno.mkdir(join(wt, ".claude"), { recursive: true });
    await Deno.writeTextFile(
      join(wt, ".claude/settings.local.json"),
      '{ "permissions": { "allow": ["local"] } }\n',
    );

    const local = await runAgent(wt, ["status", "--json"]);
    assertEquals(local.code, 0, local.output);
    const localObj = parseStatus(local.stdout);
    assertExists(localObj.data.git);
    assertEquals(localObj.data.git.clean, true);
    assertEquals(localObj.data.git.changed_files, 0);

    const fleet = await runAgent(dir, ["status", "--json"]);
    assertEquals(fleet.code, 0, fleet.output);
    const fleetObj = parseStatus(fleet.stdout);
    assertExists(fleetObj.data.fleet);
    const row = fleetObj.data.fleet.find((e: { branch: string }) =>
      e.branch === "agent/scratch"
    );
    assert(row, `expected agent/scratch in fleet: ${fleet.stdout}`);
    assertEquals(row.clean, true);
    assertEquals(row.changed_files, 0);
  });
});

Deno.test("status: a clean worktree ahead of main without a proof asks for final finish", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    // A committed change: clean working tree, one commit ahead of main, contains main.
    await writeExecutable(join(wt, "web/feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");

    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertExists(obj.data.git);
    assertExists(obj.data.gate_proof);
    assertEquals(obj.data.git.clean, true);
    assertEquals(obj.data.git.ahead_trunk, 1);
    assertEquals(obj.data.git.behind_trunk, 0);
    assertEquals(obj.data.gate_proof.status, "missing");
    assertHasHint(obj, HINTS["status-missing-done-proof"], {
      trunk: "main",
    });
    assertLacksHint(obj, HINTS["status-ready-for-review"], {
      trunk: "main",
      branch: "agent/alpha",
    });

    const fleet = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assertExists(fleet.data.fleet);
    assertLacksHint(fleet, HINTS["status-fleet-member-ready"], {
      total: 1,
      names: ["alpha"],
      trunk: "main",
    });
    const fleetRow = fleet.data.fleet.find(
      (entry: { branch: string }) => entry.branch === "agent/alpha",
    );
    assertExists(fleetRow);
    assertExists(fleetRow.gate_proof);
    assertEquals(fleetRow.gate_proof.status, "missing");
  });
});

Deno.test("status: a clean worktree ahead of main with a finish proof is ready for owner review", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await writeExecutable(join(wt, "web/feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const finish = await runAgent(wt, ["done", "--json"]);
    assertEquals(finish.code, 0, finish.output);

    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertExists(obj.data.git);
    assertExists(obj.data.gate_proof);
    assertEquals(obj.data.git.clean, true);
    assertEquals(obj.data.git.ahead_trunk, 1);
    assertEquals(obj.data.git.behind_trunk, 0);
    assertEquals(obj.data.gate_proof.status, "honored");
    assertExists(obj.data.gate_proof.proof);
    // The compact result carries Proof facts and the one-line form the
    // review-ready hint tells the agent to end its report with.
    assertStringIncludes(
      obj.data.gate_proof.proof.line,
      "> **Proof:** The Gate passed for `agent/alpha` at ",
    );
    assertHasHint(obj, HINTS["status-ready-for-review"], {
      trunk: "main",
      branch: "agent/alpha",
    });

    // Interactive: the dashboard exposes the proof state in the task row and
    // reserves the stored Markdown page for --verbose.
    const plain = await runAgent(wt, ["status"]);
    assertEquals(plain.code, 0, plain.output);
    assertTerminalTextIncludes(plain.output, "Alpha Proof");
    assertTerminalTextIncludes(plain.output, "Branch: agent/alpha");
    assertStringIncludes(plain.output, "Proof");
    assertStatusFactLine(plain.output, "Proof", "honored");
    assert(
      !plain.output.includes("### Proof"),
      `plain status must not print the page:\n${plain.output}`,
    );
    const verbose = await runAgent(wt, ["status", "--verbose"]);
    assertEquals(verbose.code, 0, verbose.output);
    assertTerminalTextIncludes(verbose.output, "### Proof — `agent/alpha`");

    // From the main checkout, the fleet's review-ready hint names the same
    // inspection command, so the owner can look at the work from where they sit —
    // and the ready row carries the compact Proof claim.
    const fleet = await runAgent(dir, ["status", "--json"]);
    assertEquals(fleet.code, 0, fleet.output);
    const fleetObj = parseStatus(fleet.stdout);
    assertHasHint(
      fleetObj,
      HINTS["status-fleet-member-ready"],
      { total: 1, names: ["alpha"], trunk: "main" },
    );
    assertExists(fleetObj.data.fleet);
    const row = fleetObj.data.fleet.find(
      (e: { branch: string }) => e.branch === "agent/alpha",
    );
    assertExists(row);
    assertExists(row.gate_proof);
    assertExists(row.gate_proof.proof);
    assertEquals(row.gate_proof.status, "honored");
    assertStringIncludes(
      row.gate_proof.proof.line,
      "> **Proof:** The Gate passed for `agent/alpha` at ",
    );

    // The supervisor's pull: --verbose from the main checkout prints the ready
    // row's page beneath the fleet table.
    const fleetVerbose = await runAgent(dir, ["status", "--verbose"]);
    assertEquals(fleetVerbose.code, 0, fleetVerbose.output);
    assertTerminalTextIncludes(
      fleetVerbose.output,
      "### Proof — `agent/alpha`",
    );

    // The additive fleet check preserves a proof that exists but is no longer
    // honored, while the legacy honored-only projection remains compatible.
    await writeExecutable(join(wt, "tests/after-proof.txt"), "dirty");
    const dirtyFleet = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assertExists(dirtyFleet.data.fleet);
    const dirtyRow = dirtyFleet.data.fleet.find(
      (entry: { branch: string }) => entry.branch === "agent/alpha",
    );
    assertExists(dirtyRow);
    assertExists(dirtyRow.gate_proof);
    assertEquals(dirtyRow.gate_proof.status, "dirty");
    assertEquals("proof_honored" in dirtyRow, false);
  });
});

Deno.test("status: a behind worktree with a valid proof is not ready for owner review", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await writeExecutable(join(wt, "web/feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const finish = await runAgent(wt, ["done", "--json"]);
    assertEquals(finish.code, 0, finish.output);

    await writeExecutable(join(dir, "upstream.txt"), "upstream");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "advance main",
      "--no-gpg-sign",
    );

    const local = parseStatus(
      (await runAgent(wt, ["status", "--json"])).stdout,
    );
    assertExists(local.data.gate_proof);
    assertExists(local.data.git);
    assertEquals(local.data.gate_proof.status, "honored");
    const behind = local.data.git.behind_trunk;
    assert(
      typeof behind === "number" && behind > 0,
      JSON.stringify(local.data),
    );
    assertLacksHint(local, HINTS["status-ready-for-review"], {
      trunk: "main",
      branch: "agent/alpha",
    });

    const fleet = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assertExists(fleet.data.fleet);
    assertLacksHint(fleet, HINTS["status-fleet-member-ready"], {
      total: 1,
      names: ["alpha"],
      trunk: "main",
    });
    const fleetRow = fleet.data.fleet.find(
      (entry: { branch: string }) => entry.branch === "agent/alpha",
    );
    assertExists(fleetRow);
    assertExists(fleetRow.gate_proof);
    assertEquals(fleetRow.gate_proof.status, "honored");
  });
});

Deno.test("status: a landed proof carries its commit time for the human age", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await writeExecutable(join(wt, "web/feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const accepted = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);

    const status = await runAgent(dir, ["status", "--verbose", "--json"]);
    assertEquals(status.code, 0, status.output);
    const result = parseStatus(status.stdout);
    const commitAt = result.data.landed_proof?.commit_at;
    assert(
      typeof commitAt === "string" && !Number.isNaN(Date.parse(commitAt)),
      JSON.stringify(result.data.landed_proof),
    );
    assertEquals(result.data.recent_completed_tasks?.length, 1);
    assertEquals(
      result.data.recent_completed_tasks?.[0]?.branch,
      "agent/alpha",
    );
    assertEquals(
      result.data.recent_completed_tasks?.[0]?.proof_line,
      result.data.landed_proof?.proof.line,
    );
    const human = await runAgent(dir, ["status"]);
    assertTerminalTextIncludes(human.output, "Last landing");
    assertStringIncludes(human.output, "[✓]");
    assertTerminalTextIncludes(human.output, "just now");
  });
});

Deno.test("status: an ahead worktree with untracked work is not ready for owner review", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    await writeExecutable(join(wt, "web/feature.txt"), "feature");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feature", "--no-gpg-sign");
    await writeExecutable(join(wt, "tests/unreviewed_test.ts"), "x");

    const r = await runAgent(wt, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertExists(obj.data.git);
    assertEquals(obj.data.git.clean, false);
    assertEquals(obj.data.git.ahead_trunk, 1);
    assertEquals(obj.data.git.behind_trunk, 0);
    assertLacksHint(obj, HINTS["status-ready-for-review"], {
      trunk: "main",
      branch: "agent/alpha",
    });
  });
});

/** Run git in `dir` with the hermetic engine env plus any extra env (e.g. backdated
 * commit dates), throwing on failure. Lets a test forge an old branch point. */
async function rawGit(
  dir: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<void> {
  const c = new Deno.Command("git", {
    args,
    cwd: dir,
    env: await engineEnv(extraEnv),
    stdout: "null",
    stderr: "piped",
  });
  const { success, stderr } = await c.output();
  if (!success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(stderr)}`,
    );
  }
}

Deno.test("status fleet: a freshly spawned worktree reads as recent, not as old as its branch point", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    // A repo whose only commit is years old — so HEAD's commit time is stale.
    const OLD = "2021-06-01T12:00:00";
    await rawGit(dir, ["init", "-q"]);
    await rawGit(dir, ["config", "user.email", "t@example.com"]);
    await rawGit(dir, ["config", "user.name", "Test"]);
    await rawGit(dir, ["config", "commit.gpgsign", "false"]);
    await rawGit(dir, ["add", "-A"]);
    await rawGit(dir, ["commit", "-q", "-m", "old", "--no-gpg-sign"], {
      GIT_AUTHOR_DATE: OLD,
      GIT_COMMITTER_DATE: OLD,
    });
    await rawGit(dir, ["branch", "-M", "main"]);
    // Spawn a worktree NOW — no commits of its own, HEAD is the 2021 branch point.
    await addWorktree(dir, "fresh");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertExists(obj.data.fleet);
    const row = obj.data.fleet.find((e: { is_main: boolean }) => !e.is_main);
    assert(
      row?.last_activity,
      `worktree row should carry last_activity: ${r.stdout}`,
    );
    // Its creation (the reflog), not the 2021 HEAD commit, drives last_activity.
    const ageMs = SYSTEM_CLOCK.wallNow() - Date.parse(row.last_activity);
    assert(
      ageMs < 5 * 60 * 1000,
      `a just-spawned worktree must read as recent, not 2021 — got ${row.last_activity}`,
    );
  });
});

/** A content-hash snapshot of every file under `dir` (excluding the `.git`
 * gitlink/dir), so a byte-level mutation anywhere shows up as an inequality. */
async function snapshotTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const entry of walk(dir, { includeDirs: false })) {
    const rel = relative(dir, entry.path);
    if (rel === ".git" || rel.startsWith(".git/")) {
      continue;
    }
    const bytes = await Deno.readFile(entry.path);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    out[rel] = Array.from(digest).map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return out;
}

Deno.test("status is pure observation: it mutates nothing and provisions no resources", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A resource whose create would touch a sentinel — status must never run it.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[repository]",
        'trunk = "main"',
        "",
        "[worktree.resources.thing]",
        `create = "touch CREATED_SENTINEL"`,
        `destroy = "rm -f CREATED_SENTINEL"`,
        "",
      ].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    // Dirty the worktree, so status has real state to observe.
    await writeExecutable(join(wt, "scratch.txt"), "dirty");

    const before = await snapshotTree(wt);
    // Run both renderings; neither may touch the tree.
    assertEquals((await runAgent(wt, ["status"])).code, 0);
    assertEquals((await runAgent(wt, ["status", "--all", "--json"])).code, 0);
    const after = await snapshotTree(wt);

    assertEquals(
      after,
      before,
      "status must leave the worktree byte-for-byte unchanged",
    );
    // The resource create command must NOT have run (status reads .env, never creates).
    let sentinelExists = true;
    try {
      await Deno.stat(join(wt, "CREATED_SENTINEL"));
    } catch {
      sentinelExists = false;
    }
    assertEquals(
      sentinelExists,
      false,
      "status must not create (or destroy) any resource",
    );
  });
});

Deno.test("status: a drifted agent file is listed and hinted to refresh", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]); // compile CLAUDE.md so it exists and is current

    // Hand-edit the generated file → it no longer matches what `refresh` would write.
    const claudePath = join(dir, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(claudePath)}\n<!-- a stray hand edit -->\n`,
    );

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assert(
      (obj.data.stale_generated ?? []).includes("CLAUDE.md"),
      `expected CLAUDE.md in stale_generated: ${r.stdout}`,
    );
    assertHasHint(obj, HINTS["generated-agent-files-stale"], {
      paths: "CLAUDE.md",
    });
    // status is read-only — it must NOT silently regenerate the drifted file.
    assert(
      (await Deno.readTextFile(claudePath)).includes("a stray hand edit"),
      "status must not rewrite the generated file",
    );
  });
});

Deno.test("status: a missing agent file hints it isn't built yet", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    // A compiled file can go absent (deleted, or untracked and freshly cloned).
    await Deno.remove(join(dir, "CLAUDE.md"));

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assert((obj.data.stale_generated ?? []).includes("CLAUDE.md"), r.stdout);
    assertHasHint(obj, HINTS["generated-agent-files-missing"], {
      paths: "CLAUDE.md",
    });
  });
});

Deno.test("status: tracked discern-managed ignored artifacts are listed with an index repair hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    // The compiled instruction files are tracked by default — adding them is the
    // intended state, never flagged. Machine-local state forced in IS flagged.
    await git(dir, "add", "AGENTS.md", "CLAUDE.md");
    await Deno.writeTextFile(
      join(dir, ".claude", "settings.local.json"),
      "{}\n",
    );
    await git(dir, "add", "-f", ".claude/settings.local.json");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(
      [...(obj.data.tracked_ignored_artifacts ?? [])].sort(),
      [".claude/settings.local.json"],
    );
    assertHasHint(obj, HINTS["tracked-ignored-artifacts"], {
      pathSummary: ".claude/settings.local.json",
      repairCommand: "git rm -r --cached -- .claude/settings.local.json",
    });
  });
});

Deno.test("status: untracked compiled instruction files draw a commit hint that clears once committed or ignored", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);

    // Freshly compiled, not yet committed: recommend the one-time commit that
    // makes the instructions readable from a bare clone.
    let r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertHasHint(parseStatus(r.stdout), HINTS["untracked-agent-files"], {
      paths: ["AGENTS.md", "CLAUDE.md"],
    });

    // Committed → the hint clears.
    await git(dir, "add", "AGENTS.md", "CLAUDE.md");
    r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertLacksHint(parseStatus(r.stdout), HINTS["untracked-agent-files"], {
      paths: ["AGENTS.md", "CLAUDE.md"],
    });

    // A project that deliberately ignores a compiled file in its OWN rules is
    // respected: ignored ⇒ excluded from the hint, never nagged.
    await git(dir, "rm", "--cached", "-q", "AGENTS.md", "CLAUDE.md");
    const gitignore = await Deno.readTextFile(join(dir, ".gitignore"));
    await Deno.writeTextFile(
      join(dir, ".gitignore"),
      `${gitignore}\n/AGENTS.md\n/CLAUDE.md\n`,
    );
    r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    assertLacksHint(parseStatus(r.stdout), HINTS["untracked-agent-files"], {
      paths: ["AGENTS.md", "CLAUDE.md"],
    });
  });
});

Deno.test("status: missing provider hook integrations are listed and hinted to refresh", async () => {
  await withTempDir(async (dir) => {
    const hookProviders = providersWithHooks();
    await scaffoldEngine(dir, {
      agents: hookProviders.map((p) => p.name as AgentName),
    });
    await gitInit(dir);
    const hookPaths = [
      ...new Set(
        hookProviders.flatMap((p) =>
          p.hooks === undefined ? [] : [p.hooks.settingsFile]
        ),
      ),
    ];
    const hookFiles = [...hookPaths].sort();
    for (const file of hookFiles) {
      await Deno.remove(join(dir, file));
    }

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals([...(obj.data.stale_integrations ?? [])].sort(), hookFiles);
    assertHasHint(obj, HINTS["provider-integrations-missing"], {
      paths: hookPaths.join(", "),
    });

    for (const file of hookFiles) {
      await assertRejects(
        () => Deno.stat(join(dir, file)),
        Deno.errors.NotFound,
      );
    }
  });
});

Deno.test("status: when behind, incoming_overlap names the files you AND main both changed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A baseline file present at the fork point, so both sides edit different regions
    // (a real intersection, not a both-added conflict).
    const base = Array.from({ length: 12 }, (_, i) =>
      `line ${i + 1}`).join("\n") +
      "\n";
    await Deno.writeTextFile(join(dir, "shared.txt"), base);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");

    // The worktree changes the TOP of shared.txt (its own work).
    await Deno.writeTextFile(
      join(wt, "shared.txt"),
      base.replace("line 1\n", "line 1 — wt\n"),
    );
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "wt edits shared", "--no-gpg-sign");

    // main changes the BOTTOM of shared.txt and adds an unrelated file → wt is behind.
    await Deno.writeTextFile(
      join(dir, "shared.txt"),
      base.replace("line 12\n", "line 12 — main\n"),
    );
    await Deno.writeTextFile(join(dir, "upstream.txt"), "u\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "main edits shared", "--no-gpg-sign");

    const obj = parseStatus((await runAgent(wt, ["status", "--json"])).stdout);
    assertExists(obj.data.git);
    const behind = obj.data.git.behind_trunk;
    assert(
      typeof behind === "number" && behind >= 1,
      JSON.stringify(obj.data.git),
    );
    // The hot zone is shared.txt; upstream.txt is incoming but not yours, so excluded.
    assertEquals(obj.data.git.incoming_overlap, ["shared.txt"]);
    assertHasHint(obj, HINTS["status-branch-behind"], {
      behind,
      trunk: "main",
      overlap: { total: 1, paths: ["shared.txt"] },
    });
  });
});

Deno.test("status: incoming_overlap is absent when behind but none of your files overlap", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "alpha");
    // The worktree changes its OWN file; main changes a DIFFERENT one → behind, no overlap.
    await Deno.writeTextFile(join(wt, "mine.txt"), "mine\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "wt work", "--no-gpg-sign");
    await Deno.writeTextFile(join(dir, "theirs.txt"), "theirs\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "main work", "--no-gpg-sign");

    const obj = parseStatus((await runAgent(wt, ["status", "--json"])).stdout);
    assertExists(obj.data.git);
    const behind = obj.data.git.behind_trunk;
    assert(
      typeof behind === "number" && behind >= 1,
      JSON.stringify(obj.data.git),
    );
    // Behind, but the field is honestly absent (no intersection) — not an empty array.
    assertEquals(obj.data.git.incoming_overlap, undefined);
  });
});

Deno.test("status warns when the configured trunk is missing locally", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, SCOPE_CONFIG);
    await gitInit(dir);
    await git(dir, "branch", "-m", "trunk");
    const wt = await addWorktree(dir, "missing-main");

    const json = await runAgent(wt, ["status", "--json"]);
    assertEquals(json.code, 0, json.output);
    const obj = parseStatus(json.stdout);
    assertExists(obj.data.git);
    assertEquals(obj.data.git.behind_trunk, null);
    const expected = assertHasHint(
      obj,
      HINTS["missing-trunk-branch"],
      { branch: "main" },
    );

    const human = await runAgent(wt, ["status"]);
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(
      human.output.replaceAll(/\s+/gu, " "),
      expected.replaceAll(/\s+/gu, " "),
    );
  });
});
