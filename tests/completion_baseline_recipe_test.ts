import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
/** Count the repository recipe through the landed producer and artifact runtime. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { produceCoverage } from "../scripts/coverage.ts";
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

/** Seed a two-isolate instrumented suite, a local build, and artifact extraction. */
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
import { lcovReportArgs } from ${repositoryModule("scripts/coverage_lib.ts")};
const root = Deno.cwd();
const lcov = await produceCoverage(root, async (profile) => {
  await Deno.writeTextFile('suite-attempts', '1', { append: true });
  const suite = await new Deno.Command(Deno.execPath(), {
    args: testCommandArgs(42, ['tests', '--coverage=' + profile, '--coverage-raw-data-only']),
    stdout: 'inherit', stderr: 'inherit',
  }).output();
  const reference = await new Deno.Command(Deno.execPath(), {
    args: lcovReportArgs(profile, root), stdout: 'piped', stderr: 'inherit',
  }).output();
  if (!reference.success) throw new Error('reference report failed');
  await Deno.mkdir('reports', { recursive: true });
  await Deno.writeFile('reports/unsharded.lcov', reference.stdout);
  await Deno.writeTextFile('reports/profile-path', profile);
  if (!suite.success) throw new Error('instrumented fixture failed');
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
        context: "local",
        definition: COMPLETION_DIGEST,
      },
      input: { producer: "jobs.test" },
    },
    ...consumers.map(([name, standard]): ObligationDeclaration => ({
      requirement: {
        kind: "standard",
        id: name,
        context: "local",
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
    const snap = await snapshot({
      candidate: {
        ...baseline.candidate,
        attempt_id: completionId(101),
        head: await gitOut(root, "rev-parse", "HEAD"),
        tree: await gitOut(root, "rev-parse", "HEAD^{tree}"),
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
      context: "local",
      mode: "strict",
      requirements: snap.requirements,
    }, snap.candidate_id);
    assertEquals(plan.blockers, []);
    assertEquals(plan.producers.length, 2);
    const fake = claimed(snap, plan);
    const execution = {
      ...fake,
      environment: { ...fake.environment, path: root },
    };
    for (
      const [kind, id, data] of [
        ["attempt", execution.attempt.identity.id, execution.attempt],
        ["environment", execution.environment_id, execution.environment],
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
