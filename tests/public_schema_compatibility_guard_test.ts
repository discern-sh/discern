/**
 * Same-major public schema compatibility.
 *
 * The live guard compares generated artifacts with the released baseline. Pure
 * controls use unrelated field and contract names so the predicate proves the
 * class rather than memorizing today's result definitions.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Ajv2020 } from "ajv-2020";
import { z } from "@zod/zod";
import {
  buildCurrentPublicSchema,
  initialPublicationIssues,
  type JsonObject,
  type JsonValue,
  publicSchemaArtifactEnrollmentIssues,
  publicSchemaBaselineTag,
  publicSchemaCompatibilityIssues,
  publicSchemaPublicationCompatibilityIssues,
  publicSchemaPublicationIdentityIssues,
} from "../scripts/public_schema_compatibility.ts";
import {
  CLI_COMPATIBILITY_POLICY,
  CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  CONVENTIONS_COMPATIBILITY_POLICY,
  MCP_TOOLS_COMPATIBILITY_POLICY,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  PUBLIC_SCHEMA_PUBLICATIONS,
  type PublicSchemaPublication,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
} from "../src/shared/public_schemas.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { RESULT_CONTRACT_REFERENCE_FIELDS } from "../src/shared/result_contracts.ts";
import { buildConfigDocJsonSchema } from "../src/shared/config_codegen.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
);
const JsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  JsonValueSchema,
);

/** Narrow JSON to an object record. */
function isRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-copy a JSON Schema fixture so each mutation case remains isolated. */
function clone(value: JsonObject): JsonObject {
  return structuredClone(value);
}

interface LocatedJsonObject {
  readonly path: string;
  readonly value: JsonObject;
}

/** Walk every object in a generated schema graph with a stable diagnostic path. */
function jsonObjects(
  value: JsonValue,
  path = "$",
): LocatedJsonObject[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      jsonObjects(item, `${path}[${index}]`)
    );
  }
  if (!isRecord(value)) return [];
  return [
    { path, value },
    ...Object.entries(value).flatMap(([key, item]) =>
      jsonObjects(item, `${path}.${key}`)
    ),
  ];
}

/** Split a generated PascalCase definition name into semantic word segments. */
function definitionSegments(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

/** Compile a schema and test one instance through the production validator dialect. */
function accepts(schema: JsonObject, value: JsonValue): boolean {
  const result = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: true,
  }).compile(schema)(value);
  if (typeof result !== "boolean") {
    throw new Error("the public schema fixture must validate synchronously");
  }
  return result;
}

/** Require schema compilation to fail and preserve its diagnostic message. */
function compileError(schema: JsonObject): string {
  const error = assertThrows(() =>
    new Ajv2020({
      allErrors: true,
      strict: false,
      validateSchema: true,
    }).compile(schema)
  );
  return error instanceof Error ? error.message : String(error);
}

/** Capture a schema compilation failure without turning success into an exception. */
function compileErrorOrUndefined(
  schema: JsonObject,
): string | undefined {
  try {
    new Ajv2020({
      allErrors: true,
      strict: false,
      validateSchema: true,
    }).compile(schema);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const CONFIG_INPUT_FIXTURE: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://discern.sh/schema/v1/voyage-config.schema.json",
  [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]: CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  type: "object",
  properties: {
    beacon: { type: "string" },
    channel: {
      type: ["string", "number"],
    },
  },
  required: ["beacon"],
  additionalProperties: false,
};

const RESULT_OUTPUT_FIXTURE: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://discern.sh/schema/v1/voyage-results.schema.json",
  [PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY]: RESULT_SCHEMA_COMPATIBILITY_POLICY,
  oneOf: [
    { $ref: "#/$defs/VoyageCliResult" },
    { $ref: "#/$defs/VoyageMcpResult" },
  ],
  $defs: {
    VoyageCliResult: {
      oneOf: [{ $ref: "#/$defs/VoyageLaunchResult" }],
    },
    VoyageMcpResult: {
      oneOf: [{ $ref: "#/$defs/VoyageLaunchMcpToolResult" }],
    },
    VoyageLaunchMcpToolResult: {
      type: "object",
      properties: {
        structuredContent: { $ref: "#/$defs/VoyageLaunchResult" },
      },
      required: ["structuredContent"],
    },
    VoyageStringSignal: {
      type: "string",
    },
    VoyageNumericSignal: {
      type: "number",
    },
    VoyageLaunchResult: {
      type: "object",
      properties: {
        verb: { const: "launch" },
        ok: { type: "boolean" },
        signal: {
          oneOf: [
            { $ref: "#/$defs/VoyageStringSignal" },
            { $ref: "#/$defs/VoyageNumericSignal" },
          ],
        },
      },
      required: ["verb", "ok"],
    },
  },
  "x-discern-contracts": [
    {
      id: "voyageLaunch",
      verb: "launch",
      commands: ["launch"],
      mcp_tool: "voyage_launch",
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageLaunchResult",
      [RESULT_CONTRACT_REFERENCE_FIELDS.mcp]:
        "#/$defs/VoyageLaunchMcpToolResult",
    },
  ],
  "x-discern-error-slugs": ["launch_failed"],
};

const VOYAGE_PUBLICATION: PublicSchemaPublication = {
  id: "https://discern.sh/schema/v1/voyage-results.schema.json",
  artifactPath: "schema/voyage-results.schema.json",
  major: 1,
  compatibility: RESULT_SCHEMA_COMPATIBILITY_POLICY,
  label: "voyage results",
  contract: "voyage result envelopes",
};

/**
 * Deliberately hand-typed contract-major tripwire. This is test evidence, not
 * a runtime registry: changing an existing row means an explicit major-version
 * decision, while adding a publication requires consciously adding its row.
 */
const FROZEN_V1_PUBLICATION_MAJORS = [
  ["schema/discern-releases.schema.json", 1],
  ["schema/discern-config.schema.json", 1],
  ["schema/discern-setup-config.schema.json", 1],
  ["schema/discern-results.schema.json", 1],
  ["schema/discern-proof-note.schema.json", 1],
  ["schema/discern-mcp-tools.json", 1],
  ["schema/discern-cli.json", 1],
  ["schema/discern-conventions.json", 1],
] as const;

Deno.test("the hand-typed public contract table pins every v1 major", () => {
  assertEquals(
    PUBLIC_SCHEMA_PUBLICATIONS.map((publication) =>
      [
        publication.artifactPath,
        publication.major,
      ] as const
    ),
    [...FROZEN_V1_PUBLICATION_MAJORS],
  );
});

Deno.test("same-major compatibility catches removed fields, type changes, and required-field changes", () => {
  const removed = clone(CONFIG_INPUT_FIXTURE);
  const removedProperties = removed.properties as JsonObject;
  delete removedProperties.beacon;
  assertEquals(
    publicSchemaCompatibilityIssues(
      CONFIG_INPUT_FIXTURE,
      removed,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ),
    ["$.properties.beacon: removed"],
  );

  const narrowed = clone(CONFIG_INPUT_FIXTURE);
  const narrowedProperties = narrowed.properties as JsonObject;
  narrowedProperties.channel = { type: "string" };
  assert(
    publicSchemaCompatibilityIssues(
      CONFIG_INPUT_FIXTURE,
      narrowed,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ).some((issue) => issue.startsWith("$.properties.channel.type:")),
  );

  const required = clone(CONFIG_INPUT_FIXTURE);
  required.required = ["beacon", "future"];
  assertEquals(
    publicSchemaCompatibilityIssues(
      CONFIG_INPUT_FIXTURE,
      required,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ),
    ['$.required: added required field "future"'],
  );
});

Deno.test("config compatibility permits optional keys without promising old caches accept them", () => {
  const current = clone(CONFIG_INPUT_FIXTURE);
  const properties = current.properties as JsonObject;
  properties.antenna = { type: "boolean" };
  current.required = [];
  assertEquals(
    publicSchemaCompatibilityIssues(
      CONFIG_INPUT_FIXTURE,
      current,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
  );
});

Deno.test("config property additions preserve values admitted by the parent catchall", () => {
  const previous = buildConfigDocJsonSchema() as JsonObject;
  const current = clone(previous);
  const rootProperties = current.properties as JsonObject;
  const jobs = rootProperties.jobs as JsonObject;
  const jobArms = jobs.allOf as JsonObject[];
  const namedJobs = jobArms.find((arm) => {
    const properties = arm.properties;
    return typeof properties === "object" &&
      properties !== null &&
      !Array.isArray(properties);
  });
  assert(namedJobs !== undefined);
  const knownJobs = namedJobs.properties as JsonObject;
  knownJobs.voyage = clone(knownJobs.format as JsonObject);

  const existingCustomJob = {
    jobs: {
      voyage: {
        stage: "check",
        run: "voyage inspect",
      },
    },
  } satisfies JsonObject;
  assert(
    accepts(previous, existingCustomJob),
    "the trunk catchall must admit the existing custom job",
  );
  assertEquals(
    accepts(current, existingCustomJob),
    false,
    "the new named-job schema narrows that existing custom job",
  );
  const issues = publicSchemaCompatibilityIssues(
    previous,
    current,
    CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  );
  assert(
    issues.some((issue) =>
      issue.includes(".properties.voyage:") &&
      issue.includes("additionalProperties")
    ),
    `expected the open-parent narrowing issue, got ${JSON.stringify(issues)}`,
  );

  const openPrevious: JsonObject = {
    type: "object",
    additionalProperties: true,
  };
  const openCurrent = clone(openPrevious);
  openCurrent.properties = {
    voyage: { type: "string" },
  };
  assert(accepts(openPrevious, { voyage: 7 }));
  assertEquals(accepts(openCurrent, { voyage: 7 }), false);
  assert(
    publicSchemaCompatibilityIssues(
      openPrevious,
      openCurrent,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ).some((issue) =>
      issue.includes(".properties.voyage:") &&
      issue.includes("additionalProperties")
    ),
    "a true catchall must remain open at a newly named property",
  );
});

Deno.test("config property additions may preserve an open parent's accepted values", () => {
  const controls: {
    readonly name: string;
    readonly additionalProperties?: JsonValue;
    readonly added: JsonValue;
  }[] = [
    {
      name: "same schema",
      additionalProperties: { type: "string" },
      added: { type: "string" },
    },
    {
      name: "default remains an annotation",
      additionalProperties: { type: "string" },
      added: { type: "string", default: "clear" },
    },
    {
      name: "schema catchall widened to true",
      additionalProperties: { type: "string" },
      added: true,
    },
    {
      name: "schema catchall widened to an empty schema",
      additionalProperties: { type: "string" },
      added: {},
    },
    {
      name: "true remains unconstrained",
      additionalProperties: true,
      added: {},
    },
    {
      name: "omitted remains unconstrained",
      added: true,
    },
  ];
  for (const control of controls) {
    const previous: JsonObject = {
      type: "object",
      properties: {
        existing: { type: "string" },
      },
      ...(control.additionalProperties === undefined
        ? {}
        : { additionalProperties: control.additionalProperties }),
    };
    const current = clone(previous);
    const properties = current.properties as JsonObject;
    properties.future = control.added;
    assertEquals(
      publicSchemaCompatibilityIssues(
        previous,
        current,
        CONFIG_SCHEMA_COMPATIBILITY_POLICY,
      ),
      [],
      control.name,
    );
  }
});

Deno.test("config defaults are structural while result defaults remain annotations", () => {
  const previousConfig = clone(CONFIG_INPUT_FIXTURE);
  const currentConfig = clone(CONFIG_INPUT_FIXTURE);
  ((previousConfig.properties as JsonObject).beacon as JsonObject).default =
    "north";
  ((currentConfig.properties as JsonObject).beacon as JsonObject).default =
    "south";
  assertEquals(
    publicSchemaCompatibilityIssues(
      previousConfig,
      currentConfig,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ),
    ['$.properties.beacon.default: changed from "north" to "south"'],
  );

  const previousResult = clone(RESULT_OUTPUT_FIXTURE);
  const currentResult = clone(RESULT_OUTPUT_FIXTURE);
  const previousSignal = (previousResult.$defs as JsonObject)
    .VoyageStringSignal as JsonObject;
  const currentSignal = (currentResult.$defs as JsonObject)
    .VoyageStringSignal as JsonObject;
  previousSignal.default = "north";
  currentSignal.default = "south";
  assertEquals(
    publicSchemaCompatibilityIssues(
      previousResult,
      currentResult,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
  );
});

Deno.test("config catchall inclusion permits a named type-set superset", () => {
  const previous: JsonObject = {
    type: "object",
    additionalProperties: { type: "string" },
  };
  const current = clone(previous);
  current.properties = {
    signal: { type: ["string", "number"] },
  };

  assert(accepts(previous, { signal: "clear" }));
  assert(accepts(current, { signal: "clear" }));
  assertEquals(accepts(previous, { signal: 7 }), false);
  assert(accepts(current, { signal: 7 }));
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
  );
});

Deno.test("catchall type-set widening stays directional and config-only", () => {
  const previous: JsonObject = {
    type: "object",
    additionalProperties: { type: ["string", "number"] },
  };
  const current = clone(previous);
  current.properties = {
    signal: { type: "string" },
  };
  assert(accepts(previous, { signal: 7 }));
  assertEquals(accepts(current, { signal: 7 }), false);
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("additionalProperties")),
  );

  const resultCurrent = clone(RESULT_OUTPUT_FIXTURE);
  const resultDefs = resultCurrent.$defs as JsonObject;
  const launch = resultDefs.VoyageLaunchResult as JsonObject;
  const properties = launch.properties as JsonObject;
  properties.ok = { type: ["boolean", "string"] };
  assertEquals(
    accepts(RESULT_OUTPUT_FIXTURE, { verb: "launch", ok: "yes" }),
    false,
  );
  assert(accepts(resultCurrent, { verb: "launch", ok: "yes" }));
  assert(
    publicSchemaCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
      resultCurrent,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).some((issue) =>
      issue.startsWith(
        "$.$defs.VoyageLaunchResult.properties.ok.type:",
      )
    ),
  );
});

Deno.test("result compatibility permits optional fields, new CLI and MCP contracts, and new error slugs", () => {
  const previous = clone(RESULT_OUTPUT_FIXTURE);
  const current = clone(previous);
  const defs = current.$defs as JsonObject;
  const launch = defs.VoyageLaunchResult as JsonObject;
  const launchProperties = launch.properties as JsonObject;
  launchProperties.elapsed = { type: "number" };
  defs.VoyageLandResult = {
    type: "object",
    properties: {
      verb: { const: "land" },
      ok: { type: "boolean" },
    },
    required: ["verb", "ok"],
  };
  defs.VoyageLandMcpToolResult = {
    type: "object",
    properties: {
      structuredContent: { $ref: "#/$defs/VoyageLandResult" },
    },
    required: ["structuredContent"],
  };
  const cli = defs.VoyageCliResult as JsonObject;
  cli.oneOf = [
    { $ref: "#/$defs/VoyageLandResult" },
    ...(cli.oneOf as JsonValue[]),
  ];
  const mcp = defs.VoyageMcpResult as JsonObject;
  mcp.oneOf = [
    { $ref: "#/$defs/VoyageLandMcpToolResult" },
    ...(mcp.oneOf as JsonValue[]),
  ];
  current["x-discern-contracts"] = [
    {
      id: "voyageLand",
      verb: "land",
      commands: ["land"],
      mcp_tool: "voyage_land",
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageLandResult",
      [RESULT_CONTRACT_REFERENCE_FIELDS.mcp]: "#/$defs/VoyageLandMcpToolResult",
    },
    ...(current["x-discern-contracts"] as JsonValue[]),
  ];
  current["x-discern-error-slugs"] = [
    ...(current["x-discern-error-slugs"] as string[]),
    "landing_failed",
  ];

  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
  );
});

Deno.test("adding a discriminated state constraint is a same-major result break", () => {
  const current = clone(RESULT_OUTPUT_FIXTURE);
  const defs = current.$defs as JsonObject;
  defs.VoyageResultState = {
    oneOf: [
      {
        type: "object",
        properties: {
          ok: { const: true },
          fault: { not: {} },
        },
        required: ["ok"],
      },
      {
        type: "object",
        properties: {
          ok: { const: false },
          fault: { type: "string" },
        },
        required: ["ok"],
      },
    ],
  };
  const launch = defs.VoyageLaunchResult as JsonObject;
  launch.allOf = [{ $ref: "#/$defs/VoyageResultState" }];

  const contradiction = {
    verb: "launch",
    ok: true,
    fault: "future-orbit",
  } satisfies JsonObject;
  assert(accepts(RESULT_OUTPUT_FIXTURE, contradiction));
  assertEquals(accepts(current, contradiction), false);
  assertEquals(
    publicSchemaCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [
      '$.$defs.VoyageLaunchResult.allOf: changed from undefined to [{"$ref":"#/$defs/VoyageResultState"}]',
    ],
  );
});

Deno.test("ordinary open result objects permit optional fields", () => {
  for (const additionalProperties of [undefined, true] as const) {
    const previous = clone(RESULT_OUTPUT_FIXTURE);
    const previousDefs = previous.$defs as JsonObject;
    const previousLaunch = previousDefs.VoyageLaunchResult as JsonObject;
    if (additionalProperties !== undefined) {
      previousLaunch.additionalProperties = additionalProperties;
    }
    const current = clone(previous);
    const defs = current.$defs as JsonObject;
    const launch = defs.VoyageLaunchResult as JsonObject;
    const properties = launch.properties as JsonObject;
    properties.elapsed = { type: "number" };
    const result = {
      verb: "launch",
      ok: true,
      elapsed: "legacy",
    } satisfies JsonObject;

    assert(accepts(previous, result));
    assertEquals(accepts(current, result), false);
    assertEquals(
      publicSchemaCompatibilityIssues(
        previous,
        current,
        RESULT_SCHEMA_COMPATIBILITY_POLICY,
      ),
      [],
      `ordinary result with additionalProperties ${
        String(additionalProperties)
      } permits an optional field`,
    );
  }
});

Deno.test("result-role aggregate property additions stay closed", () => {
  const previous = clone(RESULT_OUTPUT_FIXTURE);
  const current = clone(previous);
  const defs = current.$defs as JsonObject;
  const aggregate = defs.VoyageCliResult as JsonObject;
  aggregate.properties = {
    verb: { const: "other" },
  };
  const launch = { verb: "launch", ok: true } satisfies JsonObject;

  assert(accepts(previous, launch));
  assertEquals(accepts(current, launch), false);
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).some((issue) =>
      issue.includes(
        "$.$defs.VoyageCliResult.properties.verb:",
      )
    ),
    "a result-role aggregate cannot gain a property constraint",
  );
});

Deno.test("new contract references widen only their canonical role aggregates", () => {
  const cases = [
    {
      role: "cli",
      previousReference: "#/$defs/VoyageLaunchResult",
      addedReference: "#/$defs/VoyageLandResult",
    },
    {
      role: "mcp",
      previousReference: "#/$defs/VoyageLaunchMcpToolResult",
      addedReference: "#/$defs/VoyageLandMcpToolResult",
    },
  ] as const;
  const results = Object.fromEntries(cases.map((control) => {
    const previous = clone(RESULT_OUTPUT_FIXTURE);
    const previousDefs = previous.$defs as JsonObject;
    const previousLaunch = previousDefs.VoyageLaunchResult as JsonObject;
    const previousProperties = previousLaunch.properties as JsonObject;
    previousProperties.lookalike = {
      oneOf: [{ $ref: control.previousReference }],
    };

    const current = clone(previous);
    const currentDefs = current.$defs as JsonObject;
    currentDefs.VoyageLandResult = {
      type: "object",
      properties: {
        verb: { const: "land" },
        ok: { type: "boolean" },
      },
      required: ["verb", "ok"],
    };
    currentDefs.VoyageLandMcpToolResult = {
      type: "object",
      properties: {
        structuredContent: { $ref: "#/$defs/VoyageLandResult" },
      },
      required: ["structuredContent"],
    };
    const currentCli = currentDefs.VoyageCliResult as JsonObject;
    (currentCli.oneOf as JsonValue[]).push({
      $ref: "#/$defs/VoyageLandResult",
    });
    const currentMcp = currentDefs.VoyageMcpResult as JsonObject;
    (currentMcp.oneOf as JsonValue[]).push({
      $ref: "#/$defs/VoyageLandMcpToolResult",
    });
    const currentLaunch = currentDefs.VoyageLaunchResult as JsonObject;
    const currentProperties = currentLaunch.properties as JsonObject;
    const lookalike = currentProperties.lookalike as JsonObject;
    (lookalike.oneOf as JsonValue[]).push({
      $ref: control.addedReference,
    });
    (current["x-discern-contracts"] as JsonValue[]).push({
      id: "voyageLand",
      verb: "land",
      commands: ["land"],
      mcp_tool: "voyage_land",
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageLandResult",
      [RESULT_CONTRACT_REFERENCE_FIELDS.mcp]: "#/$defs/VoyageLandMcpToolResult",
    });

    return [
      control.role,
      publicSchemaCompatibilityIssues(
        previous,
        current,
        RESULT_SCHEMA_COMPATIBILITY_POLICY,
      ),
    ];
  }));

  assertEquals(results, {
    cli: [
      '$.$defs.VoyageLaunchResult.properties.lookalike.oneOf: added alternative {"$ref":"#/$defs/VoyageLandResult"}',
    ],
    mcp: [
      '$.$defs.VoyageLaunchResult.properties.lookalike.oneOf: added alternative {"$ref":"#/$defs/VoyageLandMcpToolResult"}',
    ],
  });
});

Deno.test("contract widening requires one top-level entrypoint to reach the role aggregate", () => {
  const controls: {
    readonly name: string;
    readonly addEntrypoint: (schema: JsonObject) => void;
  }[] = [
    {
      name: "constrained ref sibling",
      addEntrypoint: (schema) => {
        (schema.oneOf as JsonValue[]).push({
          $ref: "#/$defs/VoyageCliResult",
          properties: {
            verb: { const: "land" },
          },
          required: ["verb"],
        });
      },
    },
    {
      name: "indirect allOf wrapper",
      addEntrypoint: (schema) => {
        const defs = schema.$defs as JsonObject;
        defs.VoyageFilteredCliEntrypoint = {
          allOf: [
            { $ref: "#/$defs/VoyageCliResult" },
            {
              type: "object",
              properties: {
                verb: { const: "land" },
              },
              required: ["verb"],
            },
          ],
        };
        (schema.oneOf as JsonValue[]).push({
          $ref: "#/$defs/VoyageFilteredCliEntrypoint",
        });
      },
    },
    {
      name: "dependentSchemas wrapper",
      addEntrypoint: (schema) => {
        const defs = schema.$defs as JsonObject;
        defs.VoyageDependentCliEntrypoint = {
          type: "object",
          properties: {
            verb: { const: "land" },
          },
          required: ["verb"],
          dependentSchemas: {
            verb: { $ref: "#/$defs/VoyageCliResult" },
          },
        };
        (schema.oneOf as JsonValue[]).push({
          $ref: "#/$defs/VoyageDependentCliEntrypoint",
        });
      },
    },
  ];

  for (const control of controls) {
    const previous = clone(RESULT_OUTPUT_FIXTURE);
    control.addEntrypoint(previous);
    const current = clone(previous);
    const defs = current.$defs as JsonObject;
    defs.VoyageLandResult = {
      type: "object",
      properties: {
        verb: { const: "land" },
        ok: { type: "boolean" },
      },
      required: ["verb", "ok"],
    };
    const cli = defs.VoyageCliResult as JsonObject;
    (cli.oneOf as JsonValue[]).push({
      $ref: "#/$defs/VoyageLandResult",
    });
    (current["x-discern-contracts"] as JsonValue[]).push({
      id: "voyageLand",
      verb: "land",
      commands: ["land"],
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageLandResult",
    });

    assert(
      accepts(previous, { verb: "launch", ok: true }),
      `${control.name}: the existing result must match one root branch`,
    );
    assertEquals(
      accepts(current, { verb: "land", ok: true }),
      false,
      `${control.name}: widening makes the new result match 2 root branches`,
    );
    assertEquals(
      publicSchemaCompatibilityIssues(
        previous,
        current,
        RESULT_SCHEMA_COMPATIBILITY_POLICY,
      ),
      [
        '$.$defs.VoyageCliResult.oneOf: added alternative {"$ref":"#/$defs/VoyageLandResult"}',
      ],
      control.name,
    );
  }
});

Deno.test("contract widening requires one reachable route to the role aggregate", () => {
  const controls: {
    readonly name: string;
    readonly addWrapper: (schema: JsonObject) => void;
  }[] = [
    {
      name: "repeated aggregate ref",
      addWrapper: (schema) => {
        const defs = schema.$defs as JsonObject;
        defs.VoyageCliChoice = {
          oneOf: [
            { $ref: "#/$defs/VoyageCliResult" },
            {
              $ref: "#/$defs/VoyageCliResult",
              properties: {
                verb: { const: "land" },
              },
              required: ["verb"],
            },
          ],
        };
        (schema.oneOf as JsonValue[])[0] = {
          $ref: "#/$defs/VoyageCliChoice",
        };
      },
    },
    {
      name: "repeated wrapper ref",
      addWrapper: (schema) => {
        const defs = schema.$defs as JsonObject;
        defs.VoyageCliRoute = {
          allOf: [{ $ref: "#/$defs/VoyageCliResult" }],
        };
        defs.VoyageCliChoice = {
          oneOf: [
            { $ref: "#/$defs/VoyageCliRoute" },
            {
              $ref: "#/$defs/VoyageCliRoute",
              properties: {
                verb: { const: "land" },
              },
              required: ["verb"],
            },
          ],
        };
        (schema.oneOf as JsonValue[])[0] = {
          $ref: "#/$defs/VoyageCliChoice",
        };
      },
    },
  ];

  for (const control of controls) {
    const previous = clone(RESULT_OUTPUT_FIXTURE);
    control.addWrapper(previous);
    const current = clone(previous);
    const defs = current.$defs as JsonObject;
    defs.VoyageLandResult = {
      type: "object",
      properties: {
        verb: { const: "land" },
        ok: { type: "boolean" },
      },
      required: ["verb", "ok"],
    };
    const cli = defs.VoyageCliResult as JsonObject;
    (cli.oneOf as JsonValue[]).push({
      $ref: "#/$defs/VoyageLandResult",
    });
    (current["x-discern-contracts"] as JsonValue[]).push({
      id: "voyageLand",
      verb: "land",
      commands: ["land"],
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageLandResult",
    });

    assert(
      accepts(previous, { verb: "launch", ok: true }),
      `${control.name}: the existing result must match one wrapper branch`,
    );
    assertEquals(
      accepts(current, { verb: "land", ok: true }),
      false,
      `${control.name}: widening makes the new result match 2 wrapper branches`,
    );
    assertEquals(
      publicSchemaCompatibilityIssues(
        previous,
        current,
        RESULT_SCHEMA_COMPATIBILITY_POLICY,
      ),
      [
        '$.$defs.VoyageCliResult.oneOf: added alternative {"$ref":"#/$defs/VoyageLandResult"}',
      ],
      control.name,
    );
  }
});

Deno.test("contract widening requires a transparent canonical root route", () => {
  const controls: {
    readonly name: string;
    readonly replaceEntrypoint: (schema: JsonObject) => void;
  }[] = [
    {
      name: "sole constrained ref",
      replaceEntrypoint: (schema) => {
        (schema.oneOf as JsonValue[])[0] = {
          $ref: "#/$defs/VoyageCliResult",
          required: ["verb"],
        };
      },
    },
    {
      name: "sole indirect ref",
      replaceEntrypoint: (schema) => {
        const defs = schema.$defs as JsonObject;
        defs.VoyageCliEntrypoint = {
          allOf: [{ $ref: "#/$defs/VoyageCliResult" }],
        };
        (schema.oneOf as JsonValue[])[0] = {
          $ref: "#/$defs/VoyageCliEntrypoint",
        };
      },
    },
  ];

  for (const control of controls) {
    const previous = clone(RESULT_OUTPUT_FIXTURE);
    control.replaceEntrypoint(previous);
    const current = clone(previous);
    const defs = current.$defs as JsonObject;
    defs.VoyageLandResult = {
      type: "object",
      properties: {
        verb: { const: "land" },
        ok: { type: "boolean" },
      },
      required: ["verb", "ok"],
    };
    const cli = defs.VoyageCliResult as JsonObject;
    (cli.oneOf as JsonValue[]).push({
      $ref: "#/$defs/VoyageLandResult",
    });
    (current["x-discern-contracts"] as JsonValue[]).push({
      id: "voyageLand",
      verb: "land",
      commands: ["land"],
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageLandResult",
    });

    assert(accepts(previous, { verb: "launch", ok: true }));
    assert(accepts(current, { verb: "land", ok: true }));
    assertEquals(
      publicSchemaCompatibilityIssues(
        previous,
        current,
        RESULT_SCHEMA_COMPATIBILITY_POLICY,
      ),
      [
        '$.$defs.VoyageCliResult.oneOf: added alternative {"$ref":"#/$defs/VoyageLandResult"}',
      ],
      control.name,
    );
  }
});

Deno.test("contract widening requires a transparent existing role aggregate", () => {
  const previous = clone(RESULT_OUTPUT_FIXTURE);
  const previousDefs = previous.$defs as JsonObject;
  const previousAggregate = previousDefs.VoyageCliResult as JsonObject;
  previousAggregate.required = ["verb"];

  const current = clone(previous);
  const defs = current.$defs as JsonObject;
  defs.VoyageLandResult = {
    type: "object",
    properties: {
      verb: { const: "land" },
      ok: { type: "boolean" },
    },
    required: ["verb", "ok"],
  };
  const aggregate = defs.VoyageCliResult as JsonObject;
  (aggregate.oneOf as JsonValue[]).push({
    $ref: "#/$defs/VoyageLandResult",
  });
  (current["x-discern-contracts"] as JsonValue[]).push({
    id: "voyageLand",
    verb: "land",
    commands: ["land"],
    [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageLandResult",
  });

  assert(accepts(previous, { verb: "launch", ok: true }));
  assert(accepts(current, { verb: "land", ok: true }));
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [
      '$.$defs.VoyageCliResult.oneOf: added alternative {"$ref":"#/$defs/VoyageLandResult"}',
    ],
  );
});

Deno.test("result compatibility permits adding MCP exposure to an existing CLI contract", () => {
  const previous = clone(RESULT_OUTPUT_FIXTURE);
  const previousDefs = previous.$defs as JsonObject;
  previousDefs.VoyageSurveyResult = {
    type: "object",
    properties: {
      verb: { const: "survey" },
      ok: { type: "boolean" },
    },
    required: ["verb", "ok"],
  };
  const previousCli = previousDefs.VoyageCliResult as JsonObject;
  previousCli.oneOf = [
    ...(previousCli.oneOf as JsonValue[]),
    { $ref: "#/$defs/VoyageSurveyResult" },
  ];
  previous["x-discern-contracts"] = [
    ...(previous["x-discern-contracts"] as JsonValue[]),
    {
      id: "voyageSurvey",
      verb: "survey",
      commands: ["survey"],
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageSurveyResult",
    },
  ];

  const current = clone(previous);
  const currentDefs = current.$defs as JsonObject;
  currentDefs.VoyageSurveyMcpToolResult = {
    type: "object",
    properties: {
      structuredContent: { $ref: "#/$defs/VoyageSurveyResult" },
    },
    required: ["structuredContent"],
  };
  const currentMcp = currentDefs.VoyageMcpResult as JsonObject;
  currentMcp.oneOf = [
    ...(currentMcp.oneOf as JsonValue[]),
    { $ref: "#/$defs/VoyageSurveyMcpToolResult" },
  ];
  const contracts = current["x-discern-contracts"] as JsonObject[];
  const survey = contracts.find((contract) => contract.id === "voyageSurvey");
  assert(survey !== undefined);
  survey.mcp_tool = "voyage_survey";
  survey[RESULT_CONTRACT_REFERENCE_FIELDS.mcp] =
    "#/$defs/VoyageSurveyMcpToolResult";

  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
  );

  const misplaced = clone(current);
  const misplacedDefs = misplaced.$defs as JsonObject;
  const misplacedCli = misplacedDefs.VoyageCliResult as JsonObject;
  misplacedCli.oneOf = [
    ...(misplacedCli.oneOf as JsonValue[]),
    { $ref: "#/$defs/VoyageSurveyMcpToolResult" },
  ];
  const misplacedMcp = misplacedDefs.VoyageMcpResult as JsonObject;
  misplacedMcp.oneOf = (misplacedMcp.oneOf as JsonValue[]).filter(
    (alternative) =>
      (alternative as JsonObject).$ref !==
        "#/$defs/VoyageSurveyMcpToolResult",
  );
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      misplaced,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [
      '$.$defs.VoyageCliResult.oneOf: added alternative {"$ref":"#/$defs/VoyageSurveyMcpToolResult"}',
    ],
    "a first MCP exposure cannot widen the CLI aggregate",
  );
});

Deno.test("result compatibility permits creating the first role aggregate", () => {
  const previous = clone(RESULT_OUTPUT_FIXTURE);
  previous.oneOf = [{ $ref: "#/$defs/VoyageCliResult" }];
  const previousDefs = previous.$defs as JsonObject;
  delete previousDefs.VoyageMcpResult;
  delete previousDefs.VoyageLaunchMcpToolResult;
  const previousContract = (previous["x-discern-contracts"] as JsonObject[])[0];
  assert(previousContract !== undefined);
  delete previousContract.mcp_tool;
  delete previousContract[RESULT_CONTRACT_REFERENCE_FIELDS.mcp];

  const current = clone(previous);
  const currentDefs = current.$defs as JsonObject;
  currentDefs.VoyageLaunchMcpToolResult = {
    type: "object",
    properties: {
      structuredContent: { $ref: "#/$defs/VoyageLaunchResult" },
    },
    required: ["structuredContent"],
  };
  currentDefs.VoyageMcpResult = {
    oneOf: [{ $ref: "#/$defs/VoyageLaunchMcpToolResult" }],
  };
  (current.oneOf as JsonValue[]).push({
    $ref: "#/$defs/VoyageMcpResult",
  });
  const currentContract = (current["x-discern-contracts"] as JsonObject[])[0];
  assert(currentContract !== undefined);
  currentContract.mcp_tool = "voyage_launch";
  currentContract[RESULT_CONTRACT_REFERENCE_FIELDS.mcp] =
    "#/$defs/VoyageLaunchMcpToolResult";

  const mcpResult = {
    structuredContent: {
      verb: "launch",
      ok: true,
    },
  } satisfies JsonObject;
  assertEquals(accepts(previous, mcpResult), false);
  assert(accepts(current, mcpResult));
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
  );

  const constrainedAggregate = clone(current);
  const constrainedDefs = constrainedAggregate.$defs as JsonObject;
  const constrainedMcp = constrainedDefs.VoyageMcpResult as JsonObject;
  constrainedMcp.required = ["structuredContent"];
  assert(accepts(constrainedAggregate, mcpResult));
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      constrainedAggregate,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).includes(
      '$.oneOf: added alternative {"$ref":"#/$defs/VoyageMcpResult"}',
    ),
    "a constrained aggregate definition cannot create a role entrypoint",
  );

  const ambiguousSchemas = [
    (() => {
      const constrained = clone(current);
      (constrained.oneOf as JsonValue[]).push({
        $ref: "#/$defs/VoyageMcpResult",
        required: ["structuredContent"],
      });
      return ["constrained aggregate ref", constrained] as const;
    })(),
    (() => {
      const indirect = clone(current);
      const defs = indirect.$defs as JsonObject;
      defs.VoyageMcpEntrypoint = {
        allOf: [{ $ref: "#/$defs/VoyageMcpResult" }],
      };
      (indirect.oneOf as JsonValue[]).push({
        $ref: "#/$defs/VoyageMcpEntrypoint",
      });
      return ["indirect aggregate ref", indirect] as const;
    })(),
    (() => {
      const duplicated = clone(current);
      const defs = duplicated.$defs as JsonObject;
      defs.VoyageMcpMirror = {
        oneOf: [{ $ref: "#/$defs/VoyageLaunchMcpToolResult" }],
      };
      (duplicated.oneOf as JsonValue[]).push({
        $ref: "#/$defs/VoyageMcpMirror",
      });
      return ["second role aggregate", duplicated] as const;
    })(),
  ];
  for (const [name, ambiguous] of ambiguousSchemas) {
    assertEquals(
      accepts(ambiguous, mcpResult),
      false,
      `${name}: the new result must not match 2 root branches`,
    );
    assert(
      publicSchemaCompatibilityIssues(
        previous,
        ambiguous,
        RESULT_SCHEMA_COMPATIBILITY_POLICY,
      ).includes(
        '$.oneOf: added alternative {"$ref":"#/$defs/VoyageMcpResult"}',
      ),
      `${name}: ambiguity must close the new role entrypoint`,
    );
  }

  const preexistingReference = clone(previous);
  const preexistingDefs = preexistingReference.$defs as JsonObject;
  preexistingDefs.VoyageLaunchMcpToolResult = clone(
    currentDefs.VoyageLaunchMcpToolResult as JsonObject,
  );
  assert(
    publicSchemaCompatibilityIssues(
      preexistingReference,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).includes(
      '$.oneOf: added alternative {"$ref":"#/$defs/VoyageMcpResult"}',
    ),
    "the first role cannot be based on a pre-existing unregistered reference",
  );
});

Deno.test("only canonical contract-reference fields can authorize a new union alternative", () => {
  const current = clone(RESULT_OUTPUT_FIXTURE);
  const defs = current.$defs as JsonObject;
  defs.VoyageRelayEnvelope = {
    type: "object",
    properties: {
      structuredContent: { $ref: "#/$defs/VoyageLaunchResult" },
    },
    required: ["structuredContent"],
  };
  const mcp = defs.VoyageMcpResult as JsonObject;
  mcp.oneOf = [
    ...(mcp.oneOf as JsonValue[]),
    { $ref: "#/$defs/VoyageRelayEnvelope" },
  ];
  const contracts = current["x-discern-contracts"] as JsonObject[];
  const launch = contracts.find((contract) => contract.id === "voyageLaunch");
  assert(launch !== undefined);
  launch.relayEnvelope = "#/$defs/VoyageRelayEnvelope";

  assertEquals(
    publicSchemaCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [
      '$.$defs.VoyageMcpResult.oneOf: added alternative {"$ref":"#/$defs/VoyageRelayEnvelope"}',
    ],
    "an arbitrary metadata field cannot widen an existing command's output",
  );
});

Deno.test("result compatibility preserves required guarantees on existing contracts", () => {
  const added = clone(RESULT_OUTPUT_FIXTURE);
  const addedDefs = added.$defs as JsonObject;
  const addedLaunch = addedDefs.VoyageLaunchResult as JsonObject;
  addedLaunch.required = ["verb", "ok", "signal"];
  assert(
    publicSchemaCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
      added,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).includes(
      '$.$defs.VoyageLaunchResult.required: added required field "signal"',
    ),
  );

  const removed = clone(RESULT_OUTPUT_FIXTURE);
  const removedDefs = removed.$defs as JsonObject;
  const removedLaunch = removedDefs.VoyageLaunchResult as JsonObject;
  removedLaunch.required = ["verb"];
  assert(
    publicSchemaCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
      removed,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).includes(
      '$.$defs.VoyageLaunchResult.required: made required result field "ok" optional',
    ),
  );
});

Deno.test("result compatibility reorders existing field alternatives but does not widen them", () => {
  const reordered = clone(RESULT_OUTPUT_FIXTURE);
  const reorderedDefs = reordered.$defs as JsonObject;
  const reorderedLaunch = reorderedDefs.VoyageLaunchResult as JsonObject;
  const reorderedProperties = reorderedLaunch.properties as JsonObject;
  const reorderedSignal = reorderedProperties.signal as JsonObject;
  reorderedSignal.oneOf = [
    ...(reorderedSignal.oneOf as JsonValue[]),
  ].reverse();
  assertEquals(
    publicSchemaCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
      reordered,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
  );

  const widened = clone(RESULT_OUTPUT_FIXTURE);
  const widenedDefs = widened.$defs as JsonObject;
  const widenedLaunch = widenedDefs.VoyageLaunchResult as JsonObject;
  const widenedProperties = widenedLaunch.properties as JsonObject;
  const widenedSignal = widenedProperties.signal as JsonObject;
  widenedSignal.oneOf = [
    ...(widenedSignal.oneOf as JsonValue[]),
    { type: "boolean" },
  ];
  assert(
    publicSchemaCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
      widened,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).includes(
      '$.$defs.VoyageLaunchResult.properties.signal.oneOf: added alternative {"type":"boolean"}',
    ),
  );
});

Deno.test("prefixItems compatibility is positional", () => {
  const previous: JsonObject = {
    type: "array",
    prefixItems: [
      { type: "string" },
      { type: "number" },
    ],
  };
  const current: JsonObject = {
    type: "array",
    prefixItems: [
      { type: "number" },
      { type: "string" },
    ],
  };
  const existing = ["voyage", 7];
  assert(accepts(previous, existing));
  assertEquals(accepts(current, existing), false);
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [
      '$.prefixItems[0].type: changed from "string" to "number"',
      '$.prefixItems[1].type: changed from "number" to "string"',
    ],
  );
});

Deno.test("result compatibility rejects removed contracts and known error slugs", () => {
  const previous = clone(RESULT_OUTPUT_FIXTURE);
  const previousDefs = previous.$defs as JsonObject;
  previousDefs.VoyageSurveyResult = {
    type: "object",
    properties: {
      verb: { const: "survey" },
      ok: { type: "boolean" },
    },
    required: ["verb", "ok"],
  };
  const previousCli = previousDefs.VoyageCliResult as JsonObject;
  (previousCli.oneOf as JsonValue[]).push({
    $ref: "#/$defs/VoyageSurveyResult",
  });
  (previous["x-discern-contracts"] as JsonValue[]).push({
    id: "voyageSurvey",
    verb: "survey",
    commands: ["survey"],
    [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageSurveyResult",
  });

  const current = clone(previous);
  const defs = current.$defs as JsonObject;
  const cli = defs.VoyageCliResult as JsonObject;
  cli.oneOf = [{ $ref: "#/$defs/VoyageSurveyResult" }];
  current["x-discern-contracts"] = [
    (current["x-discern-contracts"] as JsonValue[])[1] ?? null,
  ];
  current["x-discern-error-slugs"] = [];

  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [
      '$.$defs.VoyageCliResult.oneOf: removed alternative {"$ref":"#/$defs/VoyageLaunchResult"}',
      '$.x-discern-contracts: removed contract "voyageLaunch"',
      '$.x-discern-error-slugs: removed value "launch_failed"',
    ],
  );
});

Deno.test("malformed public schemas fail before structural compatibility", () => {
  const malformedRequired = clone(CONFIG_INPUT_FIXTURE);
  malformedRequired.required = 7;
  const malformedRequiredError = compileError(malformedRequired);
  assert(
    malformedRequiredError.includes("required") &&
      malformedRequiredError.includes("must be array"),
    malformedRequiredError,
  );
  const malformedRequiredIssues = publicSchemaCompatibilityIssues(
    CONFIG_INPUT_FIXTURE,
    malformedRequired,
    CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  );
  assert(
    malformedRequiredIssues.some((issue) =>
      issue.includes("current schema") &&
      issue.includes("required") &&
      issue.includes("must be array")
    ),
    JSON.stringify(malformedRequiredIssues),
  );

  const emptyMcpBaseline = clone(RESULT_OUTPUT_FIXTURE);
  const baselineDefs = emptyMcpBaseline.$defs as JsonObject;
  const baselineMcp = baselineDefs.VoyageMcpResult as JsonObject;
  baselineMcp.oneOf = [];
  delete baselineDefs.VoyageLaunchMcpToolResult;
  const baselineContract =
    (emptyMcpBaseline["x-discern-contracts"] as JsonObject[])[0];
  assert(baselineContract !== undefined);
  delete baselineContract.mcp_tool;
  delete baselineContract[RESULT_CONTRACT_REFERENCE_FIELDS.mcp];

  const firstMcpExposure = clone(emptyMcpBaseline);
  const currentDefs = firstMcpExposure.$defs as JsonObject;
  currentDefs.VoyageLaunchMcpToolResult = {
    type: "object",
    properties: {
      structuredContent: { $ref: "#/$defs/VoyageLaunchResult" },
    },
    required: ["structuredContent"],
  };
  const currentMcp = currentDefs.VoyageMcpResult as JsonObject;
  currentMcp.oneOf = [
    { $ref: "#/$defs/VoyageLaunchMcpToolResult" },
  ];
  const currentContract =
    (firstMcpExposure["x-discern-contracts"] as JsonObject[])[0];
  assert(currentContract !== undefined);
  currentContract.mcp_tool = "voyage_launch";
  currentContract[RESULT_CONTRACT_REFERENCE_FIELDS.mcp] =
    "#/$defs/VoyageLaunchMcpToolResult";

  const emptyOneOfError = compileError(emptyMcpBaseline);
  assert(
    emptyOneOfError.includes("oneOf") &&
      emptyOneOfError.includes("fewer than 1"),
    emptyOneOfError,
  );
  assert(accepts(firstMcpExposure, {
    structuredContent: {
      verb: "launch",
      ok: true,
    },
  }));
  const emptyBaselineIssues = publicSchemaCompatibilityIssues(
    emptyMcpBaseline,
    firstMcpExposure,
    RESULT_SCHEMA_COMPATIBILITY_POLICY,
  );
  assert(
    emptyBaselineIssues.some((issue) =>
      issue.includes("trunk schema") &&
      issue.includes("oneOf") &&
      issue.includes("fewer than 1")
    ),
    JSON.stringify(emptyBaselineIssues),
  );
});

Deno.test("same-major transitions keep the policy recorded by the trunk artifact", () => {
  const previous = clone(RESULT_OUTPUT_FIXTURE);
  const structurallyWeakened = clone(RESULT_OUTPUT_FIXTURE);
  const weakenedDefs = structurallyWeakened.$defs as JsonObject;
  const weakenedLaunch = weakenedDefs.VoyageLaunchResult as JsonObject;
  weakenedLaunch.required = ["verb"];
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      structurallyWeakened,
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
    "the config policy alone would miss a removed result guarantee",
  );

  const current = clone(structurallyWeakened);
  current[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY] =
    CONFIG_SCHEMA_COMPATIBILITY_POLICY;
  assertEquals(
    publicSchemaPublicationCompatibilityIssues(
      previous,
      current,
      {
        ...VOYAGE_PUBLICATION,
        compatibility: CONFIG_SCHEMA_COMPATIBILITY_POLICY,
      },
    ),
    [
      `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: same-major policy changed ` +
      `from ${JSON.stringify(RESULT_SCHEMA_COMPATIBILITY_POLICY)} to ` +
      `${JSON.stringify(CONFIG_SCHEMA_COMPATIBILITY_POLICY)}; add a ` +
      "new-major publication instead",
    ],
  );
});

Deno.test("generated publications carry their registry-owned policy", () => {
  const missing = clone(RESULT_OUTPUT_FIXTURE);
  delete missing[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY];
  assertEquals(
    publicSchemaPublicationIdentityIssues(missing, VOYAGE_PUBLICATION),
    [
      `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: undefined is not a public ` +
      "schema compatibility policy",
    ],
  );

  const malformed = clone(RESULT_OUTPUT_FIXTURE);
  malformed[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY] = "future-output";
  assertEquals(
    publicSchemaPublicationIdentityIssues(malformed, VOYAGE_PUBLICATION),
    [
      `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: "future-output" is not a ` +
      "public schema compatibility policy",
    ],
  );

  const drifted = clone(RESULT_OUTPUT_FIXTURE);
  drifted[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY] =
    CONFIG_SCHEMA_COMPATIBILITY_POLICY;
  assertEquals(
    publicSchemaPublicationIdentityIssues(drifted, VOYAGE_PUBLICATION),
    [
      `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: generated policy ` +
      `${JSON.stringify(CONFIG_SCHEMA_COMPATIBILITY_POLICY)} does not match ` +
      `registered policy ${JSON.stringify(RESULT_SCHEMA_COMPATIBILITY_POLICY)}`,
    ],
  );
});

Deno.test("same-major transitions fail closed without a valid trunk policy", () => {
  const controls: readonly {
    readonly name: string;
    readonly value?: JsonValue;
    readonly expected: string;
  }[] = [
    {
      name: "missing",
      expected:
        `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: undefined is not a ` +
        "public schema compatibility policy",
    },
    {
      name: "malformed",
      value: 7,
      expected: `$.${PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY}: 7 is not a ` +
        "public schema compatibility policy",
    },
  ];
  for (const control of controls) {
    const previous = clone(RESULT_OUTPUT_FIXTURE);
    if (control.value === undefined) {
      delete previous[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY];
    } else {
      previous[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY] = control.value;
    }
    assertEquals(
      publicSchemaPublicationCompatibilityIssues(
        previous,
        RESULT_OUTPUT_FIXTURE,
        VOYAGE_PUBLICATION,
      ),
      [control.expected],
      control.name,
    );
  }
});

Deno.test("schema publication identity rejects every non-major drift and malformed transition", () => {
  const controls: {
    readonly name: string;
    readonly previousId: JsonValue;
    readonly publication: PublicSchemaPublication;
    readonly currentId?: string;
    readonly expectedIssue: string;
  }[] = [
    {
      name: "same-major host drift",
      previousId: VOYAGE_PUBLICATION.id,
      publication: {
        ...VOYAGE_PUBLICATION,
        id:
          "https://archive.example/schema/v1/voyage-results.schema.json" as PublicSchemaPublication[
            "id"
          ],
      },
      currentId: "https://archive.example/schema/v1/voyage-results.schema.json",
      expectedIssue:
        'publication id: "https://archive.example/schema/v1/voyage-results.schema.json" is not a canonical public schema id',
    },
    {
      name: "same-major basename drift",
      previousId: VOYAGE_PUBLICATION.id,
      publication: {
        ...VOYAGE_PUBLICATION,
        id: "https://discern.sh/schema/v1/renamed-voyage-results.schema.json",
        artifactPath: "schema/renamed-voyage-results.schema.json",
      },
      currentId:
        "https://discern.sh/schema/v1/renamed-voyage-results.schema.json",
      expectedIssue:
        '$.$id: schema identity changed from "voyage-results.schema.json" to "renamed-voyage-results.schema.json"; only the major may change',
    },
    {
      name: "malformed previous major",
      previousId:
        "https://discern.sh/schema/vlatest/voyage-results.schema.json",
      publication: VOYAGE_PUBLICATION,
      expectedIssue:
        '$.$id: "https://discern.sh/schema/vlatest/voyage-results.schema.json" is not a canonical public schema id',
    },
    {
      name: "regressed major",
      previousId: "https://discern.sh/schema/v2/voyage-results.schema.json",
      publication: VOYAGE_PUBLICATION,
      expectedIssue: "$.$id: schema major regressed from v2 to v1",
    },
    {
      name: "registry major disagrees with id",
      previousId: VOYAGE_PUBLICATION.id,
      publication: { ...VOYAGE_PUBLICATION, major: 2 },
      expectedIssue:
        'publication id "https://discern.sh/schema/v1/voyage-results.schema.json" carries v1, not registered v2',
    },
  ];

  for (const control of controls) {
    const previous = clone(RESULT_OUTPUT_FIXTURE);
    previous.$id = control.previousId;
    const current = clone(RESULT_OUTPUT_FIXTURE);
    if (control.currentId !== undefined) {
      current.$id = control.currentId;
    }
    assertEquals(
      publicSchemaPublicationCompatibilityIssues(
        previous,
        current,
        control.publication,
      ),
      [control.expectedIssue],
      control.name,
    );
  }
});

Deno.test("schema identities stay append-only and a new major starts a separate baseline", () => {
  const drifted = clone(RESULT_OUTPUT_FIXTURE);
  drifted.$id = "https://discern.sh/schema/v1/other-voyage-results.schema.json";
  assertEquals(
    publicSchemaPublicationCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
      drifted,
      VOYAGE_PUBLICATION,
    ),
    [
      '$.$id: generated id "https://discern.sh/schema/v1/other-voyage-results.schema.json" does not match registered id "https://discern.sh/schema/v1/voyage-results.schema.json"',
    ],
  );

  const previous = clone(RESULT_OUTPUT_FIXTURE);
  const nextMajor = clone(RESULT_OUTPUT_FIXTURE);
  const nextDefs = nextMajor.$defs as JsonObject;
  const nextSignal = nextDefs.VoyageStringSignal as JsonObject;
  nextSignal.type = "boolean";
  assertEquals(
    publicSchemaPublicationCompatibilityIssues(
      previous,
      nextMajor,
      VOYAGE_PUBLICATION,
    ),
    [
      '$.$defs.VoyageStringSignal.type: changed from "string" to "boolean"',
    ],
    "the same structural break remains blocked within v1",
  );

  nextMajor.$id = "https://discern.sh/schema/v2/voyage-results.schema.json";
  nextMajor[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY] =
    CONFIG_SCHEMA_COMPATIBILITY_POLICY;
  const nextMajorPublication = {
    ...VOYAGE_PUBLICATION,
    id: "https://discern.sh/schema/v2/voyage-results.schema.json",
    artifactPath: "schema/v2/voyage-results.schema.json",
    major: 2,
    compatibility: CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  } satisfies PublicSchemaPublication;
  assertEquals(
    publicSchemaPublicationCompatibilityIssues(
      previous,
      nextMajor,
      nextMajorPublication,
    ),
    [
      "$.$id: schema major changed in place from v1 to v2; retain the v1 " +
      "publication and add v2 at a new artifact path",
    ],
    "one artifact cannot replace the URL serving its earlier major",
  );
  assertEquals(
    publicSchemaPublicationIdentityIssues(nextMajor, nextMajorPublication),
    [],
    "a new artifact may establish a new major and policy baseline",
  );
  assertEquals(
    publicSchemaArtifactEnrollmentIssues(
      [VOYAGE_PUBLICATION.artifactPath],
      [nextMajorPublication],
    ),
    [
      "schema/voyage-results.schema.json: trunk public schema artifact is no longer enrolled",
    ],
    "the new baseline cannot remove the earlier publication",
  );
  assertEquals(
    publicSchemaArtifactEnrollmentIssues(
      [VOYAGE_PUBLICATION.artifactPath],
      [VOYAGE_PUBLICATION, nextMajorPublication],
    ),
    [],
    "retaining v1 while adding v2 preserves both routes",
  );
});

Deno.test("schema publication paths keep every trunk artifact enrolled while allowing additions", () => {
  const moved = {
    ...VOYAGE_PUBLICATION,
    artifactPath: "schema/moved-voyage-results.schema.json",
  } satisfies PublicSchemaPublication;
  assertEquals(
    publicSchemaArtifactEnrollmentIssues(
      [VOYAGE_PUBLICATION.artifactPath],
      [moved],
    ),
    [
      "schema/voyage-results.schema.json: trunk public schema artifact is no longer enrolled",
    ],
  );

  const added = {
    ...VOYAGE_PUBLICATION,
    id: "https://discern.sh/schema/v1/voyage-events.schema.json",
    artifactPath: "schema/voyage-events.schema.json",
  } satisfies PublicSchemaPublication;
  assertEquals(
    publicSchemaArtifactEnrollmentIssues(
      [VOYAGE_PUBLICATION.artifactPath],
      [VOYAGE_PUBLICATION, added],
    ),
    [],
    "a new publication path does not reset or remove an existing baseline",
  );
});

Deno.test("public property and contract-metadata names use the frozen snake_case vocabulary", () => {
  const allowedExternalProperties = {
    isError: "MCP SDK CallToolResult field",
    payloadType: "DSSE protocol field",
    structuredContent: "MCP SDK CallToolResult field",
  } as const;
  const observedExternalProperties = new Set<string>();
  const offenders: string[] = [];
  for (
    const publication of PUBLIC_SCHEMA_PUBLICATIONS.filter((entry) =>
      entry.compatibility === RESULT_SCHEMA_COMPATIBILITY_POLICY
    )
  ) {
    const schema = buildCurrentPublicSchema(publication);
    for (const node of jsonObjects(schema)) {
      const properties = node.value.properties;
      if (!isRecord(properties)) continue;
      for (const property of Object.keys(properties)) {
        if (/^[a-z][a-z0-9_]*$/.test(property)) {
          if (property.endsWith("_seconds")) {
            offenders.push(
              `${publication.artifactPath}:${node.path}.properties.${property} uses _seconds instead of _s`,
            );
          }
          continue;
        }
        if (Object.hasOwn(allowedExternalProperties, property)) {
          observedExternalProperties.add(property);
          continue;
        }
        offenders.push(
          `${publication.artifactPath}:${node.path}.properties.${property} is not snake_case`,
        );
      }
    }
  }
  assertEquals(offenders, [], offenders.join("\n"));
  assertEquals(
    [...observedExternalProperties].sort(),
    Object.keys(allowedExternalProperties).sort(),
    "each protocol-owned casing exception must remain live",
  );

  const resultPublication = PUBLIC_SCHEMA_PUBLICATIONS.find((entry) =>
    entry.artifactPath === "schema/discern-results.schema.json"
  );
  assert(resultPublication !== undefined);
  const contracts = buildCurrentPublicSchema(resultPublication)[
    "x-discern-contracts"
  ];
  assert(Array.isArray(contracts));
  const metadataOffenders = contracts.flatMap((contract, index) =>
    jsonObjects(contract, `$[${index}]`).flatMap(({ path, value }) =>
      Object.keys(value)
        .filter((key) => !/^[a-z][a-z0-9_]*$/.test(key))
        .map((key) => `${path}.${key}`)
    )
  );
  assertEquals(
    metadataOffenders,
    [],
    `x-discern-contracts metadata must be snake_case:\n${
      metadataOffenders.join("\n")
    }`,
  );
});

Deno.test("public definition names never repeat an adjacent semantic segment", () => {
  const offenders: string[] = [];
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const schema = buildCurrentPublicSchema(publication);
    const definitions = schema.$defs;
    if (!isRecord(definitions)) continue;
    for (const name of Object.keys(definitions)) {
      const segments = definitionSegments(name);
      if (segments.some((segment, index) => segment === segments[index - 1])) {
        offenders.push(`${publication.artifactPath}:$defs.${name}`);
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `generated definition names repeat a word segment:\n${
      offenders.join("\n")
    }`,
  );
});

Deno.test("the MCP manifest permits only append-only tools and optional request inputs", () => {
  const previous: JsonObject = {
    format: 1,
    tools: [{
      name: "discern_probe",
      title: "Probe",
      description: "Inspect the selected project.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    }],
  };
  const compatible = clone(previous);
  const tool = (compatible.tools as JsonObject[])[0];
  assert(tool !== undefined && isRecord(tool.inputSchema));
  assert(isRecord(tool.inputSchema.properties));
  tool.inputSchema.properties.dry_run = { type: "boolean" };
  tool.inputSchema.required = [];
  (compatible.tools as JsonValue[]).push({
    name: "discern_future",
    title: "Future",
    description: "Observe a future fact.",
    inputSchema: { type: "object", properties: {} },
  });
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      compatible,
      MCP_TOOLS_COMPATIBILITY_POLICY,
    ),
    [],
  );

  const renamedInput = clone(compatible);
  const renamedTool = (renamedInput.tools as JsonObject[])[0];
  assert(renamedTool !== undefined && isRecord(renamedTool.inputSchema));
  assert(isRecord(renamedTool.inputSchema.properties));
  delete renamedTool.inputSchema.properties.path;
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      renamedInput,
      MCP_TOOLS_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("path") && issue.includes("removed")),
  );

  const changedAnnotations = clone(previous);
  const changedTool = (changedAnnotations.tools as JsonObject[])[0];
  assert(changedTool !== undefined);
  changedTool.annotations = { readOnlyHint: false };
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      changedAnnotations,
      MCP_TOOLS_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("annotations")),
  );

  const newlyRequired = clone(previous);
  const newlyRequiredTool = (newlyRequired.tools as JsonObject[])[0];
  assert(
    newlyRequiredTool !== undefined && isRecord(newlyRequiredTool.inputSchema),
  );
  delete newlyRequiredTool.inputSchema.required;
  const requiredCurrent = clone(newlyRequired);
  const requiredCurrentTool = (requiredCurrent.tools as JsonObject[])[0];
  assert(
    requiredCurrentTool !== undefined &&
      isRecord(requiredCurrentTool.inputSchema),
  );
  requiredCurrentTool.inputSchema.required = ["path"];
  assert(
    publicSchemaCompatibilityIssues(
      newlyRequired,
      requiredCurrent,
      MCP_TOOLS_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes('added required input "path"')),
  );
});

Deno.test("the CLI manifest permits additions but rejects grammar removal and arity drift", () => {
  const command: JsonObject = {
    path: ["probe"],
    description: "Inspect one fact.",
    aliases: ["p"],
    hidden: false,
    hidden_when: null,
    positionals: [{ name: "target", optional: true, variadic: false }],
    usage: "",
    flags: [{
      spellings: ["-n", "--name"],
      description: "Select a name.",
      type_definition: "<name:string>",
      arity: 1,
      value_types: ["string"],
      default: null,
      hidden: false,
      global: false,
    }],
  };
  const previous: JsonObject = {
    format: 1,
    implicit_flags: { command: ["--help"], root: ["--version"] },
    commands: [command],
  };
  const compatible = clone(previous);
  const nextCommand = (compatible.commands as JsonObject[])[0];
  assert(nextCommand !== undefined && Array.isArray(nextCommand.aliases));
  nextCommand.aliases.push("inspect");
  assert(Array.isArray(nextCommand.flags));
  nextCommand.flags.push({
    spellings: ["--future"],
    description: "Enable a future option.",
    type_definition: "",
    arity: 0,
    value_types: [],
    default: null,
    hidden: false,
    global: false,
  });
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      compatible,
      CLI_COMPATIBILITY_POLICY,
    ),
    [],
  );

  const removedAlias = clone(previous);
  const aliasCommand = (removedAlias.commands as JsonObject[])[0];
  assert(aliasCommand !== undefined);
  aliasCommand.aliases = [];
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      removedAlias,
      CLI_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("aliases") && issue.includes("removed")),
  );

  const changedArity = clone(previous);
  const arityCommand = (changedArity.commands as JsonObject[])[0];
  assert(arityCommand !== undefined && Array.isArray(arityCommand.flags));
  const arityFlag = arityCommand.flags[0];
  assert(isRecord(arityFlag));
  arityFlag.arity = 2;
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      changedArity,
      CLI_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("arity")),
  );
});

Deno.test("the conventions manifest permits new members but keeps existing values immutable", () => {
  const previous: JsonObject = {
    format: 1,
    git: { refs: { proof: "refs/example/proof" } },
    providers: { agent: { hooks_file: ".agent/hooks.json" } },
  };
  const compatible = clone(previous);
  assert(isRecord(compatible.providers));
  compatible.providers.future = { hooks_file: ".future/hooks.json" };
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      compatible,
      CONVENTIONS_COMPATIBILITY_POLICY,
    ),
    [],
  );

  const renamed = clone(previous);
  assert(isRecord(renamed.git) && isRecord(renamed.git.refs));
  renamed.git.refs.proof = "refs/example/renamed";
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      renamed,
      CONVENTIONS_COMPATIBILITY_POLICY,
    ).some((issue) =>
      issue.includes("refs.proof") && issue.includes("changed")
    ),
  );
});

Deno.test("manifest documentation can evolve without changing requests or grammar", () => {
  const schema: JsonObject = {
    type: "object",
    title: "Request",
    description: "Explain the request.",
    properties: {
      description: {
        type: "string",
        description: "A property whose name is also an annotation keyword.",
        default: "preserved",
      },
      payload: {
        type: "object",
        const: { description: "literal value" },
        default: { description: "literal default" },
      },
    },
  };
  const previous: JsonObject = {
    format: 1,
    tools: [{
      name: "discern_orbit",
      title: "Orbit",
      description: "Read an orbit.",
      inputSchema: schema,
    }],
  };
  const compatible = clone(previous);
  const tool = (compatible.tools as JsonObject[])[0];
  assert(tool !== undefined && isRecord(tool.inputSchema));
  tool.title = "Inspect orbit";
  tool.description = "Explain an additional optional capability.";
  tool.inputSchema.title = "Orbit request";
  delete tool.inputSchema.description;
  tool.inputSchema.examples = [{}];
  assert(isRecord(tool.inputSchema.properties));
  const named = tool.inputSchema.properties.description;
  assert(isRecord(named));
  named.description = "Clarify the existing input.";
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      compatible,
      MCP_TOOLS_COMPATIBILITY_POLICY,
    ),
    [],
  );

  for (const keyword of ["default", "const"]) {
    const changed = clone(compatible);
    const changedTool = (changed.tools as JsonObject[])[0];
    assert(changedTool !== undefined && isRecord(changedTool.inputSchema));
    assert(isRecord(changedTool.inputSchema.properties));
    const payload = changedTool.inputSchema.properties.payload;
    assert(isRecord(payload));
    payload[keyword] = { description: "different literal" };
    assert(
      publicSchemaCompatibilityIssues(
        previous,
        changed,
        MCP_TOOLS_COMPATIBILITY_POLICY,
      ).some((issue) => issue.includes(keyword)),
    );
  }
  const removed = clone(compatible);
  const removedTool = (removed.tools as JsonObject[])[0];
  assert(removedTool !== undefined && isRecord(removedTool.inputSchema));
  assert(isRecord(removedTool.inputSchema.properties));
  delete removedTool.inputSchema.properties.description;
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      removed,
      MCP_TOOLS_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("removed")),
  );

  const cli: JsonObject = {
    format: 1,
    implicit_flags: { command: [], root: [] },
    commands: [{
      path: ["sonar"],
      description: "Observe.",
      usage: "[options]",
      aliases: [],
      positionals: [],
      flags: [{
        spellings: ["--label"],
        description: "A label.",
        arity: 1,
        value_types: ["string"],
        default: "kept",
      }],
    }],
  };
  const revisedCli = clone(cli);
  const command = (revisedCli.commands as JsonObject[])[0];
  assert(command !== undefined && Array.isArray(command.flags));
  command.description = "Explain the existing observation.";
  command.usage = "[--label <text>]";
  const flag = command.flags[0];
  assert(isRecord(flag));
  flag.description = "Clarify the label.";
  assertEquals(
    publicSchemaCompatibilityIssues(cli, revisedCli, CLI_COMPATIBILITY_POLICY),
    [],
  );
  flag.default = "changed";
  assert(
    publicSchemaCompatibilityIssues(cli, revisedCli, CLI_COMPATIBILITY_POLICY)
      .some((issue) => issue.includes("default")),
  );
});

Deno.test("MCP documentation changes traverse schema children without relaxing their constraints", () => {
  const child: JsonObject = {
    type: "string",
    description: "Original.",
    minLength: 2,
  };
  const wrappers: JsonObject[] = [
    ...[
      "items",
      "additionalProperties",
      "unevaluatedProperties",
      "additionalItems",
      "unevaluatedItems",
      "contains",
      "not",
      "if",
      "then",
      "else",
      "propertyNames",
    ].map((key) => ({ [key]: child })),
    ...["oneOf", "anyOf", "allOf", "prefixItems", "items"].map((key) => ({
      [key]: [child],
    })),
    ...[
      "properties",
      "patternProperties",
      "$defs",
      "definitions",
      "dependentSchemas",
      "dependencies",
    ].map((key) => ({ [key]: { description: child } })),
  ];
  for (const wrapper of wrappers) {
    const previous: JsonObject = {
      format: 1,
      tools: [{ name: "discern_future", inputSchema: wrapper }],
    };
    const revisedChild = {
      ...child,
      description: "Revised.",
      title: "Detail",
      $comment: "Explanation.",
      examples: ["ok"],
    };
    const current = decodeWith(
      JsonObjectSchema,
      JSON.stringify(previous).replace(
        JSON.stringify(child),
        JSON.stringify(revisedChild),
      ),
    );
    assertEquals(
      publicSchemaCompatibilityIssues(
        previous,
        current,
        MCP_TOOLS_COMPATIBILITY_POLICY,
      ),
      [],
      JSON.stringify(wrapper),
    );
    const narrowed = decodeWith(
      JsonObjectSchema,
      JSON.stringify(current).replace('"minLength":2', '"minLength":3'),
    );
    assert(
      publicSchemaCompatibilityIssues(
        previous,
        narrowed,
        MCP_TOOLS_COMPATIBILITY_POLICY,
      ).some((issue) => issue.includes("minLength")),
    );
  }
});

Deno.test("private format revisions do not enter the frozen conventions contract", () => {
  const publication = PUBLIC_SCHEMA_PUBLICATIONS.find((entry) =>
    entry.compatibility === CONVENTIONS_COMPATIBILITY_POLICY
  );
  assert(publication !== undefined);
  const manifest = buildCurrentPublicSchema(publication);
  assert(isRecord(manifest.local_formats));
  for (const format of Object.values(ON_DISK_FORMATS)) {
    const published = manifest.local_formats[format.id];
    assert(isRecord(published), format.id);
    assertEquals(
      Object.hasOwn(published, "version"),
      format.location.kind === "git-note",
      format.id,
    );
    assertEquals(published.version_field, format.versionField, format.id);
    assertEquals(
      published.newer_version_policy,
      format.newerVersionPolicy,
      format.id,
    );
  }
});

Deno.test("the schema baseline is the highest predecessor version tag, never a release candidate at HEAD", async () => {
  await withTempDir(async (repo) => {
    await Deno.writeTextFile(`${repo}/README.md`, "schema tag fixture\n");
    await gitInit(repo);
    assertEquals(await publicSchemaBaselineTag(repo), undefined);

    for (const tag of ["release-99", "v01.0.0", "v1.0.0"]) {
      await git(repo, "tag", tag);
    }
    assertEquals(
      await publicSchemaBaselineTag(repo),
      undefined,
      "the first publication at HEAD has no predecessor and leaves the ratchet unarmed",
    );

    await git(
      repo,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "interim trunk work",
      "--no-gpg-sign",
    );
    assertEquals(await publicSchemaBaselineTag(repo), "v1.0.0");

    await git(repo, "tag", "v1.5.0", "HEAD^");
    await git(repo, "tag", "v2.0.0");
    assertEquals(
      await publicSchemaBaselineTag(repo),
      "v1.5.0",
      "every release tag at HEAD is excluded while its predecessor is selected by SemVer",
    );

    await git(
      repo,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "post-release work",
      "--no-gpg-sign",
    );
    assertEquals(
      await publicSchemaBaselineTag(repo),
      "v2.0.0",
      "an ordinary later commit compares with the highest tagged publication",
    );
  }, { prefix: "discern-schema-tags-" });
});

Deno.test("interim trunk schema churn is provisional but a tagged regression is rejected", async () => {
  await withTempDir(async (repo) => {
    const path = `${repo}/schema.json`;
    await Deno.writeTextFile(`${repo}/README.md`, "tag fixture\n");
    await gitInit(repo);
    await Deno.writeTextFile(
      path,
      JSON.stringify(CONFIG_INPUT_FIXTURE, null, 2) + "\n",
    );
    await git(repo, "add", "schema.json");
    await git(
      repo,
      "commit",
      "-q",
      "-m",
      "publish schema",
      "--no-gpg-sign",
    );
    await git(repo, "tag", "v1.0.0");
    assertEquals(await publicSchemaBaselineTag(repo), undefined);

    const interim = clone(CONFIG_INPUT_FIXTURE);
    (interim.properties as JsonObject).future_signal = { type: "boolean" };
    await Deno.writeTextFile(path, JSON.stringify(interim, null, 2) + "\n");
    await git(repo, "add", "schema.json");
    await git(
      repo,
      "commit",
      "-q",
      "-m",
      "stage additive contract work",
      "--no-gpg-sign",
    );
    assertEquals(await publicSchemaBaselineTag(repo), "v1.0.0");
    assertEquals(
      publicSchemaCompatibilityIssues(
        CONFIG_INPUT_FIXTURE,
        interim,
        CONFIG_SCHEMA_COMPATIBILITY_POLICY,
      ),
      [],
    );

    const regression = clone(interim);
    delete (regression.properties as JsonObject).beacon;
    const baseline = await runGit(["show", "v1.0.0:schema.json"], {
      cwd: repo,
    });
    assert(baseline.success);
    const published = decodeWith(JsonObjectSchema, baseline.stdout);
    assert(
      publicSchemaCompatibilityIssues(
        published,
        regression,
        CONFIG_SCHEMA_COMPATIBILITY_POLICY,
      ).some((issue) => issue.includes("beacon")),
      "a regression against the tagged publication must fail",
    );
  }, { prefix: "discern-schema-regression-" });
});

Deno.test("every publication starts at major one before and at its first release tag", async () => {
  await withTempDir(async (repo) => {
    await Deno.writeTextFile(`${repo}/publication.txt`, "first publication\n");
    await gitInit(repo);
    for (
      const phase of ["untagged", "first-tag-at-head", "published"] as const
    ) {
      if (phase === "first-tag-at-head") await git(repo, "tag", "v1.0.0");
      if (phase === "published") {
        await git(
          repo,
          "commit",
          "--allow-empty",
          "-m",
          "Continue after publication",
        );
      }
      const predecessor = await publicSchemaBaselineTag(repo);
      assertEquals(predecessor, phase === "published" ? "v1.0.0" : undefined);
      assertEquals(
        initialPublicationIssues(predecessor, PUBLIC_SCHEMA_PUBLICATIONS),
        [],
      );
      for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
        const name = publication.artifactPath.slice(
          "schema/".length,
          -".json".length,
        );
        const advanced: PublicSchemaPublication = {
          ...publication,
          major: 2,
          id: `https://discern.sh/schema/v2/${name}.json`,
          artifactPath: `schema/v2/${name}.json`,
        };
        assertEquals(
          initialPublicationIssues(predecessor, [advanced]).length,
          phase === "published" ? 0 : 1,
          `${phase}: ${publication.artifactPath} cannot evade the first-publication guard`,
        );
      }
    }
  });
});

Deno.test("generated public schemas carry their identities and remain compatible with the last tagged publication", async () => {
  const baselineTag = await publicSchemaBaselineTag(REPO_ROOT);
  if (baselineTag === undefined) {
    assertEquals(
      initialPublicationIssues(undefined, PUBLIC_SCHEMA_PUBLICATIONS),
      [],
    );
    for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
      const current = buildCurrentPublicSchema(publication);
      assertEquals(
        publicSchemaPublicationIdentityIssues(current, publication),
        [],
        `${publication.artifactPath} must carry its registered public identity`,
      );
    }
    return;
  }
  const listed = await runGit(
    [
      "ls-tree",
      "-r",
      "--name-only",
      baselineTag,
      "--",
      "schema",
      "src/shared/public_schemas.ts",
    ],
    { cwd: REPO_ROOT },
  );
  assert(
    listed.success,
    `cannot list public schemas from ${baselineTag}: ${listed.stderr}`,
  );
  const trunkPaths = new Set(
    listed.stdout.split("\n").filter((path) => path.length > 0),
  );
  const baselineArmed = trunkPaths.has(
    "src/shared/public_schemas.ts",
  );
  assertEquals(
    initialPublicationIssues(
      baselineArmed ? baselineTag : undefined,
      PUBLIC_SCHEMA_PUBLICATIONS,
    ),
    [],
  );
  const trunkSchemaArtifactPaths = [...trunkPaths].filter((path) =>
    path.startsWith("schema/") && path.endsWith(".json")
  );
  if (baselineArmed) {
    assertEquals(
      publicSchemaArtifactEnrollmentIssues(
        trunkSchemaArtifactPaths,
        PUBLIC_SCHEMA_PUBLICATIONS,
      ),
      [],
      `${baselineTag} has a public schema artifact that is no longer enrolled`,
    );
  }

  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const current = buildCurrentPublicSchema(publication);
    if (
      publication.compatibility === CONFIG_SCHEMA_COMPATIBILITY_POLICY ||
      publication.compatibility === RESULT_SCHEMA_COMPATIBILITY_POLICY
    ) {
      assertEquals(
        compileErrorOrUndefined(current),
        undefined,
        `${publication.artifactPath} must be valid JSON Schema draft 2020-12`,
      );
    }
    assertEquals(
      publicSchemaPublicationIdentityIssues(current, publication),
      [],
      `${publication.artifactPath} must carry its registered public identity`,
    );
    if (
      !baselineArmed ||
      !trunkPaths.has(publication.artifactPath)
    ) {
      continue;
    }
    const previousResult = await runGit(
      ["show", `${baselineTag}:${publication.artifactPath}`],
      { cwd: REPO_ROOT },
    );
    assert(
      previousResult.success,
      `cannot read ${publication.artifactPath} from ${baselineTag}: ${previousResult.stderr}`,
    );
    const previous = decodeWith(JsonObjectSchema, previousResult.stdout);
    assertEquals(
      publicSchemaPublicationCompatibilityIssues(
        previous,
        current,
        publication,
      ),
      [],
      `${publication.artifactPath} breaks or evades its registered public contract from ${baselineTag}`,
    );
  }
});
