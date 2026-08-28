---
id: explanation-proof
title: "Proof"
description: "Understand what a green Gate and its Proof establish, why Proof goes stale, and who can authorize landing."
order: 30
publish: true
kind: explanation
aliases:
  - "gate"
  - "explanation-proof"
  - "The Proof"
  - "gate proof"
  - "review proof"
  - "proof of done"
  - "landing authority"
  - "standing grant"
  - "effort grant"
  - "pre-authorized landing"
redirect_from:
  - "/docs/quality-gate/the-proof"
  - "/docs/worktrees/landing-authority"
---

# Proof

Understand what a green Gate and its Proof establish, why Proof goes stale, and who can authorize landing.

An agent hands you a green Gate result and a Proof line. You can review a named change with its check results already established. You still decide whether the evidence is enough for this change and whether the change may land.

## What green establishes

The project's final quality check (the Gate) runs the jobs, scope checks, and Standards that the project declared. Green means those checks passed for the tree the Gate evaluated. It does not establish that the change has no defects, is secure, or is ready for production. It also supplies no landing authority.

Proof is the review evidence that one clean, committed change passed the Gate. discern records it only when the worktree is on a branch ahead of trunk, the working tree is clean, and the same commit remains checked out before and after the Gate runs.

The Proof line abbreviates that commit so it is readable. The worktree's stored evidence binds the full `HEAD`, and a landed Proof note binds the full commit object. `discern status --verbose` retrieves the review page for the current Proof.

A Gate can finish green without recording Proof. This happens when the worktree is dirty, `HEAD` moves during the run, or discern cannot establish a reviewable branch identity. The result remains useful for iteration, but there is no exact clean commit to hand over. Commit the intended tree and run `discern done` again.

## From green to live

These states answer different questions. Trunk is the project's main shared branch, usually `main`.

| State                | What it tells you                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Green**            | The declared Gate checks passed for the evaluated tree. Green alone does not say the branch may land, and a dirty run may have no Proof.                                      |
| **Ready for review** | The handoff includes current Proof for a clean commit, plus the behavior and risks the reviewer needs to consider. Ready for review is the name for this human review moment. |
| **Accepted**         | The owner has authorized this change, or a recorded grant covers its paths. If `discern accept` has not completed successfully, trunk has not moved.                          |
| **Landed**           | `discern accept` verified the authority and fast-forwarded the exact validated commit onto trunk.                                                                             |
| **Released or live** | The project's release or deployment process made the landed work available. discern does not infer this state from green or landed.                                           |

Passing the Gate makes a change eligible for a decision. The successful `discern accept` operation is the repository event that lands it.

## Why Proof becomes stale

Proof binds the candidate and its declaration evidence:

- the full commit and clean working tree that the Gate evaluated;
- the checkpoint declarations recorded for that subject, including each conclusion and rationale.

For ordinary work, any later commit, amend, staged file, uncommitted edit, or untracked file changes the candidate. Proof can no longer describe what would land. A generated rewrite is an ordinary edit for this purpose. If `discern prepare` reformats a file or refreshes generated output after Proof was recorded, review the rewrite, commit it, and run `discern done` on the new clean tree.

A changed checkpoint conclusion or rationale also makes Proof stale, even when `HEAD` has not moved. The evidence must describe both the code and the declared judgments that acceptance would carry.

`discern standards --pin` is a narrow product-managed exception that can carry honored Proof across its own limits-only commit. The [Proof and checkpoint formats reference](../30-reference/proof-and-checkpoint-formats.md) covers that exception and the stored identities.

## Machine results, declared conclusions, and authority

A checkpoint is a change-triggered judgment stop. It asks an agent to consider a question that a command cannot settle from exit status alone.

| Evidence or decision                     | Who supplies it                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Gate jobs, scope checks, and Standards   | discern runs the project commands and records their machine results.                                                                      |
| Checkpoint conclusion                    | The agent declares `met` or `unmet`. Proof labels that conclusion as declared judgment; machine verification applies to the Gate results. |
| Landing authority                        | The owner supplies conversation consent or a recorded grant; discern verifies that evidence against the current change.                   |
| Variance for a declared-unmet checkpoint | The owner authorizes the exact current exception in the current conversation. Standing and effort grants never cover a variance.          |
| Released or live state                   | The project's release process establishes it.                                                                                             |

A declared-unmet checkpoint does not turn a green Gate red. Its rationale remains visible in Proof, and acceptance stops until the owner either authorizes that exact variance or asks for the change to satisfy the checkpoint. A grant is recorded owner permission bounded to named scopes or one effort. A variance is separate, one-time authority for the current declared-unmet conclusion.

If uncertainty prevented a checkpoint from being enforced, Proof keeps that checkpoint drop visible. The [Checkpoints explanation](checkpoints.md) covers declarations, drops, and variance in depth.

### Approve a Standard limit proposal

A Proof can also carry a proposed change to a Standard limit. This is an owner decision separate from landing authority. `discern accept` first serves the current Standard, value, reason, and approval token without changing the repository. After the owner approves that exact proposal in the current conversation, follow the complete acceptance command in the result.

A standing grant, effort grant, checkpoint variance, or general permission to land does not approve a Standard limit proposal. [Set and raise Standards](../10-guides/set-and-raise-standards.md) covers the proposal workflow; the [formats reference](../30-reference/proof-and-checkpoint-formats.md) holds its exact fields.

## Choose the next action

- **There is no current Proof:** run `discern prepare`, review any rewrites, commit the final tree, then run `discern done`.
- **Proof is current:** inspect it with `discern status --verbose`, exercise the changed behavior, and review the outcome, risks, and open decisions.
- **Proof is stale:** decide whether to keep or undo the later change, commit the intended result, and run `discern done` again.
- **A checkpoint is declared unmet:** read its rationale. The owner can require a change or authorize the exact variance in the current conversation.
- **The change is accepted but has not landed:** follow the authority-aware `discern accept` result for this worktree. Success is the evidence that trunk moved.
- **The change has landed:** follow the project's release process if it has one. Do not describe it as released or live until that process says so.

[Finish and land a change](../10-guides/finish-and-land-a-change.md) gives the end-to-end procedure. [MCP and results](../30-reference/mcp-and-results.md) and [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) hold the exact result fields and durable formats.
