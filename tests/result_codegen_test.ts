import { assert, assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { z } from "@zod/zod";
import {
  buildResultJsonSchema,
  renderResultJsonSchema,
  renderResultTypesDts,
} from "../src/shared/result_codegen.ts";
import {
  CLI_JSON_CONTRACT_EXCLUSIONS,
  CLI_JSON_PREDICATE_CONTRACTS,
  CLI_JSON_RESULT_CONTRACTS,
  CLI_PREDICATE_INVOCATION_MODES,
  CLI_PREDICATE_STATES,
  cliJsonContractCoverage,
  MCP_RESULT_CONTRACTS,
  normalizeCliCommandPath,
  RESULT_CONTRACT_REFERENCE_FIELDS,
} from "../src/shared/result_contracts.ts";
import {
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
  RESULT_SCHEMA_ID,
} from "../src/shared/public_schemas.ts";
import { ERROR_SLUGS } from "../src/shared/result.ts";
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

Deno.test("the generated result schema carries its public identity and policy", () => {
  const schema = buildResultJsonSchema();
  assertEquals(schema.$id, RESULT_SCHEMA_ID);
  assertEquals(
    schema[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY],
    RESULT_SCHEMA_COMPATIBILITY_POLICY,
  );
});

Deno.test("result contract metadata uses only the canonical schema-reference fields", () => {
  const contracts = buildResultJsonSchema()["x-discern-contracts"];
  assert(Array.isArray(contracts));
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const generated = contracts.find((value) =>
      isRecord(value) && value.id === contract.id
    );
    assert(isRecord(generated), `${contract.id} should publish metadata`);
    const referenceFields = Object.entries(generated)
      .filter(([, value]) =>
        typeof value === "string" && value.startsWith("#/$defs/")
      )
      .map(([field]) => field)
      .sort();
    assertEquals(
      referenceFields,
      [
        RESULT_CONTRACT_REFERENCE_FIELDS.cli,
        ...(contract.mcpTool === undefined
          ? []
          : [RESULT_CONTRACT_REFERENCE_FIELDS.mcp]),
      ].sort(),
      `${contract.id} should publish only its semantic CLI/MCP references`,
    );
  }
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

Deno.test("public result contracts publish known error slugs without closing the field", () => {
  const schema = buildResultJsonSchema();
  assertEquals(schema["x-discern-error-slugs"], [...ERROR_SLUGS]);
  assert(isRecord(schema.$defs), "result schema should carry $defs");
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const typeName = `Discern${pascalCase(contract.id)}Result`;
    const def = schema.$defs[typeName];
    assert(isRecord(def), `${typeName} should be present in $defs`);
    assert(isRecord(def.properties), `${typeName} should declare properties`);
    const error = def.properties.error;
    assert(isRecord(error), `${typeName}.error should be a schema`);
    assertEquals(
      error,
      { type: "string" },
      `${typeName}.error must accept future slugs in the public schema`,
    );
  }

  const types = renderResultTypesDts();
  const alias = types.match(
    /export type DiscernKnownErrorSlug =\n?([\s\S]*?);\n\n/,
  );
  assert(
    alias !== null,
    "generated types should publish the known-error union",
  );
  const members = [...(alias[0].matchAll(/"([^"]+)"/g))]
    .map((match) => match[1]);
  assertEquals(members, [...ERROR_SLUGS]);
  assert(
    !types.includes("error?:\n    |"),
    "generated envelope error fields should remain forward-compatible strings",
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
  assertEquals(
    cliJsonContractCoverage(root),
    {
      uncontracted: [],
      staleContracts: [],
      staleExclusions: [],
      overlaps: [],
      duplicateContracts: [],
      duplicateExclusions: [],
      nonCanonicalDeclarations: [],
      reasonlessExclusions: [],
    },
    "each canonical CLI command path should have exactly one public --json result contract or one explicit protocol exclusion",
  );
});

Deno.test("predicate invocation contracts publish their subject and boolean payload paths", () => {
  const owners = new Map<string, string>();
  const ids = new Set<string>();
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    for (const command of contract.commands) {
      owners.set(command, contract.verb);
    }
  }
  for (const predicate of CLI_JSON_PREDICATE_CONTRACTS) {
    assert(
      !ids.has(predicate.id),
      `duplicate predicate contract id: ${predicate.id}`,
    );
    ids.add(predicate.id);
    assertEquals(
      owners.get(predicate.command),
      predicate.verb,
      `${predicate.id} must belong to a command path owned by its envelope verb`,
    );
    assert(
      predicate.subjectPath.length > 0 &&
        predicate.subjectPath.every((segment) => segment.length > 0),
      `${predicate.id} needs a non-empty subject payload path`,
    );
    assert(
      predicate.presentPath.length > 0 &&
        predicate.presentPath.every((segment) => segment.length > 0),
      `${predicate.id} needs a non-empty boolean payload path`,
    );
    if (predicate.option !== undefined) {
      assert(
        predicate.option.startsWith("--"),
        `${predicate.id} option must use its long CLI spelling`,
      );
    }
  }
  assert(CLI_JSON_PREDICATE_CONTRACTS.length > 0);
  assert(CLI_PREDICATE_INVOCATION_MODES.length > 0);
  assertEquals(CLI_PREDICATE_STATES, ["true", "false"]);
});

Deno.test("CLI JSON exclusions are intentional non-result surfaces with reasons", () => {
  assertEquals(
    CLI_JSON_CONTRACT_EXCLUSIONS.map((entry) => entry.command),
    [
      "help",
      "mcp",
      "worktree create",
      "worktree remove",
      "worktree ensure",
    ],
  );
  for (const entry of CLI_JSON_CONTRACT_EXCLUSIONS) {
    assert(
      entry.reason.trim().length > 0,
      `${entry.command} needs an exclusion reason`,
    );
  }
});

Deno.test("a future nested command under an enrolled parent is uncontracted automatically", () => {
  const root = buildCli(false) as unknown as Command;
  const config = root.getCommands(true).find((command) =>
    command.getName() === "config"
  );
  assert(config !== undefined, "config command group should exist");
  config.command("zz-future", new Command());
  assertEquals(
    cliJsonContractCoverage(root).uncontracted,
    ["config zz-future"],
  );
});

Deno.test("command aliases normalize to their canonical JSON contract path", () => {
  const root = new Command().name("fixture");
  const parent = new Command().alias("cfg");
  parent.command("read", new Command().alias("r"));
  root.command("config", parent);

  assertEquals(normalizeCliCommandPath(root, "config read"), "config read");
  assertEquals(normalizeCliCommandPath(root, "cfg r"), "config read");
  assertEquals(normalizeCliCommandPath(root, "cfg missing"), undefined);
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
