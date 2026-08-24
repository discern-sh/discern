---
title: Setup decisions
description: Understand why setup recommends a strong model, which choices remain yours, and what the agent should handle without interrupting you.
order: 30
aliases:
  - setup choices
  - setup model
  - setup consent
---

# The decisions setup asks you to make

_Setup turns one repository study into a dependable way for future coding sessions to work. The agent handles the technical authoring; this page explains the choices that still belong to you._

## Choose the model for the repository study

discern sets no hard minimum model. It recommends the strongest suitable reasoning model because the selected agent studies the repository and creates context every later session inherits:

- the project's final quality check, called the Gate;
- separate task workspaces and their data or service rules;
- the maintained project guide, called the Map;
- the project instructions each configured coding agent reads.

A stronger reasoning model is more likely to notice hidden boundaries, preserve workflows, and challenge false assumptions before they become shared context. That reduces later correction and repository reading.

Before you choose, the agent reports its current provider/model identifier when known, or `unreported`. This self-declared provenance is advisory; it does not prove capability.

To switch, select another model in your coding tool, open a fresh project session, and repeat the setup request. The current agent stops without writing. To continue here, say so plainly. Setup records the reported identity either way.

## Confirm what the project is called

Before setup writes the maintained guide or instructions, it proposes the strongest name supported by the README, package file, or other project metadata. A checkout directory or clone suffix is only a fallback. Confirm or correct the proposal; later setup steps use that answer as the project name.

When the evidence is clear and you do not have a preference, reply **“use your recommendation”** to record your choice and use the proposal.

## Know which choices remain yours

The agent handles routine, reversible authoring on the reviewable setup branch. It narrates each major stage and benefit without asking you to approve files one by one.

It waits only when a real decision exists: missing product intent, a new dependency or paid service, conflicting owner instructions, a policy that binds future work, shared or durable data, broader access, destructive effects, or landing.

The agent first explains the practical outcome. For example, if two parallel tasks would change the same database file, it explains whether those changes can be combined safely and recommends a policy before showing any resource or merge configuration.

Each applicable decision names:

- the outcome and why it matters;
- the recommended option;
- what each option changes;
- your action and the agent's next action;
- authority, reversibility, and recovery.

For a reversible technical choice, **“use your recommendation”** records your direction and selects the displayed recommendation. That route is unavailable for cost, credentials, broader access, destructive effects, unsafe durable data, new dependencies, exceptions, or landing.

If the condition never occurs, setup asks no question and does not wait. If a question lacks the context above, ask the agent to explain the consequence before answering.

## Inspection stays inside the project

A project file can point to another checkout, database, or machine-local path. Setup reports that reference and what it appears to be, but the reference is not permission to inspect the destination. The agent asks a cheap, specific question before reading outside the repository, such as: “This file points at another checkout; may I look at it to confirm the data layout?” Declining leaves the destination unread and the evidence limit visible.

## Review what later sessions will inherit

Before landing, the handoff explains where later agents will start, which other areas have distinct responsibilities, one important rule setup discovered, which checks now run, and what remains open. Precise file and check inventories remain available for technical review.

The proof that the finished change passed the project's checks is attached to the exact commit and called Proof. It verifies the setup branch; it does not authorize landing. You may land, leave for review, or decline.

After landing, open a fresh provider session. Inspect its registered tools first, then invoke the exact local activation action the provider handoff names. If it is missing, follow the local recovery or run `discern doctor` before looking for external documentation. Optional improvement follows a successful activation check.

Return to the [quickstart](quickstart.md) for the shortest setup path, or follow the [walkthrough](walkthrough.md) for the branch and verification sequence.
