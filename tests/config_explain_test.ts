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
import { runCli, withTempDir } from "./helpers.ts";
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

Deno.test("a named-table family lists its params and every worked example", () => {
  const family = explainConfigPath("[standards.<name>]");
  assert(family !== undefined);
  assertEquals(family.kind, "family");
  assertEquals(family.params?.[0], "metric");
  assert((family.examples?.length ?? 0) >= 2, "the manual's examples travel");
  assertEquals(explainConfigPath("standards")?.path, "standards");
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

  const entryKnob = explainConfigPath("scopes.map.neutral", current);
  assert(entryKnob !== undefined);
  assertEquals(entryKnob.value, "true");
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
      ["setup", "--confirmed", "--yes", "--slug", "demo", "--name", "Demo"],
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
    assertStringIncludes(human.stdout, "# [scopes.<name>]");
    assertStringIncludes(
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
