import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { candidateAuthor } from "../src/engine/completion/candidate.ts";
/** Count the repository recipe through the landed producer and artifact runtime. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { basename, dirname, join, toFileUrl } from "@std/path";
import { produceCoverage } from "../scripts/coverage.ts";
import {
  type ProfileShardingSummary,
  pruneAndShardProfiles,
  RawCoverageProfileSchema,
} from "../scripts/coverage_profiles.ts";
import { runTestPartitions } from "../scripts/test_partitions.ts";
import { testCommandArgs } from "../scripts/run_tests.ts";
import { lcovReportArgs } from "../scripts/coverage_lib.ts";
import { decodeWith } from "./decode_cli_result.ts";
import {
  processAllowance,
  settlePending,
  waitForPendingCondition,
} from "./waiting.ts";
import { runShell } from "../src/shared/subprocess.ts";
import { srcLineCoverage } from "../scripts/coverage_lib.ts";
import { sourceModuleUniverse } from "../scripts/source_module_universe.ts";
import { MODULE_COVERAGE_EXCEPTIONS } from "../scripts/module_coverage_exceptions.ts";
import { ProducerDeclarationSchema } from "../src/shared/config_schema.ts";
import { CompletionRecordSchema } from "../src/engine/completion/records.ts";
import { writeCompletionRecord } from "../src/engine/completion/store.ts";
import type { ObligationDeclaration } from "../src/engine/validation/catalog.ts";
import { createProducerEvaluator } from "../src/engine/validation/evaluator.ts";
import {
  auditArtifacts,
  readArtifact,
} from "../src/engine/validation/artifacts.ts";
import {
  createValidationRuntime,
  observeCompletionRecords,
  observeValidationInputs,
} from "../src/engine/validation/runtime.ts";
import { quoteCommandWord } from "../src/shared/command_evidence.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { COMPLETION_DIGEST } from "./completion_fixtures.ts";
import {
  claimed,
  COMPLETION_CLOCK,
  completionId,
  CONDITIONS,
  snapshot,
} from "./completion_producers_fixtures.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

/** Point fixture drivers at actual repository modules without copying their implementation. */
function repositoryModule(path: string): string {
  return JSON.stringify(toFileUrl(join(REPO_ROOT, path)).href);
}

/** Keep command quoting at the existing single-word authority. */
function fixtureCommand(file: string): string {
  return [
    Deno.execPath(),
    "run",
    "-A",
    "--config",
    join(REPO_ROOT, "deno.json"),
    file,
  ]
    .map(quoteCommandWord).join(" ");
}

/** Ignore record ordering while retaining every LCOV count and coordinate. */
function canonicalLcov(text: string): string[] {
  return text.split("end_of_record").map((record) =>
    record.trim().split("\n").sort().join("\n")
  ).filter(Boolean).sort();
}

/** Seed a two-partition instrumented suite, a local build, and artifact extraction. */
async function seedRecipe(root: string): Promise<void> {
  await Deno.mkdir(join(root, "src"));
  await Deno.mkdir(join(root, "tests"));
  await Deno.writeTextFile(
    join(root, ".gitignore"),
    "reports/\ndist/\nsuite-attempts\nbuild-attempts\nextract-attempts\n",
  );
  await Deno.writeTextFile(
    join(root, "deno.json"),
    JSON.stringify({
      tasks: { build: "deno run --allow-read --allow-write build.ts" },
    }),
  );
  await Deno.writeTextFile(
    join(root, "src", "decision.ts"),
    "export function decision(value: boolean): number {\n  if (value) return 1;\n  return 2;\n}\n",
  );
  for (const [index, value] of [true, false].entries()) {
    await Deno.writeTextFile(
      join(root, "tests", `branch_${index}_test.ts`),
      `import { decision } from '../src/decision.ts';\nDeno.test('branch ${index}', () => { if (decision(${value}) !== ${
        index + 1
      }) throw new Error('wrong branch'); });\n`,
    );
  }
  await Deno.writeTextFile(
    join(root, "producer.ts"),
    `
import { produceCoverage, writeCoverageArtifact } from ${
      repositoryModule("scripts/coverage.ts")
    };
import { testCommandArgs } from ${repositoryModule("scripts/run_tests.ts")};
import { runTestPartitions } from ${
      repositoryModule("scripts/test_partitions.ts")
    };
import { RawCoverageProfileSchema } from ${
      repositoryModule("scripts/coverage_profiles.ts")
    };
import { decodeWith } from ${repositoryModule("tests/decode_cli_result.ts")};
import { lcovReportArgs } from ${repositoryModule("scripts/coverage_lib.ts")};
const root = Deno.cwd();
const lcov = await produceCoverage(root, async (profile) => {
  await Deno.writeTextFile('suite-attempts', '1', { append: true });
  const suite = await runTestPartitions(testCommandArgs(42, ['--reporter=junit', '--coverage=' + profile, '--coverage-raw-data-only']), 2, {
    cwd: root,
    seed: 42,
    priority: () => Promise.resolve({ files: ['tests/branch_1_test.ts'], excluded: [], moduleCount: 2 }),
  });
  if ((suite.report?.match(/<testcase\\b/g) ?? []).length !== 2) throw new Error('each instrumented case must execute exactly once');
  const profileNames = [];
  const directories = [profile];
  for (const directory of directories) {
    for await (const entry of Deno.readDir(directory)) {
      const path = directory + '/' + entry.name;
      if (entry.isDirectory) directories.push(path);
      else if (entry.isFile && entry.name.endsWith('.json')) profileNames.push(path);
    }
  }
  for (const name of profileNames) {
    const raw = decodeWith(RawCoverageProfileSchema, await Deno.readTextFile(name));
    if (typeof raw.url !== 'string' || !raw.url.startsWith('file://' + root + '/src/')) continue;
    for (const copy of [1, 2, 3]) await Deno.copyFile(name, name + '-copy-' + copy + '.json');
  }
  const reference = await new Deno.Command(Deno.execPath(), {
    args: lcovReportArgs(profile, root), stdout: 'piped', stderr: 'inherit',
  }).output();
  if (!reference.success) throw new Error('reference report failed');
  await Deno.mkdir('reports', { recursive: true });
  await Deno.writeFile('reports/unsharded.lcov', reference.stdout);
  await Deno.writeTextFile('reports/profile-path', profile);
  if (suite.code !== 0) throw new Error('instrumented fixture failed');
});
await writeCoverageArtifact(root, 'reports/coverage.lcov', lcov);
`,
  );
  await Deno.writeTextFile(
    join(root, "extractor.ts"),
    `
import { coverageReadings } from ${repositoryModule("scripts/coverage.ts")};
await Deno.writeTextFile('extract-attempts', '1', { append: true });
console.log(await coverageReadings(await new Response(Deno.stdin.readable).text(), Deno.cwd()));
`,
  );
  await Deno.writeTextFile(
    join(root, "build.ts"),
    `
await Deno.writeTextFile('build-attempts', '1', { append: true });
await Deno.mkdir('dist', { recursive: true });
await Deno.writeFile('dist/discern-x86_64-unknown-linux-gnu', new Uint8Array(137));
`,
  );
  await Deno.writeTextFile(
    join(root, "binary.ts"),
    `
import { measureBinarySize } from ${repositoryModule("scripts/binary_size.ts")};
console.log('DISCERN_METRIC binary_size_bytes ' + await measureBinarySize('x86_64-unknown-linux-gnu', Deno.cwd()));
`,
  );
  await gitInit(root);
}

/** Use live coverage consumers and ceilings, preserving their independent verdicts. */
async function recipeObligations(): Promise<ObligationDeclaration[]> {
  const cfg = await loadConfig(REPO_ROOT);
  const consumers = [
    "coverage",
    "module_coverage",
    "module_coverage_exceptions",
    "binary_size",
  ].map((name) => {
    const standard = cfg.standards[name];
    assert(standard !== undefined, `missing repository standard ${name}`);
    return [name, standard] as const;
  });
  return [
    {
      requirement: {
        kind: "job",
        id: "test",
        definition: COMPLETION_DIGEST,
      },
      input: { producer: "jobs.test" },
    },
    ...consumers.map(([name, standard]): ObligationDeclaration => ({
      requirement: {
        kind: "standard",
        id: name,
        definition: COMPLETION_DIGEST,
      },
      input: name === "binary_size" ? { run: fixtureCommand("binary.ts") } : {
        producer: "jobs.test",
        artifact: "reports/coverage.lcov",
        extract: fixtureCommand("extractor.ts"),
      },
      standard: {
        name,
        metric: standard.metric ?? name,
        direction: standard.direction,
        limit: standard.limit,
        scale: 1,
      },
      inputs: ["**"],
    })),
  ];
}

Deno.test("E08 E16: one demanded instrumented suite supplies every coverage consumer and one local build supplies size", async () => {
  await withTempDir(async (root) => {
    await seedRecipe(root);
    const baseline = await snapshot();
    const declarations = await recipeObligations();
    const head = await gitOut(root, "rev-parse", "HEAD");
    const tree = await gitOut(root, "rev-parse", "HEAD^{tree}");
    const snap = await snapshot({
      candidate: {
        ...baseline.candidate,
        attempt_id: completionId(101),
        head,
        tree,
        sources: [{ ...candidateAuthor(baseline.candidate), head, tree }],
      },
      producers: {
        "jobs.test": ProducerDeclarationSchema.parse({
          run: fixtureCommand("producer.ts"),
          artifacts: ["reports/coverage.lcov"],
          inputs: ["**"],
        }),
      },
      obligations: declarations,
      inputs: await observeValidationInputs(root),
    });
    const conditions = CONDITIONS[0];
    assert(conditions !== undefined);
    const runtime = createValidationRuntime({
      root,
      conditions,
      environment: { MODE: "test" },
      inheritedEnvironment: { get: () => undefined },
      timeout: 180,
      verifyConditions: () => Promise.resolve(),
      clock: COMPLETION_CLOCK,
    });
    const evaluator = createProducerEvaluator({
      snapshot: snap,
      root,
      runtime,
      clock: COMPLETION_CLOCK,
      observe: () => observeCompletionRecords(root, COMPLETION_CLOCK),
    });
    const observation = await evaluator.observe(snap.candidate_id);
    const plan = evaluator.plan(observation, {
      kind: "done",
      mode: "strict",
      requirements: snap.requirements,
    }, snap.candidate_id);
    assertEquals(plan.blockers, []);
    assertEquals(plan.producers.length, 2);
    const fake = claimed(snap, plan);
    const execution = { ...fake, path: root };
    for (
      const [kind, id, data] of [
        ["attempt", execution.attempt.identity.id, execution.attempt],
        ["candidate", snap.candidate_id, snap.candidate],
      ] as const
    ) {
      const record = CompletionRecordSchema.parse({
        version: ON_DISK_FORMATS.completionRecord.version,
        revision: 1,
        kind,
        id,
        data,
      });
      assertEquals(
        (await writeCompletionRecord(
          root,
          record,
          null,
          kind === "candidate" ? execution.fence : undefined,
          COMPLETION_CLOCK,
        )).kind,
        "written",
      );
    }
    const result = await evaluator.execute(plan, execution);
    assertEquals(await Deno.readTextFile(join(root, "suite-attempts")), "1");
    assertEquals(await Deno.readTextFile(join(root, "build-attempts")), "1");
    assertEquals(
      await Deno.readTextFile(join(root, "extract-attempts")),
      "111",
    );
    assertEquals(result.evidence.length, declarations.length);
    for (const component of result.evidence) {
      assertEquals(
        component.outcome.kind,
        "passed",
        JSON.stringify(component.outcome),
      );
    }
    const coverage = result.evidence.find((e) =>
      e.outcome.kind === "passed" && e.outcome.metrics.coverage !== undefined
    );
    assert(coverage?.outcome.kind === "passed");
    assertEquals(coverage.outcome.metrics.coverage, 100);
    assert(
      result.evidence.some((e) =>
        e.outcome.kind === "passed" &&
        e.outcome.metrics.binary_size_bytes === 137
      ),
    );
    // This small repository has no legacy debts. Missing registered modules
    // remain failures, demonstrating that the recipe preserves the measured set.
    assertEquals(
      coverage.outcome.metrics.module_coverage_failures,
      MODULE_COVERAGE_EXCEPTIONS.length,
    );
    assertEquals(
      coverage.outcome.metrics.module_coverage_exceptions,
      MODULE_COVERAGE_EXCEPTIONS.length,
    );
    assertEquals(
      result.blockers.length,
      1,
      "the actual zero module-failure ceiling still applies",
    );
    const artifact = coverage.artifacts.find((a) =>
      a.path === "reports/coverage.lcov"
    );
    assert(artifact !== undefined);
    const lcov = new TextDecoder().decode(await readArtifact(root, artifact));
    const modules = await sourceModuleUniverse(root);
    const unsharded = await Deno.readTextFile(
      join(root, "reports/unsharded.lcov"),
    );
    assertEquals(canonicalLcov(lcov), canonicalLcov(unsharded));
    assertEquals(
      srcLineCoverage(lcov, root, modules),
      srcLineCoverage(
        await Deno.readTextFile(join(root, "reports/unsharded.lcov")),
        root,
        modules,
      ),
    );
    await Deno.writeTextFile(
      join(root, "reports/coverage.lcov"),
      "replacement is not evidence",
    );
    assertEquals(
      new TextDecoder().decode(await readArtifact(root, artifact)),
      lcov,
    );
    assert((await auditArtifacts(root, result.evidence)).size > 0);
    assertEquals(
      await pathExists(
        await Deno.readTextFile(join(root, "reports/profile-path")),
      ),
      false,
    );
  });
});

Deno.test("a failed instrumented suite cleans its scratch before returning failure", async () => {
  let profile = "";
  await assertRejects(
    () =>
      produceCoverage(REPO_ROOT, (path) => {
        profile = path;
        return Promise.reject(new Error("suite failed"));
      }),
    Error,
    "suite failed",
  );
  assert(profile !== "");
  assertEquals(await pathExists(profile), false);
});

Deno.test("failed coverage reporting removes its profile scratch before rejecting", async () => {
  let profilePath = "";
  await assertRejects(
    () =>
      produceCoverage(REPO_ROOT, async (profile) => {
        profilePath = profile;
        await Deno.writeTextFile(
          join(profile, "invalid.json"),
          "unreadable raw coverage",
        );
      }),
    AggregateError,
    "every shard settled",
  );
  assert(profilePath !== "");
  assertEquals(await pathExists(profilePath), false);
});

Deno.test("a failed suite reports coverage gaps before cleanup without publishing evidence", async () => {
  await withTempDir(async (root) => {
    await seedRecipe(root);
    await Deno.writeTextFile(
      join(root, "tests/branch_1_test.ts"),
      "Deno.test('failed branch', () => { throw new Error('branch failure'); });\n",
    );
    const result = await runShell(fixtureCommand("producer.ts"), { cwd: root });
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(result.success, false, stderr);
    assertStringIncludes(stderr, "instrumented fixture failed");
    assertStringIncludes(
      stderr,
      "Coverage from the failed suite is diagnostic only",
    );
    assertStringIncludes(stderr, "All measured src/ files");
    assertStringIncludes(stderr, "MODULE COVERAGE: Module 'src/decision.ts'");
    assertEquals(stdout.includes("DISCERN_METRIC"), false);
    assertEquals(stderr.includes("DISCERN_METRIC"), false);
    assertEquals(await Deno.readTextFile(join(root, "suite-attempts")), "1");
    assertEquals(await pathExists(join(root, "reports/coverage.lcov")), false);
    assertEquals(
      await pathExists(
        await Deno.readTextFile(join(root, "reports/profile-path")),
      ),
      false,
    );
  });
});

Deno.test("a successful suite without reportable profiles cannot publish coverage", async () => {
  let profile = "";
  await assertRejects(
    () =>
      produceCoverage(REPO_ROOT, (path) => {
        profile = path;
        return Promise.resolve();
      }),
    Error,
    "no reportable coverage",
  );
  assertEquals(await pathExists(profile), false);
});

Deno.test({
  name:
    "coverage overlaps settled native partitions and preserves every native observation",
  // Early processing requires the owned POSIX process-group boundary.
  ignore: Deno.build.os === "windows" || Deno.stdin.isTerminal(),
  fn: async () => {
    const allowance = processAllowance();
    for (
      const variant of [
        { budget: 128 * 1024 * 1024, opaque: false },
        { budget: 128 * 1024 * 1024, opaque: true },
      ]
    ) {
      await withTempDir(async (directory) => {
        const root = await Deno.realPath(directory);
        await Deno.mkdir(join(root, "src"));
        await Deno.writeTextFile(
          join(root, "src/choose.ts"),
          "export function choose(n: number): number {\n  if (n > 0) {\n    if (n > 1) return 2;\n    return 1;\n  }\n  return 0;\n}\n",
        );
        await Deno.writeTextFile(
          join(root, "fast_test.ts"),
          "import {choose} from './src/choose.ts';\nDeno.test('fast branches', () => { choose(1); choose(2); });\n",
        );
        await Deno.writeTextFile(
          join(root, "slow_test.ts"),
          `import { waitForPath } from ${repositoryModule("tests/waiting.ts")};
import {choose} from './src/choose.ts';
Deno.test('late branch', async () => {
  await waitForPath('processing-started');
  choose(0);
});\n`,
        );
        const reference = join(root, "reference");
        const controller = new AbortController();
        let processingStarted = false;
        let duplicate: Uint8Array | undefined;
        let profilePath = "";
        let attempts = 0;
        let opaqueObserved = false;
        const settlements: boolean[] = [];
        const pending = produceCoverage(root, async (profile, controls) => {
          attempts++;
          profilePath = profile;
          const suite = await runTestPartitions(
            testCommandArgs(42, [
              "--no-config",
              "--no-lock",
              "--no-check",
              "--reporter=junit",
              `--coverage=${profile}`,
              "--coverage-raw-data-only",
              root,
            ]),
            2,
            {
              cwd: root,
              seed: 42,
              concurrency: 2,
              signal: controls.signal,
              coveragePartitions: {
                started(count): void {
                  controls.coveragePartitions.started(count);
                },
                settled(index): void {
                  settlements.push(processingStarted);
                  controls.coveragePartitions.settled(index);
                },
              },
            },
          );
          assertEquals(suite.code, 0);
          assertEquals(suite.selection, "complete");
          assertEquals((suite.report?.match(/<testcase\b/g) ?? []).length, 2);
        }, {
          signal: controller.signal,
          processProfiles: async (
            path,
            prefix,
            shards,
          ): Promise<ProfileShardingSummary> => {
            if (basename(path).startsWith("test-shard-")) {
              const copy = join(reference, basename(path));
              await Deno.mkdir(copy, { recursive: true });
              const inputs: { name: string; bytes: Uint8Array }[] = [];
              for await (const entry of Deno.readDir(path)) {
                if (!entry.isFile || !entry.name.endsWith(".json")) continue;
                const bytes = await Deno.readFile(join(path, entry.name));
                inputs.push({ name: entry.name, bytes });
                const raw = decodeWith(
                  RawCoverageProfileSchema,
                  new TextDecoder().decode(bytes),
                );
                if (raw.url.startsWith(prefix)) duplicate ??= bytes;
              }
              assert(duplicate !== undefined);
              // Equal basenames and byte-identical observations cross partitions.
              let collision = duplicate;
              if (variant.opaque) {
                const { url, ...rest } = decodeWith(
                  RawCoverageProfileSchema,
                  new TextDecoder().decode(duplicate),
                );
                collision = new TextEncoder().encode(
                  JSON.stringify({ url, ...rest }),
                );
              }
              await Deno.writeFile(join(path, "collision.json"), collision);
              inputs.push({ name: "collision.json", bytes: collision });
              for (const input of inputs) {
                await Deno.writeFile(join(copy, input.name), input.bytes);
              }
              processingStarted = true;
              await Deno.writeTextFile(
                join(root, "processing-started"),
                "ready",
              );
            }
            const result = await pruneAndShardProfiles(
              path,
              prefix,
              shards,
              4,
              variant.budget,
            );
            opaqueObserved ||= result.opaque > 0;
            return result;
          },
        });
        let lcov: string;
        try {
          await waitForPendingCondition(
            pending,
            () => processingStarted,
            "coverage processing to release the unfinished native partition",
            { allowance },
          );
          lcov = await settlePending(
            pending,
            "overlapped native coverage to finish",
            { allowance },
          );
        } finally {
          controller.abort();
          await Promise.allSettled([pending]);
        }
        assertEquals(attempts, 1);
        assertEquals(settlements, [false, true]);
        assertEquals(opaqueObserved, variant.opaque);
        assertEquals(await pathExists(profilePath), false);
        assertEquals(await pathExists(dirname(profilePath)), false);
        const native = await new Deno.Command(Deno.execPath(), {
          args: lcovReportArgs(reference, root),
          cwd: root,
          stdout: "piped",
          stderr: "inherit",
        }).output();
        assert(native.success);
        assertEquals(
          canonicalLcov(lcov),
          canonicalLcov(new TextDecoder().decode(native.stdout)),
        );
      });
    }
  },
});

Deno.test("coverage producer drains active processing before failure or cancellation removes scratch", async () => {
  for (const cancel of [false, true]) {
    const allowance = processAllowance();
    const controller = new AbortController();
    const release = Promise.withResolvers<void>();
    let entered = false;
    let exited = false;
    let returned = false;
    let calls = 0;
    let raw = "";
    const pending = produceCoverage(REPO_ROOT, (profile, controls) => {
      raw = profile;
      controls.coveragePartitions.started(2);
      controls.coveragePartitions.settled(1);
      controls.coveragePartitions.settled(2);
      return Promise.resolve();
    }, {
      signal: controller.signal,
      processProfiles: async (directory, prefix, shards) => {
        calls++;
        entered = true;
        await release.promise;
        // The producer must keep the directory alive for all active IO.
        await Deno.writeTextFile(join(directory, "active-io-finished"), "yes");
        exited = true;
        if (!cancel) throw new Error("injected profile processing failure");
        return await pruneAndShardProfiles(directory, prefix, shards);
      },
    }).then(
      () => {
        returned = true;
        return { kind: "success" as const };
      },
      (error: unknown) => {
        returned = true;
        return { kind: "failure" as const, error };
      },
    );
    try {
      await waitForPendingCondition(
        pending,
        () => entered,
        "active coverage processing",
        { allowance },
      );
      if (cancel) controller.abort();
      await Promise.resolve();
      assertEquals(returned, false);
      assertEquals(exited, false);
      assertEquals(await pathExists(raw), true);
    } finally {
      release.resolve();
      await Promise.allSettled([pending]);
    }
    const result = await settlePending(
      pending,
      "coverage cleanup after processing",
      { allowance },
    );
    assertEquals(result.kind, "failure");
    assert(result.kind === "failure");
    assert(
      cancel
        ? result.error instanceof DOMException
        : result.error instanceof AggregateError,
    );
    assertEquals(calls, 1);
    assertEquals(exited, true);
    assertEquals(await pathExists(raw), false);
    assertEquals(await pathExists(dirname(raw)), false);
  }
});
