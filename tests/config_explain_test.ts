/**
 * `discern config explain` resolves every path form to the prose registry and
 * the schema, carries the project's current value when there is one, and
 * renders one explanation for JSON, Markdown, and the terminal. The core is
 * pure and holds for every documented unit; the subprocess cases prove the
 * command works inside a scaffolded install and outside any project.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import {
  CONFIG_REFERENCE_URL,
  explainConfigPath,
  renderConfigExplanation,
} from "../src/shared/config_explain.ts";
import { configProseUnits } from "../src/shared/config_codegen.ts";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import { RECORD_ENTRY_SCHEMAS } from "../src/shared/config_schema.ts";
import { renderTomlLiteral } from "../src/shared/toml_literal.ts";
import { assertTerminalTextIncludes, runCli, withTempDir } from "./helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

Deno.test("every documented unit explains itself with its what and why", () => {
  for (const unit of configProseUnits()) {
    const explanation = explainConfigPath(unit);
    assert(explanation !== undefined, `${unit} should explain`);
    assertEquals(explanation.path, unit);
    assert(explanation.what !== undefined, `${unit} carries its what`);
    assert(explanation.why !== undefined, `${unit} carries its why`);
    assert(
      explanation.reference.startsWith(`${CONFIG_REFERENCE_URL}#`),
      `${unit} points at the manual`,
    );
    const rendered = renderConfigExplanation(explanation);
    assertStringIncludes(rendered, `What: ${explanation.what}`);
    assertStringIncludes(rendered, "Reference: ");
  }
});

Deno.test("every named-table family explains its entry shape and every knob", () => {
  for (const [family, entrySchema] of Object.entries(RECORD_ENTRY_SCHEMAS)) {
    const explanation = explainConfigPath(`[${family}.<name>]`);
    assert(explanation !== undefined, `${family} should explain its entry`);
    assertEquals(explanation.kind, "family", family);
    assertEquals(
      explanation.params,
      Object.keys(entrySchema.shape),
      `${family} should list every entry knob`,
    );
    for (const knob of Object.keys(entrySchema.shape)) {
      const key = explainConfigPath(`${family}.<name>.${knob}`);
      assert(key !== undefined, `${family}.<name>.${knob} should explain`);
      assertEquals(key.kind, "key", `${family}.<name>.${knob}`);
    }
  }

  const standards = explainConfigPath("[standards.<name>]");
  assert(standards !== undefined);
  assert(
    (standards.examples?.length ?? 0) >= 2,
    "the manual's examples travel",
  );
  assertEquals(explainConfigPath("standards")?.path, "standards");
  assertEquals(
    explainConfigPath("jobs")?.params,
    Object.keys(RECORD_ENTRY_SCHEMAS.jobs.shape),
    "the hybrid [jobs] section includes its custom-job params",
  );
});

Deno.test("a section key explains its type, default, and section", () => {
  const key = explainConfigPath("gate.timeout");
  assert(key !== undefined);
  assertEquals(key.kind, "key");
  assertEquals(key.type, "number");
  assertEquals(key.default, "600");
  assertStringIncludes(key.description ?? "", "seconds");
  assertStringIncludes(renderConfigExplanation(key), "Default: 600.");
  assertStringIncludes(renderConfigExplanation(key), "Its section:");
});

Deno.test("a known job explains as a key of [jobs]", () => {
  for (const name of Object.keys(KNOWN_JOBS)) {
    const key = explainConfigPath(`jobs.${name}`);
    assert(key !== undefined, `jobs.${name} should explain`);
    assertEquals(key.kind, "key");
    assertEquals(key.path, `jobs.${name}`);
  }
});

Deno.test("a family knob and a named entry resolve through the entry shape", () => {
  const current = parseToml(`[scopes.map]
paths = ["docs/**"]
neutral = true
`) as Record<string, unknown>;
  const knob = explainConfigPath("scopes.<name>.paths");
  assert(knob !== undefined);
  assertEquals(knob.path, "scopes.<name>.paths");
  assertEquals(knob.kind, "key");

  const entry = explainConfigPath("scopes.map", current);
  assert(entry !== undefined);
  assertEquals(entry.kind, "family");
  assertStringIncludes(entry.value ?? "", 'paths = ["docs/**"]');

  // The whole family renders each entry under its full dotted header.
  const family = explainConfigPath("scopes", current);
  assertStringIncludes(family?.value ?? "", "[scopes.map]\n");

  const entryKnob = explainConfigPath("scopes.map.neutral", current);
  assert(entryKnob !== undefined);
  assertEquals(entryKnob.value, "true");
});

Deno.test("every supported TOML literal shape round-trips through the live parser", () => {
  const values: unknown[] = [
    "plain",
    "line one\nline two\n",
    "tab\there and a carriage\rreturn",
    'quotes " and slash \\',
    true,
    -0.5,
    42,
    [],
    ["one", "line one\nline two"],
    {},
    { lines: "src/**" },
    { "quoted.key": "value", nested: { enabled: true } },
  ];
  for (const value of values) {
    const literal = renderTomlLiteral(value);
    const parsed = parseToml(`value = ${literal}`) as { value?: unknown };
    assertEquals(parsed.value, value, JSON.stringify(value));
  }
});

Deno.test("current config documents round-trip with their full named-entry paths", () => {
  const cases = [
    {
      path: "standards.demo",
      current: parseToml(`[standards.demo]
metric = "coverage"
direction = "up"
limit = 80
per = { lines = "src/**" }
scale = 1000
run = "echo"
`) as Record<string, unknown>,
    },
    {
      path: "checkpoints.custom",
      current: parseToml(`[checkpoints.custom]
paths = ["src/**"]
question = """
What could break?
What protects it?
"""
`) as Record<string, unknown>,
    },
  ];

  for (const { path, current } of cases) {
    const explanation = explainConfigPath(path, current);
    assert(explanation?.value !== undefined, `${path} should carry its value`);
    assertEquals(
      parseToml(explanation.value),
      current,
      `${path} should render the same config tree it read`,
    );
  }
});

Deno.test("an unknown path explains nothing", () => {
  assertEquals(explainConfigPath("nope"), undefined);
  assertEquals(explainConfigPath("gate.nope"), undefined);
  assertEquals(explainConfigPath("scopes.<name>.nope"), undefined);
  assertEquals(explainConfigPath(""), undefined);
});

Deno.test("config explain runs inside an install with the current value, and outside one without", async () => {
  await withTempDir(async (dir) => {
    const setup = await runCli(
      [
        "setup",
        "begin",
        "--confirmed",
        "--slug",
        "demo",
        "--name",
        "Demo",
      ],
      dir,
    );
    assertEquals(setup.code, 0, setup.stderr);
    const inside = await runCli(
      ["config", "explain", "gate.timeout", "--json"],
      dir,
    );
    assertEquals(inside.code, 0, inside.stderr);
    const result = decodeCliResult(inside.stdout, "config");
    assert(result.ok);
    const data = result.data as { operation: string; value?: string };
    assertEquals(data.operation, "explain");
    assertEquals(data.value, "600");

    const human = await runCli(["config", "explain", "scopes"], dir);
    assertEquals(human.code, 0, human.stderr);
    assertTerminalTextIncludes(human.stdout, "# [scopes.<name>]");
    assertTerminalTextIncludes(
      human.stdout,
      "What: Named regions of the repository.",
    );

    const unknown = await runCli(["config", "explain", "nope"], dir);
    assertEquals(unknown.code, 1);
  });
  await withTempDir(async (dir) => {
    const outside = await runCli(
      ["config", "explain", "worktree.resources", "--json"],
      dir,
    );
    assertEquals(outside.code, 0, outside.stderr);
    const result = decodeCliResult(outside.stdout, "config");
    assert(result.ok);
    const data = result.data as { kind: string; value?: string };
    assertEquals(data.kind, "family");
    assertEquals(data.value, undefined);
  });
});
