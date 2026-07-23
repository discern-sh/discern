/**
 * The canonical-sets meta-registry — the closed set of closed sets (ADR 0176,
 * the ADR 0051 discipline applied to the discipline itself, following the
 * registry lineage of `glossary_registry.ts` and `feature_registry.ts`).
 *
 * Every canonical set in this repository — a closed member list with a single
 * source, guard tests, and generated artifacts — is declared here: where the
 * set lives, which tests hold it to its satellites, which committed artifacts
 * compile from it, and how it is enrolled in the two enrolling registries (the
 * glossary and the feature canon), or why it deliberately is not.
 *
 * The enrolment guard (`tests/canonical_sets_enrolment_test.ts`) checks both
 * directions. Forward: every declared source resolves to a non-empty member
 * set, every guard exists and references its source, every artifact is
 * committed with its banner or block markers. Reverse: convention sweeps over
 * conventionally named guard tests, codegen write targets, and fmt-excluded
 * generated map pages fail the gate on anything no declared set claims. The
 * meta-layer only REFERENCES the existing guards — they stay exactly as
 * written; a generic enrolment engine is the one shape this module must never
 * grow into.
 *
 * The registry enrols itself: `canonical-sets` is an entry, this module is its
 * source, and the atlas page it renders is its artifact.
 */

import { dirname, fromFileUrl, join } from "@std/path";

/** Where a canonical set's single source lives. */
export type SetSource =
  | {
    readonly kind: "module";
    /** Repo-relative TypeScript module holding the set. */
    readonly module: string;
    /** The export the set reads from. */
    readonly exportName: string;
  }
  | {
    readonly kind: "file";
    /** Repo-relative authored file holding the set. */
    readonly path: string;
    /** Text whose presence proves the set is still where declared. */
    readonly mustContain: string;
  };

/** How a set is enrolled in the glossary, or why it deliberately is not. */
export type GlossaryEnrolment =
  | { readonly term: string }
  | { readonly perMember: string }
  | { readonly absent: string };

/** How a set is enrolled in the feature canon, or why it deliberately is not. */
export type CanonEnrolment =
  | { readonly surfaceSet: string }
  | { readonly nodeId: string }
  | { readonly absent: string };

/** One committed artifact compiled from a canonical set. */
export type GeneratedArtifact =
  | {
    readonly path: string;
    readonly kind: "generated-file";
    /** Whether the file carries a generated banner (JSON cannot). */
    readonly banner: boolean;
  }
  | {
    readonly path: string;
    /** An authored page holding a generated block between markers. */
    readonly kind: "maintained-block";
  };

/** One canonical set: its source, satellites, and enrolments. */
export interface CanonicalSetEntry {
  readonly id: string;
  readonly title: string;
  /** One-sentence account of the set, rendered on the atlas page. */
  readonly what: string;
  readonly source: SetSource;
  /** Test files holding this set to its satellites. */
  readonly guards: readonly string[];
  /** Committed artifacts compiled from this set. */
  readonly artifacts: readonly GeneratedArtifact[];
  readonly enrolledIn: {
    readonly glossary: GlossaryEnrolment;
    readonly featureCanon: CanonEnrolment;
  };
  /** Resolve the live member names from the source (module sources only). */
  readonly members?: () => Promise<readonly string[]>;
}

/** The closed set of closed sets. */
export const CANONICAL_SETS: readonly CanonicalSetEntry[] = [
  {
    id: "verbs",
    title: "Top-level verbs",
    what:
      "The top-level command vocabulary: every verb the dispatcher accepts, CLI and MCP alike.",
    source: {
      kind: "module",
      module: "src/engine/dispatch.ts",
      exportName: "KNOWN_VERBS",
    },
    guards: [
      "tests/engine_verb_parity_test.ts",
      "tests/engine_plan_parity_test.ts",
      "tests/cli_reference_codegen_test.ts",
      "tests/feature_canon_enrolment_test.ts",
      "tests/glossary_enrolment_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/70-reference/cli-reference.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: { perMember: "tests/glossary_enrolment_test.ts" },
      featureCanon: { surfaceSet: "verb" },
    },
    members:
      async () => [...(await import("../src/engine/dispatch.ts")).KNOWN_VERBS],
  },
  {
    id: "mcp-tools",
    title: "MCP tools",
    what:
      "The MCP tool table; verb parity ties every tool to a CLI verb, so the two surfaces cannot drift.",
    source: {
      kind: "module",
      module: "src/engine/mcp/server.ts",
      exportName: "TOOLS",
    },
    guards: [
      "tests/engine_verb_parity_test.ts",
      "tests/result_codegen_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "tools mirror the verb vocabulary; the glossary defines each verb once",
      },
      featureCanon: { nodeId: "mcp-surface" },
    },
    members: async () =>
      (await import("../src/engine/mcp/server.ts")).TOOLS.map(
        (tool) => tool.name,
      ),
  },
  {
    id: "jobs",
    title: "Gate jobs",
    what: "The known gate jobs — the command table's fixed vocabulary.",
    source: {
      kind: "module",
      module: "src/shared/capabilities.ts",
      exportName: "KNOWN_JOBS",
    },
    guards: [
      "tests/config_codegen_test.ts",
      "tests/glossary_enrolment_test.ts",
      "tests/feature_canon_enrolment_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: { term: "Gate job" },
      featureCanon: { surfaceSet: "job" },
    },
    members: async () =>
      Object.keys((await import("../src/shared/capabilities.ts")).KNOWN_JOBS),
  },
  {
    id: "stages",
    title: "Stages",
    what: "The gate's stage vocabulary and order.",
    source: {
      kind: "module",
      module: "src/shared/capabilities.ts",
      exportName: "STAGES",
    },
    guards: [
      "tests/glossary_enrolment_test.ts",
      "tests/feature_canon_enrolment_test.ts",
      "tests/execution_model_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: { term: "Stage" },
      featureCanon: { surfaceSet: "stage" },
    },
    members:
      async () => [...(await import("../src/shared/capabilities.ts")).STAGES],
  },
  {
    id: "step-kinds",
    title: "Step kinds",
    what:
      "The result step vocabulary and the actor and hint doctor renders for every kind.",
    source: {
      kind: "module",
      module: "src/engine/doctor/execution_model.ts",
      exportName: "STEP_KIND_ANNOTATIONS",
    },
    guards: ["tests/execution_model_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "values in each result step; doctor explains every kind in context",
      },
      featureCanon: { nodeId: "doctor" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/engine/doctor/execution_model.ts"))
          .STEP_KIND_ANNOTATIONS,
      ),
  },
  {
    id: "config-tables",
    title: "Config tables",
    what:
      "The top-level tables of the config schema — the whole configuration surface.",
    source: {
      kind: "module",
      module: "src/shared/config_schema.ts",
      exportName: "configSchema",
    },
    guards: [
      "tests/config_codegen_test.ts",
      "tests/config_banner_parity_test.ts",
      "tests/config_set_schema_guard_test.ts",
      "tests/feature_canon_enrolment_test.ts",
    ],
    artifacts: [
      {
        path: "schema/discern-config.schema.json",
        kind: "generated-file",
        banner: false,
      },
      {
        path: "project/map/70-reference/config-reference.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "config keys are reference material; the config reference documents every table",
      },
      featureCanon: { surfaceSet: "config" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/config_schema.ts")).configSchema.shape,
      ),
  },
  {
    id: "bundled-skills",
    title: "Bundled skills",
    what: "The skills the binary ships and materializes into a project.",
    source: {
      kind: "module",
      module: "src/lib/skills.ts",
      exportName: "bundledSkillNames",
    },
    guards: [
      "tests/skill_name_parity_test.ts",
      "tests/feature_canon_enrolment_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: { term: "Skill" },
      featureCanon: { surfaceSet: "skill" },
    },
    members: async () =>
      await (await import("../src/lib/skills.ts")).bundledSkillNames(),
  },
  {
    id: "agent-providers",
    title: "Agent providers",
    what: "The agent providers discern writes files for.",
    source: {
      kind: "module",
      module: "src/shared/agent_catalogue.ts",
      exportName: "AGENT_NAMES",
    },
    guards: [
      "tests/agent_parity_test.ts",
      "tests/feature_canon_enrolment_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "provider names are product nouns; the glossary carries the agent-file concept instead",
      },
      featureCanon: { surfaceSet: "agent" },
    },
    members: async () => [
      ...(await import("../src/shared/agent_catalogue.ts")).AGENT_NAMES,
    ],
  },
  {
    id: "setup-subverbs",
    title: "Setup sub-verbs",
    what: "The staged-setup handshake's sub-verb sequence.",
    source: {
      kind: "module",
      module: "src/shared/setup_state.ts",
      exportName: "SETUP_SUBVERBS",
    },
    guards: ["tests/engine_setup_phase_parity_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "sub-verbs of one handshake; the CLI reference documents them under setup",
      },
      featureCanon: { nodeId: "setup" },
    },
    members: async () => [
      ...(await import("../src/shared/setup_state.ts")).SETUP_SUBVERBS,
    ],
  },
  {
    id: "hints",
    title: "Hints",
    what:
      "The advisory hint registry: every hint string enters results through it.",
    source: {
      kind: "module",
      module: "src/shared/hints.ts",
      exportName: "HINTS",
    },
    guards: [
      "tests/hint_audience_guard_test.ts",
      "tests/hint_closed_set_guard_test.ts",
      "tests/hint_command_guard_test.ts",
      "tests/hint_inventory_codegen_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_internal/hint-inventory.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: { term: "Advisory" },
      featureCanon: { nodeId: "hints" },
    },
    members: async () =>
      Object.keys((await import("../src/shared/hints.ts")).HINTS),
  },
  {
    id: "logbook-events",
    title: "Logbook events",
    what:
      "The event kinds written to the local logbook and interpreted by its advisory readers.",
    source: {
      kind: "module",
      module: "src/engine/logbook/schema.ts",
      exportName: "logbookEventSchema",
    },
    guards: [
      "tests/engine_logbook_test.ts",
      "tests/engine_patterns_test.ts",
      "tests/logbook_test.ts",
      "tests/logbook_routing_test.ts",
      "tests/logbook_no_network_test.ts",
      "tests/patterns_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: { term: "Logbook" },
      featureCanon: { nodeId: "logbook" },
    },
    members: async () =>
      (await import("../src/engine/logbook/schema.ts"))
        .logbookEventSchema.options.map((option) => option.shape.kind.value),
  },
  {
    id: "glossary-terms",
    title: "Glossary terms",
    what:
      "The term registry behind the glossary page, its search aliases, and the retired-synonym scans.",
    source: {
      kind: "module",
      module: "scripts/glossary_registry.ts",
      exportName: "GLOSSARY",
    },
    guards: [
      "tests/glossary_codegen_test.ts",
      "tests/glossary_enrolment_test.ts",
      "tests/vocab_drift_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/00-orientation/glossary.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "self-referential: the registry is the glossary, and the page it compiles is the definition surface",
      },
      featureCanon: { nodeId: "glossary-canon" },
    },
    members: async () =>
      (await import("./glossary_registry.ts")).GLOSSARY.map(
        (entry) => entry.term,
      ),
  },
  {
    id: "feature-canon",
    title: "Feature canon",
    what:
      "The feature registry behind the canon page: pillars, nodes, and surface claims.",
    source: {
      kind: "module",
      module: "scripts/feature_registry.ts",
      exportName: "FEATURE_CANON",
    },
    guards: [
      "tests/feature_canon_codegen_test.ts",
      "tests/feature_canon_enrolment_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_internal/feature-canon.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: { absent: "a maintainer database, not user vocabulary" },
      featureCanon: {
        absent:
          "the canon is the enrolling registry; a node describing itself would claim nothing",
      },
    },
    members: async () =>
      (await import("./feature_registry.ts")).allFeatureNodes().map(
        (flat) => flat.node.id,
      ),
  },
  {
    id: "result-contracts",
    title: "Result contracts",
    what:
      "The per-verb result contracts behind the published JSON schema and type declarations.",
    source: {
      kind: "module",
      module: "src/shared/result_contracts.ts",
      exportName: "CLI_JSON_RESULT_CONTRACTS",
    },
    guards: ["tests/result_codegen_test.ts"],
    artifacts: [
      {
        path: "schema/discern-results.schema.json",
        kind: "generated-file",
        banner: false,
      },
      {
        path: "types/discern-json.d.ts",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "schema surface documented by the generated references, not vocabulary",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () =>
      (await import("../src/shared/result_contracts.ts"))
        .CLI_JSON_RESULT_CONTRACTS.map((contract) => contract.id),
  },
  {
    id: "public-doc-surfaces",
    title: "Public doc surfaces",
    what:
      "The projection matrix deciding which map pages publish to each public surface.",
    source: {
      kind: "module",
      module: "src/lib/docs.ts",
      exportName: "PUBLIC_DOC_SURFACES",
    },
    guards: ["tests/public_doc_parity_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "an engine projection table; the Map entry carries the reader-facing concept",
      },
      featureCanon: { nodeId: "publish-predicate" },
    },
    members: async () =>
      (await import("../src/lib/docs.ts")).PUBLIC_DOC_SURFACES.map(
        (surface) => surface.name,
      ),
  },
  {
    id: "adrs",
    title: "Architecture Decision Records",
    what:
      "The numbered decision records in the map, including records later superseded.",
    source: {
      kind: "module",
      module: "src/lib/docs.ts",
      exportName: "adrRecords",
    },
    guards: [
      "tests/adr_index_test.ts",
      "tests/adr_citation_form_test.ts",
      "tests/adr_citations_test.ts",
      "tests/improve_count_adrs_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_adr/README.md",
        kind: "maintained-block",
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the decision page explains this project practice; the glossary covers product vocabulary",
      },
      featureCanon: { nodeId: "adr-discipline" },
    },
    members: async () => {
      const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
      const { loadConfig } = await import("../src/shared/config_schema.ts");
      const { resolveMapDir } = await import("../src/lib/paths.ts");
      const { adrRecords, discoverDocs } = await import("../src/lib/docs.ts");
      const mapDir = resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;
      const tree = await discoverDocs({
        cwd: repoRoot,
        dir: join(mapDir, "_adr"),
        includeInternal: true,
      });
      if (tree === undefined) return [];
      return adrRecords(tree.entries).map((record) => record.number);
    },
  },
  {
    id: "project-artifacts",
    title: "Project artifacts",
    what:
      "Every project-tree path discern writes or maintains, with its ownership answer.",
    source: {
      kind: "module",
      module: "src/lib/artifact_ownership.ts",
      exportName: "projectArtifactPaths",
    },
    guards: [
      "tests/artifact_ownership_test.ts",
      "tests/paths_write_surface_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/70-reference/artifact-ownership.md",
        kind: "maintained-block",
      },
      {
        path: "project/map/80-development/install-surface.md",
        kind: "maintained-block",
      },
    ],
    enrolledIn: {
      glossary: { term: "File ownership" },
      featureCanon: { nodeId: "ownership-buckets" },
    },
    members: async () => {
      const { projectArtifactPaths } = await import(
        "../src/lib/artifact_ownership.ts"
      );
      const { parseConfigOrThrow } = await import(
        "../src/shared/config_schema.ts"
      );
      return projectArtifactPaths(parseConfigOrThrow("")).map(
        (entry) => entry.path,
      );
    },
  },
  {
    id: "distribution-vocabulary",
    title: "Distribution vocabulary",
    what:
      "Retired commands, retired config keys, and synonym redirects — the vocabulary the CLI redirects rather than accepts.",
    source: {
      kind: "module",
      module: "src/shared/vocabulary.ts",
      exportName: "RETIRED_COMMAND_REDIRECTS",
    },
    guards: ["tests/dev_vocab_guard_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "redirect data for retired words; live vocabulary lives in the glossary proper",
      },
      featureCanon: { nodeId: "forgiving-cli" },
    },
    members: async () => {
      const vocabulary = await import("../src/shared/vocabulary.ts");
      return [
        ...Object.keys(vocabulary.RETIRED_COMMAND_REDIRECTS),
        ...Object.keys(vocabulary.RETIRED_CONFIG_KEY_REDIRECTS),
        ...Object.keys(vocabulary.COMMAND_SYNONYM_SUGGESTIONS),
        ...Object.keys(vocabulary.VERB_FORM_VARIANTS),
      ];
    },
  },
  {
    id: "voice-banned-moves",
    title: "Voice banned moves",
    what:
      "The voice skill's banned-moves table; the Vale style must match it pattern for pattern.",
    source: {
      kind: "file",
      path: "project/skills/discern-voice-and-tone/SKILL.md",
      mustContain: "## LLM tells: banned moves",
    },
    guards: ["tests/voice_vale_parity_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "editorial tooling for this repository's prose, not product vocabulary",
      },
      featureCanon: {
        absent:
          "an internal editorial practice for this repository, not a product feature",
      },
    },
  },
  {
    id: "third-party-artifacts",
    title: "Third-party artifacts",
    what: "The generated third-party notice artifacts and their license cache.",
    source: {
      kind: "module",
      module: "src/shared/third_party_codegen.ts",
      exportName: "THIRD_PARTY_ARTIFACT_PATHS",
    },
    guards: ["tests/third_party_notices_test.ts"],
    artifacts: [
      {
        path: "THIRD_PARTY_NOTICES",
        kind: "generated-file",
        banner: false,
      },
      {
        path: "src/lib/third_party_bundle.ts",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "scripts/jsr_license_cache.json",
        kind: "generated-file",
        banner: false,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "license plumbing; the CLI reference documents the licenses verb",
      },
      featureCanon: { nodeId: "licenses" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/third_party_codegen.ts"))
          .THIRD_PARTY_ARTIFACT_PATHS,
      ),
  },
  {
    id: "spawn-surfaces",
    title: "Spawn surfaces",
    what:
      "Every file permitted to spawn a subprocess, with the interrupt contract each one owes: E2E-proven surfaces or a written exemption.",
    source: {
      kind: "module",
      module: "tests/spawn_surfaces.ts",
      exportName: "SPAWN_HOMES",
    },
    guards: [
      "tests/engine_subprocess_ssot_test.ts",
      "tests/engine_interrupt_surfaces_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "an internal subprocess-ownership contract, not product vocabulary",
      },
      featureCanon: { nodeId: "interruption-safety" },
    },
    members: async () =>
      (await import("../tests/spawn_surfaces.ts")).SPAWN_HOMES
        .map((entry) => entry.home),
  },
  {
    id: "canonical-sets",
    title: "Canonical sets",
    what: "This meta-registry: the closed set of closed sets.",
    source: {
      kind: "module",
      module: "scripts/canonical_sets.ts",
      exportName: "CANONICAL_SETS",
    },
    guards: ["tests/canonical_sets_enrolment_test.ts"],
    artifacts: [
      {
        path: "project/map/_internal/registry-atlas.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "naming deferred while the pre-launch vocabulary overhaul is in flight",
      },
      featureCanon: { nodeId: "canonical-sets" },
    },
    members: () => Promise.resolve(CANONICAL_SETS.map((entry) => entry.id)),
  },
];

/**
 * Conventionally named guard tests that belong to no canonical set, each with
 * the reason. The reverse sweep holds every conventional test to exactly one
 * of: claimed by an entry's guards, or recorded here.
 */
export const UNAFFILIATED_GUARDS: Readonly<Record<string, string>> = {
  "tests/adr_vocab_guard_test.ts":
    "sweeps shipped strings for internal decision citations; a vocabulary rule, not a member set",
  "tests/engine_tree_drift_test.ts":
    "behavioral guard for the gate's strand detection; a pipeline invariant, not a member set",
  "tests/upgrade_git_guard_test.ts":
    "behavioral guard for upgrade's clean-tree rule; keeps upgrades reversible, not a member set",
};

/**
 * Codegen write targets that belong to no canonical set, each with the
 * reason. The write chokepoint in `scripts/codegen.ts` refuses any target
 * outside the declared artifacts and this record.
 */
export const UNAFFILIATED_CODEGEN_TARGETS: Readonly<Record<string, string>> = {
  "site/pages/assets/search.js":
    "a browser copy of src/lib/docs_search.js — module duplication, not registry data",
};

/** The filename suffixes the guard-test convention sweep matches. */
export const CONVENTIONAL_GUARD_SUFFIXES: readonly string[] = [
  "_parity_test.ts",
  "_enrolment_test.ts",
  "_codegen_test.ts",
  "_drift_test.ts",
  "_guard_test.ts",
];

/** Every path codegen may write: declared artifacts plus recorded strays. */
export function codegenWriteTargets(): ReadonlySet<string> {
  const targets = new Set<string>(Object.keys(UNAFFILIATED_CODEGEN_TARGETS));
  for (const entry of CANONICAL_SETS) {
    for (const artifact of entry.artifacts) {
      targets.add(artifact.path);
    }
  }
  return targets;
}

/** Resolve an entry's live members, or undefined for authored-file sources. */
export async function resolveSetMembers(
  entry: CanonicalSetEntry,
): Promise<readonly string[] | undefined> {
  if (entry.members === undefined) return undefined;
  return await entry.members();
}

/** Where the generated atlas page lives inside the map. */
export const REGISTRY_ATLAS_PAGE_REL: string = join(
  "_internal",
  "registry-atlas.md",
);

function sourceLine(source: SetSource): string {
  if (source.kind === "module") {
    return `- Source: \`${source.module}\` — \`${source.exportName}\``;
  }
  return `- Source: \`${source.path}\` (authored table)`;
}

function glossaryLine(enrolment: GlossaryEnrolment): string {
  if ("term" in enrolment) {
    return `- Glossary: the "${enrolment.term}" entry carries the concept`;
  }
  if ("perMember" in enrolment) {
    return `- Glossary: each member is held named-or-recorded-absent by \`${enrolment.perMember}\``;
  }
  return `- Glossary: not enrolled — ${enrolment.absent}`;
}

function canonLine(enrolment: CanonEnrolment): string {
  if ("surfaceSet" in enrolment) {
    return `- Feature canon: claimed as the \`${enrolment.surfaceSet}\` surface set`;
  }
  if ("nodeId" in enrolment) {
    return `- Feature canon: described by the \`${enrolment.nodeId}\` node`;
  }
  return `- Feature canon: not enrolled — ${enrolment.absent}`;
}

function pathList(paths: readonly string[]): string {
  return paths.map((path) => `\`${path}\``).join(", ");
}

/** Render the atlas page from the live registry. */
export async function renderRegistryAtlasDoc(): Promise<string> {
  const lines: string[] = [
    "<!-- GENERATED by `deno task codegen` from CANONICAL_SETS (scripts/canonical_sets.ts) — do NOT edit by hand. Change the registry and regenerate. -->",
    "",
    "# Registry atlas",
    "",
    "_Every canonical set — source, guards, artifacts, and enrolments — generated from the meta-registry._",
    "",
    "Sections follow registry order. Member counts resolve from each set's single source at generation time. To add a set, declare it in `scripts/canonical_sets.ts`; the enrolment guard (`tests/canonical_sets_enrolment_test.ts`) holds every conventionally named guard test and codegen target to a declared owner.",
    "",
  ];
  for (const entry of CANONICAL_SETS) {
    const members = await resolveSetMembers(entry);
    lines.push(`## \`${entry.id}\` — ${entry.title}`);
    lines.push("");
    lines.push(entry.what);
    lines.push("");
    lines.push(sourceLine(entry.source));
    lines.push(`- Members: ${members === undefined ? "—" : members.length}`);
    lines.push(`- Guards: ${pathList(entry.guards)}`);
    if (entry.artifacts.length > 0) {
      lines.push(
        `- Artifacts: ${
          pathList(entry.artifacts.map((artifact) => artifact.path))
        }`,
      );
    }
    lines.push(glossaryLine(entry.enrolledIn.glossary));
    lines.push(canonLine(entry.enrolledIn.featureCanon));
    lines.push("");
  }
  lines.push("## Unaffiliated, with reasons");
  lines.push("");
  lines.push(
    "Recorded strays the convention sweeps accept: conventionally named guard tests that hold no member set, and codegen targets that compile from no registry.",
  );
  lines.push("");
  for (const [path, reason] of Object.entries(UNAFFILIATED_GUARDS)) {
    lines.push(`- \`${path}\` — ${reason}`);
  }
  for (const [path, reason] of Object.entries(UNAFFILIATED_CODEGEN_TARGETS)) {
    lines.push(`- \`${path}\` — ${reason}`);
  }
  lines.push("");
  return lines.join("\n");
}
