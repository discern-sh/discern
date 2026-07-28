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
  PUBLIC_SCHEMA_PUBLICATIONS,
  type PublicSchemaPublication,
} from "../src/shared/public_schemas.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

function clone(value: JsonObject): JsonObject {
  return structuredClone(value);
}

const CONFIG_INPUT_FIXTURE: JsonObject = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://discern.sh/schema/v1/voyage-config.schema.json",
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
      schema: "#/$defs/VoyageLaunchResult",
      mcpToolResultSchema: "#/$defs/VoyageLaunchMcpToolResult",
    },
  ],
  "x-discern-error-slugs": ["launch_failed"],
};

const VOYAGE_PUBLICATION: PublicSchemaPublication = {
  id: "https://discern.sh/schema/v1/voyage-results.schema.json",
  artifactPath: "schema/voyage-results.schema.json",
  major: 1,
  compatibility: "result-output",
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
      "config-input",
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
      "config-input",
    ).some((issue) => issue.startsWith("$.properties.channel.type:")),
  );

  const required = clone(CONFIG_INPUT_FIXTURE);
  required.required = ["beacon", "future"];
  assertEquals(
    publicSchemaCompatibilityIssues(
      CONFIG_INPUT_FIXTURE,
      required,
      "config-input",
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
      "config-input",
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
      schema: "#/$defs/VoyageLandResult",
      mcpToolResultSchema: "#/$defs/VoyageLandMcpToolResult",
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
      "result-output",
    ),
    [],
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
      schema: "#/$defs/VoyageSurveyResult",
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
  survey.mcpToolResultSchema = "#/$defs/VoyageSurveyMcpToolResult";

  assertEquals(
    publicSchemaCompatibilityIssues(
      previous,
      current,
      "result-output",
    ),
    [],
  );
});

Deno.test("result compatibility discovers future contract-definition references without a field allowlist", () => {
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
      "result-output",
    ),
    [],
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
      "result-output",
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
      "result-output",
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
      "result-output",
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
      "result-output",
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
      "result-output",
    ),
    [
      '$.$defs.VoyageCliResult.oneOf: removed alternative {"$ref":"#/$defs/VoyageLaunchResult"}',
      '$.x-discern-contracts: removed contract "voyageLaunch"',
      '$.x-discern-error-slugs: removed value "launch_failed"',
    ],
  );
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

Deno.test("schema publication identity rejects generated-id drift and resets only for an increasing major", () => {
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
  assertEquals(
    publicSchemaPublicationCompatibilityIssues(
      previous,
      nextMajor,
      {
        ...VOYAGE_PUBLICATION,
        id: "https://discern.sh/schema/v2/voyage-results.schema.json",
        major: 2,
      },
    ),
    [],
    "v1 to v2 starts a fresh structural baseline",
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

Deno.test("generated public schemas remain compatible with the configured trunk artifact or advance their major", async () => {
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
