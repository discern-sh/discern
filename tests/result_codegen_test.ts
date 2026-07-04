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
import { FEATURES } from "../src/shared/features.ts";
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

Deno.test("every registered CLI command is classified as JSON-contracted or intentionally excluded", () => {
  const root = buildCli(new Set(FEATURES), false) as unknown as Command;
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

function pascalCase(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join("");
}
