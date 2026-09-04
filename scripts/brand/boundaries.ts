/**
 * The Boundary Canon's single authority. One conceptual boundary may project
 * into one or more behavioral refusals, mistaken-identity discriminators,
 * and structural absences. The projections compile from this registry so
 * overlap stays intentional without creating three independently maintained
 * lists.
 */

import type { ClaimSlug } from "./claims.ts";
import { type EvidenceSource, evidenceSourceLabel } from "./model.ts";

/** How strongly one boundary is intended to persist. */
export const BOUNDARY_STABILITIES = [
  "enduring",
  "edition",
  "implementation",
] as const;

export type BoundaryStability = (typeof BOUNDARY_STABILITIES)[number];

/** A behavioral-refusal or structural-absence projection. */
export interface BoundaryProjection {
  readonly order: number;
  readonly id: string;
  readonly title: string;
  readonly statement: string;
}

/** A category people may put discern in, plus the fact that rules it out. */
export interface MistakenIdentity {
  readonly order: number;
  readonly id: string;
  readonly title: string;
  readonly discriminatingFact: string;
}

/** One conceptual product boundary and any public projections it owns. */
export interface ProductBoundary<Slug extends string = string> {
  readonly id: string;
  readonly title: string;
  readonly stability: BoundaryStability;
  readonly scope: string;
  readonly qualification?: string;
  /** Required for edition and implementation properties. */
  readonly horizon?: string;
  readonly claims?: readonly [Slug, ...Slug[]];
  readonly evidence: readonly [EvidenceSource, ...EvidenceSource[]];
  readonly refusals?: readonly [BoundaryProjection, ...BoundaryProjection[]];
  readonly identities?: readonly [MistakenIdentity, ...MistakenIdentity[]];
  readonly absences?: readonly [BoundaryProjection, ...BoundaryProjection[]];
}

/**
 * The product's conceptual boundaries. Declaration order is record order;
 * each projection keeps that order within its own generated section.
 */
export const BOUNDARIES = [
  {
    id: "landing-authority",
    title: "Landing authority",
    stability: "enduring",
    scope:
      "Every `accept` operation, including work with a current declared-unmet checkpoint conclusion.",
    qualification:
      "Ordinary landing authority may come from the current conversation or a recorded grant. A variance requires conversation consent for the exact declared-unmet set; standing and effort grants never cover it.",
    claims: ["gate-grants-no-authority"],
    evidence: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md",
        summary: "defines the machine-checked grant model",
      },
      {
        kind: "guard",
        path: "tests/engine_accept_authority_test.ts",
        summary: "exercises every landing-authority source end to end",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md",
        summary: "binds variances to conversation consent and current evidence",
      },
      {
        kind: "guard",
        path: "tests/engine_checkpoints_accept_test.ts",
        summary: "rejects grants and incomplete decisions for variances",
      },
    ],
    refusals: [{
      order: 1,
      id: "authority-before-accept",
      title: "Never lands without authority",
      statement:
        "A green Gate establishes readiness evidence. Landing requires conversation consent or a recorded, machine-checked grant; each declared-unmet checkpoint also requires owner authorization for the current variance set.",
    }],
    identities: [
      {
        order: 12,
        id: "not-a-merge-queue",
        title: "Not a merge queue",
        discriminatingFact:
          "`accept` is a consent-bound fast-forward of the configured local trunk. It provides no hosted queue or scheduling service.",
      },
    ],
  },
  {
    id: "provider-security-boundary",
    title: "Provider security boundary",
    stability: "enduring",
    scope: "The permissions and containment applied to a coding-agent process.",
    qualification:
      "Provider integrations may add narrow operational rules, such as Codex's git add and git commit command prefixes. They do not make discern a general permission system or extend a provider's own sandbox.",
    evidence: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0193-discern-does-not-enforce-the-vendor-security-boundary.md",
        summary: "places the security boundary with the coding-agent provider",
      },
      {
        kind: "guard",
        path: "tests/engine_env_plumbing_test.ts",
        summary:
          "holds the shipped Claude settings seed to hooks alone, with no permission rule",
      },
      {
        kind: "source",
        path: "src/lib/providers.ts",
        summary: "owns provider-specific integration rules",
      },
    ],
    refusals: [{
      order: 2,
      id: "no-general-agent-restriction",
      title: "Does not restrict the agent",
      statement:
        "discern supplies no general command filter, blocklist, or permission model. The coding-agent provider owns that boundary.",
    }],
    identities: [
      {
        order: 16,
        id: "not-a-sandbox",
        title: "Not a sandbox or safety layer",
        discriminatingFact:
          "It disciplines project work; it does not contain the process doing that work.",
      },
      {
        order: 15,
        id: "not-a-security-scanner",
        title: "Not a security scanner",
        discriminatingFact:
          "It runs analysis the project configures and contributes no security-analysis engine of its own.",
      },
    ],
  },
  {
    id: "evidence-kind-separation",
    title: "Evidence-kind separation",
    stability: "enduring",
    scope:
      "Machine results, agent declarations, and owner authority carried through the Gate, Proof, and acceptance.",
    qualification:
      "A coding agent may use a model to judge a checkpoint question. discern checks that a current declaration exists and binds to its matched change; it never checks the semantic truth of the conclusion.",
    claims: ["no-model-inside"],
    evidence: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0293-checkpoint-declarations-interlock-the-gate.md",
        summary: "separates machine results from agent declarations",
      },
      {
        kind: "source",
        path: "src/engine/gate/execute.ts",
        summary: "computes the Gate from declared jobs and checks",
      },
      {
        kind: "guard",
        path: "tests/engine_checkpoints_gate_test.ts",
        summary: "holds declarations as a distinct Proof evidence row",
      },
    ],
    refusals: [{
      order: 3,
      id: "never-verifies-agent-judgment",
      title: "Never presents agent judgment as verification",
      statement:
        "A checkpoint may require the coding agent to declare a question met or unmet. discern verifies the declaration's presence and binding, then records the conclusion as agent evidence without verifying its semantic truth.",
    }],
    identities: [
      {
        order: 3,
        id: "not-an-ai-code-reviewer",
        title: "Not an AI code reviewer",
        discriminatingFact:
          "The coding agent judges checkpoint questions. discern serves them from deterministic triggers, records the declarations, and performs no model inference.",
      },
    ],
    absences: [{
      order: 1,
      id: "no-model-inside",
      title: "No model inside",
      statement:
        "discern performs no inference and needs no model API key or inference token budget. Any model used to judge a checkpoint belongs to the coding agent.",
    }],
  },
  {
    id: "non-authoring-system",
    title: "Non-authoring system",
    stability: "enduring",
    scope: "Application and domain code in the project using discern.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0170-file-ownership-is-registry-data.md",
        summary:
          "defines artifact ownership rather than application authorship",
      },
      {
        kind: "guard",
        path: "tests/artifact_ownership_test.ts",
        summary: "holds ownership classifications for managed artifacts",
      },
    ],
    refusals: [{
      order: 4,
      id: "writes-no-application-code",
      title: "Writes no application code",
      statement:
        "discern conditions the work of code-writing tools; it does not generate the project's application code.",
    }],
    identities: [
      {
        order: 4,
        id: "not-a-coding-agent",
        title: "Not a coding agent or copilot",
        discriminatingFact:
          "It is the practice coding agents work inside. Application authorship remains with coding tools.",
      },
      {
        order: 19,
        id: "not-an-app-scaffolder",
        title: "Not a scaffolder or boilerplate kit",
        discriminatingFact:
          "It scaffolds a development practice and leaves the application shape alone.",
      },
      {
        order: 23,
        id: "not-spec-driven-codegen",
        title: "Not spec-driven development tooling",
        discriminatingFact:
          "It does not generate application code from specifications; it governs how any resulting work proves itself.",
      },
    ],
  },
  {
    id: "project-owned-quality",
    title: "Project-owned quality judgment",
    stability: "enduring",
    scope:
      "Application architecture, style, tests, builds, analysis, and other project-owned checks.",
    qualification:
      "discern is opinionated about agent-development practice: isolated work, declared checks, evidence, authority, retained Standards, and shipped checkpoint questions are product choices. Checkpoint defaults become project policy through committed `discern.toml`; the owner can override or remove them.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0168-the-gate-declares-jobs.md",
        summary: "makes the project's command table the Gate authority",
      },
      {
        kind: "source",
        path: "src/shared/config_schema.ts",
        summary: "defines project-owned jobs, Standards, and checkpoint policy",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0303-the-shipped-checkpoint-set.md",
        summary: "limits shipped questions to agent-development practice",
      },
      {
        kind: "guard",
        path: "tests/checkpoints_builtins_test.ts",
        summary: "holds the shipped checkpoint set and its defaults",
      },
    ],
    refusals: [{
      order: 5,
      id: "no-application-taste",
      title: "Holds no application taste of its own",
      statement:
        "discern runs configured tools and serves recorded checkpoint questions. It adds no unstated rule about application architecture or style.",
    }],
    identities: [
      {
        order: 9,
        id: "not-a-linter-formatter",
        title: "Not a linter or formatter",
        discriminatingFact:
          "It runs the project's tools and ships no rules for application code.",
      },
      {
        order: 10,
        id: "not-a-test-framework",
        title: "Not a test framework",
        discriminatingFact:
          "It invokes the project's suite and owns the verdict protocol around it. The project owns the testing model.",
      },
      {
        order: 13,
        id: "not-a-build-system",
        title: "Not a build system",
        discriminatingFact:
          "It defines no application build graph or build-artifact cache; jobs remain the project's commands.",
      },
      {
        order: 14,
        id: "not-code-quality-saas",
        title: "Not code-quality SaaS",
        discriminatingFact:
          "Standards are repository-owned ratchets, without a hosted dashboard or vendor grade.",
      },
    ],
  },
  {
    id: "owner-chosen-standard-limits",
    title: "Owner-chosen Standard limits",
    stability: "enduring",
    scope: "Every Standard limit and every change to one.",
    qualification:
      "Shipped checkpoint trigger thresholds are configurable starting policy. Standard limits are separate measured ratchets chosen by the owner.",
    evidence: [
      {
        kind: "source",
        path: "src/engine/gate/standard_limits.ts",
        summary: "validates the configured direction and limit",
      },
      {
        kind: "guard",
        path: "tests/engine_standards_pin_test.ts",
        summary: "proves an invoked pin records the measured value",
      },
    ],
    refusals: [{
      order: 6,
      id: "never-picks-standard-limits",
      title: "Never picks your Standard limits",
      statement:
        "discern may propose a ratchet and can pin a measured value when invoked. Choosing to set or move a Standard limit remains the owner's act.",
    }],
  },
  {
    id: "non-loosening-standards",
    title: "Non-loosening Standards",
    stability: "enduring",
    scope: "Every firing Standard compared with its value on the trunk.",
    claims: ["standards-cannot-loosen", "pin-measured-gains"],
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0133-standards-join-the-gate.md",
        summary: "makes ratchets part of completion",
      },
      {
        kind: "guard",
        path: "tests/engine_gate_standards_test.ts",
        summary: "rejects loosened or removed limits",
      },
    ],
    refusals: [{
      order: 7,
      id: "never-loosens-to-pass",
      title: "Never loosens to pass",
      statement:
        "A firing Standard is never relaxed automatically. Moving the boundary is an owner-reviewed change on the trunk.",
    }],
  },
  {
    id: "exact-tree-proof",
    title: "Exact-tree Proof",
    stability: "enduring",
    scope:
      "Every durable Proof, the commit it names, and the checkpoint declaration evidence it records.",
    qualification:
      "A changed checkpoint conclusion or rationale stales Proof at an unchanged `HEAD`; the commit and declaration-evidence identity must both remain current.",
    claims: ["proof-exact-tree"],
    evidence: [
      {
        kind: "source",
        path: "project/map/20-quality-gate/the-proof.md",
        summary: "defines Proof for one clean committed tree",
      },
      {
        kind: "guard",
        path: "tests/engine_proof_render_test.ts",
        summary: "holds the commit-bound Proof projection",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md",
        summary: "adds declaration evidence to Proof currency",
      },
      {
        kind: "guard",
        path: "tests/gate_proof_evidence_test.ts",
        summary: "stales Proof when declaration evidence changes",
      },
    ],
    refusals: [{
      order: 8,
      id: "no-proof-for-dirty-tree",
      title: "No Proof for a dirty tree",
      statement:
        "discern refuses ‘mostly done’. Durable Proof binds to one clean, committed `HEAD` and its current checkpoint declaration evidence; without both, no valid Proof exists.",
    }],
  },
  {
    id: "mechanical-update",
    title: "Mechanical update",
    stability: "enduring",
    scope:
      "Bringing the configured trunk or an explicit base into an effort branch.",
    evidence: [
      {
        kind: "source",
        path: "src/engine/worktree/git.ts",
        summary: "performs the merge and reports semantic overlap",
      },
      {
        kind: "guard",
        path: "tests/engine_update_summary_test.ts",
        summary: "holds overlap reporting and continuation instructions",
      },
    ],
    refusals: [{
      order: 9,
      id: "never-resolves-meaning",
      title: "Never resolves meaning",
      statement:
        "`update` merges mechanically and reports semantic overlap. The agent and owner decide what an overlap means.",
    }],
  },
  {
    id: "local-git-landing",
    title: "Local Git landing",
    stability: "edition",
    scope: "Git transport and landing in the local edition.",
    qualification:
      "Proof fetch mode may add remote fetch configuration so another workflow can fetch Proof notes. It does not start that fetch or configure push.",
    horizon:
      "A team edition may add a remote workflow, with its authority and transport boundaries stated separately.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0110-the-landing-model.md",
        summary: "defines local fast-forward landing",
      },
      {
        kind: "source",
        path: "src/engine/gate/proof_notes.ts",
        summary: "adds Proof-note fetch configuration without fetching",
      },
      {
        kind: "guard",
        path: "tests/engine_accept_gate_test.ts",
        summary: "exercises local acceptance",
      },
    ],
    refusals: [{
      order: 10,
      id: "does-not-touch-remotes",
      title: "Does not touch remotes",
      statement:
        "discern does not push, fetch, or open pull requests. `accept` fast-forwards the configured local trunk; hosting remains a separate workflow.",
    }],
    identities: [
      {
        order: 11,
        id: "not-a-git-wrapper",
        title: "Not a Git wrapper or new VCS",
        discriminatingFact:
          "It uses ordinary branches, worktrees, refs, commits, and fast-forwards; Git can inspect every project state it creates.",
      },
    ],
    absences: [{
      order: 10,
      id: "no-shadow-vcs",
      title: "No shadow VCS",
      statement:
        "discern has no custom object store. Bounded recovery refs and Proof notes are ordinary Git objects.",
    }],
  },
  {
    id: "agent-runtime-boundary",
    title: "Agent runtime boundary",
    stability: "enduring",
    scope:
      "Model execution, task allocation, and coding-agent client sessions.",
    qualification:
      "The Desk can start configured coding-agent clients, owns those child processes while open, and `await` coordinates repository state. Neither feature chooses a model or allocates work autonomously.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0157-the-desk-owns-launched-child-sessions.md",
        summary: "defines the Desk's bounded child-process ownership",
      },
      {
        kind: "guard",
        path: "tests/engine_desk_runtime_test.ts",
        summary: "holds configured client launch and lifetime behavior",
      },
    ],
    refusals: [{
      order: 11,
      id: "never-allocates-agent-work",
      title: "Does not allocate work to agents",
      statement:
        "discern supplies no model runtime, model scheduler, autonomous task router, or vendor fleet control plane.",
    }],
    identities: [
      {
        order: 5,
        id: "not-an-agent-framework",
        title: "Not an agent framework",
        discriminatingFact:
          "There is no chain runtime or SDK to embed in application code; discern installs into the repository.",
      },
      {
        order: 6,
        id: "not-a-fleet-orchestrator",
        title: "Not a fleet orchestrator",
        discriminatingFact:
          "It coordinates repository evidence and may open configured clients, but it does not choose, route, or schedule the fleet's work.",
      },
    ],
  },
  {
    id: "worker-neutral-measurement",
    title: "Worker-neutral measurement",
    stability: "enduring",
    scope:
      "Logbook, Stats, Patterns, and checkpoint economics about project work.",
    qualification:
      "Checkpoint observations report firings, conclusions, revisions, elapsed time, and variances as project-policy economics. Hygiene readers recommend changes to the trigger, question, or mode and make no claim about agent diligence.",
    claims: ["local-logbook", "patterns-compare-cohorts"],
    evidence: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0229-practice-stats-are-counted-local-and-never-comparative.md",
        summary: "limits Stats to local counts and durations",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0244-brand-addresses-the-owner.md",
        summary: "confines discern's judgment to project work",
      },
      {
        kind: "guard",
        path: "tests/engine_patterns_test.ts",
        summary: "holds bounded cohort facts and project recommendations",
      },
      {
        kind: "guard",
        path: "tests/stats_test.ts",
        summary: "holds the Stats calculations and dimensions",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0300-checkpoint-observation-is-drained-metadata-never-a-verdict.md",
        summary: "confines checkpoint economics to policy fit",
      },
      {
        kind: "guard",
        path: "tests/checkpoint_observation_boundary_test.ts",
        summary: "keeps observed history outside checkpoint decisions",
      },
    ],
    refusals: [{
      order: 12,
      id: "never-grades-workers",
      title: "Does not grade agents or people",
      statement:
        "discern may compare bounded project cohorts; it produces no productivity grade, model leaderboard, or score for a worker.",
    }],
    identities: [
      {
        order: 17,
        id: "not-llm-observability-evals",
        title: "Not LLM observability or model evaluation",
        discriminatingFact:
          "The Logbook records project events and checkpoint economics; Patterns derives bounded project facts. They record no model trace and produce no score for model behavior.",
      },
    ],
  },
  {
    id: "owner-bypass",
    title: "Owner bypass",
    stability: "enduring",
    scope: "The owner's access to Git and the shell outside discern.",
    evidence: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0193-discern-does-not-enforce-the-vendor-security-boundary.md",
        summary: "keeps control with the coding-agent provider and operator",
      },
      {
        kind: "guard",
        path: "tests/engine_hooks_test.ts",
        summary: "covers explicit project hooks without installing Git hooks",
      },
    ],
    refusals: [{
      order: 13,
      id: "never-unbypassable",
      title: "Does not seize control",
      statement:
        "discern seizes no Git hook and wraps no shell command. The owner can always use raw Git because authority remains human.",
    }],
    identities: [
      {
        order: 2,
        id: "not-a-precommit-manager",
        title: "Not a pre-commit-hook manager",
        discriminatingFact:
          "It installs no Git hooks. Its unit is the effort lifecycle; no commit-time lint pass is added.",
      },
    ],
    absences: [{
      order: 13,
      id: "no-git-hooks-installed",
      title: "No Git hooks installed",
      statement:
        "discern tolerates project Git hooks and installs none of its own. Provider lifecycle hooks are a separate coding-agent integration.",
    }],
  },
  {
    id: "artifact-ownership",
    title: "Artifact ownership",
    stability: "enduring",
    scope:
      "Authored sources, generated artifacts, and explicit transformations.",
    qualification:
      "Owner-invoked `tidy` can rewrite supported authored files, and configured fix jobs may do the same. Regeneration ownership stays with generated artifacts.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0170-file-ownership-is-registry-data.md",
        summary: "makes ownership a typed property",
      },
      {
        kind: "source",
        path: "src/engine/tidy/tidy.ts",
        summary: "implements the explicit authored-source formatter",
      },
      {
        kind: "guard",
        path: "tests/artifact_ownership_test.ts",
        summary: "holds writer behavior to ownership",
      },
    ],
    refusals: [{
      order: 14,
      id: "never-regenerates-authored-sources",
      title: "Never regenerates authored sources",
      statement:
        "Machinery overwrites only artifacts it owns. An authored source changes only through an explicit transformation or a project-owned command.",
    }],
  },
  {
    id: "recoverable-destruction",
    title: "Recoverable destruction",
    stability: "enduring",
    scope: "Operations that intentionally drop an effort, branch, or worktree.",
    evidence: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0271-destructive-drops-retain-bounded-recovery-refs.md",
        summary: "requires bounded recovery refs",
      },
      {
        kind: "source",
        path: "src/engine/worktree/recovery_refs.ts",
        summary: "creates and expires recovery refs",
      },
      {
        kind: "guard",
        path: "tests/engine_worktree_drop_test.ts",
        summary:
          "retains a bounded recovery ref before removing the branch and worktree",
      },
    ],
    refusals: [{
      order: 15,
      id: "never-irrecoverably-destroys-work",
      title: "Never destroys work irrecoverably",
      statement:
        "A destructive drop retains a bounded Git recovery ref before removing the ordinary branch or worktree.",
    }],
  },
  {
    id: "invoked-process-lifecycle",
    title: "Invoked process lifecycle",
    stability: "edition",
    scope: "Notifications, watchers, the Desk, and the MCP server.",
    qualification:
      "Provider lifecycle hooks can invoke discern as part of a coding-agent session. The Desk and MCP server live only for the process that opened them.",
    horizon:
      "A future team edition may add an explicitly installed service; the local edition has no resident process.",
    evidence: [
      {
        kind: "source",
        path: "src/engine/mcp/server.ts",
        summary: "runs the MCP surface inside the invoking server process",
      },
      {
        kind: "guard",
        path: "tests/engine_desk_runtime_test.ts",
        summary: "holds Desk child lifetimes to the Desk process",
      },
    ],
    refusals: [{
      order: 16,
      id: "speaks-when-invoked",
      title: "Speaks only when invoked",
      statement:
        "discern has no independent notifier or background nagger. Results and hints arrive in the invoking CLI, MCP, hook, or Desk session.",
    }],
    absences: [{
      order: 6,
      id: "no-daemon",
      title: "No daemon",
      statement:
        "The local edition installs no resident watcher or service. Closing the invoking Desk or coding-agent client ends its live processes.",
    }],
  },
  {
    id: "explicit-upgrades",
    title: "Explicit upgrades",
    stability: "enduring",
    scope: "Product and bundled-content upgrades.",
    evidence: [
      {
        kind: "source",
        path: "src/commands/upgrade.ts",
        summary: "plans and applies the invoked upgrade",
      },
      {
        kind: "guard",
        path: "tests/upgrade_check_test.ts",
        summary: "covers visible upgrade checking and planning",
      },
    ],
    refusals: [{
      order: 17,
      id: "no-silent-self-update",
      title: "Does not update itself without being asked",
      statement:
        "`upgrade` is an explicit act with a visible plan; discern does not replace its binary or bundled content in the background.",
    }],
  },
  {
    id: "map-understanding",
    title: "Map understanding",
    stability: "enduring",
    scope: "Authored Map pages, distinct from generated reference inventories.",
    qualification:
      "Generated CLI, config, feature, and registry references intentionally project code-owned facts. The authored Map records boundaries, intent, and navigation the code cannot express.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0127-map-freshness-ships-file-facts.md",
        summary: "defines current, decision-reducing Map content",
      },
      {
        kind: "guard",
        path: "tests/map_integrity_test.ts",
        summary: "holds generated and authored Map structure",
      },
    ],
    refusals: [{
      order: 18,
      id: "refuses-derivable-map-prose",
      title: "Refuses derivable documentation",
      statement:
        "An authored Map page records what code cannot say. Restating mechanically derivable implementation facts there is a defect.",
    }],
    identities: [
      {
        order: 21,
        id: "not-a-docs-generator",
        title: "Not a docs generator",
        discriminatingFact:
          "The Map is authored understanding held under the Gate, with separate generated references where derivation is useful; it is not extracted API documentation.",
      },
    ],
  },
  {
    id: "credential-boundary",
    title: "Credential boundary",
    stability: "enduring",
    scope:
      "Secrets used by the project, its resources, and coding-agent clients.",
    qualification:
      "Worktree resource setup can copy explicitly selected environment values into a worktree-local environment file. That declares transport and isolation; secret storage and authority remain external.",
    evidence: [
      {
        kind: "source",
        path: "src/engine/worktree/env_file.ts",
        summary: "owns selected environment-value projection",
      },
      {
        kind: "source",
        path: "src/engine/worktree/resources.ts",
        summary: "owns configured per-worktree resources",
      },
      {
        kind: "guard",
        path: "tests/credential_boundary_test.ts",
        summary:
          "keeps credential-shaped environment reads, configuration keys, and credential stores out of the shipped program",
      },
    ],
    refusals: [{
      order: 19,
      id: "does-not-manage-secrets",
      title: "Does not manage secrets",
      statement:
        "discern is not a vault, credential issuer, rotation service, or source of credential authority.",
    }],
    absences: [{
      order: 20,
      id: "no-credential-store",
      title: "No credential store",
      statement:
        "`discern.toml` carries commands and paths. It stores no credential values, and discern maintains no secret database.",
    }],
  },
  {
    id: "non-gamified-practice",
    title: "Non-gamified practice",
    stability: "enduring",
    scope: "Stats, Patterns, the Logbook, and product feedback loops.",
    evidence: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0229-practice-stats-are-counted-local-and-never-comparative.md",
        summary: "rejects grades, rankings, and composite scores",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0244-brand-addresses-the-owner.md",
        summary: "keeps evaluation on project work",
      },
      {
        kind: "guard",
        path: "tests/non_gamified_practice_test.ts",
        summary:
          "keeps score, rank, grade, badge, point, level, and reward fields out of the Patterns result contract",
      },
    ],
    refusals: [{
      order: 20,
      id: "does-not-gamify-practice",
      title: "Does not turn the practice into a game",
      statement:
        "discern awards no streak, badge, point, or composite score. Its feedback loop is evidence and retained standards.",
    }],
  },
  {
    id: "measured-standards",
    title: "Measured Standards",
    stability: "enduring",
    scope: "Every Standard value used by the Gate.",
    evidence: [
      {
        kind: "source",
        path: "src/engine/gate/standards.ts",
        summary: "binds Standard measurements to the Gate Proof",
      },
      {
        kind: "guard",
        path: "tests/engine_standards_replay_test.ts",
        summary: "limits replay to untouched inputs and recorded values",
      },
    ],
    refusals: [{
      order: 21,
      id: "never-guesses-measure",
      title: "Never guesses a measure",
      statement:
        "A Standard replays a recorded value only when its inputs are untouched; otherwise it runs the measurement command. Estimates never enter the verdict.",
    }],
  },
  {
    id: "proof-scope",
    title: "Proof scope",
    stability: "enduring",
    scope: "Every Proof statement and any public inference drawn from it.",
    claims: ["proof-exact-tree", "gate-grants-no-authority"],
    evidence: [
      {
        kind: "source",
        path: "project/map/20-quality-gate/the-proof.md",
        summary: "defines Proof as scoped engineering evidence",
      },
      {
        kind: "source",
        path: "src/engine/gate/proof_render.ts",
        summary: "renders the conditions and commit the Proof covers",
      },
      {
        kind: "guard",
        path: "tests/engine_proof_render_test.ts",
        summary:
          "keeps certifying vocabulary out of every rendered Proof page and line",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md",
        summary: "keeps machine, agent, and owner evidence distinct",
      },
    ],
    refusals: [{
      order: 22,
      id: "does-not-certify-outcome",
      title: "Does not certify the outcome",
      statement:
        "Proof reports which machine conditions held for one commit and which checkpoint conclusions the agent declared. It never certifies that the software is secure, correct, compliant, or finished in every relevant sense.",
    }],
    identities: [
      {
        order: 22,
        id: "not-compliance-audit-product",
        title: "Not a compliance or audit product",
        discriminatingFact:
          "Proof is scoped engineering evidence: machine results, agent declarations, and owner-authorized variances. It carries no regulatory attestation.",
      },
    ],
  },
  {
    id: "pre-share-lifecycle",
    title: "Pre-share lifecycle",
    stability: "enduring",
    scope: "When and where the Gate normally runs.",
    qualification:
      "The same Gate command can also run in CI; that does not make CI the product's operating unit.",
    evidence: [
      {
        kind: "source",
        path: "src/engine/gate/plan.ts",
        summary: "defines the local effort completion sequence",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0110-the-landing-model.md",
        summary: "separates readiness evidence from landing",
      },
    ],
    identities: [
      {
        order: 1,
        id: "not-ci",
        title: "Not CI",
        discriminatingFact:
          "discern runs locally across an effort before work is shared; CI normally verifies a shared change after the fact.",
      },
    ],
  },
  {
    id: "installed-practice",
    title: "Installed practice",
    stability: "enduring",
    scope: "The complete product installed into a repository.",
    claims: ["installs-a-practice", "one-instruction-source"],
    evidence: [
      {
        kind: "source",
        path: "src/commands/setup.ts",
        summary: "installs the repository practice",
      },
      {
        kind: "guard",
        path: "tests/engine_setup_accept_test.ts",
        summary: "holds setup and explicit adoption behavior",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0293-checkpoint-declarations-interlock-the-gate.md",
        summary: "gives checkpoint questions a deterministic refusal boundary",
      },
    ],
    identities: [
      {
        order: 7,
        id: "not-agent-file-generator",
        title: "Not a `CLAUDE.md` generator",
        discriminatingFact:
          "Agent files are one output; the substance is the Gate, worktrees, Standards, Map, Skills, and evidence behind them.",
      },
      {
        order: 8,
        id: "not-a-prompt-pack",
        title: "Not a prompt pack or rules library",
        discriminatingFact:
          "Checkpoint questions are served by deterministic triggers and can stop completion. Standalone prose has no such authority.",
      },
      {
        order: 24,
        id: "not-a-methodology-brand",
        title: "Not a methodology brand",
        discriminatingFact:
          "There are no ceremonies, certifications, or consultants; the practice is installed and enforced in the repository.",
      },
    ],
  },
  {
    id: "committed-project-memory",
    title: "Committed project memory",
    stability: "enduring",
    scope: "Knowledge retained across agent sessions.",
    evidence: [
      {
        kind: "source",
        path: "templates/instructions/map.md",
        summary: "routes durable project understanding into the Map",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0177-compiled-agent-file-opens-as-the-projects-own.md",
        summary: "makes compiled instructions project-owned context",
      },
    ],
    identities: [
      {
        order: 18,
        id: "not-agent-memory-product",
        title: "Not an agent-memory product",
        discriminatingFact:
          "Retention is committed, reviewable text and Git evidence—Map pages, ADRs, instructions, Skills, and the Logbook—not embeddings or hidden conversational state.",
      },
    ],
  },
  {
    id: "evidence-led-improvement",
    title: "Evidence-led improvement",
    stability: "enduring",
    scope: "Suggestions produced by `improvement` and Patterns.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0079-improvement-is-a-coach-not-an-audit.md",
        summary: "defines bounded suggestions rather than work tracking",
      },
      {
        kind: "source",
        path: "src/engine/improve/improve.ts",
        summary: "derives suggestions from repository evidence",
      },
    ],
    identities: [
      {
        order: 20,
        id: "not-project-management",
        title: "Not a project-management tool",
        discriminatingFact:
          "It has no ticket system or backlog; `improvement` suggests a next project change from evidence and does not track the owner's work.",
      },
    ],
  },
  {
    id: "offline-owned-engine",
    title: "Offline discern-owned engine",
    stability: "implementation",
    scope:
      "Network sockets opened by the compiled discern program, across every verb.",
    qualification:
      "discern can run external programs. Explicit install or upgrade distribution, project-owned jobs, checkpoint `when` commands, resources, hooks, and agent clients may use the network under their own permissions.",
    horizon:
      "Adding Deno network permission to the public binary requires an explicit boundary change and a replacement guard.",
    evidence: [
      {
        kind: "source",
        path: "scripts/build.ts",
        summary: "owns the compiled binary's Deno permissions",
      },
      {
        kind: "guard",
        path: "tests/build_distribution_inputs_test.ts",
        summary: "rejects public compile arguments carrying network permission",
      },
      {
        kind: "guard",
        path: "tests/logbook_no_network_test.ts",
        summary: "holds the Logbook module graph free of network APIs",
      },
    ],
    absences: [{
      order: 2,
      id: "no-network-permission",
      title: "No network permission in the public binary",
      statement:
        "The compiled discern program cannot open network sockets. External commands it invokes remain outside this guarantee.",
    }],
  },
  {
    id: "local-private-evidence",
    title: "Local private evidence",
    stability: "enduring",
    scope:
      "Product analytics, crash reporting, checkpoint economics, and repository evidence.",
    claims: ["local-logbook"],
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0160-local-logbook-advisory-readers.md",
        summary: "keeps the Logbook repository-local",
      },
      {
        kind: "guard",
        path: "tests/logbook_no_network_test.ts",
        summary: "holds Logbook readers to local evidence",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0300-checkpoint-observation-is-drained-metadata-never-a-verdict.md",
        summary: "limits checkpoint observation to local metadata",
      },
      {
        kind: "guard",
        path: "tests/engine_checkpoints_observation_test.ts",
        summary: "keeps checkpoint rationales out of every Logbook byte",
      },
    ],
    absences: [{
      order: 3,
      id: "no-telemetry",
      title: "No telemetry",
      statement:
        "discern sends no analytics, crash report, usage event, source, or project evidence to a product service.",
    }],
  },
  {
    id: "accountless-local-edition",
    title: "Local edition without accounts",
    stability: "edition",
    scope: "Identity and hosted services required to use the local edition.",
    horizon:
      "A future multi-machine edition may add accounts or a service; the local edition remains usable without either.",
    evidence: [
      {
        kind: "source",
        path: "src/main.ts",
        summary: "exposes repository-local commands without authentication",
      },
      {
        kind: "source",
        path: "src/shared/env.ts",
        summary: "discovers state from the local repository",
      },
    ],
    absences: [{
      order: 4,
      id: "no-account-or-activation",
      title: "No account or activation",
      statement:
        "The local edition requires no sign-in, license server, or activation identity.",
    }, {
      order: 5,
      id: "no-cloud-backend",
      title: "No cloud service",
      statement:
        "The local edition has no discern-hosted service that must be reachable for the product to work.",
    }],
  },
  {
    id: "application-independent-binary",
    title: "Application-independent binary",
    stability: "enduring",
    scope: "The application dependency graph of a repository using discern.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0019-single-binary-ts-engine.md",
        summary: "ships one self-contained executable",
      },
      {
        kind: "guard",
        path: "tests/release_artifacts_test.ts",
        summary: "holds the released artifact shape",
      },
    ],
    absences: [{
      order: 7,
      id: "no-application-footprint",
      title: "No footprint in the application dependency graph",
      statement:
        "discern is a self-contained binary. It adds no application package, runtime import, lockfile entry, or build dependency.",
    }],
  },
  {
    id: "repository-native-state",
    title: "Repository-native state",
    stability: "enduring",
    scope: "Durable project configuration and evidence owned by discern.",
    qualification:
      "The installed executable, operating-system temporary files, and Git administrative storage are outside the working tree; none is a hidden product database.",
    claims: ["one-config-file"],
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0005-declarative-config.md",
        summary: "makes `discern.toml` the project configuration authority",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0104-uninstall-is-the-exit-honesty-verb.md",
        summary: "defines a clean, inspectable exit",
      },
      {
        kind: "guard",
        path: "tests/engine_uninstall_test.ts",
        summary: "holds removal and retained authored artifacts",
      },
      {
        kind: "source",
        path: "src/engine/checkpoints/open_questions.ts",
        summary: "stores checkpoint state in per-worktree Git administration",
      },
    ],
    absences: [{
      order: 8,
      id: "no-home-state-store",
      title: "No home-directory state store",
      statement:
        "Durable project state stays in the repository and its Git administration. discern maintains no home-directory database or dotfile tree for project state.",
    }, {
      order: 9,
      id: "no-database",
      title: "No database",
      statement:
        "discern stores project configuration and evidence as plain files and ordinary Git objects. It maintains no application database.",
    }, {
      order: 11,
      id: "no-proprietary-formats",
      title: "No proprietary formats",
      statement:
        "Authored and generated product state uses TOML, Markdown, JSON, and Git objects that ordinary tools can inspect.",
    }, {
      order: 12,
      id: "no-lock-in",
      title: "No repository lock-in",
      statement:
        "`uninstall` removes discern's machinery while leaving the repository, authored knowledge, and useful Agent files readable without it.",
    }],
  },
  {
    id: "production-dependency-closure",
    title: "Production dependency closure",
    stability: "implementation",
    scope: "Packages embedded in the released executable.",
    horizon:
      "A newly required runtime dependency may enter only through the product-reachable graph and its license inventory.",
    evidence: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0289-production-binaries-embed-only-product-reachable-npm-packages.md",
        summary: "defines product-reachable dependency closure",
      },
      {
        kind: "guard",
        path: "tests/third_party_notices_test.ts",
        summary: "holds the production dependency and license inventory",
      },
      {
        kind: "guard",
        path: "tests/build_distribution_inputs_test.ts",
        summary: "holds compile-time npm exclusions",
      },
    ],
    absences: [{
      order: 14,
      id: "no-embedded-dead-weight",
      title: "No embedded dead weight",
      statement:
        "The production binary embeds only product-reachable packages; development-only dependencies stay outside the artifact.",
    }, {
      order: 19,
      id: "no-provider-sdk",
      title: "No provider SDK in the production binary",
      statement:
        "Provider adapters are discern code and compile without bundled coding-agent vendor SDKs.",
    }],
  },
  {
    id: "deterministic-owned-verdict",
    title: "Deterministic discern-owned verdict",
    stability: "enduring",
    scope:
      "Nondeterminism introduced by discern's own Gate and checkpoint decision logic.",
    qualification:
      "Configured jobs, Standard measurements, scope gates, and checkpoint `when` commands may be nondeterministic. Agent declarations are external judgment. discern reports those outcomes and evidence without concealing them.",
    evidence: [
      {
        kind: "source",
        path: "src/engine/gate/execute.ts",
        summary: "derives the verdict from the declared execution result",
      },
      {
        kind: "source",
        path: "src/engine/gate/proof.ts",
        summary: "binds successful evidence to the commit and conditions",
      },
      {
        kind: "source",
        path: "src/engine/checkpoints/preflight.ts",
        summary:
          "derives checkpoint state from policy, triggers, and declarations",
      },
    ],
    absences: [{
      order: 15,
      id: "no-randomness-in-verdict",
      title: "No randomness in the verdict",
      statement:
        "discern adds no random choice to completion. Given the same tree, governing policy, external command outcomes, and checkpoint declaration evidence, it derives the same Gate state and Proof.",
    }],
  },
  {
    id: "planned-owned-effects",
    title: "Planned discern-owned effects",
    stability: "enduring",
    scope: "Filesystem and Git effects implemented by discern itself.",
    qualification:
      "Configured project commands, including checkpoint `when` commands, are opaque external programs. Their own effects are not made reversible or dry-runnable by discern.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0027-plan-apply-engine-execution.md",
        summary: "defines pure planning before thin execution",
      },
      {
        kind: "guard",
        path: "tests/execution_model_test.ts",
        summary: "holds effectful workflow plans and dry-run projections",
      },
    ],
    absences: [{
      order: 16,
      id: "no-unplanned-owned-effects",
      title: "No unplanned discern-owned effects",
      statement:
        "Each discern-owned effectful workflow computes a read-only plan before applying it, which gives the workflow a dry-run projection.",
    }],
  },
  {
    id: "single-program",
    title: "Single program",
    stability: "enduring",
    scope: "The installer, setup commands, and repository engine.",
    evidence: [
      {
        kind: "decision",
        path: "project/map/_adr/0019-single-binary-ts-engine.md",
        summary: "unifies installer and engine in one binary",
      },
      {
        kind: "source",
        path: "src/main.ts",
        summary: "dispatches installer and engine verbs",
      },
    ],
    absences: [{
      order: 17,
      id: "no-duplicated-internals",
      title: "No duplicated installer and engine",
      statement:
        "Installer verbs and the engine are one program. There is no managed engine copy to synchronize with the installed binary.",
    }],
  },
  {
    id: "ordinary-user-process",
    title: "Ordinary-user process",
    stability: "enduring",
    scope: "Privileges requested or elevated by discern-owned code.",
    qualification:
      "A project-owned command may itself request other privileges; that command remains outside this boundary.",
    evidence: [
      {
        kind: "source",
        path: "src/shared/subprocess.ts",
        summary: "runs child commands as the invoking user",
      },
      {
        kind: "source",
        path: "scripts/build.ts",
        summary: "declares ordinary Deno runtime permissions",
      },
    ],
    absences: [{
      order: 18,
      id: "no-privilege-escalation",
      title: "No privilege escalation",
      statement:
        "discern runs as the invoking user and does not request root access or modify the operating system as an administrator.",
    }],
  },
] as const satisfies readonly ProductBoundary<ClaimSlug>[];

/** One flattened projection, used by guards and canonical-set tooling. */
export interface ProjectedBoundary {
  readonly boundaryId: string;
  readonly kind: "refusal" | "identity" | "absence";
  readonly order: number;
  readonly id: string;
  readonly title: string;
  readonly statement: string;
}

/** Every projection in section order, derived from the boundary authority. */
export function allBoundaryProjections(): readonly ProjectedBoundary[] {
  const refusals: ProjectedBoundary[] = [];
  const identities: ProjectedBoundary[] = [];
  const absences: ProjectedBoundary[] = [];
  for (
    const boundary of BOUNDARIES as readonly ProductBoundary<ClaimSlug>[]
  ) {
    if (boundary.refusals !== undefined) {
      for (const refusal of boundary.refusals) {
        refusals.push({
          boundaryId: boundary.id,
          kind: "refusal",
          ...refusal,
        });
      }
    }
    if (boundary.identities !== undefined) {
      for (const identity of boundary.identities) {
        identities.push({
          boundaryId: boundary.id,
          kind: "identity",
          order: identity.order,
          id: identity.id,
          title: identity.title,
          statement: identity.discriminatingFact,
        });
      }
    }
    if (boundary.absences !== undefined) {
      for (const absence of boundary.absences) {
        absences.push({
          boundaryId: boundary.id,
          kind: "absence",
          ...absence,
        });
      }
    }
  }
  const inOrder = (
    rows: readonly ProjectedBoundary[],
  ): readonly ProjectedBoundary[] =>
    [...rows].sort((left, right) => left.order - right.order);
  return [...inOrder(refusals), ...inOrder(identities), ...inOrder(absences)];
}

/** Render one projection section from the flattened authority. */
function renderProjectionSection(
  heading: string,
  intro: string,
  projections: readonly ProjectedBoundary[],
): string[] {
  return [
    `## ${heading}`,
    "",
    intro,
    "",
    ...projections.flatMap((projection, index) => {
      const marker = `${index + 1}.`;
      const indent = " ".repeat(marker.length + 1);
      return [
        `${marker} **${projection.title}** — ${projection.statement}`,
        `${indent}- Projection: \`${projection.id}\`; boundary: [\`${projection.boundaryId}\`](#${projection.boundaryId}).`,
      ];
    }),
  ];
}

/** Render one conceptual boundary record and its inspectable basis. */
function renderBoundaryRecord(
  boundary: ProductBoundary<ClaimSlug>,
): string[] {
  const lines = [
    `### ${boundary.id}`,
    "",
    `**Boundary:** ${boundary.title}\\`,
    `**Stability:** ${boundary.stability}\\`,
    `**Scope:** ${boundary.scope}`,
  ];
  if (boundary.qualification !== undefined) {
    lines.push("", `**Qualification:** ${boundary.qualification}`);
  }
  if (boundary.horizon !== undefined) {
    lines.push("", `**Horizon:** ${boundary.horizon}`);
  }
  if (boundary.claims !== undefined) {
    lines.push(
      "",
      `**Related claims:** ${
        boundary.claims.map((claim) => `{{claim:${claim}}}`).join(", ")
      }`,
    );
  }
  lines.push(
    "",
    "**Evidence:**",
    "",
    ...boundary.evidence.map((item) =>
      `- ${evidenceSourceLabel(item.kind)}: \`${item.path}\` — ${item.summary}.`
    ),
  );
  return lines;
}

/** Render the generated Boundary Canon page. */
export function renderBoundaryCanonDoc(): string {
  const projections = allBoundaryProjections();
  const byKind = (
    kind: ProjectedBoundary["kind"],
  ): readonly ProjectedBoundary[] =>
    projections.filter((projection) => projection.kind === kind);
  return [
    "# Boundary canon",
    "",
    "_The {{doc:claims-and-evidence}} ledger controls what discern may claim; the [feature canon](../feature-canon.md) enumerates what it does. This canon controls the other side of product identity: what discern refuses to do, which adjacent categories it must not be mistaken for, and which checkable structures are absent._",
    "",
    "One conceptual boundary may appear in more than one projection. The shared record is authoritative; the three lists are task-shaped views generated from it.",
    "",
    "## Scope rule",
    "",
    "Unless a record says otherwise, a boundary applies to discern-owned code and effects. Project jobs, checkpoint `when` commands, resource commands, provider hooks, coding-agent clients, and the surrounding coding-agent host keep their own capabilities: they may use models, networks, credentials, nondeterminism, or additional privileges without changing what the discern engine itself contains.",
    "",
    "Stability labels mean:",
    "",
    "- **Enduring** — part of the intended product identity; reversing it requires a product decision.",
    "- **Edition** — canonical for the local edition, with the possible extension named in its horizon.",
    "- **Implementation** — a checkable property of the current build, guarded in code and changed only with the record and guard together.",
    "",
    ...renderProjectionSection(
      "Behavioral refusals",
      "These statements oblige behavior. A violation is a product defect.",
      byKind("refusal"),
    ),
    "",
    ...renderProjectionSection(
      "Mistaken identities",
      "Each entry names a category people may use and the discriminating fact that rules it out.",
      byKind("identity"),
    ),
    "",
    ...renderProjectionSection(
      "Structural absences",
      "These statements name inspectable properties of the product or edition. Qualifications keep external commands and future editions outside claims they cannot support.",
      byKind("absence"),
    ),
    "",
    "## Boundary records",
    "",
    "The records below own scope, stability, qualifications, horizons, claims, and evidence for every projection above.",
    "",
    ...BOUNDARIES.flatMap((boundary, index) => [
      ...renderBoundaryRecord(boundary),
      ...(index === BOUNDARIES.length - 1 ? [] : [""]),
    ]),
  ].join("\n");
}
