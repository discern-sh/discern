/**
 * Engine coverage for declared generated artifacts (ADR 0247).
 *
 * Every `[generated.<name>]` command belongs to the full gate's parallel Build
 * group. A green command can still make the gate red when it changes its
 * declared artifacts or writes beyond every declared glob. The comparison is
 * against the tree immediately before the Build group, so an agent's existing
 * uncommitted work is not mistaken for generator output.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import {
  buildPreparePlan,
  planStageJobs,
  preparePlanGroups,
} from "../src/engine/gate/plan.ts";
import { checkInstructionCurrent } from "../src/engine/instruction_render.ts";
import { readLogbookStream } from "../src/engine/logbook/read.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import type { GateWireData } from "../src/shared/result_schemas.ts";
import {
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";

interface GeneratedGroupFixture {
  readonly name: string;
  readonly paths: readonly string[];
  readonly run: string;
  readonly timeout?: number;
}

type GateJsonDiagnostic = NonNullable<
  CliResultForCommand<"done">["diagnostics"]
>[number];
type GateJson = Omit<CliResultForCommand<"done">, "data"> & {
  data: GateWireData;
};

/** Render production-shaped generated groups, including optional per-group timeouts. */
function generatedConfig(groups: readonly GeneratedGroupFixture[]): string {
  const lines = [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
  ];
  for (const group of groups) {
    lines.push(
      `[generated.${group.name}]`,
      `paths = [${group.paths.map((path) => JSON.stringify(path)).join(", ")}]`,
      `run = ${JSON.stringify(group.run)}`,
    );
    if (group.timeout !== undefined) {
      lines.push(`timeout = ${group.timeout}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Create parent directories before materializing a generated-artifact fixture. */
async function writeFile(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const absolute = join(root, path);
  await ensureDir(dirname(absolute));
  await Deno.writeTextFile(absolute, contents);
}

/** Current tracked worktree patch, including binary metadata when present. */
async function trackedDiff(root: string): Promise<string> {
  const result = await new Deno.Command("git", {
    args: ["diff", "--binary"],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout);
}

/** Decode the done envelope used by generated-artifact gate assertions. */
function parseGate(stdout: string): GateJson {
  const result = decodeCliResult(stdout, "done");
  assert(
    result.data !== undefined && "failed_stage" in result.data,
    `done result must carry gate data: ${stdout}`,
  );
  return { ...result, data: result.data };
}

/** Combine a diagnostic's summary and captured output for end-to-end evidence checks. */
function diagnosticText(diagnostic: GateJsonDiagnostic): string {
  return `${diagnostic.message}\n${diagnostic.output ?? ""}`;
}

const REFERENCE_GROUP: GeneratedGroupFixture = {
  name: "reference",
  paths: ["generated/reference.txt"],
  run: "cp source/reference.txt generated/reference.txt",
};

Deno.test("generated gate planning labels build jobs and carries each timeout", () => {
  const config = parseConfigOrThrow(generatedConfig([
    { ...REFERENCE_GROUP, timeout: 17 },
  ]));
  assertEquals(planStageJobs(config, "build"), [{
    label: "generated:reference",
    command: REFERENCE_GROUP.run,
    kind: "generated",
    reportStage: "build",
    willRun: true,
    timeout: { seconds: 17, key: "[generated.reference].timeout" },
  }]);
});

Deno.test("prepare plans the [generated] regenerations between fix and check", () => {
  const config = parseConfigOrThrow(
    `${
      generatedConfig([REFERENCE_GROUP])
    }\n[jobs]\nformat = "true"\nlint = "true"\n`,
  );
  const groups = preparePlanGroups(config);
  assertEquals(groups.map((group) => group.display), [
    "Fix",
    "Generated",
    "Check",
  ]);
  assertEquals(groups[1]?.jobs.map((job) => job.label), [
    "generated:reference",
  ]);
  const plan = buildPreparePlan(config);
  assertEquals(
    [
      ...plan.beforeRefresh.map((group) => group.display),
      plan.refresh.group,
      ...plan.afterRefresh.map((group) => group.display),
    ],
    ["Fix", "Generated", "Refresh", "Check"],
  );
});

Deno.test("prepare regenerates a stale declared artifact and stays green", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig([REFERENCE_GROUP]));
    await writeFile(dir, "source/reference.txt", "current\n");
    await writeFile(dir, "generated/reference.txt", "stale\n");
    await gitInit(dir);

    const run = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(run.code, 0, run.output);
    const result = decodeCliResult(run.stdout, "prepare");
    assert(result.ok, run.stdout);
    const step = result.steps?.find((candidate) =>
      candidate.label === "generated:reference"
    );
    assert(step !== undefined, run.stdout);
    assertEquals(step.group, "Generated");
    assertEquals(step.outcome, "ok");
    assertEquals(
      await Deno.readTextFile(join(dir, "generated/reference.txt")),
      "current\n",
      "prepare leaves the regenerated bytes for the agent to commit",
    );
  });
});

Deno.test("prepare refreshes generated Map inputs before checks and is a second-run fixpoint", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
    const generator =
      "mkdir -p discern/map/20-generated && printf '# Generated region\\n\\nGenerated during prepare.\\n' > discern/map/20-generated/README.md";
    await writeConfig(
      dir,
      [
        "[project]",
        'slug = "engine-test"',
        'agents = ["claude_code", "codex"]',
        "",
        "[instructions]",
        'sources = ["discern/instructions.md"]',
        "",
        "[generated.map-regions]",
        'paths = ["discern/map/**"]',
        `run = ${JSON.stringify(generator)}`,
        "",
        "[jobs]",
        'lint = "git diff --check"',
        "",
      ].join("\n"),
    );
    await Deno.mkdir(join(dir, "discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern", "instructions.md"),
      "# Project policy\n\nKeep generated context current.\n",
    );
    const baselineRefresh = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(baselineRefresh.code, 0, baselineRefresh.output);
    const initial = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertEquals(initial.includes("`20-generated` — Generated region"), false);
    await gitInit(dir);

    const first = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(first.code, 0, first.output);
    const firstResult = decodeCliResult(first.stdout, "prepare");
    assertEquals(firstResult.ok, true);
    assertEquals(
      firstResult.steps?.some((step) =>
        step.kind === "refresh" && step.outcome === "ok"
      ),
      true,
      first.stdout,
    );
    const current = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertStringIncludes(current, "`20-generated` — Generated region");
    assertEquals(await checkInstructionCurrent(dir), []);
    const afterFirst = await trackedDiff(dir);

    const second = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(second.code, 0, second.output);
    assertEquals(await trackedDiff(dir), afterFirst);
    assertEquals(await checkInstructionCurrent(dir), []);
  });
});

Deno.test("prepare stays red when one refresh surface cannot materialize", async (test) => {
  for (
    const fixture of [
      {
        name: "provider file",
        block: async (dir: string): Promise<string> => {
          await Deno.mkdir(join(dir, "AGENTS.md"));
          await Deno.writeTextFile(join(dir, "AGENTS.md", "blocker"), "x\n");
          return "AGENTS.md";
        },
      },
      {
        name: "skills directory",
        block: async (dir: string): Promise<string> => {
          await Deno.mkdir(join(dir, ".claude"), { recursive: true });
          await Deno.writeTextFile(join(dir, ".claude", "skills"), "blocked\n");
          return "skills";
        },
      },
    ] as const
  ) {
    await test.step(fixture.name, async () => {
      await withTempDir(async (dir) => {
        await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });
        await writeConfig(
          dir,
          '[project]\nslug = "engine-test"\nagents = ["claude_code", "codex"]\n',
        );
        const expectedSurface = await fixture.block(dir);
        await gitInit(dir);

        const run = await runAgent(dir, ["prepare", "--json"]);
        assertEquals(run.code, 1, run.output);
        const result = decodeCliResult(run.stdout, "prepare");
        assertEquals(result.ok, false);
        const refresh = result.steps?.find((step) => step.kind === "refresh");
        assertEquals(refresh?.outcome, "failed", run.stdout);
        const diagnostic = result.diagnostics?.find((entry) =>
          entry.tool === "refresh" && entry.message.includes(expectedSurface)
        );
        assert(diagnostic !== undefined, run.stdout);
        assertEquals(diagnostic.reproduce_cmd, "discern refresh");
      });
    });
  }
});

Deno.test("generated gate: a stale artifact fails with its group, command, files, and commit remedy", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig([REFERENCE_GROUP]));
    await writeFile(dir, "source/reference.txt", "current\n");
    await writeFile(dir, "generated/reference.txt", "stale\n");
    await gitInit(dir);

    const run = await runAgent(dir, ["done", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = parseGate(run.stdout);
    assertEquals(result.data.failed_stage, "generated_drift");
    const diagnostic = result.diagnostics?.find((candidate) =>
      candidate.tool === "generated:reference"
    );
    assert(diagnostic !== undefined, run.stdout);
    assertEquals(diagnostic.reproduce_cmd, REFERENCE_GROUP.run);
    const evidence = diagnosticText(diagnostic);
    assertStringIncludes(evidence, "[generated.reference]");
    assertStringIncludes(evidence, "generated/reference.txt");
    assertStringIncludes(evidence, "stale artifact");
    assertStringIncludes(evidence, "commit the regeneration");
    assertStringIncludes((result.hints ?? []).join("\n"), REFERENCE_GROUP.run);
    assertEquals(
      await Deno.readTextFile(join(dir, "generated/reference.txt")),
      "current\n",
      "the gate leaves the regenerated bytes for the agent to commit",
    );
  });
});

Deno.test("generated gate: a current artifact stays green and its timed Build step reaches the logbook", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig([REFERENCE_GROUP]));
    await writeFile(dir, "source/reference.txt", "current\n");
    await writeFile(dir, "generated/reference.txt", "current\n");
    await gitInit(dir);

    const run = await runAgent(dir, ["done", "--json"]);
    assertEquals(run.code, 0, run.output);
    const result = parseGate(run.stdout);
    assertEquals(result.data.failed_stage, null);
    const resultStep = result.steps?.find((step) =>
      step.label === "generated:reference"
    );
    assert(resultStep !== undefined, run.stdout);
    assertEquals(resultStep.kind, "job");
    assertEquals(resultStep.group, "Build");
    assertEquals(resultStep.outcome, "ok");
    assertEquals(typeof resultStep.duration_s, "number");

    const stream = await readLogbookStream(join(dir, ".git"));
    const event = stream.events.findLast((candidate) =>
      candidate.kind === "verb" && candidate.verb === "done"
    );
    assert(event?.kind === "verb", JSON.stringify(stream.events));
    const recordedStep = event.steps?.find((step) =>
      step.label === "generated:reference"
    );
    assert(recordedStep !== undefined, JSON.stringify(event));
    assertEquals(recordedStep.group, "Build");
    assertEquals(typeof recordedStep.duration_s, "number");
  });
});

Deno.test("generated gate: pre-existing dirty generated bytes do not false-positive", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig([REFERENCE_GROUP]));
    await writeFile(dir, "source/reference.txt", "current\n");
    await writeFile(dir, "generated/reference.txt", "committed-stale\n");
    await writeFile(dir, "notes.txt", "committed\n");
    await gitInit(dir);
    await writeFile(dir, "generated/reference.txt", "current\n");
    await writeFile(dir, "notes.txt", "agent edit\n");

    const run = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(run.code, 0, run.output);
    assertEquals(parseGate(run.stdout).data.failed_stage, null);
  });
});

Deno.test("generated gate: a generator changing an already-dirty unowned path still under-covers", async () => {
  await withTempDir(async (dir) => {
    const group: GeneratedGroupFixture = {
      ...REFERENCE_GROUP,
      run:
        "cp source/reference.txt generated/reference.txt; printf generator >> notes.txt",
    };
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig([group]));
    await writeFile(dir, "source/reference.txt", "current\n");
    await writeFile(dir, "generated/reference.txt", "current\n");
    await writeFile(dir, "notes.txt", "committed\n");
    await gitInit(dir);
    await writeFile(dir, "notes.txt", "agent edit\n");

    const run = await runAgent(dir, ["done", "--standalone", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = parseGate(run.stdout);
    assertEquals(result.data.failed_stage, "generated_drift");
    const diagnostic = result.diagnostics?.find((candidate) =>
      candidate.tool === "generated-coverage"
    );
    assert(diagnostic !== undefined, run.stdout);
    const evidence = diagnosticText(diagnostic);
    assertStringIncludes(evidence, "notes.txt");
    assertStringIncludes(evidence, "cannot prove");
  });
});

Deno.test("generated gate: output outside every declared glob reports under-coverage and candidates", async () => {
  await withTempDir(async (dir) => {
    const groups: readonly GeneratedGroupFixture[] = [
      {
        name: "schema",
        paths: ["generated/schema.json"],
        run: "cp source/schema.json escaped-schema.json",
      },
      {
        name: "reference",
        paths: ["generated/reference.txt"],
        run: "cp source/reference.txt generated/reference.txt",
      },
    ];
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig(groups));
    await writeFile(dir, "source/schema.json", "new\n");
    await writeFile(dir, "generated/schema.json", "current\n");
    await writeFile(dir, "source/reference.txt", "current\n");
    await writeFile(dir, "generated/reference.txt", "current\n");
    await writeFile(dir, "escaped-schema.json", "old\n");
    await gitInit(dir);

    const run = await runAgent(dir, ["done", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = parseGate(run.stdout);
    assertEquals(result.data.failed_stage, "generated_drift");
    const diagnostic = result.diagnostics?.find((candidate) =>
      candidate.tool === "generated-coverage"
    );
    assert(diagnostic !== undefined, run.stdout);
    const evidence = diagnosticText(diagnostic);
    assertStringIncludes(evidence, "escaped-schema.json");
    for (const group of groups) {
      assertStringIncludes(evidence, `[generated.${group.name}]`);
      assertStringIncludes(evidence, group.run);
    }
    assertStringIncludes(evidence, "cannot identify which candidate");
    assertStringIncludes(evidence, "under-covers");
    assertStringIncludes(evidence.toLowerCase(), "widen");
  });
});

Deno.test("generated gate: nondeterministic output reports the immediate-redirty signature", async () => {
  await withTempDir(async (dir) => {
    const group: GeneratedGroupFixture = {
      name: "counter",
      paths: ["generated/counter.txt"],
      run: "printf x >> generated/counter.txt",
    };
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig([group]));
    await writeFile(dir, "generated/counter.txt", "seed\n");
    await gitInit(dir);

    const run = await runAgent(dir, ["done", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = parseGate(run.stdout);
    assertEquals(result.data.failed_stage, "generated_drift");
    const recovery = (result.hints ?? []).join("\n");
    assertStringIncludes(recovery, "goes dirty again immediately");
    assertStringIncludes(recovery, "same tree did not produce the same bytes");
  });
});

const ATTRIBUTION_GROUPS = [
  {
    name: "reference",
    paths: ["generated/reference.txt"],
    run: "cp source/reference.txt generated/reference.txt",
  },
  {
    name: "schema",
    paths: ["generated/schema.txt"],
    run: "cp source/schema.txt generated/schema.txt",
  },
] as const satisfies readonly GeneratedGroupFixture[];

Deno.test("generated gate: every configured drifting group receives its own attribution", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig(ATTRIBUTION_GROUPS));
    for (const group of ATTRIBUTION_GROUPS) {
      await writeFile(dir, `source/${group.name}.txt`, `${group.name}-new\n`);
      await writeFile(
        dir,
        `generated/${group.name}.txt`,
        `${group.name}-old\n`,
      );
    }
    await gitInit(dir);

    const run = await runAgent(dir, ["done", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = parseGate(run.stdout);
    assertEquals(result.data.failed_stage, "generated_drift");
    for (const group of ATTRIBUTION_GROUPS) {
      const label = `generated:${group.name}`;
      const diagnostic = result.diagnostics?.find((candidate) =>
        candidate.tool === label
      );
      assert(diagnostic !== undefined, `${label}: ${run.stdout}`);
      assertEquals(diagnostic.reproduce_cmd, group.run);
      assertStringIncludes(
        diagnosticText(diagnostic),
        `generated/${group.name}.txt`,
      );
      const step = result.steps?.find((candidate) => candidate.label === label);
      assert(step !== undefined, `${label}: ${run.stdout}`);
      assertEquals(step.group, "Build");
      assertEquals(typeof step.duration_s, "number");
    }
  });
});

Deno.test("generated gate: dry-run lists generators without running them; prepare runs them", async () => {
  await withTempDir(async (dir) => {
    const group: GeneratedGroupFixture = {
      name: "reference",
      paths: ["generated/reference.txt"],
      run: "printf x >> generated/reference.txt; touch generator-ran.txt",
    };
    await scaffoldEngine(dir);
    await writeConfig(dir, generatedConfig([group]));
    await writeFile(dir, "generated/reference.txt", "current\n");
    await gitInit(dir);

    const preview = await runAgent(dir, ["done", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    const planned = decodeCliResult(preview.stdout, "done").plan?.steps.find((
      step,
    ) => step.label === "generated:reference");
    assertEquals(planned?.label, "generated:reference");
    assertEquals(planned?.disposition, "run");
    assertEquals(planned?.group, "Build");
    assertEquals(await pathExists(join(dir, "generator-ran.txt")), false);

    const rendered = await runAgent(dir, ["done", "--dry-run"]);
    assertEquals(rendered.code, 0, rendered.output);
    assertStringIncludes(rendered.stdout, "generated:reference");

    const prepare = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(prepare.code, 0, prepare.output);
    assertEquals(await pathExists(join(dir, "generator-ran.txt")), true);
    assertEquals(
      await Deno.readTextFile(join(dir, "generated/reference.txt")),
      "current\nx",
      "prepare runs the regeneration in the working tree",
    );
  });
});
