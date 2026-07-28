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
    id: "dry-run-verbs",
    title: "Dry-run-capable verbs",
    what:
      "Every command path that registers --dry-run — the plan/apply verbs whose preview must be faithful: a dry run writes nothing, and an apply performs nothing the plan never listed.",
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
          "the preview flag is a modality of each verb, documented with the plan/apply split rather than as a term of its own",
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
      "The MCP tool table; verb parity ties every tool to a CLI verb, so the two surfaces cannot drift.",
    source: {
      kind: "module",
      module: "src/engine/mcp/server.ts",
      exportName: "TOOLS",
    },
    guards: [
      "tests/engine_verb_parity_test.ts",
      "tests/result_codegen_test.ts",
      "tests/guidance_corpus_guard_test.ts",
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
    id: "command-groups",
    title: "Command groups",
    what:
      "The named, ordered buckets the top-level verbs render under — the grouping table behind `discern --help` and the generated CLI reference alike, so every visible command has an operator-meaningful home.",
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
          "display grouping over the verb vocabulary; the glossary defines the verbs themselves",
      },
      featureCanon: { nodeId: "bundled-help" },
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
      "The verbs with a `--confirmed` conversation-attestation boundary. The class test proves an authority-free call refuses without writing; accept can also satisfy landing consent through a machine-checked recorded grant.",
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
          "an attestation modality of two verbs, documented on each verb rather than as a term of its own",
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
      "tests/engine_logbook_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "three evidence forms of the landing-consent concept, documented together on the acceptance page",
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
          "two machine outcomes of the documented landing-authority concept",
      },
      featureCanon: { nodeId: "consent-attestations" },
    },
    members: async () => [
      ...(await import("../src/shared/consent.ts")).LANDING_AUTHORITY_KINDS,
    ],
  },
  {
    id: "desk-actions",
    title: "Desk actions",
    what:
      "The operator desk's per-worktree action vocabulary and menu order; the legality table exercises every member, while the runtime test holds each interactive effect boundary.",
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
        absent:
          "menu actions on the human desk, described in place rather than as standalone terms",
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
      "Every Discern-owned Git-admin artifact, including its path, lifetime, shape, and validation-write policy; registry-driven guards automatically enrol each new member in placement and lifecycle checks.",
    source: {
      kind: "module",
      module: "src/shared/git_admin_state.ts",
      exportName: "GIT_ADMIN_STATE",
    },
    guards: [
      "tests/git_admin_state_test.ts",
      "tests/engine_patterns_test.ts",
      "tests/engine_write_preflight_test.ts",
      "tests/engine_effort_grant_test.ts",
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "internal storage vocabulary spanning receipts, measurements, logbook data, and worktree lifecycle state",
      },
      featureCanon: {
        absent:
          "one internal storage registry supports several independently documented product features",
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
      "The result-step operation vocabulary — what a step does; the doctor's annotations table (`STEP_KIND_ANNOTATIONS` in `src/engine/doctor/execution_model.ts`) is a satellite pinned to it, one actor and hint per kind.",
    source: {
      kind: "module",
      module: "src/shared/result.ts",
      exportName: "STEP_KINDS",
    },
    guards: ["tests/execution_model_test.ts", "tests/result_schemas_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "values in each result step; doctor explains every kind in context",
      },
      featureCanon: { nodeId: "doctor" },
    },
    members: async () => [
      ...(await import("../src/shared/result.ts")).STEP_KINDS,
    ],
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
    id: "source-paths",
    title: "Source paths",
    what:
      "The configurable authored-source locations — guidance, map, skills, scripts, todo, brief — the config-pointed half of the one-file footprint, each carrying its config key, default, ownership, and resolution rule.",
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
    ],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "path names are configuration reference material; the config reference documents every key",
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
    id: "authored-commit-sites",
    title: "Discern-authored commit sites",
    what:
      "The workflows whose diffs discern composes and commits: setup wiring, setup completion, and standards pinning. Every member must route through the attributed, pathspec-limited commit boundary.",
    source: {
      kind: "module",
      module: "src/shared/discern_commit.ts",
      exportName: "DISCERN_AUTHORED_COMMIT_SITES",
    },
    guards: ["tests/discern_commit_enrolment_test.ts"],
    artifacts: [],
    enrolledIn: {
      glossary: {
        absent:
          "an internal provenance boundary over existing commands, not product vocabulary",
      },
      featureCanon: {
        absent:
          "cross-cutting commit metadata for setup and standards, not a separate product feature",
      },
    },
    members: async () =>
      Object.values(
        (await import("../src/shared/discern_commit.ts"))
          .DISCERN_AUTHORED_COMMIT_SITES,
      ),
  },
  {
    id: "setup-completion-checks",
    title: "Setup completion checks",
    what:
      "The machine-checkable predicates behind setup's observable progress; each mirrors its setup page's completion-check field, so a resumed session derives what is done from the tree itself.",
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
          "internal predicates behind setup's progress reporting; the setup pages describe each step in prose",
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
      "The `@…@` runtime tokens substituted into a worktree's resource commands from its identity — db, site, port, and kin.",
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
          "substitution vocabulary inside resource commands; the map's worktree-resources pages document each token",
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
    id: "failure-recovery-evidence",
    title: "Generic failure-recovery evidence",
    what:
      "The result fields the generic recovery instruction may truthfully cite; without one, a failure needs a tailored next step.",
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
          "wire-envelope evidence behind the documented advisory contract, not product vocabulary",
      },
      featureCanon: { nodeId: "hints" },
    },
    members: async () => [
      ...(await import("../src/shared/hints.ts")).FAILURE_RECOVERY_EVIDENCE,
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
    id: "detector-families",
    title: "Patterns detector families",
    what:
      "The categories that group every patterns detector and finding; schemas, registry entries, and the human report derive from this vocabulary.",
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
          "internal report grouping; the Patterns entry carries the reader-facing concept",
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
          "presentation metadata inside the patterns result; it is not a user command or product term",
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
      "Every detector the patterns verb runs over the logbook, in stable registry order; the companion vocabulary — families, scopes, tiers, statuses (`src/shared/patterns_vocabulary.ts`) — types each entry, and the parameterized class test fails until a new detector brings fixtures.",
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
      "The improvement catalog's categories, in display order; the runner ranks them weakest-first, and the CLI help and MCP tool interpolate the slugs from the catalog so no category list can drift.",
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
          "category slugs are reference material; every surfaced list derives from the catalog itself",
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
    id: "cli-json-predicates",
    title: "CLI JSON predicate contracts",
    what:
      "The option- and positional-selected predicates whose bare exit status becomes a successful boolean observation under --json.",
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
        absent:
          "invocation modes inside documented commands, not reader-facing vocabulary",
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
        absent:
          "machine-output placements inside documented commands, not product terms",
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
        absent: "boolean test states, not reader-facing product vocabulary",
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
    ],
    enrolledIn: {
      glossary: {
        absent:
          "machine contract locations; the config and result references carry the reader-facing terms",
      },
      featureCanon: { nodeId: "published-contracts" },
    },
    members: async () =>
      (await import("../src/shared/public_schemas.ts"))
        .PUBLIC_SCHEMA_PUBLICATIONS.map((publication) => publication.id),
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
          "machine vocabulary carried by each failure; the surrounding commands and recovery guidance supply reader-facing terms",
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
          "wire-level states whose plain-language meanings are shown directly with each executed step",
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
    id: "docs-workflow-directives",
    title: "Docs Workflow directives",
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
          "internal Markdown projection labels, not reader-facing product vocabulary",
      },
      featureCanon: { nodeId: "bundled-help" },
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
      "tests/improve_count_adrs_test.ts",
    ],
    // The maintained ADR index (project/map/_adr/README.md) is not a codegen
    // artifact: `discern refresh` maintains it in ANY project, and the
    // gate's adr_index currency precondition holds it to the records on disk.
    artifacts: [],
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
      "Retired commands, retired config keys, dead config positions, and synonym redirects — the vocabulary the CLI redirects or refuses rather than accepts.",
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
          "redirect data for retired words; live vocabulary lives in the glossary proper",
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
    id: "seeded-gotchas-traps",
    title: "Seeded gate traps",
    what:
      "The stack-independent gate traps seeded into every project's gotchas doc; the repository's own gotchas page must carry the same inventory, and the seeded trap matchers must keep matching the engine's real failure evidence.",
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
        absent: "seeded documentation content, not product vocabulary",
      },
      featureCanon: { nodeId: "gotchas-pointer" },
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
    id: "authored-ts-universe",
    title: "Authored-TypeScript universe",
    what:
      "The top-level trees holding authored TypeScript — the universe every repo-wide structural sweep derives its scan set from. Members are the stable roots; the file-level list (`AUTHORED_TS_FILES`, the export sweeps consume) is git-derived at import time and moves with every commit, so the roots are the meaningful atlas count.",
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
          "this repository's internal scan universe, not product vocabulary",
      },
      featureCanon: {
        absent:
          "guard infrastructure for this repository's own sweeps, not a product feature",
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
      "Every src/lib validator of a config-resolved authored artifact (the map, guidance sources, skills, project scripts, ADR records), each proven wired into a shipped surface or recorded repo-local with the reason — so a check written for every project cannot end up applied only by this repository's tests.",
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
          "an internal enforcement-parity contract, not product vocabulary",
      },
      featureCanon: {
        absent:
          "guard infrastructure for this repository's own wiring, not a product feature",
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
  "tests/agent_policy_parity_test.ts":
    "asserts the two authored operating-model surfaces carry the same policies; a prose-parity contract, not a member-set satellite",
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
    "site build infrastructure: the route-bundle table drives this repository's site build alone and ships to no project",
  "src/engine/gate/receipt_render.ts":
    "the claim announces a derive-once rule — the receipt reads the result envelope, never recomputes — not a member set",
  "src/engine/worktree/side_restrictions.ts":
    "candidate for enrolment: a true registry of every side-restricted lifecycle operation, whose class test (tests/engine_worktree_test.ts) is named outside the guard convention",
  "src/lib/paths.ts#BUNDLED_DOCS_STAGE_DIR":
    "a single staging-directory name shared by the build writer and the bundled-docs reader — one value, not a member set",
  "src/lib/providers.ts":
    "the total-record satellite of the enrolled agent-providers set: AGENT_NAMES is the member axis, and tests/agent_parity_test.ts holds the record total per member",
  "src/lib/version.ts":
    "the kit version constant: a single value with no members and no satellites of its own to drift",
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

function sourceCell(source: SetSource): string {
  if (source.kind === "module") {
    return `\`${source.module}#${source.exportName}\``;
  }
  return `\`${source.path}\` (authored)`;
}

function glossaryCell(enrolment: GlossaryEnrolment): string {
  if ("term" in enrolment) return `"${enrolment.term}"`;
  if ("perMember" in enrolment) return "per member";
  return "—";
}

function canonCell(enrolment: CanonEnrolment): string {
  if ("surfaceSet" in enrolment) return `surface \`${enrolment.surfaceSet}\``;
  if ("nodeId" in enrolment) return `node \`${enrolment.nodeId}\``;
  return "—";
}

function strayLines(record: Readonly<Record<string, string>>): string[] {
  return Object.entries(record).map(
    ([path, reason]) => `- \`${path}\` — ${reason}`,
  );
}

/** Render the atlas page from the live registry. */
export async function renderRegistryAtlasDoc(): Promise<string> {
  const memberCounts = new Map<string, number>();
  for (const entry of CANONICAL_SETS) {
    const members = await resolveSetMembers(entry);
    if (members !== undefined) memberCounts.set(entry.id, members.length);
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
    "_Every canonical set — source, guards, artifacts, and enrolments — generated from the meta-registry._",
    "",
    "To add a set, declare it in `scripts/canonical_sets.ts`; the enrolment guard (`tests/canonical_sets_enrolment_test.ts`) holds every conventionally named guard test and codegen target to a declared owner, and the claim sweep (`tests/ssot_claim_guard_test.ts`) holds every module claiming single-source-of-truth status to the same bar: a declared source, or a recorded absence.",
    "",
    "## The sets at a glance",
    "",
    "One row per set, in registry order; the sections below follow the same order and carry the full account. Member counts resolve from each set's single source at generation time; an authored table shows a dash. Under Glossary and Feature canon, a dash marks a recorded absence, and the set's section carries the reason.",
    "",
    "| Set | Source | Members | Glossary | Feature canon |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const entry of CANONICAL_SETS) {
    const count = memberCounts.get(entry.id);
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
    `Alphabetical by test file; a test holding several sets fails when any one of them drifts. The [unaffiliated records](#${
      headingAnchor("Unaffiliated, with reasons")
    }) account for conventionally named tests holding none.`,
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
    "Alphabetical by path. `deno task codegen` rewrites a generated file whole; a maintained block sits between markers inside an authored page.",
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
    const count = memberCounts.get(entry.id);
    lines.push(`## ${setHeading(entry)}`);
    lines.push("");
    lines.push(entry.what);
    lines.push("");
    lines.push(sourceLine(entry.source));
    lines.push(`- Members: ${count === undefined ? "—" : count}`);
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
    "Recorded strays the convention sweeps accept. Each subsection names the record that accepts its kind; a new stray belongs there, with its reason.",
  );
  lines.push("");
  lines.push("### Guard tests holding no member set");
  lines.push("");
  lines.push(
    "Conventionally named guard tests with no set to hold, recorded in `UNAFFILIATED_GUARDS`.",
  );
  lines.push("");
  lines.push(...strayLines(UNAFFILIATED_GUARDS));
  lines.push("");
  lines.push("### Codegen targets compiling from no registry");
  lines.push("");
  lines.push(
    "Write targets recorded in `UNAFFILIATED_CODEGEN_TARGETS`; the write chokepoint in `scripts/codegen.ts` refuses any target outside the declared artifacts and that record.",
  );
  lines.push("");
  lines.push(...strayLines(UNAFFILIATED_CODEGEN_TARGETS));
  lines.push("");
  lines.push("### Single-source claims anchoring no set");
  lines.push("");
  lines.push(
    "Modules whose doc comments claim single-source-of-truth status without anchoring a declared entry, recorded in `UNAFFILIATED_SETS`.",
  );
  lines.push("");
  lines.push(...strayLines(UNAFFILIATED_SETS));
  lines.push("");
  return lines.join("\n");
}
