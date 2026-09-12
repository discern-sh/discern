/**
 * Focused coverage for one process serving multiple Standard metrics.
 *
 * One standalone run measures every configured process group, so the
 * shared-process matrix (separate verdicts and projections, a missing metric,
 * a failed process, distinct effective timeouts) is one fixture whose
 * per-command counters prove how many processes each group started. The
 * coverage trio and the Gate's replay of declared inputs share one Gate
 * fixture the same way.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  git,
  gitInit,
  readLogbookEvents,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { standardsResult } from "../src/engine/gate/standards.ts";
import { waitForPendingCondition } from "./waiting.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";

interface StandardFixture {
  name: string;
  metric?: string;
  direction: "up" | "down";
  limit: number;
  run: string;
  timeout?: number;
  inputs?: string[];
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
      `run = "${standard.run}"`,
      "",
    );
  }
  return lines.join("\n");
}

/** Count one-character invocation markers written outside the worktree. */
async function invocationCount(
  dir: string,
  counter = "shared-runs",
): Promise<number> {
  return (await readTextIfExists(`${dir}/.git/${counter}`))?.length ?? 0;
}

/** Wait until the planted process counter proves the shared command started. */
async function waitForInvocation(
  dir: string,
  pending: Promise<unknown>,
): Promise<void> {
  await waitForPendingCondition(
    pending,
    async () => await invocationCount(dir) > 0,
    "the shared Standard process to start",
    { intervalMs: 20 },
  );
}

/** The common two-metric command, including a planted process counter. */
function twoMetricCommand(
  first = 5,
  second = 20,
  counter = "shared-runs",
): string {
  return `printf x >> .git/${counter}; echo DISCERN_METRIC first ${first}; echo DISCERN_METRIC second ${second}`;
}

/** Stand in for the coverage task's three metrics and one instrumented run. */
function coverageMetricCommand(): string {
  return "printf x >> .git/coverage-runs; " +
    "echo DISCERN_METRIC coverage 92; " +
    "echo DISCERN_METRIC module_coverage_failures 0; " +
    "echo DISCERN_METRIC module_coverage_exceptions 14";
}

Deno.test("shared Standard measurement: the coverage trio shares one run in Standards and Gate, and the Gate reuses only unchanged declared inputs", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const coverage = coverageMetricCommand();
    const command = twoMetricCommand();
    await Deno.mkdir(`${dir}/src`, { recursive: true });
    await Deno.mkdir(`${dir}/docs`, { recursive: true });
    await Deno.writeTextFile(`${dir}/src/code.ts`, "export {};\n");
    await Deno.writeTextFile(`${dir}/docs/readme.md`, "docs\n");
    await writeConfig(
      dir,
      standardsConfig([
        {
          name: "coverage",
          direction: "up",
          limit: 91,
          run: coverage,
          timeout: 1200,
        },
        {
          name: "module_coverage",
          metric: "module_coverage_failures",
          direction: "down",
          limit: 0,
          run: coverage,
          timeout: 1200,
        },
        {
          name: "module_coverage_exceptions",
          metric: "module_coverage_exceptions",
          direction: "down",
          limit: 14,
          run: coverage,
          timeout: 1200,
        },
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
          name: "required_metric",
          metric: "first",
          direction: "up",
          limit: 4,
          run: command,
        },
      ]),
    );
    await gitInit(dir);

    const first = await runAgent(dir, ["done", "--json"]);
    assertEquals(first.code, 0, first.output);

    await t.step(
      "coverage Standards: aggregate, module floor, and exceptions share one run in Gate",
      async () => {
        assertEquals(await invocationCount(dir, "coverage-runs"), 1);
      },
    );

    await t.step(
      "shared Standard measurement: Gate measures every required member and reuses only unchanged declared inputs",
      async () => {
        assertEquals(await invocationCount(dir), 3);

        await Deno.writeTextFile(`${dir}/src/code.ts`, "export const x = 1;\n");
        await git(dir, "add", "src/code.ts");
        await git(dir, "commit", "-qm", "change source", "--no-gpg-sign");

        const second = await runAgent(dir, ["done", "--json"]);
        assertEquals(second.code, 0, second.output);
        assertEquals(await invocationCount(dir), 5);
        const result = decodeCliResult(second.stdout, "done");
        assertResultDataKey(result, "standards");
        const readings = (result.data?.standards ?? []).filter((reading) =>
          reading.name.endsWith("_metric")
        );
        assertEquals(
          readings.map((reading) => [reading.name, reading.measurement]),
          [
            ["source_metric", "measured"],
            ["docs_metric", "replayed"],
            ["required_metric", "measured"],
          ],
        );
      },
    );

    await t.step(
      "coverage Standards: aggregate, module floor, and exceptions share one run in Standards",
      async () => {
        // The standalone verb never replays, so every Gate measurement so far
        // sits in the counter: one more run must add exactly one process.
        const coverageRuns = await invocationCount(dir, "coverage-runs");
        const standalone = await runAgent(dir, ["standards", "--json"]);
        assertEquals(standalone.code, 0, standalone.output);
        assertEquals(
          await invocationCount(dir, "coverage-runs"),
          coverageRuns + 1,
        );
      },
    );
  });
});

Deno.test("shared Standard measurement: one standalone run keeps separate verdicts and projections, fails only the missing metric's consumer, fails every member of a failed process, and never coalesces distinct timeouts", async (t) => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command = twoMetricCommand();
    const singleMetric =
      "printf x >> .git/single-runs; echo DISCERN_METRIC first 5";
    const failing = "printf x >> .git/failed-runs; exit 7";
    const bounded = twoMetricCommand(6, 21, "bounded-runs");
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
        {
          name: "present",
          metric: "first",
          direction: "up",
          limit: 4,
          run: singleMetric,
        },
        {
          name: "missing",
          metric: "second",
          direction: "up",
          limit: 1,
          run: singleMetric,
        },
        {
          name: "first_standard",
          metric: "first",
          direction: "up",
          limit: 1,
          run: failing,
        },
        {
          name: "second_standard",
          metric: "second",
          direction: "up",
          limit: 1,
          run: failing,
        },
        {
          name: "bounded_first",
          metric: "first",
          direction: "up",
          limit: 1,
          // Distinct budgets prove non-coalescing; both stay far above the
          // trivial command's real runtime so a loaded machine cannot fire one.
          timeout: 30,
          run: bounded,
        },
        {
          name: "bounded_second",
          metric: "second",
          direction: "down",
          limit: 30,
          timeout: 45,
          run: bounded,
        },
      ]) +
        [
          // The always-failing process is also this file's guard that a
          // measurement report never fail-fast-cancels sibling readings:
          // pin the abort-triggering config so the exact step outcomes and
          // process counts below stay meaningful if the default ever moves.
          "[gate]",
          "fail_fast = true",
          "",
        ].join("\n"),
    );
    await gitInit(dir);

    const json = await runAgent(dir, ["standards", "--json"]);
    assertEquals(json.code, 1, json.output);
    const boundedFirstRun = await invocationCount(dir, "bounded-runs");
    const result = decodeCliResult(json.stdout, "standards");
    assertResultDataKey(result, "standards");
    const steps = result.steps ?? [];
    const outcomeOf = (label: string): string | undefined =>
      steps.find((step) => step.label === label)?.outcome;
    const diagnosticTools = new Set(
      (result.diagnostics ?? []).map((diagnostic) => diagnostic.tool),
    );

    await t.step(
      "shared Standard measurement: standalone runs once and keeps separate verdicts and projections",
      async () => {
        assertEquals(await invocationCount(dir), 1);
        assertEquals(
          steps.filter((step) => ["floor", "ceiling"].includes(step.label)).map(
            (
              step,
            ) => [step.label, step.outcome],
          ),
          [["floor", "ok"], ["ceiling", "failed"]],
        );
        assertEquals(
          result.data?.standards?.filter((reading) =>
            ["floor", "ceiling"].includes(reading.name)
          ).map((reading) => reading.verdict),
          ["improved", "regressed"],
        );

        const markdown = await runAgent(dir, ["standards", "--markdown"]);
        assertEquals(markdown.code, 1, markdown.output);
        assertEquals(await invocationCount(dir), 2);
        assertTerminalTextIncludes(markdown.stdout, "`floor`: measured 5");
        assertTerminalTextIncludes(markdown.stdout, "`ceiling`: measured 20");
      },
    );

    await t.step(
      "shared Standard measurement: a missing metric fails only its consumer",
      async () => {
        assertEquals(await invocationCount(dir, "single-runs"), 2);
        assertEquals(
          steps.filter((step) => ["present", "missing"].includes(step.label))
            .map((step) => [step.label, step.outcome]),
          [["present", "ok"], ["missing", "failed"]],
        );
        assertEquals(
          (result.diagnostics ?? []).filter((diagnostic) =>
            ["present", "missing"].includes(diagnostic.tool)
          ).length,
          1,
        );
        assert(diagnosticTools.has("missing"));
      },
    );

    await t.step(
      "shared Standard measurement: a failed process fails every dependent member",
      async () => {
        assertEquals(await invocationCount(dir, "failed-runs"), 2);
        assertEquals(
          [outcomeOf("first_standard"), outcomeOf("second_standard")],
          ["failed", "failed"],
        );
        assert(diagnosticTools.has("first_standard"));
        assert(diagnosticTools.has("second_standard"));
      },
    );

    await t.step(
      "shared Standard measurement: different effective timeouts do not coalesce",
      async () => {
        assertEquals(
          [outcomeOf("bounded_first"), outcomeOf("bounded_second")],
          ["ok", "ok"],
        );
        // Within one run, distinct effective timeouts are distinct execution
        // identities: the shared command ran once per timeout. The standalone
        // verb never replays recorded evidence, so the second run added
        // exactly one more process per timeout.
        assertEquals(boundedFirstRun, 2);
        assertEquals(await invocationCount(dir, "bounded-runs"), 4);
      },
    );
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

Deno.test("shared Standard measurement: cancellation fans out without a second process", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const command =
      "printf x >> .git/shared-runs; tail -f /dev/null; echo DISCERN_METRIC first 5; echo DISCERN_METRIC second 20";
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
    await waitForInvocation(dir, pending);
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

Deno.test("shared Standard measurement: a timeout fans out naming each member's own budget key", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // The incident shape: several Standards share one slow measurement
    // command. The leader carries its own `timeout`; the sibling inherits the
    // run-level [gate].timeout of the same length, so the process is shared
    // (equal effective budget) while the provenance differs per member.
    const command = "tail -f /dev/null";
    await writeConfig(
      dir,
      [
        standardsConfig([
          {
            name: "coverage",
            direction: "up",
            limit: 80,
            timeout: 1,
            run: command,
          },
          {
            name: "module_coverage",
            metric: "module_coverage_failures",
            direction: "down",
            limit: 0,
            run: command,
          },
        ]),
        "[gate]",
        "timeout = 1",
        "",
      ].join("\n"),
    );
    await gitInit(dir);

    const run = await runAgent(dir, ["standards", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = decodeCliResult(run.stdout, "standards");
    const byTool = new Map(
      (result.diagnostics ?? []).map((diagnostic) => [
        diagnostic.tool,
        diagnostic,
      ]),
    );
    const leader = byTool.get("coverage");
    const member = byTool.get("module_coverage");
    assert(leader !== undefined && member !== undefined, run.stdout);
    // Every fanned diagnostic self-identifies as a timeout, and each names
    // the key THAT member's config sets — the leader its own `timeout`, the
    // sibling the inherited run-level default.
    for (const diagnostic of [leader, member]) {
      assertStringIncludes(diagnostic.message, "timed out after 1s");
      assertEquals(diagnostic.rule, "timeout");
    }
    assertStringIncludes(
      leader.message,
      "the budget comes from `[standards.coverage].timeout`",
    );
    assertStringIncludes(
      member.message,
      "the budget comes from `[gate].timeout`",
    );

    // The attribution survives the logbook's metadata-only reduction: the
    // recorded diagnostic classes keep `rule: "timeout"` with no message
    // body, so a later reader can tell a timeout from a metric regression.
    const events = await readLogbookEvents(dir);
    const recorded = events.findLast((event) =>
      event.kind === "verb" && event.verb === "standards"
    );
    assert(
      recorded !== undefined && recorded.kind === "verb",
      "expected a recorded standards event",
    );
    assertEquals(
      (recorded.diagnostics ?? [])
        .map((diagnostic) => `${diagnostic.tool}:${diagnostic.rule}`)
        .sort(),
      ["coverage:timeout", "module_coverage:timeout"],
    );
  });
});
