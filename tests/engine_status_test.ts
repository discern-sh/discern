/**
 * Engine coverage for `discern status` — the read-only situation/orientation verb
 * (ADR 0033). Drives the real verb via `deno task dev status` in scaffolded temp
 * repos and asserts on the `--json` DiscernResult envelope. Covers the
 * location-aware default (fleet-led from the main checkout, local from a worktree),
 * the `--all`/`--local` overrides, the not-initialized degradation, the advisory
 * hints, and — load-bearing — that `status` never mutates anything (pure
 * observation).
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  engineEnv,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { fire, HINTS } from "../src/shared/hints.ts";
import { KNOWN_JOBS, type KnownJob } from "../src/shared/capabilities.ts";
import { providersWithHooks } from "../src/lib/providers.ts";
import type { AgentName } from "../src/lib/config.ts";

const FLEET_OWNERSHIP_HINT = fire(HINTS["fleet-ownership"]).text;
const START_HERE_HINT = fire(HINTS["status-start-on-trunk"]).text;

function offTrunkStartHereHint(branch: string, trunk: string): string {
  return fire(HINTS["status-start-off-trunk"], { branch, trunk }).text;
}

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
// deno-lint-ignore no-explicit-any
function parseStatus(stdout: string): any {
  const obj = JSON.parse(stdout.trim());
  assertEquals(obj.verb, "status");
  return obj;
}

Deno.test("status: from the main checkout, the default leads with the fleet (and a main row)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals(obj.data.location, "main");
    assertEquals(obj.data.worktree, null);
    assert(Array.isArray(obj.data.fleet), `expected a fleet: ${r.stdout}`);
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
    // Every row carries a recent last_activity (an ISO timestamp).
    for (const e of obj.data.fleet) {
      assert(
        typeof e.last_activity === "string",
        `fleet row should carry last_activity: ${JSON.stringify(e)}`,
      );
      const ageMs = Date.now() - Date.parse(e.last_activity);
      assert(
        ageMs >= 0 && ageMs < 5 * 60 * 1000,
        `last_activity should be recent, got ${e.last_activity}`,
      );
    }
    // Leading with the fleet omits the heavy local-only blocks.
    assertEquals(obj.data.gate, undefined);
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
    assert(
      (obj.hints ?? []).includes(FLEET_OWNERSHIP_HINT),
      `hints must carry the fleet ownership rule: ${JSON.stringify(obj.hints)}`,
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
    assert(
      (obj.hints ?? []).includes(FLEET_OWNERSHIP_HINT),
      `--all hints must carry the ownership rule: ${JSON.stringify(obj.hints)}`,
    );
  });
});

Deno.test("status: on the trunk, the discern start guardrail rides in hints[] for an agent", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // No worktrees yet — the agent is on the trunk with nowhere isolated to work.
    const obj = parseStatus((await runAgent(dir, ["status", "--json"])).stdout);
    assertEquals(obj.data.location, "main");
    assert(
      (obj.hints ?? []).includes(START_HERE_HINT),
      `the trunk guardrail must point at discern start: ${
        JSON.stringify(obj.hints)
      }`,
    );
    // It leads the next-steps relative to the fleet-ownership caveat (constructive
    // action before the don't-squat warning), when both are present.
    const start = (obj.hints ?? []).indexOf(START_HERE_HINT);
    const own = (obj.hints ?? []).indexOf(FLEET_OWNERSHIP_HINT);
    if (own >= 0) {
      assert(
        start < own,
        `discern start hint should precede the ownership rule`,
      );
    }
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
    assertEquals(obj.data.git.branch, "discern-setup");
    const hints: string[] = obj.hints ?? [];
    assert(
      !hints.includes(START_HERE_HINT),
      `must never claim "you're on the trunk" while on a non-trunk branch: ${
        JSON.stringify(hints)
      }`,
    );
    assert(
      hints.includes(offTrunkStartHereHint("discern-setup", "main")),
      `expected the off-trunk variant naming the actual branch and trunk: ${
        JSON.stringify(hints)
      }`,
    );

    // Still agent-only — a human running the CLI here isn't nagged with either
    // wording (exactly like the on-trunk guardrail).
    const human = await runAgent(dir, ["status"]);
    assertEquals(human.code, 0, human.output);
    assert(
      !human.output.includes("isolated worktree"),
      `neither start-here variant should appear as a human line: ${human.output}`,
    );
  });
});

Deno.test("status: the discern start guardrail is agent-only — the human CLI is not nagged", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    const r = await runAgent(dir, ["status"]); // human mode (no --json)
    assertEquals(r.code, 0, r.output);
    assert(
      !r.output.includes(START_HERE_HINT),
      `the start guardrail must not appear as a human line: ${r.output}`,
    );
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
    assert(
      !(obj.hints ?? []).includes(START_HERE_HINT),
      `an agent already in a worktree must not be told to start one: ${
        JSON.stringify(obj.hints)
      }`,
    );
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
    const hints: string[] = obj.hints ?? [];
    assert(
      !hints.includes(START_HERE_HINT),
      `the discern start guardrail must not fire mid-setup: ${
        JSON.stringify(hints)
      }`,
    );
    assert(
      !hints.some((h) => h.includes("No active worktrees")),
      `the "start a worktree" nudge must not fire mid-setup: ${
        JSON.stringify(hints)
      }`,
    );
  });
});

Deno.test("status fleet: the ownership rule is agent-only — humans get the caption, not the hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await addWorktree(dir, "alpha");

    const r = await runAgent(dir, ["status"]); // human mode (no --json)
    assertEquals(r.code, 0, r.output);
    // The agent-channel hint text never appears in interactive output…
    assert(
      !r.output.includes(FLEET_OWNERSHIP_HINT),
      `the ownership hint must not appear as a human line: ${r.output}`,
    );
    // …but the dim caption beneath the fleet table does.
    assert(
      r.output.includes("Other worktrees are separate lines of work"),
      `expected the fleet caption in human output: ${r.output}`,
    );
  });
});

Deno.test("status fleet (human): a long worktree id and branch are shown in full, never truncated", async () => {
  // The WORKTREE and BRANCH cells are identifiers a human copies verbatim into
  // `discern worktree drop <id>` / a `git …<branch>` command. A fixed-width column
  // that clipped them left the reader unable to type the very name the row points
  // at — the dead end that motivated content-sized columns. Names longer than the
  // former 19-char (worktree) / 23-char (branch) caps guard that regression.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const id = "drop-this-stale-worktree-please"; // 31 chars > the old 19 cap
    await addWorktree(dir, id);
    const branch = `agent/${id}`; // 37 chars > the old 23 cap

    const r = await runAgent(dir, ["status"]); // human mode (no --json)
    assertEquals(r.code, 0, r.output);
    // The full id must appear verbatim — that string IS the `discern worktree drop`
    // target, so a reader can select it straight from the table.
    assertStringIncludes(r.output, id);
    // The full branch must survive too — it feeds the `git diff`/`git branch -D` hints.
    assertStringIncludes(r.output, branch);
    // And no clipped remnant of either (the tell of a reintroduced fixed-width cap).
    assert(
      !r.output.includes("…"),
      `no column should truncate an identifier: ${r.output}`,
    );
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
    assertEquals(obj.data.git.branch, "agent/alpha");
    assert(obj.data.gate);
    assert(Array.isArray(obj.data.scopes));

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
    assertEquals(clean.data.gate.jobs, [...wiredKnownJobs, "custom"]);
    assertEquals(clean.data.gate.scope_gates, []);

    await writeExecutable(join(wt, "web/feature.txt"), "feature");
    const web = parseStatus((await runAgent(wt, ["status", "--json"])).stdout);
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
    const obj = JSON.parse(r.stdout.trim());
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "status");
    assertEquals(obj.error, "conflicting_flags");

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
    const obj = JSON.parse(r.stdout.trim());
    assertEquals(obj.ok, false);
    assertEquals(obj.verb, "status");
    assertEquals(obj.error, "not_initialized");
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
    assertEquals(obj.data.git.clean, false);
    assert(
      obj.data.scopes.includes("web"),
      `expected 'web' among changed scopes: ${JSON.stringify(obj.data)}`,
    );
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("discern prepare") && h.includes("clean HEAD")
      ),
      `expected a prepare-then-clean-finish hint: ${JSON.stringify(obj.hints)}`,
    );
    assertEquals(obj.data.gate_receipt.status, "missing");
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
    assertEquals(localObj.data.git.clean, false);
    assertEquals(localObj.data.git.changed_files, 1);

    const fleet = await runAgent(dir, ["status", "--json"]);
    assertEquals(fleet.code, 0, fleet.output);
    const fleetObj = parseStatus(fleet.stdout);
    const row = fleetObj.data.fleet.find((e: { branch: string }) =>
      e.branch === "agent/scratch"
    );
    assert(row, `expected agent/scratch in fleet: ${fleet.stdout}`);
    assertEquals(row.clean, false);
    assertEquals(row.changed_files, 1);

    const human = await runAgent(dir, ["status"]);
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(human.output, "agent/scratch");
    assertStringIncludes(human.output, "1 changed");
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
    assertEquals(localObj.data.git.clean, true);
    assertEquals(localObj.data.git.changed_files, 0);

    const fleet = await runAgent(dir, ["status", "--json"]);
    assertEquals(fleet.code, 0, fleet.output);
    const fleetObj = parseStatus(fleet.stdout);
    const row = fleetObj.data.fleet.find((e: { branch: string }) =>
      e.branch === "agent/scratch"
    );
    assert(row, `expected agent/scratch in fleet: ${fleet.stdout}`);
    assertEquals(row.clean, true);
    assertEquals(row.changed_files, 0);
  });
});

Deno.test("status: a clean worktree ahead of main without a receipt asks for final finish", async () => {
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
    assertEquals(obj.data.git.clean, true);
    assertEquals(obj.data.git.ahead_integration, 1);
    assertEquals(obj.data.git.behind_integration, 0);
    assertEquals(obj.data.gate_receipt.status, "missing");
    const hints = obj.hints ?? [];
    assert(
      hints.some((h: string) =>
        h.includes("no honored receipt from `discern done`") &&
        h.includes("before reporting the branch ready for review")
      ),
      `expected a final-finish hint: ${JSON.stringify(hints)}`,
    );
    assert(
      !hints.some((h: string) => h.includes("ready for owner review")),
      `missing receipt must not get a ready-for-review hint: ${
        JSON.stringify(hints)
      }`,
    );

    const fleet = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assert(
      !(fleet.hints ?? []).some((hint: string) =>
        hint.includes("ready for owner review") && hint.includes("agent/alpha")
      ),
      `fleet status must require the same receipt: ${
        JSON.stringify(fleet.hints)
      }`,
    );
  });
});

Deno.test("status: a clean worktree ahead of main with a finish receipt is ready for owner review", async () => {
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
    assertEquals(obj.data.git.clean, true);
    assertEquals(obj.data.git.ahead_integration, 1);
    assertEquals(obj.data.git.behind_integration, 0);
    assertEquals(obj.data.gate_receipt.status, "honored");
    // The honored record carries the stored receipt markdown — the artifact the
    // review-ready hint tells the agent to relay.
    assertStringIncludes(obj.data.gate_receipt.receipt, "### Receipt");
    const hints = obj.hints ?? [];
    assert(
      hints.some((h: string) => h.includes("ready for owner review")),
      `expected a ready-for-review hint: ${JSON.stringify(hints)}`,
    );
    // The review moment's concrete affordances: relay the receipt, and the exact
    // inspection command for a human who wants the raw diff.
    assert(
      hints.some((h: string) =>
        h.includes("relay the receipt") &&
        h.includes("git diff main...agent/alpha")
      ),
      `expected the relay + inspect affordances: ${JSON.stringify(hints)}`,
    );
    assert(
      hints.some((h: string) => h.includes("explicitly asks you to land")),
      `expected explicit-user-acceptance boundary: ${JSON.stringify(hints)}`,
    );
    assert(
      !hints.some((h: string) => h.includes("when ready")),
      `status must not imply acceptance follows from readiness: ${
        JSON.stringify(hints)
      }`,
    );

    // From the main checkout, the fleet's review-ready hint names the same
    // inspection command, so the owner can look at the work from where they sit.
    const fleet = await runAgent(dir, ["status", "--json"]);
    assertEquals(fleet.code, 0, fleet.output);
    const fleetHints = parseStatus(fleet.stdout).hints ?? [];
    assert(
      fleetHints.some((h: string) =>
        h.includes("ready for owner review") &&
        h.includes("git diff main...agent/alpha")
      ),
      `expected the fleet review-ready hint with the inspect command: ${
        JSON.stringify(fleetHints)
      }`,
    );
  });
});

Deno.test("status: a behind worktree with an honored receipt is not ready for owner review", async () => {
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
    assertEquals(local.data.gate_receipt.status, "honored");
    assert(local.data.git.behind_integration > 0, JSON.stringify(local.data));
    assert(
      !(local.hints ?? []).some((hint: string) =>
        hint.includes("ready for owner review")
      ),
      `behind local status must not claim readiness: ${
        JSON.stringify(local.hints)
      }`,
    );

    const fleet = parseStatus(
      (await runAgent(dir, ["status", "--json"])).stdout,
    );
    assert(
      !(fleet.hints ?? []).some((hint: string) =>
        hint.includes("ready for owner review") && hint.includes("agent/alpha")
      ),
      `behind fleet status must not claim readiness: ${
        JSON.stringify(fleet.hints)
      }`,
    );
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
    assertEquals(obj.data.git.clean, false);
    assertEquals(obj.data.git.ahead_integration, 1);
    assertEquals(obj.data.git.behind_integration, 0);
    assert(
      !(obj.hints ?? []).some((h: string) => h.includes("accept")),
      `dirty worktree must not get an accept hint: ${
        JSON.stringify(obj.hints)
      }`,
    );
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
    const row = obj.data.fleet.find((e: { is_main: boolean }) => !e.is_main);
    assert(
      row?.last_activity,
      `worktree row should carry last_activity: ${r.stdout}`,
    );
    // Its creation (the reflog), not the 2021 HEAD commit, drives last_activity.
    const ageMs = Date.now() - Date.parse(row.last_activity);
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
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("out of date") && h.includes("discern refresh")
      ),
      `expected an out-of-date refresh hint: ${JSON.stringify(obj.hints)}`,
    );
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
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("aren't built yet") && h.includes("discern refresh")
      ),
      `expected a not-built-yet hint: ${JSON.stringify(obj.hints)}`,
    );
  });
});

Deno.test("status: tracked discern-managed ignored artifacts are listed with an index repair hint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);
    // The compiled guidance files are tracked by default — adding them is the
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
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("Discern-managed ignored artifacts are tracked by Git") &&
        h.includes("git rm -r --cached -- .claude/settings.local.json") &&
        h.includes("discern refresh")
      ),
      `expected a tracked-artifacts repair hint: ${JSON.stringify(obj.hints)}`,
    );
  });
});

Deno.test("status: untracked compiled guidance files draw a commit hint that clears once committed or ignored", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
    await gitInit(dir);
    await runAgent(dir, ["refresh"]);

    // Freshly compiled, not yet committed: recommend the one-time commit that
    // makes the guidance readable from a bare clone.
    let r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    assert(
      (parseStatus(r.stdout).hints ?? []).some((h: string) =>
        h.includes("agent files are untracked") &&
        h.includes("commit them")
      ),
      `expected an untracked-guidance commit hint: ${r.stdout}`,
    );

    // Committed → the hint clears.
    await git(dir, "add", "AGENTS.md", "CLAUDE.md");
    r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    assert(
      !(parseStatus(r.stdout).hints ?? []).some((h: string) =>
        h.includes("agent files are untracked")
      ),
      `hint must clear once the files are tracked: ${r.stdout}`,
    );

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
    assert(
      !(parseStatus(r.stdout).hints ?? []).some((h: string) =>
        h.includes("agent files are untracked")
      ),
      `a deliberate per-project ignore must silence the hint: ${r.stdout}`,
    );
  });
});

Deno.test("status: missing provider hook integrations are listed and hinted to refresh", async () => {
  await withTempDir(async (dir) => {
    const hookProviders = providersWithHooks();
    await scaffoldEngine(dir, {
      agents: hookProviders.map((p) => p.name as AgentName),
    });
    await gitInit(dir);
    const hookFiles = [
      ...new Set(
        hookProviders.flatMap((p) =>
          p.hooks === undefined ? [] : [p.hooks.settingsFile]
        ),
      ),
    ].sort();
    for (const file of hookFiles) {
      await Deno.remove(join(dir, file));
    }

    const r = await runAgent(dir, ["status", "--json"]);
    assertEquals(r.code, 0, r.output);
    const obj = parseStatus(r.stdout);
    assertEquals([...(obj.data.stale_integrations ?? [])].sort(), hookFiles);
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("Provider integration files are missing") &&
        h.includes("discern refresh")
      ),
      `expected a provider integration refresh hint: ${
        JSON.stringify(obj.hints)
      }`,
    );

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
    assert(obj.data.git.behind_integration >= 1, JSON.stringify(obj.data.git));
    // The hot zone is shared.txt; upstream.txt is incoming but not yours, so excluded.
    assertEquals(obj.data.git.incoming_overlap, ["shared.txt"]);
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("also changed upstream") && h.includes("shared.txt")
      ),
      `expected the behind hint to carry the overlap: ${
        JSON.stringify(obj.hints)
      }`,
    );
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
    assert(obj.data.git.behind_integration >= 1, JSON.stringify(obj.data.git));
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
    assertEquals(obj.data.git.behind_integration, null);
    assert(
      (obj.hints ?? []).some((h: string) =>
        h.includes("trunk branch 'main' is not available locally") &&
        h.includes("[repository].trunk")
      ),
      `expected missing-main warning in hints\n${json.stdout}`,
    );

    const human = await runAgent(wt, ["status"]);
    assertEquals(human.code, 0, human.output);
    assertStringIncludes(
      human.output,
      "trunk branch 'main' is not available locally",
    );
    assertStringIncludes(human.output, "[repository].trunk");
  });
});
