/**
 * Canonical semantic contracts for setup's human moments.
 *
 * Setup is often a person's first encounter with discern. A mechanically complete
 * page can still fail that encounter when it names a choice without explaining the
 * lasting outcome, the reason for the recommendation, what each option changes, or
 * whether the agent must wait. This registry owns those facts in an iterable form.
 * Pages and fixed lifecycle surfaces bind to moment ids; contextual consent choices
 * use the same schema before they are rendered.
 */

import { z } from "@zod/zod";

export const SETUP_HUMAN_SURFACES = [
  "welcome",
  "consent",
  "setup-started",
  "step-0",
  "step-1",
  "step-2",
  "step-3",
  "step-4",
  "step-5",
  "step-6",
  "step-7",
  "step-8",
  "step-9",
  "step-10",
  "setup-done",
  "setup-accept",
  "activation",
] as const;
export type SetupHumanSurface = typeof SETUP_HUMAN_SURFACES[number];

export const SETUP_HUMAN_MOMENT_KINDS = [
  "explanation",
  "progress",
  "decision",
  "completion",
] as const;
export type SetupHumanMomentKind = typeof SETUP_HUMAN_MOMENT_KINDS[number];

/** Stable semantic roles carried independently from either English projection. */
export const SETUP_HUMAN_FACT_ROLES = [
  "outcome",
  "reason",
  "current-action",
  "authority",
  "reversibility",
  "recovery",
  "recommendation",
  "option-consequence",
  "owner-action",
  "agent-action",
  "wait-behavior",
] as const;
export type SetupHumanFactRole = typeof SETUP_HUMAN_FACT_ROLES[number];

const SETUP_HUMAN_FACT_ROLE_SHAPES = {
  outcome: "common",
  reason: "common",
  "current-action": "common",
  authority: "common",
  reversibility: "common",
  recovery: "common",
  recommendation: "recommended",
  "option-consequence": "option",
  "owner-action": "option",
  "agent-action": "option",
  "wait-behavior": "decision",
} as const satisfies Readonly<
  Record<
    SetupHumanFactRole,
    "common" | "recommended" | "option" | "decision"
  >
>;

export const SETUP_OWNER_AUDIENCES = ["novice", "experienced"] as const;
export type SetupOwnerAudience = typeof SETUP_OWNER_AUDIENCES[number];

export const SETUP_DECISION_KINDS = [
  "model-selection",
  "project-name-confirmation",
  "project-intent-gap",
  "gate-protection-change",
  "authored-source-collision",
  "owner-policy-conflict",
  "subsystem-sanity-check",
  "worktree-resource-policy",
  "documentation-claim-gap",
  "external-reference-inspection",
  "landing-choice",
] as const;
export type SetupDecisionKind = typeof SETUP_DECISION_KINDS[number];

export const SETUP_RECOMMENDATION_ACTION = "use-recommendation" as const;

/** One verified reversibility account shared by welcome, consent, and completion. */
export const SETUP_REVERSIBILITY = {
  welcome:
    "The welcome is read-only. If setup begins in a Git project, its changes stay on a separate `discern-setup` branch until the owner decides whether to land them.",
  beforeLanding:
    "Before landing, the main shared version is unchanged; the setup branch can be reviewed, corrected, left in place, or removed through the normal Git workflow.",
  uninstall:
    "`discern uninstall` removes discern's wiring and generated integration, while retaining project-authored guide, instruction, and deferred-work content for owner review or removal.",
} as const;

/**
 * Closed policy for the explicit “use your recommendation” action. A new
 * decision kind cannot become delegable merely because nobody remembered to
 * classify it.
 */
export const SETUP_DECISION_DELEGATION: Readonly<
  Record<
    SetupDecisionKind,
    | { readonly allowed: true }
    | { readonly allowed: false; readonly reason: string }
  >
> = {
  "model-selection": {
    allowed: false,
    reason:
      "available model capability is not established by repository evidence",
  },
  "project-name-confirmation": { allowed: true },
  "project-intent-gap": {
    allowed: false,
    reason:
      "missing product intent belongs to the owner even when repository evidence supports a recommendation",
  },
  "gate-protection-change": {
    allowed: false,
    reason: "the choice may add a dependency, cost, or broader access",
  },
  "authored-source-collision": {
    allowed: false,
    reason: "the choice can displace durable owner-authored material",
  },
  "owner-policy-conflict": {
    allowed: false,
    reason: "the choice binds future work to an owner policy",
  },
  "subsystem-sanity-check": { allowed: true },
  "worktree-resource-policy": {
    allowed: false,
    reason: "the choice may affect cost, access, shared state, or durable data",
  },
  "documentation-claim-gap": { allowed: true },
  "external-reference-inspection": {
    allowed: false,
    reason: "the choice broadens inspection beyond the project",
  },
  "landing-choice": {
    allowed: false,
    reason:
      "landing changes the main shared version and always stays with the owner",
  },
};

const nonEmpty = z.string().trim().min(1);

export const SetupHumanDecisionOptionSchema = z.strictObject({
  id: nonEmpty,
  label: nonEmpty,
  consequence: nonEmpty,
  owner_action: nonEmpty,
  agent_action: nonEmpty,
  recommended: z.boolean(),
});
export type SetupHumanDecisionOption = z.infer<
  typeof SetupHumanDecisionOptionSchema
>;

export const SetupHumanRelaySchema = z.strictObject({
  protection: z.enum(["adaptive", "verbatim-list"]),
  message: nonEmpty,
  experienced: nonEmpty,
});
export type SetupHumanRelay = z.infer<typeof SetupHumanRelaySchema>;

const commonMomentShape = {
  id: nonEmpty,
  surfaces: z.array(z.enum(SETUP_HUMAN_SURFACES)).min(1),
  phase: nonEmpty,
  applicability: z.union([
    z.strictObject({ kind: z.literal("always") }),
    z.strictObject({
      kind: z.literal("when"),
      evidence_id: nonEmpty,
      condition: nonEmpty,
    }),
  ]),
  purpose: nonEmpty,
  owner_outcome: nonEmpty,
  why: nonEmpty,
  current_action: nonEmpty,
  authority: nonEmpty,
  reversibility: nonEmpty,
  recovery: nonEmpty,
};

export const SetupHumanDecisionMomentSchema = z.strictObject({
  ...commonMomentShape,
  kind: z.literal("decision"),
  decision_kind: z.enum(SETUP_DECISION_KINDS),
  recommendation: nonEmpty,
  agent_behavior: z.strictObject({
    before_owner_action: z.literal("wait"),
    after_owner_action: nonEmpty,
  }),
  options: z.array(SetupHumanDecisionOptionSchema).min(2),
  relay: SetupHumanRelaySchema,
});
export type SetupHumanDecisionMoment = z.infer<
  typeof SetupHumanDecisionMomentSchema
>;

const SetupHumanInformationalMomentSchema = z.strictObject({
  ...commonMomentShape,
  kind: z.enum(["explanation", "progress", "completion"]),
  recommendation: nonEmpty.optional(),
  agent_behavior: z.strictObject({
    before_owner_action: z.enum(["proceed", "stop"]),
    after_owner_action: nonEmpty,
  }),
  relay: SetupHumanRelaySchema,
});

/**
 * The shape every shipped human moment must satisfy. The validation is based on
 * semantic roles, not known ids, so a newly named sibling cannot omit the fields
 * whose loss prompted this contract.
 */
export const SetupHumanMomentSchema = z.union([
  SetupHumanDecisionMomentSchema,
  SetupHumanInformationalMomentSchema,
]).superRefine((moment, context) => {
  const optionIds = moment.kind === "decision"
    ? moment.options.map((option) => option.id)
    : [];
  if (new Set(optionIds).size !== optionIds.length) {
    context.addIssue({
      code: "custom",
      path: ["options"],
      message: "decision option ids must be unique",
    });
  }
  if (moment.kind === "decision") {
    const recommended = moment.options.filter((option) => option.recommended);
    if (recommended.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "a decision must recommend one option",
      });
    }
    const selfCertification =
      /\b(?:i am|i'm|this model is|the agent is)\b.*\b(?:most capable|expert|qualified|safe)\b/i;
    for (const [index, option] of moment.options.entries()) {
      if (selfCertification.test(option.label)) {
        context.addIssue({
          code: "custom",
          path: ["options", index, "label"],
          message: "an option label cannot certify the agent's competence",
        });
      }
    }
  }
});
export type SetupHumanMoment = z.infer<typeof SetupHumanMomentSchema>;

/** Compact typed routing state carried beside the complete prose contract. */
export const SetupHumanMomentProjectionSchema = z.strictObject({
  id: nonEmpty,
  kind: z.enum(SETUP_HUMAN_MOMENT_KINDS),
  phase: nonEmpty,
  purpose: nonEmpty,
  applicability: z.union([
    z.strictObject({ kind: z.literal("always") }),
    z.strictObject({
      kind: z.literal("when"),
      evidence_id: nonEmpty,
      condition: nonEmpty,
    }),
  ]),
  fact_ids: z.array(nonEmpty).min(1),
  recommendation: nonEmpty.optional(),
  decision: z.strictObject({
    kind: z.enum(SETUP_DECISION_KINDS),
    recommended_option: nonEmpty,
    option_ids: z.array(nonEmpty).min(2),
    agent_waits_when_served: z.literal(true),
    delegation: z.union([
      z.strictObject({
        allowed: z.literal(true),
        action: z.literal(SETUP_RECOMMENDATION_ACTION),
        selects_option: nonEmpty,
      }),
      z.strictObject({
        allowed: z.literal(false),
        reason: nonEmpty,
      }),
    ]),
  }).optional(),
  relay_protection: z.enum(["adaptive", "verbatim-list"]),
});
export type SetupHumanMomentProjection = z.infer<
  typeof SetupHumanMomentProjectionSchema
>;

/** Derive the typed routing lane from the same full semantic authority. */
export function projectSetupHumanMoment(
  moment: SetupHumanMoment,
): SetupHumanMomentProjection {
  const recommended = moment.kind === "decision"
    ? moment.options.find((option) => option.recommended)
    : undefined;
  const delegation = moment.kind === "decision"
    ? SETUP_DECISION_DELEGATION[moment.decision_kind]
    : undefined;
  return SetupHumanMomentProjectionSchema.parse({
    id: moment.id,
    kind: moment.kind,
    phase: moment.phase,
    purpose: moment.purpose,
    applicability: moment.applicability,
    fact_ids: setupHumanMomentFactIds(moment),
    ...(moment.recommendation === undefined
      ? {}
      : { recommendation: moment.recommendation }),
    ...(moment.kind === "decision" && recommended !== undefined
      ? {
        decision: {
          kind: moment.decision_kind,
          recommended_option: recommended.id,
          option_ids: moment.options.map((option) => option.id),
          agent_waits_when_served: true,
          delegation: delegation?.allowed === true
            ? {
              allowed: true,
              action: SETUP_RECOMMENDATION_ACTION,
              selects_option: recommended.id,
            }
            : {
              allowed: false,
              reason: delegation?.reason ?? "decision policy is unavailable",
            },
        },
      }
      : {}),
    relay_protection: moment.relay.protection,
  });
}

/** Fixed setup moments. Contextual consent choices are materialized in
 * `setup_messages.ts`, then validated by the same schema. */
export const SETUP_HUMAN_MOMENTS = [
  {
    id: "first-use-value",
    surfaces: ["welcome"],
    kind: "explanation",
    phase: "first contact",
    applicability: { kind: "always" },
    purpose: "Explain what this one-time setup changes for later coding work.",
    owner_outcome:
      "Later coding sessions inherit project-specific quality checks, isolated task workspaces, navigation, and operating instructions.",
    why:
      "Setup studies this repository and turns what it learns into the gate, worktree behavior, map, and project instructions. Those choices recur in future sessions, so the quality of this first pass affects the long-term experience.",
    current_action:
      "Choose the model for setup, then ask that coding agent to run `discern setup` in this project.",
    authority:
      "The owner chooses whether setup begins and which available model performs it.",
    reversibility:
      "Nothing is written by the welcome; setup later stays on a reviewable branch until the owner chooses to land it.",
    recovery:
      "If the owner is not ready, stop at the welcome. Running it again changes nothing.",
    recommendation:
      "Use the strongest suitable reasoning model available for this one-time repository study.",
    agent_behavior: {
      before_owner_action: "proceed",
      after_owner_action:
        "The selected coding agent runs the read-only preflight before any setup write.",
    },
    relay: {
      protection: "adaptive",
      message:
        "This one-time setup gives future coding sessions a reliable way to understand, change, and check this project. I will study the repository, work on a separate reviewable branch, and bring you only the choices that genuinely need you.",
      experienced:
        "I will commission the project once: derive its checks, task isolation, project guide, and agent instructions on a reviewable setup branch, while keeping consequential choices and landing with you.",
    },
  },
  {
    id: "model-selection",
    surfaces: ["welcome", "consent", "step-0"],
    kind: "decision",
    decision_kind: "model-selection",
    phase: "consent",
    applicability: { kind: "always" },
    purpose: "Choose the reasoning model for the one-time setup.",
    owner_outcome:
      "The gate, worktree policy, map, and project instructions inherited by later sessions are grounded in the best repository study the owner chooses to provide now.",
    why:
      "A stronger reasoning model is more likely to notice hidden boundaries, preserve existing workflows, challenge false assumptions, and write useful project context. Better analysis during setup reduces repeated correction and repository reading in later sessions.",
    current_action:
      "Use the coding tool's model selector. If changing models, open a fresh session in this project and paste `Run discern setup`.",
    authority:
      "The owner chooses the model. Before that choice, the executing agent reports `Current provider/model (self-declared): <identifier or unreported>` separately and never certifies its own capability.",
    reversibility:
      "No setup write has occurred. The owner can switch models or defer setup without changing the project.",
    recovery:
      "If model choice is unclear, leave setup unstarted and use the tool's model selector before opening a fresh project session.",
    recommendation:
      "Use the strongest suitable reasoning model available for this setup; switch before setup begins when a stronger option is available.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Proceed only when the owner chooses to continue in this session. If the owner switches, stop and let the fresh session restart the setup funnel.",
    },
    options: [
      {
        id: "strongest-suitable",
        label: "Use the strongest suitable model",
        consequence:
          "A fresh session authors the project context later sessions inherit.",
        owner_action:
          "Select it, open a fresh project session here, and paste `Run discern setup`.",
        agent_action: "I will stop here; I will not begin setup.",
        recommended: true,
      },
      {
        id: "continue-current",
        label: "Continue with the current model",
        consequence:
          "This model authors the project context later sessions inherit.",
        owner_action: "Confirm setup should continue here.",
        agent_action: "I record advisory provenance and continue.",
        recommended: false,
      },
    ],
    relay: {
      protection: "verbatim-list",
      message:
        "Everything I set up here is inherited by future sessions, so it is worth using your strongest suitable reasoning model. I will record the current provider and model as self-reported context, not as evidence of capability. Would you like to switch models first, or shall I carry on here? Nothing has been written yet.",
      experienced:
        "Setup authors persistent project context. I recommend the strongest suitable reasoning model available. Switch through the provider's model selector and restart with `Run discern setup`, or explicitly continue here; I will record self-declared provenance either way.",
    },
  },
  {
    id: "setup-started",
    surfaces: ["setup-started"],
    kind: "progress",
    phase: "project inspection",
    applicability: { kind: "always" },
    purpose: "Explain what has changed and what the agent will do next.",
    owner_outcome:
      "The owner can follow setup as bounded, reviewable stages instead of receiving an unexplained final configuration.",
    why:
      "Setup is establishing long-lived conditions for later agents. Stage-level narration lets the owner correct project intent without being asked to approve routine reversible edits.",
    current_action:
      "Inspect the repository and return only with facts the repository cannot establish or a consequential owner choice.",
    authority:
      "The agent may perform reversible setup authoring inside the approved footprint; consequential choices stay with the owner.",
    reversibility:
      "The work remains on the dedicated setup branch in reviewable commits.",
    recovery:
      "If the approved footprint or project intent is contradicted, stop before the conflicting effect and present the evidence.",
    agent_behavior: {
      before_owner_action: "proceed",
      after_owner_action:
        "Narrate each major stage with its owner benefit, then continue routine evidence-backed work.",
    },
    relay: {
      protection: "adaptive",
      message:
        "Setup is under way on a separate, reviewable branch. I am studying how this project already works before I change what future coding sessions inherit. I will handle routine reversible authoring and come back only when the code cannot answer an important question or a consequential choice needs you.",
      experienced:
        "The isolated setup branch is ready. I am gathering repository evidence before configuring the gate, worktrees, project guide, or instructions; routine reversible authoring continues without approval, and consequential choices return to you.",
    },
  },
  {
    id: "project-name-confirmation",
    surfaces: ["consent"],
    kind: "decision",
    decision_kind: "project-name-confirmation",
    phase: "project inspection",
    applicability: { kind: "always" },
    purpose:
      "Confirm the evidence-backed project name before authored setup content uses it.",
    owner_outcome:
      "The maintained project guide and agent instructions use the name the owner recognizes.",
    why:
      "README, package, and project metadata are stronger identity evidence than a clone suffix or the current directory name, but the owner remains the authority for how the project is named.",
    current_action:
      "Present the strongest supported name and its evidence, then ask the owner to confirm or correct it before authoring project context.",
    authority:
      "The repository supplies the recommendation; the owner's answer becomes the single project-name authority for every later setup step.",
    reversibility:
      "No authored project page adopts the proposed name before confirmation, and the answer can be corrected before landing.",
    recovery:
      "If evidence conflicts, show the candidates and keep the name unresolved until the owner chooses.",
    recommendation:
      "Use the strongest name supported by README, package, or project metadata; use the directory basename only as a labeled fallback.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Record the confirmed name once and use that authority throughout the remaining setup journey.",
    },
    options: [
      {
        id: "confirm-evidence-backed-name",
        label: "Use the proposed project name",
        consequence:
          "The project guide and agent instructions use the name supported by the displayed metadata.",
        owner_action:
          "Confirm the proposed name or use the recommendation action.",
        agent_action:
          "Record the confirmed name as the only name authority for later setup authoring.",
        recommended: true,
      },
      {
        id: "correct-project-name",
        label: "Correct the project name",
        consequence:
          "The project guide and agent instructions use the owner's corrected name instead.",
        owner_action: "Provide the name the project should use.",
        agent_action:
          "Record the correction as the only name authority for later setup authoring.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "The strongest project name I found is <name>, supported by <evidence>. That is the name I will use in the maintained project guide and the instructions future coding sessions inherit. Is it right, or should I use a different name?",
      experienced:
        "<evidence> supports <name> as the project name. Confirm or correct it before I persist it in the project guide and agent instructions.",
    },
  },
  {
    id: "external-reference-inspection",
    surfaces: ["step-1"],
    kind: "decision",
    decision_kind: "external-reference-inspection",
    phase: "project inspection",
    applicability: {
      kind: "when",
      evidence_id: "repository-external-reference",
      condition:
        "A project file names an absolute path or a destination outside the repository.",
    },
    purpose:
      "Ask before inspecting a destination outside the project that a project file references.",
    owner_outcome:
      "Setup can use relevant cross-project evidence without normalizing unprompted inspection of another checkout or private directory.",
    why:
      "A project-owned reference is evidence that the destination may matter, but it is not permission to read beyond this repository.",
    current_action:
      "Report the source file, external destination, and apparent role without reading the destination, then ask for specific permission.",
    authority:
      "Only the owner can extend setup inspection beyond the repository root.",
    reversibility:
      "Nothing outside the project has been read, diffed, or changed before the owner answers.",
    recovery:
      "Continue using only the in-project reference and record the evidence limit when permission is declined or absent.",
    recommendation:
      "Inspect the external destination only when it is needed to settle a concrete setup question.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Read only the named destination under explicit permission, or continue without it.",
    },
    options: [
      {
        id: "allow-specific-inspection",
        label: "Allow this specific inspection",
        consequence:
          "Setup may read the named destination only to answer the stated project question; mutation remains unauthorized.",
        owner_action: "Explicitly permit inspection of the displayed path.",
        agent_action:
          "Record the direction and inspect only the named destination for the stated purpose.",
        recommended: true,
      },
      {
        id: "stay-inside-project",
        label: "Stay inside this project",
        consequence:
          "Setup uses only the reference text and records any resulting evidence limit.",
        owner_action: "Decline or defer external inspection.",
        agent_action:
          "Do not read the destination; continue with repository-local evidence.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "<source file> points to <external path>, which appears to be <role>. I have not opened it. It may answer <specific setup question>; may I look at that location for this purpose, or should I stay inside this project?",
      experienced:
        "<source file> references the repository-external path <external path> as <role>. No destination read has occurred. Authorize that bounded inspection for <specific setup question>, or I will continue with repository-local evidence only.",
    },
  },
  {
    id: "project-intent-gap",
    surfaces: ["step-1"],
    kind: "decision",
    decision_kind: "project-intent-gap",
    phase: "project inspection",
    applicability: {
      kind: "when",
      evidence_id: "project-intent-unsettled",
      condition:
        "Repository evidence cannot settle a product fact or two meanings conflict.",
    },
    purpose:
      "Resolve missing product intent without turning routine discovery into an interview.",
    owner_outcome:
      "Future project context reflects the owner's product meaning while technical claims remain grounded in the repository.",
    why:
      "An invented product rule can misdirect every later session; repeated questions about facts already in code waste the owner's attention.",
    current_action:
      "Present one bounded batch naming the missing fact, evidence inspected, and decision needed.",
    authority:
      "Repository evidence owns technical behavior; the owner owns product intent absent from that evidence.",
    reversibility:
      "No conflicting meaning is written until the owner answers; an unresolved fact can remain a labeled ledger item.",
    recovery:
      "Preserve both interpretations and record the unresolved fact with its evidence and consequence.",
    recommendation:
      "Prefer the meaning supported by current behavior unless the owner states a different intended product rule.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Use the chosen meaning, or record the item as unresolved when the owner defers it.",
    },
    options: [
      {
        id: "confirm-evidenced-meaning",
        label: "Confirm the evidenced meaning",
        consequence:
          "Setup documents the behavior already supported by code and configuration.",
        owner_action: "Confirm the presented interpretation.",
        agent_action: "Proceed using the cited evidence.",
        recommended: true,
      },
      {
        id: "supply-or-defer-intent",
        label: "Supply or defer different intent",
        consequence:
          "Setup records the owner's intended meaning, or leaves one concrete open item when implementation does not yet support it.",
        owner_action: "State the intended rule or say to defer the decision.",
        agent_action:
          "Document implemented behavior and record any unsupported intent as an open item.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "The project does not answer one product question: <missing fact>. I checked <evidence>, and my recommendation is <evidenced meaning>. Should I use that meaning, use a different intention you provide, or leave one clearly marked open item? I have not written the disputed meaning yet.",
      experienced:
        "Repository evidence leaves <missing fact> unresolved after checking <evidence>. I recommend <evidenced meaning>. Confirm it, supply different product intent, or defer it as one evidenced open item; I will not write the disputed claim before your choice.",
    },
  },
  {
    id: "gate-protection-change",
    surfaces: ["step-2"],
    kind: "decision",
    decision_kind: "gate-protection-change",
    phase: "Gate configuration",
    applicability: {
      kind: "when",
      evidence_id: "gate-protection-choice",
      condition:
        "A useful protection is missing and adding it requires a new dependency, access, cost, or independent command choice.",
    },
    purpose:
      "Choose whether setup may add tooling or a consequential gate action.",
    owner_outcome:
      "Later agents receive useful automatic feedback without setup rewriting project workflows or adding unapproved cost, access, or dependencies.",
    why:
      "The gate sets the feedback floor for future work. Adding tools can also change lockfiles, runtime, network access, and maintenance obligations.",
    current_action:
      "Show the missing protection, recommendation, project impact, and the command that would change the project.",
    authority:
      "Setup may reuse existing commands. The owner authorizes new dependencies, network access, paid services, and independent command changes.",
    reversibility:
      "Existing commands remain byte-identical; any approved tool addition receives its own revertible commit.",
    recovery:
      "Leave the protection applicable and absent, record the gap, and continue with the workflows already supported.",
    recommendation:
      "Reuse an existing project command when it supplies the protection; otherwise recommend the smallest project-native addition and wait for approval.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Apply only the approved effect, or leave the expected protection visibly absent.",
    },
    options: [
      {
        id: "approve-protection",
        label: "Approve the proposed protection",
        consequence:
          "Setup adds the stated dependency or command effect and wires it into the gate in a separate commit.",
        owner_action:
          "Authorize the named effect and its stated cost or maintenance consequence.",
        agent_action: "Apply, prove, and commit only that approved change.",
        recommended: true,
      },
      {
        id: "keep-gap-visible",
        label: "Keep the protection absent",
        consequence:
          "Assurance reports the expected protection as absent rather than claiming it does not apply.",
        owner_action: "Decline or defer the proposed effect.",
        agent_action:
          "Record the gap and continue without installing or rewriting anything.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "Future changes currently get no automatic <feedback>. I recommend <smallest project-native addition>. That would change <dependency, access, cost, or command>. Would you like me to add that protection, or leave the gap visible? I will make no such change before you choose.",
      experienced:
        "The final quality check lacks <protection>. I recommend <smallest project-native addition>; it changes <dependency, access, cost, or command>. Approve that effect or keep the gap explicit. I will not infer consent or mark it inapplicable.",
    },
  },
  {
    id: "authored-source-collision",
    surfaces: ["step-3"],
    kind: "decision",
    decision_kind: "authored-source-collision",
    phase: "scaffold reconciliation",
    applicability: {
      kind: "when",
      evidence_id: "authored-source-collision",
      condition:
        "Two authored sources claim incompatible ownership of one file or meaning.",
    },
    purpose:
      "Choose which authored source owns the conflicting project knowledge.",
    owner_outcome:
      "Future sessions read one durable authority without existing owner material being discarded by inference.",
    why:
      "Parallel authorities drift, while deleting one without consent can erase project policy.",
    current_action:
      "Show both sources, their meanings, and what each ownership choice preserves or displaces.",
    authority:
      "The owner decides an irreconcilable ownership collision; generated outputs never become the authority.",
    reversibility:
      "Both authored meanings remain preserved until the owner chooses; the reconciliation receives a separate commit.",
    recovery:
      "Keep both sources unchanged and record the collision when no answer is available.",
    recommendation:
      "Prefer the configured authored source and import the other source's unique owner policy into it.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Reconcile only the selected ownership path and preserve unique policy.",
    },
    options: [
      {
        id: "canonicalize-configured-source",
        label: "Use the configured authored source",
        consequence:
          "Unique existing policy is folded into the configured source and generated files derive from it.",
        owner_action: "Confirm the configured source as the authority.",
        agent_action: "Reconcile and refresh generated projections.",
        recommended: true,
      },
      {
        id: "retain-separate-owner-source",
        label: "Retain separate owner material",
        consequence:
          "Setup leaves that material independent and records the unresolved overlap when meanings cannot coexist.",
        owner_action:
          "Identify the material that must remain independently owned.",
        agent_action:
          "Preserve it and avoid claiming a single reconciled authority.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "Two project-owned instruction sources disagree: <paths and meanings>. I recommend <ownership choice> because it keeps one lasting authority while preserving <unique owner material>. Should I use that arrangement, or keep the sources separate? Both remain unchanged until you choose.",
      experienced:
        "Authored sources <paths> claim incompatible ownership of <meaning>. I recommend <ownership choice> while preserving <unique owner material>. Confirm the authority or keep both unchanged; I will not resolve the collision by inference.",
    },
  },
  {
    id: "lasting-project-context",
    surfaces: ["step-4", "step-5", "step-6", "step-9"],
    kind: "explanation",
    phase: "project context",
    applicability: { kind: "always" },
    purpose: "Explain why this documentation affects later coding sessions.",
    owner_outcome:
      "Future agents start with the project's verified boundaries, invariants, commands, and owner policies instead of rediscovering them or inventing replacements.",
    why:
      "The map and instruction source are committed project context. Better context reduces repository reading, makes incorrect assumptions easier for the owner to audit, and guides later changes after this setup session ends.",
    current_action:
      "Author only verified, durable context and show the owner the proposed primary-subsystem understanding before final synthesis.",
    authority:
      "Code and configuration own behavior; the owner owns product intent; the map records durable context those authorities do not express by themselves.",
    reversibility:
      "The authored pages are ordinary reviewable files on the setup branch.",
    recovery:
      "Narrow an unsupported claim or make it a concrete open item with its evidence and consequence.",
    recommendation:
      "Invest detail in the primary subsystem and add another page only when it will reduce future repository reading.",
    agent_behavior: {
      before_owner_action: "proceed",
      after_owner_action:
        "Keep the documentation present-tense, evidence-linked, and proportional to durable boundaries.",
    },
    relay: {
      protection: "adaptive",
      message:
        "I am turning what the repository shows into a maintained project guide and one set of instructions for future coding sessions. Later agents can start in the right place and follow the project's important rules without asking you to explain them again.",
      experienced:
        "Repository evidence is becoming the project-owned map and instruction source: durable navigation and operating constraints future agents inherit across providers.",
    },
  },
  {
    id: "owner-policy-conflict",
    surfaces: ["step-5"],
    kind: "decision",
    decision_kind: "owner-policy-conflict",
    phase: "instruction draft",
    applicability: {
      kind: "when",
      evidence_id: "owner-policy-conflict",
      condition:
        "An imported owner policy conflicts with discern's required workflow or current repository behavior.",
    },
    purpose:
      "Resolve the policy meaning without deleting an owner instruction by inference.",
    owner_outcome:
      "Future sessions receive a coherent instruction set that preserves the owner's intended boundary.",
    why:
      "Always-loaded instructions steer every later task. An unresolved contradiction creates inconsistent behavior; deleting one side can erase a real owner constraint.",
    current_action:
      "Quote the conflicting rules, show their operational consequence, and recommend the narrowest compatible wording.",
    authority:
      "The owner decides project policy; discern's required safety and authority workflow cannot be weakened by setup copy.",
    reversibility:
      "The imported policy remains in the authored source until the owner chooses a reconciliation.",
    recovery: "Keep the conflict visible and record it as an open policy item.",
    recommendation:
      "Preserve the owner's underlying intent and rewrite only the conflicting mechanism when a compatible form exists.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Apply the selected policy wording, then refresh and inspect every generated projection.",
    },
    options: [
      {
        id: "compatible-reconciliation",
        label: "Adopt the compatible reconciliation",
        consequence:
          "Future sessions receive one enforceable rule preserving the owner's underlying intent.",
        owner_action: "Approve the proposed narrow wording.",
        agent_action: "Update the authored source and refresh generated files.",
        recommended: true,
      },
      {
        id: "leave-policy-open",
        label: "Leave the policy unresolved",
        consequence:
          "Setup preserves the original instruction and records the contradiction for owner review.",
        owner_action: "Defer the policy decision.",
        agent_action:
          "Do not delete either meaning; record the concrete conflict.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "One existing project rule, <rule>, would conflict with <required workflow or current behavior> and cause <consequence>. I recommend <compatible wording>, which keeps the rule's intent without that conflict. Approve that future-work policy, or leave the disagreement open; I will not delete or rewrite it by inference.",
      experienced:
        "Imported policy <rule> conflicts with <required workflow or current behavior>, causing <consequence>. I recommend <compatible wording>. Approve that durable policy change or keep the conflict unresolved; no owner rule will be removed by inference.",
    },
  },
  {
    id: "first-green-gate",
    surfaces: ["step-2", "step-7"],
    kind: "progress",
    phase: "Gate Proof",
    applicability: {
      kind: "when",
      evidence_id: "first-green-gate",
      condition:
        "The configured project checks first pass together through discern.",
    },
    purpose: "Mark the first green gate as an owner-visible setup milestone.",
    owner_outcome:
      "The owner knows which protections now run automatically and which expected protections remain absent or do not apply.",
    why:
      "A green result means the configured feedback loop runs; it does not prove unconfigured protections or authorize landing.",
    current_action:
      "Report the enforced protections, absences, and applicability before final documentation freezes the configuration.",
    authority:
      "The gate result verifies configured commands; the owner still controls consequential additions and landing.",
    reversibility:
      "Gate wiring remains reviewable on the setup branch, and each independent tool addition has its own commit.",
    recovery:
      "Use the failing job's diagnostic, or leave an unapproved protection visibly absent.",
    agent_behavior: {
      before_owner_action: "proceed",
      after_owner_action:
        "Narrate the milestone with scoped assurance, then continue the remaining setup steps.",
    },
    relay: {
      protection: "adaptive",
      message:
        "The project's checks now pass together through discern's final quality check, the gate. It runs <enforced protections>; <absent protections> are still missing, and <inapplicable protections> do not apply. This proves the configured feedback loop, not permission to land. I am continuing with the separate-workspace check and final context review.",
      experienced:
        "The configured gate is green with <enforced protections>; <absent protections> remain absent and <inapplicable protections> are excluded. This is scoped evidence, not landing authority. Worktree Proof and the final context recheck remain.",
    },
  },
  {
    id: "subsystem-sanity-check",
    surfaces: ["step-6"],
    kind: "decision",
    decision_kind: "subsystem-sanity-check",
    phase: "Map scope design",
    applicability: { kind: "always" },
    purpose:
      "Let the owner correct the agent's project mental model before it becomes lasting context.",
    owner_outcome:
      "The map starts future sessions in the right subsystem with a correct boundary and non-obvious invariant.",
    why:
      "Repository evidence can show structure while missing product ownership or the most useful starting point. A lightweight sanity check catches that error before it is inherited.",
    current_action:
      "Present the proposed primary subsystem, start point, boundary, invariant, and any additional durable pages in one bounded relay.",
    authority:
      "The owner corrects product ownership and intended boundaries; page count follows durable evidence rather than preference.",
    reversibility:
      "Final pages have not yet been synthesized and the proposed plan can change without discarding completed setup work.",
    recovery:
      "Revise the mental model from the owner's correction, or leave the disputed boundary as a concrete open item.",
    recommendation:
      "Confirm the evidence-backed primary subsystem and correct only substantive boundary or ownership errors.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Incorporate the correction, then continue to the smoke check before final documentation synthesis.",
    },
    options: [
      {
        id: "confirm-mental-model",
        label: "Confirm the project understanding",
        consequence:
          "The bounded page plan proceeds to the smoke check and final synthesis.",
        owner_action:
          "Confirm the proposed start point, boundary, and invariant.",
        agent_action: "Retain the plan and continue.",
        recommended: true,
      },
      {
        id: "correct-mental-model",
        label: "Correct the project understanding",
        consequence:
          "The map plan changes before future sessions inherit an incorrect boundary or starting point.",
        owner_action:
          "State the boundary, ownership, or starting-point correction.",
        agent_action:
          "Recheck the correction against code and revise the plan.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "Here is my read: the heart of this project is <plain primary area>, and a future agent should begin at <path>. <other durable area account>. One important rule I found is <concrete rule>. I recommend writing the maintained project guide that way. Have I misunderstood anything important?",
      experienced:
        "I read <name> as the primary subsystem, starting at <path>, with <boundary>; the concrete invariant is <invariant>, and the additional durable regions are <list or none>. Confirm or correct that model.",
    },
  },
  {
    id: "worktree-resource-policy",
    surfaces: ["step-7"],
    kind: "decision",
    decision_kind: "worktree-resource-policy",
    phase: "worktree readiness and smoke",
    applicability: {
      kind: "when",
      evidence_id: "worktree-resource-consequence",
      condition:
        "A worktree need would spend money, touch durable data, share mutable state, broaden access, or make binary merges consequential.",
    },
    purpose: "Choose the resource policy for parallel task workspaces.",
    owner_outcome:
      "Later worktrees avoid accidental shared-data mutation, unexpected cost, credential spread, and unacceptable binary conflicts.",
    why:
      "Parallel workspaces are isolated only when their external state is compatible with concurrency; setup cannot infer the owner's data, cost, or access tolerance.",
    current_action:
      "Present the concrete resource, concurrent behavior, cost or data consequence, recommended policy, and lower-impact alternative.",
    authority:
      "The owner decides cost, durable data, shared credentials, destructive teardown, and binary-merge policy.",
    reversibility:
      "No owner-gated resource is created or mutated before the decision; unresolved policy remains a concrete ledger item.",
    recovery:
      "Leave the resource unconfigured and keep smoke bounded to what the project can prove without it.",
    recommendation:
      "Prefer isolated disposable state with idempotent creation and teardown; share a resource only under an explicit compatible policy.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Configure only the authorized resource behavior, or record the unresolved policy without creating the resource.",
    },
    options: [
      {
        id: "approve-resource-policy",
        label: "Approve the proposed resource policy",
        consequence:
          "Setup configures the named isolation, sharing, creation, or teardown behavior with the stated cost and data boundary.",
        owner_action: "Authorize the concrete policy and consequence.",
        agent_action: "Configure and smoke-test only the approved behavior.",
        recommended: true,
      },
      {
        id: "defer-resource-policy",
        label: "Defer the resource policy",
        consequence:
          "Setup leaves the resource unconfigured and records the blocked workflow as a concrete open item.",
        owner_action: "Decline or defer the resource effect.",
        agent_action:
          "Create no resource and preserve the unresolved evidence.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "Parallel tasks would both affect <resource>. In practice, <observable concurrent behavior>, with this consequence: <cost, data, access, or merge consequence>. I recommend <plain policy>; the lower-impact alternative is <alternative>. Which policy do you want? I will not create or change the resource before you choose.",
      experienced:
        "Concurrent worktrees would share <resource>, producing <behavior> and <consequence>. I recommend <isolated policy>; <alternative> is the lower-impact option. Authorize one concrete policy or defer it. No owner-gated resource will be created first.",
    },
  },
  {
    id: "coordination-explained",
    surfaces: ["step-8"],
    kind: "explanation",
    phase: "complete validation and coordination",
    applicability: { kind: "always" },
    purpose:
      "Explain how the project's checks will be reused and coordinated once several efforts run at once.",
    owner_outcome:
      "The owner knows which evidence is produced again for every commit and which is reused, how many efforts can validate at the same time, and whether efforts can be validated before their predecessors land.",
    why:
      "Coordination settings look like performance knobs but change what is verified and when. An owner who understands the default (validate and land in order) can judge whether early validation is worth its preparation, restore, and discarded-work cost for this project.",
    current_action:
      "State the evidence-reuse facts, the number of simultaneous validations and the setting that limits it, and whether early validation is on; when it stays off, say why in one sentence.",
    authority:
      "Setup configures reuse and ordering from repository evidence. Declaring an environment that spends money, shares durable state, or destroys data is the owner's decision.",
    reversibility:
      "Every coordination setting is a reviewable line in discern.toml on the setup branch; lowering lookahead to 0 always returns to ordering-only behavior.",
    recovery:
      "When the environment cannot be declared safely, leave lookahead at 0 and record the unmet declaration as one concrete open item.",
    recommendation:
      "Keep ordering-only coordination until the project has a restore procedure setup can prove; enable early validation only after that proof.",
    agent_behavior: {
      before_owner_action: "proceed",
      after_owner_action:
        "Continue with the final documentation; no owner reply is required for an explanation.",
    },
    relay: {
      protection: "adaptive",
      message:
        "Here is how discern will run your checks when several tasks are in flight. Evidence for <candidate-bound producers> is produced again for every commit; evidence for <declared producers> is reused when nothing it reads has changed. Up to <count> tasks can validate at the same time, limited by <setting>. Early validation of a task before the one ahead of it lands is <on or off>: <reason in plain words>.",
      experienced:
        "Reuse: <declared producers> declare closures; <candidate-bound producers> stay candidate-bound. Concurrency: <count> simultaneous validations, bound by <setting>. Speculation: <on or off> because <reason>.",
    },
  },
  {
    id: "documentation-claim-gap",
    surfaces: ["step-9"],
    kind: "decision",
    decision_kind: "documentation-claim-gap",
    phase: "final documentation synthesis",
    applicability: {
      kind: "when",
      evidence_id: "documentation-claim-unverified",
      condition:
        "A product or architecture claim remains consequential but cannot be verified after smoke.",
    },
    purpose:
      "Choose whether missing owner intent resolves the claim or the documentation keeps it open.",
    owner_outcome:
      "Future sessions do not inherit a confident statement that current code and configuration cannot support.",
    why:
      "A false map claim can steer later work more strongly than no claim because agents treat committed project context as an authority.",
    current_action:
      "Show the proposed claim, evidence checked, missing authority, and the concrete open-item wording.",
    authority:
      "Current code and configuration own behavior; the owner may supply product intent but cannot turn absent implementation into current behavior.",
    reversibility:
      "The claim stays out of present-tense documentation until evidence exists; the open item can be resolved later.",
    recovery: "Narrow or remove the claim and retain one evidenced open item.",
    recommendation:
      "Keep unverifiable behavior out of present-tense documentation and record the unresolved decision or defect.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Document only supported behavior; use owner input as intent and keep missing implementation open.",
    },
    options: [
      {
        id: "record-open-item",
        label: "Record the claim as open",
        consequence:
          "The map stays factual and the ledger names the missing decision or implementation with evidence.",
        owner_action: "Confirm that the unresolved item should remain visible.",
        agent_action:
          "Remove the confident claim and record the concrete item.",
        recommended: true,
      },
      {
        id: "supply-product-intent",
        label: "Supply product intent",
        consequence:
          "The map may record the intent as such, while absent implementation remains an open item rather than current behavior.",
        owner_action: "State the intended product rule.",
        agent_action:
          "Separate intent from verified behavior and retain any implementation gap.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "I cannot yet support this statement about the project: <claim>. I checked <evidence>, but <authority> is missing. I recommend leaving the claim out of the current project guide and recording <open item> instead. You can confirm that cautious route or tell me the intended product rule.",
      experienced:
        "Claim <claim> remains unverified after <evidence>; <authority> is missing. I recommend omitting it from present-tense documentation and recording <open item>. Confirm, supply product intent, or explicitly use the recommendation; absent implementation stays open.",
    },
  },
  {
    id: "completion-handoff",
    surfaces: ["step-10", "setup-done"],
    kind: "completion",
    phase: "completion handoff",
    applicability: {
      kind: "when",
      evidence_id: "setup-proof-current",
      condition:
        "The clean final setup commit has passed `discern setup done`.",
    },
    purpose:
      "Explain what future sessions now inherit before asking the owner to land it.",
    owner_outcome:
      "The owner receives the project's primary subsystem, decision principles, automated protections, open items, canonical counts, Proof, and branch state in one reviewable account.",
    why:
      "Mechanical counts prove internal consistency but do not explain the working conditions setup created for future coding sessions.",
    current_action:
      "Relay the derived qualitative project context beside the canonical inventory, scoped assurance, Proof line, and landing choices.",
    authority:
      "The completion result derives counts and project context from committed authorities; Proof does not grant landing authority.",
    reversibility:
      "An unlanded setup remains on its branch for review; no tracked mutation follows Proof.",
    recovery:
      "If any context is missing or wrong, correct its authority, commit, and run `discern setup done` again for the new tree.",
    agent_behavior: {
      before_owner_action: "proceed",
      after_owner_action:
        "Present the complete handoff and stop at the landing decision when authority is absent.",
    },
    relay: {
      protection: "verbatim-list",
      message:
        "Setup is ready for review. Later agents will begin in <plain primary area> at <start point>. The other lasting areas are <durable areas>. One important rule setup found is <concrete rule>. The final quality check now runs <protections>, with <gaps> still open. <open items>. The finished change passed the project's checks (Proof): <Proof line>. That evidence belongs to this exact commit and does not give permission to land. The setup remains on <branch> until you decide what reaches <trunk>.",
      experienced:
        "Completion covers primary area <name> at <start>, durable regions <areas>, invariant <rule>, enforced and absent checks, open items, canonical inventory, and <Proof>. Proof binds to the current commit and grants no landing authority; <branch> remains unlanded pending the owner's choice.",
    },
  },
  {
    id: "landing-choice",
    surfaces: ["step-10", "setup-done"],
    kind: "decision",
    decision_kind: "landing-choice",
    phase: "landing handoff",
    applicability: {
      kind: "when",
      evidence_id: "proved-setup-unlanded",
      condition: "Proved setup is ready on a branch that is not yet the trunk.",
    },
    purpose: "Choose whether the proved setup reaches the project's trunk now.",
    owner_outcome:
      "The owner can land the configured working conditions, leave them for review, or decline them with the branch state explicit.",
    why:
      "Future sessions on the trunk cannot use setup until it lands, while a green Proof verifies the branch and grants no authority to merge it.",
    current_action:
      "Review the completion handoff and choose land now, leave for review, or decline.",
    authority:
      "The owner or a recorded grant authorizes landing; the agent cannot infer that authority from approval of earlier setup steps.",
    reversibility:
      "Leaving the branch changes nothing on the trunk. Landing is a Git fast-forward and later changes use normal project history.",
    recovery:
      "Leave the proved branch unlanded and report its path and target branch.",
    recommendation:
      "Land the proved setup when the qualitative handoff matches the project; otherwise leave the branch for review.",
    agent_behavior: {
      before_owner_action: "wait",
      after_owner_action:
        "Land only under applicable authority; otherwise stop with the branch explicitly unlanded.",
    },
    options: [
      {
        id: "land-now",
        label: "Land the proved setup",
        consequence:
          "The setup commit reaches the trunk and provider activation can begin in a fresh session.",
        owner_action:
          "Authorize the displayed landing command for this branch.",
        agent_action:
          "Run the result's supported acceptance path under that authority.",
        recommended: true,
      },
      {
        id: "leave-for-review",
        label: "Leave the branch for review",
        consequence:
          "The trunk remains unchanged and future trunk sessions do not yet inherit setup.",
        owner_action: "Defer landing or request changes.",
        agent_action:
          "Stop without restart, activation, improvement, or post-Proof mutation.",
        recommended: false,
      },
      {
        id: "decline-setup",
        label: "Decline the setup",
        consequence:
          "The trunk remains unchanged; the owner may later remove the setup branch through the normal Git workflow.",
        owner_action: "State that setup should not land.",
        agent_action:
          "Stop and report the unlanded branch without deleting owner data.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "The proved setup is still on <branch>, so future sessions on <trunk> do not use it yet. The Proof that the finished change passed the project's checks (Proof) belongs to this exact branch; it is not permission to merge. I recommend landing only if the project account above looks right. Would you like to land it now, leave it for review, or decline it? I will wait; nothing else will change before your choice.",
      experienced:
        "<branch> is proved and absent from <trunk>. Proof verifies the commit and grants no landing authority. Authorize landing, leave the branch for review, or decline it; I will wait, and no restart, activation, or post-Proof mutation occurs first.",
    },
  },
  {
    id: "activation-handoff",
    surfaces: ["step-10", "setup-accept", "activation"],
    kind: "progress",
    phase: "provider activation",
    applicability: {
      kind: "when",
      evidence_id: "proved-setup-landed",
      condition: "Proved setup is available on the trunk.",
    },
    purpose:
      "Move the owner into a fresh session and verify that discern is active there.",
    owner_outcome:
      "The first post-setup session proves it loaded the new project instructions and provider integration before ordinary work begins.",
    why:
      "Coding tools load MCP servers, hooks, and project instructions at session start. The setup session cannot prove what a future session loaded.",
    current_action:
      "Start the provider-specific fresh session, run the result's activation check, and report the observed result or recovery.",
    authority:
      "The provider adapter owns the activation command; generated files or agent confidence are not activation evidence.",
    reversibility:
      "A failed check changes no project file and routes to the provider-specific recovery or CLI fallback.",
    recovery:
      "Follow the exact provider recovery, start another fresh session if required, and repeat the same activation check.",
    recommendation:
      "Verify activation before starting ordinary project work or considering the optional improvement review.",
    agent_behavior: {
      before_owner_action: "proceed",
      after_owner_action:
        "Report the activation result; offer `discern improvement --json` only after every applicable check succeeds.",
    },
    relay: {
      protection: "adaptive",
      message:
        "Setup is now in the main shared version. Open the provider's fresh project session, inspect its registered tools before opening external documentation, and invoke the exact local activation action shown below. Report what it returns. If the action is missing, follow the provider-specific local recovery or `discern doctor`; do not repeat an effectful setup command to recover output.",
      experienced:
        "Setup is landed. In a fresh provider session, inspect the registered tool inventory, invoke the adapter-owned local activation callable, and report the result. A missing callable routes to its local registration recovery or `discern doctor`, never an effectful rerun.",
    },
  },
] as const satisfies readonly SetupHumanMoment[];

/** Validate registry-wide membership and every semantic contract. */
export function validateSetupHumanMomentRegistry(
  moments: readonly unknown[],
): asserts moments is readonly SetupHumanMoment[] {
  const ids = new Set<string>();
  const enrolledSurfaces = new Set<SetupHumanSurface>();
  const enrolledDecisionKinds = new Set<SetupDecisionKind>();
  for (const [index, candidate] of moments.entries()) {
    const parsed = SetupHumanMomentSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        `Setup human moment at index ${index} is invalid: ${parsed.error.message}`,
      );
    }
    if (ids.has(parsed.data.id)) {
      throw new Error(`Duplicate setup human moment id: ${parsed.data.id}`);
    }
    ids.add(parsed.data.id);
    if (parsed.data.kind === "decision") {
      if (enrolledDecisionKinds.has(parsed.data.decision_kind)) {
        throw new Error(
          `Duplicate setup decision kind: ${parsed.data.decision_kind}`,
        );
      }
      enrolledDecisionKinds.add(parsed.data.decision_kind);
    }
    const momentSurfaces = new Set<SetupHumanSurface>();
    for (const surface of parsed.data.surfaces) {
      if (momentSurfaces.has(surface)) {
        throw new Error(
          `Setup human moment ${parsed.data.id} repeats surface: ${surface}`,
        );
      }
      momentSurfaces.add(surface);
      enrolledSurfaces.add(surface);
    }
  }
  for (const surface of SETUP_HUMAN_SURFACES) {
    if (!enrolledSurfaces.has(surface)) {
      throw new Error(`Setup human surface has no moment: ${surface}`);
    }
  }
  for (const decisionKind of SETUP_DECISION_KINDS) {
    if (!enrolledDecisionKinds.has(decisionKind)) {
      throw new Error(`Setup decision kind has no moment: ${decisionKind}`);
    }
  }
}

validateSetupHumanMomentRegistry(SETUP_HUMAN_MOMENTS);

const SETUP_HUMAN_MOMENT_BY_ID = new Map<string, SetupHumanMoment>(
  SETUP_HUMAN_MOMENTS.map((moment) => [
    moment.id,
    SetupHumanMomentSchema.parse(moment),
  ]),
);

/** Resolve authored moment ids in their authored order. */
export function resolveSetupHumanMoments(
  ids: readonly string[],
): SetupHumanMoment[] {
  const resolved: SetupHumanMoment[] = [];
  for (const id of ids) {
    const moment = SETUP_HUMAN_MOMENT_BY_ID.get(id);
    if (moment === undefined) {
      throw new Error(`Unknown setup human moment id: ${id}`);
    }
    resolved.push(SetupHumanMomentSchema.parse(moment));
  }
  return resolved;
}

/** The registry members bound to one lifecycle or setup-page surface. */
export function setupHumanMomentsForSurface(
  surface: SetupHumanSurface,
): SetupHumanMoment[] {
  return SETUP_HUMAN_MOMENTS.filter((moment) =>
    moment.surfaces.includes(surface as never)
  ).map((moment) => SetupHumanMomentSchema.parse(moment));
}

/** Force each fixed lifecycle consumer to handle the complete registered surface.
 * Setup pages perform the same exact comparison while parsing their authored ids. */
export function assertSetupHumanSurfaceConsumption(
  surface: SetupHumanSurface,
  consumedIds: readonly string[],
): void {
  const expectedIds = setupHumanMomentsForSurface(surface).map((moment) =>
    moment.id
  );
  if (
    consumedIds.length !== expectedIds.length ||
    consumedIds.some((id, index) => id !== expectedIds[index])
  ) {
    throw new Error(
      `Setup human surface ${surface} must consume ${
        expectedIds.join(", ") || "(none)"
      }; found ${consumedIds.join(", ") || "(none)"}.`,
    );
  }
}

/** Evidence that makes one conditional moment applicable in the current repo. */
export interface SetupMomentEvidence {
  readonly evidenceId: string;
  readonly satisfied: boolean;
  readonly detail: string;
}

/** A served owner projection. Conditional moments return no projection absent evidence. */
export interface SetupOwnerMomentRendering {
  readonly id: string;
  readonly audience: SetupOwnerAudience;
  readonly message: string;
  readonly factIds: readonly string[];
  readonly waitsForOwner: boolean;
}

/** Stable fact identifiers derived from semantic roles, never English substrings. */
export function setupHumanMomentFactIds(
  moment: SetupHumanMoment,
): string[] {
  const ids: string[] = [];
  for (const role of SETUP_HUMAN_FACT_ROLES) {
    const shape = SETUP_HUMAN_FACT_ROLE_SHAPES[role];
    if (shape === "common") {
      ids.push(`${moment.id}:${role}`);
    } else if (shape === "recommended") {
      if (moment.recommendation !== undefined) {
        ids.push(`${moment.id}:${role}`);
      }
    } else if (shape === "option") {
      if (moment.kind === "decision") {
        for (const option of moment.options) {
          ids.push(`${moment.id}:option:${option.id}:${role}`);
        }
      }
    } else if (moment.kind === "decision") {
      ids.push(`${moment.id}:${role}`);
    }
  }
  return ids;
}

/** True only when this moment's structural applicability is established. */
export function setupHumanMomentApplies(
  moment: SetupHumanMoment,
  evidence?: SetupMomentEvidence,
): boolean {
  if (moment.applicability.kind === "always") return true;
  return evidence?.satisfied === true &&
    evidence.evidenceId === moment.applicability.evidence_id;
}

/**
 * Render one owner-language reading from the same record as the operational
 * projection. An absent trigger produces no question and therefore no wait.
 */
export function renderSetupOwnerMoment(
  moment: SetupHumanMoment,
  audience: SetupOwnerAudience,
  evidence?: SetupMomentEvidence,
): SetupOwnerMomentRendering | undefined {
  if (!setupHumanMomentApplies(moment, evidence)) return undefined;
  const base = audience === "novice"
    ? moment.relay.message
    : moment.relay.experienced;
  const delegation = moment.kind === "decision"
    ? SETUP_DECISION_DELEGATION[moment.decision_kind]
    : undefined;
  const recommended = moment.kind === "decision"
    ? moment.options.find((option) => option.recommended)
    : undefined;
  const delegationLine = delegation?.allowed === true &&
      recommended !== undefined
    ? audience === "novice"
      ? ` If you want me to make the safe technical call, reply “use your recommendation”; I will record that direction and select “${recommended.label}.”`
      : ` Reply \`${SETUP_RECOMMENDATION_ACTION}\` to record explicit direction for option \`${recommended.id}\`.`
    : "";
  return {
    id: moment.id,
    audience,
    message: `${base}${delegationLine}`,
    factIds: setupHumanMomentFactIds(moment),
    waitsForOwner: moment.kind === "decision",
  };
}

export interface SetupRecommendationSelection {
  readonly decisionKind: SetupDecisionKind;
  readonly action: typeof SETUP_RECOMMENDATION_ACTION;
  readonly selectedOption: string;
  readonly ownerDirected: true;
}

/** Record the explicit delegation action, rejecting every consequential kind. */
export function selectSetupRecommendation(
  moment: SetupHumanDecisionMoment,
  action: typeof SETUP_RECOMMENDATION_ACTION,
): SetupRecommendationSelection {
  const policy = SETUP_DECISION_DELEGATION[moment.decision_kind];
  if (!policy.allowed) {
    throw new Error(
      `Setup decision ${moment.decision_kind} cannot use ${action}: ${policy.reason}.`,
    );
  }
  const recommended = moment.options.find((option) => option.recommended);
  if (recommended === undefined) {
    throw new Error(`Setup decision ${moment.id} has no recommendation.`);
  }
  return {
    decisionKind: moment.decision_kind,
    action,
    selectedOption: recommended.id,
    ownerDirected: true,
  };
}

/** A bounded agent-operational rendering for the prose lane of setup results. */
export function renderSetupHumanMoment(moment: SetupHumanMoment): string {
  const conditional = moment.applicability.kind === "when";
  const applicabilityLines = moment.applicability.kind === "when"
    ? [
      `- **Applicable only with evidence \`${moment.applicability.evidence_id}\`:** ${moment.applicability.condition}`,
      "- **If absent:** continue without asking the owner and without waiting.",
    ]
    : ["- **Applicability:** always serve this moment."];
  const ownerMessage = renderSetupOwnerMoment(moment, "novice")?.message ??
    moment.relay.message;
  const lines = [
    `#### ${conditional ? "Conditional " : ""}${
      moment.kind === "decision" ? "owner decision" : "owner context"
    }: ${moment.purpose}`,
    "",
    ...applicabilityLines,
    `- **Outcome / reason:** ${moment.owner_outcome} ${moment.why}`,
    ...(moment.recommendation === undefined
      ? []
      : [`- **Recommendation:** ${moment.recommendation}`]),
    `- **Action / authority:** ${moment.current_action} ${moment.authority}`,
    `- **Reversal / recovery:** ${moment.reversibility} ${moment.recovery}`,
  ];
  if (moment.kind === "decision") {
    lines.push("", "Options and consequences:", "");
    for (const [index, option] of moment.options.entries()) {
      lines.push(
        `${index + 1}. **${option.label}${
          option.recommended ? " (recommended)" : ""
        }** — ${option.consequence} Owner: ${option.owner_action} Agent: ${option.agent_action}`,
      );
    }
    const delegation = SETUP_DECISION_DELEGATION[moment.decision_kind];
    lines.push(
      "",
      ...(delegation.allowed
        ? [
          `Safe delegation: an explicit \`${SETUP_RECOMMENDATION_ACTION}\` action selects the recommended option and records owner direction.`,
        ]
        : [`Delegation is unavailable: ${delegation.reason}.`]),
      conditional
        ? "Only after the applicability evidence is present and the owner wording is served: wait."
        : `Before the owner answers: ${moment.agent_behavior.before_owner_action}.`,
      `After the owner answers: ${moment.agent_behavior.after_owner_action}`,
    );
  } else {
    lines.push(`- **Then:** ${moment.agent_behavior.after_owner_action}`);
  }
  lines.push(
    "",
    ...(conditional
      ? [
        "Owner wording is rendered from this same moment only after its applicability evidence is attached.",
      ]
      : [
        `Owner-language rendering (${moment.relay.protection}, novice default):`,
        "",
        `> ${ownerMessage}`,
      ]),
  );
  return lines.join("\n");
}

/** Render several moments once for a setup result's prose lane. */
export function renderSetupHumanMoments(
  moments: readonly SetupHumanMoment[],
): string {
  if (moments.length === 0) return "";
  return [
    "### Work with the owner",
    "",
    ...moments.flatMap((moment, index) => [
      ...(index === 0 ? [] : ["", "---", ""]),
      renderSetupHumanMoment(moment),
    ]),
  ].join("\n");
}

/** Flatten semantic values for diagnostics; enrollment uses stable fact ids. */
export function setupHumanMomentFacts(
  moment: SetupHumanMoment,
): string[] {
  return [
    moment.purpose,
    moment.owner_outcome,
    moment.why,
    moment.current_action,
    moment.authority,
    moment.reversibility,
    moment.recovery,
    ...(moment.recommendation === undefined ? [] : [moment.recommendation]),
    ...(moment.kind === "decision"
      ? moment.options.flatMap((option) => [
        option.label,
        option.consequence,
        option.owner_action,
        option.agent_action,
      ])
      : []),
    moment.relay.message,
    moment.relay.experienced,
  ];
}
