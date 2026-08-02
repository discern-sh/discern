/**
 * Engine coverage for the `coupling` verb — the zero-config coupling. Each
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
 *  - evidence mode (two files) lists EXACTLY the commits where both changed, with the
 *    "of N" denominators, excludes a solo commit, and reports "no shared history" as zero;
 *  - the partner list is capped (top-k), so the advisory never floods;
 *  - finish AND the fast inner loop prepare surface it only behind `[coupling].in_gate`,
 *    never changing pass/fail, and it is suppressed pre-setup.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { renderAgentFiles } from "../src/engine/guidance_render.ts";
import { HINTS } from "../src/shared/hints.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveGeneratedGroups } from "../src/shared/generated_artifacts.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  couplingGateHints,
  couplingResult,
  deriveMaxBasket,
  MAX_PARTNERS,
} from "../src/engine/coupling/coupling.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { prepareResult } from "../src/engine/gate/prepare.ts";
import { isNeutralPath } from "../src/engine/scopes/scopes.ts";
import {
  type CouplingData,
  CouplingOutputSchema,
} from "../src/shared/result_schemas.ts";

/** A bare set-up project (no capabilities; guidance/skills off so the gate is a clean
 * green no-op) — coupling needs zero config, so the only thing a test varies is `in_gate`. */
async function setup(dir: string, inGate = true): Promise<void> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  await writeConfig(
    dir,
    [
      "[project]",
      'slug = "engine-test"',
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
    const path = join(dir, f);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, c);
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

async function rankedHubHistory(dir: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const files: Record<string, string> = { "hub.ts": `hub-${i}` };
    if (i < 18) {
      files["always.ts"] = `always-${i}`; // 18/20 = 0.9
    } else {
      files["tail.ts"] = `tail-${i}`; // keeps hub.ts pairable without qualifying
    }
    if (i < 12) {
      files["often.ts"] = `often-${i}`; // 12/20 = 0.6
    }
    if (i < 8) {
      files["sometimes.ts"] = `sometimes-${i}`; // 8/20 = 0.4
    }
    for (let j = 0; j < 11; j++) {
      if (i >= j && i < j + 4) {
        files[`weak${j}.ts`] = `${i}`; // 4/20 = 0.2, enough to qualify
      }
    }
    await commit(dir, files, `hub-${i}`);
  }
  await noise(dir, 80, "rank-noise");
}

/** Two unrelated generated groups make the regression fresh-name proof: ownership is
 * read from config, so neither a familiar directory nor a copied filename can pass the
 * detector by accident. The artifact inventory also drives every ownership assertion. */
const GENERATED_FIXTURE_GROUPS = [
  {
    name: "bundle",
    pattern: "derived/**",
    artifacts: [
      "derived/application.bin",
      "derived/routes.bin",
      "derived/messages.bin",
      "derived/search.bin",
    ],
  },
  {
    name: "contract-snapshots",
    pattern: "contracts/**",
    artifacts: [
      "contracts/api.snapshot",
      "contracts/events.snapshot",
      "contracts/storage.snapshot",
    ],
  },
] as const;

const COMPACT_SOURCE = "compact.ts";
const COMPACT_TEST = "compact_test.ts";
const FENCED_SOURCE = "fenced.ts";
const FENCED_TEST = "fenced_test.ts";

interface GeneratedFixtureArtifact {
  path: string;
  group: string;
}

function generatedFixtureArtifacts(): GeneratedFixtureArtifact[] {
  return GENERATED_FIXTURE_GROUPS.flatMap((group) =>
    group.artifacts.map((path) => ({ path, group: group.name }))
  );
}

function generatedFixtureConfig(): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[coupling]",
    "in_gate = true",
    ...GENERATED_FIXTURE_GROUPS.flatMap((group) => [
      "",
      `[generated.${group.name}]`,
      `paths = ${JSON.stringify([group.pattern])}`,
      'run = "true"',
    ]),
    "",
  ].join("\n");
}

async function setupGeneratedFixture(dir: string): Promise<void> {
  await scaffoldEngine(dir);
  await gitInit(dir);
  await writeConfig(dir, generatedFixtureConfig());
  await git(dir, "add", "-A");
  await git(dir, "commit", "-q", "-m", "generated config", "--no-gpg-sign");

  const resolved = resolveGeneratedGroups(await loadConfig(dir));
  assertEquals(
    resolved.map((group) => ({ name: group.name, paths: group.paths })),
    GENERATED_FIXTURE_GROUPS.map((group) => ({
      name: group.name,
      paths: [group.pattern],
    })),
    "the fixture's ownership assertions must come from its configured groups",
  );
}

/** Histories with both compact and size-fenced baskets. The compact commits prove
 * generated endpoints disappear while the authored pair remains. Each fenced commit
 * has 2 authored files plus every declared output: 9 paths before exclusion, 2 after.
 * Against the 2-file noise population the upper fence is 8, so the authored pair only
 * survives when ownership filtering happens before basket-size statistics. */
async function generatedFixtureHistory(dir: string): Promise<void> {
  const artifacts = generatedFixtureArtifacts();
  const compactOutputs = GENERATED_FIXTURE_GROUPS.map((group) =>
    group.artifacts[0]
  );
  for (let i = 0; i < 4; i++) {
    const compact: Record<string, string> = {
      [COMPACT_SOURCE]: `source-${i}`,
      [COMPACT_TEST]: `test-${i}`,
    };
    for (const path of compactOutputs) {
      compact[path] = `compact-output-${i}`;
    }
    await commit(dir, compact, `compact-${i}`);

    const fenced: Record<string, string> = {
      [FENCED_SOURCE]: `source-${i}`,
      [FENCED_TEST]: `test-${i}`,
    };
    for (const { path } of artifacts) {
      fenced[path] = `fenced-output-${i}`;
    }
    await commit(dir, fenced, `fenced-${i}`);
  }
  await noise(dir, 30, "generated-noise");
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

    const data = (await couplingResult(dir, { paths: ["a.ts"] }))
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
      ((await couplingResult(dir, { paths: ["p.ts"] })).data as CouplingData)
        .partners,
      [],
      "a single co-occurrence of two rare files is not a coupling",
    );
  });
});

Deno.test("a coupled partner with a non-ASCII filename surfaces undamaged", async () => {
  // The miner reads `git log --name-only`; without NUL separation git C-quotes
  // non-ASCII paths, so the model would key the partner under a garbage string
  // that never matches the real path.
  await withTempDir(async (dir) => {
    await setup(dir);
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "café.ts": `${i}`, "b.ts": `${i}` }, `cb${i}`);
    }
    await noise(dir, 6);

    const data = (await couplingResult(dir, { paths: ["b.ts"] }))
      .data as CouplingData;
    assert(
      partnerPaths(data).includes("café.ts"),
      `café.ts must surface as b.ts's partner, verbatim: ${
        JSON.stringify(data.partners)
      }`,
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

    const data = (await couplingResult(dir, { paths: ["hot.ts"] }))
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
        (await couplingResult(dir, { paths: ["a.ts"] })).data as CouplingData,
      ).includes("b.ts"),
      "the genuine small coupling still surfaces",
    );
    assertEquals(
      ((await couplingResult(dir, { paths: ["c.ts"] })).data as CouplingData)
        .partners,
      [],
      "a pair seen only inside sweeping commits is fenced out, not coupled",
    );
  });
});

Deno.test("declared outputs are excluded before every coupling statistic while authored pairs survive", async () => {
  await withTempDir(async (dir) => {
    await setupGeneratedFixture(dir);
    await generatedFixtureHistory(dir);

    const artifacts = generatedFixtureArtifacts();
    const generatedPaths = new Set(artifacts.map(({ path }) => path));

    // Compact baskets prove declared outputs cannot remain as partners. The authored
    // source↔test relationship from those same commits remains intact.
    const compact = await couplingResult(dir, { paths: [COMPACT_SOURCE] });
    const compactData = compact.data as CouplingData;
    assertEquals(partnerPaths(compactData), [COMPACT_TEST]);
    assert(
      compactData.partners.every((partner) =>
        !generatedPaths.has(partner.from) && !generatedPaths.has(partner.path)
      ),
      `no generated endpoint may survive: ${
        JSON.stringify(compactData.partners)
      }`,
    );

    // Each fenced history basket has 9 paths before ownership filtering and only the
    // authored pair after it. Seeing the test proves exclusion happened before the
    // per-repo size fence rather than after a whole commit was discarded.
    const fenced = (await couplingResult(dir, { paths: [FENCED_SOURCE] }))
      .data as CouplingData;
    assertEquals(partnerPaths(fenced), [FENCED_TEST]);

    // Every configured path, across both fresh-name groups, is unpairable as a query
    // source and carries its authoritative owner instead of a zero-history claim.
    for (const artifact of artifacts) {
      const result = await couplingResult(dir, { paths: [artifact.path] });
      const data = result.data as CouplingData;
      assertEquals(data.mode, "query");
      assertEquals(data.target, artifact.path);
      assertEquals(data.partners, []);
      assertEquals(data.excluded_generated, [artifact]);
      assertHasHint(result, HINTS["coupling-generated-exclusion"], artifact);
    }

    // Either evidence endpoint can be generated. In both directions coupling returns
    // ownership, omits fabricated counts and commit rows, and emits no no-history hint.
    const evidenceCases: Array<{
      paths: [string, string];
      excluded: GeneratedFixtureArtifact[];
    }> = GENERATED_FIXTURE_GROUPS.flatMap((group) => {
      const path = group.artifacts[0];
      const excluded = [{ path, group: group.name }];
      return [
        { paths: [path, COMPACT_SOURCE], excluded },
        { paths: [COMPACT_SOURCE, path], excluded },
      ];
    });
    const first = artifacts[0];
    const last = artifacts[artifacts.length - 1];
    assert(first !== undefined && last !== undefined);
    evidenceCases.push({
      paths: [first.path, last.path],
      excluded: [first, last],
    });

    for (const evidenceCase of evidenceCases) {
      const result = await couplingResult(dir, {
        paths: evidenceCase.paths,
      });
      const data = result.data as CouplingData;
      assertEquals(data.mode, "evidence");
      assertEquals(data.a, evidenceCase.paths[0]);
      assertEquals(data.b, evidenceCase.paths[1]);
      assertEquals(data.partners, []);
      assertEquals(data.excluded_generated, evidenceCase.excluded);
      assertEquals(data.together, undefined);
      assertEquals(data.of_a, undefined);
      assertEquals(data.of_b, undefined);
      assertEquals(data.commits, undefined);
      assertEquals(result.hints?.length, evidenceCase.excluded.length);
      for (const excluded of evidenceCase.excluded) {
        assertHasHint(
          result,
          HINTS["coupling-generated-exclusion"],
          excluded,
        );
      }
      assert(
        !(result.hints ?? []).some((hint) =>
          hint.includes("have not changed together")
        ),
        `generated evidence must not claim zero history: ${result.hints}`,
      );
    }

    // The CLI JSON is held to the generated result schema, and the human surfaces say
    // the same ownership fact without falling through to the ordinary empty result.
    const cliArtifact = artifacts[0];
    assert(cliArtifact !== undefined);
    const json = await runAgent(dir, [
      "coupling",
      cliArtifact.path,
      "--json",
    ]);
    assertEquals(json.code, 0, json.output);
    const parsed = CouplingOutputSchema.safeParse(JSON.parse(json.stdout));
    assert(
      parsed.success,
      `coupling --json drifted from CouplingOutputSchema:\n${
        JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)
      }\n${json.stdout}`,
    );
    assertEquals(parsed.data.data, {
      mode: "query",
      target: cliArtifact.path,
      partners: [],
      excluded_generated: [cliArtifact],
    });
    assertHasHint(
      parsed.data,
      HINTS["coupling-generated-exclusion"],
      cliArtifact,
    );

    const humanQuery = await runAgent(dir, ["coupling", cliArtifact.path]);
    assertEquals(humanQuery.code, 0, humanQuery.output);
    assertStringIncludes(humanQuery.stdout, cliArtifact.path);
    assertStringIncludes(
      humanQuery.stdout,
      `[generated.${cliArtifact.group}]`,
    );
    assert(
      !humanQuery.stdout.includes("No co-change partners found"),
      humanQuery.stdout,
    );

    const humanEvidence = await runAgent(dir, [
      "coupling",
      COMPACT_SOURCE,
      cliArtifact.path,
    ]);
    assertEquals(humanEvidence.code, 0, humanEvidence.output);
    assertStringIncludes(humanEvidence.stdout, cliArtifact.path);
    assertStringIncludes(
      humanEvidence.stdout,
      `[generated.${cliArtifact.group}]`,
    );
    assert(
      !humanEvidence.stdout.includes("have not changed together"),
      humanEvidence.stdout,
    );

    // Mixed diffs retain only the authored path and its authored missing partner.
    await Deno.writeTextFile(join(dir, COMPACT_SOURCE), "mixed source\n");
    await Deno.writeTextFile(join(dir, cliArtifact.path), "mixed output\n");
    const mixed = await couplingResult(dir);
    const mixedData = mixed.data as CouplingData;
    assertEquals(mixedData.changed, [COMPACT_SOURCE]);
    assertEquals(mixedData.excluded_generated, [cliArtifact]);
    assertEquals(partnerPaths(mixedData), [COMPACT_TEST]);
    assertHasHint(
      mixed,
      HINTS["coupling-generated-exclusion"],
      cliArtifact,
    );
    await git(
      dir,
      "checkout",
      "--",
      COMPACT_SOURCE,
      cliArtifact.path,
    );

    // Derived-only churn remains explicit on demand and silent in automatic gate and
    // prepare advice. It never changes either command's verdict.
    await Deno.writeTextFile(join(dir, cliArtifact.path), "derived only\n");
    const generatedOnly = await couplingResult(dir);
    const generatedOnlyData = generatedOnly.data as CouplingData;
    assertEquals(generatedOnlyData.changed, []);
    assertEquals(generatedOnlyData.excluded_generated, [cliArtifact]);
    assertEquals(generatedOnlyData.partners, []);
    assertHasHint(
      generatedOnly,
      HINTS["coupling-generated-exclusion"],
      cliArtifact,
    );
    assertEquals(await couplingGateHints(dir), []);

    for (
      const automatic of [
        await prepareResult(dir),
        await finishResult(dir),
      ]
    ) {
      assertEquals(automatic.ok, true);
      assertLacksHint(automatic, HINTS["coupling-diff-header"]);
      assertLacksHint(
        automatic,
        HINTS["coupling-generated-exclusion"],
        cliArtifact,
      );
    }
  });
});

Deno.test("projects without generated declarations keep generated-looking paths pairable", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    assertEquals(resolveGeneratedGroups(await loadConfig(dir)), []);
    const projectedLooking = "derived/future-output.bin";
    for (let i = 0; i < 4; i++) {
      await commit(
        dir,
        { "source.ts": `${i}`, [projectedLooking]: `${i}` },
        `unowned-${i}`,
      );
    }
    await noise(dir, 6, "unowned-noise");

    const source = (await couplingResult(dir, { paths: ["source.ts"] }))
      .data as CouplingData;
    assertEquals(partnerPaths(source), [projectedLooking]);
    assertEquals(source.excluded_generated, undefined);

    const target = (await couplingResult(dir, { paths: [projectedLooking] }))
      .data as CouplingData;
    assertEquals(partnerPaths(target), ["source.ts"]);
    assertEquals(target.excluded_generated, undefined);
  });
});

Deno.test("refresh-owned agent output remains excluded through neutral classification", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const rendered = await renderAgentFiles(dir);
    const agentPath = rendered.keys().next().value;
    assert(
      agentPath !== undefined,
      "the configured agents must render an output",
    );
    const config = await loadConfig(dir);
    assertEquals(resolveGeneratedGroups(config), []);
    assert(
      isNeutralPath(config, agentPath),
      `${agentPath} must remain neutral independently of [generated]`,
    );

    for (let i = 0; i < 4; i++) {
      await Deno.writeTextFile(join(dir, "authored.ts"), `${i}`);
      await Deno.writeTextFile(join(dir, "authored_test.ts"), `${i}`);
      await Deno.writeTextFile(join(dir, agentPath), `compiled-${i}`);
      await git(dir, "add", "-A");
      await git(dir, "add", "-f", "--", agentPath);
      await git(
        dir,
        "commit",
        "-q",
        "-m",
        `neutral-output-${i}`,
        "--no-gpg-sign",
      );
    }
    await noise(dir, 6, "neutral-noise");

    const data = (await couplingResult(dir, { paths: ["authored.ts"] }))
      .data as CouplingData;
    assertEquals(partnerPaths(data), ["authored_test.ts"]);
    assert(!partnerPaths(data).includes(agentPath));
    assertEquals(data.excluded_generated, undefined);
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

Deno.test("gate hints use a stricter relevance bar than direct coupling", async () => {
  await withTempDir(async (dir) => {
    await setup(dir, true);
    // b.ts is a real broad-model partner for a.ts, but only 2 of 7 (29%). That remains
    // useful when explicitly asked for coupling, but is too weak to interrupt the gate.
    for (let i = 0; i < 2; i++) {
      await commit(dir, { "a.ts": `ab-${i}`, "b.ts": `ab-${i}` }, `ab${i}`);
    }
    for (let i = 0; i < 5; i++) {
      await commit(
        dir,
        { "a.ts": `a-${i}`, [`solo${i}.ts`]: `${i}` },
        `a-solo${i}`,
      );
    }
    await noise(dir, 30);

    await Deno.writeTextFile(join(dir, "a.ts"), "staged");
    const direct = (await couplingResult(dir)).data as CouplingData;
    assert(
      direct.partners.some((p) =>
        p.path === "b.ts" && p.cochanges === 2 && p.of === 7
      ),
      `direct coupling should keep the broad discovery signal: ${
        JSON.stringify(direct.partners)
      }`,
    );
    assertEquals(
      await couplingGateHints(dir),
      [],
      "the automatic gate advisory should suppress weak 2-of-7 partners",
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

    const data = (await couplingResult(dir, { paths: ["a.ts"] }))
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

Deno.test("coupling ranks strongest-first, keeps strongest under the cap, and tips near-invariants", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await rankedHubHistory(dir);

    const result = await couplingResult(dir, { paths: ["hub.ts"] });
    const data = result.data as CouplingData;
    assertEquals(
      data.partners.length,
      MAX_PARTNERS,
      "more than MAX_PARTNERS qualify, so the data is capped",
    );
    assertEquals(partnerPaths(data).slice(0, 3), [
      "always.ts",
      "often.ts",
      "sometimes.ts",
    ]);
    assertEquals(data.partners[0]?.confidence, 0.9);
    assert(
      partnerPaths(data).includes("always.ts"),
      `the strongest partner must survive the top-k cap: ${
        JSON.stringify(data.partners)
      }`,
    );
    assertHasHint(result, HINTS["coupling-strong-pair"], {
      from: "hub.ts",
      path: "always.ts",
    });
    const second = data.partners[1];
    assert(second !== undefined, "expected a second ranked partner in data");
    assertLacksHint(result, HINTS["coupling-query-partner"], {
      path: second.path,
      target: "hub.ts",
      cochanges: second.cochanges,
      of: second.of,
      confidence: second.confidence,
    });
    assertEquals(
      result.hints?.length,
      4,
      "summary, strongest partner, forcing-function advice, and overflow only",
    );
  });
});

Deno.test("coupling near-invariant tip stays quiet below 0.85 confidence", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    for (let i = 0; i < 20; i++) {
      const files: Record<string, string> = { "hub.ts": `${i}` };
      if (i < 16) {
        files["steady.ts"] = `${i}`; // 16/20 = 0.8
      } else {
        files["tail.ts"] = `${i}`;
      }
      await commit(dir, files, `steady-${i}`);
    }
    await noise(dir, 40, "below-threshold-noise");

    const result = await couplingResult(dir, { paths: ["hub.ts"] });
    const data = result.data as CouplingData;
    assertEquals(data.partners[0]?.path, "steady.ts");
    assertEquals(data.partners[0]?.confidence, 0.8);
    assertLacksHint(result, HINTS["coupling-strong-pair"], {
      from: "hub.ts",
      path: "steady.ts",
    });
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
    assertHasHint(qObj, HINTS["coupling-query-header"], { target: "a.ts" });
    assertHasHint(qObj, HINTS["coupling-query-partner"], {
      path: "b.ts",
      target: "a.ts",
      cochanges: 4,
      of: 4,
      confidence: 1,
    });

    await Deno.writeTextFile(join(dir, "a.ts"), "staged");
    const d = await runAgent(dir, ["coupling", "--json"]);
    assertEquals(d.code, 0, d.output);
    const dObj = JSON.parse(d.stdout.trim());
    assertEquals(dObj.data.mode, "diff");
    assert(
      dObj.data.partners.some((p: { path: string }) => p.path === "b.ts"),
      d.stdout,
    );
    assertHasHint(dObj, HINTS["coupling-diff-header"]);
    assertHasHint(dObj, HINTS["coupling-diff-partner"], {
      from: "a.ts",
      path: "b.ts",
      cochanges: 4,
      of: 4,
      confidence: 1,
    });
  });
});

Deno.test("the human CLI renders the FULL list (not the truncated gate hints) and never points back at itself", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // a.ts couples with SIX partners (b0..b5) — more than the terse gate hint shows — so
    // a 6th partner exists that only the full render includes.
    for (let i = 0; i < 4; i++) {
      const files: Record<string, string> = { "a.ts": `${i}` };
      for (let b = 0; b < 6; b++) {
        files[`b${b}.ts`] = `${i}`;
      }
      await commit(dir, files, `hub${i}`);
    }
    await noise(dir, 6);
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");

    // diff-aware, HUMAN mode (no --json) — exactly what a user runs.
    const r = await runAgent(dir, ["coupling"]);
    assertEquals(r.code, 0, r.output);
    assertStringIncludes(r.stdout, "You changed"); // grouped by the file you changed
    assertStringIncludes(r.stdout, "commits"); // plain-count evidence
    // The full ranked list is shown — including the partner the 5-line gate hint would
    // have truncated to "… and 1 more" (b5.ts sorts last among the six tied partners).
    assertStringIncludes(r.stdout, "b5.ts");
    // The bug: a standalone run must not tell you to run the thing you just ran, nor
    // claim "N more" when it already showed everything.
    assert(
      !r.stdout.includes("lists them all") && !/and \d+ more/.test(r.stdout),
      `the standalone command shows everything — no re-run pointer: ${r.stdout}`,
    );
  });
});

Deno.test("done appends the coupling advisory only when [coupling].in_gate is on, and never changes pass/fail", async () => {
  await withTempDir(async (dir) => {
    await setup(dir, false);
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    await noise(dir, 6);
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");

    // Explicitly disabled: the gate is green and carries no coupling advisory.
    const off = await finishResult(dir);
    assertEquals(off.ok, true);
    assertEquals(off.data?.failed_stage ?? null, null);
    assertLacksHint(off, HINTS["coupling-diff-header"]);

    // Flip it on.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
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
    const expectedHeader = assertHasHint(on, HINTS["coupling-diff-header"]);
    assertHasHint(on, HINTS["coupling-diff-partner"], {
      from: "a.ts",
      path: "b.ts",
      cochanges: 4,
      of: 4,
      confidence: 1,
    });
    // It rides at the TAIL of the hints.
    const hints = on.hints ?? [];
    const idx = hints.indexOf(expectedHeader);
    assert(
      idx >= 0 && idx >= hints.length - 6,
      `coupling hints should sit at the tail: ${JSON.stringify(hints)}`,
    );
  });
});

Deno.test("done suppresses the coupling advisory until the install is bootstrapped", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    // in_gate on, but not set up → coupling behaves as if disabled (its in-session
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
    assertLacksHint(result, HINTS["coupling-diff-header"]);
  });
});

Deno.test("evidence mode lists exactly the commits where both files changed, with the of-N denominators", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // a.ts & b.ts change TOGETHER in three commits, each with a distinct subject…
    await commit(dir, { "a.ts": "1", "b.ts": "1" }, "ab-first");
    await commit(dir, { "a.ts": "2", "b.ts": "2" }, "ab-second");
    await commit(dir, { "a.ts": "3", "b.ts": "3" }, "ab-third");
    // …a.ts changes alone once (must NOT appear in the shared history; lifts of_a)…
    await commit(dir, { "a.ts": "4", "x.ts": "1" }, "a-alone");
    // …and b.ts changes alone twice (must NOT appear; lifts of_b).
    await commit(dir, { "b.ts": "5", "y.ts": "1" }, "b-alone-1");
    await commit(dir, { "b.ts": "6", "z.ts": "1" }, "b-alone-2");
    await noise(dir, 6);

    const data = (await couplingResult(dir, { paths: ["a.ts", "b.ts"] }))
      .data as CouplingData;
    assertEquals(data.mode, "evidence");
    assertEquals(data.a, "a.ts");
    assertEquals(data.b, "b.ts");
    assertEquals(data.together, 3, "three commits changed both files");
    assertEquals(data.of_a, 4, "a.ts changed in 4 commits (3 shared + 1 solo)");
    assertEquals(data.of_b, 5, "b.ts changed in 5 commits (3 shared + 2 solo)");
    // EXACTLY the three co-change commits, most-recent first — the teeth: a solo commit
    // (which touched only one of the pair) is excluded, and nothing else sneaks in.
    assertEquals(
      (data.commits ?? []).map((c) => c.subject),
      ["ab-third", "ab-second", "ab-first"],
      `shared history must be exactly the three co-change commits: ${
        JSON.stringify(data.commits)
      }`,
    );
    // Each commit carries a short sha and an ISO date for the human to judge by.
    for (const c of data.commits ?? []) {
      assert(/^[0-9a-f]{7,}$/.test(c.sha), `a short sha: ${c.sha}`);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(c.date), `an ISO date: ${c.date}`);
    }

    // Two files that never share a commit → a zero-history answer, not silence: x.ts (only
    // in a-alone) and y.ts (only in b-alone-1) have no commit in common.
    const none = (await couplingResult(dir, { paths: ["x.ts", "y.ts"] }))
      .data as CouplingData;
    assertEquals(none.mode, "evidence");
    assertEquals(none.together, 0, "x.ts and y.ts never changed together");
    assertEquals(none.commits ?? [], [], "no shared commits to list");
    assertEquals(none.of_a, 1);
    assertEquals(none.of_b, 1);
  });
});

Deno.test("coupling A B works black-box on the CLI (evidence mode, --json and human)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await commit(dir, { "a.ts": "1", "b.ts": "1" }, "ab-decision");
    await commit(dir, { "a.ts": "2", "b.ts": "2" }, "ab-again");
    await noise(dir, 6);

    // --json: the evidence payload reaches the wire intact.
    const j = await runAgent(dir, ["coupling", "a.ts", "b.ts", "--json"]);
    assertEquals(j.code, 0, j.output);
    const obj = JSON.parse(j.stdout.trim());
    assertEquals(obj.data.mode, "evidence");
    assertEquals(obj.data.together, 2);
    assertEquals(
      (obj.data.commits as { subject: string }[]).map((c) => c.subject),
      ["ab-again", "ab-decision"],
    );
    assertHasHint(obj, HINTS["coupling-evidence-summary"], {
      a: "a.ts",
      b: "b.ts",
      together: 2,
      ofA: 2,
      ofB: 2,
    });
    assertEquals(
      obj.hints?.length,
      1,
      "shared commit rows stay in data.commits, not hints",
    );

    // human: the rendered view names the pair and lists the shared commit subjects.
    const h = await runAgent(dir, ["coupling", "a.ts", "b.ts"]);
    assertEquals(h.code, 0, h.output);
    assertStringIncludes(h.stdout, "Shared history of a.ts and b.ts");
    assertStringIncludes(h.stdout, "Changed together in 2");
    assertStringIncludes(h.stdout, "ab-decision");
    assertStringIncludes(h.stdout, "ab-again");
  });
});

Deno.test("prepare appends the coupling advisory only when [coupling].in_gate is on, and never changes pass/fail", async () => {
  await withTempDir(async (dir) => {
    await setup(dir, false); // in_gate off
    for (let i = 0; i < 4; i++) {
      await commit(dir, { "a.ts": `${i}`, "b.ts": `${i}` }, `ab${i}`);
    }
    await noise(dir, 6);
    await Deno.writeTextFile(join(dir, "a.ts"), "staged");

    // Explicitly disabled: the fast loop is green and carries no coupling advisory.
    const off = await prepareResult(dir);
    assertEquals(off.ok, true);
    assertLacksHint(off, HINTS["coupling-diff-header"]);

    // Flip it on — the SAME flag finish honours.
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        "",
        "[coupling]",
        "in_gate = true",
        "",
      ].join("\n"),
    );
    const on = await prepareResult(dir);
    assertEquals(
      on.ok,
      true,
      "the advisory must not change prepare's pass/fail",
    );
    const expectedHeader = assertHasHint(on, HINTS["coupling-diff-header"]);
    assertHasHint(on, HINTS["coupling-diff-partner"], {
      from: "a.ts",
      path: "b.ts",
      cochanges: 4,
      of: 4,
      confidence: 1,
    });
    // It rides at the TAIL, as in finish — the same diff-aware advisory, in the hot loop.
    const hints = on.hints ?? [];
    const idx = hints.indexOf(expectedHeader);
    assert(
      idx >= 0 && idx >= hints.length - 6,
      `coupling hints should sit at the tail: ${JSON.stringify(hints)}`,
    );
  });
});

Deno.test("prepare suppresses the coupling advisory until the install is bootstrapped", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: false });
    await gitInit(dir);
    // in_gate on, but not set up → coupling behaves as if disabled (the in-session
    // setup loop stays uncluttered), exactly as finish does.
    await writeConfig(
      dir,
      [
        "[meta]",
        "bootstrapped = false",
        "",
        "[project]",
        'slug = "engine-test"',
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

    const result = await prepareResult(dir);
    assertLacksHint(result, HINTS["coupling-diff-header"]);
  });
});
