import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { loadConfig, parseConfig } from "../src/shared/config_schema.ts";
import {
  generatedGroupForPath,
  resolveGeneratedGroups,
} from "../src/shared/generated_artifacts.ts";
import {
  GATE_FAILURE_REMEDIES,
  gateFailureRemedy,
} from "../src/shared/hints.ts";
import { UpdateDataSchema } from "../src/shared/result_schemas.ts";
import { withTempDir } from "./helpers.ts";
import { scaffoldEngine, writeConfig } from "./engine_helpers.ts";

Deno.test("a scaffolded project loads generated groups and resolves their owned paths", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      [
        "[map]",
        'dir = "project/map/"',
        "",
        "[generated.reference]",
        'paths = ["${map.dir}70-reference/**"]',
        'run = ["tool write-reference", "tool tidy-reference"]',
        "linguist_generated = true",
        "timeout = 45",
        "",
        "[generated.schemas]",
        'paths = ["schema/**"]',
        'run = "tool write-schema"',
        "",
      ].join("\n"),
    );

    const config = await loadConfig(dir);
    assertEquals(config.generated.reference, {
      paths: ["${map.dir}70-reference/**"],
      run: ["tool write-reference", "tool tidy-reference"],
      linguist_generated: true,
      timeout: 45,
    });

    const groups = resolveGeneratedGroups(config);
    assertEquals(groups, [
      {
        name: "reference",
        paths: ["project/map/70-reference/**"],
        run: "tool write-reference && tool tidy-reference",
        linguistGenerated: true,
        timeout: 45,
      },
      {
        name: "schemas",
        paths: ["schema/**"],
        run: "tool write-schema",
        linguistGenerated: false,
      },
    ]);
    assertEquals(
      generatedGroupForPath(
        groups,
        "project/map/70-reference/config-reference.md",
      )?.name,
      "reference",
    );
    assertEquals(
      generatedGroupForPath(groups, "schema/discern-config.schema.json")
        ?.name,
      "schemas",
    );
    assertEquals(generatedGroupForPath(groups, "src/main.ts"), undefined);
  });
});

Deno.test("generated records reject unknown keys and empty run commands", () => {
  const unknown = parseConfig(
    '[generated.reference]\npaths = ["reference/**"]\nrun = "tool reference"\nsurprise = true\n',
  );
  assertEquals(unknown.config, undefined);
  const unknownIssue = unknown.issues.find((issue) =>
    issue.path === "generated.reference.surprise"
  );
  assert(unknownIssue !== undefined, JSON.stringify(unknown.issues));
  assertStringIncludes(unknownIssue.message, "unknown key");

  for (const run of ['""', "[]", '["", ":"]']) {
    const empty = parseConfig(
      `[generated.reference]\npaths = ["reference/**"]\nrun = ${run}\n`,
    );
    assertEquals(empty.config, undefined, `${run} must fail`);
    const issue = empty.issues.find((candidate) =>
      candidate.path === "generated.reference.run"
    );
    assert(issue !== undefined, JSON.stringify(empty.issues));
    assertStringIncludes(issue.message, "at least one command");
  }
});

Deno.test("the generated-drift remedy names the group, run command, and nondeterminism signature", () => {
  const params = {
    group: "reference",
    run: "tool write-reference --source source/ --output reference/",
  };
  const remedy = gateFailureRemedy("generated_drift", params);
  assertEquals(remedy.id, GATE_FAILURE_REMEDIES.generated_drift.id);
  assertStringIncludes(remedy.text, "[generated.reference]");
  assertStringIncludes(remedy.text, params.run);
  assertStringIncludes(remedy.text, "commit the regeneration");
  assertStringIncludes(remedy.text, "goes dirty again immediately");
  assertStringIncludes(remedy.text, "same tree did not produce the same bytes");
});

Deno.test("update data accepts optional generated-conflict fields additively", () => {
  const base = {
    behind: 1,
    fast_forward: false,
    commits: [],
    commits_total: 0,
    commits_truncated: false,
    files: [],
    files_total: 0,
    files_truncated: false,
    overlap: [],
    overlap_total: 0,
    scopes_incoming: [],
    range: { base: "base", before: "before", main: "main" },
  };
  assert(UpdateDataSchema.safeParse(base).success);
  assert(
    UpdateDataSchema.safeParse({
      ...base,
      auto_resolved: ["reference/index.md"],
      regenerated: ["reference"],
    }).success,
  );
});
