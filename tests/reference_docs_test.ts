import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { BUILD_TARGETS } from "../scripts/build_targets.ts";
import { PROVIDERS } from "../src/lib/providers.ts";
import { TOOLS } from "../src/engine/mcp/server.ts";
import {
  LOGBOOK_OUTCOMES,
  LOGBOOK_SCHEMA_VERSION,
  LOGBOOK_SURFACES,
  logbookEventSchema,
} from "../src/engine/logbook/schema.ts";
import { MCP_RESULT_CONTRACTS } from "../src/shared/result_contracts.ts";
import {
  CHECKPOINT_MODES,
  CHECKPOINT_OBLIGATION_STATES,
} from "../src/shared/checkpoints.ts";
import { LOGBOOK_LIFECYCLE_ACTION_NAMES } from "../src/shared/logbook_lifecycle.ts";
import {
  AWAIT_CALL_SECONDS,
  NATIVE_MCP_TIMEOUT_POLICY,
} from "../src/shared/mcp_timeout_policy.ts";
import {
  PUBLIC_SCHEMA_PUBLICATIONS,
  renderPublicSchemaReference,
  replacePublicSchemaReference,
} from "../src/shared/public_schemas.ts";
import {
  DIAGNOSTIC_SEVERITIES,
  ERROR_SLUGS,
  FAILED_STAGES,
  RESULT_ADVISORY_KINDS,
  STEP_DISPOSITIONS,
  STEP_KINDS,
  STEP_OUTCOMES,
} from "../src/shared/result.ts";
import {
  TEMP_ARTIFACT_DIR_KINDS,
  TEMP_ARTIFACT_KINDS,
  TEMP_ARTIFACT_SUFFIX,
  TEMP_ARTIFACT_TTL_MS,
} from "../src/shared/temp_artifacts.ts";
import { CRASH_EXIT_CODE, MAX_CRASH_FILES } from "../src/engine/crash.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const mcpReferencePath =
  `${REPO_AUTHORED_PATHS.manual}/30-reference/mcp-and-results.md`;
const mcpReference = await Deno.readTextFile(mcpReferencePath);
const proofReference = await Deno.readTextFile(
  `${REPO_AUTHORED_PATHS.manual}/30-reference/proof-and-checkpoint-formats.md`,
);
const providerReference = await Deno.readTextFile(
  `${REPO_AUTHORED_PATHS.manual}/30-reference/platforms-and-providers.md`,
);
const logbookReference = await Deno.readTextFile(
  `${REPO_AUTHORED_PATHS.manual}/30-reference/logbook.md`,
);
const fileReference = await Deno.readTextFile(
  `${REPO_AUTHORED_PATHS.manual}/30-reference/files-and-ownership.md`,
);

/** Members absent from a Markdown contract's exact code vocabulary. */
function missingCodeMembers(
  document: string,
  members: readonly (string | number)[],
): string[] {
  return members.map(String).filter((member) =>
    !document.includes(`\`${member}\``)
  );
}

Deno.test("the public MCP tools table is total over the result-contract registry", () => {
  const documented = [
    ...new Set([
      ...mcpReference.matchAll(/^\| `(discern_[a-z_]+)`\s+\|/gm),
    ].map((match) => match[1] ?? "")),
  ].sort();
  const registered = MCP_RESULT_CONTRACTS.map((contract) => contract.mcpTool)
    .sort();
  assertEquals(documented, registered);
});

Deno.test("every MCP tool name is a search alias on the public contract page", () => {
  const frontmatter = mcpReference.split("\n---\n")[0] ?? "";
  for (const contract of MCP_RESULT_CONTRACTS) {
    assertStringIncludes(frontmatter, `  - "${contract.mcpTool}"`);
  }
});

Deno.test("the public contract reference publishes every versioned schema", () => {
  for (const publication of PUBLIC_SCHEMA_PUBLICATIONS) {
    assertStringIncludes(mcpReference, publication.id);
    assertStringIncludes(mcpReference, publication.artifactPath);
  }
});

Deno.test("a future public schema publication auto-enrols in the generated region", () => {
  const model = PUBLIC_SCHEMA_PUBLICATIONS[0];
  assert(model !== undefined);
  const document = renderPublicSchemaReference(
    (path) => `https://example.test/${path}`,
    [
      ...PUBLIC_SCHEMA_PUBLICATIONS,
      {
        ...model,
        label: "Future reference control",
        id: "https://discern.sh/schema/v1/future-reference-control.schema.json",
        artifactPath: "schema/future-reference-control.schema.json",
      },
    ],
  );
  assertStringIncludes(document, "Future reference control");
  assertStringIncludes(document, "future-reference-control.schema.json");
});

Deno.test("the public schema reference matches the registry generator (run `deno task codegen`)", async () => {
  const generated = replacePublicSchemaReference(
    mcpReference,
    renderPublicSchemaReference((path) =>
      `https://github.com/jackwh/discern/blob/main/${path}`
    ),
  );
  assertEquals(
    mcpReference,
    await canonicalGeneratedMarkdown(mcpReferencePath, generated),
    `${REPO_AUTHORED_PATHS.manualRel}/30-reference/mcp-and-results.md is stale — run \`deno task codegen\``,
  );
});

Deno.test("the missing-member control names a future satellite exactly", () => {
  assertEquals(
    missingCodeMembers("Current: `present`.", ["present", "future-member"]),
    ["future-member"],
  );
});

Deno.test("every MCP tool and strict input key is present in the manual", () => {
  for (const tool of TOOLS) {
    assertStringIncludes(mcpReference, `\`${tool.name}\``);
    for (const key of Object.keys(tool.inputSchema)) {
      assertStringIncludes(
        mcpReference,
        `\`${key}\``,
        `${tool.name}: missing input key ${key}`,
      );
    }
  }
});

Deno.test("closed result vocabularies are total in the manual", () => {
  for (
    const [label, members] of Object.entries({
      step_kinds: STEP_KINDS,
      step_dispositions: STEP_DISPOSITIONS,
      step_outcomes: STEP_OUTCOMES,
      diagnostic_severities: DIAGNOSTIC_SEVERITIES,
      advisory_kinds: RESULT_ADVISORY_KINDS,
      failed_stages: FAILED_STAGES,
      error_slugs: ERROR_SLUGS,
    })
  ) {
    assertEquals(
      missingCodeMembers(mcpReference, members),
      [],
      `${label}: the public result reference is missing a registered member`,
    );
  }
});

Deno.test("provider, platform, and timeout registries have complete manual satellites", () => {
  for (const provider of Object.values(PROVIDERS)) {
    assertStringIncludes(providerReference, provider.label);
    assertStringIncludes(
      providerReference,
      `\`${provider.instructionFile.path}\``,
    );
    if (provider.skillsDir !== undefined) {
      assertStringIncludes(
        providerReference,
        `\`${provider.skillsDir.path}/\``,
      );
    }
    if (provider.mcp.kind === "wired") {
      assertStringIncludes(
        providerReference,
        `\`${provider.mcp.integration.configFile}\``,
      );
    }
    if (provider.hooks !== undefined) {
      assertStringIncludes(
        providerReference,
        `\`${provider.hooks.settingsFile}\``,
      );
    }
    const policy = NATIVE_MCP_TIMEOUT_POLICY[provider.name];
    assertEquals(
      policy === undefined,
      false,
      `${provider.name}: timeout policy`,
    );
  }
  for (const target of BUILD_TARGETS) {
    assertStringIncludes(providerReference, `\`${target.output}\``);
  }
  for (const seconds of Object.values(AWAIT_CALL_SECONDS)) {
    assertStringIncludes(
      mcpReference,
      seconds.toLocaleString("en-US"),
    );
  }
});

Deno.test("Proof and checkpoint closed states and schema fields are complete", async () => {
  assertEquals(
    missingCodeMembers(proofReference, [
      ...CHECKPOINT_MODES,
      ...CHECKPOINT_OBLIGATION_STATES,
    ]),
    [],
  );
  const schema = JSON.parse(
    await Deno.readTextFile("schema/discern-proof-note.schema.json"),
  ) as Record<string, unknown>;
  const definitions = schema.$defs as Record<
    string,
    { properties?: Record<string, unknown> }
  >;
  for (
    const name of [
      "DiscernProofClaim",
      "DiscernProofPresentation",
      "DiscernAcceptanceEvidence",
      "DiscernAuthorizedVariance",
      "DiscernProofNotePayload",
    ]
  ) {
    const fields = Object.keys(definitions[name]?.properties ?? {});
    assertEquals(
      missingCodeMembers(proofReference, fields),
      [],
      `${name}: the Proof reference is missing schema fields`,
    );
  }
});

Deno.test("Logbook event, outcome, surface, and lifecycle sets are complete", () => {
  const eventKinds = logbookEventSchema.options.map((schema) =>
    schema.shape.kind.value
  );
  assertEquals(
    missingCodeMembers(logbookReference, [
      LOGBOOK_SCHEMA_VERSION,
      ...eventKinds,
      ...LOGBOOK_OUTCOMES,
      ...LOGBOOK_SURFACES,
      ...LOGBOOK_LIFECYCLE_ACTION_NAMES,
    ]),
    [],
  );
});

Deno.test("temporary and crash record limits remain exact in the ownership page", () => {
  for (
    const prefix of [
      ...Object.values(TEMP_ARTIFACT_KINDS),
      ...Object.values(TEMP_ARTIFACT_DIR_KINDS),
    ]
  ) {
    assertStringIncludes(fileReference, prefix);
  }
  assertStringIncludes(fileReference, TEMP_ARTIFACT_SUFFIX);
  assertStringIncludes(
    fileReference,
    `${TEMP_ARTIFACT_TTL_MS / (60 * 60 * 1000)} hours`,
  );
  assertStringIncludes(fileReference, `newest ${MAX_CRASH_FILES}`);
  assertStringIncludes(fileReference, `exits \`${CRASH_EXIT_CODE}\``);
});
