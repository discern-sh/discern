---
id: explanation-practice-and-roles
title: "Practice and roles"
description: "See how your direction becomes checked work, what the agent handles, and what the project keeps for future sessions."
order: 20
publish: true
kind: explanation
aliases:
  - "explanation-practice-and-roles"
  - "Concepts: how discern fits together"
  - "concepts"
  - "overview"
  - "mental model"
  - "how discern works"
  - "Design principles"
  - "principles"
  - "philosophy"
  - "design"
  - "why"
  - "practice"
---

# Practice and roles

Suppose you want to make saved items easier to find in your app. You can describe the experience you want, and your coding agent can work out the implementation. What helps that exchange keep working as the project grows is a shared account of how the project works, what it values, and what needs checking before a change is complete.

discern gives that account a home in the project. Your agent operates the tools and follows the project instructions. You supply direction and review the result. The project keeps the instructions, checks, and evidence available for the next task.

## Who does what

**You give the work its purpose.** You know who the app is for and what would make it better. A request such as “help people find a saved item without scrolling through a long list” gives the agent a useful problem to solve. You can also explain constraints: keep existing lists intact, or make the feature work on a phone.

**Your coding agent carries the implementation.** It studies the project, proposes an approach when needed, makes the change, and runs the checks. It investigates failures and brings back questions that need your decision. You can ask for recommendations and explanations without knowing the commands yourself.

**The project keeps what the work produces.** Alongside the code, it holds working instructions, a maintained guide, reusable procedures, and records of completed checks. When an agent writes a lesson there, later sessions can use it. Knowledge left only in a conversation does not become project knowledge automatically.

You can think of the exchange as: a request goes in, work happens under the project's rules, and a result comes back with evidence for your review.

## The working loop

For the saved-items example, you might say:

> Add a search box to the saved items page. It should help people find an item by name. Show me the result on a phone-sized screen and explain what you checked before I decide whether to land it.

Your agent starts by checking the project's current state. It makes the change in an isolated workspace called a **worktree**, keeping the unfinished version separate from the shared branch, or **trunk**.

As it works, the agent checks the change and fixes failures. To finish, it saves the final version as a Git commit and runs the project's **gate**: the configured checks required for completion. A pass produces **Proof**, which records the checks and the exact change they covered.

The agent then shows you the result and explains the evidence. You can try finding an item, check the layout, and ask what happens when no item matches. If you want a revision, the agent continues the same effort and verifies the new version.

When the result is ready, you authorize it to **land**, meaning join the trunk. discern checks that permission and the completion evidence before landing. Publishing the app is a separate part of your release process.

This loop gives you a stable way to review work as tasks become more substantial. You do not have to reconstruct which checks ran from the agent's chat history; the evidence comes with the change.

## What the practice consists of

As you use discern, these names give you ways to ask for useful things:

| When you want to…                                      | The part of discern that helps                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Know what was checked for the completed change         | The gate runs the project's checks; [Proof](proof.md) records what passed for that exact version.                                                     |
| Give more than one agent work                          | [Worktrees](worktrees-and-trunk.md) keep tasks in separate checkouts, while the shared project connects their results.                                |
| Raise a review question when a relevant change happens | [Checkpoints](checkpoints.md) ask the agent for a recorded judgment, such as whether a new form explains what happens to the information it collects. |
| Keep an improvement from slipping back                 | [Standards](standards.md) hold a measured limit, such as the amount someone downloads to open the app.                                                |
| Carry a rule or lesson into another session            | [Instructions, skills, and the map](instructions-skills-and-map.md) store working rules, reusable procedures, and project understanding.              |

The project defines its checks and review questions. discern does not contain an AI model of its own; the coding agent supplies the reasoning and discern records the results of the configured process.

## Why the project carries it

Suppose you have settled on a rule: opening a saved list should work without an internet connection. Ask your agent to record the rule and establish checks for the behavior it can test. The next agent can read the reason for that choice and face the same checks when changing the app.

That is how an investment in one task can help later work. Written records carry context; executable checks cover the parts that can be tested. These records spare you from explaining the same decisions again.

The same source instructions are supplied to each configured coding tool. You can change supported providers without maintaining a separate version of the project's rules for each one. Provider-specific features and private conversation history still belong to those tools.

## What remains for your judgment

A passing gate tells you that the configured checks passed. It cannot tell you everything about whether a feature helps people or whether a design is right. You can ask your agent to explain gaps, arrange further checks, or bring in independent review when the change warrants it.

You also decide how much permission to grant. You may review each change before landing, or explicitly pre-authorize routine work within a defined scope. Passing checks does not create that permission. [Proof](proof.md) explains the evidence and landing decision in more detail.

Your agent's own permission settings govern what it may read and run; discern does not sandbox it. [Local control](local-control.md) explains what discern itself runs, records, and writes.

To try this relationship on a small task, follow [Make and review your first change](../00-start/first-real-change.md). For a larger objective, [Delegate work](../10-guides/delegate-work.md) explains how your agent can help shape it into manageable pieces.
