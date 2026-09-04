/**
 * The public claims ledger as typed registry data: every claim discern makes
 * in public copy, its evidence class, strongest supported wording, conditions,
 * and forbidden inferences — plus the evidence-class vocabulary and the
 * absolute do-not-claim list. `claims-and-evidence.md` compiles from this
 * module; the private residue (demand-evidence sweeps, anecdotes,
 * future-validation hypotheses, and dated evidence snapshots) stays authored
 * in `claims-residue.md`, outside the registry.
 */

import {
  type Claim,
  EVIDENCE_CLASS_NAMES,
  type EvidenceClass,
  type EvidenceClassDefinition,
  evidenceSourceLabel,
} from "./model.ts";
import { annotateProse } from "../canon_editor/annotation.ts";

/** The evidence-class table: meaning and permitted public use per class. */
export const EVIDENCE_CLASSES: Readonly<
  Record<EvidenceClass, EvidenceClassDefinition>
> = {
  structural: {
    meaning:
      "Product truth enforced by architecture, source code, tests, or canonical registry.",
    publicUse: "Safe to state when wording matches the exact scope.",
  },
  demonstrated: {
    meaning:
      "Product behavior verified by the current implementation and dogfooding.",
    publicUse: "Safe with conditions; avoid universal customer outcomes.",
  },
  corroborated: {
    meaning:
      "A scoped qualitative market pattern found in several independent public accounts across more than one venue; the corpus and contrary cases are recorded.",
    publicUse:
      "Safe for non-quantified, segment-scoped recognition language. Do not imply prevalence, causation, typical outcomes, endorsement, or product effectiveness.",
  },
  observational: {
    meaning:
      "Internal evidence: a Patterns export, internal metrics, founder use, or controlled demonstrations.",
    publicUse:
      "Attribute and date it. Never present as independent market validation.",
  },
  anecdotal: {
    meaning: "A named user's external experience or reaction.",
    publicUse:
      "Permission required. Attribute the experience and limit the wording to that named user's result.",
  },
  hypothesis: {
    meaning:
      "A plausible audience or market interpretation not yet externally tested.",
    publicUse:
      "Use internally or label as a hypothesis. Do not present as fact.",
  },
};

/** The twenty public claims, slugs as keys, in ledger order. */
export const CLAIMS = {
  "installs-a-practice": {
    audience: "shared",
    title: "discern installs an engineering practice into a project",
    evidence: ["structural", "demonstrated"],
    strongestPublicForm:
      "discern installs an engineering practice into an agent-built project.",
    mechanism:
      "setup studies the repository, learns human intent, wires project jobs, authors instructions and project knowledge, establishes worktree viability, and refuses completion until refresh, doctor, the full Gate, and a throwaway worktree probe pass. Ongoing instructions, Skills, worktrees, Standards, evidence, acceptance, and Patterns sustain the practice.",
    conditions:
      "“Practice” names the connected product system. Installation alone does not establish cultural transformation.",
    forbiddenInference:
      "setup makes every project professionally engineered without good repository evidence, a capable setup agent, or human decisions.",
    primarySource: "setup brief; feature registry/canon.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_setup_done_test.ts",
        summary:
          "refuses to record setup complete until the Gate and the worktree probe pass",
      },
      {
        kind: "source",
        path: "templates/setup/instructions.md",
        summary: "briefs the setup agent through every stage",
      },
    ],
  },
  "no-manual-configuration": {
    audience: "human",
    title: "the human does not manually configure discern",
    evidence: ["structural", "demonstrated"],
    strongestPublicForm:
      "Tell your coding agent to set up discern; the agent configures the project and asks for the decisions only you can make.",
    mechanism:
      "the setup brief explicitly makes the agent the configuration engine and uses staged verification and consent.",
    conditions:
      "the agent performs substantial project-specific work; “zero configuration” means zero manual configuration by the human.",
    forbiddenInference:
      "setup is instantaneous, requires no agent effort, or never asks the human a question.",
    primarySource: "`discern setup begin` brief.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_setup_messages_test.ts",
        summary:
          "pins the consent and completion messages that make the agent the configuration engine",
      },
      {
        kind: "source",
        path: "templates/setup/instructions.md",
        summary: "asks the human only for the decisions the agent cannot make",
      },
    ],
  },
  "one-instruction-source": {
    audience: "shared",
    title: "every configured provider receives the same project instructions",
    evidence: ["structural"],
    strongestPublicForm:
      "Write the project instructions once; discern compiles them for every configured coding-agent provider.",
    mechanism:
      "one instruction source plus built-in instructions generates the provider instruction files; drift fails the Gate.",
    conditions:
      "applies to supported and configured providers; provider-specific capabilities still differ.",
    forbiddenInference:
      "all providers behave identically or support identical integrations.",
    primarySource: "feature registry/canon; config schema; glossary.",
    basis: [
      {
        kind: "guard",
        path: "tests/agent_parity_test.ts",
        summary:
          "holds every provider's instruction surface to the one registry and source",
      },
      {
        kind: "guard",
        path: "tests/engine_refresh_test.ts",
        summary:
          "compiles the instruction files for every configured provider from one source",
      },
      {
        kind: "guard",
        path: "tests/engine_done_json_surfaces_test.ts",
        summary: "fails the Gate on a stale compiled agent file",
      },
    ],
  },
  "switch-without-reteaching": {
    audience: "shared",
    title: "switching providers does not require re-teaching the project",
    evidence: ["structural", "demonstrated"],
    strongestPublicForm:
      "Change coding agents without starting the project explanation over.",
    mechanism:
      "project instructions, Skills, Map, Gate, Standards, and worktree practice remain project-owned.",
    conditions:
      "the target provider must be supported and configured; active sessions may require restart or MCP reload.",
    forbiddenInference:
      "every provider can resume identical hidden conversational state or proprietary provider features.",
    tacticalUse: "quota and subscription-capacity juggling.",
    primarySource:
      "provider instructions registry; setup and refresh behavior.",
    basis: [
      {
        kind: "guard",
        path: "tests/providers_test.ts",
        summary: "derives every native integration from one typed registry",
      },
      {
        kind: "guard",
        path: "tests/engine_refresh_test.ts",
        summary:
          "regenerates a newly configured provider's files from the same project sources",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0031-typed-provider-integration.md",
        summary: "makes the provider registry the single integration authority",
      },
    ],
  },
  "shaped-delegation": {
    audience: "shared",
    title:
      "substantial delegated work can be shaped into parallel or staged programs",
    evidence: ["structural", "demonstrated"],
    strongestPublicForm:
      "discern can turn discussed work into complete handoffs, parallel streams, or staged dependencies for fresh coding agents.",
    mechanism:
      "the bundled Delegate Work Skill defines the shapes, briefs, workstream keys, dependencies, authority, definitions of done, and adversarial review.",
    conditions:
      "the work must contain real seams; dispatch remains under user control; parallel streams should avoid shared files in flight.",
    forbiddenInference:
      "every backlog can safely run in parallel, discern autonomously dispatches without consent, or vendor fleet management is absent elsewhere.",
    primarySource: "`discern-delegate-work` Skill.",
    basis: [
      {
        kind: "guard",
        path: "tests/skills_wellformed_test.ts",
        summary:
          "holds every bundled skill, the delegate-work skill included, to the well-formedness contract",
      },
      {
        kind: "source",
        path: "templates/skills/discern-delegate-work/SKILL.md",
        summary:
          "defines the handoff, parallel, and staged shapes with their authority and review steps",
      },
    ],
  },
  "reduced-review-burden": {
    audience: "human",
    title: "discern supports reduced human line-by-line review",
    evidence: ["demonstrated", "observational"],
    strongestPublicForm:
      "discern is designed to reduce the amount of implementation a person must inspect line by line, allowing attention to move toward outcomes, exceptions, and the decision to ship.",
    mechanism:
      "project instructions, independent agent review, deterministic checks, exact-tree evidence, Standards, and authority boundaries.",
    conditions:
      "appropriate review depth depends on project risk, change type, test quality, and the person's confidence in the configured practice.",
    forbiddenInference:
      "no human ever needs to inspect code, the product guarantees correctness, or passing evidence replaces exercising the real artifact.",
    evidenceNote:
      "founder dogfooding supports the intended outcome; external validation remains limited.",
    primarySource:
      "founder account; Gate instructions; Delegate Work Skill; current practice evidence.",
    basis: [
      {
        kind: "decision",
        path:
          "project/map/_adr/0270-the-benefit-canon-separates-value-from-claim-qualification.md",
        summary:
          "records the deduction from exact-tree evidence to reduced inspection, and its limits",
      },
      {
        kind: "source",
        path: "templates/skills/discern-delegate-work/SKILL.md",
        summary: "carries the independent adversarial review step",
      },
    ],
  },
  "isolated-worktrees": {
    audience: "shared",
    title: "each task receives an isolated worktree and declared resources",
    evidence: ["structural"],
    strongestPublicForm:
      "Every discern task gets its own Git worktree, branch, identity, environment values, and any resources the project declares.",
    mechanism:
      "worktree lifecycle, identity, environment inheritance, resources, crash-safe provisioning, and teardown.",
    conditions: "isolation covers the checkout and declared resources.",
    forbiddenInference:
      "logical source changes can never overlap, semantic merge conflicts are impossible, or discern provides a security sandbox.",
    primarySource: "feature registry/canon; worktree config and glossary.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_worktree_test.ts",
        summary: "drives the real linked-worktree lifecycle through the dispatcher",
      },
      {
        kind: "guard",
        path: "tests/worktree_identity_test.ts",
        summary: "pins the deterministic per-worktree identity",
      },
      {
        kind: "guard",
        path: "tests/engine_worktree_resources_test.ts",
        summary: "creates and reclaims declared per-worktree resources",
      },
    ],
  },
  "no-checkout-collisions": {
    audience: "shared",
    title: "parallel efforts cannot overwrite the same checkout",
    evidence: ["structural"],
    strongestPublicForm:
      "Parallel agents work in separate checkouts and cannot overwrite one another's working tree.",
    conditions:
      "two efforts may still change the same source files independently; status surfaces the overlap and the later landing must update and re-read shared paths.",
    forbiddenInference:
      "`parallel agents cannot collide` without qualification.",
    primarySource: "worktree lifecycle and fleet collision behavior.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_worktree_test.ts",
        summary: "gives every effort its own checkout and branch",
      },
      {
        kind: "guard",
        path: "tests/engine_status_test.ts",
        summary: "surfaces cross-worktree file collisions and incoming overlap",
      },
    ],
  },
  "standards-cannot-loosen": {
    audience: "shared",
    title: "a Standard cannot be loosened on a branch",
    evidence: ["structural"],
    strongestPublicForm:
      "A discern Standard may tighten, but a branch cannot weaken its limit.",
    mechanism:
      "limits are compared with the trunk on every Gate run; floors and ceilings move only in the improving direction.",
    conditions: "applies to configured Standards and correctly chosen metrics.",
    forbiddenInference:
      "every quality dimension is measured, or a metric cannot be poorly designed.",
    primarySource: "Standards registry, config schema, feature canon.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_gate_standards_test.ts",
        summary: "fails the Gate when a branch loosens or deletes a limit",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0133-standards-join-the-gate.md",
        summary: "puts the limit comparison inside every Gate run",
      },
    ],
  },
  "pin-measured-gains": {
    audience: "shared",
    title: "measured gains can be captured",
    evidence: ["structural"],
    strongestPublicForm:
      "When a configured measure improves, discern can pin the gain as the new limit.",
    mechanism:
      "`discern standards --pin` tightens limits from measured evidence and records the change separately.",
    conditions: "margin and metric design affect the appropriate limit.",
    forbiddenInference:
      "every short-term fluctuation should be pinned or improvement is always monotonic in practice.",
    primarySource: "Standards documentation and command behavior.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_standards_pin_test.ts",
        summary:
          "tightens a limit from a measured gain and commits the change on its own",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0106-standards-pin-carries-the-gate-receipt.md",
        summary: "defines the pin as a measured, committed tightening",
      },
    ],
  },
  "proof-exact-tree": {
    audience: "shared",
    title: "Proof covers the exact committed tree that passed",
    evidence: ["structural"],
    strongestPublicForm:
      "A discern Proof identifies the exact clean committed change that passed the project's declared Gate and held Standards, and separately carries current checkpoint declarations.",
    mechanism:
      "the tree is pinned before evaluation and rechecked at stamping; the Proof also binds a declaration-evidence identity, so a later commit or changed declaration invalidates it.",
    conditions:
      "Use “Proof” consistently, keep the claim scoped to the declared Gate over the exact tree, and describe checkpoint conclusions as declared rather than verified.",
    forbiddenInference:
      "formal proof of universal correctness, security, absence of defects, production suitability, permission to land, or machine verification of an agent declaration.",
    primarySource:
      "Proof implementation, glossary, Gate behavior, and DSSE-compatible note boundary.",
    basis: [
      {
        kind: "guard",
        path: "tests/gate_proof_evidence_test.ts",
        summary:
          "stales a recorded Proof when the tree or its declaration evidence changes",
      },
      {
        kind: "guard",
        path: "tests/engine_proof_render_test.ts",
        summary: "pins the exact commit, branch, and conditions the Proof names",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md",
        summary: "binds Proof currency to declaration evidence",
      },
    ],
  },
  "gate-grants-no-authority": {
    audience: "shared",
    title: "a passing Gate does not grant authority to land",
    evidence: ["structural"],
    strongestPublicForm:
      "Passing makes a change eligible for a decision; it does not decide what ships.",
    mechanism:
      "acceptance requires fresh conversational confirmation, a standing scope grant, or a per-worktree grant checked at the landing boundary; each declared-unmet checkpoint additionally requires owner authorization for the current variance, recorded from the conversation.",
    conditions:
      "pre-authorization can permit independent landing once the changed paths satisfy the grant and no current declared-unmet conclusion requires a variance.",
    forbiddenInference:
      "the human must manually approve every low-level action, or a recorded grant is unlimited autonomy.",
    primarySource: "landing authority, acceptance config, Delegate Work Skill.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_accept_authority_test.ts",
        summary:
          "exercises every landing-authority source and refuses the uncovered ones",
      },
      {
        kind: "guard",
        path: "tests/engine_checkpoints_accept_test.ts",
        summary: "requires owner authorization for a declared-unmet variance",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md",
        summary: "defines the machine-checked grant model",
      },
    ],
  },
  "no-model-inside": {
    audience: "shared",
    title: "discern contains no AI model and needs no API key",
    evidence: ["structural"],
    strongestPublicForm:
      "discern contains no AI model and needs no API key; it derives machine results from deterministic checks and the project's commands, while the coding agent supplies any checkpoint judgment.",
    mechanism:
      "one local binary; deterministic engine; checkpoint declarations are external agent evidence rather than model calls made by discern.",
    conditions:
      "coding agents, project commands, and checkpoint `when` commands may independently use networks, models, or paid services.",
    forbiddenInference:
      "the entire development environment is offline or network-free.",
    primarySource: "Foundations; CLI tips; product architecture.",
    basis: [
      {
        kind: "guard",
        path: "tests/shipped_no_network_test.ts",
        summary:
          "proves the shipped graph reaches no network API and the binary holds no network permission",
      },
      {
        kind: "guard",
        path: "tests/engine_checkpoints_gate_test.ts",
        summary:
          "records checkpoint declarations as agent evidence rather than model results",
      },
      {
        kind: "source",
        path: "scripts/build.ts",
        summary:
          "compiles the binary with the permission set that excludes the network",
      },
    ],
  },
  "local-logbook": {
    audience: "shared",
    title: "evidence and the Logbook stay local",
    evidence: ["structural"],
    strongestPublicForm:
      "discern's Logbook and advisory analysis stay on the machine. They contain metadata and exclude code, command output, and checkpoint rationales.",
    mechanism:
      "local `.git` storage; no network path in the Logbook implementation; checkpoint observations omit rationale fields; opt-out available.",
    conditions:
      "publication or Git transport of other artifacts may be explicitly configured by the user.",
    forbiddenInference:
      "all project data and tooling stay local or discern is a security boundary.",
    primarySource: "Logbook glossary and feature canon.",
    basis: [
      {
        kind: "guard",
        path: "tests/logbook_no_network_test.ts",
        summary: "proves the Logbook module graph has no network path",
      },
      {
        kind: "guard",
        path: "tests/engine_checkpoints_observation_test.ts",
        summary: "keeps checkpoint rationales out of every Logbook byte",
      },
      {
        kind: "source",
        path: "src/engine/logbook/store.ts",
        summary: "writes the Logbook under the local Git admin directory",
      },
    ],
  },
  "patterns-compare-cohorts": {
    audience: "human",
    title: "Patterns can compare cohorts and configurations",
    evidence: ["structural", "demonstrated"],
    strongestPublicForm:
      "Patterns can segment and compare working evidence across agent cohorts and configuration epochs, while reporting denominators and avoiding agent rankings.",
    mechanism: "named detectors and stats over local Logbook evidence.",
    conditions:
      "different task mixes confound comparisons. Treat findings as places to investigate; they do not establish causal verdicts.",
    forbiddenInference:
      "fair performance leaderboard, model benchmark, employee surveillance, or causal proof.",
    wordingCorrection:
      "replace claims that `nothing is compared` with `cohorts may be compared; agents are not graded or ranked.`",
    primarySource:
      "current `discern patterns --json` output and Patterns implementation.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_patterns_test.ts",
        summary:
          "holds bounded cohort findings with their denominators and the advisory boundary",
      },
      {
        kind: "guard",
        path: "tests/stats_test.ts",
        summary: "keeps every Stats number a plain local count",
      },
      {
        kind: "decision",
        path:
          "project/map/_adr/0229-practice-stats-are-counted-local-and-never-comparative.md",
        summary: "rules out grades, rankings, and composite scores",
      },
    ],
  },
  "one-config-file": {
    audience: "shared",
    title: "one configuration file governs the installation",
    evidence: ["structural"],
    strongestPublicForm:
      "All project-specific discern settings live in one root `discern.toml` file.",
    mechanism:
      "config schema; other surfaces are bundled, pointed to, authored, shared, or generated.",
    forbiddenInference:
      "discern touches only one tracked file, or the project contains no instructions, Map, agent files, Skills, or integration files.",
    primarySource: "config reference; one-file-settings tip.",
    basis: [
      {
        kind: "guard",
        path: "tests/paths_write_surface_test.ts",
        summary: "enumerates every path discern may write in a project",
      },
      {
        kind: "source",
        path: "src/shared/config_schema.ts",
        summary: "defines the whole root configuration",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0020-dissolve-discern-dir.md",
        summary: "dissolves the hidden namespace into one root file",
      },
    ],
  },
  "setup-proves-worktree": {
    audience: "shared",
    title: "setup proves the project runs in a worktree",
    evidence: ["structural", "demonstrated"],
    strongestPublicForm:
      "`discern setup done` runs the configured Gate in a throwaway worktree and refuses to record setup as complete when that probe fails.",
    mechanism: "setup worktree probe and `setup done` stop conditions.",
    conditions:
      "a project that needs a human-provisioned secret, database, or external resource must resolve that requirement before the completion probe can establish a green setup; record unresolved decisions so they do not disappear between sessions.",
    forbiddenInference:
      "all deployment environments, external services, production data, or security conditions are thereby proven.",
    primarySource: "setup brief.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_setup_done_test.ts",
        summary: "refuses setup completion when the throwaway worktree probe fails",
      },
      {
        kind: "guard",
        path: "tests/engine_worktree_probe_test.ts",
        summary: "creates, runs, and tears down the throwaway probe worktree",
      },
      {
        kind: "decision",
        path: "project/map/_adr/0090-setup-proves-worktree-viability.md",
        summary: "makes the probe the completion condition",
      },
    ],
  },
  "map-mechanically-checked": {
    audience: "shared",
    title: "the Map is mechanically checked",
    evidence: ["structural"],
    strongestPublicForm:
      "discern checks the Map's links, anchors, live command examples, audience boundaries, metadata, and Skill references as part of the Gate.",
    conditions:
      "file-linked freshness supplies evidence; the current checks do not judge subjective prose freshness.",
    forbiddenInference:
      "discern can determine whether every sentence remains conceptually current.",
    primarySource: "Map integrity behavior and feature canon.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_map_integrity_test.ts",
        summary:
          "fails the Gate on dead links, anchors, stale command examples, audience leaks, and unknown skill citations",
      },
      {
        kind: "guard",
        path: "tests/map_integrity_test.ts",
        summary:
          "applies the shipped integrity core to this repository's own Map",
      },
      {
        kind: "source",
        path: "src/lib/map_integrity.ts",
        summary: "implements the integrity preflight every Gate runs",
      },
    ],
  },
  "agent-as-operator": {
    audience: "coding-agent",
    title: "discern is designed around the coding agent as operator",
    evidence: ["structural"],
    strongestPublicForm:
      "discern's interaction design treats the coding agent as its principal day-to-day operator.",
    mechanism:
      "typed MCP tools, one result envelope, context bounds, relevant hints, self-checking verbs, explicit next actions, provider instructions, and relay-safe prose.",
    forbiddenInference:
      "humans are secondary in authority, or discern itself is an agent.",
    primarySource: "Foundations; interfaces; hint audience registry.",
    basis: [
      {
        kind: "guard",
        path: "tests/engine_verb_parity_test.ts",
        summary: "ties the MCP tool table to the CLI verb vocabulary",
      },
      {
        kind: "guard",
        path: "tests/engine_mcp_surface_test.ts",
        summary:
          "holds every MCP description to configured values rather than baked literals",
      },
      {
        kind: "source",
        path: "src/engine/mcp/server.ts",
        summary:
          "serves the typed tools and the result envelope to the coding agent",
      },
    ],
  },
  "runs-on-itself": {
    audience: "shared",
    title: "discern runs on itself",
    evidence: ["demonstrated", "observational"],
    strongestPublicForm:
      "discern is developed under its own Gate, worktrees, Standards, Map, and Logbook.",
    conditions:
      "dogfooding provides product evidence from internal use. Independent external validation remains separate.",
    forbiddenInference: "self-use proves absence of defects or market fit.",
    primarySource: "feature canon and repository practice.",
    basis: [
      {
        kind: "guard",
        path: "tests/dogfood_refresh_test.ts",
        summary:
          "holds this repository's own provider integrations to what refresh expects",
      },
      {
        kind: "source",
        path: "discern.toml",
        summary:
          "declares this repository's own Gate, Standards, Map, and worktree practice",
      },
    ],
  },
} as const satisfies Readonly<Record<string, Claim>>;

/** Compile-time claim citation: every slug in the ledger, nothing else. */
export type ClaimSlug = keyof typeof CLAIMS;

/** The absolute do-not-claim list (each entry renders inside “” quotes). */
export const DO_NOT_CLAIM: readonly string[] = [
  "discern guarantees correct software.",
  "discern guarantees secure software.",
  "No review is required.",
  "Agents cannot conflict.",
  "discern is a sandbox.",
  "discern prevents rogue agents.",
  "Proof means the software is bug-free.",
  "A green Gate means the change should ship.",
  "All development data stays offline.",
  "Every project is zero-effort to set up.",
  "discern replaces CI.",
  "discern replaces engineering expertise.",
  "discern makes any builder an engineer.",
  "discern ranks which coding agent is best.",
];

/** The heading a claim renders under in the ledger (also its anchor text). */
export function claimHeading(slug: string, title: string): string {
  return `\`${slug}\` — ${title}`;
}

/** An evidence class's display name, as the table capitalizes it. */
function classDisplayName(name: EvidenceClass): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Route one ledger field through Canon Editor's provenance channel;
 * outside Canon Editor the text passes through unchanged.
 */
function claimProse(slug: string, field: string, text: string): string {
  return annotateProse(text, { registry: "claims", entry: slug, field });
}

/** Render one claim's ledger entry. */
function renderClaim(slug: string, claim: Claim): string {
  const lines = [
    `### ${claimHeading(slug, claimProse(slug, "title", claim.title))}`,
    "",
    `- **Audience:** ${claim.audience}`,
    `- **Evidence:** ${claim.evidence.join(" / ")}`,
    `- **Strongest supported public form:** “${
      claimProse(slug, "strongestPublicForm", claim.strongestPublicForm)
    }”`,
  ];
  if (claim.mechanism !== undefined) {
    lines.push(
      `- **Mechanism:** ${claimProse(slug, "mechanism", claim.mechanism)}`,
    );
  }
  if (claim.conditions !== undefined) {
    lines.push(
      `- **Conditions:** ${claimProse(slug, "conditions", claim.conditions)}`,
    );
  }
  lines.push(
    `- **Forbidden inference:** ${
      claimProse(slug, "forbiddenInference", claim.forbiddenInference)
    }`,
  );
  if (claim.evidenceNote !== undefined) {
    lines.push(
      `- **Evidence note:** ${
        claimProse(slug, "evidenceNote", claim.evidenceNote)
      }`,
    );
  }
  if (claim.tacticalUse !== undefined) {
    lines.push(
      `- **Current tactical use case:** ${
        claimProse(slug, "tacticalUse", claim.tacticalUse)
      }`,
    );
  }
  if (claim.wordingCorrection !== undefined) {
    lines.push(
      `- **Canonical wording correction:** ${
        claimProse(slug, "wordingCorrection", claim.wordingCorrection)
      }`,
    );
  }
  lines.push(
    `- **Primary source:** ${
      claimProse(slug, "primarySource", claim.primarySource)
    }`,
    "- **Inspectable basis:**",
    ...claim.basis.map((item) =>
      `  - ${evidenceSourceLabel(item.kind)}: \`${item.path}\` — ${item.summary}.`
    ),
  );
  return lines.join("\n");
}

/**
 * The whole public claims document, ready for the barrel to stamp and
 * resolve. The private residue (dated internal snapshots, demand-evidence
 * sweeps, the anecdote ledger, and claims requiring future validation) lives
 * in the authored `claims-residue.md` overlay, not here.
 */
export function renderClaimsDoc(): string {
  return [
    "# Claims and evidence",
    "",
    "**Status:** Canonical claims ledger\\",
    "**Purpose:** Support bold public communication while preserving the product's actual scope.",
    "",
    "## Evidence classes",
    "",
    "| Class | Meaning | Public use |",
    "| --- | --- | --- |",
    ...EVIDENCE_CLASS_NAMES.map((name) => {
      const definition = EVIDENCE_CLASSES[name];
      return `| **${
        classDisplayName(name)
      }** | ${definition.meaning} | ${definition.publicUse} |`;
    }),
    "",
    "## Source hierarchy",
    "",
    "When a claim needs verification, consult:",
    "",
    "1. live behavior and source code;",
    "2. canonical registries and generated product canon;",
    "3. the canonical glossary and documentation;",
    "4. the setup brief and bundled Skills;",
    "5. current `discern patterns --json` evidence;",
    "6. dated public qualitative corpora and their recorded limits;",
    "7. founder account and approved user anecdotes.",
    "",
    "Every claim also carries an inspectable basis: the exact decisions, guards, and sources a reader can open. A guard is a test module that names the claim it holds, and every structural claim carries at least one, so the claim fails the Gate the moment its mechanism regresses.",
    "",
    "The product glossary defines each product term once and prohibits synonyms in product prose. The brand operating system may vary human language while preserving those meanings.",
    "",
    "## Claim ledger",
    "",
    Object.entries(CLAIMS).map(([slug, claim]) => renderClaim(slug, claim))
      .join("\n\n"),
    "",
    "## Absolute do-not-claim list",
    "",
    DO_NOT_CLAIM.map((entry) => `- \`${entry}\``).join("\n"),
  ].join("\n");
}
