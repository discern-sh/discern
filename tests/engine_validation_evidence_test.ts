/** Black-box validation-evidence boundary and recorder integration tests. */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  parseLogbookLine,
  type VerbEvent,
} from "../src/engine/logbook/schema.ts";
import {
  VALIDATION_RUNS,
  validationEvidence,
} from "../src/engine/logbook/validation.ts";
import { captureValidationStart } from "../src/engine/logbook/validation_state.ts";
import { finishResult } from "../src/engine/gate/finish.ts";
import { checkTestGroups } from "../src/engine/gate/plan.ts";
import {
  runTool,
  TOOLS,
  verbOf,
  WorkingRoot,
} from "../src/engine/mcp/server.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

/** Read completed verb events from the single current-month fixture log. */
async function completedEvents(dir: string): Promise<VerbEvent[]> {
  const logDir = join(dir, ".git", "discern", "logbook");
  const events: VerbEvent[] = [];
  for await (const entry of Deno.readDir(logDir)) {
    if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
    const lines = (await Deno.readTextFile(join(logDir, entry.name)))
      .split("\n").filter((line) => line !== "");
    for (const line of lines) {
      const parsed = parseLogbookLine(line);
      assert(parsed.kind === "event");
      if (parsed.event.kind === "verb") events.push(parsed.event);
    }
  }
  return events;
}

Deno.test("standalone test records pass/fail outcomes and concurrent execution without widening result JSON", async () => {
  for (const fails of [false, true]) {
    await withTempDir(async (dir) => {
      await scaffoldEngine(dir);
      const sibling = fails ? "tail -f /dev/null" : "true";
      await writeConfig(
        dir,
        `[project]\nslug = "evidence-fixture"\n[jobs]\ntest = "${
          fails ? "false" : "true"
        }"\n[jobs.sibling]\nstage = "test"\nrun = "${sibling}"\n`,
      );
      await gitInit(dir);
      const run = await runAgent(dir, ["test", "--json"]);
      assertEquals(run.code, fails ? 1 : 0, run.output);
      const publicResult = decodeCliResult(run.stdout, "test");
      assertEquals(
        "validation" in publicResult ? publicResult.validation : undefined,
        undefined,
      );

      const events = (await completedEvents(dir)).filter((event) =>
        event.verb === "test"
      );
      assertEquals(events.length, 1);
      const validation = events[0]?.validation;
      assert(validation !== undefined);
      assert(validation.state.complete);
      assert(validation.state.digest !== undefined);
      assertEquals(validation.state.capture, "before-test-group");
      assertEquals(validation.execution.mode, "standalone-test");
      assert(validation.execution.complete);
      assertEquals(validation.execution.jobs.length, 2);
      assert(
        validation.execution.jobs.every((job) => job.concurrent_siblings),
      );
      assertEquals(
        validation.execution.jobs.map((job) => job.outcome),
        fails ? ["failed", "cancelled"] : ["passed", "passed"],
      );
    });
  }
});

Deno.test("done captures after mutating fix/build and before concurrent check/test", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await Deno.writeTextFile(join(dir, "subject.txt"), "committed\n");
    await writeConfig(
      dir,
      `[project]\nslug = "evidence-fixture"\n[jobs]
format = "printf 'fixed\\n' > subject.txt"
build = "printf 'built\\n' > subject.txt"
lint = "true"
test = "true"

[gate]
concurrent_test_runs = 0
`,
    );
    await gitInit(dir);
    // Explicit standalone feedback permits this known-dirty path to be
    // rewritten by fix/build without the clean-tree strand checkpoint.
    await Deno.writeTextFile(join(dir, "subject.txt"), "before gate\n");

    const run = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(run.code, 0, run.output);
    assertEquals(await Deno.readTextFile(join(dir, "subject.txt")), "built\n");
    const event = (await completedEvents(dir)).find((candidate) =>
      candidate.verb === "done"
    );
    const validation = event?.validation;
    assert(validation !== undefined);
    assertEquals(validation.state.capture, "after-fix-build");
    assertEquals(validation.execution.mode, "full-gate");
    assertEquals(
      validation.execution.jobs.map((job) => [
        job.id,
        job.stage,
        job.outcome,
        job.concurrent_siblings,
      ]),
      [
        ["lint", "check", "passed", true],
        ["test", "test", "passed", true],
      ],
    );

    // A direct capture over the post-build tree must name the same state. This
    // would fail if `done` sampled invocation-start state before its fix/build.
    const cfg = await loadConfig(dir);
    const postBuild = await captureValidationStart(
      dir,
      cfg,
      VALIDATION_RUNS.done,
      checkTestGroups(cfg),
    );
    assert(validation.state.complete, JSON.stringify(validation.state));
    assert(postBuild.state.complete, JSON.stringify(postBuild.state));
    assertEquals(validation.state.digest, postBuild.state.digest);
  });
});

Deno.test("failing done records the failed test job and cancelled sibling measurement without a false verdict", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[project]\nslug = "evidence-fixture"\n[jobs]\nlint = "tail -f /dev/null"\ntest = "false"\n\n[gate]\nconcurrent_test_runs = 0\n
[standards.sibling_metric]
producer = "jobs.lint"
metric = "value"
direction = "up"
limit = 0
`,
    );
    await gitInit(dir);

    const run = await runAgent(dir, ["done", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = decodeCliResult(run.stdout, "done");
    assert(result.data !== undefined && "standards" in result.data, run.output);
    const reading = result.data.standards?.find((entry) =>
      entry.name === "sibling_metric"
    );
    assertEquals(reading?.measurement, "cancelled", run.output);
    assertEquals(reading?.value, undefined);
    assertEquals(reading?.verdict, undefined);
    const step = result.steps?.find((entry) =>
      entry.label === "standard:sibling_metric"
    );
    assertEquals(step?.outcome, "cancelled", run.output);
    const event = (await completedEvents(dir)).find((candidate) =>
      candidate.verb === "done"
    );
    const validation = event?.validation;
    assert(validation !== undefined);
    assert(validation.state.complete);
    assertEquals(validation.execution.mode, "full-gate");
    assertEquals(
      validation.execution.jobs.map((job) => [job.id, job.outcome]),
      [["lint", "cancelled"], ["test", "failed"], [
        "standard:sibling_metric",
        "cancelled",
      ]],
    );
  });
});

Deno.test("validation-key failure records incompleteness and cannot change a passing verdict", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[project]\nslug = "evidence-fixture"\n[jobs]\ntest = "true"\n`,
    );
    await gitInit(dir);
    const key = await gitAdminStatePath(dir, "validationHmacKey");
    assert(key !== undefined);
    await Deno.mkdir(join(dir, ".git", "discern"), { recursive: true });
    await Deno.writeTextFile(key, "not-a-valid-key");

    const run = await runAgent(dir, ["test", "--json"]);
    assertEquals(run.code, 0, run.output);
    const event = (await completedEvents(dir)).find((candidate) =>
      candidate.verb === "test"
    );
    assertEquals(event?.outcome, "ok");
    assertEquals(event?.validation?.state.complete, false);
    assertEquals(event?.validation?.state.digest, undefined);
    assert(
      event?.validation?.state.incomplete?.some((entry) =>
        entry.category === "key" && entry.reason === "invalid"
      ),
    );
  });
});

Deno.test("a stalled validation dependency cannot delay or replace the Gate verdict", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[project]\nslug = "evidence-fixture"\n[jobs]\ntest = "false"\n`,
    );
    await gitInit(dir);
    const cfg = await loadConfig(dir);
    const validationCaptureOptions = {
      limits: { timeMs: 20 },
      keyProvider: () => new Promise<never>(() => {}),
    };
    const directCapture = await captureValidationStart(
      dir,
      cfg,
      VALIDATION_RUNS.done,
      checkTestGroups(cfg),
      validationCaptureOptions,
    );
    assert(
      directCapture.state.incomplete?.some((entry) =>
        entry.category === "budget" && entry.reason === "time-limit"
      ),
    );
    const result = await finishResult(dir, {
      surface: { kind: "quiet" },
      cliModel: TEST_CLI_MODEL,
      rerun: true,
      validationCaptureOptions,
    });
    assertEquals(result.ok, false);
    assertEquals(result.data?.failed_stage, "test");
    const validation = validationEvidence(result);
    assert(validation !== undefined);
    assertEquals(validation.state.complete, false);
    assert(
      validation.state.incomplete?.some((entry) =>
        entry.category === "budget" && entry.reason === "time-limit"
      ),
    );
    assert(
      result.steps?.some((step) => step.outcome === "failed"),
      "the real failed job must remain in the Gate result",
    );
  });
});

Deno.test("MCP preserves recorder-only validation metadata while omitting it from structuredContent", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `[project]\nslug = "evidence-fixture"\n[jobs]\ntest = "true"\n`,
    );
    await gitInit(dir);
    const tool = TOOLS.find((candidate) => verbOf(candidate.name) === "test");
    assert(tool !== undefined);
    const result = await runTool(
      tool,
      new WorkingRoot(dir),
      {},
      undefined,
      () => Promise.resolve(undefined),
    );
    assertEquals(result.isError, false);
    assertEquals(result.structuredContent.validation, undefined);
    const event = (await completedEvents(dir)).find((candidate) =>
      candidate.verb === "test" && candidate.surface === "mcp"
    );
    assert(event?.validation !== undefined);
    assertEquals(event.validation.execution.jobs[0]?.outcome, "passed");
  });
});
