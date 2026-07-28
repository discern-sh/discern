/**
 * Same-major public schema compatibility.
 *
 * The live guard compares generated artifacts with the configured trunk. Pure
 * controls use unrelated field and contract names so the predicate proves the
 * class rather than memorizing today's result definitions.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Ajv2020 } from "ajv-2020";
import {
  buildCurrentPublicSchema,
  type JsonObject,
  type JsonValue,
  publicSchemaArtifactEnrollmentIssues,
  publicSchemaCompatibilityIssues,
  publicSchemaPublicationCompatibilityIssues,
  publicSchemaPublicationIdentityIssues,
} from "../scripts/public_schema_compatibility.ts";
import {
  CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
  PUBLIC_SCHEMA_PUBLICATIONS,
  type PublicSchemaPublication,
  RESULT_SCHEMA_COMPATIBILITY_POLICY,
} from "../src/shared/public_schemas.ts";
import { RESULT_CONTRACT_REFERENCE_FIELDS } from "../src/shared/result_contracts.ts";
import { buildConfigDocJsonSchema } from "../src/shared/config_codegen.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

function clone(value: JsonObject): JsonObject {
  return structuredClone(value);
}

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
      mcpTool: "voyage_launch",
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
      mcpTool: "voyage_land",
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

Deno.test("a discriminator on a role aggregate stays transparent and admits mappings only for new contracts", () => {
  // Trunk: the CLI aggregate carries an OpenAPI-style discriminator over its
  // oneOf — the shape the real generated artifact ships.
  const previous = clone(RESULT_OUTPUT_FIXTURE);
  const previousCli = (previous.$defs as JsonObject)
    .VoyageCliResult as JsonObject;
  previousCli.discriminator = {
    propertyName: "verb",
    mapping: { launch: "#/$defs/VoyageLaunchResult" },
  };

  // A new registered contract adds its definition, its oneOf alternative, AND
  // its mapping key — the sanctioned additive change, in the artifact's shape.
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
  cli.oneOf = [
    ...(cli.oneOf as JsonValue[]),
    { $ref: "#/$defs/VoyageLandResult" },
  ];
  (cli.discriminator as JsonObject).mapping = {
    launch: "#/$defs/VoyageLaunchResult",
    land: "#/$defs/VoyageLandResult",
  };
  current["x-discern-contracts"] = [
    ...(current["x-discern-contracts"] as JsonValue[]),
    {
      id: "voyageLand",
      verb: "land",
      commands: ["land"],
      [RESULT_CONTRACT_REFERENCE_FIELDS.cli]: "#/$defs/VoyageLandResult",
    },
  ];
  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
    "a discriminator must not defeat the registered-contract addition allowance",
  );

  // An added mapping key with no registered new contract behind it stays a
  // break — the mapping cannot smuggle routes the contract registry never
  // sanctioned.
  const smuggled = clone(previous);
  const smuggledCli = (smuggled.$defs as JsonObject)
    .VoyageCliResult as JsonObject;
  (smuggledCli.discriminator as JsonObject).mapping = {
    launch: "#/$defs/VoyageLaunchResult",
    rogue: "#/$defs/VoyageStringSignal",
  };
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      smuggled,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("discriminator.mapping.rogue")),
    "an unsanctioned mapping addition must stay flagged",
  );

  // Re-routing an existing mapping stays a break, as does changing the
  // discriminating property.
  const rerouted = clone(previous);
  const reroutedCli = (rerouted.$defs as JsonObject)
    .VoyageCliResult as JsonObject;
  (reroutedCli.discriminator as JsonObject).mapping = {
    launch: "#/$defs/VoyageStringSignal",
  };
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      rerouted,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("discriminator.mapping.launch")),
    "a re-routed existing mapping must stay flagged",
  );
  const renamedProperty = clone(previous);
  const renamedCli = (renamedProperty.$defs as JsonObject)
    .VoyageCliResult as JsonObject;
  (renamedCli.discriminator as JsonObject).propertyName = "kind";
  assert(
    publicSchemaCompatibilityIssues(
      previous,
      renamedProperty,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ).some((issue) => issue.includes("discriminator.propertyName")),
    "a changed discriminator property must stay flagged",
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
      mcpTool: "voyage_land",
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
  survey.mcpTool = "voyage_survey";
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
  delete previousContract.mcpTool;
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
  currentContract.mcpTool = "voyage_launch";
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
  delete baselineContract.mcpTool;
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
  currentContract.mcpTool = "voyage_launch";
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
  const nextLaunch = nextDefs.VoyageLaunchResult as JsonObject;
  nextLaunch.type = "string";
  assertEquals(
    publicSchemaPublicationCompatibilityIssues(
      previous,
      nextMajor,
      VOYAGE_PUBLICATION,
    ),
    [
      '$.$defs.VoyageLaunchResult.type: changed from "object" to "string"',
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

Deno.test("generated public schemas remain compatible with each configured-trunk artifact", async () => {
  const config = await loadConfig(REPO_ROOT);
  const trunk = config.repository.trunk;
  const listed = await runGit(
    [
      "ls-tree",
      "-r",
      "--name-only",
      trunk,
      "--",
      "schema",
      "src/shared/public_schemas.ts",
    ],
    { cwd: REPO_ROOT },
  );
  assert(
    listed.success,
    `cannot list public schemas from configured trunk ${trunk}: ${listed.stderr}`,
  );
  const trunkPaths = new Set(
    listed.stdout.split("\n").filter((path) => path.length > 0),
  );
  const trunkHasPublicationRegistry = trunkPaths.has(
    "src/shared/public_schemas.ts",
  );
  const trunkSchemaArtifactPaths = [...trunkPaths].filter((path) =>
    path.startsWith("schema/") && path.endsWith(".json")
  );
  if (trunkHasPublicationRegistry) {
    assertEquals(
      publicSchemaArtifactEnrollmentIssues(
        trunkSchemaArtifactPaths,
        PUBLIC_SCHEMA_PUBLICATIONS,
      ),
      [],
      `configured trunk ${trunk} has a public schema artifact that is no longer enrolled`,
    );
  }

  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    const current = buildCurrentPublicSchema(publication);
    assertEquals(
      compileErrorOrUndefined(current),
      undefined,
      `${publication.artifactPath} must be valid JSON Schema draft 2020-12`,
    );
    assertEquals(
      publicSchemaPublicationIdentityIssues(current, publication),
      [],
      `${publication.artifactPath} must carry its registered public identity`,
    );
    if (
      !trunkHasPublicationRegistry ||
      !trunkPaths.has(publication.artifactPath)
    ) {
      continue;
    }
    const previousResult = await runGit(
      ["show", `${trunk}:${publication.artifactPath}`],
      { cwd: REPO_ROOT },
    );
    assert(
      previousResult.success,
      `cannot read ${publication.artifactPath} from configured trunk ${trunk}: ${previousResult.stderr}`,
    );
    const previous = JSON.parse(previousResult.stdout) as JsonObject;
    assertEquals(
      publicSchemaPublicationCompatibilityIssues(
        previous,
        current,
        publication,
      ),
      [],
      `${publication.artifactPath} breaks or evades its registered public contract from configured trunk ${trunk}`,
    );
  }
});
