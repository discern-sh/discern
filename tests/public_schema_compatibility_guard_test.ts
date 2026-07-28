/**
 * Same-major public schema compatibility.
 *
 * The live guard compares generated artifacts with the configured trunk. Pure
 * controls use unrelated field and contract names so the predicate proves the
 * class rather than memorizing today's result definitions.
 */

import { assert, assertEquals } from "@std/assert";
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
import { loadConfig } from "../src/shared/config_schema.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

function clone(value: JsonObject): JsonObject {
  return structuredClone(value);
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

Deno.test("result compatibility permits optional fields, new CLI and MCP contracts, and new error slugs", () => {
  const current = clone(RESULT_OUTPUT_FIXTURE);
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
      RESULT_OUTPUT_FIXTURE,
      current,
      RESULT_SCHEMA_COMPATIBILITY_POLICY,
    ),
    [],
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

Deno.test("result compatibility rejects removed contracts and known error slugs", () => {
  const current = clone(RESULT_OUTPUT_FIXTURE);
  const defs = current.$defs as JsonObject;
  const cli = defs.VoyageCliResult as JsonObject;
  cli.oneOf = [];
  current["x-discern-contracts"] = [];
  current["x-discern-error-slugs"] = [];

  assertEquals(
    publicSchemaCompatibilityIssues(
      RESULT_OUTPUT_FIXTURE,
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
  delete nextDefs.VoyageLaunchResult;
  assertEquals(
    publicSchemaPublicationCompatibilityIssues(
      previous,
      nextMajor,
      VOYAGE_PUBLICATION,
    ),
    ["$.$defs.VoyageLaunchResult: removed"],
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
