/**
 * S04, S05, S07: doctor explains how the configured limits combine, what each
 * declared environment promises, which producers are shared, duplicated, or
 * candidate-bound, and what the durable completion records hold — without
 * changing any of them.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine, writeConfig } from "./engine_helpers.ts";
import { runChecks } from "../src/commands/doctor.ts";
import type { Check } from "../src/shared/result_schemas.ts";
import {
  COMPLETION_CLAIM,
  COMPLETION_DIGEST,
  COMPLETION_HEAD,
  COMPLETION_RECOVERY,
  COMPLETION_REQUIREMENT,
  COMPLETION_SOURCE,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";
import { RecoverySchema } from "../src/engine/completion/environment.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import {
  completionRecordPath,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

const PROJECT = '[project]\nslug = "doc"\nagents = []\nlogbook = false\n';
const ENVIRONMENT = (context = "local", prepare = "true"): string => `
[execution.${context}]
kind = "borrowed"
prepare = "${prepare}"
restore = "true"
reusable = true
resources = []
ignored = ["build/**"]
inputs = ["**"]
capacity = 1
`;

/** Scaffold one configured install and run doctor's checks in-process. */
async function checksFor(dir: string, toml: string): Promise<Check[]> {
  await scaffoldEngine(dir);
  await writeConfig(dir, PROJECT + toml);
  return await runChecks(dir);
}

/** Find one named check, failing loudly when doctor omitted it. */
function named(checks: readonly Check[], name: string): Check {
  const found = checks.find((check) => check.name === name);
  assert(found !== undefined, `expected a '${name}' check`);
  return found;
}

Deno.test("S05 doctor explains the combined limits and warns when positive lookahead cannot speculate", async () => {
  await withTempDir(async (dir) => {
    const checks = await checksFor(
      dir,
      `[completion]\nconcurrency = 1\nlookahead = 1\n[jobs]\ntest = "true"\n${ENVIRONMENT()}`,
    );
    const capacity = named(checks, "completion capacity");
    assertEquals(capacity.status, "warn");
    assertStringIncludes(capacity.detail, "reserved for the next effort");
    assertStringIncludes(capacity.fix ?? "", "`[completion].concurrency` to 2");
    const environment = named(checks, "execution environment: local");
    assertEquals(environment.status, "ok");
    assertStringIncludes(environment.detail, "borrowed checkout, capacity 1");
    assertStringIncludes(
      environment.detail,
      "a declaration alone is not that proof",
    );
  });
  await withTempDir(async (dir) => {
    const checks = await checksFor(
      dir,
      '[completion]\nconcurrency = 2\nlookahead = 1\n[jobs]\ntest = "true"\n',
    );
    const capacity = named(checks, "completion capacity");
    assertEquals(capacity.status, "warn");
    assertStringIncludes(
      capacity.detail,
      "early validation is not operational",
    );
    assertStringIncludes(capacity.fix ?? "", "`[execution.<context>]`");
  });
  await withTempDir(async (dir) => {
    const checks = await checksFor(
      dir,
      `[completion]\nconcurrency = 2\nlookahead = 1\n[gate]\nconcurrent_test_runs = 1\n[jobs]\ntest = "true"\n${ENVIRONMENT()}`,
    );
    const capacity = named(checks, "completion capacity");
    assertEquals(capacity.status, "ok");
    assertStringIncludes(
      capacity.detail,
      "`gate.concurrent_test_runs = 1` is the limit that binds",
    );
    assertStringIncludes(capacity.detail, "can be validated early");
  });
});

Deno.test("doctor flags an environment declared for an unrequired context and an unresolvable procedure", async () => {
  await withTempDir(async (dir) => {
    const checks = await checksFor(
      dir,
      `[jobs]\ntest = "true"\n${ENVIRONMENT("ci")}`,
    );
    const inert = named(checks, "execution environment: ci");
    assertEquals(inert.status, "warn");
    assertStringIncludes(
      inert.detail,
      "not one of [completion].required_contexts",
    );
    assertStringIncludes(inert.fix ?? "", "required_contexts");
  });
  await withTempDir(async (dir) => {
    const checks = await checksFor(
      dir,
      `[jobs]\ntest = "true"\n${
        ENVIRONMENT("local", "no-such-tool-for-doctor")
      }`,
    );
    const broken = named(checks, "execution environment: local");
    assertEquals(broken.status, "fail");
    assertStringIncludes(broken.detail, "prepare → no-such-tool-for-doctor");
    assertStringIncludes(broken.fix ?? "", "[execution.local]");
  });
});

Deno.test("S07 doctor names shared, duplicated, and candidate-bound producers with the remedy", async () => {
  await withTempDir(async (dir) => {
    const checks = await checksFor(
      dir,
      `[jobs]
lint = "deno lint"
test = { run = "deno test", inputs = ["src/**"] }
[standards.coverage]
producer = "jobs.test"
direction = "up"
limit = 90
`,
    );
    const coverage = named(checks, "producer coverage");
    assertEquals(coverage.status, "ok");
    assertStringIncludes(coverage.detail, "test supplies coverage");
    const reuse = named(checks, "evidence reuse");
    assertEquals(reuse.status, "ok");
    assertStringIncludes(reuse.detail, "candidate-bound: lint.");
    assertStringIncludes(reuse.detail, "Declare `inputs`");
    assertStringIncludes(reuse.detail, "protected change");
  });
  await withTempDir(async (dir) => {
    const checks = await checksFor(
      dir,
      `[jobs]
test = "deno test"
[standards.coverage]
run = "deno test"
direction = "up"
limit = 90
`,
    );
    const coverage = named(checks, "producer coverage");
    assertEquals(coverage.status, "warn");
    assertStringIncludes(coverage.detail, "the same work runs twice");
    assertStringIncludes(coverage.fix ?? "", 'producer = "jobs.<name>"');
  });
  await withTempDir(async (dir) => {
    const checks = await checksFor(
      dir,
      `[jobs]
test = "deno test"
[standards.coverage]
producer = "jobs.measure"
direction = "up"
limit = 90
`,
    );
    const coverage = named(checks, "producer coverage");
    assertEquals(coverage.status, "fail");
    assertStringIncludes(coverage.detail, "missing producer");
    assertStringIncludes(coverage.detail, "`discern done` would refuse");
  });
});

/** Write one canonical record into the fixture repository's completion store. */
async function record(dir: string, entry: CompletionRecord): Promise<void> {
  assertEquals((await writeCompletionRecord(dir, entry, null)).kind, "written");
}

/** Every completion record file with its bytes, for before/after equality. */
async function storedBytes(dir: string): Promise<Map<string, string>> {
  const anchor = await completionRecordPath(dir, {
    kind: "environment",
    id: completionId(5),
  });
  assert(anchor !== undefined);
  const store = dirname(dirname(anchor));
  const bytes = new Map<string, string>();
  const walk = async (path: string): Promise<void> => {
    for await (const entry of Deno.readDir(path)) {
      const child = join(path, entry.name);
      if (entry.isDirectory) await walk(child);
      else bytes.set(child, await Deno.readTextFile(child));
    }
  };
  await walk(store);
  return bytes;
}

Deno.test("S04 doctor reads stale leases, interrupted returns, claim gaps, retirement, and emergencies without changing a record", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `${PROJECT}[jobs]\ntest = "true"\n`);
    await Deno.writeTextFile(join(dir, "README.md"), "# fixture\n");
    await gitInit(dir);
    const fixtures = completionFixtures();
    const environment = fixtures.environment;
    assert(environment.kind === "environment");
    // A claim whose deadline has passed still occupies capacity.
    await record(dir, {
      ...environment,
      data: {
        ...environment.data,
        state: {
          kind: "executing",
          attempt_id: completionId(2),
          candidate_id: completionId(1),
          release_id: completionId(22),
          claim: COMPLETION_CLAIM,
          phase: "validate",
        },
      },
    });
    // A second environment stopped mid-return.
    await record(dir, {
      ...environment,
      id: completionId(12),
      data: {
        ...environment.data,
        path: "/workspace/effort-b",
        state: {
          kind: "recovery",
          attempt_id: completionId(2),
          recovery: RecoverySchema.parse(COMPLETION_RECOVERY),
        },
      },
    });
    // An active queue reservation with no live claim behind it.
    const queue = fixtures.queue;
    assert(queue.kind === "queue");
    const entry = queue.data.entries[0];
    assert(entry !== undefined);
    await record(dir, {
      ...queue,
      data: { ...queue.data, entries: [{ ...entry, state: "active" }] },
    });
    // Retirement the landing acceptance has not finished.
    await record(dir, fixtures.retirement);
    // An emergency landing with validation still outstanding.
    const landing = fixtures.landing;
    assert(landing.kind === "landing");
    await record(dir, {
      ...landing,
      data: {
        ...landing.data,
        claim: {
          kind: "exception",
          authorization_id: completionId(40),
          authorized_at: 40,
          actual_trunk: landing.data.expected_trunk,
          source: COMPLETION_SOURCE,
          candidate_id: completionId(1),
          candidate_head: COMPLETION_HEAD,
          policy: COMPLETION_DIGEST,
          reason: "Integrate the hotfix ahead of the suite",
          exceptions: [{
            requirement: COMPLETION_REQUIREMENT,
            state: "unrun",
            evidence_id: null,
          }],
        },
        outcome: {
          kind: "landed",
          at: 50,
          transition_marker: completionId(41),
        },
        authority_settlement: "consumed",
        note: "published",
      },
    });
    const before = await storedBytes(dir);

    const checks = await runChecks(dir);

    const records = named(checks, "completion records");
    assertEquals(records.status, "ok");
    assertStringIncludes(records.detail, "readable");
    // The recorded claim is observed, not read off its deadline: its checkout
    // path does not exist here, so ownership is unknown and nothing is assumed.
    const leases = named(checks, "execution leases");
    assertEquals(leases.status, "warn");
    assertStringIncludes(leases.detail, "observed live");
    assertStringIncludes(leases.detail, "/workspace/effort-a");
    assertStringIncludes(leases.detail, "ownership could not be observed");
    assertStringIncludes(leases.detail, "no longer exists");
    assertStringIncludes(
      leases.fix ?? "",
      "restore the recorded checkout path",
    );
    const recovery = named(checks, "checkout recovery");
    assertEquals(recovery.status, "warn");
    assertStringIncludes(recovery.detail, "stopped in restore");
    assertStringIncludes(recovery.detail, "restore command failed");
    assertStringIncludes(
      recovery.detail,
      "queue reservation for effort-a has no unexpired claim",
    );
    assertStringIncludes(recovery.fix ?? "", "without validating or landing");
    const retirement = named(checks, "landing retirement");
    assertEquals(retirement.status, "ok");
    assertStringIncludes(retirement.detail, "pending");
    const emergency = named(checks, "emergency validation");
    assertEquals(emergency.status, "warn");
    assertStringIncludes(emergency.detail, "validation outstanding");
    assertStringIncludes(emergency.fix ?? "", "discern done --rerun");

    assertEquals(
      await storedBytes(dir),
      before,
      "doctor must not write records",
    );
  });
});

Deno.test("doctor refuses to interpret a record written by a newer discern and routes to updating", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `${PROJECT}[jobs]\ntest = "true"\n`);
    await Deno.writeTextFile(join(dir, "README.md"), "# fixture\n");
    await gitInit(dir);
    const environment = completionFixtures().environment;
    await record(dir, environment);
    const newerPath = await completionRecordPath(dir, {
      kind: "environment",
      id: completionId(13),
    });
    assert(newerPath !== undefined);
    const newer = COMPLETION_FAMILIES.environment.schema.parse({
      ...environment,
      id: completionId(13),
    });
    await Deno.writeTextFile(
      newerPath,
      JSON.stringify({
        ...newer,
        version: ON_DISK_FORMATS.completionRecord.version + 1,
      }),
    );
    const checks = await runChecks(dir);
    const records = named(checks, "completion records");
    assertEquals(records.status, "fail");
    assertStringIncludes(records.detail, "written by a newer discern");
    assertStringIncludes(records.fix ?? "", "update discern");
    assert(
      !(records.fix ?? "").includes("discern upgrade"),
      "a newer record is a binary problem, not a config migration",
    );
  });
});
