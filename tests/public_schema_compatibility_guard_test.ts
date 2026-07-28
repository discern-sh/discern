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
  publicSchemaCompatibilityIssues,
} from "../scripts/public_schema_compatibility.ts";
import { PUBLIC_SCHEMA_PUBLICATIONS } from "../src/shared/public_schemas.ts";
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
  oneOf: [{ $ref: "#/$defs/VoyageCliResult" }],
  $defs: {
    VoyageCliResult: {
      oneOf: [{ $ref: "#/$defs/VoyageLaunchResult" }],
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
      schema: "#/$defs/VoyageLaunchResult",
    },
  ],
  "x-discern-error-slugs": ["launch_failed"],
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

Deno.test("result compatibility permits optional fields, new contracts, and new error slugs", () => {
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
  const cli = defs.VoyageCliResult as JsonObject;
  cli.oneOf = [
    { $ref: "#/$defs/VoyageLandResult" },
    ...(cli.oneOf as JsonValue[]),
  ];
  current["x-discern-contracts"] = [
    {
      id: "voyageLand",
      verb: "land",
      commands: ["land"],
      schema: "#/$defs/VoyageLandResult",
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

Deno.test("generated public schemas remain compatible with the configured trunk artifact at the same id", async () => {
  const config = await loadConfig(REPO_ROOT);
  const trunk = config.repository.trunk;
  const listed = await runGit(
    ["ls-tree", "-r", "--name-only", trunk, "--", "schema"],
    { cwd: REPO_ROOT },
  );
  assert(
    listed.success,
    `cannot list public schemas from configured trunk ${trunk}: ${listed.stderr}`,
  );
  const trunkPaths = new Set(
    listed.stdout.split("\n").filter((path) => path.length > 0),
  );

  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    assertEquals(
      new URL(publication.id).pathname.split("/")[2],
      `v${publication.major}`,
      `${publication.id} must carry its registered schema major`,
    );
    const current = buildCurrentPublicSchema(publication);
    assertEquals(
      current.$id,
      publication.id,
      `${publication.artifactPath} must carry its registered public id`,
    );
    if (!trunkPaths.has(publication.artifactPath)) {
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
    if (previous.$id !== publication.id) {
      continue;
    }
    assertEquals(
      publicSchemaCompatibilityIssues(
        previous,
        current,
        publication.compatibility,
      ),
      [],
      `${publication.artifactPath} breaks the ${publication.id} contract from configured trunk ${trunk}`,
    );
  }
});
