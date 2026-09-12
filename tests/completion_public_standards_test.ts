/** Standalone measurements retain scoped receipts, never queue readiness or aggregate Proof. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { project } from "./completion_public_fixture.ts";
import { statIfExists } from "../src/shared/fs_presence.ts";

Deno.test("E12 public standards shares dependencies and pin reuses receipts without a passed queue claim", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await writeConfig(
      root,
      `[project]
slug = 'sample'
agents = []
logbook = false
[jobs]
build = {run = "printf b >> executions", inputs = ['source']}
test = {run = "printf t >> executions; printf 'DISCERN_METRIC coverage 93\\n'", needs = ['jobs.build'], inputs = ['source']}
lint = "printf l >> executions"
[standards.coverage]
producer = 'jobs.test'
direction = 'up'
limit = 90
[standards.second]
producer = 'jobs.test'
metric = 'coverage'
direction = 'up'
limit = 90
`,
    );
    await Deno.writeTextFile(
      `${root}/.gitignore`,
      (await Deno.readTextFile(`${root}/.gitignore`)) + "\nexecutions\n",
    );
    await Deno.writeTextFile(`${root}/source`, "initial\n");
    await gitInit(root);
    const path = await addWorktree(root, "public-standards");
    await Deno.writeTextFile(`${path}/source`, "changed\n");
    await git(path, "add", "source");
    await git(path, "commit", "-m", "Change source");
    const checked = await runAgent(path, ["standards", "--json"]);
    assertEquals(checked.code, 0, checked.output);
    const result = decodeCliResult(checked.stdout, "standards");
    assert(
      result.data !== undefined && "producer_executions" in result.data,
      checked.output,
    );
    assertEquals(result.data.producer_executions, {
      "jobs.build": 1,
      "jobs.test": 1,
    });
    assertEquals(await Deno.readTextFile(`${path}/executions`), "bt");
    const records = (await observeCompletionRecords(path)).records;
    assertEquals(
      records.filter((entry) => entry.selector.kind === "proof"),
      [],
    );
    assert(
      records.filter((entry) => entry.selector.kind === "attempt").every((
        entry,
      ) =>
        entry.reading.kind === "recorded" &&
        entry.reading.record.kind === "attempt" &&
        entry.reading.record.data.subjects.length === 2
      ),
    );
    const pin = await runAgent(path, ["standards", "--pin", "--json"]);
    assertEquals(pin.code, 0, pin.output);
    const pinned = decodeCliResult(pin.stdout, "standards");
    assert(pinned.data !== undefined && "producer_executions" in pinned.data);
    assertEquals(pinned.data.producer_executions, {});
    // S07: a pin that reuses readings names the producer whose evidence stood in.
    const reused = pinned.data.producer_evidence ?? [];
    assertEquals(reused.map((entry) => [entry.producer, entry.use]), [[
      "jobs.test",
      "reused",
    ]]);
    assertEquals(reused[0]?.closure, "declared");
    // Provenance is the recorded measurement candidate, the same origin a
    // replayed standard reading names.
    assert(/^[0-9a-f]{40}$/.test(reused[0]?.from ?? ""), pin.output);
    assertStringIncludes(reused[0]?.reason ?? "", "coverage, second");
    assertEquals(
      result.data.producer_evidence?.map((entry) => entry.use),
      ["executed", "executed"],
    );
    assertEquals(await Deno.readTextFile(`${path}/executions`), "bt");
    assertEquals(
      (await observeCompletionRecords(path)).records.filter((entry) =>
        entry.selector.kind === "proof"
      ),
      [],
    );
  });
});

Deno.test("public acceptance lands after standalone measurement without repeating a still-valid producer", async () => {
  await withTempDir(async (root) => {
    const lightCounter = `${root}/.git/light-runs`;
    const path = await project(
      root,
      `
[standards.lightweight]
run = ${
        JSON.stringify(
          `printf l >> executions; printf l >> '${lightCounter}'; printf 'DISCERN_METRIC lightweight 1\\n'`,
        )
      }
direction = 'down'
limit = 1
`,
    );
    for (
      const args of [
        ["standards", "lightweight"],
        ["done"],
        ["standards", "lightweight"],
      ]
    ) {
      const result = await runAgent(path, [...args, "--json"]);
      assertEquals(result.code, 0, result.output);
    }
    const executions = await Deno.readTextFile(`${path}/executions`);
    assertEquals(executions.split("t").length - 1, 1);
    const measured = await Deno.readTextFile(lightCounter);
    const accepted = await runAgent(path, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const result = decodeCliResult(accepted.stdout, "accept");
    assert(result.data !== undefined && "landing" in result.data);
    assertEquals(result.data.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: true,
    });
    assertEquals(await statIfExists(path), undefined);
    assertEquals(await Deno.readTextFile(`${root}/source`), "authored\n");
    assertEquals(
      await Deno.readTextFile(lightCounter),
      measured,
      "acceptance must not repeat a still-valid producer after historical measurements",
    );
  });
});
