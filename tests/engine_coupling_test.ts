/**
 * Engine coverage for the `coupling` verb — the co-change advisory. Each test builds a
 * temp repo with a KNOWN, deliberate commit history, then asserts the mined model both
 * white-box (the `couplingResult` core) and black-box (`runAgent` `coupling --json`).
 *
 * The metric properties under test, each a guard with teeth (confirmed to fail on a
 * deliberate break — e.g. inverting the ranking, removing the 1/size weighting or the
 * decay — before being trusted):
 *  - a partner that co-changes OFTEN ranks above one that co-changed once (support);
 *  - a single mega-commit does NOT make its files look coupled (the 1/size weighting
 *    AND the max_commit_size skip);
 *  - recency decay changes the ranking (a faded coupling sinks below a fresh one);
 *  - diff-aware mode names a MISSING partner for a staged change, and stays silent when
 *    nothing is missing.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitAt,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { couplingResult } from "../src/engine/coupling/coupling.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import type { CouplingData } from "../src/shared/result_schemas.ts";

/** Write a `[coupling]` config with the given key lines, kept set-up. The thresholds
 * are dialed PER TEST so a small deliberate history reaches (or doesn't reach) the bar. */
async function couplingConfig(dir: string, lines: string[]): Promise<void> {
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      'main_branch = "main"',
      "",
      "[coupling]",
      ...lines,
      "",
    ].join("\n"),
  );
  // Absorb the config edit into history so the commits below are clean baskets.
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "config", "--no-gpg-sign");
}

/** Commit a set of {path: contents} files in one commit (a basket). */
async function commit(
  dir: string,
  files: Record<string, string>,
  msg: string,
): Promise<void> {
  for (const [f, c] of Object.entries(files)) {
    await Deno.writeTextFile(join(dir, f), c);
  }
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", msg, "--no-gpg-sign");
}

/** Like {@link commit}, but at a controlled date (for the recency-decay test). */
async function commitAt(
  dir: string,
  date: string,
  files: Record<string, string>,
  msg: string,
): Promise<void> {
  for (const [f, c] of Object.entries(files)) {
    await Deno.writeTextFile(join(dir, f), c);
  }
  await gitAt(dir, date, "add", "-A");
  await gitAt(dir, date, "commit", "-q", "-m", msg, "--no-gpg-sign");
}

/** The partner paths of a query result, in ranked order. */
function partnerPaths(data: CouplingData): string[] {
  return data.partners.map((p) => p.path);
}

Deno.test("coupling ranks a frequent partner above a one-off co-change (support)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Floors low enough that BOTH the frequent and the one-off partner survive — the
    // test is about ORDER, not inclusion.
    await couplingConfig(dir, ["min_support = 0.01", "min_confidence = 0.01"]);

    // a.ts couples with b.ts four times, with e.ts once; variety keeps lift > 1.
    await commit(dir, { "a.ts": "1", "b.ts": "1" }, "ab1");
    await commit(dir, { "a.ts": "2", "b.ts": "2" }, "ab2");
    await commit(dir, { "a.ts": "3", "b.ts": "3" }, "ab3");
    await commit(dir, { "a.ts": "4", "b.ts": "4" }, "ab4");
    await commit(dir, { "a.ts": "5", "e.ts": "1" }, "ae");
    await commit(dir, { "b.ts": "5", "f.ts": "1" }, "bf");
    await commit(dir, { "g.ts": "1", "h.ts": "1" }, "gh");

    const data = (await couplingResult(dir, { path: "a.ts" }))
      .data as CouplingData;
    const paths = partnerPaths(data);
    assert(paths.includes("b.ts"), `expected b.ts among partners: ${paths}`);
    assert(paths.includes("e.ts"), `expected e.ts among partners: ${paths}`);
    // The frequent partner outranks the one-off, and carries more support.
    assert(
      paths.indexOf("b.ts") < paths.indexOf("e.ts"),
      `b.ts (4 co-changes) must rank above e.ts (1): ${paths}`,
    );
    const b = data.partners.find((p) => p.path === "b.ts");
    const e = data.partners.find((p) => p.path === "e.ts");
    assert(b !== undefined && e !== undefined);
    assert(
      b.support > e.support,
      `b.support ${b.support} > e.support ${e.support}`,
    );
  });
});

Deno.test("the 1/size weighting keeps a single large commit from manufacturing coupling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // max_commit_size high enough NOT to skip the big commit — so this isolates the
    // 1/size weighting: each of the 45 pairs gets only 1/10 of a commit's weight.
    await couplingConfig(dir, [
      "min_support = 0.5",
      "min_confidence = 0.01",
      "max_commit_size = 50",
    ]);
    const big: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      big[`f${i}.ts`] = "x";
    }
    await commit(dir, big, "one big commit");

    const data = (await couplingResult(dir, { path: "f0.ts" }))
      .data as CouplingData;
    // Each pair's support is ~0.1 (1/10), well below the 0.5 floor → nothing surfaces.
    assertEquals(
      data.partners,
      [],
      `a single 10-file commit must not manufacture coupling: ${
        JSON.stringify(data.partners)
      }`,
    );
  });
});

Deno.test("max_commit_size skips a sweeping commit outright (no edges at all)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    // Floors near zero, so ONLY the size cap can suppress the edges.
    await couplingConfig(dir, [
      "min_support = 0.0001",
      "min_confidence = 0.0001",
      "max_commit_size = 5",
    ]);
    const big: Record<string, string> = {};
    for (let i = 0; i < 8; i++) {
      big[`f${i}.ts`] = "x";
    }
    await commit(dir, big, "8-file sweep");

    const data = (await couplingResult(dir, { path: "f0.ts" }))
      .data as CouplingData;
    assertEquals(
      data.partners,
      [],
      `an 8-file commit over max_commit_size=5 must contribute no edges: ${
        JSON.stringify(data.partners)
      }`,
    );
  });
});

Deno.test("recency decay changes the ranking (a fresh coupling outranks a faded one)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // Equal co-change COUNTS, but a.ts↔b.ts is ancient and a.ts↔c.ts is recent. Noise
    // commits raise the total weight so both couplings clear lift > 1.
    const build = async (): Promise<void> => {
      await commitAt(
        dir,
        "2000-01-01T00:00:00",
        { "a.ts": "1", "b.ts": "1" },
        "ab1",
      );
      await commitAt(
        dir,
        "2000-01-02T00:00:00",
        { "a.ts": "2", "b.ts": "2" },
        "ab2",
      );
      await commitAt(
        dir,
        "2000-01-03T00:00:00",
        { "a.ts": "3", "b.ts": "3" },
        "ab3",
      );
      await commitAt(
        dir,
        "2026-06-01T00:00:00",
        { "a.ts": "4", "c.ts": "1" },
        "ac1",
      );
      await commitAt(
        dir,
        "2026-06-02T00:00:00",
        { "a.ts": "5", "c.ts": "2" },
        "ac2",
      );
      await commitAt(
        dir,
        "2026-06-03T00:00:00",
        { "a.ts": "6", "c.ts": "3" },
        "ac3",
      );
      await commitAt(
        dir,
        "2026-06-04T00:00:00",
        { "n1.ts": "1", "n2.ts": "1" },
        "n1",
      );
      await commitAt(
        dir,
        "2026-06-05T00:00:00",
        { "n3.ts": "1", "n4.ts": "1" },
        "n2",
      );
      await commitAt(
        dir,
        "2026-06-06T00:00:00",
        { "n5.ts": "1", "n6.ts": "1" },
        "n3",
      );
    };

    // Decay ON (90-day half-life): the ancient a↔b is faded, so the fresh a↔c wins.
    await couplingConfig(dir, [
      "min_support = 0.001",
      "min_confidence = 0.001",
      "half_life_days = 90",
    ]);
    await build();
    const decayed = (await couplingResult(dir, { path: "a.ts" }))
      .data as CouplingData;
    assertEquals(
      partnerPaths(decayed)[0],
      "c.ts",
      `with decay, the recent partner c.ts must rank first: ${
        partnerPaths(decayed)
      }`,
    );

    // The SAME history with decay effectively OFF (an enormous half-life): the two
    // couplings now tie on support, so the stable path-order tiebreak puts b.ts first —
    // i.e. the only thing that moved c.ts to the top above was the decay.
    await withTempDir(async (dir2) => {
      await scaffoldEngine(dir2);
      await gitInit(dir2);
      await couplingConfig(dir2, [
        "min_support = 0.001",
        "min_confidence = 0.001",
        "half_life_days = 100000000",
      ]);
      await commitAt(
        dir2,
        "2000-01-01T00:00:00",
        { "a.ts": "1", "b.ts": "1" },
        "ab1",
      );
      await commitAt(
        dir2,
        "2000-01-02T00:00:00",
        { "a.ts": "2", "b.ts": "2" },
        "ab2",
      );
      await commitAt(
        dir2,
        "2000-01-03T00:00:00",
        { "a.ts": "3", "b.ts": "3" },
        "ab3",
      );
      await commitAt(
        dir2,
        "2026-06-01T00:00:00",
        { "a.ts": "4", "c.ts": "1" },
        "ac1",
      );
      await commitAt(
        dir2,
        "2026-06-02T00:00:00",
        { "a.ts": "5", "c.ts": "2" },
        "ac2",
      );
      await commitAt(
        dir2,
        "2026-06-03T00:00:00",
        { "a.ts": "6", "c.ts": "3" },
        "ac3",
      );
      await commitAt(dir2, "2026-06-04T00:00:00", {
        "n1.ts": "1",
        "n2.ts": "1",
      }, "n1");
      await commitAt(dir2, "2026-06-05T00:00:00", {
        "n3.ts": "1",
        "n4.ts": "1",
      }, "n2");
      await commitAt(dir2, "2026-06-06T00:00:00", {
        "n5.ts": "1",
        "n6.ts": "1",
      }, "n3");
      const flat = (await couplingResult(dir2, { path: "a.ts" }))
        .data as CouplingData;
      assertEquals(
        partnerPaths(flat)[0],
        "b.ts",
        `without decay the couplings tie and b.ts sorts first: ${
          partnerPaths(flat)
        }`,
      );
    });
  });
});

Deno.test("diff-aware mode names a missing partner, and stays silent when nothing is missing", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await couplingConfig(dir, ["min_support = 0.01", "min_confidence = 0.01"]);
    // a.ts and b.ts couple; variety keeps lift > 1. z.ts is committed ALONE, so it
    // forms no basket pair and is genuinely uncoupled.
    await commit(dir, { "a.ts": "1", "b.ts": "1" }, "ab1");
    await commit(dir, { "a.ts": "2", "b.ts": "2" }, "ab2");
    await commit(dir, { "a.ts": "3", "b.ts": "3" }, "ab3");
    await commit(dir, { "a.ts": "4", "c.ts": "1" }, "ac");
    await commit(dir, { "b.ts": "4", "d.ts": "1" }, "bd");
    await commit(dir, { "z.ts": "1" }, "z-solo");

    // Stage a change to a.ts only → b.ts surfaces as a MISSING partner.
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");
    const missing = (await couplingResult(dir)).data as CouplingData;
    assertEquals(missing.mode, "diff");
    assert(
      partnerPaths(missing).includes("b.ts"),
      `b.ts should surface as missing from a change to a.ts: ${
        JSON.stringify(missing.partners)
      }`,
    );
    // The partner names the file you DID change as its source.
    const edge = missing.partners.find((p) => p.path === "b.ts");
    assertEquals(edge?.from, "a.ts");

    // Now also change b.ts → it is in the change set, so it is no longer "missing".
    await Deno.writeTextFile(join(dir, "b.ts"), "staged");
    const bothChanged = (await couplingResult(dir)).data as CouplingData;
    assert(
      !partnerPaths(bothChanged).includes("b.ts"),
      `b.ts is in the change set, so it must not be flagged missing: ${
        JSON.stringify(bothChanged.partners)
      }`,
    );

    // Revert a.ts/b.ts and change only the uncoupled z.ts → nothing to advise.
    await git(dir, "checkout", "--", "a.ts", "b.ts");
    await Deno.writeTextFile(join(dir, "z.ts"), "staged");
    const quiet = (await couplingResult(dir)).data as CouplingData;
    assertEquals(
      quiet.partners,
      [],
      `an uncoupled file should surface no partners: ${
        JSON.stringify(quiet.partners)
      }`,
    );
  });
});

Deno.test("coupling --json works black-box in both modes (query and diff-aware)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await couplingConfig(dir, ["min_support = 0.01", "min_confidence = 0.01"]);
    await commit(dir, { "a.ts": "1", "b.ts": "1" }, "ab1");
    await commit(dir, { "a.ts": "2", "b.ts": "2" }, "ab2");
    await commit(dir, { "a.ts": "3", "b.ts": "3" }, "ab3");
    await commit(dir, { "a.ts": "4", "c.ts": "1" }, "ac");
    await commit(dir, { "b.ts": "4", "d.ts": "1" }, "bd");

    // Query mode via the CLI: the envelope, the data, and the advisory hints.
    const q = await runAgent(dir, ["coupling", "a.ts", "--json"]);
    assertEquals(q.code, 0, q.output);
    const qObj = JSON.parse(q.stdout.trim());
    assertEquals(qObj.ok, true);
    assertEquals(qObj.verb, "coupling");
    assertEquals(qObj.data.mode, "query");
    assert(
      qObj.data.partners.some((p: { path: string }) => p.path === "b.ts"),
      q.stdout,
    );
    assert(
      Array.isArray(qObj.hints) && qObj.hints.length > 0,
      "query mode should carry advisory hints",
    );

    // Diff-aware mode via the CLI: stage a.ts → b.ts is named missing.
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");
    const d = await runAgent(dir, ["coupling", "--json"]);
    assertEquals(d.code, 0, d.output);
    const dObj = JSON.parse(d.stdout.trim());
    assertEquals(dObj.data.mode, "diff");
    assert(
      dObj.data.partners.some((p: { path: string }) => p.path === "b.ts"),
      d.stdout,
    );
  });
});

/** The coupling history shared by the gate tests: a.ts ↔ b.ts couple, with variety so
 * lift > 1. Leaves a.ts staged (modified, uncommitted) so the diff-aware advisory has a
 * change set with a missing partner (b.ts). Capabilities/guidance/skills are left out, so
 * the gate is a clean green no-op whose only hints are the advisory ones. */
async function gateHistory(dir: string, inGate: boolean): Promise<void> {
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
      "",
      "[features]",
      "guidance = false",
      "skills = false",
      "",
      "[coupling]",
      `in_gate = ${inGate}`,
      "min_support = 0.01",
      "min_confidence = 0.01",
      "",
    ].join("\n"),
  );
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "config", "--no-gpg-sign");
  await commit(dir, { "a.ts": "1", "b.ts": "1" }, "ab1");
  await commit(dir, { "a.ts": "2", "b.ts": "2" }, "ab2");
  await commit(dir, { "a.ts": "3", "b.ts": "3" }, "ab3");
  await commit(dir, { "a.ts": "4", "c.ts": "1" }, "ac");
  await commit(dir, { "b.ts": "4", "d.ts": "1" }, "bd");
  await Deno.writeTextFile(join(dir, "a.ts"), "staged");
}

Deno.test("finish appends the coupling advisory only when [coupling].in_gate is on, and never changes pass/fail", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);

    // in_gate off (the default): the gate is green and carries NO coupling advisory.
    await gateHistory(dir, false);
    const off = await finishResult(dir);
    assertEquals(off.ok, true);
    assertEquals(off.data?.failed_stage ?? null, null);
    assert(
      !(off.hints ?? []).some((h) => h.includes("b.ts")),
      `no coupling advisory when in_gate is off: ${JSON.stringify(off.hints)}`,
    );

    // Flip it on (the discern.toml edit rides in the working tree alongside a.ts).
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[features]",
        "guidance = false",
        "skills = false",
        "",
        "[coupling]",
        "in_gate = true",
        "min_support = 0.01",
        "min_confidence = 0.01",
        "",
      ].join("\n"),
    );
    const on = await finishResult(dir);
    // The advisory never moves the gate's verdict.
    assertEquals(
      on.ok,
      true,
      "the advisory must not change the gate's pass/fail",
    );
    assertEquals(on.data?.failed_stage ?? null, null);
    const hints = on.hints ?? [];
    assert(
      hints.some((h) => h.includes("b.ts")),
      `expected a coupling advisory naming b.ts: ${JSON.stringify(hints)}`,
    );
    // It rides at the TAIL of the hints (after any standard gate next-steps).
    const idx = hints.findIndex((h) => h.includes("Co-change advisory"));
    assert(
      idx >= 0 && idx >= hints.length - 6,
      `coupling hints should sit at the tail: ${JSON.stringify(hints)}`,
    );
  });
});

Deno.test("finish suppresses the coupling advisory until the install is bootstrapped", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    // in_gate on, but the install is not bootstrapped → coupling behaves as if disabled,
    // so its in-session setup stays uncluttered. The config text mentions `bootstrapped`
    // so writeConfig leaves it false rather than stamping it true.
    await writeConfig(
      dir,
      [
        "[meta]",
        "bootstrapped = false",
        "",
        "[project]",
        'slug = "engine-test"',
        "",
        "[features]",
        "guidance = false",
        "skills = false",
        "",
        "[coupling]",
        "in_gate = true",
        "min_support = 0.01",
        "min_confidence = 0.01",
        "",
      ].join("\n"),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "config", "--no-gpg-sign");
    await commit(dir, { "a.ts": "1", "b.ts": "1" }, "ab1");
    await commit(dir, { "a.ts": "2", "b.ts": "2" }, "ab2");
    await commit(dir, { "a.ts": "3", "b.ts": "3" }, "ab3");
    await commit(dir, { "a.ts": "4", "c.ts": "1" }, "ac");
    await commit(dir, { "b.ts": "4", "d.ts": "1" }, "bd");
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");

    const result = await finishResult(dir);
    assert(
      !(result.hints ?? []).some((h) => h.includes("Co-change advisory")),
      `no advisory before bootstrap: ${JSON.stringify(result.hints)}`,
    );
  });
});

Deno.test("the coupling verb is gated behind [features].coupling", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[features]",
        "coupling = false",
        "",
      ].join("\n"),
    );
    // With the feature off, the verb is not registered → an unknown-recipe refusal.
    const r = await runAgent(dir, ["coupling", "--json"]);
    assertEquals(r.code, 1, r.output);
    assert(
      /feature|unknown|disabled/i.test(r.output),
      `expected a feature-disabled/unknown refusal, got: ${r.output}`,
    );
  });
});
