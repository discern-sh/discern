/**
 * The Desk sandbox seeds the redesign brief's fleet from real repository and
 * engine state, and every fixture knob it relies on produces the status fact it
 * names.
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  briefFleet,
  parseDeskSandboxArgs,
  prepareSandboxDirectory,
  SANDBOX_MARKER,
} from "../scripts/desk_sandbox.ts";
import {
  createDeskTtyProject,
  deskCollision,
  deskFleetEntry,
  deskFleetFixture,
  deskOrphanBranch,
  deskProof,
} from "./fixtures/desk_tty_harness.ts";
import { runAgent } from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";
import { fileExists } from "../src/shared/fs_presence.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import {
  fleetRowProof,
  proofFinishedAt,
} from "../src/engine/status/row_facts.ts";
import { statusResult } from "../src/engine/status/status.ts";

const DAY = 86_400_000;

Deno.test("the brief fleet declares one task per Desk state and three parked branches", () => {
  const fleet = briefFleet();
  const entry = (stem: string) => {
    const found = fleet.entries.find((candidate) =>
      candidate.name.startsWith(`${stem}-`)
    );
    assert(found !== undefined, `the brief fleet lost ${stem}`);
    return found;
  };
  assertEquals(entry("manual-concision").aheadCommits, 4);
  assert(entry("manual-concision").proof !== undefined);
  assertEquals(entry("homepage-session-prototype").behindCommits, 361);
  assertEquals(entry("homepage-session-prototype").idleMs, 11 * DAY);
  assertEquals(entry("fix-flaky-upload").action?.kind, "running");
  assertEquals(entry("auth-refactor").action?.kind, "failed");
  assertEquals(entry("docs-glossary").dirtyFiles.length, 5);
  assertEquals(entry("release-notes").setup, "incomplete");
  assertEquals(entry("search-index").queued, true);
  assertEquals(
    entry("search-index").landingAuthority.kind,
    "effort-grant",
  );
  assertEquals(entry("tidy-scripts").aheadCommits, 0);
  assertEquals(entry("tidy-scripts").idleMs, 2 * DAY);
  assertEquals(fleet.collisions, [{
    path: "src/auth/session.ts",
    entries: [entry("auth-refactor").name, entry("docs-glossary").name],
  }]);
  assertEquals(
    fleet.orphanBranches.map((orphan) => [orphan.name, orphan.parked]),
    [
      ["parked-ideas-c9d0e1", true],
      ["old-experiment-d0e1f2", true],
      ["spike-cache-e1f2a3", true],
    ],
  );
});

Deno.test("sandbox arguments name one directory and an optional rebuild", () => {
  assertEquals(parseDeskSandboxArgs(["--", "sandbox"]), {
    directory: resolve("sandbox"),
    replace: false,
  });
  assertEquals(parseDeskSandboxArgs(["/tmp/box", "--replace"]), {
    directory: "/tmp/box",
    replace: true,
  });
  assertThrows(() => parseDeskSandboxArgs([]), TypeError, "name the directory");
  assertThrows(
    () => parseDeskSandboxArgs(["a", "b"]),
    TypeError,
    "at most one",
  );
  assertThrows(() => parseDeskSandboxArgs(["--force"]), TypeError, "unknown");
});

Deno.test("the sandbox replaces only a directory it marked as its own", async () => {
  const cases = [
    { marked: false, replace: true, refusal: "is not a Desk sandbox" },
    { marked: true, replace: false, refusal: "--replace" },
    { marked: true, replace: true, refusal: undefined },
  ] as const;
  for (const { marked, replace, refusal } of cases) {
    await withTempDir(async (parent) => {
      const directory = join(parent, "box");
      await prepareSandboxDirectory({ directory, replace });
      await Deno.mkdir(directory);
      const kept = join(directory, "notes.txt");
      await Deno.writeTextFile(kept, "keep me\n");
      if (marked) await Deno.writeTextFile(join(directory, SANDBOX_MARKER), "");
      const prepared = prepareSandboxDirectory({ directory, replace });
      if (refusal !== undefined) {
        await assertRejects(() => prepared, Error, refusal);
      } else {
        await prepared;
      }
      assertEquals(await fileExists(kept), refusal !== undefined);
    });
  }
});

Deno.test("fixture knobs produce real behind, idle, queue, park, and overlap state", async () => {
  await withTempDir(async (parent) => {
    const nowMs = SYSTEM_CLOCK.wallNow();
    const project = await createDeskTtyProject(
      parent,
      deskFleetFixture([
        deskFleetEntry("stale-a1b2c3", {
          aheadCommits: 1,
          behindCommits: 2,
          idleMs: 3 * DAY,
          proof: deskProof(),
        }),
        deskFleetEntry("queued-b2c3d4", {
          aheadCommits: 1,
          proof: deskProof(),
          queued: true,
        }),
        deskFleetEntry("current-c3d4e5", { aheadCommits: 2 }),
      ], {
        collisions: [
          deskCollision("shared.ts", ["stale-a1b2c3", "current-c3d4e5"]),
        ],
        orphanBranches: [
          deskOrphanBranch("parked-d4e5f6", { parked: true }),
          deskOrphanBranch("plain-e5f6a7"),
        ],
      }),
    );
    const run = await runAgent(project.root, ["status", "--json", "--verbose"]);
    assertEquals(run.code, 0, run.output);
    const result = decodeCliResult(run.stdout, "status");
    assertResultDataKey(result, "location");
    const status = result.data;
    const row = (branch: string) => {
      const found = status.fleet?.find((entry) => entry.branch === branch);
      assert(found !== undefined, `status lost ${branch}`);
      return found;
    };
    const stale = row("agent/stale-a1b2c3");
    assertEquals(stale.behind, 2);
    assertEquals(row("agent/queued-b2c3d4").behind, 0);
    assertEquals(row("agent/current-c3d4e5").behind, 0);
    assertEquals(stale.gate_proof?.status, "honored");
    const idle = nowMs - Date.parse(stale.last_activity ?? "");
    assert(
      idle >= 3 * DAY - 60_000 && idle <= 3 * DAY + 60_000,
      `last activity ${stale.last_activity}`,
    );
    // Every fixture Proof finished on the fixture's clock: when its task last
    // moved, or now for one the real gate proved. Only the in-process survey
    // carries the Proof's completion record.
    const survey = await statusResult(project.root, { all: true });
    assert(survey.ok, survey.message);
    for (
      const [branch, ago] of [["agent/stale-a1b2c3", 3 * DAY], [
        "agent/queued-b2c3d4",
        0,
      ]] as const
    ) {
      const entry = survey.data?.fleet?.find((found) =>
        found.branch === branch
      );
      assert(entry !== undefined, `the survey lost ${branch}`);
      const finished = proofFinishedAt(fleetRowProof(entry));
      assert(finished !== undefined, `${branch} Proof has no finish time`);
      const age = nowMs - Date.parse(finished);
      assert(
        age >= ago - 10 * 60_000 && age <= ago + 10 * 60_000,
        `${branch} Proof finished ${finished}`,
      );
    }
    assertEquals(
      status.queue?.map((queued) => [queued.branch, queued.position]),
      [["agent/queued-b2c3d4", 1]],
    );
    assertEquals(
      status.parked_tasks?.map((parked) => parked.branch),
      ["agent/parked-d4e5f6"],
    );
    assert(status.unlanded_branches?.includes("agent/plain-e5f6a7"));
    assertEquals(
      status.fleet_collisions?.map((collision) => collision.branches),
      [["agent/current-c3d4e5", "agent/stale-a1b2c3"]],
    );
  });
});
