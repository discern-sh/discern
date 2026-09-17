/**
 * S04, S05, S07: doctor explains which producers are shared, duplicated, or
 * candidate-bound, and what the durable completion records hold — without
 * changing any of them.
 */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { runChecks } from "../src/commands/doctor.ts";
import type { Check } from "../src/shared/result_schemas.ts";
import { completionFixtures, completionId } from "./completion_fixtures.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";
import {
  completionRecordPath,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

const PROJECT =
  '[project]\nslug = "doc"\nagents = []\nrecord_logbook = false\n';

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
test = { run = "deno test", inputs = ["src/**"] }
[standards.coverage]
run = "deno test"
direction = "up"
limit = 90
`,
    );
    const coverage = named(checks, "producer coverage");
    assertEquals(coverage.status, "warn");
    assertStringIncludes(
      coverage.detail,
      "matching commands require separate executions",
    );
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
    kind: "exception",
    id: completionId(6),
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

Deno.test("S04 doctor reads recorded exceptions with outstanding validation without changing a record", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, `${PROJECT}[jobs]\ntest = "true"\n`);
    await Deno.writeTextFile(join(dir, "README.md"), "# fixture\n");
    await gitInit(dir);
    const fixtures = completionFixtures();
    const exception = fixtures.exception;
    assert(exception.kind === "exception");
    // An emergency landing with validation still outstanding.
    await record(dir, {
      ...exception,
      data: {
        ...exception.data,
        outcome: { kind: "landed", at: 50 },
        note: "published",
      },
    });
    const before = await storedBytes(dir);

    const checks = await runChecks(dir);

    const records = named(checks, "completion records");
    assertEquals(records.status, "ok");
    assertStringIncludes(records.detail, "readable");
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
    const exception = completionFixtures().exception;
    await record(dir, exception);
    const newerPath = await completionRecordPath(dir, {
      kind: "exception",
      id: completionId(13),
    });
    assert(newerPath !== undefined);
    const newerBytes = JSON.stringify({
      ...exception,
      id: completionId(13),
      version: ON_DISK_FORMATS.completionRecord.version + 1,
    });
    await Deno.writeTextFile(newerPath, newerBytes);
    const checks = await runChecks(dir);
    const records = named(checks, "completion records");
    assertEquals(records.status, "fail");
    assertStringIncludes(records.detail, "written by a newer discern");
    assertStringIncludes(records.fix ?? "", "update discern");
    assert(
      !(records.fix ?? "").includes("discern upgrade"),
      "a newer record is a binary problem, not a config migration",
    );
    // Upgrade refuses to touch an install whose records it cannot read.
    const upgrade = await runAgent(dir, ["upgrade", "--json"]);
    assertEquals(upgrade.code, 1, upgrade.output);
    const refused = decodeCliResult(upgrade.stdout, "upgrade");
    assertEquals(refused.error, "schema_version_too_new");
    assertStringIncludes(refused.message ?? "", "written by a newer discern");
    assertEquals(
      await Deno.readTextFile(newerPath),
      newerBytes,
      "the newer record is preserved byte for byte",
    );
  });
});
