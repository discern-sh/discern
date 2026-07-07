import { assert, assertEquals } from "@std/assert";
import type { Command } from "@cliffy/command";
import { z } from "@zod/zod";
import {
  buildResultJsonSchema,
  renderResultJsonSchema,
  renderResultTypesDts,
} from "../src/shared/result_codegen.ts";
import {
  CLI_JSON_CONTRACT_EXCLUSIONS,
  CLI_JSON_RESULT_CONTRACTS,
  MCP_RESULT_CONTRACTS,
} from "../src/shared/result_contracts.ts";
import { buildCli } from "../src/main.ts";
import { TOOLS } from "../src/engine/mcp/server.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

Deno.test("schema/discern-results.schema.json matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    new URL("../schema/discern-results.schema.json", import.meta.url),
  );
  assertEquals(
    committed,
    renderResultJsonSchema(),
    "schema/discern-results.schema.json is stale — run `deno task codegen`",
  );
});

Deno.test("types/discern-json.d.ts matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    new URL("../types/discern-json.d.ts", import.meta.url),
  );
  assertEquals(
    committed,
    renderResultTypesDts(),
    "types/discern-json.d.ts is stale — run `deno task codegen`",
  );
});

Deno.test("public result schemas carry literal verb discriminators", () => {
  const schema = buildResultJsonSchema();
  assert(isRecord(schema.$defs), "result schema should carry $defs");
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const typeName = `Discern${pascalCase(contract.id)}Result`;
    const def = schema.$defs[typeName];
    assert(isRecord(def), `${typeName} should be present in $defs`);
    const props = def.properties;
    assert(isRecord(props), `${typeName} should declare properties`);
    const verb = props.verb;
    assert(isRecord(verb), `${typeName}.verb should be a schema`);
    assertEquals(
      verb.const,
      contract.verb,
      `${typeName}.verb should be the contract's literal discriminator`,
    );
  }
});

Deno.test("public result verbs use CLI-style space delimiters, never colons", () => {
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    assert(
      !contract.verb.includes(":"),
      `${contract.id} uses colon-delimited verb ${contract.verb}`,
    );
  }
});

Deno.test("public JSON schema is additive-compatible for output objects", () => {
  const offenders: string[] = [];
  collectClosedOutputMarkers(buildResultJsonSchema(), "$", offenders);
  assertEquals(
    offenders,
    [],
    "public output schema should not publish additionalProperties:false; keep strictness in runtime Zod/MCP schemas instead",
  );
});

Deno.test("public JSON schema exposes reachable CLI and MCP union entrypoints", () => {
  const schema = buildResultJsonSchema();
  assert(isRecord(schema.$defs), "result schema should carry $defs");
  assertEquals(schema.oneOf, [
    { $ref: "#/$defs/DiscernCliJsonResult" },
    { $ref: "#/$defs/DiscernMcpJsonResult" },
  ]);

  const cli = schema.$defs.DiscernCliJsonResult;
  assert(isRecord(cli), "DiscernCliJsonResult should be a schema");
  assertEquals(
    sorted(refsFromOneOf(cli)),
    sorted(
      CLI_JSON_RESULT_CONTRACTS.map((contract) =>
        `#/$defs/Discern${pascalCase(contract.id)}Result`
      ),
    ),
  );
  const discriminator = cli.discriminator;
  assert(isRecord(discriminator), "CLI union should advertise a discriminator");
  assertEquals(discriminator.propertyName, "verb");
  assert(
    isRecord(discriminator.mapping),
    "discriminator should carry a mapping",
  );
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    assertEquals(
      discriminator.mapping[contract.verb],
      `#/$defs/Discern${pascalCase(contract.id)}Result`,
      `${contract.verb} should map to its per-verb schema`,
    );
  }

  const mcp = schema.$defs.DiscernMcpJsonResult;
  assert(isRecord(mcp), "DiscernMcpJsonResult should be a schema");
  assertEquals(
    sorted(refsFromOneOf(mcp)),
    sorted(
      MCP_RESULT_CONTRACTS.map((contract) =>
        `#/$defs/Discern${pascalCase(contract.id)}McpToolResult`
      ),
    ),
  );
});

Deno.test("every registered CLI command is classified as JSON-contracted or intentionally excluded", () => {
  const root = buildCli(false) as unknown as Command;
  const all = collectCommandPaths(root);
  const contracted = CLI_JSON_RESULT_CONTRACTS.flatMap((
    contract,
  ) => [...contract.commands]);
  const classified = new Set([
    ...contracted,
    ...CLI_JSON_CONTRACT_EXCLUSIONS,
  ]);
  assertEquals(
    sorted(all),
    sorted(classified),
    "each CLI command path should either have a public --json result contract or be explicitly excluded",
  );
});

Deno.test("MCP tools use the same schemas as the public result registry", () => {
  const tools = new Map(TOOLS.map((tool) => [tool.name, tool]));
  const contracts = new Map(
    MCP_RESULT_CONTRACTS.map((contract) => [contract.mcpTool, contract]),
  );
  assertEquals(
    sorted(tools.keys()),
    sorted(contracts.keys()),
    "every MCP tool should be represented in the public result contract registry",
  );
  for (const [name, tool] of tools) {
    const contract = contracts.get(name);
    assert(contract !== undefined, `${name} should have a result contract`);
    assert(
      contract.schema instanceof z.ZodObject,
      `${name} result schema should be a Zod object`,
    );
    assertEquals(
      tool.outputSchema,
      contract.schema.shape,
      `${name} should advertise the same output schema the registry publishes`,
    );
  }
});

function collectCommandPaths(root: Command): string[] {
  const out: string[] = [];
  const visit = (command: Command, prefix: string[]): void => {
    for (const child of command.getCommands()) {
      const path = [...prefix, child.getName()];
      out.push(path.join(" "));
      visit(child as unknown as Command, path);
    }
  };
  visit(root, []);
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refsFromOneOf(schema: Record<string, unknown>): string[] {
  assert(Array.isArray(schema.oneOf), "schema should carry oneOf");
  return schema.oneOf.map((entry) => {
    assert(isRecord(entry), "oneOf entry should be a schema object");
    assert(typeof entry.$ref === "string", "oneOf entry should be a $ref");
    return entry.$ref;
  });
}

function collectClosedOutputMarkers(
  value: unknown,
  path: string,
  out: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectClosedOutputMarkers(item, `${path}[${index}]`, out)
    );
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (value.additionalProperties === false) {
    out.push(path);
  }
  for (const [key, child] of Object.entries(value)) {
    collectClosedOutputMarkers(child, `${path}.${key}`, out);
  }
}

function pascalCase(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join("");
}
