import { assert, assertEquals, assertThrows } from "@std/assert";
import { Ajv2020 } from "ajv-2020";
import { Command } from "@cliffy/command";
import { z } from "@zod/zod";
import {
  buildProofNoteJsonSchema,
  buildResultJsonSchema,
  renderProofNoteJsonSchema,
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
  PROOF_NOTE_DSSE_ENVELOPE,
  PROOF_NOTE_DSSE_PROTOCOL,
  PROOF_NOTE_PAYLOAD_DEFINITION,
  PROOF_NOTE_PAYLOAD_TYPE,
  PROOF_NOTE_SCHEMA_ID,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  PUBLIC_SCHEMA_EXTENSION_KEYWORDS,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
  RESULT_SCHEMA_ID,
} from "../src/shared/public_schemas.ts";
import { ERROR_SLUGS } from "../src/shared/result.ts";
import { RESULT_COMPLETION_POLICIES } from "../src/shared/result_completion.ts";
import { buildCli } from "../src/main.ts";
import { TOOLS } from "../src/engine/mcp/server.ts";
import type { DiscernTidyResult } from "../types/discern-json.d.ts";
import {
  renderCliManifest,
  renderConventionsManifest,
  renderMcpToolsManifest,
} from "../scripts/contract_manifests.ts";

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/** Compile generated public artifacts with every discern extension declared. */
function strictPublicSchemaValidator(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateSchema: true,
  });
  for (const keyword of PUBLIC_SCHEMA_EXTENSION_KEYWORDS) {
    ajv.addKeyword(keyword);
  }
  return ajv;
}

const DURABLE_PROOF_FACT_FIELDS = [
  "branch",
  "deletions",
  "files_total",
  "head",
  "insertions",
  "trunk",
] as const;

const DURABLE_PROOF_OPTIONAL_FIELDS = [
  "checkpoint_drops",
  "mode",
  "standard_proposals",
] as const;

const DURABLE_PROOF_PRESENTATION_FIELDS = ["line", "markdown"] as const;

/** Require the signed payload to reference its own closed fact and presentation
 * definitions, so adding a live result field cannot widen the proof contract. */
function assertDurableProofBoundary(schema: Record<string, unknown>): void {
  assert(isRecord(schema.$defs), "proof schema should publish definitions");
  const payload = schema.$defs[PROOF_NOTE_PAYLOAD_DEFINITION];
  assert(isRecord(payload), "proof schema should publish its decoded payload");
  assert(isRecord(payload.properties), "proof payload should declare fields");
  assertEquals(payload.required, ["subject", "proof", "presentation"]);
  assertEquals(payload.properties.proof, {
    $ref: "#/$defs/DiscernProofClaim",
  });
  assertEquals(payload.properties.presentation, {
    $ref: "#/$defs/DiscernProofPresentation",
  });

  const proof = schema.$defs.DiscernProofClaim;
  assert(isRecord(proof), "proof facts should have their own definition");
  assert(isRecord(proof.properties), "proof facts should declare fields");
  assertEquals(
    Object.keys(proof.properties).sort(),
    [...DURABLE_PROOF_FACT_FIELDS, ...DURABLE_PROOF_OPTIONAL_FIELDS].sort(),
  );
  assertEquals(
    [...(Array.isArray(proof.required) ? proof.required : [])].sort(),
    [...DURABLE_PROOF_FACT_FIELDS],
  );

  const presentation = schema.$defs.DiscernProofPresentation;
  assert(
    isRecord(presentation),
    "proof presentation should have its own definition",
  );
  assert(
    isRecord(presentation.properties),
    "proof presentation should declare fields",
  );
  assertEquals(
    Object.keys(presentation.properties).sort(),
    [...DURABLE_PROOF_PRESENTATION_FIELDS],
  );
  assertEquals(
    [...(Array.isArray(presentation.required) ? presentation.required : [])]
      .sort(),
    [...DURABLE_PROOF_PRESENTATION_FIELDS],
  );
}

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

Deno.test("schema/discern-proof-note.schema.json matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    new URL("../schema/discern-proof-note.schema.json", import.meta.url),
  );
  assertEquals(
    committed,
    renderProofNoteJsonSchema(),
    "schema/discern-proof-note.schema.json is stale — run `deno task codegen`",
  );
});

for (
  const [path, render] of [
    ["discern-mcp-tools.json", renderMcpToolsManifest],
    ["discern-cli.json", renderCliManifest],
    ["discern-conventions.json", renderConventionsManifest],
  ] as const
) {
  Deno.test(`schema/${path} matches the live manifest generator`, async () => {
    const committed = await Deno.readTextFile(
      new URL(`../schema/${path}`, import.meta.url),
    );
    assertEquals(
      committed,
      render(),
      `schema/${path} is stale — run \`deno task codegen\``,
    );
  });
}

Deno.test("the proof-note schema publishes one DSSE payload boundary", () => {
  const schema = buildProofNoteJsonSchema();
  assertEquals(schema.$id, PROOF_NOTE_SCHEMA_ID);
  assertEquals(schema["x-discern-payload-type"], PROOF_NOTE_PAYLOAD_TYPE);
  assertEquals(schema["x-discern-dsse-envelope"], PROOF_NOTE_DSSE_ENVELOPE);
  assertEquals(schema["x-discern-dsse-protocol"], PROOF_NOTE_DSSE_PROTOCOL);
  assert(
    typeof schema.description === "string" &&
      !/(?:legacy|pre-correction|bare claim)/i.test(schema.description),
    "the current Proof-note publication must not advertise private formats",
  );
  assert(isRecord(schema.properties), "proof envelope should declare fields");
  const payloadType = schema.properties.payloadType;
  assert(isRecord(payloadType), "proof envelope should declare payloadType");
  assertEquals(payloadType.const, PROOF_NOTE_PAYLOAD_TYPE);
  const payload = schema.properties.payload;
  assert(isRecord(payload), "proof envelope should declare its payload");
  assertEquals(payload.contentEncoding, "base64");
  assertEquals(payload.contentMediaType, "application/json");
  assertEquals(payload.contentSchema, {
    $ref: `#/$defs/${PROOF_NOTE_PAYLOAD_DEFINITION}`,
  });
  const signatures = schema.properties.signatures;
  assert(isRecord(signatures), "proof envelope should declare signatures");
  assertEquals(signatures.type, "array");
  assert(isRecord(signatures.items), "signature entries should have a schema");
  assertEquals(signatures.items.required, ["sig"]);
  assert(isRecord(schema.$defs), "proof schema should publish definitions");
  const claim = schema.$defs[PROOF_NOTE_PAYLOAD_DEFINITION];
  assert(isRecord(claim), "proof schema should publish its decoded payload");
  assertDurableProofBoundary(schema);
});

Deno.test("the durable-proof boundary rejects an unrelated future field", () => {
  const schema = {
    $defs: {
      [PROOF_NOTE_PAYLOAD_DEFINITION]: {
        properties: {
          proof: { $ref: "#/$defs/DiscernProofClaim" },
          presentation: { $ref: "#/$defs/DiscernProofPresentation" },
        },
        required: ["subject", "proof", "presentation"],
      },
      DiscernProofClaim: {
        properties: Object.fromEntries(
          [...DURABLE_PROOF_FACT_FIELDS, ...DURABLE_PROOF_OPTIONAL_FIELDS]
            .map((field) => [field, {}]),
        ),
        required: [...DURABLE_PROOF_FACT_FIELDS],
      },
      DiscernProofPresentation: {
        properties: Object.fromEntries(
          DURABLE_PROOF_PRESENTATION_FIELDS.map((field) => [field, {}]),
        ),
        required: [...DURABLE_PROOF_PRESENTATION_FIELDS],
      },
    },
  };
  assertDurableProofBoundary(schema);

  const futureSibling = structuredClone(schema);
  futureSibling.$defs.DiscernProofClaim.properties.orbit_delay = {
    type: "number",
  };
  assertThrows(
    () => assertDurableProofBoundary(futureSibling),
    Error,
    "orbit_delay",
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

Deno.test("generated result and proof-note schemas compile in strict mode", () => {
  strictPublicSchemaValidator().compile(buildResultJsonSchema());
  strictPublicSchemaValidator().compile(buildProofNoteJsonSchema());
});

Deno.test("the published result schema rejects contradictory envelopes", () => {
  const validate = strictPublicSchemaValidator().compile(
    buildResultJsonSchema(),
  );
  const plan = { title: "Future plan", details: [], steps: [] };
  const steps: unknown[] = [];

  for (
    const contradictory of [
      { ok: true, verb: "tidy", error: "future_error" },
      { ok: false, verb: "tidy", plan, steps },
      { ok: false, verb: "tidy", dry_run: true, steps },
    ]
  ) {
    assert(
      !validate(contradictory),
      `published schema accepted ${JSON.stringify(contradictory)}`,
    );
  }
});

Deno.test("generated result declarations preserve envelope narrowing", () => {
  const failure = {
    ok: false,
    verb: "tidy",
  } satisfies DiscernTidyResult;
  const readError = (result: DiscernTidyResult): string | undefined => {
    if (!result.ok) {
      return result.error;
    }
    const absent: undefined = result.error;
    return absent;
  };
  assertEquals(readError(failure), undefined);

  // @ts-expect-error A generated success result cannot carry a failure slug.
  const successWithError: DiscernTidyResult = {
    ok: true,
    verb: "tidy",
    error: "future_error",
  };
  // @ts-expect-error Generated declarations forbid planned and completed steps.
  const planWithSteps: DiscernTidyResult = {
    ok: false,
    verb: "tidy",
    plan: { title: "Future plan", details: [], steps: [] },
    steps: [],
  };
  // @ts-expect-error Generated previews cannot report completed steps.
  const previewWithSteps: DiscernTidyResult = {
    ok: false,
    verb: "tidy",
    dry_run: true,
    steps: [],
  };
  void successWithError;
  void planWithSteps;
  void previewWithSteps;
});

Deno.test("result contract metadata uses only the canonical schema-reference fields", () => {
  const contracts = buildResultJsonSchema()["x-discern-contracts"];
  assert(Array.isArray(contracts));
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    const generated = contracts.find((value) =>
      isRecord(value) && value.id === contract.id
    );
    assert(isRecord(generated), `${contract.id} should publish metadata`);
    const policy = RESULT_COMPLETION_POLICIES[contract.verb];
    assert(policy !== undefined);
    assertEquals(generated.completion_policy, {
      required_postconditions: [...policy.requiredPostconditions],
      optional_advisories: [...policy.optionalAdvisories],
      refusal: policy.refusal,
      cancellation: policy.cancellation,
      partial_effect: policy.partialEffect,
      no_op: policy.noOp,
      recovery_owner: policy.recoveryOwner,
    });
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

Deno.test("the triangle publication keeps its established contract names", () => {
  const schema = buildResultJsonSchema();
  assert(isRecord(schema.$defs), "result schema should carry $defs");
  const triangle = schema.$defs.DiscernTriangleResult;
  assert(isRecord(triangle), "triangle should publish DiscernTriangleResult");
  assert(isRecord(triangle.properties), "triangle should declare properties");
  assertEquals(triangle.properties.verb, {
    type: "string",
    const: "triangle",
  });
  const data = triangle.properties.data;
  assert(isRecord(data) && Array.isArray(data.anyOf));
  const successData = data.anyOf.find((candidate) =>
    isRecord(candidate) && Array.isArray(candidate.required) &&
    candidate.required.includes("mark")
  );
  assert(isRecord(successData));
  assertEquals(successData.required, ["mark", "art"]);
  assert(isRecord(successData.properties));
  assertEquals(Object.keys(successData.properties), ["mark", "art"]);

  const declarations = renderResultTypesDts();
  assert(declarations.includes("export type DiscernTriangleResult ="));
  assert(declarations.includes('verb: "triangle";'));
});

Deno.test("the manual links generated result declarations to a release tag", async () => {
  const manual = await Deno.readTextFile(
    new URL(
      "../project/manual/30-reference/mcp-and-results.md",
      import.meta.url,
    ),
  );
  assert(
    manual.includes("/blob/v1.0.0/types/discern-json.d.ts"),
    "the public declaration link must identify a published release",
  );
  assert(
    !manual.includes("/blob/main/types/discern-json.d.ts"),
    "a mutable trunk link cannot identify the published declaration contract",
  );
});

Deno.test("generated result declarations are stable under deno fmt", async () => {
  const path = await Deno.makeTempFile({ suffix: ".d.ts" });
  try {
    await Deno.writeTextFile(path, renderResultTypesDts());
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["fmt", "--check", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert(
      output.success,
      new TextDecoder().decode(output.stdout) +
        new TextDecoder().decode(output.stderr),
    );
  } finally {
    await Deno.remove(path);
  }
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
  collectClosedOutputMarkers(
    buildProofNoteJsonSchema(),
    "$proofNote",
    offenders,
  );
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

Deno.test("contract and predicate ids are lowerCamelCase identifiers", () => {
  // The ids seed generated $defs, TypeScript type names, and fixture keys, so
  // they follow one shape: lowerCamelCase, no separators. Two kebab-case
  // predicate ids once slipped through; this holds every current and future id
  // to the sibling convention (setupVerify, patternsReset, worktreePrune, …).
  const ID_SHAPE = /^[a-z][a-zA-Z0-9]*$/;
  for (const contract of CLI_JSON_RESULT_CONTRACTS) {
    assert(
      ID_SHAPE.test(contract.id),
      `contract id "${contract.id}" is not lowerCamelCase`,
    );
    for (const predicate of contract.predicates ?? []) {
      assert(
        ID_SHAPE.test(predicate.id),
        `predicate id "${predicate.id}" is not lowerCamelCase`,
      );
    }
  }
});

Deno.test("CLI JSON exclusions are intentional non-result surfaces with reasons", () => {
  assertEquals(
    CLI_JSON_CONTRACT_EXCLUSIONS.map((entry) => entry.command),
    [
      "mcp",
      "queue",
      "worktree hook",
      "worktree hook create",
      "worktree hook remove",
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
      contract.schema,
      `${name} should advertise the same output schema the registry publishes`,
    );
  }
});

/** Narrow generated schema data to a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Require a discriminated union to consist exclusively of schema references. */
function refsFromOneOf(schema: Record<string, unknown>): string[] {
  assert(Array.isArray(schema.oneOf), "schema should carry oneOf");
  return schema.oneOf.map((entry) => {
    assert(isRecord(entry), "oneOf entry should be a schema object");
    assert(typeof entry.$ref === "string", "oneOf entry should be a $ref");
    return entry.$ref;
  });
}

/** Walk a schema and record every node that closes unknown output properties. */
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

/** Convert mixed identifier separators into the exported type-name form used by codegen. */
function pascalCase(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join("");
}
