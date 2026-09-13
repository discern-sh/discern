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
import {
  GENERATED_INVENTORY_POLICIES,
  type GeneratedInventoryPolicy,
  type GeneratedInventoryPolicyId,
} from "./generated_inventory_policy.ts";

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
    /** Required for inventory/atlas paths; names the shared framing policy. */
    readonly framingPolicy?: GeneratedInventoryPolicyId;
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
      "tests/instruction_corpus_guard_test.ts",
      "tests/feature_canon_enrolment_test.ts",
      "tests/glossary_enrolment_test.ts",
    ],
    artifacts: [
      {
        path: "project/manual/30-reference/cli-reference.md",
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
    id: "operation-effects",
    title: "Operation effects",
    what:
      "Every live CLI command path's effect classes, exclusion boundary, and preview obligation; the live-tree guard makes new nested and top-level commands enroll before they can run.",
    source: {
      kind: "module",
      module: "src/shared/operation_effects.ts",
      exportName: "OPERATION_EFFECTS",
    },
    guards: ["tests/operation_effects_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the operation protocol documentation explains the shared policy as one concept rather than defining every command path as a term",
      },
      featureCanon: {
        absent:
          "the registry governs cross-cutting execution mechanics rather than a separately selectable product feature",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/operation_effects.ts")).OPERATION_EFFECTS,
      ),
  },
  {
    id: "side-restricted-operations",
    title: "Side-restricted operations",
    what:
      "Every worktree-lifecycle operation restricted to either the main checkout or a linked worktree, including the derived command-line refusal projection when one exists.",
    source: {
      kind: "module",
      module: "src/engine/worktree/side_restrictions.ts",
      exportName: "SIDE_RESTRICTED_OPS",
    },
    guards: ["tests/engine_worktree_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Worktree term defines the boundary; these operation keys are internal lifecycle identifiers",
      },
      featureCanon: { nodeId: "worktrees" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/engine/worktree/side_restrictions.ts"))
          .SIDE_RESTRICTED_OPS,
      ),
  },
  {
    id: "dry-run-verbs",
    title: "Dry-run-capable verbs",
    what:
      "The measured command paths that register `--dry-run`. `OPERATION_EFFECTS.preview` decides which paths require that flag; the bidirectional policy guard holds the two sets equal, and the fidelity guard proves previews write nothing and apply performs only listed effects owned by discern.",
    source: {
      kind: "module",
      module: "src/main.ts",
      exportName: "dryRunCapableVerbs",
    },
    guards: [
      "tests/operation_effects_test.ts",
      "tests/engine_plan_parity_test.ts",
    ],
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
      "tests/instruction_corpus_guard_test.ts",
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
      "The lifecycle sequence that leads schema-deferred clients through status, worktree entry, iteration, the final gate, synchronization, and authorized landing.",
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
        path: "project/manual/30-reference/environment-variables.md",
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
    id: "build-targets",
    title: "Release build targets",
    what:
      "Every native binary the release builds, executes, documents, checksums, attests, and publishes, including its installer selectors and pinned hosted runner.",
    source: {
      kind: "module",
      module: "scripts/build_targets.ts",
      exportName: "BUILD_TARGETS",
    },
    guards: [
      "tests/install_script_test.ts",
      "tests/release_artifacts_test.ts",
      "tests/workflow_platform_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/70-reference/platforms-and-prereqs.md",
        kind: "maintained-block",
      },
      {
        path: "project/manual/30-reference/platforms-and-providers.md",
        kind: "maintained-block",
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the platform reference names concrete release assets rather than adding product vocabulary",
      },
      featureCanon: {
        absent:
          "the distribution mechanism supports the existing self-contained binary capability",
      },
    },
    members: async () =>
      (await import("./build_targets.ts")).BUILD_TARGETS.map((target) =>
        target.triple
      ),
  },
  {
    id: "repository-literal-policies",
    title: "Repository and installer literal projections",
    what:
      "Every declared repository identity, canonical install command, or raw-installer command that cannot import the TypeScript authority, with an exact occurrence count and reason.",
    source: {
      kind: "module",
      module: "scripts/repository_literal_policy.ts",
      exportName: "REPOSITORY_LITERAL_POLICIES",
    },
    guards: ["tests/repository_identity_guard_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "these are repository-development projections of existing product and installer identities",
      },
      featureCanon: {
        absent:
          "the installer capability already owns the public behavior; this set prevents repository drift",
      },
    },
    members: async () =>
      (await import("./repository_literal_policy.ts"))
        .REPOSITORY_LITERAL_POLICIES.map((policy) => policy.path),
  },
  {
    id: "editor-path-policies",
    title: "Shared editor path policies",
    what:
      "Every absent generated output shared editor configuration may exclude, plus private browser-plugin state that must remain absent and ignored.",
    source: {
      kind: "module",
      module: "scripts/repository_files.ts",
      exportName: "EDITOR_PATH_POLICIES",
    },
    guards: ["tests/repository_hygiene_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "these are repository-maintenance paths rather than product vocabulary",
      },
      featureCanon: {
        absent:
          "editor presentation and local state do not change product behavior",
      },
    },
    members: async () =>
      (await import("./repository_files.ts")).EDITOR_PATH_POLICIES.map(
        (policy) => `${policy.kind}: ${policy.path}`,
      ),
  },
  {
    id: "repository-community-files",
    title: "Repository community files",
    what:
      "Every root community contract and every GitHub configuration file, including recorded omissions, so a new intake or automation surface must declare its role.",
    source: {
      kind: "module",
      module: "scripts/repository_files.ts",
      exportName: "REPOSITORY_COMMUNITY_FILE_POLICIES",
    },
    guards: ["tests/repository_hygiene_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the contributor guide and repository routes explain these files in context",
      },
      featureCanon: {
        absent:
          "repository governance files surround rather than constitute the product",
      },
    },
    members: async () =>
      (await import("./repository_files.ts"))
        .REPOSITORY_COMMUNITY_FILE_POLICIES.map(
          (policy) => `${policy.state}: ${policy.path}`,
        ),
  },
  {
    id: "map-tier-publication-postures",
    title: "Map tier publication rules",
    what:
      "Every top-level map tier declares whether it publishes to the site, only with the repository, or remains private through the owner transition.",
    source: {
      kind: "module",
      module: "src/lib/paths.ts",
      exportName: "MAP_TIER_PUBLICATION_POSTURES",
    },
    guards: ["tests/repository_hygiene_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Map and public-manual documentation explain these repository audience boundaries",
      },
      featureCanon: {
        absent:
          "publication rules are repository governance rather than a product capability",
      },
    },
    members: async () =>
      (await import("../src/lib/paths.ts")).MAP_TIER_PUBLICATION_POSTURES.map(
        (entry) => `${entry.tier}: ${entry.posture}`,
      ),
  },
  {
    id: "contributor-intake-surfaces",
    title: "Contributor-intake surfaces",
    what:
      "Every public repository file that must project whether contributor agreements and external pull requests can be accepted.",
    source: {
      kind: "module",
      module: "scripts/repository_files.ts",
      exportName: "CONTRIBUTOR_INTAKE_SURFACES",
    },
    guards: ["tests/repository_hygiene_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the contributor guide states this repository lifecycle status directly",
      },
      featureCanon: {
        absent:
          "contributor intake is repository governance rather than product behavior",
      },
    },
    members: async () => [
      ...(await import("./repository_files.ts")).CONTRIBUTOR_INTAKE_SURFACES,
    ],
  },
  {
    id: "checkpoint-entry-fields",
    title: "Checkpoint entry fields",
    what:
      "Every public field under `[checkpoints.<id>]`, classified as a selector, trigger, or review field so trigger consumers derive their membership and a future field cannot bypass enrollment.",
    source: {
      kind: "module",
      module: "src/shared/checkpoints.ts",
      exportName: "CHECKPOINT_FIELD_ROLES",
    },
    guards: [
      "tests/checkpoints_trigger_vocabulary_test.ts",
      "tests/checkpoints_policy_test.ts",
      "tests/checkpoints_subject_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the checkpoint term owns the concept and the config reference owns each field spelling",
      },
      featureCanon: { nodeId: "checkpoints" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/checkpoints.ts"))
          .CHECKPOINT_FIELD_ROLES,
      ),
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
      "The core policy statements carried by bundled instructions and MCP server instructions, with probes that recognize each authored restatement.",
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
          "the instruction, Worktree, Standard, and MCP nodes own the enforced behaviors",
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
      "The consent evidence recorded for every successful landing: a conversation attestation, a trunk-recorded standing grant, or a desk-recorded effort grant.",
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
      "The irreversible acceptance effects carried by partial and successful results, MCP re-aiming, and logbook events.",
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
      "The worktree lifecycle verbs that require `discern.toml` at the Git repository root because each creates or lands a full-repository checkout.",
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
      "The desk's per-worktree action vocabulary and menu order. The legality table exercises every member, and the runtime test checks each interactive effect boundary.",
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
    id: "on-disk-formats",
    title: "Local durable formats",
    what:
      "Every versioned record discern writes in Git administration state or a Proof note: its storage coordinate, current version, reader, and forward-skew policy.",
    source: {
      kind: "module",
      module: "src/shared/on_disk_formats.ts",
      exportName: "ON_DISK_FORMATS",
    },
    guards: [
      "tests/on_disk_formats_test.ts",
      "tests/git_admin_state_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Git-admin state reference explains versioned local evidence as one lifecycle concept",
      },
      featureCanon: {
        absent:
          "the registry protects several existing features rather than adding another selectable feature",
      },
    },
    members: async () =>
      Object.values(
        (await import("../src/shared/on_disk_formats.ts")).ON_DISK_FORMATS,
      ).map((format) => format.id),
  },
  {
    id: "git-footprint",
    title: "Clone-local Git footprint",
    what:
      "Every Git configuration key and ref namespace discern may create, including its writer, lifetime, uninstall treatment, and optional cleanup.",
    source: {
      kind: "module",
      module: "src/engine/git_footprint.ts",
      exportName: "DISCERN_GIT_FOOTPRINT",
    },
    guards: ["tests/git_footprint_inventory_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the files-and-ownership reference documents these internal Git coordinates in context",
      },
      featureCanon: {
        absent:
          "the footprint supports setup, refresh, Proof transport, recovery, and uninstall rather than one feature",
      },
    },
    members: async () => [
      ...(await import("../src/engine/git_footprint.ts"))
        .DISCERN_GIT_FOOTPRINT,
    ],
  },
  {
    id: "jobs",
    title: "Gate jobs",
    what: "The known gate jobs: the command table's fixed vocabulary.",
    source: {
      kind: "module",
      module: "src/shared/capabilities.ts",
      exportName: "KNOWN_JOBS",
    },
    guards: [
      "tests/config_codegen_test.ts",
      "tests/config_command_test.ts",
      "tests/engine_setup_assurance_test.ts",
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
      "tests/config_prose_test.ts",
      "tests/config_template_test.ts",
      "tests/config_banner_parity_test.ts",
      "tests/config_set_schema_guard_test.ts",
      "tests/feature_canon_enrolment_test.ts",
      "tests/generated_artifacts_test.ts",
      "tests/agent_gitattributes_test.ts",
    ],
    artifacts: [
      {
        path: "templates/discern.toml.tmpl",
        kind: "generated-file",
        banner: false,
      },
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
        path: "project/manual/30-reference/config-reference.md",
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
      "The authored-source locations: instructions, Map, Skills, Project Scripts, TODO, and brief. Each entry carries its config key, default, ownership, and resolution rule; every configured scalar entry automatically exposes its live reference.",
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
      "tests/source_path_references_test.ts",
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
    what: "The skills the binary ships and materializes into a project.",
    source: {
      kind: "module",
      module: "src/lib/skills.ts",
      exportName: "bundledSkillNames",
    },
    guards: [
      "tests/skill_name_parity_test.ts",
      "tests/feature_canon_enrolment_test.ts",
      "tests/instruction_corpus_guard_test.ts",
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
      "The effective skills and setup briefs joined to repository-only classifications, exact agent-facing prose evidence, materialized-output protection, and generated agent-copy lexical rules.",
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
      "tests/provider_brand_provenance_codegen_test.ts",
    ],
    artifacts: [
      {
        path: "site/pages/assets/integrations/README.md",
        kind: "generated-file",
        banner: true,
      },
    ],
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
    id: "provider-trust-fact-kinds",
    title: "Provider trust fact kinds",
    what:
      "The literal machine-fact vocabulary provider trust actions may carry separately from explanation prose.",
    source: {
      kind: "module",
      module: "src/shared/provider_trust.ts",
      exportName: "TRUST_FACT_KINDS",
    },
    guards: [
      "tests/providers_test.ts",
      "tests/result_schemas_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "trust fact kinds are an internal wire vocabulary rather than separate user concepts",
      },
      featureCanon: { nodeId: "providers" },
    },
    members: async () => [
      ...(await import("../src/shared/provider_trust.ts")).TRUST_FACT_KINDS,
    ],
  },
  {
    id: "provider-trust-action-kinds",
    title: "Provider trust action kinds",
    what:
      "The recovery-action vocabulary every provider trust instruction declares before presentation.",
    source: {
      kind: "module",
      module: "src/shared/provider_trust.ts",
      exportName: "TRUST_ACTION_KINDS",
    },
    guards: [
      "tests/providers_test.ts",
      "tests/result_schemas_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "trust recovery kinds classify provider integration guidance rather than naming separate user concepts",
      },
      featureCanon: { nodeId: "providers" },
    },
    members: async () => [
      ...(await import("../src/shared/provider_trust.ts")).TRUST_ACTION_KINDS,
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
        path: "project/map/_internal/brand/boundary-canon.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/claims-and-evidence.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/consequence-canon.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/copy-patterns.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/demand-canon.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/_internal/brand/readiness-canon.md",
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
    id: "brand-boundaries",
    title: "Boundary Canon",
    what:
      "discern's conceptual product boundaries and their three generated projections: behavioral refusals, mistaken-identity discriminators, and structural absences, each held to explicit scope, stability, and inspectable evidence.",
    source: {
      kind: "module",
      module: "scripts/brand/boundaries.ts",
      exportName: "BOUNDARIES",
    },
    guards: [
      "tests/boundary_canon_test.ts",
      "tests/brand_registry_codegen_test.ts",
      "tests/evidence_basis_guard_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the internal Boundary Canon defines this product-boundary vocabulary",
      },
      featureCanon: {
        absent:
          "the Feature Canon owns what the product does; this set owns the complementary noes and category distinctions",
      },
    },
    members: async () => {
      const boundaries = await import("./brand/boundaries.ts");
      return [
        ...boundaries.BOUNDARIES.map((boundary) => boundary.id),
        ...boundaries.allBoundaryProjections().map((projection) =>
          projection.id
        ),
      ];
    },
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
    guards: [
      "tests/brand_registry_codegen_test.ts",
      "tests/canon_editor_parity_test.ts",
      "tests/evidence_basis_guard_test.ts",
      "tests/do_not_claim_guard_test.ts",
    ],
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
    id: "brand-foundation-reading-steps",
    title: "Brand writing foundations",
    what:
      "The shared strategic-document sequence that the brand voice skill and the homepage-or-campaign reading path both require before public copy is written.",
    source: {
      kind: "module",
      module: "scripts/brand/voice.ts",
      exportName: "BRAND_FOUNDATION_READING_STEPS",
    },
    guards: ["tests/brand_registry_codegen_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the internal brand operating system owns this writing-context vocabulary",
      },
      featureCanon: {
        absent:
          "the reading sequence governs brand work rather than product behavior",
      },
    },
    members: async () =>
      (await import("./brand/voice.ts")).BRAND_FOUNDATION_READING_STEPS.map(
        (step) => step.id,
      ),
  },
  {
    id: "demand-canon",
    title: "Demand canon",
    what:
      "The market-side counterpart of the Human Benefit Canon: evidence-tagged struggling moments with their current alternatives and forces, held to two-way coverage against the benefits and rendered into the demand page the brand-documents set owns.",
    source: {
      kind: "module",
      module: "scripts/brand/demand.ts",
      exportName: "DEMAND_CANON",
    },
    guards: [
      "tests/demand_canon_test.ts",
      "tests/canon_editor_parity_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the internal demand canon defines this market-evidence vocabulary",
      },
      featureCanon: {
        absent:
          "demand entries cite the benefits that answer them rather than product nodes",
      },
    },
    members: async () => {
      const demand = await import("./brand/demand.ts");
      return [
        ...demand.DEMAND_CANON.map((territory) => territory.id),
        ...demand.allDemandEntries().map(({ entry }) => entry.id),
      ];
    },
  },
  {
    id: "readiness-canon",
    title: "Readiness canon",
    what:
      "Readiness families and questions with stable discovery identities, practical approaches, and feature routes read in either direction. Feature entries derive their lead questions from these records; benefits and practice connections retain their existing canon authorities.",
    source: {
      kind: "module",
      module: "scripts/brand/readiness.ts",
      exportName: "READINESS_CANON",
    },
    guards: ["tests/readiness_canon_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the internal readiness reference connects ordinary questions to existing product terms",
      },
      featureCanon: {
        absent:
          "readiness questions route to existing features and introduce no runtime capability",
      },
    },
    members: async () => {
      const readiness = await import("./brand/readiness.ts");
      return [
        ...readiness.READINESS_CANON.map((family) => family.id),
        ...readiness.allReadinessQuestions().map((question) => question.id),
      ];
    },
  },
  {
    id: "consequence-canon",
    title: "Consequence canon",
    what:
      "The second-order account above the benefit canons: what changes for the person and the coding agent once the benefits hold, each entry deductive on cited benefits and claims for its consequence and evidence-classed for the behavior it predicts, rendered into the consequence page the brand-documents set owns.",
    source: {
      kind: "module",
      module: "scripts/brand/consequences.ts",
      exportName: "CONSEQUENCE_CANON",
    },
    guards: ["tests/consequence_canon_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the internal consequence canon defines this second-order vocabulary",
      },
      featureCanon: {
        absent:
          "consequences cite the benefits and claims they rest on rather than product nodes",
      },
    },
    members: async () => {
      const consequences = await import("./brand/consequences.ts");
      return [
        ...consequences.CONSEQUENCE_CANON.map((entry) => entry.id),
        ...Object.keys(consequences.SHARED_HYPOTHESES),
      ];
    },
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
    id: "setup-human-moments",
    title: "Setup human moments",
    what:
      "The semantic contracts for setup's first-use explanations, owner decisions, progress relays, completion handoff, landing choice, and activation handoff.",
    source: {
      kind: "module",
      module: "src/shared/setup_experience.ts",
      exportName: "SETUP_HUMAN_MOMENTS",
    },
    guards: [
      "tests/engine_setup_operational_contract_test.ts",
      "tests/engine_setup_welcome_test.ts",
      "tests/engine_setup_messages_test.ts",
      "tests/engine_setup_handoff_test.ts",
      "tests/engine_setup_accept_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the setup pages and lifecycle results define these reader-facing moments in context",
      },
      featureCanon: { nodeId: "setup" },
    },
    members: async () =>
      (await import("../src/shared/setup_experience.ts"))
        .SETUP_HUMAN_MOMENTS.map((moment) => moment.id),
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
    id: "intentional-deno-renames",
    title: "Intentional Deno renames",
    what:
      "Every authored Deno rename outside the atomic replacement capability, identified by source path and enclosing function with the reason its move semantics are intentional.",
    source: {
      kind: "module",
      module: "tests/atomic_write_renames.ts",
      exportName: "REGISTERED_RENAMES",
    },
    guards: ["tests/atomic_write_enrolment_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the artifact-ownership reference owns this repository-internal filesystem policy",
      },
      featureCanon: {
        absent:
          "the registry constrains implementation mechanics across existing feature owners",
      },
    },
    members: async () =>
      (await import("../tests/atomic_write_renames.ts")).REGISTERED_RENAMES
        .map((entry) => `${entry.path}#${entry.enclosingFunction}`),
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
      "The `@…@` runtime tokens substituted into a worktree's resource commands from its identity: database (`db`), site, port, project slug, directory, worktree, and resource.",
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
      ...GENERATED_INVENTORY_POLICIES.hints.tests,
      "tests/gate_plan_test.ts",
      "tests/result_schemas_test.ts",
      "tests/engine_json_purity_test.ts",
      "tests/engine_logbook_test.ts",
      "tests/patterns_test.ts",
    ],
    artifacts: [
      {
        path: GENERATED_INVENTORY_POLICIES.hints.artifactPath,
        kind: "generated-file",
        banner: true,
        framingPolicy: "hints",
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
      "The desk tip registry: every teaching line the desk can show enters through it, in curriculum order.",
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
      ...GENERATED_INVENTORY_POLICIES.tips.tests,
      "tests/engine_desk_tips_test.ts",
    ],
    artifacts: [
      {
        path: GENERATED_INVENTORY_POLICIES.tips.artifactPath,
        kind: "generated-file",
        banner: true,
        framingPolicy: "tips",
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
    title: "Package triangle motifs",
    what:
      "The reusable triangle treatments: every pure static frame carries one semantic animation timeline and enters both maintainer gallery projections.",
    source: {
      kind: "module",
      module: "art/terminal/triangle.ts",
      exportName: "DISCERN_PACKAGE_TRIANGLE_MOTIFS",
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
          .DISCERN_PACKAGE_TRIANGLE_MOTIFS,
      ),
  },
  {
    id: "terminal-product-triangle-art",
    title: "Product triangle art",
    what:
      "The product-specific triangle compositions: every static figure derives its glyphs and order from the package and carries one matching animation timeline.",
    source: {
      kind: "module",
      module: "art/terminal/triangle.ts",
      exportName: "DISCERN_PRODUCT_TRIANGLE_ART",
    },
    guards: [
      "tests/triangle_art_test.ts",
      "tests/art_gallery_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent: "the terminal-art gallery owns these product composition names",
      },
      featureCanon: {
        absent:
          "the existing terminal surfaces consume these product compositions and maintainer previews",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../art/terminal/triangle.ts"))
          .DISCERN_PRODUCT_TRIANGLE_ART,
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
      "tests/browser_art_figures_test.ts",
      "tests/browser_art_circuit_test.ts",
      "tests/browser_art_seal_test.ts",
      "tests/browser_art_delta_test.ts",
      "tests/browser_art_rule_test.ts",
      "tests/browser_art_interference_test.ts",
      "tests/browser_art_quorum_test.ts",
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
      "Every CLI-only action allowed to detach or remove active logbook history. Dispatch, recording exclusion, terminal-confirmation policy, and safety tests derive from this set.",
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
      "The categories that group every patterns detector and finding. Schemas, registry entries, and the human report derive from this vocabulary.",
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
      "The presentation-only vocabulary a patterns finding uses to distinguish favorable, neutral, and attention-worthy evidence.",
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
      "Every detector the patterns verb runs over the logbook, in stable registry order. Companion families, scopes, tiers, and statuses from `src/shared/patterns_vocabulary.ts` type each entry. The parameterized class test requires fixtures for every new detector.",
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
      "tests/canon_editor_parity_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/00-orientation/glossary.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/manual/30-reference/glossary.md",
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
      "tests/canon_editor_parity_test.ts",
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
    id: "human-benefit-canon",
    title: "Human Benefit Canon",
    what:
      "The commercially ordered human transposition of the feature registry: human value and the reason it follows, with explicit feature and public-claim traceability.",
    source: {
      kind: "module",
      module: "scripts/feature_registry.ts",
      exportName: "HUMAN_BENEFIT_CANON",
    },
    guards: [
      "tests/feature_canon_human_benefit_test.ts",
      "tests/feature_canon_codegen_test.ts",
      "tests/canon_editor_parity_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_internal/feature-canon-human-benefits.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "this maintainer registry supplies the Human Benefit Canon's data",
      },
      featureCanon: {
        absent:
          "the Human Benefit Canon is the feature canon's human-value transposition; its entries cite feature nodes rather than claim surfaces",
      },
    },
    members: async () =>
      (await import("./feature_registry.ts")).allHumanBenefitEntries().map(
        (flat) => flat.entry.id,
      ),
  },
  {
    id: "agent-benefit-canon",
    title: "Agent Benefit Canon",
    what:
      "The exhaustive coding-agent transposition of the feature registry: agent value, mechanism, boundary, direct and supporting feature roles, agent hints, and agent or shared public claims.",
    source: {
      kind: "module",
      module: "scripts/feature_registry.ts",
      exportName: "AGENT_BENEFIT_CANON",
    },
    guards: [
      "tests/feature_canon_agent_benefit_test.ts",
      "tests/feature_canon_codegen_test.ts",
      "tests/practice_canon_enrolment_test.ts",
      "tests/canon_editor_parity_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_internal/feature-canon-agent-benefits.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "this maintainer registry supplies the Agent Benefit Canon's data",
      },
      featureCanon: {
        absent:
          "the Agent Benefit Canon is the Feature canon's coding-agent transposition; its entries cite feature nodes instead of claiming product surfaces",
      },
    },
    members: async () =>
      (await import("./feature_registry.ts")).allAgentBenefitEntries().map(
        (flat) => flat.entry.id,
      ),
  },
  {
    id: "practice-tenets",
    title: "Practice canon",
    what:
      "The practice registry behind the practice canon: the obligations upheld by enforcement, automation, and teaching, each tenet citing its feature-canon mechanisms, its Human Benefit Canon value, its Agent Benefit Canon outcomes, and the project-inventory items it maintains.",
    source: {
      kind: "module",
      module: "scripts/practice_registry.ts",
      exportName: "PRACTICE_CANON",
    },
    guards: [
      "tests/practice_canon_enrolment_test.ts",
      "tests/canon_editor_parity_test.ts",
    ],
    artifacts: [
      {
        path: "project/map/_internal/practice-canon.md",
        kind: "generated-file",
        banner: true,
      },
      {
        path: "project/map/00-orientation/the-practice.md",
        kind: "generated-file",
        banner: true,
      },
    ],
    enrolledIn: {
      glossary: { term: "Practice" },
      featureCanon: {
        absent:
          "the tenets are obligations the feature nodes implement; each cites its mechanisms rather than claiming surfaces",
      },
    },
    members: async () =>
      (await import("./practice_registry.ts")).PRACTICE_CANON.map(
        (tenet) => tenet.id,
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
      "tests/raw_json_parse_guard_test.ts",
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
    id: "result-completion-policies",
    title: "Result completion policies",
    what:
      "The one-per-verb semantic authority that defines required outcomes, optional advisories, non-completion states, and recovery ownership.",
    source: {
      kind: "module",
      module: "src/shared/result_completion.ts",
      exportName: "RESULT_COMPLETION_POLICY_DEFINITIONS",
    },
    guards: [
      "tests/result_completion_policy_test.ts",
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
          "the result-envelope reference defines completion and typed advisory semantics",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/result_completion.ts"))
          .RESULT_COMPLETION_POLICY_DEFINITIONS,
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
    id: "contract-manifests",
    title: "Frozen contract manifests",
    what:
      "The generated MCP, CLI, and conventions baselines whose same-major policies preserve every published v1 member.",
    source: {
      kind: "module",
      module: "scripts/contract_manifests.ts",
      exportName: "CONTRACT_MANIFEST_ARTIFACTS",
    },
    guards: [
      "tests/result_codegen_test.ts",
      "tests/public_schema_compatibility_guard_test.ts",
      "tests/git_footprint_contract_test.ts",
    ],
    artifacts: [
      {
        path: "schema/discern-mcp-tools.json",
        kind: "generated-file",
        banner: false,
      },
      {
        path: "schema/discern-cli.json",
        kind: "generated-file",
        banner: false,
      },
      {
        path: "schema/discern-conventions.json",
        kind: "generated-file",
        banner: false,
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "the public contract reference explains these compatibility artifacts without adding another product term",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () => [
      ...(await import("./contract_manifests.ts"))
        .CONTRACT_MANIFEST_ARTIFACTS,
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
        path: "project/manual/30-reference/mcp-and-results.md",
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
    id: "result-advisory-kinds",
    title: "Result advisory kinds",
    what:
      "The machine-stable vocabulary for explicitly optional degradation that may coexist with a successful completion verdict.",
    source: {
      kind: "module",
      module: "src/shared/result.ts",
      exportName: "RESULT_ADVISORY_KINDS",
    },
    guards: [
      "tests/result_completion_policy_test.ts",
      "tests/result_schemas_test.ts",
      "tests/result_codegen_test.ts",
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
          "the result-envelope reference defines typed advisories and their evidence/recovery shape",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () => [
      ...(await import("../src/shared/result.ts")).RESULT_ADVISORY_KINDS,
    ],
  },
  {
    id: "manual-pages",
    title: "Published manual pages",
    what:
      "Every strictly admitted published product-manual page, identified by its stable authored page id.",
    source: {
      kind: "module",
      module: "src/lib/manual.ts",
      exportName: "buildManualProjection",
    },
    guards: [
      "tests/manual_curation_test.ts",
      "tests/manual_projection_guard_test.ts",
      "tests/manual_surface_parity_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the document-model Map page defines the manual corpus and its stable page identities",
      },
      featureCanon: { nodeId: "bundled-docs" },
    },
    members: async () => {
      const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
      const { discoverDocs } = await import("../src/lib/docs.ts");
      const { buildManualProjection } = await import("../src/lib/manual.ts");
      const { resolveRepositoryManualDir } = await import(
        "../src/lib/paths.ts"
      );
      const tree = await discoverDocs({
        cwd: repoRoot,
        dir: resolveRepositoryManualDir(repoRoot).abs,
      });
      if (tree === undefined) return [];
      return (await buildManualProjection(tree.entries)).pages.map((page) =>
        page.id
      );
    },
  },
  {
    id: "manual-sections",
    title: "Manual sections",
    what:
      "The complete ordered section and route families of the repository-owned product manual.",
    source: {
      kind: "module",
      module: "src/shared/manual.ts",
      exportName: "MANUAL_SECTION_REGISTRY",
    },
    guards: [
      "tests/manual_curation_test.ts",
      "tests/manual_doc_checkpoint_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the product manual presents these reader-facing sections directly",
      },
      featureCanon: { nodeId: "bundled-docs" },
    },
    members: async () =>
      (await import("../src/shared/manual.ts")).MANUAL_SECTION_REGISTRY.map(
        (section) => section.dir,
      ),
  },
  {
    id: "manual-kinds",
    title: "Manual kinds",
    what:
      "The closed editorial purposes that choose manual comprehension policy and reading-complexity inclusion.",
    source: {
      kind: "module",
      module: "src/shared/manual.ts",
      exportName: "MANUAL_KIND_REGISTRY",
    },
    guards: [
      "tests/manual_policy_test.ts",
      "tests/manual_doc_checkpoint_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the document-model Map page defines editorial purpose as manual metadata",
      },
      featureCanon: { nodeId: "bundled-docs" },
    },
    members: async () =>
      (await import("../src/shared/manual.ts")).MANUAL_KIND_REGISTRY.map(
        (entry) => entry.kind,
      ),
  },
  {
    id: "manual-alias-owners",
    title: "Manual alias owners",
    what:
      "The explicit page-id owner for each normalized manual search name that would otherwise collide.",
    source: {
      kind: "module",
      module: "src/shared/manual.ts",
      exportName: "MANUAL_ALIAS_OWNER_OVERRIDES",
    },
    guards: ["tests/manual_policy_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "search-name collision ownership is repository policy rather than reader vocabulary",
      },
      featureCanon: { nodeId: "bundled-docs" },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/manual.ts")).MANUAL_ALIAS_OWNER_OVERRIDES,
      ),
  },
  {
    id: "manual-benefit-obligations",
    title: "Manual benefit obligations",
    what:
      "The selected Human Benefit ids and the stable published manual page ids required to explain them.",
    source: {
      kind: "module",
      module: "scripts/manual_benefits.ts",
      exportName: "MANUAL_BENEFIT_OBLIGATIONS",
    },
    guards: ["tests/manual_policy_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Human Benefit Canon owns benefit vocabulary; this mapping only assigns manual homes",
      },
      featureCanon: {
        absent:
          "feature-to-benefit edges stay in the Human Benefit Canon and are not copied into manual policy",
      },
    },
    members: async () =>
      Object.keys(
        (await import("./manual_benefits.ts")).MANUAL_BENEFIT_OBLIGATIONS,
      ),
  },
  {
    id: "manual-benefit-exclusions",
    title: "Manual benefit exclusions",
    what:
      "The Human Benefit ids left without a primary manual obligation and their retained 1A reason.",
    source: {
      kind: "module",
      module: "scripts/manual_benefits.ts",
      exportName: "MANUAL_BENEFIT_EXCLUSIONS",
    },
    guards: ["tests/manual_policy_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the Human Benefit Canon owns benefit vocabulary; this set records a corpus decision",
      },
      featureCanon: {
        absent:
          "excluded benefits remain in the Human Benefit Canon without new feature relationships",
      },
    },
    members: async () =>
      Object.keys(
        (await import("./manual_benefits.ts")).MANUAL_BENEFIT_EXCLUSIONS,
      ),
  },
  {
    id: "manual-front-doors",
    title: "Manual front doors",
    what:
      "The scarce promoted journeys authored as direct links in the manual root and projected into starting surfaces.",
    source: {
      kind: "file",
      path: "project/manual/README.md",
      mustContain: "<!-- BEGIN MANUAL FRONT DOORS -->",
    },
    guards: [
      "tests/manual_curation_test.ts",
      "tests/manual_surface_parity_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "promotion is a manual navigation policy, distinct from the publication vocabulary",
      },
      featureCanon: { nodeId: "bundled-docs" },
    },
  },
  {
    id: "public-doc-surfaces",
    title: "Public doc surfaces",
    what:
      "The projection matrix deciding which admitted manual pages reach each complete public surface.",
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
          "the document-model Map page defines publication, and this Engine table supplies its delivery projections",
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
      "The numbered decision records in the map, including records later superseded.",
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
      "tests/adr_supersession_guard_test.ts",
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
        path: "project/manual/30-reference/files-and-ownership.md",
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
      "The voice registry's banned-word and banned-move canon behind the generated voice skills. The Vale style must see every banned phrase the canon declares.",
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
      "The per-register Vale styles compiled from voice-registry rules. Each generated register directory is scoped by map tier in `.vale.ini`; every rule cites its authority, and every unimplemented proposal carries a recorded disposition.",
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
        path: ".vale/DiscernProduct/CanonicalTermCase.yml",
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
      "The stack-independent gate traps seeded into every project's gotchas page. The repository's page carries the same inventory, and each seeded matcher must match the engine's live failure evidence.",
    source: {
      kind: "file",
      path: "templates/setup/skeleton/map/80-development/done-gate-gotchas.md",
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
      module: "scripts/third_party_codegen.ts",
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
        (await import("./third_party_codegen.ts"))
          .THIRD_PARTY_ARTIFACT_PATHS,
      ),
  },
  {
    id: "spawn-surfaces",
    title: "Subprocess spawn boundaries",
    what:
      "Every direct production-and-tooling subprocess constructor, with its exact path, enclosing function, operation, reason, capability role, and binary class; engine homes separately declare an interrupt Proof or exemption.",
    source: {
      kind: "module",
      module: "tests/spawn_surfaces.ts",
      exportName: "SUBPROCESS_SPAWN_BOUNDARIES",
    },
    guards: [
      "tests/engine_subprocess_ssot_test.ts",
      "tests/engine_child_lineage_guard_test.ts",
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
      (await import("../tests/spawn_surfaces.ts"))
        .SUBPROCESS_SPAWN_BOUNDARIES.map((entry) =>
          `${entry.path}#${entry.enclosingFunction}`
        ),
  },
  {
    id: "checkout-mutation-surfaces",
    title: "Checkout-mutation boundaries",
    what:
      "Every authored Git invocation that installs a revision or replaces a checkout's index or working tree, with its exact path, enclosing function, command, workspace-contract allowance, and reason.",
    source: {
      kind: "module",
      module: "tests/checkout_mutation_surfaces.ts",
      exportName: "CHECKOUT_MUTATION_BOUNDARIES",
    },
    guards: ["tests/checkout_mutation_guard_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the workspace contract is a decision record and a guard, not a reader-facing term",
      },
      featureCanon: { nodeId: "worktrees" },
    },
    members: async () =>
      (await import("../tests/checkout_mutation_surfaces.ts"))
        .CHECKOUT_MUTATION_BOUNDARIES.map((entry) =>
          `${entry.path}#${entry.enclosingFunction}#${entry.command}`
        ),
  },
  {
    id: "process-output-boundaries",
    title: "Process output boundaries",
    what:
      "Every direct console or stdout/stderr write in the shipped product, with its stable id, exact path, enclosing function, operation, channel, purpose, and reason.",
    source: {
      kind: "module",
      module: "src/shared/process_boundaries.ts",
      exportName: "PROCESS_OUTPUT_BOUNDARIES",
    },
    guards: ["tests/process_boundaries_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "process output enrollment is an internal product-architecture boundary rather than user-facing vocabulary",
      },
      featureCanon: {
        absent:
          "the output adapters support every feature surface rather than adding a separately selectable capability",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/process_boundaries.ts"))
          .PROCESS_OUTPUT_BOUNDARIES,
      ),
  },
  {
    id: "process-exit-boundaries",
    title: "Process exit boundaries",
    what:
      "Every direct process termination in the shipped product, with its stable id, exact path, enclosing function, operation, exit purpose, and reason.",
    source: {
      kind: "module",
      module: "src/shared/process_boundaries.ts",
      exportName: "PROCESS_EXIT_BOUNDARIES",
    },
    guards: ["tests/process_boundaries_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "process termination enrollment is an internal product-architecture boundary rather than user-facing vocabulary",
      },
      featureCanon: {
        absent:
          "dispatcher, crash, and signal exit boundaries support every feature instead of defining a selectable capability",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/process_boundaries.ts"))
          .PROCESS_EXIT_BOUNDARIES,
      ),
  },
  {
    id: "exit-statuses",
    title: "CLI exit statuses",
    what:
      "Every exact CLI status and passthrough class, shared by runtime constants and the two manual projections.",
    source: {
      kind: "module",
      module: "src/shared/exit_codes.ts",
      exportName: "EXIT_STATUS_REGISTRY",
    },
    guards: ["tests/exit_status_registry_test.ts"],
    artifacts: [{
      path: "project/manual/30-reference/mcp-and-results.md",
      kind: "maintained-block",
    }],
    enrolledIn: {
      glossary: {
        absent:
          "the CLI and result manuals document exit-status behavior at its point of use",
      },
      featureCanon: {
        absent:
          "exit statuses are a cross-cutting process contract rather than a selectable capability",
      },
    },
    members: async () =>
      (await import("../src/shared/exit_codes.ts")).EXIT_STATUS_REGISTRY.map(
        (entry) => entry.id,
      ),
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
      "Every `src/lib` validator for a config-resolved authored artifact: Map, Instruction sources, Skills, Project Scripts, and Architecture Decision Records. Each validator has a shipped caller or a recorded repository-only classification.",
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
    id: "canary-tests",
    title: "Canary test membership",
    what:
      "The recorded judgments behind the canary check job: extras promoted on recorded failure evidence and refusals with their cost measurements, layered over the guard- and enrolment-name convention.",
    source: {
      kind: "module",
      module: "scripts/canary_registry.ts",
      exportName: "CANARY_EXTRA_TEST_FILES",
    },
    guards: ["tests/canary_registry_guard_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "the canary is one configured gate job; the registry records repository-local test-scheduling judgments",
      },
      featureCanon: {
        absent:
          "repository-local job wiring over the generic [jobs] table, not a shipped discern feature",
      },
    },
    members: async () =>
      (await import("./canary_registry.ts")).CANARY_EXTRA_TEST_FILES
        .map((entry) => entry.file),
  },
  {
    id: "temp-directory-creator-authorities",
    title: "Raw temp-directory creator authorities",
    what:
      "The only modules permitted to call Deno's raw temporary-directory primitives, each with a reason naming its distinct lifetime.",
    source: {
      kind: "module",
      module: "tests/temp_dir_authorities.ts",
      exportName: "TEMP_DIR_CREATOR_AUTHORITIES",
    },
    guards: ["tests/temp_dir_guard_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "raw temporary-directory creation is a repository development boundary rather than product vocabulary",
      },
      featureCanon: {
        absent:
          "the creator guard is repository infrastructure and does not add a shipped discern capability",
      },
    },
    members: async () => [...(await import("../tests/temp_dir_authorities.ts"))
      .TEMP_DIR_CREATOR_AUTHORITIES.keys()],
  },
  {
    id: "test-real-delay-boundaries",
    title: "Test real-delay boundaries",
    what:
      "Every genuine JavaScript timer interval in executable tests, with its exact module, enclosing test or helper, operation, and reason a condition or fake clock cannot replace it.",
    source: {
      kind: "module",
      module: "tests/waiting.ts",
      exportName: "TEST_REAL_DELAY_BOUNDARIES",
    },
    guards: ["tests/test_waiting_guard_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "real test-delay enrollment is a repository development boundary rather than product vocabulary",
      },
      featureCanon: {
        absent:
          "the condition-oriented waiting capability supports this repository and is not part of the shipped discern binary",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../tests/waiting.ts")).TEST_REAL_DELAY_BOUNDARIES,
      ),
  },
  {
    id: "test-shell-wait-boundaries",
    title: "Test shell wait boundaries",
    what:
      "Every elapsed shell wait in executable test source, with its exact enclosing scope, argument, occurrence count, and reviewed polling or timing contract.",
    source: {
      kind: "module",
      module: "tests/test_shell_wait_boundaries.ts",
      exportName: "TEST_SHELL_WAIT_BOUNDARIES",
    },
    guards: ["tests/test_shell_wait_guard_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "shell waiting enrollment is repository test infrastructure rather than product vocabulary",
      },
      featureCanon: {
        absent:
          "the syntax census constrains this repository's tests and is not part of the shipped binary",
      },
    },
    members: async () =>
      (await import("../tests/test_shell_wait_boundaries.ts"))
        .TEST_SHELL_WAIT_BOUNDARIES.map((boundary) =>
          JSON.stringify([boundary.path, boundary.enclosing, boundary.argument])
        ),
  },
  {
    id: "real-pty-contracts",
    title: "Real pseudo-terminal contracts",
    what:
      "The operating-system properties that justify a real pseudo-terminal test; every declared boundary names one or more contracts, and every contract retains a cross-platform canary.",
    source: {
      kind: "module",
      module: "tests/real_pty.ts",
      exportName: "REAL_PTY_CONTRACTS",
    },
    guards: ["tests/real_pty_guard_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "real pseudo-terminal contract enrollment is repository test architecture rather than product vocabulary",
      },
      featureCanon: {
        absent:
          "the contracts govern proof at the host boundary and do not add a shipped discern capability",
      },
    },
    members: async () =>
      Object.keys((await import("../tests/real_pty.ts")).REAL_PTY_CONTRACTS),
  },
  {
    id: "ambient-state-boundaries",
    title: "Ambient process-state boundaries",
    what:
      "Every direct environment or cwd read and mutation retained at a host boundary, with its stable id, exact path, enclosing function, primitive, semantic operation, and reason.",
    source: {
      kind: "module",
      module: "scripts/ambient_state_lint.ts",
      exportName: "AMBIENT_READ_BOUNDARIES",
    },
    guards: ["tests/ambient_state_lint_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "ambient process-state enrollment is an internal architecture boundary rather than user-facing vocabulary",
      },
      featureCanon: {
        absent:
          "the boundary supports every host-facing feature rather than adding a separately selectable capability",
      },
    },
    members: async () => {
      const boundaries = await import("./ambient_state_lint.ts");
      return [
        ...Object.keys(boundaries.AMBIENT_READ_BOUNDARIES).map((id) =>
          `read:${id}`
        ),
        ...Object.keys(boundaries.AMBIENT_MUTATION_BOUNDARIES).map((id) =>
          `mutation:${id}`
        ),
      ];
    },
  },
  {
    id: "clock-primitive-boundaries",
    title: "Clock primitive boundaries",
    what:
      "Every direct wall or monotonic host-clock read, with its stable id, exact path, enclosing function, operation, and reason.",
    source: {
      kind: "module",
      module: "src/shared/clock.ts",
      exportName: "CLOCK_PRIMITIVE_BOUNDARIES",
    },
    guards: [
      "tests/ambient_state_lint_test.ts",
      "tests/clock_scheduler_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "clock primitive enrollment is an internal architecture boundary rather than user-facing vocabulary",
      },
      featureCanon: {
        absent:
          "the clock capability supports time-aware features rather than adding a separately selectable capability",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/clock.ts"))
          .CLOCK_PRIMITIVE_BOUNDARIES,
      ),
  },
  {
    id: "scheduler-primitive-boundaries",
    title: "Scheduler primitive boundaries",
    what:
      "Every direct timeout or interval schedule and cancellation operation in the Deno and browser system adapters, with its stable id, exact path, enclosing function, operation, and reason.",
    source: {
      kind: "module",
      module: "src/shared/scheduler.ts",
      exportName: "SCHEDULER_PRIMITIVE_BOUNDARIES",
    },
    guards: [
      "tests/ambient_state_lint_test.ts",
      "tests/clock_scheduler_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "scheduler primitive enrollment is an internal architecture boundary rather than user-facing vocabulary",
      },
      featureCanon: {
        absent:
          "the scheduler capability supports asynchronous lifecycles rather than adding a separately selectable capability",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/scheduler.ts"))
          .SCHEDULER_PRIMITIVE_BOUNDARIES,
      ),
  },
  {
    id: "scheduling-jitter-boundaries",
    title: "Scheduling-jitter boundaries",
    what:
      "Every direct pseudo-random read retained for non-security scheduling variation, with its stable id, exact path, enclosing function, operation, and reason.",
    source: {
      kind: "module",
      module: "src/shared/scheduler.ts",
      exportName: "JITTER_PRIMITIVE_BOUNDARIES",
    },
    guards: [
      "tests/ambient_state_lint_test.ts",
      "tests/clock_scheduler_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "scheduling-jitter enrollment is an internal architecture boundary rather than user-facing vocabulary",
      },
      featureCanon: {
        absent:
          "bounded scheduling variation supports fleet coordination rather than adding a separately selectable capability",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/scheduler.ts"))
          .JITTER_PRIMITIVE_BOUNDARIES,
      ),
  },
  {
    id: "secure-entropy-primitive-boundaries",
    title: "Secure-entropy primitive boundaries",
    what:
      "Every direct WebCrypto UUID or byte-fill operation retained by the system secure-entropy adapter, with its stable id, exact path, enclosing function, primitive, required security property, and reason.",
    source: {
      kind: "module",
      module: "src/shared/entropy.ts",
      exportName: "SECURE_ENTROPY_PRIMITIVE_BOUNDARIES",
    },
    guards: [
      "tests/ambient_state_lint_test.ts",
      "tests/secure_entropy_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "secure-entropy primitive enrollment is an internal security boundary rather than user-facing vocabulary",
      },
      featureCanon: {
        absent:
          "secure entropy supports identities and secrets rather than adding a separately selectable capability",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/entropy.ts"))
          .SECURE_ENTROPY_PRIMITIVE_BOUNDARIES,
      ),
  },
  {
    id: "best-effort-boundaries",
    title: "Error-discard boundaries",
    what:
      "Every named production error discard, with its exact module, enclosing function, operation, shape, observability policy, and reason.",
    source: {
      kind: "module",
      module: "src/shared/best_effort.ts",
      exportName: "BEST_EFFORT_BOUNDARIES",
    },
    guards: [
      "tests/best_effort_test.ts",
      "tests/best_effort_guard_test.ts",
      "tests/silent_catch_lint_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "error-discard enrollment is an internal reliability policy rather than user-facing product vocabulary",
      },
      featureCanon: {
        absent:
          "the boundary registry supports every feature's error semantics rather than adding a separately selectable capability",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/best_effort.ts"))
          .BEST_EFFORT_BOUNDARIES,
      ),
  },
  {
    id: "detached-promise-boundaries",
    title: "Detached promise boundaries",
    what:
      "Every registered promise effect transferred beyond its caller's sequence, with its exact module, enclosing function, operation, lifecycle owner, rejection policy, cancellation ownership, and reason.",
    source: {
      kind: "module",
      module: "src/shared/promise_effects.ts",
      exportName: "DETACHED_PROMISE_BOUNDARIES",
    },
    guards: ["tests/promise_effects_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "promise-effect ownership is an internal reliability policy rather than user-facing product vocabulary",
      },
      featureCanon: {
        absent:
          "the detachment boundary supports asynchronous feature lifecycles rather than adding a separately selectable capability",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../src/shared/promise_effects.ts"))
          .DETACHED_PROMISE_BOUNDARIES,
      ),
  },
  {
    id: "tool-temp-directory-kinds",
    title: "Tool temp-directory kinds",
    what:
      "Every callback-scoped scratch directory used by a standalone repository tool, with its stable id, secure prefix, purpose, and cleanup policy.",
    source: {
      kind: "module",
      module: "scripts/temp_dir.ts",
      exportName: "TOOL_TEMP_DIR_KINDS",
    },
    guards: [
      "tests/tool_temp_dir_test.ts",
      "tests/temp_dir_guard_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "tool scratch lifetimes are a repository development convention rather than user-facing product terminology",
      },
      featureCanon: {
        absent:
          "the tooling capability supports this repository and is not part of the shipped discern binary",
      },
    },
    members: async () =>
      Object.keys((await import("./temp_dir.ts")).TOOL_TEMP_DIR_KINDS),
  },
  {
    id: "test-temp-directory-ownership-modes",
    title: "Test temp-directory ownership modes",
    what:
      "Every supported lifetime for a temporary directory created by tests or executable fixtures, with its cleanup boundary and reason.",
    source: {
      kind: "module",
      module: "tests/temp_dir.ts",
      exportName: "TEMP_DIR_OWNERSHIP_POLICIES",
    },
    guards: [
      "tests/temp_dir_test.ts",
      "tests/temp_dir_guard_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "these callback and module lifetimes are repository-local test infrastructure policy",
      },
      featureCanon: {
        absent:
          "test fixture cleanup is a repository development convention, not a shipped discern feature",
      },
    },
    members: async () =>
      Object.keys(
        (await import("../tests/temp_dir.ts")).TEMP_DIR_OWNERSHIP_POLICIES,
      ),
  },
  {
    id: "generated-inventory-policies",
    title: "Generated inventory policies",
    what:
      "The named framing, member-wording authority, renderer, documentation exposure, and tests for every generated inventory.",
    source: {
      kind: "module",
      module: "scripts/generated_inventory_policy.ts",
      exportName: "GENERATED_INVENTORY_POLICIES",
    },
    guards: ["tests/canonical_sets_enrolment_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "inventory framing is an internal projection discipline rather than a public product term",
      },
      featureCanon: {
        absent:
          "the policies govern generated reference framing rather than a separately selectable feature",
      },
    },
    members: async () =>
      Object.keys(
        (await import("./generated_inventory_policy.ts"))
          .GENERATED_INVENTORY_POLICIES,
      ),
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
      ...GENERATED_INVENTORY_POLICIES["canonical-sets"].tests,
      "tests/ssot_claim_guard_test.ts",
    ],
    artifacts: [
      {
        path: GENERATED_INVENTORY_POLICIES["canonical-sets"].artifactPath,
        kind: "generated-file",
        banner: true,
        framingPolicy: "canonical-sets",
      },
    ],
    enrolledIn: {
      glossary: {
        absent:
          "Canonical set is a maintainer discipline documented in the contributor Map; its internal inventory needs no public product term",
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
  "tests/operation_lock_sync_guard_test.ts":
    "pins the operation lock's no-fsync acquisition and release — exclusion comes from the OS handle — rather than guarding a closed member set",
  "tests/progress_surface_parity_test.ts":
    "proves that the terminal, MCP notifications, the operation journal, and nested presenters present one completion fact stream identically rather than guarding a closed member set",
  "tests/test_registration_guard_test.ts":
    "rejects execution-time imports of test-registration modules across authored Deno sources rather than guarding a closed member set",
  "tests/test_elapsed_guard_test.ts":
    "applies timer-ownership review across authored test duration measurements rather than guarding a closed member set",
  "tests/module_loading_guard_test.ts":
    "applies invocation-context isolation to every runtime lazy import and context owner rather than guarding a closed member set",
  "tests/fs_presence_enrolment_test.ts":
    "applies an optional-read ownership rule across the authored Deno universe rather than guarding a closed member set",
  "tests/terminal_boundary_guard_test.ts":
    "applies process, package-import, generic-width, and migration-census rules across the authored terminal-rendering boundary rather than guarding a closed member set",
  "tests/logger_ambient_guard_test.ts":
    "applies a determinism rule across test sources: human-mode Loggers and terminal contexts must be injected, never resolved from the ambient environment",
  "tests/lifecycle_trunk_resolution_guard_test.ts":
    "applies one-shot trunk resolution across lifecycle call sites rather than guarding a closed member set",
  "tests/narration_wrap_guard_test.ts":
    "applies a layout-independence rule across test sources: multi-word phrases asserted on rendered output must compare wrap-insensitively, because narration wraps by content width and platform path lengths shift the break points",
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
  "tests/pre_v1_residue_guard_test.ts":
    "applies an absence rule for retired private-era identifiers and Legacy exports across production source rather than guarding a live member set",
};

/**
 * Codegen write targets that belong to no canonical set, each with the
 * reason. The write chokepoint in `scripts/codegen.ts` refuses any target
 * outside the declared artifacts and this record.
 */
export const UNAFFILIATED_CODEGEN_TARGETS: Readonly<Record<string, string>> = {
  "site/pages/assets/search.js":
    "copies the single `src/lib/docs_search.js` module into the browser asset",
  "templates/skills/discern-write-adr/skeleton/map/_adr/0000-template.md":
    "copies the authored setup-skeleton ADR template into the write-adr skill",
  "templates/skills/discern-write-adr/skeleton/map/_adr/0001-adopt-discern.md":
    "copies the authored setup-skeleton adoption record into the write-adr skill",
  "templates/skills/discern-write-adr/skeleton/map/_adr/README.md":
    "copies the authored setup-skeleton ADR format guide into the write-adr skill",
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
  "src/lib/providers.ts":
    "the total-record satellite of the enrolled agent-providers set: AGENT_NAMES is the member axis, and tests/agent_parity_test.ts holds the record total per member",
  "src/lib/version.ts":
    "the discern version constant is one value with no member axis or satellites",
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

/** Paths whose naming convention makes them generated inventory surfaces. */
function isGeneratedInventoryPath(path: string): boolean {
  return /(?:inventory|registry-atlas)\.md$/.test(path);
}

/**
 * Structural forcing function for generated inventories. A future inventory
 * path must name one shared policy, and that policy must tie its member wording,
 * renderer, documentation exposure, and tests back to its canonical-set owner.
 */
export function inventoryProjectionOffenders(
  entries: readonly CanonicalSetEntry[],
  policies: Readonly<Record<string, GeneratedInventoryPolicy>>,
): string[] {
  const offenders: string[] = [];
  const claimed = new Set<string>();
  for (const entry of entries) {
    for (const artifact of entry.artifacts) {
      if (!isGeneratedInventoryPath(artifact.path)) continue;
      if (artifact.kind !== "generated-file") {
        offenders.push(
          `${artifact.path}: an inventory must be a generated file`,
        );
        continue;
      }
      const policyId = artifact.framingPolicy;
      if (policyId === undefined || !Object.hasOwn(policies, policyId)) {
        offenders.push(
          `${artifact.path}: generated inventory has no declared framing policy`,
        );
        continue;
      }
      claimed.add(policyId);
      const policy = policies[policyId];
      if (policy === undefined) continue;
      if (policy.artifactPath !== artifact.path) {
        offenders.push(
          `${artifact.path}: policy ${policyId} names a different artifact`,
        );
      }
      if (policy.documentation !== artifact.path) {
        offenders.push(
          `${artifact.path}: policy ${policyId} does not expose this documentation`,
        );
      }
      if (
        policy.framing.length === 0 || policy.title.trim() === "" ||
        policy.subtitle.trim() === ""
      ) {
        offenders.push(
          `${artifact.path}: policy ${policyId} has no complete framing`,
        );
      }
      if (policy.memberWording.kind === "co-located") {
        const sourceMatches = entry.source.kind === "module" &&
          policy.memberWording.module === entry.source.module &&
          policy.memberWording.exportName === entry.source.exportName;
        if (!sourceMatches) {
          offenders.push(
            `${artifact.path}: co-located wording does not name the set source`,
          );
        }
      }
      if (
        policy.tests.length === 0 ||
        policy.tests.some((test) => !entry.guards.includes(test))
      ) {
        offenders.push(
          `${artifact.path}: policy tests are not enrolled as set guards`,
        );
      }
      if (
        policy.renderer.module.trim() === "" ||
        policy.renderer.exportName.trim() === ""
      ) {
        offenders.push(
          `${artifact.path}: policy ${policyId} has no renderer authority`,
        );
      }
    }
  }
  for (const policyId of Object.keys(policies)) {
    if (!claimed.has(policyId)) {
      offenders.push(
        `${policyId}: framing policy is claimed by no generated inventory`,
      );
    }
  }
  return offenders;
}

/** Render path-and-reason exceptions as Markdown bullets. */
function strayLines(record: Readonly<Record<string, string>>): string[] {
  return Object.entries(record).map(
    ([path, reason]) => `- \`${path}\` — ${reason}`,
  );
}

/** Render the atlas page from the live registry. */
export async function renderRegistryAtlasDoc(): Promise<string> {
  const policy = GENERATED_INVENTORY_POLICIES["canonical-sets"];
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
    policy.banner,
    "",
    `# ${policy.title}`,
    "",
    `_${policy.subtitle}_`,
    "",
    ...policy.framing.flatMap((paragraph) => [paragraph, ""]),
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
  lines.push("| Artifact | Kind | Compiled from | Framing policy |");
  lines.push("| --- | --- | --- | --- |");
  for (const { artifact, owner } of artifactRows) {
    const kind = artifact.kind === "generated-file"
      ? "generated file"
      : "maintained block";
    const framing = artifact.kind === "generated-file" &&
        artifact.framingPolicy !== undefined
      ? `\`GENERATED_INVENTORY_POLICIES.${artifact.framingPolicy}\``
      : "—";
    lines.push(
      `| \`${artifact.path}\` | ${kind} | ${setLink(owner)} | ${framing} |`,
    );
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
      for (const artifact of entry.artifacts) {
        if (
          artifact.kind !== "generated-file" ||
          artifact.framingPolicy === undefined
        ) continue;
        const projection = GENERATED_INVENTORY_POLICIES[
          artifact.framingPolicy
        ];
        const wording = projection.memberWording.kind === "co-located"
          ? `co-located at \`${projection.memberWording.module}#${projection.memberWording.exportName}\``
          : `shared policy \`${projection.memberWording.module}#${projection.memberWording.exportName}\``;
        lines.push(
          `- Inventory projection: framing \`GENERATED_INVENTORY_POLICIES.${artifact.framingPolicy}\`; member wording ${wording}; renderer \`${projection.renderer.module}#${projection.renderer.exportName}\`; documentation \`${projection.documentation}\`; tests ${
            pathList(projection.tests)
          }.`,
        );
      }
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
