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
  required_facts: z.array(nonEmpty).min(1),
});
export type SetupHumanRelay = z.infer<typeof SetupHumanRelaySchema>;

const commonMomentShape = {
  id: nonEmpty,
  surfaces: z.array(z.enum(SETUP_HUMAN_SURFACES)).min(1),
  phase: nonEmpty,
  trigger: nonEmpty,
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
  relay: SetupHumanRelaySchema.optional(),
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
  const relay = moment.relay;
  if (relay !== undefined) {
    const normalizedMessage = relay.message.toLowerCase();
    for (const [index, fact] of relay.required_facts.entries()) {
      if (!normalizedMessage.includes(fact.toLowerCase())) {
        context.addIssue({
          code: "custom",
          path: ["relay", "required_facts", index],
          message: `relay message does not carry required fact: ${fact}`,
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
  recommendation: nonEmpty.optional(),
  decision: z.strictObject({
    recommended_option: nonEmpty,
    option_ids: z.array(nonEmpty).min(2),
    agent_waits: z.literal(true),
  }).optional(),
  relay_protection: z.enum(["adaptive", "verbatim-list"]).optional(),
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
  return SetupHumanMomentProjectionSchema.parse({
    id: moment.id,
    kind: moment.kind,
    phase: moment.phase,
    purpose: moment.purpose,
    ...(moment.recommendation === undefined
      ? {}
      : { recommendation: moment.recommendation }),
    ...(moment.kind === "decision" && recommended !== undefined
      ? {
        decision: {
          recommended_option: recommended.id,
          option_ids: moment.options.map((option) => option.id),
          agent_waits: true,
        },
      }
      : {}),
    ...(moment.relay === undefined
      ? {}
      : { relay_protection: moment.relay.protection }),
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
    trigger: "The owner encounters discern in a project that is not set up.",
    purpose: "Explain what this one-time setup changes for later coding work.",
    owner_outcome:
      "Later coding sessions inherit project-specific quality checks, isolated task workspaces, navigation, and operating instructions.",
    why:
      "Setup studies this repository and turns what it learns into the Gate, worktree behavior, Map, and project instructions. Those choices recur in future sessions, so the quality of this first pass affects the long-term experience.",
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
  },
  {
    id: "model-selection",
    surfaces: ["welcome", "consent", "step-0"],
    kind: "decision",
    phase: "consent",
    trigger: "The owner must choose which available model performs setup.",
    purpose: "Choose the reasoning model for the one-time setup.",
    owner_outcome:
      "The Gate, worktree policy, Map, and project instructions inherited by later sessions are grounded in the best repository study the owner chooses to provide now.",
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
        "Setup quality affects the Gate, worktree policy, Map, and project instructions future sessions inherit. Before you choose, I report `Current provider/model (self-declared): <identifier or unreported>`. I recommend the strongest suitable reasoning model available. Choose either: use the model selector, open a fresh session in this project, and paste `Run discern setup`, in which case I will stop; or continue with the current model, in which case I will record advisory provenance and proceed after your confirmation.",
      required_facts: [
        "future sessions inherit",
        "Current provider/model (self-declared)",
        "strongest suitable reasoning model",
        "model selector",
        "fresh session",
        "I will stop",
        "advisory provenance",
      ],
    },
  },
  {
    id: "setup-started",
    surfaces: ["setup-started"],
    kind: "progress",
    phase: "project inspection",
    trigger: "The owner authorized setup and the scaffold was applied.",
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
        "Setup has started on its reviewable branch. I am studying the repository before deciding what to configure, because the Gate, worktree behavior, Map, and instructions created here will guide future coding sessions. I will handle routine reversible authoring and return when the repository cannot answer a product question or a consequential choice needs you.",
      required_facts: [
        "reviewable branch",
        "studying the repository",
        "future coding sessions",
        "routine reversible authoring",
        "consequential choice",
      ],
    },
  },
  {
    id: "project-intent-gap",
    surfaces: ["step-1"],
    kind: "decision",
    phase: "project inspection",
    trigger:
      "Repository evidence cannot settle a product fact or two meanings conflict.",
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
        "The repository does not settle this product fact: <missing fact>. I inspected <evidence>. I recommend the meaning current behavior supports. Please confirm that meaning, supply a different intended rule, or defer it; I will wait and keep an unsupported choice as a concrete open item.",
      required_facts: [
        "does not settle",
        "I inspected",
        "I recommend",
        "Please confirm",
        "I will wait",
        "open item",
      ],
    },
  },
  {
    id: "gate-protection-change",
    surfaces: ["step-2"],
    kind: "decision",
    phase: "Gate configuration",
    trigger:
      "A useful protection is missing or legitimate command alternatives remain.",
    purpose:
      "Choose whether setup may add tooling or a consequential Gate action.",
    owner_outcome:
      "Later agents receive useful automatic feedback without setup rewriting project workflows or adding unapproved cost, access, or dependencies.",
    why:
      "The Gate sets the feedback floor for future work. Adding tools can also change lockfiles, runtime, network access, and maintenance obligations.",
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
          "Setup adds the stated dependency or command effect and wires it into the Gate in a separate commit.",
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
        "The Gate is missing <protection>. I recommend <smallest project-native addition> because future changes otherwise receive no automatic <feedback>. It would change <dependency, access, cost, or command>. Approve that named effect, or keep the protection visibly absent; I will wait and will not mark it inapplicable to improve the result.",
      required_facts: [
        "Gate is missing",
        "I recommend",
        "future changes",
        "It would change",
        "keep the protection visibly absent",
        "I will wait",
      ],
    },
  },
  {
    id: "authored-source-collision",
    surfaces: ["step-3"],
    kind: "decision",
    phase: "scaffold reconciliation",
    trigger:
      "Two authored sources claim incompatible ownership of one file or meaning.",
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
        "Two authored sources conflict: <paths and meanings>. I recommend the configured authored source while preserving the other source's unique owner policy. Confirm that ownership, or identify what must remain separate; I will wait and keep both unchanged until you choose.",
      required_facts: [
        "authored sources conflict",
        "I recommend",
        "preserving",
        "Confirm",
        "I will wait",
        "both unchanged",
      ],
    },
  },
  {
    id: "lasting-project-context",
    surfaces: ["step-4", "step-5", "step-6", "step-7"],
    kind: "explanation",
    phase: "project context",
    trigger:
      "Setup turns repository evidence into the Map and project instructions.",
    purpose: "Explain why this documentation affects later coding sessions.",
    owner_outcome:
      "Future agents start with the project's verified boundaries, invariants, commands, and owner policies instead of rediscovering them or inventing replacements.",
    why:
      "The Map and instruction source are committed project context. Better context reduces repository reading, makes incorrect assumptions easier for the owner to audit, and guides later changes after this setup session ends.",
    current_action:
      "Author only verified, durable context and show the owner the proposed primary-subsystem understanding before final synthesis.",
    authority:
      "Code and configuration own behavior; the owner owns product intent; the Map records durable context those authorities do not express by themselves.",
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
  },
  {
    id: "owner-policy-conflict",
    surfaces: ["step-5"],
    kind: "decision",
    phase: "instruction draft",
    trigger:
      "An imported owner policy conflicts with discern's required workflow or current repository behavior.",
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
        "The imported owner policy <rule> conflicts with <required workflow or current behavior>, causing <consequence>. I recommend <compatible wording> because it preserves the owner's intent. Approve that wording or leave the conflict unresolved; I will wait and will not delete the policy by inference.",
      required_facts: [
        "owner policy",
        "conflicts",
        "causing",
        "I recommend",
        "preserves",
        "I will wait",
      ],
    },
  },
  {
    id: "first-green-gate",
    surfaces: ["step-2", "step-8"],
    kind: "progress",
    phase: "Gate proof",
    trigger:
      "The configured project checks first pass together through discern.",
    purpose: "Mark the first green Gate as an owner-visible setup milestone.",
    owner_outcome:
      "The owner knows which protections now run automatically and which expected protections remain absent or do not apply.",
    why:
      "A green result means the configured feedback loop runs; it does not prove unconfigured protections or authorize landing.",
    current_action:
      "Report the enforced protections, absences, and applicability before final documentation freezes the configuration.",
    authority:
      "The Gate result verifies configured commands; the owner still controls consequential additions and landing.",
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
        "The configured Gate is green. It now runs <enforced protections>; <absent protections> remain absent, and <inapplicable protections> do not apply. This verifies the configured feedback loop and does not authorize landing. I am continuing to worktree proof and the final project-context recheck.",
      required_facts: [
        "configured Gate is green",
        "remain absent",
        "do not apply",
        "does not authorize landing",
        "final project-context recheck",
      ],
    },
  },
  {
    id: "subsystem-sanity-check",
    surfaces: ["step-7"],
    kind: "decision",
    phase: "Map scope design",
    trigger:
      "The agent has a code-backed primary-subsystem understanding and bounded page plan.",
    purpose:
      "Let the owner correct the agent's project mental model before it becomes lasting context.",
    owner_outcome:
      "The Map starts future sessions in the right subsystem with a correct boundary and non-obvious invariant.",
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
        "Incorporate the correction, then continue to smoke proof before final documentation synthesis.",
    },
    options: [
      {
        id: "confirm-mental-model",
        label: "Confirm the project understanding",
        consequence:
          "The bounded page plan proceeds to smoke proof and final synthesis.",
        owner_action:
          "Confirm the proposed start point, boundary, and invariant.",
        agent_action: "Retain the plan and continue.",
        recommended: true,
      },
      {
        id: "correct-mental-model",
        label: "Correct the project understanding",
        consequence:
          "The Map plan changes before future sessions inherit an incorrect boundary or starting point.",
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
        "My current project understanding is: primary subsystem <name>; start at <path>; boundary <boundary>; non-obvious invariant <invariant>; additional durable pages <list or none>. I recommend this evidence-backed plan. Please confirm the project understanding or correct a substantive boundary, ownership, or starting-point error; I will wait before final synthesis.",
      required_facts: [
        "primary subsystem",
        "start at",
        "boundary",
        "non-obvious invariant",
        "I recommend",
        "I will wait",
      ],
    },
  },
  {
    id: "worktree-resource-policy",
    surfaces: ["step-8"],
    kind: "decision",
    phase: "worktree readiness and smoke",
    trigger:
      "A worktree need would spend money, touch durable data, share mutable state, broaden access, or make binary merges consequential.",
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
        "Worktree readiness needs a decision about <resource>: concurrent behavior <behavior>; cost, data, access, or merge consequence <consequence>. I recommend <isolated policy> and the lower-impact alternative is <alternative>. Approve that concrete policy or defer it; I will wait and create no resource before your answer.",
      required_facts: [
        "Worktree readiness",
        "concurrent behavior",
        "consequence",
        "I recommend",
        "alternative",
        "I will wait",
        "create no resource",
      ],
    },
  },
  {
    id: "documentation-claim-gap",
    surfaces: ["step-6"],
    kind: "decision",
    phase: "final documentation synthesis",
    trigger:
      "A product or architecture claim remains consequential but cannot be verified after smoke.",
    purpose:
      "Choose whether missing owner intent resolves the claim or the documentation keeps it open.",
    owner_outcome:
      "Future sessions do not inherit a confident statement that current code and configuration cannot support.",
    why:
      "A false Map claim can steer later work more strongly than no claim because agents treat committed project context as an authority.",
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
          "The Map stays factual and the ledger names the missing decision or implementation with evidence.",
        owner_action: "Confirm that the unresolved item should remain visible.",
        agent_action:
          "Remove the confident claim and record the concrete item.",
        recommended: true,
      },
      {
        id: "supply-product-intent",
        label: "Supply product intent",
        consequence:
          "The Map may record the intent as such, while absent implementation remains an open item rather than current behavior.",
        owner_action: "State the intended product rule.",
        agent_action:
          "Separate intent from verified behavior and retain any implementation gap.",
        recommended: false,
      },
    ],
    relay: {
      protection: "adaptive",
      message:
        "I cannot verify this proposed claim: <claim>. I checked <evidence>; <authority> is missing. I recommend keeping it out of present-tense documentation and recording <open item>. Confirm that route or supply the product intent; I will wait and will not present absent implementation as current behavior.",
      required_facts: [
        "cannot verify",
        "I checked",
        "is missing",
        "I recommend",
        "open item",
        "I will wait",
        "current behavior",
      ],
    },
  },
  {
    id: "completion-handoff",
    surfaces: ["step-9", "setup-done"],
    kind: "completion",
    phase: "completion handoff",
    trigger: "The clean final setup commit has passed `discern setup done`.",
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
        "Setup completion must report: the primary subsystem and where future agents start; the project principles and non-obvious invariant they inherit; the protections the Gate enforces and the protections still absent; concrete open items; Map, ledger, and job inventory; Proof; current branch; landing choices; and the fact that Proof does not itself authorize landing.",
      required_facts: [
        "primary subsystem",
        "future agents start",
        "project principles",
        "non-obvious invariant",
        "protections",
        "open items",
        "inventory",
        "Proof",
        "current branch",
        "landing choices",
        "does not itself authorize landing",
      ],
    },
  },
  {
    id: "landing-choice",
    surfaces: ["step-9", "setup-done"],
    kind: "decision",
    phase: "landing handoff",
    trigger: "Proved setup is ready on a branch that is not yet the trunk.",
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
        "The proved setup is on <branch>; <trunk> does not contain it yet. Proof verifies the branch and does not authorize landing. I recommend landing when the qualitative handoff matches the project. Choose land now, leave the branch for review, or decline it; I will wait and will not restart, activate, or mutate the proved branch before that decision.",
      required_facts: [
        "does not contain it yet",
        "does not authorize landing",
        "I recommend",
        "land now",
        "leave the branch for review",
        "decline",
        "I will wait",
        "will not restart",
      ],
    },
  },
  {
    id: "activation-handoff",
    surfaces: ["step-9", "setup-accept", "activation"],
    kind: "progress",
    phase: "provider activation",
    trigger: "Proved setup is available on the trunk.",
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
        "Setup is now on the trunk. Start the provider-specific fresh session and run the displayed activation check, because coding tools load discern at session start and this setup session cannot verify that future environment. Report the result or follow the displayed recovery. Only after activation succeeds is `discern improvement --json` an optional owner review.",
      required_facts: [
        "on the trunk",
        "fresh session",
        "activation check",
        "load discern at session start",
        "cannot verify",
        "Report the result",
        "Only after activation succeeds",
        "optional owner review",
      ],
    },
  },
] as const satisfies readonly SetupHumanMoment[];

/** Validate registry-wide membership and every semantic contract. */
export function validateSetupHumanMomentRegistry(
  moments: readonly unknown[],
): asserts moments is readonly SetupHumanMoment[] {
  const ids = new Set<string>();
  const enrolledSurfaces = new Set<SetupHumanSurface>();
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

/** A bounded ready-to-serve rendering for the prose lane of setup results. */
export function renderSetupHumanMoment(moment: SetupHumanMoment): string {
  const lines = [
    `#### ${
      moment.kind === "decision" ? "Owner decision" : "Owner context"
    }: ${moment.purpose}`,
    "",
    `- **Outcome for the owner:** ${moment.owner_outcome}`,
    `- **Why this matters:** ${moment.why}`,
    ...(moment.recommendation === undefined
      ? []
      : [`- **Recommendation:** ${moment.recommendation}`]),
    `- **Action now:** ${moment.current_action}`,
    `- **Authority:** ${moment.authority}`,
    `- **Reversibility:** ${moment.reversibility}`,
    `- **If blocked:** ${moment.recovery}`,
  ];
  if (moment.kind === "decision") {
    lines.push("", "Options:", "");
    for (const [index, option] of moment.options.entries()) {
      lines.push(
        `${index + 1}. **${option.label}${
          option.recommended ? " (recommended)" : ""
        }**`,
        `   - Consequence: ${option.consequence}`,
        `   - Owner action: ${option.owner_action}`,
        `   - Agent action: ${option.agent_action}`,
      );
    }
    lines.push(
      "",
      `Before the owner answers: ${moment.agent_behavior.before_owner_action}.`,
      `After the owner answers: ${moment.agent_behavior.after_owner_action}`,
    );
  } else {
    lines.push(
      `- **Agent behavior:** ${moment.agent_behavior.after_owner_action}`,
    );
  }
  if (moment.relay !== undefined) {
    lines.push(
      "",
      `Relay (${moment.relay.protection}):`,
      "",
      `> ${moment.relay.message}`,
    );
  }
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

/** Flatten every user-visible semantic fact for parity guards. */
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
    ...(moment.relay === undefined ? [] : [moment.relay.message]),
  ];
}
