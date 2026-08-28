---
id: explanation-proof
title: "Proof"
description: "What a green Gate and its Proof establish, how green differs from landed, who authorizes a landing, and why Proof goes stale."
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

When an agent finishes a task, discern provides the agent with Proof — evidence that their clean, committed change has passed the Gate.

A coding agent hands a change back and declares: "I'm done!". But how can you be sure they really are? Checking every claim yourself quickly gets tedious, and the time required to check it accurately doesn't scale as your project grows.

discern uses Proof to do the checking for you. Proof confirms which checks ran, what they covered, and whether anything has moved since the Gate went green. 

Proof is computed deterministically from the state of the agent's worktree. A valid Proof is tied to one exact commit, so a later edit invalidates an earlier Proof.

On completion, the agent hands you a Proof line — a one-sentence summary of the Proof's raw data — so you can decide whether the change is ready to land. For example:

> Proof: gate passed on `agent/user-onboarding-fixes-0a7563` @ c5a02addf12a · 6 files +568 −345 vs main · standards held, 8 improved · 1 checkpoint declared met · full proof: `discern status --verbose`

Proof is provided on completion, but landing is a separate decision. Your authority decides what ultimately gets merged in to the project. If you accept the change, discern records the full Proof as a durable Git note on the landed commit.

## What green establishes

The Gate is the project's own "definition of done". It runs the jobs the project declares (build, lint, tests), the scope checks for the areas the change touched, and the project's Standards, its quality metrics that may only improve. Green means those declared checks passed for the tree the Gate evaluated.

Green is a machine verdict with a stated scope. It doesn't establish that the change is free of defects, secure, or ready for production, and it doesn't replace running the code for yourself.

A green Gate doesn't move any code automatically. The change remains on its branch, in an isolated worktree, until someone accepts it. Passing the Gate makes the change eligible for acceptance. Who makes that decision, and with what authority, is covered in [Who supplies what](#who-supplies-what).

## The exact commit it covers

A reviewer's first question about evidence is whether it describes the code in front of them. Before any job runs, the Gate confirms the worktree's committed state and working tree. After the run it checks these again, and records Proof only when the passing result still describes the same clean commit on a branch ahead of the trunk. The Proof line summarizes the state for a human reader; the stored evidence binds the full hash.

A green run can finish without earning Proof. When the worktree holds uncommitted changes or the branch has fallen behind the trunk, `discern done` can still pass, but its result will say why Proof wasn't recorded. For the agent to *prove* they're done, they simply commit the final tree and run `discern done` again on the clean commit.

A failing run doesn't provide Proof. Instead, it guides the agent towards the failure so they can resolve it. [Fix a red Gate](../10-guides/fix-a-red-gate.md) explains this further.

## From green to live

A passing run is the first step on the way to shipping your software project:  

| State                | What it tells you                                                                                                                |
| -------------------- |----------------------------------------------------------------------------------------------------------------------------------|
| **Green**            | The declared checks passed for the tree the Gate evaluated. Green alone doesn't say the branch may land.                         |
| **Ready for review** | Current Proof exists for a clean commit, and the handoff includes the behavior and risks the owner needs to weigh.               |
| **Accepted**         | The owner authorized the change, or a recorded grant covers its paths. Until `discern accept` completes, the trunk hasn't moved. |
| **Landed**           | `discern accept` verified the authority and fast-forwarded the validated commit onto the trunk.                                  |
| **Released or live** | The project's release process made the landed work available. discern doesn't infer this state from green or landed.             |

Acceptance fast-forwards the exact validated commit onto the trunk, then removes the worktree. Although the branch may be gone, the evidence lives on: the [proof note](../30-reference/proof-and-checkpoint-formats.md#proof-notes) attached to the landed commit records what passed, the declared conclusions, and the authority that permitted the landing. A future maintainer can recover what was checked without digging through old conversations.

Everything after a change lands on the trunk (releases, deployment, and so on) belongs to the project. discern doesn't deploy anything on your behalf, or even push commits remotely (in fact, it's [completely offline](../../map/00-orientation/trust-and-data.md)).

## Why Proof becomes stale

Proof describes the exact state of one Git tree, so it lasts only as long as the tree does. Anything that changes what would land, makes it stale:

- a new commit, or an amended commit;
- a staged file, an uncommitted edit, or an untracked file;
- regenerated output: a `discern prepare` rewrite changes the tree like any other edit until it's committed and validated again;
- a changed checkpoint conclusion or rationale, even when the commit itself hasn't moved. Acceptance depends upon those judgments, so the evidence requires them too.

Proof vouches only for the tree that passed, but followup changes are routine. Simply review and commit the later change, and run `discern done` again: fresh Proof replaces the old one.

When nothing changes, the same process works in your favor. On an unchanged tree, `discern done` returns the current green Proof without re-running the project's checks, and `discern accept` reuses existing Proof instead of running the Gate twice.

## Who supplies what

Reviewing a change often involves more than simply asking "did the tests pass?". Some questions just can't be settled by a command's exit status.

For those, a project configures [checkpoints](checkpoints.md): judgment stops that pair a trigger with a written question to the agent. When a change matches a checkpoint trigger, `discern done` refuses to run until the agent weighs the question and records a conclusion — either declared met, or declared unmet — with a short rationale written for the owner.

Proof distinguishes between the kinds of evidence it provides:

- Job, scope, and Standard results are **verified**: a machine produced them, and a machine can _reproduce_ them.
- Checkpoint conclusions are **declared**: they're the agent's recorded judgment, and Proof labels them as such.
- A landing is **authorized**: a person supplies the permission, and discern reports it alongside the current change.

A declared-unmet conclusion doesn't turn a green Gate red. Its rationale stays visible in Proof, and acceptance stops until the owner either asks for the change to satisfy the checkpoint or authorizes that exact variance in the current conversation. Grants never cover a variance: the point of the rationale is that a person reads it.

When the agent couldn't determine whether a checkpoint applied, Proof names what was skipped and why, so a green run can't hide an unenforced judgment. A CI run (`discern done --ci`) reports the questions that still await review without answering them, and its report-only evidence cannot be used to land.

`discern accept` moves the trunk only when it can verify landing authority — a recorded permission for the work to land:

| Source             | What it is                                                                                            | Covers                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Conversation**   | The owner approves in the current conversation, and the agent runs `discern accept --confirmed`.      | That one landing.                                            |
| **Standing grant** | Scopes the owner has recorded on the trunk (documentation, for example).                              | Any landing whose changed files stay inside a granted scope. |
| **Effort grant**   | Permission recorded in advance for one worktree when its work is delegated from [the Desk](../10-guides/delegate-work.md). | That worktree's landing, once green.                         |

Without authority, `discern accept` doesn't change anything: it reports what would have landed, and routes the change back for review. Authority is resolved from recorded evidence on every call, never from an agent's memory of an earlier conversation.

### Approve a Standard limit proposal

A change can cross one of the project's Standard limits for a defensible reason. When the owner agrees the limit should move, the branch carries a proposal, and the Proof presents it. It names the Standard being revised, its current and proposed limits, the measured value, and the reason for changing it. `discern accept` refuses until the owner approves that exact proposal in the conversation. Grants and general permission to land don't bypass this approval.

If the owner declines, the agent must restore the trunk limit in the branch, commit the restoration, and run `discern done` again under ordinary enforcement. [Set and raise Standards](../10-guides/set-and-raise-standards.md) covers proposing, measuring, and pinning limits.

## Choose the next action

- **Proof hasn't been recorded yet:** run `discern prepare`, review any rewrites, commit the final tree, then run `discern done`.
- **Proof is current:** open it in the worktree with `discern status --verbose`, exercise the changed behavior, and weigh the outcome, risks, and open decisions.
- **Proof is stale:** decide whether to keep or undo the later change, commit the intended result, and run `discern done` again.
- **A checkpoint is declared unmet:** read its rationale, then either ask for the change to satisfy it or authorize that exact variance in the conversation.
- **The change is accepted but hasn't landed:** follow the authority-aware `discern accept` result for that worktree. Success is the evidence that the trunk moved.
- **The change has landed:** follow the project's release process if it has one. The work isn't released or live until that process says so.

[Finish and land a change](../10-guides/finish-and-land-a-change.md) gives the end-to-end procedure. [Checkpoints](checkpoints.md) covers declarations, drops, and variance in depth. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) holds the exact fields and durable formats.
