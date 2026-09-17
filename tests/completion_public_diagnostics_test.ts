import { prepareResult } from "../src/engine/gate/prepare.ts";
/** Public diagnostic commands cannot publish completion or acquire unrelated measurement demand. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut, runAgent } from "./engine_helpers.ts";
import { testResult } from "../src/engine/gate/test_job.ts";
import { standaloneValidation } from "../src/engine/validation/diagnostics.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { project } from "./completion_public_fixture.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";

Deno.test("E11 public test reports existing readings once without full gate demand or Proof", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      `${root}/discern.toml`,
      `[project]
slug = 'sample'
agents = []
record_logbook = false
[jobs]
format = "printf f >> executions"
build = "printf b >> executions"
test = { run = "printf t >> executions; printf 'DISCERN_METRIC coverage 70\\n'", inputs = ['**'] }
[standards.coverage]
producer = 'jobs.test'
direction = 'up'
limit = 90
[standards.expensive]
run = "printf e >> executions; printf 'DISCERN_METRIC expensive 1\\n'"
direction = 'down'
limit = 2
`,
    );
    await Deno.writeTextFile(`${root}/.gitignore`, "executions\n");
    await gitInit(root);
    await Deno.writeTextFile(`${root}/uncommitted`, "working bytes\n");
    const result = await testResult(root);
    assert(result.ok, JSON.stringify(result));
    assertEquals(await Deno.readTextFile(`${root}/executions`), "t");
    const data = result.data as {
      standards: { name: string; value?: number }[];
      producer_executions: Record<string, number>;
    };
    assertEquals(
      data.standards.find((standard) => standard.name === "coverage")?.value,
      70,
    );
    assertEquals(data.producer_executions, { "jobs.test": 1 });
    assertEquals((await observeCompletionRecords(root)).records, []);
    const full = await standaloneValidation({
      root,
      config: await loadConfig(root),
      scopes: [],
      kind: "standalone",
    });
    assert(full.outcome.blockers.length > 0);
    assert(
      full.outcome.evidence.every((evidence) =>
        evidence.purpose === "diagnostic"
      ),
    );
    assertEquals(full.producer_executions, {
      "jobs.format": 1,
      "jobs.build": 1,
      "jobs.test": 1,
      "standards.expensive": 1,
    });
    assertEquals((await observeCompletionRecords(root)).records, []);
    const prepared = await prepareResult(root);
    assert(prepared.ok, JSON.stringify(prepared));
    assertEquals(prepared.data, {
      producer_executions: { "jobs.format": 1 },
      measurement: "none",
    });
    assertEquals(
      (await Deno.readTextFile(`${root}/executions`)).split("t").length - 1,
      2,
    );
    assertEquals((await observeCompletionRecords(root)).records, []);
  });
});

Deno.test("E11 dirty deletion and rename retain public diagnostics without completion records", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    await Deno.rename(`${path}/source`, `${path}/renamed source`);
    const records = (await observeCompletionRecords(path)).records;
    for (
      const args of [["test", "--json"], [
        "standards",
        "coverage",
        "--force",
        "--json",
      ], ["done", "--standalone", "--json"]]
    ) {
      const result = await runAgent(path, args);
      assertEquals(result.code, 0, result.output);
      assertEquals((await observeCompletionRecords(path)).records, records);
      if (args[0] === "done") {
        const decoded = decodeCliResult(result.stdout, "done");
        assert(decoded.data !== undefined && "completion" in decoded.data);
        assertEquals(decoded.data.completion?.kind, "diagnostic");
        assertEquals(decoded.data.proof, undefined);
      }
    }
    assertEquals(await Deno.readTextFile(`${path}/executions`), "ttt");
  });
});

Deno.test("E12 detached standards measure their exact checkout without source claims or Proof", async () => {
  await withTempDir(async (root) => {
    const path = await project(root);
    const branch = await gitOut(path, "symbolic-ref", "HEAD");
    const head = await gitOut(path, "rev-parse", "HEAD");
    await git(path, "switch", "--detach", head);
    const before = (await observeCompletionRecords(path)).records;
    for (
      const args of [["standards", "coverage", "--json"], [
        "standards",
        "coverage",
        "--force",
        "--json",
      ]]
    ) {
      const checked = await runAgent(path, args);
      assertEquals(checked.code, 0, checked.output);
      const decoded = decodeCliResult(checked.stdout, "standards");
      assert(
        decoded.data !== undefined && "producer_executions" in decoded.data,
      );
      assertEquals(decoded.data.producer_executions, { "jobs.test": 1 });
      assertEquals((await observeCompletionRecords(path)).records, before);
      assertEquals(await gitOut(path, "rev-parse", "HEAD"), head);
      assertEquals(await gitOut(path, "rev-parse", branch), head);
      assertEquals(await gitOut(path, "status", "--porcelain=v1"), "");
    }
    assertEquals(await Deno.readTextFile(`${path}/executions`), "tt");
  });
});
