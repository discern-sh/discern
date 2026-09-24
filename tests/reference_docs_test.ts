import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "@zod/zod";
import { BUILD_TARGETS } from "../scripts/build_targets.ts";
import { ACTIVATION_CLI_CHECK, PROVIDERS } from "../src/lib/providers.ts";
import { TOOLS } from "../src/engine/mcp/server.ts";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import {
  beginEventSchema,
  LOGBOOK_OUTCOMES,
  LOGBOOK_SCHEMA_VERSION,
  LOGBOOK_SURFACES,
  logbookEventSchema,
  verbEventSchema,
} from "../src/engine/logbook/schema.ts";
import { MCP_RESULT_CONTRACTS } from "../src/shared/result_contracts.ts";
import { COMPLETION_TIMING_CATEGORIES } from "../src/engine/completion/protocol.ts";
import {
  CHECKPOINT_MODES,
  CHECKPOINT_OBLIGATION_STATES,
} from "../src/shared/checkpoints.ts";
import { LOGBOOK_LIFECYCLE_ACTION_NAMES } from "../src/shared/logbook_lifecycle.ts";
import { LOGBOOK_POWERED } from "../src/shared/logbook_powered.ts";
import {
  AWAIT_CALL_SECONDS,
  NATIVE_MCP_TIMEOUT_POLICY,
} from "../src/shared/mcp_timeout_policy.ts";
import {
  PUBLIC_SCHEMA_PUBLICATIONS,
  renderPublicSchemaReference,
  replacePublicSchemaReference,
} from "../src/shared/public_schemas.ts";
import { repositoryBlobUrl } from "../src/shared/brand.ts";
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
  MAX_SWEEP_INSPECTIONS,
  MAX_SWEEP_REMOVALS,
  TEMP_ARTIFACT_DIR_KINDS,
  TEMP_ARTIFACT_KINDS,
  TEMP_ARTIFACT_SUFFIX,
  TEMP_ARTIFACT_TTL_MS,
} from "../src/shared/temp_artifacts.ts";
import {
  CONTINUATION_MAX_ENTRIES,
  CONTINUATION_TTL_MS,
} from "../src/engine/continuations/store.ts";
import {
  RETIRED_WORKTREE_PATH_MAX_ENTRIES,
  RETIRED_WORKTREE_PATH_TTL_MS,
} from "../src/engine/worktree/retired_paths.ts";
import { DROP_RECOVERY_REF_LIMIT } from "../src/engine/worktree/recovery_refs.ts";
import { TEMP_ARTIFACT_SWEEP_INTERVAL_MS } from "../src/engine/gate/temp_artifact_sweep.ts";
import { MAX_MONTH_FILES } from "../src/engine/logbook/store.ts";
import { FLEET_ACTIVITY_EVENT_LIMIT } from "../src/engine/logbook/read.ts";
import { PATTERNS_SERIES_MAX_POINTS } from "../src/shared/patterns_vocabulary.ts";
import {
  REQUIRED_RUNTIME_TOOLS,
  runtimePrerequisitesPhrase,
} from "../src/shared/runtime_prerequisites.ts";
import { CRASH_EXIT_CODE, MAX_CRASH_FILES } from "../src/engine/crash.ts";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_paths.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

const PROOF_SCHEMA_INVENTORY = z.object({
  $defs: z.record(
    z.string(),
    z.object({
      properties: z.record(z.string(), z.json()).optional(),
    }).passthrough(),
  ),
}).passthrough();

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
const quickstart = await Deno.readTextFile(
  `${REPO_AUTHORED_PATHS.map}/10-getting-started/quickstart.md`,
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

Deno.test("the progress timings row names exactly the recorded timing categories", () => {
  const row = mcpReference.split("\n").find((line) =>
    line.startsWith("| `data.timings`")
  );
  assert(row !== undefined, "the progress reference documents data.timings");
  assertEquals(missingCodeMembers(row, COMPLETION_TIMING_CATEGORIES), []);
  const documented = [...row.matchAll(/`([a-z]+(?:-[a-z]+)+|[a-z]+)`/g)]
    .map((match) => match[1] ?? "")
    .filter((word) =>
      !["interval_id", "category", "started_at", "finished_at"].includes(word)
    );
  assertEquals(
    documented.filter((word) =>
      !(COMPLETION_TIMING_CATEGORIES as readonly string[]).includes(word)
    ),
    [],
    "the row names a timing category discern doesn't record",
  );
});

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
    renderPublicSchemaReference(repositoryBlobUrl),
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

Deno.test("the result vocabularies the manual lists are total", () => {
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
    assertStringIncludes(
      providerReference,
      `\`${provider.activation.callable}\``,
      `${provider.name}: activation check`,
    );
    assertStringIncludes(
      providerReference,
      provider.activation.recovery,
      `${provider.name}: activation recovery`,
    );
  }
  assertStringIncludes(providerReference, `\`${ACTIVATION_CLI_CHECK}\``);
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
  const schema = decodeWith(
    PROOF_SCHEMA_INVENTORY,
    await Deno.readTextFile("schema/discern-proof-note.schema.json"),
  );
  const definitions = schema.$defs;
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

Deno.test("the manual Logbook page names every logbook-powered capability", () => {
  assertEquals(
    LOGBOOK_POWERED.filter((member) =>
      !logbookReference.includes(member.phrase)
    ).map((member) => member.key),
    [],
    "logbook.md: the What it powers list carries each registry phrase verbatim",
  );
});

Deno.test("every begin/verb Logbook field is named by both field accounts", async () => {
  // A schema field added without documentation shipped silently once
  // (lock_boundary, dry_run, has_operands). Derive the field set from the live
  // event schemas so a future field must reach the manual reference and the
  // Map's account in the same change.
  const fieldKeys = [
    ...new Set([
      ...Object.keys(beginEventSchema.shape),
      ...Object.keys(verbEventSchema.shape),
    ]),
  ];
  const mapLogbookAccount = await Deno.readTextFile(
    `${REPO_AUTHORED_PATHS.map}/70-reference/the-logbook.md`,
  );
  assertEquals(missingCodeMembers(logbookReference, fieldKeys), []);
  assertEquals(missingCodeMembers(mapLogbookAccount, fieldKeys), []);
});

Deno.test("every registered Git-admin record is named by both ownership accounts", async () => {
  // The runtime-state tables are authored, so a record registered in
  // GIT_ADMIN_STATE could ship undocumented (parked-tasks and task-metadata
  // did). Derive the population from the registry so a future record must
  // reach the manual reference and the Map's account in the same change.
  const registeredPaths = Object.values(GIT_ADMIN_STATE).map(
    (record) => (record as { path: string }).path,
  );
  const mapOwnershipAccount = await Deno.readTextFile(
    `${REPO_AUTHORED_PATHS.map}/70-reference/artifact-ownership.md`,
  );
  for (const document of [fileReference, mapOwnershipAccount]) {
    const missing = registeredPaths.filter((path) =>
      !document.includes(`\`${path}\``) && !document.includes(`\`${path}/\``)
    );
    assertEquals(missing, []);
  }
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

Deno.test("retention and bounded-reader prose derives from live limits", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const claims: ReadonlyArray<[string, string, string]> = [
    [
      "continuation lifetime",
      fileReference,
      `${CONTINUATION_TTL_MS / dayMs}-day time limit`,
    ],
    [
      "continuation cap",
      fileReference,
      `${CONTINUATION_MAX_ENTRIES}-record repository cap`,
    ],
    [
      "removed-path lifetime",
      fileReference,
      `${RETIRED_WORKTREE_PATH_TTL_MS / dayMs}-day limit`,
    ],
    [
      "removed-path cap",
      fileReference,
      `${RETIRED_WORKTREE_PATH_MAX_ENTRIES}-record cap`,
    ],
    [
      "drop-recovery cap",
      fileReference,
      `newest ${DROP_RECOVERY_REF_LIMIT} refs`,
    ],
    [
      "temporary inspection cap",
      fileReference,
      `at most ${MAX_SWEEP_INSPECTIONS} matching entries`,
    ],
    [
      "temporary removal cap",
      fileReference,
      `at most ${MAX_SWEEP_REMOVALS} expired entries`,
    ],
    [
      "temporary sweep interval",
      fileReference,
      TEMP_ARTIFACT_SWEEP_INTERVAL_MS === hourMs
        ? "one page per hour"
        : `one page per ${TEMP_ARTIFACT_SWEEP_INTERVAL_MS / hourMs} hours`,
    ],
    [
      "fleet activity bound",
      logbookReference,
      `newest ${FLEET_ACTIVITY_EVENT_LIMIT} events`,
    ],
    [
      "pattern series bound",
      logbookReference,
      `capped at ${PATTERNS_SERIES_MAX_POINTS} points`,
    ],
    [
      "logbook retention",
      logbookReference,
      `newest ${MAX_MONTH_FILES} months`,
    ],
  ];
  for (const [name, document, phrase] of claims) {
    assertStringIncludes(document, phrase, name);
  }
});

Deno.test("runtime prerequisite reference derives from one command set", () => {
  assertEquals(REQUIRED_RUNTIME_TOOLS, ["git", "sh"]);
  const phrase = runtimePrerequisitesPhrase();
  assertStringIncludes(providerReference, phrase);
});

Deno.test("the Map quickstart enumerates every known job from the registry", () => {
  const enumeration = quickstart.match(
    /the gate runs the known jobs ([^.]+) when they are applicable/u,
  )?.[1];
  assert(
    enumeration !== undefined,
    "quickstart must carry one bounded known-job sentence",
  );
  const names = [...enumeration.matchAll(/`([^`]+)`/g)].map((match) =>
    match[1] ?? ""
  );
  assertEquals(names, Object.keys(KNOWN_JOBS));
});

Deno.test("current ADR claims use the live gate-Proof path", async () => {
  const decision = await Deno.readTextFile(
    `${REPO_AUTHORED_PATHS.map}/_adr/0165-git-admin-state-namespaced-by-lifetime.md`,
  );
  assertStringIncludes(decision, `\`${GIT_ADMIN_STATE.gateProof.path}\``);
  assertEquals(decision.includes("discern/gate-receipt"), false);
});

const HISTORICAL_IDENTITY_AMENDMENTS = new Map([
  [
    "0076-engine-commits-scaffolded-machinery.md",
    "The amendment records the superseded identity so old history remains interpretable.",
  ],
  [
    "0106-standards-pin-carries-the-gate-receipt.md",
    "The amendment records the superseded identity so old history remains interpretable.",
  ],
  [
    "0203-discern-co-authors-only-commits-it-composes.md",
    "The identity amendment explains why old trailers carry a different verified address.",
  ],
]);

Deno.test("superseded machine identities survive only in marked ADR amendments", async () => {
  const offenders: string[] = [];
  for (const [file, reason] of HISTORICAL_IDENTITY_AMENDMENTS) {
    assert(reason.trim().length > 0);
    const text = await Deno.readTextFile(
      `${REPO_AUTHORED_PATHS.map}/_adr/${file}`,
    );
    const lines = text.split("\n").filter((line) =>
      /discern-bot|bot@discern\.sh/u.test(line)
    );
    if (lines.length === 0 || lines.some((line) => !line.startsWith(">"))) {
      offenders.push(`${file}: historical identity must stay in an amendment`);
    }
  }
  for await (const entry of Deno.readDir(`${REPO_AUTHORED_PATHS.map}/_adr`)) {
    if (!entry.isFile || !entry.name.endsWith(".md")) continue;
    const text = await Deno.readTextFile(
      `${REPO_AUTHORED_PATHS.map}/_adr/${entry.name}`,
    );
    if (
      /discern-bot|bot@discern\.sh/u.test(text) &&
      !HISTORICAL_IDENTITY_AMENDMENTS.has(entry.name)
    ) {
      offenders.push(`${entry.name}: superseded identity in current ADR prose`);
    }
  }
  assertEquals(offenders, []);
});
