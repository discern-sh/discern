/**
 * The canonical-sets meta-registry — the closed set of closed sets (ADR 0176,
 * the ADR 0051 discipline applied to the discipline itself, following the
 * registry lineage of `glossary_registry.ts` and `feature_registry.ts`).
 *
 * Every canonical set in this repository — a closed member list with a single
 * source, guard tests, and generated artifacts — is declared here: where the
 * set lives, which tests hold it to its satellites, which committed artifacts
 * compile from it, and how it is enrolled in the two enrolling registries (the
 * glossary and the feature canon), or the reason for its recorded absence.
 *
 * The enrollment guard (`tests/canonical_sets_enrolment_test.ts`) checks both
 * directions. Forward: every declared source resolves to a non-empty member
 * set, every guard exists and references its source, every artifact is
 * committed with its banner or block markers. Reverse: convention sweeps over
 * conventionally named guard tests, codegen write targets, and fmt-excluded
 * generated map pages fail the gate on anything no declared set claims. The
 * claim sweep (`tests/ssot_claim_guard_test.ts`) closes the convention's
 * blind spot: a module whose doc comments claim single-source-of-truth
 * status must be a declared entry's source or recorded in
 * `UNAFFILIATED_SETS`. The meta-layer only REFERENCES the existing guards —
 * they stay exactly as written; a generic enrolment engine is the one shape
 * this module must never grow into.
 *
 * The registry enrols itself: `canonical-sets` is an entry, this module is its
 * source, and the atlas page it renders is its artifact.
 */

import { dirname, fromFileUrl, join } from "@std/path";

import { renderMarkdownHtml } from "../src/lib/markdown.ts";
import { markdownCodeSpan } from "../src/shared/markdown_code.ts";
import { VOICE_ENFORCEMENT_COVERAGE_PAGE_REL } from "./brand/vale.ts";

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

/** How a set is enrolled in the glossary, or its recorded absence reason. */
export type GlossaryEnrolment =
  | { readonly term: string }
  | { readonly perMember: string }
  | { readonly absent: string };

/** How a set is enrolled in the feature canon, or its recorded absence reason. */
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
  /** Resolve live member names for the atlas count and list (module sources only). */
  readonly members?: () => Promise<readonly string[]>;
}

/** The closed set of closed sets. */
export const CANONICAL_SETS: readonly CanonicalSetEntry[] = [
  {
    id: "verbs",
    title: "Top-level verbs",
    what:
      "The top-level command vocabulary: every verb the dispatcher accepts through the command-line interface (CLI) and Model Context Protocol (MCP).",
    source: {
      kind: "module",
      module: "src/engine/dispatch.ts",
      exportName: "KNOWN_VERBS",
    },
    guards: [
      "tests/engine_verb_parity_test.ts",
      "tests/cli_reference_codegen_test.ts",
      "tests/guidance_corpus_guard_test.ts",
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
    id: "hidden-verbs",
    title: "Hidden verbs",
    what:
      "Every top-level verb kept out of the operator help listing carries a reason and revival condition. The CLI build applies the registry, and the help-groups guard checks the live hidden set in both bootstrap states.",
    source: {
      kind: "module",
      module: "src/shared/hidden_verbs.ts",
      exportName: "HIDDEN_VERBS",
    },
    guards: [
      "tests/engine_help_groups_test.ts",
      "tests/spoiler_guard_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the hidden-verb registry documents help visibility, its reason, and its revival condition for each existing verb",
      },
      featureCanon: {
        absent:
          "the verbs set already enrolls every member; hiding changes only its help listing",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/hidden_verbs.ts")).HIDDEN_VERBS,
      ),
  },
  {
    id: "dry-run-verbs",
    title: "Dry-run-capable verbs",
    what:
      "Every command path that registers `--dry-run`. These plan/apply verbs must produce a faithful preview: a dry run writes nothing, and apply performs only listed effects.",
    source: {
      kind: "module",
      module: "src/main.ts",
      exportName: "dryRunCapableVerbs",
    },
    guards: ["tests/engine_plan_parity_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the plan/apply documentation owns the preview flag for each existing verb",
      },
      featureCanon: { nodeId: "plan-apply" },
    },
    members: async () => [
      ...(await import("../src/main.ts")).dryRunCapableVerbs(),
    ],
  },
  {
    id: "mcp-tools",
    title: "MCP tools",
    what:
      "The MCP tool table; verb parity ties every tool to a CLI verb, and the live tools/list guard binds each definition to its advertised schema.",
    source: {
      kind: "module",
      module: "src/engine/mcp/server.ts",
      exportName: "TOOLS",
    },
    guards: [
      "tests/engine_verb_parity_test.ts",
      "tests/engine_mcp_test.ts",
      "tests/result_codegen_test.ts",
      "tests/guidance_corpus_guard_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the glossary defines the mirrored verb vocabulary once",
      },
      featureCanon: { nodeId: "mcp-surface" },
    },
    members: async () =>
      (await import("../src/engine/mcp/server.ts")).TOOLS.map(
        (tool) => tool.name,
      ),
  },
  {
    id: "mcp-core-lifecycle",
    title: "MCP core lifecycle",
    what:
      "The lifecycle sequence that leads schema-deferred clients through status, Worktree entry, iteration, the final Gate, synchronization, and authorized landing.",
    source: {
      kind: "module",
      module: "src/engine/mcp/server.ts",
      exportName: "MCP_CORE_LIFECYCLE",
    },
    guards: ["tests/engine_mcp_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the MCP delivery contract sequences existing verb terms",
      },
      featureCanon: { nodeId: "mcp-surface" },
    },
    members: async () => [
      ...(await import("../src/engine/mcp/server.ts")).MCP_CORE_LIFECYCLE,
    ],
  },
  {
    id: "environment-variables",
    title: "discern environment variables",
    what:
      "Every live or retired DISCERN_* environment contract, with its purpose group, lifecycle, and public-documentation policy, including the generated resource-handle family.",
    source: {
      kind: "module",
      module: "src/shared/environment_variables.ts",
      exportName: "DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS",
    },
    guards: [
      "tests/environment_variables_enrolment_test.ts",
      "tests/environment_variables_codegen_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/70-reference/environment-variables.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the environment-variable reference owns these process-channel spellings",
      },
      featureCanon: {
        absent:
          "the registry spans installer, runtime, Worktree, development, and test infrastructure across several documented capabilities",
      },
    },
    members: async () => [
      ...(await import("../src/shared/environment_variables.ts"))
        .DISCERN_ENVIRONMENT_VARIABLE_NAMES,
    ],
  },
  {
    id: "experimental-environment-variables",
    title: "Experimental environment variables",
    what:
      "The environment-only switches for reversible trials, with one exact activation rule and guards that enroll every source use and internal reference.",
    source: {
      kind: "module",
      module: "src/shared/experimental.ts",
      exportName: "EXPERIMENTAL_ENVIRONMENT_VARIABLES",
    },
    guards: [
      "tests/experimental_environment_enrolment_test.ts",
      "tests/providers_test.ts",
      "tests/engine_agent_wiring_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the experimental-controls reference owns these environment-variable spellings",
      },
      featureCanon: {
        absent:
          "the stable feature account covers shipping behavior; this registry records reversible experimental controls",
      },
    },
    members: async () =>
      Object.values(
        (await import("../src/shared/experimental.ts"))
          .EXPERIMENTAL_ENVIRONMENT_VARIABLES,
      ),
  },
  {
    id: "operating-policies",
    title: "Operating policies",
    what:
      "The core policy statements carried by bundled Guidance and MCP server instructions, with probes that recognize each authored restatement.",
    source: {
      kind: "module",
      module: "src/shared/operating_policies.ts",
      exportName: "OPERATING_POLICIES",
    },
    guards: ["tests/agent_policy_parity_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "existing Glossary entries define the reader-facing concepts behind these internal policy identifiers",
      },
      featureCanon: {
        absent:
          "the Guidance, Worktree, Standard, and MCP nodes own the enforced behaviors",
      },
    },
    members: async () =>
      (await import("../src/shared/operating_policies.ts"))
        .OPERATING_POLICIES.map((policy) => policy.id),
  },
  {
    id: "command-groups",
    title: "Command groups",
    what:
      "The named, ordered groups used by `discern --help` and the generated CLI reference. Every visible command belongs to one operator-facing group.",
    source: {
      kind: "module",
      module: "src/cli_help.ts",
      exportName: "COMMAND_GROUPS",
    },
    guards: ["tests/engine_help_groups_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Glossary defines each verb; this registry supplies their help-display groups",
      },
      featureCanon: { nodeId: "cli-help" },
    },
    members: async () =>
      (await import("../src/cli_help.ts")).COMMAND_GROUPS.map(
        (group) => group.name,
      ),
  },
  {
    id: "consent-gated-verbs",
    title: "Consent-gated verbs",
    what:
      "The verbs with a `--confirmed` conversation-attestation boundary and the public surfaces that carry each interaction contract. The class test proves an authority-free call refuses without writing and preserves the exact act, consequence, scope, and continuation; accept can also satisfy landing consent through a machine-checked recorded grant.",
    source: {
      kind: "module",
      module: "src/shared/consent.ts",
      exportName: "CONSENT_GATED_VERBS",
    },
    guards: ["tests/engine_consent_gate_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the two command references document their conversation-attestation boundary",
      },
      featureCanon: { nodeId: "consent-attestations" },
    },
    members: async () =>
      (await import("../src/shared/consent.ts")).CONSENT_GATED_VERBS.map(
        (verb) => verb.id,
      ),
  },
  {
    id: "landing-consent-sources",
    title: "Landing consent sources",
    what:
      "The consent evidence recorded for every successful landing: a conversation attestation, a trunk-recorded standing grant, or a Desk-recorded effort grant.",
    source: {
      kind: "module",
      module: "src/shared/consent.ts",
      exportName: "LANDING_CONSENT_SOURCES",
    },
    guards: [
      "tests/engine_landing_authority_test.ts",
      "tests/engine_accept_authority_test.ts",
      "tests/engine_consent_gate_test.ts",
      "tests/engine_proof_render_test.ts",
      "tests/engine_logbook_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the acceptance page documents these three evidence forms under landing consent",
      },
      featureCanon: { nodeId: "consent-attestations" },
    },
    members: async () => [
      ...(await import("../src/shared/consent.ts")).LANDING_CONSENT_SOURCES,
    ],
  },
  {
    id: "landing-authority-kinds",
    title: "Landing authority kinds",
    what:
      "The read-only outcomes lifecycle envelopes report after the landing-authority resolver checks recorded grants.",
    source: {
      kind: "module",
      module: "src/shared/consent.ts",
      exportName: "LANDING_AUTHORITY_KINDS",
    },
    guards: [
      "tests/engine_landing_authority_test.ts",
      "tests/engine_lifecycle_authority_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the landing-authority reference documents these two machine outcomes",
      },
      featureCanon: { nodeId: "consent-attestations" },
    },
    members: async () => [
      ...(await import("../src/shared/consent.ts")).LANDING_AUTHORITY_KINDS,
    ],
  },
  {
    id: "acceptance-transaction-boundaries",
    title: "Acceptance transaction boundaries",
    what:
      "The durable authority/ref facts acceptance journals before a later process or checkout phase, so interruption recovery cannot replay authority or overwrite local data.",
    source: {
      kind: "module",
      module: "src/engine/worktree/acceptance_transaction.ts",
      exportName: "ACCEPTANCE_TRANSACTION_BOUNDARIES",
    },
    guards: ["tests/engine_accept_authority_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the acceptance workflow documents these internal interruption-recovery boundaries",
      },
      featureCanon: { nodeId: "worktrees" },
    },
    members: async () =>
      (
        await import("../src/engine/worktree/acceptance_transaction.ts")
      ).ACCEPTANCE_TRANSACTION_BOUNDARIES.map((boundary) => boundary.id),
  },
  {
    id: "accept-landing-state-fields",
    title: "Acceptance landing-state fields",
    what:
      "The irreversible acceptance effects carried by partial and successful results, MCP re-aiming, and Logbook events.",
    source: {
      kind: "module",
      module: "src/shared/accept_landing_state.ts",
      exportName: "ACCEPT_LANDING_STATE_FIELDS",
    },
    guards: ["tests/result_schemas_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the result-contract reference documents these acceptance fields",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () => [
      ...(await import("../src/shared/accept_landing_state.ts"))
        .ACCEPT_LANDING_STATE_FIELDS,
    ],
  },
  {
    id: "worktree-lifecycle-repo-root-verbs",
    title: "Repository-root worktree lifecycle verbs",
    what:
      "The Worktree lifecycle verbs that require `discern.toml` at the Git repository root because each creates or lands a full-repository checkout.",
    source: {
      kind: "module",
      module: "src/engine/worktree/lifecycle.ts",
      exportName: "WORKTREE_LIFECYCLE_REPO_ROOT_VERBS",
    },
    guards: ["tests/engine_nested_root_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Worktree lifecycle reference documents this repository-layout precondition for existing verbs",
      },
      featureCanon: { nodeId: "worktrees" },
    },
    members: async () => [
      ...(await import("../src/engine/worktree/lifecycle.ts"))
        .WORKTREE_LIFECYCLE_REPO_ROOT_VERBS,
    ],
  },
  {
    id: "desk-actions",
    title: "Desk actions",
    what:
      "The Desk's per-Worktree action vocabulary and menu order. The legality table exercises every member, and the runtime test checks each interactive effect boundary.",
    source: {
      kind: "module",
      module: "src/engine/desk/model.ts",
      exportName: "DESK_ACTIONS",
    },
    guards: [
      "tests/engine_desk_model_test.ts",
      "tests/engine_desk_runtime_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the Desk reference documents these menu actions in context",
      },
      featureCanon: { nodeId: "desk" },
    },
    members: async () => [
      ...(await import("../src/engine/desk/model.ts")).DESK_ACTIONS,
    ],
  },
  {
    id: "git-admin-state",
    title: "Git-admin state",
    what:
      "Every discern-owned Git-admin artifact carries its path, lifetime, shape, and validation-write policy. Registry-driven guards enroll each new member in placement and lifecycle checks.",
    source: {
      kind: "module",
      module: "src/shared/git_admin_state.ts",
      exportName: "GIT_ADMIN_STATE",
    },
    guards: [
      "tests/git_admin_state_test.ts",
      "tests/engine_patterns_test.ts",
      "tests/engine_logbook_lifecycle_test.ts",
      "tests/engine_write_preflight_test.ts",
      "tests/engine_effort_grant_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Git-admin state reference owns this internal vocabulary for Proof, measurements, Logbook data, and Worktree lifecycle state",
      },
      featureCanon: {
        absent:
          "the registry supports several product features, each documented by its own node",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/git_admin_state.ts")).GIT_ADMIN_STATE,
      ),
  },
  {
    id: "jobs",
    title: "Gate jobs",
    what: "The known Gate jobs: the command table's fixed vocabulary.",
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
    what: "The Gate's stage vocabulary and order.",
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
    id: "diagnostic-formats",
    title: "Diagnostic formats",
    what:
      "The machine formats that failed-job normalization detects, in detection order: Static Analysis Results Interchange Format (SARIF) and JUnit XML. Setup and improvement prose derive from this registry, and an enrollment guard checks the public docs.",
    source: {
      kind: "module",
      module: "src/engine/gate/diagnostics.ts",
      exportName: "DIAGNOSTIC_FORMATS",
    },
    guards: [
      "tests/gate_diagnostics_test.ts",
      "tests/diagnostic_formats_enrolment_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "job-output configuration explains the external SARIF and JUnit XML standards",
      },
      featureCanon: { nodeId: "diagnostics" },
    },
    members: async () =>
      (await import("../src/engine/gate/diagnostics.ts")).DIAGNOSTIC_FORMATS
        .map(
          (format) => format.id,
        ),
  },
  {
    id: "step-kinds",
    title: "Step kinds",
    what:
      "The result-step operation vocabulary: what a step does. The doctor's `STEP_KIND_ANNOTATIONS` table in `src/engine/doctor/execution_model.ts` is pinned to it with one actor and hint per kind.",
    source: {
      kind: "module",
      module: "src/shared/result.ts",
      exportName: "STEP_KINDS",
    },
    guards: ["tests/execution_model_test.ts", "tests/result_schemas_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "Doctor explains each result-step kind in context",
      },
      featureCanon: { nodeId: "doctor" },
    },
    members: async () => [
      ...(await import("../src/shared/result.ts")).STEP_KINDS,
    ],
  },
  {
    id: "built-in-step-labels",
    title: "Built-in step labels",
    what:
      "The stable kebab-case operation labels discern authors in plans and applied results. Configured identifiers use the separate verbatim-label boundary.",
    source: {
      kind: "module",
      module: "src/shared/result.ts",
      exportName: "BUILT_IN_STEP_LABELS",
    },
    guards: ["tests/built_in_step_labels_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the result-contract reference explains label ownership and configured identifiers preserve their project spelling",
      },
      featureCanon: { nodeId: "plan-apply" },
    },
    members: async () =>
      Object.values(
        (await import("../src/shared/result.ts")).BUILT_IN_STEP_LABELS,
      ),
  },
  {
    id: "config-tables",
    title: "Config tables",
    what: "Every top-level table in the config schema.",
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
      "tests/generated_artifacts_test.ts",
      "tests/agent_gitattributes_test.ts",
    ],
    artifacts: [
      {
        path: "schema/discern-config.schema.json",
        kind: "generated-file",
        banner: false,
      },
      {
        path: "schema/discern-setup-config.schema.json",
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
        absent: "the config reference documents every table and key",
      },
      featureCanon: { surfaceSet: "config" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/config_schema.ts")).configSchema.shape,
      ),
  },
  {
    id: "source-paths",
    title: "Source paths",
    what:
      "The configurable authored-source locations: Guidance, Map, Skills, Project Scripts, TODO, and brief. Each entry carries its config key, default, ownership, and resolution rule.",
    source: {
      kind: "module",
      module: "src/shared/paths_registry.ts",
      exportName: "SOURCE_PATHS",
    },
    guards: [
      "tests/paths_registry_test.ts",
      "tests/paths_literal_ban_test.ts",
      "tests/engine_nondefault_paths_test.ts",
      "tests/paths_sentinel_render_test.ts",
      "tests/paths_write_surface_test.ts",
      "tests/agent_gitattributes_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the config reference documents every source-path key",
      },
      featureCanon: { nodeId: "one-file-footprint" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/paths_registry.ts")).SOURCE_PATHS,
      ),
  },
  {
    id: "bundled-skills",
    title: "Bundled skills",
    what: "The Skills the binary ships and materializes into a project.",
    source: {
      kind: "module",
      module: "src/lib/skills.ts",
      exportName: "bundledSkillNames",
    },
    guards: [
      "tests/skill_name_parity_test.ts",
      "tests/feature_canon_enrolment_test.ts",
      "tests/guidance_corpus_guard_test.ts",
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
    id: "operational-agent-surfaces",
    title: "Operational agent surfaces",
    what:
      "The effective Skills and setup briefs joined to repository-only classifications, exact agent-facing prose evidence, materialized-output protection, and generated agent-copy lexical rules.",
    source: {
      kind: "module",
      module: "scripts/agent_surface_contracts.ts",
      exportName: "operationalAgentSurfaces",
    },
    guards: ["tests/agent_surface_contracts_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Skill and setup references define these existing agent-copy surfaces",
      },
      featureCanon: {
        absent:
          "the Skill and setup nodes describe the product behavior this maintainer-only corpus guard holds",
      },
    },
    members: async () => {
      const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
      const { loadConfig } = await import(
        "../src/shared/config_schema.ts"
      );
      const { operationalAgentSurfaces } = await import(
        "./agent_surface_contracts.ts"
      );
      return (await operationalAgentSurfaces(
        repoRoot,
        await loadConfig(repoRoot),
      )).map((surface) => surface.id);
    },
  },
  {
    id: "agent-providers",
    title: "Agent providers",
    what:
      "The agent providers discern writes files for, each with a compact mark and horizontal logo lockup.",
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
          "the agent-integration reference names providers, while the Glossary defines the shared Agent file concept",
      },
      featureCanon: { surfaceSet: "agent" },
    },
    members: async () => [
      ...(await import("../src/shared/agent_catalogue.ts")).AGENT_NAMES,
    ],
  },
  {
    id: "cross-agent-behaviours",
    title: "Cross-agent behavior dimensions",
    what:
      "The classified behavior dimensions of the researched coding agents. The operational-internal cross-agent reference compiles from typed cells that require every dimension to cover every researched agent.",
    source: {
      kind: "module",
      module: "scripts/cross_agent_registry.ts",
      exportName: "BEHAVIOUR_DIMENSIONS",
    },
    guards: ["tests/cross_agent_reference_codegen_test.ts"],
    artifacts: [
      {
        path: "project/map/_internal/cross-agent-behaviour-reference.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the cross-agent reference owns this maintainer research vocabulary about coding-agent behavior",
      },
      featureCanon: {
        absent:
          "the provider integration nodes carry the product behavior informed by this operational research",
      },
    },
    members: async () =>
      (await import("./cross_agent_registry.ts")).BEHAVIOUR_DIMENSIONS.map(
        (dimension) => dimension.id,
      ),
  },
  {
    id: "agent-integration-seams",
    title: "Agent integration seams",
    what:
      "The integration seams discern wires for each coding agent. The operational-internal coverage page compiles every cell from the live provider registry, and the typed commentary layer requires verdict prose for every new provider.",
    source: {
      kind: "module",
      module: "scripts/agent_integration_registry.ts",
      exportName: "INTEGRATION_SEAMS",
    },
    guards: ["tests/agent_integration_coverage_codegen_test.ts"],
    artifacts: [
      {
        path: "project/map/_internal/agent-integration-coverage.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the integration-coverage reference owns this maintainer vocabulary; the Glossary defines Agent file and Skill",
      },
      featureCanon: {
        absent:
          "the provider integration nodes carry the product behavior summarized by this operational reference",
      },
    },
    members: async () =>
      (await import("./agent_integration_registry.ts")).INTEGRATION_SEAMS.map(
        (seam) => seam.id,
      ),
  },
  {
    id: "brand-documents",
    title: "Brand documents",
    what:
      "The Brand Operating System's document map: every brand document as one typed row, where generated pages compile from the registry through the codegen chokepoint and authored overlay documents stay declared path-and-job rows without content.",
    source: {
      kind: "module",
      module: "scripts/brand_registry.ts",
      exportName: "BRAND_DOCUMENTS",
    },
    guards: ["tests/brand_registry_codegen_test.ts"],
    artifacts: [
      {
        path: "project/map/_internal/brand/README.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/claims-and-evidence.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/copy-patterns.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/copy-review.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/messaging.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/positioning.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/register-bridge.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/visual-identity.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/skills/discern-brand-voice/SKILL.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/skills/discern-product-voice/SKILL.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/skills/discern-agent-voice/SKILL.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent: "the internal brand canon defines this strategy vocabulary",
      },
      featureCanon: {
        absent:
          "public copy applies this internal strategy to the product nodes it describes",
      },
    },
    members: async () =>
      (await import("./brand_registry.ts")).BRAND_DOCUMENTS.map(
        (doc) => doc.id,
      ),
  },
  {
    id: "brand-claims",
    title: "Brand claims ledger",
    what:
      "The public claims ledger behind brand copy: per-claim evidence classes, strongest supported wording, conditions, and forbidden inferences, rendered into the claims page the brand-documents set owns.",
    source: {
      kind: "module",
      module: "scripts/brand/claims.ts",
      exportName: "CLAIMS",
    },
    guards: ["tests/brand_registry_codegen_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the internal claims canon defines this public-wording vocabulary",
      },
      featureCanon: {
        absent:
          "public copy applies this evidence ledger to the product nodes it describes",
      },
    },
    members: async () =>
      Object.keys((await import("./brand/claims.ts")).CLAIMS),
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
        absent: "the CLI reference documents these sub-verbs under setup",
      },
      featureCanon: { nodeId: "setup" },
    },
    members: async () => [
      ...(await import("../src/shared/setup_state.ts")).SETUP_SUBVERBS,
    ],
  },
  {
    id: "authored-commit-sites",
    title: "discern-authored commit sites",
    what:
      "The workflows whose diffs discern composes and commits. Every member must route through the attributed, pathspec-limited commit boundary.",
    source: {
      kind: "module",
      module: "src/shared/discern_commit.ts",
      exportName: "DISCERN_AUTHORED_COMMIT_SITES",
    },
    guards: [
      "tests/discern_commit_enrolment_test.ts",
      "tests/writer_boundary_enrolment_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the commit-boundary reference owns this internal provenance vocabulary for existing commands",
      },
      featureCanon: {
        absent:
          "the setup and Standards nodes own the workflows that carry this commit metadata",
      },
    },
    members: async () =>
      Object.values(
        (await import("../src/shared/discern_commit.ts"))
          .DISCERN_AUTHORED_COMMIT_SITES,
      ).map((site) => site.id),
  },
  {
    id: "restricted-writer-modules",
    title: "Restricted writer modules",
    what:
      "The shipped capability modules whose importers are restricted: attributed commits, human effort grants, effort-grant cleanup, and acceptance transactions.",
    source: {
      kind: "module",
      module: "tests/writer_boundaries.ts",
      exportName: "RESTRICTED_WRITER_MODULES",
    },
    guards: ["tests/writer_boundary_enrolment_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the writer-boundary reference owns this internal authority vocabulary for existing workflows",
      },
      featureCanon: {
        absent:
          "the existing workflow nodes own the behavior this boundary enforces",
      },
    },
    members: async () =>
      (await import("../tests/writer_boundaries.ts"))
        .RESTRICTED_WRITER_MODULES.map((boundary) => boundary.id),
  },
  {
    id: "setup-completion-checks",
    title: "Setup completion checks",
    what:
      "The machine-checkable predicates behind setup's observable progress. Each mirrors its setup page's completion-check field, so a resumed session derives completed work from the tree.",
    source: {
      kind: "module",
      module: "src/shared/setup_checks.ts",
      exportName: "SETUP_COMPLETION_CHECKS",
    },
    guards: ["tests/engine_setup_pages_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the setup pages describe each progress predicate in reader-facing prose",
      },
      featureCanon: { nodeId: "setup-observability" },
    },
    members: async () =>
      (await import("../src/shared/setup_checks.ts")).SETUP_COMPLETION_CHECKS
        .map((check) => check.name),
  },
  {
    id: "worktree-tokens",
    title: "Worktree adapter tokens",
    what:
      "The `@…@` runtime tokens substituted into a Worktree's resource commands from its identity: database (`db`), site, port, project slug, directory, Worktree, and resource.",
    source: {
      kind: "module",
      module: "src/engine/worktree/tokens.ts",
      exportName: "WORKTREE_TOKENS",
    },
    guards: ["tests/worktree_tokens_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Map's Worktree-resource pages document each command-substitution token",
      },
      featureCanon: { nodeId: "worktree-resources" },
    },
    members: async () => [
      ...(await import("../src/engine/worktree/tokens.ts")).WORKTREE_TOKENS,
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
      "tests/gate_plan_test.ts",
      "tests/result_schemas_test.ts",
      "tests/engine_json_purity_test.ts",
      "tests/engine_logbook_test.ts",
      "tests/patterns_test.ts",
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
    id: "tips",
    title: "Tips",
    what:
      "The Desk tip registry: every teaching line the Desk can show enters through it, in curriculum order.",
    source: {
      kind: "module",
      module: "src/shared/tips.ts",
      exportName: "TIPS",
    },
    guards: [
      "tests/tip_closed_set_guard_test.ts",
      "tests/tip_canon_enrolment_test.ts",
      "tests/tip_command_guard_test.ts",
      "tests/tip_register_guard_test.ts",
      "tests/tip_inventory_codegen_test.ts",
      "tests/engine_desk_tips_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_internal/tip-inventory.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: { term: "Tip" },
      featureCanon: { nodeId: "tips" },
    },
    members: async () =>
      (await import("../src/shared/tips.ts")).TIPS.map((tip) => tip.id),
  },
  {
    id: "terminal-art-variants",
    title: "Terminal-art variants",
    what:
      "The named terminal-art family: every static renderer carries one semantic animation timeline and enters both maintainer gallery projections.",
    source: {
      kind: "module",
      module: "art/terminal/brand.ts",
      exportName: "DISCERN_ART_VARIANTS",
    },
    guards: [
      "tests/brand_art_test.ts",
      "tests/brand_animation_test.ts",
      "tests/art_gallery_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the terminal-art gallery owns these internal design names",
      },
      featureCanon: {
        absent:
          "the existing terminal surfaces consume these decorative projections and maintainer previews",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../art/terminal/brand.ts")).DISCERN_ART_VARIANTS,
      ),
  },
  {
    id: "terminal-triangle-motifs",
    title: "Terminal triangle motifs",
    what:
      "The reusable triangle treatments: every pure static frame carries one semantic animation timeline and enters both maintainer gallery projections.",
    source: {
      kind: "module",
      module: "art/terminal/triangle.ts",
      exportName: "DISCERN_TRIANGLE_MOTIFS",
    },
    guards: [
      "tests/triangle_art_test.ts",
      "tests/art_gallery_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the terminal-art gallery owns these internal motif names",
      },
      featureCanon: {
        absent:
          "the existing terminal surfaces consume these motifs and maintainer previews",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../art/terminal/triangle.ts"))
          .DISCERN_TRIANGLE_MOTIFS,
      ),
  },
  {
    id: "browser-artworks",
    title: "Browser artworks",
    what:
      "The approved browser-art family: every member supplies its metadata, renderer, immutable source provenance, stylesheet, dual-theme gallery projection, and structural guards.",
    source: {
      kind: "module",
      module: "art/browser/registry.ts",
      exportName: "BROWSER_ARTWORKS",
    },
    guards: [
      "tests/art_browser_gallery_test.ts",
      "tests/browser_art_alignment_test.ts",
      "tests/browser_art_bifurcation_test.ts",
      "tests/browser_art_contour_test.ts",
      "tests/browser_art_persistent_trace_test.ts",
      "tests/browser_art_invariant_core_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the browser-art gallery owns these internal study names",
      },
      featureCanon: {
        absent:
          "the development-only gallery owns these visual references outside the public product surface",
      },
    },
    members: async () =>
      (await import("../art/browser/registry.ts")).BROWSER_ARTWORKS.map(
        ({ slug }) => slug,
      ),
  },
  {
    id: "failure-recovery-evidence",
    title: "Generic failure-recovery evidence",
    what:
      "The result fields a generic recovery instruction may cite. A failure with neither field needs a tailored next step.",
    source: {
      kind: "module",
      module: "src/shared/hints.ts",
      exportName: "FAILURE_RECOVERY_EVIDENCE",
    },
    guards: ["tests/result_schemas_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the advisory contract documents these result-envelope evidence fields",
      },
      featureCanon: { nodeId: "hints" },
    },
    members: async () => [
      ...(await import("../src/shared/hints.ts")).FAILURE_RECOVERY_EVIDENCE,
    ],
  },
  {
    id: "error-failure-recovery",
    title: "Error-family failure recovery",
    what:
      "The audited recovery mode for every canonical error slug: use the generic floor only when the message or first diagnostic supplies the correction; otherwise require a tailored registered next step.",
    source: {
      kind: "module",
      module: "src/shared/hints.ts",
      exportName: "ERROR_FAILURE_RECOVERY",
    },
    guards: ["tests/result_schemas_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the result-contract reference explains the two recovery modes without exposing this internal policy table",
      },
      featureCanon: { nodeId: "hints" },
    },
    members: async () =>
      Object.entries(
        (await import("../src/shared/hints.ts")).ERROR_FAILURE_RECOVERY,
      ).map(([error, mode]) => `${error}: ${mode}`),
  },
  {
    id: "logbook-outcomes",
    title: "Logbook outcomes",
    what:
      "How one verb invocation ended: cleanly, red after running, partial after an irreversible effect, or read-only refusal.",
    source: {
      kind: "module",
      module: "src/engine/logbook/schema.ts",
      exportName: "LOGBOOK_OUTCOMES",
    },
    guards: [
      "tests/logbook_test.ts",
      "tests/engine_logbook_test.ts",
      "tests/patterns_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the Logbook reference documents these recorded outcomes",
      },
      featureCanon: { nodeId: "logbook" },
    },
    members: async () => [
      ...(await import("../src/engine/logbook/schema.ts")).LOGBOOK_OUTCOMES,
    ],
  },
  {
    id: "logbook-events",
    title: "Logbook events",
    what:
      "The event kinds written to the local Logbook and interpreted by its advisory readers.",
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
    id: "logbook-powered",
    title: "Logbook-powered capabilities",
    what:
      "The advisory capabilities that switch off with `[project].logbook = false`. Every opt-out wording surface quotes each member's phrase verbatim.",
    source: {
      kind: "module",
      module: "src/shared/logbook_powered.ts",
      exportName: "LOGBOOK_POWERED",
    },
    guards: ["tests/logbook_powered_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Logbook reference documents these capability names and their opt-out behavior",
      },
      featureCanon: { nodeId: "logbook" },
    },
    members: async () =>
      (await import("../src/shared/logbook_powered.ts")).LOGBOOK_POWERED
        .map((member) => member.key),
  },
  {
    id: "logbook-lifecycle-actions",
    title: "Logbook lifecycle actions",
    what:
      "Every CLI-only action allowed to detach or remove active Logbook history. Dispatch, recording exclusion, terminal-confirmation policy, and safety tests derive from this set.",
    source: {
      kind: "module",
      module: "src/shared/logbook_lifecycle.ts",
      exportName: "LOGBOOK_LIFECYCLE_ACTIONS",
    },
    guards: [
      "tests/engine_logbook_lifecycle_test.ts",
      "tests/engine_non_interactive_test.ts",
      "tests/logbook_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Patterns and Logbook references document these owner actions in lifecycle context",
      },
      featureCanon: { nodeId: "patterns" },
    },
    members: async () => [
      ...(await import("../src/shared/logbook_lifecycle.ts"))
        .LOGBOOK_LIFECYCLE_ACTION_NAMES,
    ],
  },
  {
    id: "detector-families",
    title: "Patterns detector families",
    what:
      "The categories that group every Patterns detector and finding. Schemas, registry entries, and the human report derive from this vocabulary.",
    source: {
      kind: "module",
      module: "src/shared/patterns_vocabulary.ts",
      exportName: "DETECTOR_FAMILIES",
    },
    guards: [
      "tests/patterns_test.ts",
      "tests/engine_patterns_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Patterns entry defines the reader-facing concept, and this registry supplies its internal report groups",
      },
      featureCanon: { nodeId: "patterns" },
    },
    members: async () => [
      ...(await import("../src/shared/patterns_vocabulary.ts"))
        .DETECTOR_FAMILIES,
    ],
  },
  {
    id: "pattern-finding-tones",
    title: "Patterns finding tones",
    what:
      "The presentation-only vocabulary a Patterns finding uses to distinguish favorable, neutral, and attention-worthy evidence.",
    source: {
      kind: "module",
      module: "src/shared/patterns_vocabulary.ts",
      exportName: "PATTERN_FINDING_TONES",
    },
    guards: [
      "tests/patterns_test.ts",
      "tests/engine_patterns_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Patterns result reference documents this presentation metadata",
      },
      featureCanon: { nodeId: "patterns" },
    },
    members: async () => [
      ...(await import("../src/shared/patterns_vocabulary.ts"))
        .PATTERN_FINDING_TONES,
    ],
  },
  {
    id: "patterns-detectors",
    title: "Patterns detectors",
    what:
      "Every detector the Patterns verb runs over the Logbook, in stable registry order. Companion families, scopes, tiers, and statuses from `src/shared/patterns_vocabulary.ts` type each entry. The parameterized class test requires fixtures for every new detector.",
    source: {
      kind: "module",
      module: "src/engine/logbook/detectors.ts",
      exportName: "DETECTORS",
    },
    guards: [
      "tests/patterns_test.ts",
      "tests/logbook_routing_test.ts",
      "tests/engine_patterns_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: { term: "Patterns" },
      featureCanon: { nodeId: "patterns" },
    },
    members: async () =>
      (await import("../src/engine/logbook/detectors.ts")).DETECTORS.map(
        (detector) => detector.id,
      ),
  },
  {
    id: "improve-categories",
    title: "Improvement categories",
    what:
      "The improvement catalog's categories, in display order. The runner ranks them weakest-first, while CLI help and the MCP tool derive category slugs from the catalog.",
    source: {
      kind: "module",
      module: "src/engine/improve/rules.ts",
      exportName: "CATEGORIES",
    },
    guards: ["tests/improve_catalog_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the improvement reference documents these category slugs, and every surfaced list derives from this catalog",
      },
      featureCanon: { nodeId: "improvement" },
    },
    members: async () =>
      (await import("../src/engine/improve/rules.ts")).CATEGORIES.map(
        (category) => category.name,
      ),
  },
  {
    id: "glossary-terms",
    title: "Glossary terms",
    what:
      "The term registry behind the glossary page, its search aliases, and the retired-synonym scans. Each entry also carries the term's plain-register rendering, so the vocabulary and its plain translation are one record.",
    source: {
      kind: "module",
      module: "scripts/glossary_registry.ts",
      exportName: "GLOSSARY",
    },
    guards: [
      "tests/glossary_codegen_test.ts",
      "tests/glossary_enrolment_test.ts",
      "tests/vocab_drift_test.ts",
      "tests/feature_canon_plain_register_test.ts",
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
          "the registry is the Glossary, and its generated page is the definition surface",
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
      "The feature registry behind the canon pages: pillars, nodes, and surface claims, each node carrying a technical and a plain-language account.",
    source: {
      kind: "module",
      module: "scripts/feature_registry.ts",
      exportName: "FEATURE_CANON",
    },
    guards: [
      "tests/feature_canon_codegen_test.ts",
      "tests/feature_canon_enrolment_test.ts",
      "tests/feature_canon_plain_register_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_internal/feature-canon.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/feature-canon-plain.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent: "this maintainer registry supplies the Feature canon's data",
      },
      featureCanon: {
        absent:
          "this is the enrolling registry; its nodes describe the product capabilities",
      },
    },
    members: async () =>
      (await import("./feature_registry.ts")).allFeatureNodes().map(
        (flat) => flat.node.id,
      ),
  },
  {
    id: "benefit-canon",
    title: "Benefit canon",
    what:
      "The commercially ordered transposition of the feature registry: human value and the reason it follows, with explicit feature and public-claim traceability.",
    source: {
      kind: "module",
      module: "scripts/feature_registry.ts",
      exportName: "BENEFIT_CANON",
    },
    guards: [
      "tests/feature_canon_benefit_test.ts",
      "tests/feature_canon_codegen_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_internal/feature-canon-benefits.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent: "this maintainer registry supplies the benefit canon's data",
      },
      featureCanon: {
        absent:
          "the benefit canon is the feature canon's own transposition; its entries cite feature nodes rather than claim surfaces",
      },
    },
    members: async () =>
      (await import("./feature_registry.ts")).allBenefitEntries().map(
        (flat) => flat.entry.id,
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
    guards: [
      "tests/result_codegen_test.ts",
      "tests/engine_json_purity_test.ts",
    ],
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
        absent: "the generated result references document this schema surface",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () =>
      (await import("../src/shared/result_contracts.ts"))
        .CLI_JSON_RESULT_CONTRACTS.map((contract) => contract.id),
  },
  {
    id: "result-contract-reference-fields",
    title: "Result contract reference fields",
    what:
      "The semantic CLI and MCP schema-reference fields published for each result contract.",
    source: {
      kind: "module",
      module: "src/shared/result_contracts.ts",
      exportName: "RESULT_CONTRACT_REFERENCE_FIELDS",
    },
    guards: [
      "tests/public_schema_compatibility_guard_test.ts",
      "tests/result_codegen_test.ts",
    ],
    artifacts: [
      {
        path: "schema/discern-results.schema.json",
        kind: "generated-file",
        banner: false,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the result-contract reference documents these machine schema fields",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () =>
      Object.values(
        (await import("../src/shared/result_contracts.ts"))
          .RESULT_CONTRACT_REFERENCE_FIELDS,
      ),
  },
  {
    id: "cli-json-predicates",
    title: "CLI JSON predicate contracts",
    what:
      "The predicates selected by an option or positional argument whose bare exit status becomes a successful Boolean observation under `--json`.",
    source: {
      kind: "module",
      module: "src/shared/result_contracts.ts",
      exportName: "CLI_JSON_PREDICATE_CONTRACTS",
    },
    guards: [
      "tests/result_codegen_test.ts",
      "tests/engine_json_purity_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the documented commands own these invocation modes",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () =>
      (await import("../src/shared/result_contracts.ts"))
        .CLI_JSON_PREDICATE_CONTRACTS.map((contract) => contract.id),
  },
  {
    id: "cli-predicate-invocation-modes",
    title: "CLI predicate invocation modes",
    what:
      "The bare and global/local JSON placements every registered CLI predicate must prove, including their exit semantics.",
    source: {
      kind: "module",
      module: "src/shared/result_contracts.ts",
      exportName: "CLI_PREDICATE_INVOCATION_MODES",
    },
    guards: ["tests/engine_json_purity_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the documented commands own these machine-output placements",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () =>
      (await import("../src/shared/result_contracts.ts"))
        .CLI_PREDICATE_INVOCATION_MODES.map((mode) => mode.id),
  },
  {
    id: "cli-predicate-states",
    title: "CLI predicate states",
    what:
      "The true and false states every registered CLI predicate must preserve in bare and JSON modes.",
    source: {
      kind: "module",
      module: "src/shared/result_contracts.ts",
      exportName: "CLI_PREDICATE_STATES",
    },
    guards: ["tests/engine_json_purity_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the predicate contract documents these Boolean test states",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () => [
      ...(await import("../src/shared/result_contracts.ts"))
        .CLI_PREDICATE_STATES,
    ],
  },
  {
    id: "public-schema-publications",
    title: "Public schema publications",
    what:
      "The versioned public schema URLs and the root generated artifacts served at them.",
    source: {
      kind: "module",
      module: "src/shared/public_schemas.ts",
      exportName: "PUBLIC_SCHEMA_PUBLICATIONS",
    },
    guards: [
      "tests/config_codegen_test.ts",
      "tests/public_schema_compatibility_guard_test.ts",
      "tests/result_codegen_test.ts",
      "tests/reference_docs_test.ts",
      "tests/site_serve_test.ts",
      "tests/site_smoke_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/70-reference/mcp-and-results.md",
        kind: "maintained-block",
      },
      {
        path: "schema/discern-proof-note.schema.json",
        kind: "generated-file",
        banner: false,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the config and result references document these machine-contract locations",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () =>
      (await import("../src/shared/public_schemas.ts"))
        .PUBLIC_SCHEMA_PUBLICATIONS.map((publication) => publication.id),
  },
  {
    id: "security-disclosure",
    title: "Security disclosure",
    what:
      "The public reporting channels, policy location, language, and bounded security.txt expiry policy.",
    source: {
      kind: "module",
      module: "site/security.ts",
      exportName: "SECURITY_DISCLOSURE",
    },
    guards: ["tests/security_disclosure_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the security policy owns these public project-administration coordinates",
      },
      featureCanon: {
        absent:
          "the repository and website security policy own this disclosure surface",
      },
    },
    members: async () => {
      const disclosure = (await import("../site/security.ts"))
        .SECURITY_DISCLOSURE;
      return Object.entries(disclosure).map(([name, value]) =>
        `${name}=${Array.isArray(value) ? value.join(",") : String(value)}`
      );
    },
  },
  {
    id: "error-slugs",
    title: "Result error slugs",
    what:
      "The machine-stable failure vocabulary accepted by live result envelopes and advertised to public-schema consumers.",
    source: {
      kind: "module",
      module: "src/shared/result.ts",
      exportName: "ERROR_SLUGS",
    },
    guards: [
      "tests/result_schemas_test.ts",
      "tests/result_codegen_test.ts",
      "tests/logbook_test.ts",
    ],
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
          "the result-contract reference documents this machine failure vocabulary; command diagnostics supply reader-facing explanations",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members:
      async () => [...(await import("../src/shared/result.ts")).ERROR_SLUGS],
  },
  {
    id: "step-outcomes",
    title: "Step outcomes",
    what:
      "The executed-step outcomes shared by runtime validation, result rendering, and public contract artifacts.",
    source: {
      kind: "module",
      module: "src/shared/result.ts",
      exportName: "STEP_OUTCOMES",
    },
    guards: [
      "tests/result_schemas_test.ts",
      "tests/result_codegen_test.ts",
      "tests/gate_plan_test.ts",
    ],
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
          "each executed step shows the plain-language meaning of these wire states",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members:
      async () => [...(await import("../src/shared/result.ts")).STEP_OUTCOMES],
  },
  {
    id: "public-doc-surfaces",
    title: "Public doc surfaces",
    what:
      "The projection matrix deciding which Map pages publish to each public surface.",
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
          "the Map entry defines the reader-facing concept, and this Engine table supplies its publication projections",
      },
      featureCanon: { nodeId: "publish-predicate" },
    },
    members: async () =>
      (await import("../src/lib/docs.ts")).PUBLIC_DOC_SURFACES.map(
        (surface) => surface.name,
      ),
  },
  {
    id: "docs-workflow-directives",
    title: "Docs workflow directives",
    what:
      "The source Markdown markers the browser manual projects through the design system's Workflow grammar.",
    source: {
      kind: "module",
      module: "site/workflow_registry.ts",
      exportName: "WORKFLOW_DIRECTIVES",
    },
    guards: ["tests/site_workflow_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the browser-manual design system documents these internal Markdown projection labels",
      },
      featureCanon: { nodeId: "bundled-docs" },
    },
    members: async () =>
      (await import("../site/workflow_registry.ts")).WORKFLOW_DIRECTIVES.map(
        (directive) => directive.id,
      ),
  },
  {
    id: "adrs",
    title: "Architecture Decision Records",
    what:
      "The numbered decision records in the Map, including records later superseded.",
    source: {
      kind: "module",
      module: "src/lib/docs.ts",
      exportName: "adrRecords",
    },
    guards: [
      "tests/adr_index_test.ts",
      "tests/engine_adr_index_test.ts",
      "tests/adr_citation_form_test.ts",
      "tests/adr_citations_test.ts",
      "tests/improve_count_adrs_test.ts",
    ],
    // The maintained ADR index (project/map/_adr/README.md) is not a codegen
    // artifact: `discern refresh` maintains it in ANY project, and the
    // gate's adr_index currency precondition holds it to the records on disk.
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the decision-record page explains this project practice",
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
      "Every project-tree path discern writes or maintains, with its operational ownership and payload-license classification.",
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
      "Retired commands, retired config keys, dead config positions, and synonym redirects that make the CLI return a redirect or refusal.",
    source: {
      kind: "module",
      module: "src/shared/vocabulary.ts",
      exportName: "RETIRED_COMMAND_REDIRECTS",
    },
    guards: ["tests/dev_vocab_guard_test.ts", "tests/config_schema_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Glossary defines live vocabulary, and this registry records redirects and refusals for retired words",
      },
      featureCanon: { nodeId: "forgiving-cli" },
    },
    members: async () => {
      const vocabulary = await import("../src/shared/vocabulary.ts");
      return [
        ...Object.keys(vocabulary.RETIRED_COMMAND_REDIRECTS),
        ...Object.keys(vocabulary.RETIRED_CONFIG_KEY_REDIRECTS),
        ...vocabulary.DEAD_CONFIG_POSITIONS.map((position) =>
          position.key === undefined
            ? `${position.path}.*`
            : [position.path, position.key].filter((p) => p !== "").join(".")
        ),
        ...Object.keys(vocabulary.COMMAND_SYNONYM_SUGGESTIONS),
        ...Object.keys(vocabulary.VERB_FORM_VARIANTS),
      ];
    },
  },
  {
    id: "voice-banned-moves",
    title: "Voice banned moves",
    what:
      "The voice registry's banned-word and banned-move canon behind the generated voice Skills. The Vale style must see every banned phrase the canon declares.",
    source: {
      kind: "module",
      module: "scripts/brand/voice.ts",
      exportName: "BANNED_WORDS",
    },
    guards: ["tests/voice_vale_parity_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the internal voice canon owns this editorial vocabulary",
      },
      featureCanon: {
        absent:
          "the internal voice canon owns this repository's editorial practice",
      },
    },
    members: async () => {
      const voice = await import("./brand/voice.ts");
      return [
        ...voice.BANNED_WORDS.map((word) => word.id),
        ...voice.BANNED_MOVES.map((move) => move.id),
      ];
    },
  },
  {
    id: "brand-vale-styles",
    title: "Register Vale styles",
    what:
      "The per-register Vale styles compiled from voice-registry rules. Each generated register directory is scoped by Map tier in `.vale.ini`; every rule cites its authority, and every unimplemented proposal carries a recorded disposition.",
    source: {
      kind: "module",
      module: "scripts/brand/vale.ts",
      exportName: "VALE_STYLE_RULES",
    },
    guards: ["tests/brand_vale_codegen_test.ts"],
    artifacts: [
      {
        path: ".vale/DiscernBrand/ProductName.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernBrand/GenericVerbs.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernBrand/GenericAdjectives.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernBrand/TemplateOpener.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernBrand/CtaGenericLabel.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernBrand/RepeatedContrast.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernBrand/StackedSlogans.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernProduct/ProductName.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernProduct/AgentBlame.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernAgent/BestJudgment.yml",
        kind: "generated-file",
        banner: true,
      },
      {
        path: ".vale/DiscernAgent/PositionalReference.yml",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent: "the internal voice canon owns this Vale-rule vocabulary",
      },
      featureCanon: {
        absent:
          "the internal voice canon owns this repository's editorial enforcement",
      },
    },
    members: async () => {
      const vale = await import("./brand/vale.ts");
      return vale.VALE_STYLE_RULES.map(
        (rule) => `${rule.register}/${rule.id}`,
      );
    },
  },
  {
    id: "voice-enforcement-coverage",
    title: "Voice enforcement proposals",
    what:
      "Every proposed mechanical voice check has one generated Vale rule, Map projection, structural guard, or semantic residual, rendered into a durable coverage page.",
    source: {
      kind: "module",
      module: "scripts/brand/vale.ts",
      exportName: "voiceEnforcementCoverage",
    },
    guards: ["tests/brand_vale_codegen_test.ts"],
    artifacts: [
      {
        path: join("project/map", VOICE_ENFORCEMENT_COVERAGE_PAGE_REL),
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the internal enforcement record owns this repository-maintenance vocabulary",
      },
      featureCanon: {
        absent:
          "the coverage model records editorial enforcement rather than product capability",
      },
    },
    members: async () =>
      (await import("./brand/vale.ts")).voiceEnforcementCoverage()
        .map((entry) => `${entry.register}/${entry.proposal}`),
  },
  {
    id: "seeded-gotchas-traps",
    title: "Seeded Gate traps",
    what:
      "The stack-independent Gate traps seeded into every project's gotchas page. The repository's page carries the same inventory, and each seeded matcher must match the Engine's live failure evidence.",
    source: {
      kind: "file",
      path: "templates/setup/skeleton/docs/80-development/done-gate-gotchas.md",
      mustContain: "## Stack-independent traps",
    },
    guards: [
      "tests/gotchas_parity_test.ts",
      "tests/gotcha_matchers_drift_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the seeded Gate-gotchas page owns this documentation content",
      },
      featureCanon: { nodeId: "gotchas-pointer" },
    },
  },
  {
    id: "contributor-agreement-gist-files",
    title: "Contributor License Agreement Gist files",
    what:
      "The exact repository sources mirrored into the hosted CLA Assistant Gist: the individual agreement and its generated required acknowledgement.",
    source: {
      kind: "module",
      module: "scripts/contributor_agreement.ts",
      exportName: "CLA_ASSISTANT_GIST_FILES",
    },
    guards: ["tests/contributor_governance_test.ts"],
    artifacts: [
      {
        path: ".github/cla-assistant/metadata",
        kind: "generated-file",
        banner: false,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the contributor agreement owns this repository-policy vocabulary",
      },
      featureCanon: {
        absent:
          "the repository's contributor-governance policy owns this surface",
      },
    },
    members: async () =>
      (await import("./contributor_agreement.ts")).CLA_ASSISTANT_GIST_FILES
        .map((file) => file.gistName),
  },
  {
    id: "first-party-legal-documents",
    title: "First-party legal documents",
    what:
      "The ordered legal package embedded in every binary: discern's software license, its notice, and the Apache-2.0 license for discern-authored project payloads.",
    source: {
      kind: "module",
      module: "src/shared/license_registry.ts",
      exportName: "FIRST_PARTY_LEGAL_DOCUMENTS",
    },
    guards: ["tests/first_party_licenses_test.ts"],
    artifacts: [
      {
        path: "src/lib/first_party_license_bundle.ts",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the CLI reference documents the licenses command and its legal-document package",
      },
      featureCanon: { nodeId: "licenses" },
    },
    members: async () =>
      (await import("../src/shared/license_registry.ts"))
        .FIRST_PARTY_LEGAL_DOCUMENTS.map((document) => document.key),
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
          "the CLI reference documents the licenses command and these generated artifacts",
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
      "Every file permitted to spawn a subprocess, with the interrupt contract each one owes: end-to-end test coverage or a written exemption.",
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
          "the interruption-safety reference owns this subprocess contract",
      },
      featureCanon: { nodeId: "interruption-safety" },
    },
    members: async () =>
      (await import("../tests/spawn_surfaces.ts")).SPAWN_HOMES
        .map((entry) => entry.home),
  },
  {
    id: "authored-ts-universe",
    title: "Authored-TypeScript universe",
    what:
      "The top-level trees holding authored TypeScript define the scan universe for repository-wide structural sweeps. Members are stable roots. The `AUTHORED_TS_FILES` export derives its file list from Git at import time, so the atlas counts roots.",
    source: {
      kind: "module",
      module: "tests/repo_authored_paths.ts",
      exportName: "AUTHORED_TS_ROOTS",
    },
    guards: ["tests/repo_authored_paths_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the contributor reference owns this repository's internal scan-universe vocabulary",
      },
      featureCanon: {
        absent:
          "the repository's contributor guard infrastructure owns these sweeps",
      },
    },
    members: async () => [
      ...(await import("../tests/repo_authored_paths.ts")).AUTHORED_TS_ROOTS,
    ],
  },
  {
    id: "artifact-validators",
    title: "Artifact validators",
    what:
      "Every `src/lib` validator for a config-resolved authored artifact: Map, Guidance sources, Skills, Project Scripts, and Architecture Decision Records. Each validator has a shipped caller or a recorded repository-only classification.",
    source: {
      kind: "module",
      module: "tests/validator_registry.ts",
      exportName: "ARTIFACT_VALIDATORS",
    },
    guards: ["tests/validator_enrolment_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the contributor reference owns this internal enforcement-parity contract",
      },
      featureCanon: {
        absent:
          "the repository's contributor guard infrastructure owns this wiring check",
      },
    },
    members: async () =>
      (await import("../tests/validator_registry.ts")).ARTIFACT_VALIDATORS
        .map((entry) => `${entry.module}#${entry.exportName}`),
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
    guards: [
      "tests/canonical_sets_enrolment_test.ts",
      "tests/ssot_claim_guard_test.ts",
    ],
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
          "this maintainer-only meta-registry has no assigned Glossary term; the terminology decision remains open",
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
  "tests/result_capture_drain_parity_test.ts":
    "derives its universe from the module's `take*` exports and checks that both recording points drain every `result_capture` one-slot mailbox",
  "tests/control_byte_guard_test.ts":
    "applies a byte-level rule across authored text for raw control bytes that Portable Operating System Interface (POSIX) tools read as binary",
  "tests/adr_vocab_guard_test.ts":
    "applies a vocabulary rule across shipped strings for internal decision citations",
  "tests/engine_tree_drift_test.ts":
    "checks the Gate's strand-detection pipeline invariant behaviorally",
  "tests/upgrade_git_guard_test.ts":
    "checks upgrade's clean-tree pipeline invariant to keep upgrades reversible",
  "tests/await_readiness_guard_test.ts":
    "applies an elapsed-time readiness rule across authored await tests",
};

/**
 * Codegen write targets that belong to no canonical set, each with the
 * reason. The write chokepoint in `scripts/codegen.ts` refuses any target
 * outside the declared artifacts and this record.
 */
export const UNAFFILIATED_CODEGEN_TARGETS: Readonly<Record<string, string>> = {
  "site/pages/assets/search.js":
    "copies the single `src/lib/docs_search.js` module into the browser asset",
};

/**
 * Modules whose doc comments claim single-source-of-truth status ("single
 * source of truth", "SSOT") for one of their own exports without anchoring a
 * declared entry, each with the reason. Keys are module paths, optionally
 * pinned to the claiming export as `path#EXPORT`. The claim sweep
 * (`tests/ssot_claim_guard_test.ts`, ADR 0181) holds every authored module
 * making the claim to exactly one of: some entry's `source.module`, or a
 * record here.
 */
export const UNAFFILIATED_SETS: Readonly<Record<string, string>> = {
  "site/design_system.ts#DESIGN_SYSTEM_BUNDLES":
    "site build infrastructure: the route-bundle table drives this repository's site build; project installations omit it",
  "src/engine/gate/proof_render.ts":
    "the claim defines a derive-once invariant: Proof reads and reuses the result envelope",
  "src/engine/worktree/side_restrictions.ts":
    "candidate for enrollment: a registry of every side-restricted lifecycle operation whose class test (`tests/engine_worktree_test.ts`) sits outside the guard convention",
  "src/lib/paths.ts#BUNDLED_DOCS_STAGE_DIR":
    "one staging-directory value shared by the build writer and bundled-docs reader",
  "src/lib/providers.ts":
    "the total-record satellite of the enrolled agent-providers set: AGENT_NAMES is the member axis, and tests/agent_parity_test.ts holds the record total per member",
  "src/lib/version.ts":
    "the kit version constant is one value with no member axis or satellites",
  "src/shared/result_schemas.ts":
    "wire vocabulary already published through the result-contracts schema artifacts; tests/result_codegen_test.ts and tests/result_schemas_test.ts hold the Zod spine to the contracts",
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

/** Describe a canonical set's module export or authored-table authority. */
function sourceLine(source: SetSource): string {
  if (source.kind === "module") {
    return `- Source: \`${source.module}\` — \`${source.exportName}\``;
  }
  return `- Source: \`${source.path}\` (authored table)`;
}

/** Describe how a set is named in the glossary, including recorded exclusions. */
function glossaryLine(enrollment: GlossaryEnrolment): string {
  if ("term" in enrollment) {
    return `- Glossary: the "${enrollment.term}" entry carries the concept`;
  }
  if ("perMember" in enrollment) {
    return `- Glossary: each member is held named-or-recorded-absent by \`${enrollment.perMember}\``;
  }
  return `- Glossary: not enrolled — ${enrollment.absent}`;
}

/** Describe the feature-canon node or surface that claims a set. */
function canonLine(enrollment: CanonEnrolment): string {
  if ("surfaceSet" in enrollment) {
    return `- Feature canon: claimed as the \`${enrollment.surfaceSet}\` surface set`;
  }
  if ("nodeId" in enrollment) {
    return `- Feature canon: described by the \`${enrollment.nodeId}\` node`;
  }
  return `- Feature canon: not enrolled — ${enrollment.absent}`;
}

/** Join repository paths as inline-code items for atlas prose. */
function pathList(paths: readonly string[]): string {
  return paths.map((path) => `\`${path}\``).join(", ");
}

/** The heading a set's atlas section renders under. */
function setHeading(entry: CanonicalSetEntry): string {
  return `\`${entry.id}\` — ${entry.title}`;
}

/**
 * The anchor id the shared renderer mints for a heading, so intra-page links
 * hold to the same algorithm the map's link-integrity guard validates against.
 */
function headingAnchor(heading: string): string {
  const { headings } = renderMarkdownHtml(`## ${heading}`);
  const id = headings[0]?.id;
  if (id === undefined) {
    throw new Error(`heading renders to no anchor: ${heading}`);
  }
  return id;
}

/** An intra-page link to a set's atlas section. */
function setLink(entry: CanonicalSetEntry): string {
  return `[\`${entry.id}\`](#${headingAnchor(setHeading(entry))})`;
}

/** Format a set's authority as a compact atlas-table cell. */
function sourceCell(source: SetSource): string {
  if (source.kind === "module") {
    return `\`${source.module}#${source.exportName}\``;
  }
  return `\`${source.path}\` (authored)`;
}

/** Format direct, per-member, or absent glossary enrollment for the atlas. */
function glossaryCell(enrollment: GlossaryEnrolment): string {
  if ("term" in enrollment) return `"${enrollment.term}"`;
  if ("perMember" in enrollment) return "per member";
  return "—";
}

/** Format surface-set, node, or absent feature-canon enrollment for the atlas. */
function canonCell(enrollment: CanonEnrolment): string {
  if ("surfaceSet" in enrollment) return `surface \`${enrollment.surfaceSet}\``;
  if ("nodeId" in enrollment) return `node \`${enrollment.nodeId}\``;
  return "—";
}

/** Render path-and-reason exceptions as Markdown bullets. */
function strayLines(record: Readonly<Record<string, string>>): string[] {
  return Object.entries(record).map(
    ([path, reason]) => `- \`${path}\` — ${reason}`,
  );
}

/** Render the atlas page from the live registry. */
export async function renderRegistryAtlasDoc(): Promise<string> {
  const memberLists = new Map<string, readonly string[]>();
  for (const entry of CANONICAL_SETS) {
    const members = await resolveSetMembers(entry);
    if (members !== undefined) memberLists.set(entry.id, members);
  }
  const guardIndex = new Map<string, CanonicalSetEntry[]>();
  for (const entry of CANONICAL_SETS) {
    for (const guard of entry.guards) {
      const held = guardIndex.get(guard);
      if (held === undefined) guardIndex.set(guard, [entry]);
      else held.push(entry);
    }
  }
  const guardRows = [...guardIndex.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1
  );
  const artifactRows = CANONICAL_SETS.flatMap((owner) =>
    owner.artifacts.map((artifact) => ({ artifact, owner }))
  ).sort((a, b) => (a.artifact.path < b.artifact.path ? -1 : 1));

  const lines: string[] = [
    "<!-- GENERATED by `deno task codegen` from CANONICAL_SETS (scripts/canonical_sets.ts) — do NOT edit by hand. Change the registry and regenerate. -->",
    "",
    "# Registry atlas",
    "",
    "_The meta-registry generates every canonical set's members, source, guards, artifacts, and enrollments._",
    "",
    "To add a set, declare it in `scripts/canonical_sets.ts`. The enrollment guard (`tests/canonical_sets_enrolment_test.ts`) requires a declared owner for every conventionally named guard test and codegen target. The claim sweep (`tests/ssot_claim_guard_test.ts`) requires every module that claims single-source-of-truth status to have a declared source or recorded absence.",
    "",
    "## The sets at a glance",
    "",
    "One row per set, in registry order. The detail sections use the same order and carry the full account. The table shows member counts. Each detail section lists member names in source order when codegen can read them; an authored source shows a dash and explains the gap. Under Glossary and Feature canon, a dash marks a recorded absence whose reason appears in the detail section.",
    "",
    "| Set | Source | Members | Glossary | Feature canon |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const entry of CANONICAL_SETS) {
    const count = memberLists.get(entry.id)?.length;
    lines.push(
      `| ${setLink(entry)} | ${sourceCell(entry.source)} | ${
        count === undefined ? "—" : count
      } | ${glossaryCell(entry.enrolledIn.glossary)} | ${
        canonCell(entry.enrolledIn.featureCanon)
      } |`,
    );
  }
  lines.push("");
  lines.push(
    `${CANONICAL_SETS.length} sets · ${guardIndex.size} guard tests · ${artifactRows.length} committed artifacts.`,
  );
  lines.push("");
  lines.push("## Guard tests and the sets they hold");
  lines.push("");
  lines.push(
    `Alphabetical by test file. A test holding several sets fails when any one of them drifts. The [unaffiliated records](#${
      headingAnchor("Unaffiliated, with reasons")
    }) account for conventionally named tests with recorded unaffiliated status.`,
  );
  lines.push("");
  lines.push("| Guard test | Holds |");
  lines.push("| --- | --- |");
  for (const [guard, held] of guardRows) {
    lines.push(`| \`${guard}\` | ${held.map(setLink).join(", ")} |`);
  }
  lines.push("");
  lines.push("## Generated artifacts");
  lines.push("");
  lines.push(
    "Alphabetical by path. `deno task codegen` rewrites an entire generated file; a maintained block sits between markers inside an authored page.",
  );
  lines.push("");
  lines.push("| Artifact | Kind | Compiled from |");
  lines.push("| --- | --- | --- |");
  for (const { artifact, owner } of artifactRows) {
    const kind = artifact.kind === "generated-file"
      ? "generated file"
      : "maintained block";
    lines.push(`| \`${artifact.path}\` | ${kind} | ${setLink(owner)} |`);
  }
  lines.push("");
  for (const entry of CANONICAL_SETS) {
    const members = memberLists.get(entry.id);
    lines.push(`## ${setHeading(entry)}`);
    lines.push("");
    lines.push(entry.what);
    lines.push("");
    lines.push(sourceLine(entry.source));
    if (members === undefined) {
      lines.push(
        "- Members: — (the authored source keeps member names outside codegen)",
      );
    } else {
      lines.push(`- Members: ${members.length}`);
      lines.push(...members.map((member) => `  - ${markdownCodeSpan(member)}`));
    }
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
    "Recorded exceptions accepted by convention sweeps. Each subsection names the owning record and reason; add a new exception to its matching record with evidence.",
  );
  lines.push("");
  lines.push("### Guard tests holding no member set");
  lines.push("");
  lines.push(
    "`UNAFFILIATED_GUARDS` records conventionally named guard tests with no member set.",
  );
  lines.push("");
  lines.push(...strayLines(UNAFFILIATED_GUARDS));
  lines.push("");
  lines.push("### Codegen targets compiling from no registry");
  lines.push("");
  lines.push(
    "`UNAFFILIATED_CODEGEN_TARGETS` records these write targets. The write chokepoint in `scripts/codegen.ts` permits only declared artifacts and recorded unaffiliated targets.",
  );
  lines.push("");
  lines.push(...strayLines(UNAFFILIATED_CODEGEN_TARGETS));
  lines.push("");
  lines.push("### Single-source claims anchoring no set");
  lines.push("");
  lines.push(
    "`UNAFFILIATED_SETS` records modules whose doc comments claim single-source-of-truth status without anchoring a declared entry.",
  );
  lines.push("");
  lines.push(...strayLines(UNAFFILIATED_SETS));
  lines.push("");
  return lines.join("\n");
}
