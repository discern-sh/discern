/** Standalone measurements retain scoped receipts, never queue readiness or aggregate Proof. */
import { assert, assertEquals } from "@std/assert";
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
import { requireQueue } from "../src/engine/landing_queue/repository.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

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
    const queue = await requireQueue(path);
    assertEquals(queue.record.data.entries, []);
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
    assertEquals(await Deno.readTextFile(`${path}/executions`), "bt");
    assertEquals((await requireQueue(path)).record.data.entries, []);
    assertEquals(
      (await observeCompletionRecords(path)).records.filter((entry) =>
        entry.selector.kind === "proof"
      ),
      [],
    );
  });
});
