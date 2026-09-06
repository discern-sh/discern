import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { z } from "@zod/zod";
import { fromFileUrl, join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { canaryCommandArgs } from "../scripts/canary_tests.ts";
import {
  effectiveTestSeed,
  explicitShuffleSeed,
  testCommandArgs,
  testSeedAnnouncement,
  testWorkerEnvironment,
} from "../scripts/run_tests.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";

const DenoTasksSchema = z.object({
  tasks: z.record(z.string(), z.string()).optional(),
});

const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));

const HOSTED_SUITE_MINIMUM_HEADROOM = 4 / 3;

/** Read the measured hosted full-suite duration recorded in the testing Map. */
function hostedSuiteRuntimeSeconds(testingMap: string): number {
  const match = testingMap.match(
    /Two ideal shards could cut ([0-9]+) minutes toward/u,
  );
  const minutes = Number(match?.[1]);
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    throw new TypeError(
      "project/map/80-development/testing.md must record the hosted full-suite runtime",
    );
  }
  return minutes * 60;
}

/** Require the configured watchdog to retain one-third measured headroom. */
function assertHostedSuiteFitsBudget(
  observedSeconds: number,
  timeoutSeconds: unknown,
): void {
  const minimum = Math.ceil(
    observedSeconds * HOSTED_SUITE_MINIMUM_HEADROOM,
  );
  assert(
    typeof timeoutSeconds === "number" && timeoutSeconds >= minimum,
    `the hosted suite needs at least ${minimum}s of test timeout, got ${timeoutSeconds}`,
  );
}

Deno.test("the repository admits parallel suites with a separate internal worker policy", async () => {
  const parsed = parseToml(
    await Deno.readTextFile(join(REPO_ROOT, "discern.toml")),
  );
  const gate = parsed.gate;
  assert(
    typeof gate === "object" && gate !== null && !Array.isArray(gate),
    "discern.toml must carry a [gate] table",
  );
  const cap = (gate as Record<string, unknown>).concurrent_test_runs;
  assert(
    typeof cap === "number" && cap >= 2,
    "the self-hosting suite must not serialize whole test runs",
  );

  const deno = decodeWith(
    DenoTasksSchema,
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  );
  const task = deno.tasks?.test ?? "";
  assertStringIncludes(task, "discern queue --");
  assertStringIncludes(task, "scripts/run_tests.ts");

  const source = await Deno.readTextFile(
    join(REPO_ROOT, "scripts/run_tests.ts"),
  );
  assertStringIncludes(
    source,
    "env: testWorkerEnvironment(Deno.build.os)",
  );
  assertStringIncludes(source, "runTestPartitions(args, count)");
  const canarySource = await Deno.readTextFile(
    join(REPO_ROOT, "scripts/canary_tests.ts"),
  );
  assertStringIncludes(
    canarySource,
    "env: testWorkerEnvironment(Deno.build.os)",
  );
  for (const os of ["darwin", "linux", "windows"] as const) {
    assertEquals(
      testWorkerEnvironment(os, { get: () => undefined }),
      os === "darwin" ? { DENO_JOBS: "3" } : {},
    );
    for (const supplied of ["1", "6", "18", "", "invalid"]) {
      assertEquals(testWorkerEnvironment(os, { get: () => supplied }), {
        DENO_JOBS: supplied,
      }, "explicit input remains Deno's decision");
    }
  }

  const forwarded = ["--filter", "probe"];
  const identitySeed = 314159;
  const args = testCommandArgs(identitySeed, forwarded);
  assert(args.includes("--parallel"), "Deno test files must run in parallel");
  assert(args.includes(`--shuffle=${identitySeed}`));
  assertEquals(args.slice(-forwarded.length), forwarded);

  const overridden = testCommandArgs(identitySeed, [
    "--shuffle=271828",
    ...forwarded,
  ]);
  assertEquals(overridden.filter((arg) => arg.startsWith("--shuffle=")), [
    "--shuffle=271828",
  ]);
  assertEquals(explicitShuffleSeed(["--shuffle=271828"]), 271828);
  assertEquals(effectiveTestSeed(identitySeed, ["--shuffle=271828"]), 271828);
  assertEquals(testSeedAnnouncement(271828), "Test shuffle seed: 271828");
  assertThrows(
    () => testCommandArgs(identitySeed, ["--shuffle"]),
    TypeError,
    "cannot be replayed",
  );

  const canaryFiles = ["tests/a_test.ts", "tests/b_test.ts"];
  const canary = canaryCommandArgs(identitySeed, canaryFiles, forwarded);
  assertEquals(
    canary.slice(-(forwarded.length + canaryFiles.length)),
    [...forwarded, ...canaryFiles],
    "the canary must forward caller arguments before its derived file set",
  );
});

Deno.test("seeded shuffle rejects a planted order-dependent fixture", async () => {
  await withTempDir(async (dir) => {
    const planted = join(REPO_ROOT, "tests/fixtures/order_dependent.ts");
    const fixture = join(dir, "order_dependent_test.ts");
    await Deno.writeTextFile(fixture, await Deno.readTextFile(planted));
    const ordered = await new Deno.Command(Deno.execPath(), {
      args: ["test", fixture],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(ordered.success, new TextDecoder().decode(ordered.stderr));

    const shuffled = await new Deno.Command(Deno.execPath(), {
      args: ["test", "--shuffle=2", fixture],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(!shuffled.success, "the unsafe fixture must fail under seed 2");
    const diagnostic = [shuffled.stdout, shuffled.stderr]
      .map((bytes) => new TextDecoder().decode(bytes))
      .join("\n");
    assertStringIncludes(
      diagnostic,
      "order-dependent fixture ran its reader before its writer",
    );
  });
});

Deno.test("hosted full-suite observations retain one-third timeout headroom", async () => {
  const testingMap = await Deno.readTextFile(
    join(REPO_ROOT, "project/map/80-development/testing.md"),
  );
  const observedSeconds = hostedSuiteRuntimeSeconds(testingMap);
  const config = parseToml(
    await Deno.readTextFile(join(REPO_ROOT, "discern.toml")),
  );
  const jobs = config.jobs;
  assert(
    typeof jobs === "object" && jobs !== null && !Array.isArray(jobs),
    "discern.toml must carry a [jobs] table",
  );
  const test = Reflect.get(jobs, "test");
  assert(
    typeof test === "object" && test !== null && !Array.isArray(test),
    "the self-hosting test job must use the timeout-bearing table form",
  );

  assertHostedSuiteFitsBudget(observedSeconds, Reflect.get(test, "timeout"));

  assertThrows(
    () => assertHostedSuiteFitsBudget(1_200, 1_599),
    Error,
    "needs at least 1600s",
  );
});
