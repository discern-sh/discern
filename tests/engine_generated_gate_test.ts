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
import { planStageJobs } from "../src/engine/gate/plan.ts";
import { readLogbookStream } from "../src/engine/logbook/read.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";

interface GeneratedGroupFixture {
  readonly name: string;
  readonly paths: readonly string[];
  readonly run: string;
  readonly timeout?: number;
}

interface GateJsonDiagnostic {
  readonly tool: string;
  readonly message: string;
  readonly reproduce_cmd: string;
  readonly output?: string;
}

interface GateJsonStep {
  readonly label: string;
  readonly kind: string;
  readonly group?: string;
  readonly outcome: string;
  readonly duration_s?: number;
}

interface GateJson {
  readonly ok: boolean;
  readonly data: { readonly failed_stage: string | null };
  readonly diagnostics?: readonly GateJsonDiagnostic[];
  readonly hints?: readonly string[];
  readonly steps?: readonly GateJsonStep[];
  readonly plan?: {
    readonly steps: readonly {
      readonly label: string;
      readonly disposition: string;
      readonly group?: string;
    }[];
  };
}

/** Return the generated config. */
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

/** Write the file. */
async function writeFile(
  root: string,
  path: string,
  contents: string,
): Promise<void> {
  const absolute = join(root, path);
  await ensureDir(dirname(absolute));
  await Deno.writeTextFile(absolute, contents);
}

/** Return whether the path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/** Parse the gate. */
function parseGate(stdout: string): GateJson {
  return JSON.parse(stdout.trim()) as GateJson;
}

/** Return the diagnostic text. */
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
    timeoutS: 17,
  }]);
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

    const run = await runAgent(dir, ["done", "--json"]);
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

    const run = await runAgent(dir, ["done", "--json"]);
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

Deno.test("generated gate: dry-run lists generators while prepare never runs them", async () => {
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
    const planned = parseGate(preview.stdout).plan?.steps.find((step) =>
      step.label === "generated:reference"
    );
    assertEquals(planned?.label, "generated:reference");
    assertEquals(planned?.disposition, "run");
    assertEquals(planned?.group, "Build");
    assertEquals(await exists(join(dir, "generator-ran.txt")), false);

    const rendered = await runAgent(dir, ["done", "--dry-run"]);
    assertEquals(rendered.code, 0, rendered.output);
    assertStringIncludes(rendered.stdout, "generated:reference");

    const prepare = await runAgent(dir, ["prepare", "--json"]);
    assertEquals(prepare.code, 0, prepare.output);
    assertEquals(await exists(join(dir, "generator-ran.txt")), false);
    assertEquals(
      await Deno.readTextFile(join(dir, "generated/reference.txt")),
      "current\n",
    );
  });
});
