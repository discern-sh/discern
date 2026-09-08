---
id: explanation-proof
title: "Proof"
description: "Read the evidence that comes with a finished change, understand what it establishes, and see what still needs your judgment."
order: 30
publish: true
kind: explanation
aliases:
  - "gate"
  - "explanation-proof"
  - "The Proof"
  - "gate Proof"
  - "review Proof"
  - "Proof of done"
  - "landing authority"
  - "standing grant"
  - "effort grant"
  - "pre-authorized landing"
---

# Proof

Your agent has added recipe search to your app. You can try it and decide whether the results are useful. But there is another question: did the project's checks pass for the version you are reviewing?

**Proof** answers that question. It records the configured checks and measurements against the exact committed change they cover. You can see what has been established without reconstructing a session's commands from its conversation.

That gives your review a clearer starting point. You can focus on whether search behaves as you intended, whether the wording helps someone find a recipe, and what the checks leave for you to assess.

## Read a Proof line

After successful completion through `discern done`, your agent includes a short Proof line. An illustrative example is:

> **Proof:** Gate passed for `agent/recipe-search-0a7563` at `c5a02addf12a` · 3 files changed (+84 −12) vs `main` · Standards held · 1 checkpoint declared met · View the full Proof: `discern status --verbose`

Each part answers a different question:

| Part of the line            | What you learn                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Gate passed**             | The project's required checks have passing evidence for this change.                                                                    |
| **Branch and commit**       | Which task and exact saved version the evidence describes. A commit is a version recorded in Git.                                       |
| **Files changed**           | The size of the change compared with its predecessor. `+84 −12` counts added and removed lines.                                         |
| **Standards held**          | The change satisfies the project's configured quality limits. A proposed limit change is shown separately when one needs your approval. |
| **Checkpoint declared met** | The agent recorded its judgment that a review question was satisfied.                                                                   |
| **View the full Proof**     | Where to inspect the checks, measurements, and recorded conclusions in more detail.                                                     |

You can ask your agent:

> Explain this Proof in terms of the feature I asked for. Which behaviors were checked, what did you try directly, and what should I review?

The line summarizes the record. Open the full Proof from the worktree with `discern status --verbose`, or ask your agent to retrieve it and explain the relevant parts.

## What green establishes

The **gate** is the set of checks your project requires. These might build the app, test its behavior, check code conventions, and measure limits such as download size. Your project chooses the checks; discern runs them and records their results. Completion requires evidence in every declared context, which can include more than one environment.

For recipe search, a test might check that clearing the search box restores the full list. That tells you something useful about that behavior. It cannot tell you whether the search box is pleasant to use on your phone unless the project checks that too.

Proof therefore helps you choose what to investigate next. Try the changed feature, compare it with your request, and ask about areas the checks do not cover. The depth of further review depends on the change and its consequences. A green gate by itself cannot establish that no defects remain or that an application is ready for release.

## The exact commit it covers

Evidence needs to describe the version that will become part of the project. Your agent prepares and commits the intended files before completion. discern checks that the source is clean and records the exact candidate it validated: the proposed version to land.

When a task can land directly, that candidate is the agent's committed change. With parallel work, discern may combine it with earlier ready changes or a newer shared branch, then validate the combined result. The Proof names that candidate's commit, which can differ from the commit in the author's worktree.

For example, one task adds recipe search while another changes how recipes are sorted. Each feature may work on its own. The combined version needs evidence too, and any conflict or newly applicable review question needs attention before it can land. Each contributing task also needs its own landing permission.

The authoring worktree remains the place to make corrections. The candidate and its retained evidence let discern account for what was checked even after a temporary validation environment has been returned.

## Why Proof becomes stale

Suppose you ask for a clearer message when a search returns no recipes. The agent makes that improvement after its first green run. The earlier checks still happened, but the version you now want to land has changed.

The following can prevent reuse of the earlier Proof:

- a later commit or amended commit;
- staged, uncommitted, or untracked files in the source worktree;
- a changed checkpoint conclusion or rationale;
- a changed standard proposal or a change to the evidence required for completion.

Generated files count as changes too. If a formatter or generator rewrites a file, the agent reviews and commits the intended output before renewing completion.

A newer shared branch can also require a new combined candidate. discern checks the applicable evidence again rather than assuming the earlier result covers the combination.

Fresh completion does not always mean repeating every command. discern can reuse passing evidence whose declared inputs and requirements still match, and obtain the evidence that is missing. When current Proof already covers the result, ordinary `discern done` can return it without running gate jobs again. A deliberate repeat uses `--rerun`.

## Who supplies what

Proof keeps automated checks, review judgments, and permission distinct:

| Contribution             | Who supplies it                                                            | How it helps you                                                   |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Verified results**     | discern runs the configured commands and records the evidence.             | You can inspect which requirements passed.                         |
| **Declared conclusions** | Your agent answers the project's checkpoint questions.                     | You can read its reasoning and challenge the conclusion.           |
| **Landing authority**    | You approve the work now, or the project has a recorded grant covering it. | discern can check whether permission covers the work it will land. |

A checkpoint might ask whether a new message gives someone a useful next action. The agent reads the message and records its judgment. Requiring that answer ensures the question receives attention; discern does not independently judge whether the answer is true.

If the agent declares a question unmet, Proof preserves the reason. You can ask for a correction, or approve that specific exception, called a **variance**. General landing permission and recorded grants do not approve a variance. [Checkpoints](checkpoints.md) explains how to weigh one.

Landing permission can come from your approval in the current conversation, a standing grant for named areas of the project, or a grant recorded for one effort. Every contributing change is checked against its permission. This lets routine work proceed within limits you chose while uncovered work comes back for a decision.

### Approve a Standard limit proposal

Sometimes a useful feature needs more room than an existing standard allows. For example, improved search might add to the app's download size. The agent should first investigate whether the increase can be reduced.

If changing the limit is justified, the proposal carries the current limit, proposed limit, measured value, and reason into Proof. You decide whether the benefit is worth that measured tradeoff. Acceptance requires approval of the exact proposal; general permission to land cannot supply it.

If you decline, the agent restores the previous limit and renews completion under that requirement. [Set and raise standards](../10-guides/set-and-raise-standards.md) covers the proposal procedure.

## From green to live

A finished feature passes through different decisions on its way to users:

| State                  | What it tells you                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Green**              | The checks that ran passed. Completion can still require other evidence or recorded judgments.                    |
| **Ready for review**   | Current Proof exists, and the handoff explains the behavior and any decisions you need to weigh.                  |
| **Authorized to land** | Your consent or a verified grant covers the relevant work. Any separate exception decisions must also be settled. |
| **Landed**             | Acceptance moved the validated candidate onto the trunk, the project's shared branch.                             |
| **Released or live**   | Your project's release process made the change available to its users.                                            |

Ordinary successful `discern done` releases the worktree from authoring control so it can support later validation and eligible cleanup. If the agent expects more local review edits, `--retain-checkout` keeps that control. Releasing a worktree does not land its change.

Acceptance may remove eligible released worktrees and resources after landing. With local Proof notes enabled, which is the default, it attaches the completion evidence to the landed commit. Future maintainers can retrieve that record without the original chat or temporary worktree. The result reports any unfinished note publication or cleanup.

Publication to users belongs to your project. discern does not infer a release from a green gate or a landing. [Local control](local-control.md) explains where its work and evidence stay.

## Choose the next action

For everyday work, ask your agent to bring back the changed behavior, current Proof, and any unresolved decision. If the evidence is incomplete, ask what remains and how it can be obtained. If you request another edit, expect renewed completion for the version you will review.

Diagnostic runs through `discern done --standalone` and reports through `--ci` help investigate or report check results. They do not supply the completion Proof needed to land. [Run the gate in CI](../10-guides/run-the-gate-in-ci.md) explains that reporting route.

[Finish and land a change](../10-guides/finish-and-land-a-change.md) gives the practical handoff. [Fix a red gate](../10-guides/fix-a-red-gate.md) helps when a check fails. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) holds the exact evidence fields and storage formats.
