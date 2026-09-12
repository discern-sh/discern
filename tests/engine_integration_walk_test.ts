/**
 * The serial landing walk: an explicitly selected submission lands first,
 * the remaining submissions follow the queue's one canonical order under
 * their own recorded grants — each after the first composed and checked, with
 * producer executions counted — and the walk stops at the first refusal,
 * reporting every attempted landing individually while the call's own truth
 * follows the completion policy.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { submissionRows } from "../src/engine/worktree/submissions_view.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";

const CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[project]",
  'slug = "walk-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = "sh count-producer.sh"',
  "",
].join("\n");

/** Scaffold a refresh-converged repository whose one gate job counts its own
 * executions into a shared file, so composed re-checks are observable. */
async function walkFixture(dir: string, counter: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG);
  await Deno.writeTextFile(
    join(dir, "count-producer.sh"),
    `printf x >> "${counter}"\n`,
  );
  await gitInit(dir);
  assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
  await git(dir, "add", "-A");
  if ((await gitOut(dir, "status", "--porcelain")) !== "") {
    await git(dir, "commit", "-q", "-m", "converge artifacts", "--no-gpg-sign");
  }
}

/** One committed effort worktree. */
async function effortWithWork(
  dir: string,
  name: string,
): Promise<string> {
  const wt = await addWorktree(dir, name);
  await Deno.writeTextFile(join(wt, `${name}.txt`), `${name} work\n`);
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", `feat: ${name}`, "--no-gpg-sign");
  return wt;
}

/** The producer executions recorded so far. */
async function producerRuns(counter: string): Promise<number> {
  try {
    return (await Deno.readTextFile(counter)).length;
  } catch {
    return 0;
  }
}

Deno.test("five submissions land in turn: selected first, then grant order, each later one composed and counted", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await walkFixture(dir, counter);
      const names = ["one", "two", "three", "four", "five"];
      const efforts: Record<string, string> = {};
      for (const name of names) {
        efforts[name] = await effortWithWork(dir, name);
        assertEquals(
          (await runAgent(efforts[name] as string, ["done", "--json"])).code,
          0,
        );
        assertEquals(
          (await runAgent(efforts[name] as string, ["accept", "--json"])).code,
          1,
          "submitting without authority records and refuses",
        );
      }
      // Grants arrive out of submission order: the walk follows grant time.
      await grantEffort(
        efforts.three as string,
        "agent/three",
        "2026-09-12T10:00:00.000Z",
      );
      await grantEffort(
        efforts.two as string,
        "agent/two",
        "2026-09-12T11:00:00.000Z",
      );
      await grantEffort(
        efforts.four as string,
        "agent/four",
        "2026-09-12T12:00:00.000Z",
      );
      await grantEffort(
        efforts.five as string,
        "agent/five",
        "2026-09-12T13:00:00.000Z",
      );
      const displayed = await submissionRows(await Deno.realPath(dir), "main");
      assertEquals(
        displayed.map((row) => row.branch),
        [
          "agent/three",
          "agent/two",
          "agent/four",
          "agent/five",
          "agent/one",
        ],
        "pre-authorized rows sort by grant time; the rest by submission time",
      );

      const runsBefore = await producerRuns(counter);
      // The owner selects `one` — the first-position exception — with
      // conversation consent; the others land under their own grants.
      const landed = await runAgent(dir, [
        "accept",
        "--target",
        "agent/one",
        "--confirmed",
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assert(result.ok, landed.output);
      assert(result.message !== undefined);
      assertStringIncludes(result.message, "Landed agent/one at");
      for (const branch of ["two", "three", "four", "five"]) {
        assertStringIncludes(
          result.message,
          `landed agent/${branch}'s submission`,
        );
      }

      assert(result.data !== undefined && !("issues" in result.data));
      const outcomes = result.data.landings;
      assert(outcomes !== undefined);
      assertEquals(outcomes.length, 5);
      assertEquals(outcomes[0]?.selected, true);
      assertEquals(outcomes[0]?.branch, "agent/one");
      assertEquals(outcomes[0]?.integrated, undefined);
      assertEquals(
        outcomes.slice(1).map((outcome) => outcome.branch),
        ["agent/three", "agent/two", "agent/four", "agent/five"],
        "the walk follows the displayed canonical order",
      );
      for (const outcome of outcomes) {
        assertEquals(outcome.status, "landed");
      }
      for (const outcome of outcomes.slice(1)) {
        assertEquals(outcome.selected, false);
        assertEquals(outcome.integrated, true);
        assertEquals(outcome.consent, { source: "effort-grant" });
        assert(outcome.landed_commit !== undefined);
        assert(outcome.landed_commit !== outcome.head);
      }

      // Every change reached the trunk; every worktree and branch is gone.
      for (const name of names) {
        assert(await targetExists(join(dir, `${name}.txt`)), name);
        assertEquals(
          await gitOut(dir, "branch", "--list", `agent/${name}`),
          "",
        );
      }
      assertEquals(await submissionRows(await Deno.realPath(dir), "main"), []);

      // Each landing after the first composed and re-checked: four
      // integration gate runs, one producer execution each.
      const runsAfter = await producerRuns(counter);
      assertEquals(
        runsAfter - runsBefore,
        4,
        "each follower costs exactly one composed producer execution",
      );
    });
  });
});

Deno.test("the walk stops at the first submission awaiting the owner and reports it individually", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await walkFixture(dir, counter);
      const alpha = await effortWithWork(dir, "alpha");
      const beta = await effortWithWork(dir, "beta");
      const gamma = await effortWithWork(dir, "gamma");
      for (const wt of [alpha, beta, gamma]) {
        assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
        assertEquals((await runAgent(wt, ["accept", "--json"])).code, 1);
      }
      // Only gamma is pre-authorized; beta waits for the owner.
      await grantEffort(gamma, "agent/gamma", "2026-09-12T10:00:00.000Z");

      const landed = await runAgent(dir, [
        "accept",
        "--target",
        "agent/alpha",
        "--confirmed",
        "--json",
      ]);
      assertEquals(landed.code, 1, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assertEquals(result.ok, false);
      assertEquals(result.error, "partial_acceptance");
      assert(result.message !== undefined);
      assertStringIncludes(result.message, "Landed agent/alpha at");
      assertStringIncludes(
        result.message,
        "landed agent/gamma's submission",
      );
      assertStringIncludes(result.message, "The walk stopped at agent/beta:");

      assert(result.data !== undefined && !("issues" in result.data));
      const outcomes = result.data.landings;
      assert(outcomes !== undefined);
      assertEquals(
        outcomes.map((outcome) => [outcome.branch, outcome.status]),
        [
          ["agent/alpha", "landed"],
          ["agent/gamma", "landed"],
          ["agent/beta", "refused"],
        ],
      );
      // The selected landing's own effect projection is preserved: a false
      // call never implies the earlier landings were undone.
      assertEquals(result.data.landing?.trunk_landed, true);
      assert(await targetExists(join(dir, "alpha.txt")));
      assert(await targetExists(join(dir, "gamma.txt")));
      assertEquals(await targetExists(join(dir, "beta.txt")), false);

      // Beta's submission survives, waiting for the owner.
      const rows = await submissionRows(await Deno.realPath(dir), "main");
      assertEquals(rows.length, 1);
      assertEquals(rows[0]?.branch, "agent/beta");
      assertEquals(rows[0]?.authority, "awaiting-owner");

      // Retrying does not repeat the first landing: alpha is settled, so the
      // selected submission cannot be chosen again.
      const retried = await runAgent(dir, [
        "accept",
        "--target",
        "agent/alpha",
        "--json",
      ]);
      assertEquals(retried.code, 1);
      assertStringIncludes(
        retried.output,
        "No worktree matches 'agent/alpha'",
        "the landed effort's worktree is gone; nothing repeats",
      );
    });
  });
});

Deno.test("an agent's own accept lands only its own submission", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await walkFixture(dir, counter);
      const alpha = await effortWithWork(dir, "alpha");
      const beta = await effortWithWork(dir, "beta");
      for (const wt of [alpha, beta]) {
        assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
      }
      await grantEffort(beta, "agent/beta", "2026-09-12T10:00:00.000Z");
      // Beta submits and waits; alpha's own accept lands alpha alone.
      assertEquals((await runAgent(beta, ["accept", "--json"])).code, 0);
      const landed = await runAgent(alpha, [
        "accept",
        "--confirmed",
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assert(result.data !== undefined && !("issues" in result.data));
      assertEquals(result.data.landings?.length, 1);
      assertEquals(result.data.landings?.[0]?.branch, "agent/alpha");
    });
  });
});
