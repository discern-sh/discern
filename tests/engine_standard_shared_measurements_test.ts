/** Focused coverage for one process serving multiple Standard metrics. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { standardsResult } from "../src/engine/gate/standards.ts";

interface StandardFixture {
  name: string;
  metric?: string;
  direction: "up" | "down";
  limit: number;
  run: string;
  timeout?: number;
  inputs?: string[];
  measure?: "gate" | "on-demand";
}

/** Render a minimal project with the supplied Standard tables. */
function standardsConfig(standards: readonly StandardFixture[]): string {
  const lines = [
    "[project]",
    'slug = "shared-measurements"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    'lint = "true"',
    "",
  ];
  for (const standard of standards) {
    lines.push(
      `[standards.${standard.name}]`,
      ...(standard.metric === undefined
        ? []
        : [`metric = "${standard.metric}"`]),
      `direction = "${standard.direction}"`,
      `limit = ${standard.limit}`,
      ...(standard.timeout === undefined
        ? []
        : [`timeout = ${standard.timeout}`]),
      ...(standard.inputs === undefined
        ? []
        : [`inputs = ${JSON.stringify(standard.inputs)}`]),
      ...(standard.measure === undefined
        ? []
        : [`measure = "${standard.measure}"`]),
      `run = "${standard.run}"`,
      "",
    );
  }
  return lines.join("\n");
}

/** Count one-character invocation markers written outside the worktree. */
async function invocationCount(dir: string): Promise<number> {
  try {
    return (await Deno.readTextFile(`${dir}/.git/shared-runs`)).length;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
}

/** Wait until the planted process counter proves the shared command started. */
async function waitForInvocation(dir: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (await invocationCount(dir) === 0) {
    if (Date.now() >= deadline) {
      throw new Error("shared Standard process did not start within 5 seconds");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The common two-metric command, including a planted process counter. */
function twoMetricCommand(first = 5, second = 20): string {
  return `printf x >> .git/shared-runs; echo DISCERN_METRIC first ${first}; echo DISCERN_METRIC second ${second}`;
}

Deno.test("shared Standard measurement: standalone runs once and keeps separate verdicts and projections", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = twoMetricCommand();
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "floor",
          metric: "first",
          direction: "up",
          limit: 4,
          run: command,
        },
        {
          name: "ceiling",
          metric: "second",
          direction: "down",
          limit: 10,
          run: command,
        },
      ]),
    );
    await gitInit(dir);

    const json = await runAgent(dir, ["standards", "--json"]);
    assertEquals(json.code, 1, json.output);
    assertEquals(await invocationCount(dir), 1);
    const result = decodeCliResult(json.stdout, "standards");
    assertResultDataKey(result, "standards");
    const steps = result.steps ?? [];
    assertEquals(steps.map((step) => step.label), ["floor", "ceiling"]);
    assertEquals(steps.map((step) => step.outcome), ["ok", "failed"]);
    assertEquals(
      result.data?.standards?.map((reading) => reading.verdict),
      ["improved", "regressed"],
    );

    const markdown = await runAgent(dir, ["standards", "--markdown"]);
    assertEquals(markdown.code, 1, markdown.output);
    assertEquals(await invocationCount(dir), 2);
    assertStringIncludes(markdown.stdout, "`floor`: measured 5");
    assertStringIncludes(markdown.stdout, "`ceiling`: measured 20");
  });
});

Deno.test("shared Standard measurement: a missing metric fails only its consumer", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = "printf x >> .git/shared-runs; echo DISCERN_METRIC first 5";
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "present",
          metric: "first",
          direction: "up",
          limit: 4,
          run: command,
        },
        {
          name: "missing",
          metric: "second",
          direction: "up",
          limit: 1,
          run: command,
        },
      ]),
    );
    await gitInit(dir);

    const run = await runAgent(dir, ["standards", "--json"]);
    assertEquals(run.code, 1, run.output);
    assertEquals(await invocationCount(dir), 1);
    const result = decodeCliResult(run.stdout, "standards");
    assertEquals(
      (result.steps ?? []).map((step) => [step.label, step.outcome]),
      [["present", "ok"], ["missing", "failed"]],
    );
    assertEquals(result.diagnostics?.length, 1);
    assertEquals(result.diagnostics?.[0]?.tool, "missing");
  });
});

Deno.test("shared Standard measurement: a failed process fails every dependent member", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = "printf x >> .git/shared-runs; exit 7";
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "first_standard",
          metric: "first",
          direction: "up",
          limit: 1,
          run: command,
        },
        {
          name: "second_standard",
          metric: "second",
          direction: "up",
          limit: 1,
          run: command,
        },
      ]),
    );
    await gitInit(dir);

    const run = await runAgent(dir, ["standards", "--json"]);
    assertEquals(run.code, 1, run.output);
    assertEquals(await invocationCount(dir), 1);
    const result = decodeCliResult(run.stdout, "standards");
    assertEquals(
      (result.steps ?? []).map((step) => step.outcome),
      ["failed", "failed"],
    );
    assertEquals(
      new Set((result.diagnostics ?? []).map((diagnostic) => diagnostic.tool)),
      new Set(["first_standard", "second_standard"]),
    );
  });
});

Deno.test("shared Standard measurement: different effective timeouts do not coalesce", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = twoMetricCommand();
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "first_standard",
          metric: "first",
          direction: "up",
          limit: 1,
          timeout: 1,
          run: command,
        },
        {
          name: "second_standard",
          metric: "second",
          direction: "down",
          limit: 30,
          timeout: 2,
          run: command,
        },
      ]),
    );
    await gitInit(dir);

    const run = await runAgent(dir, ["standards", "--json"]);
    assertEquals(run.code, 0, run.output);
    assertEquals(await invocationCount(dir), 2);
  });
});

Deno.test("shared Standard measurement: pin keeps independent limits after one run", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = twoMetricCommand();
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "floor",
          metric: "first",
          direction: "up",
          limit: 1,
          run: command,
        },
        {
          name: "ceiling",
          metric: "second",
          direction: "down",
          limit: 30,
          run: command,
        },
      ]),
    );
    await gitInit(dir);

    const run = await runAgent(dir, ["standards", "--pin", "--json"]);
    assertEquals(run.code, 0, run.output);
    assertEquals(await invocationCount(dir), 1);
    const result = decodeCliResult(run.stdout, "standards");
    assertResultDataKey(result, "pinned");
    assertEquals(result.data.pinned, [
      { name: "floor", from: 1, to: 5, measured: 5 },
      { name: "ceiling", from: 30, to: 20, measured: 20 },
    ]);
    const config = await Deno.readTextFile(`${dir}/discern.toml`);
    assertStringIncludes(config, "[standards.floor]");
    assertStringIncludes(config, "limit = 5");
    assertStringIncludes(config, "[standards.ceiling]");
    assertStringIncludes(config, "limit = 20");
  });
});

Deno.test("shared Standard measurement: Gate runs once and replay/defer members stay independent", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = twoMetricCommand();
    await Deno.mkdir(`${dir}/src`, { recursive: true });
    await Deno.mkdir(`${dir}/docs`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/code.ts`, "export {};\n");
    await Deno.writeTextFile(`${dir}/docs/readme.md`, "docs\n");
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "source_metric",
          metric: "first",
          direction: "up",
          limit: 4,
          inputs: ["src/**"],
          run: command,
        },
        {
          name: "docs_metric",
          metric: "second",
          direction: "down",
          limit: 30,
          inputs: ["docs/**"],
          run: command,
        },
        {
          name: "deferred_metric",
          metric: "first",
          direction: "up",
          limit: 4,
          measure: "on-demand",
          run: command,
        },
      ]),
    );
    await gitInit(dir);

    const first = await runAgent(dir, ["done", "--json"]);
    assertEquals(first.code, 0, first.output);
    assertEquals(await invocationCount(dir), 1);

    await Deno.writeTextFile(`${dir}/src/code.ts`, "export const x = 1;\n");
    await git(dir, "add", "src/code.ts");
    await git(dir, "commit", "-qm", "change source", "--no-gpg-sign");

    const second = await runAgent(dir, ["done", "--json"]);
    assertEquals(second.code, 0, second.output);
    assertEquals(await invocationCount(dir), 2);
    const result = decodeCliResult(second.stdout, "done");
    assertResultDataKey(result, "standards");
    const readings = result.data?.standards ?? [];
    assertEquals(
      readings.map((reading) => [reading.name, reading.measurement]),
      [
        ["source_metric", "measured"],
        ["docs_metric", "replayed"],
        ["deferred_metric", "deferred"],
      ],
    );
  });
});

Deno.test("shared Standard measurement: cancellation fans out without a second process", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command =
      "printf x >> .git/shared-runs; sleep 30; echo DISCERN_METRIC first 5; echo DISCERN_METRIC second 20";
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "first_standard",
          metric: "first",
          direction: "up",
          limit: 1,
          run: command,
        },
        {
          name: "second_standard",
          metric: "second",
          direction: "down",
          limit: 30,
          run: command,
        },
      ]),
    );
    await gitInit(dir);

    const controller = new AbortController();
    const pending = standardsResult(dir, { signal: controller.signal });
    await waitForInvocation(dir);
    controller.abort();
    const result = await pending;

    assertEquals(result.ok, false, JSON.stringify(result));
    assertEquals(await invocationCount(dir), 1);
    assertEquals(
      (result.steps ?? []).map((step) => step.outcome),
      ["cancelled", "cancelled"],
    );
    assert(
      (result.steps ?? []).every((step) =>
        typeof step.durationS === "number" && step.durationS >= 0
      ),
      JSON.stringify(result.steps),
    );
  });
});
