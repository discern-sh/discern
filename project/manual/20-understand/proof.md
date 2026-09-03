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
---

# Proof

A coding agent hands a change back and declares: "I'm done!". But how can you be sure? Checking every claim yourself quickly gets tedious, and rerunning commands and comparing Git state becomes a second job as more work moves in parallel.

discern uses Proof to do that checking for you. It confirms that the project's declared checks ran and passed, records the exact commit they covered, and shows whether the evidence is still current. You can spend your review time on behavior, design, risk, and the decision to land.

After a successful `discern done`, the agent returns a one-line summary such as this:

> **Proof:** The Gate passed for `agent/user-onboarding-fixes-0a7563` at `c5a02addf12a` · 6 files changed (+568 −345) vs `main` · Standards held (8 improved) · 1 checkpoint declared met · View the full Proof: `discern status --verbose`

The blockquote visually distinguishes Proof from the agent's account, while code styling separates Git identities and the inspection command from prose. The line gives a reviewer the essential facts at a glance; `discern status --verbose` opens the full evidence. The agent receives Proof before landing, so you can review the exact result and decide what becomes part of the project. After an accepted change lands, discern keeps the full Proof as a durable Git note on that commit.

## What green establishes

The Gate is the project's definition of done. It runs the declared jobs, such as build, lint, and tests; checks the areas the change touched; and measures the project's Standards, its quality measures that may only improve. Green means those declared checks passed for the tree the Gate evaluated.

That scope matters. Green clears away routine verification, but it can't establish that no defect remains, settle whether the design is right, or say that the project is ready for release — and it doesn't replace running the code for yourself. Those judgments still belong to review and to the project's own release process.

A green Gate also leaves the code where it is. The change remains on its branch in an isolated worktree until `discern accept` has verified landing authority. Passing the Gate makes the change eligible for acceptance; it doesn't grant that authority or move the trunk, the project's shared branch. [Who supplies what](#who-supplies-what) explains who makes that decision.

## The exact commit it covers

A reviewer's first question about evidence is whether it describes the code in front of them. Before any job runs, the Gate pins the current commit and observes the working tree. It checks both again after the run, which matters when a test suite takes long enough for another process to rewrite a file. Proof is recorded only when the passing result still describes that same clean commit. The short hash appears in the Proof line; the stored evidence binds the full hash.

`discern done` can check a tree with uncommitted changes, but it won't record Proof for that state. Proof binds the full committed `HEAD`, a clean tree, checkpoint declarations, and the definitions behind reusable Standard measurements; it does not bind a trunk commit. Before reuse, discern still reads the configured local trunk. If the branch is behind, it refuses and tells the agent to run `discern update`; if that local ref cannot be read, it fails closed and tells the agent how to fetch it. A remote-tracking ref alone is insufficient. If the commit moves during the Gate, the result may be green for the tree pinned at the start, but it can't become current Proof for the new commit.

To produce Proof, the agent brings in the trunk when needed, commits the final tree, and runs `discern done` on that clean commit.

A failing run doesn't provide Proof. It guides the agent toward the failure so they can resolve it; [Fix a red Gate](../10-guides/fix-a-red-gate.md) covers that path.

## From green to live

A change can pass through several states on its way to users:

| State                | What it tells you                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Green**            | The declared checks passed for the tree the Gate evaluated. Green alone doesn't say the branch may land.                            |
| **Ready for review** | Current Proof exists for a clean commit, and the handoff includes the behavior and risks the owner needs to weigh.                  |
| **Accepted**         | The owner has authorized this landing now, or recorded permission already covers it. The trunk hasn't moved yet.                    |
| **Landed**           | `discern accept` verified the authority and fast-forwarded the validated commit onto the trunk.                                     |
| **Released or live** | The project's release process made the landed work available. discern doesn't infer this state from either a green Gate or landing. |

Acceptance fast-forwards the exact validated commit onto the trunk, then removes the worktree. Although the branch may be gone, the evidence lives on: the [proof note](../30-reference/proof-and-checkpoint-formats.md#proof-notes) attached to the landed commit records what passed, the declared conclusions, and the authority that permitted the landing. A future maintainer can recover what was checked without digging through old conversations.

Everything after landing, including deployment and release, belongs to the project. discern doesn't deploy the change or push it to a remote on your behalf; [Local control](local-control.md) explains where its work and evidence stay.

## Why Proof becomes stale

Suppose a formatter or generator rewrites a file after the Gate finishes. The earlier checks still ran, but they ran on different code from the code now waiting to land. Reusing that result would separate the evidence from the change it claims to cover.

Proof therefore lasts only while the exact tree and its recorded judgments remain unchanged. These changes make it stale:

- a new commit, or an amended commit;
- a staged file, an uncommitted edit, or an untracked file;
- regenerated output: a `discern prepare` rewrite changes the tree like any other edit until the agent commits and validates it;
- a changed checkpoint conclusion or rationale, even when the commit itself hasn't moved. Acceptance depends upon those judgments, so the evidence requires them too.

Later changes are routine. The agent reviews and commits the intended result, then runs `discern done` again so fresh Proof covers it.

When nothing has changed, that same exactness works in your favor: `discern done` returns the current green Proof without running another Gate job, and `discern accept` reuses it instead of running the Gate twice.

## Who supplies what

Some review questions can't be settled by a command's exit status. A documentation change may need to preserve a distinction, for example, while a data migration may need a person to judge whether its trade-off is acceptable.

For those questions, a project configures [checkpoints](checkpoints.md): judgment stops that pair a change trigger with a written question for the agent. When a change matches, `discern done` waits for the agent to weigh the question and record a conclusion, either declared met or declared unmet, with a short rationale for the owner.

Proof distinguishes between the kinds of evidence it provides:

- Job, scope, and Standard results are **verified**: discern ran or measured them and recorded the results.
- Checkpoint conclusions are **declared**: they're the agent's recorded judgment, and Proof labels them as such.
- A landing is **authorized**: the owner supplied permission for this change or scope, and discern verified that permission against the current work.

A declared-unmet conclusion doesn't turn a green Gate red. Its rationale stays visible in Proof, and acceptance stops until the owner either asks for the change to satisfy the checkpoint or authorizes that exact variance in the current conversation. Grants never cover a variance: the point of the rationale is that a person reads it.

If discern can't determine whether a checkpoint applies, Proof names what was skipped and why, so a green run can't hide an unenforced judgment. A continuous integration run (`discern done --ci`) reports the questions that still await review without answering them, and its report-only evidence can't be used to land.

`discern accept` moves the trunk only when it can verify landing authority — a recorded permission for the work to land:

| Source             | What it is                                                                                                                 | Covers                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Conversation**   | The owner approves in the current conversation, and the agent runs `discern accept --confirmed`.                           | That one landing.                                            |
| **Standing grant** | Scopes the owner has recorded on the trunk (documentation, for example).                                                   | Any landing whose changed files stay inside a granted scope. |
| **Effort grant**   | Permission recorded in advance for one worktree when its work is delegated from [the Desk](../10-guides/delegate-work.md). | That worktree's landing, once green.                         |

Without authority, `discern accept` doesn't change anything. It reports what would have landed and routes the change back for review. Each call resolves authority from recorded evidence, not from an agent's memory of an earlier conversation.

### Approve a Standard limit proposal

A change can cross one of the project's Standard limits for a defensible reason. When the agent proposes moving the limit, Proof names the Standard, its current and proposed limits, the measured value, and the reason. `discern accept` waits until the owner approves that exact proposal in the conversation. Grants and general permission to land don't bypass this approval.

If the owner declines, the agent must restore the trunk limit in the branch, commit the restoration, and run `discern done` again under ordinary enforcement. [Set and raise Standards](../10-guides/set-and-raise-standards.md) covers proposing, measuring, and pinning limits.

## Choose the next action

- **Proof hasn't been recorded yet:** the agent runs `discern prepare`, reviews any rewrites, commits the final tree, then runs `discern done`.
- **Proof is current:** open it in the worktree with `discern status --verbose`, exercise the changed behavior, and weigh the outcome, risks, and open decisions.
- **Proof is stale:** the agent keeps or undoes the later change, commits the intended result, and runs `discern done` again.
- **A checkpoint is declared unmet:** read its rationale, then either ask for the change to satisfy it or authorize that exact variance in the conversation.
- **The change is accepted but hasn't landed:** the agent follows the authority-aware `discern accept` result for that worktree. Its successful result confirms that the trunk moved.
- **The change has landed:** follow the project's release process if it has one. The work isn't released or live until that process says so.

[Finish and land a change](../10-guides/finish-and-land-a-change.md) gives the end-to-end procedure. [Checkpoints](checkpoints.md) covers declarations, drops, and variance in depth. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) holds the exact fields and durable formats.
