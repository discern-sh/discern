/**
 * Engine coverage for the `coupling` verb — the zero-config co-change advisory. Each
 * test builds a temp repo with a KNOWN, deliberate commit history and asserts the mined
 * model both white-box (the `couplingResult` core) and black-box (`runAgent`
 * `coupling --json`). There are NO thresholds to set — the model self-calibrates — so the
 * histories are sized to clear (or miss) the significance bar on their own merits.
 *
 * The properties under test, each a guard with teeth (confirmed to fail on a deliberate
 * break — inverting a gate, removing the significance test or the size fence — before
 * being trusted):
 *  - a repeated, significant coupling surfaces; a one-off co-change does not (the
 *    co-change-count floor);
 *  - a frequent co-occurrence that is only at the CHANCE rate is NOT flagged (the
 *    log-likelihood-ratio significance test — the "don't cry wolf" guard);
 *  - a sweeping commit is skipped, and the size fence adapts to the repo
 *    (`deriveMaxBasket`);
 *  - diff-aware mode names a MISSING partner for a staged change, and stays silent when
 *    nothing is missing;
 *  - the partner list is capped (top-k), so the advisory never floods;
 *  - finish surfaces it only behind `[coupling].in_gate`, never changing pass/fail, and
 *    is suppressed pre-bootstrap.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  couplingResult,
  deriveMaxBasket,
  MAX_PARTNERS,
} from "../src/engine/coupling/coupling.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import type { CouplingData } from "../src/shared/result_schemas.ts";

/** A bare set-up project (no capabilities; guidance/skills off so the gate is a clean
 * green no-op) — coupling needs zero config, so the only thing a test sets is `in_gate`. */
async function setup(dir: string, inGate = false): Promise<void> {
  await scaffoldEngine(dir);
  await gitInit(dir);
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
      "",
    ].join("\n"),
  );
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

/** Add `n` unrelated 2-file "noise" commits — population so a real co-occurrence reads
 * as more than chance (the significance test needs commits where neither file appears). */
async function noise(dir: string, n: number, tag = "n"): Promise<void> {
  for (let i = 0; i < n; i++) {
    await commit(
      dir,
      { [`${tag}${i}a.ts`]: "1", [`${tag}${i}b.ts`]: "1" },
      `${tag}${i}`,
    );
  }
}

/** The partner paths of a result, in ranked order. */
function partnerPaths(data: CouplingData): string[] {
  return data.partners.map((p) => p.path);
}

Deno.test("a repeated significant coupling surfaces; a one-off co-change does not", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // a.ts ↔ b.ts couple in 4 commits; a.ts ↔ x.ts share exactly ONE commit.
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    await commit(dir, { "a.ts": "x", "x.ts": "1" }, "ax-once");
    // p.ts ↔ q.ts are two RARE files sharing exactly ONE commit — a coincidence whose
    // single co-occurrence is statistically "surprising" (clears the significance test),
    // so ONLY the co-change-count floor keeps it from being mistaken for a coupling.
    await commit(dir, { "p.ts": "1", "q.ts": "1" }, "pq-once");
    await noise(dir, 6);

    const data = (await couplingResult(dir, { path: "a.ts" }))
      .data as CouplingData;
    const paths = partnerPaths(data);
    assert(
      paths.includes("b.ts"),
      `the repeated coupling b.ts should surface: ${
        JSON.stringify(data.partners)
      }`,
    );
    assert(
      !paths.includes("x.ts"),
      `a single shared commit is not a coupling: ${paths}`,
    );
    // The evidence is reported in plain counts.
    const edge = data.partners.find((p) => p.path === "b.ts");
    assertEquals(edge?.cochanges, 4);
    assertEquals(edge?.of, 5); // a.ts changed in 5 commits (4 with b, 1 with x)

    // The rare one-off pair forms no edge — the count floor, isolated.
    assertEquals(
      ((await couplingResult(dir, { path: "p.ts" })).data as CouplingData)
        .partners,
      [],
      "a single co-occurrence of two rare files is not a coupling",
    );
  });
});

Deno.test("a frequent co-occurrence at the chance rate is not flagged (significance test)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // hot.ts and busy.ts each appear in 5 commits and co-occur in 3 — but against a
    // 10-commit population that is no more than chance (expected ≈ 2.5), so the
    // log-likelihood ratio stays below the bar even though they share THREE commits.
    await commit(dir, { "hot.ts": "1", "h1.ts": "1" }, "h1");
    await commit(dir, { "hot.ts": "2", "h2.ts": "1" }, "h2");
    await commit(dir, { "hot.ts": "3", "busy.ts": "1" }, "hb1");
    await commit(dir, { "hot.ts": "4", "busy.ts": "2" }, "hb2");
    await commit(dir, { "hot.ts": "5", "busy.ts": "3" }, "hb3");
    await commit(dir, { "busy.ts": "4", "k1.ts": "1" }, "k1");
    await commit(dir, { "busy.ts": "5", "k2.ts": "1" }, "k2");
    await noise(dir, 3, "f");

    const data = (await couplingResult(dir, { path: "hot.ts" }))
      .data as CouplingData;
    assert(
      !partnerPaths(data).includes("busy.ts"),
      `co-occurrence at the chance rate must not be flagged: ${
        JSON.stringify(data.partners)
      }`,
    );
  });
});

Deno.test("deriveMaxBasket: floors small-commit repos, adapts to large ones, caps the pathological", () => {
  const repeat = (v: number, n: number): number[] =>
    Array.from({ length: n }, () => v);
  // A repo of tiny commits: the fence would be ~2, but the floor protects modest
  // multi-file changes.
  assertEquals(deriveMaxBasket(repeat(2, 40)), 8);
  // A repo of habitually larger commits: the fence rises well above the floor, so those
  // commits are NOT over-capped (a fixed small cap would wrongly skip them).
  assert(
    deriveMaxBasket(repeat(15, 40)) >= 15,
    "the fence must adapt up for a large-commit repo",
  );
  // A genuine outlier above an otherwise-tight distribution is fenced out.
  const tightWithOutlier = [...repeat(3, 39), 200].sort((a, b) => a - b);
  assert(
    deriveMaxBasket(tightWithOutlier) < 200,
    "an outlier sweep is fenced out",
  );
  // Too few baskets to trust a fence → fall back to the hard cap, not an aggressive one.
  assert(
    deriveMaxBasket([2, 2, 3]) > 100,
    "a thin distribution falls back to the hard cap",
  );
  // The hard cap bounds even a repo of enormous commits (O(n²) safety).
  assertEquals(deriveMaxBasket(repeat(5000, 40)), 150);
});

Deno.test("the size fence skips sweeping commits, so files coupled only inside them don't surface", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // A genuine small coupling (2-file commits)…
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    // …and c.ts/d.ts that ALWAYS change inside 22-file sweeps (a recurring mass edit).
    // They co-change three times — enough to be "significant" on raw counts — so ONLY
    // the size fence (which skips these outsized baskets) keeps them from coupling.
    for (let s = 0; s < 3; s++) {
      const sweep: Record<string, string> = { "c.ts": `${s}`, "d.ts": `${s}` };
      for (let i = 0; i < 20; i++) {
        sweep[`f${i}.ts`] = `${s}`;
      }
      await commit(dir, sweep, `sweep${s}`);
    }
    await noise(dir, 6);

    assert(
      partnerPaths(
        (await couplingResult(dir, { path: "a.ts" })).data as CouplingData,
      ).includes("b.ts"),
      "the genuine small coupling still surfaces",
    );
    assertEquals(
      ((await couplingResult(dir, { path: "c.ts" })).data as CouplingData)
        .partners,
      [],
      "a pair seen only inside sweeping commits is fenced out, not coupled",
    );
  });
});

Deno.test("diff-aware mode names a missing partner, and stays silent when nothing is missing", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    await noise(dir, 6);
    await commit(dir, { "z.ts": "1" }, "z-solo"); // z.ts is uncoupled (no basket pair)

    // Stage a.ts only → b.ts surfaces as a MISSING partner, attributed to a.ts.
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");
    const missing = (await couplingResult(dir)).data as CouplingData;
    assertEquals(missing.mode, "diff");
    assert(
      partnerPaths(missing).includes("b.ts"),
      `b.ts should surface as missing: ${JSON.stringify(missing.partners)}`,
    );
    assertEquals(missing.partners.find((p) => p.path === "b.ts")?.from, "a.ts");

    // Also change b.ts → it is in the change set, so it is no longer "missing".
    await Deno.writeTextFile(join(dir, "b.ts"), "staged");
    assert(
      !partnerPaths((await couplingResult(dir)).data as CouplingData).includes(
        "b.ts",
      ),
      "b.ts is in the change set, so it must not be flagged missing",
    );

    // Revert and change only the uncoupled z.ts → nothing to advise.
    await git(dir, "checkout", "--", "a.ts", "b.ts");
    await Deno.writeTextFile(join(dir, "z.ts"), "staged");
    assertEquals(
      ((await couplingResult(dir)).data as CouplingData).partners,
      [],
      "an uncoupled file surfaces no partners",
    );
  });
});

Deno.test("the partner list is capped at MAX_PARTNERS (top-k, so it never floods)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // A hub file `a` that couples with 13 partners: each of 13 commits pairs `a` with 5
    // consecutive partners (cyclic), so every partner shares exactly 5 of a's commits —
    // all significant. Noise makes a's presence < 100% so the co-occurrences beat chance.
    const P = 13;
    for (let i = 0; i < P; i++) {
      const files: Record<string, string> = { "a.ts": `${i}` };
      for (let k = 0; k < 5; k++) {
        files[`b${(i + k) % P}.ts`] = `${i}`;
      }
      await commit(dir, files, `hub${i}`);
    }
    await noise(dir, 12);

    const data = (await couplingResult(dir, { path: "a.ts" }))
      .data as CouplingData;
    assert(
      data.partners.length > 0 && data.partners.length <= MAX_PARTNERS,
      `expected a capped non-empty list, got ${data.partners.length}`,
    );
    assertEquals(
      data.partners.length,
      MAX_PARTNERS,
      "more than MAX_PARTNERS qualified, so it is capped",
    );
  });
});

Deno.test("coupling --json works black-box in both modes (query and diff-aware)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    await noise(dir, 6);

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
      "query mode carries advisory hints",
    );

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
      ]
        .join("\n"),
    );
    const r = await runAgent(dir, ["coupling", "--json"]);
    assertEquals(r.code, 1, r.output);
    assert(
      /feature|unknown|disabled/i.test(r.output),
      `expected a feature-disabled/unknown refusal, got: ${r.output}`,
    );
  });
});

Deno.test("finish appends the coupling advisory only when [coupling].in_gate is on, and never changes pass/fail", async () => {
  await withTempDir(async (dir) => {
    await setup(dir, false);
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    await noise(dir, 6);
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");

    // in_gate off (the default): the gate is green and carries NO coupling advisory.
    const off = await finishResult(dir);
    assertEquals(off.ok, true);
    assertEquals(off.data?.failed_stage ?? null, null);
    assert(
      !(off.hints ?? []).some((h) => h.includes("Co-change advisory")),
      `no advisory when in_gate is off: ${JSON.stringify(off.hints)}`,
    );

    // Flip it on.
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
        "",
      ].join("\n"),
    );
    const on = await finishResult(dir);
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
    // It rides at the TAIL of the hints.
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
    // in_gate on, but not bootstrapped → coupling behaves as if disabled (its in-session
    // setup stays uncluttered). The config text mentions `bootstrapped` so writeConfig
    // leaves it false.
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
        "",
      ].join("\n"),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "config", "--no-gpg-sign");
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    await noise(dir, 6);
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");

    const result = await finishResult(dir);
    assert(
      !(result.hints ?? []).some((h) => h.includes("Co-change advisory")),
      `no advisory before bootstrap: ${JSON.stringify(result.hints)}`,
    );
  });
});
