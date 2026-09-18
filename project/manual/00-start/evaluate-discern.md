---
id: start-evaluate-discern
title: "Evaluate discern"
description: "See how discern helps you direct coding agents, keep project knowledge, and review finished work before deciding to install it."
order: 20
publish: true
kind: explanation
aliases:
  - "start-evaluate-discern"
  - "orientation"
  - "introduction"
  - "start here"
  - "is discern right for me"
---

# Evaluate discern

You have an idea for the next feature. Your coding agent can build it, but you also want the project to remember your decisions, keep existing behavior working, and show you what was checked before you use the result.

discern puts that way of working into your project. Your agent sets it up and operates it; you describe what you want to achieve and review what comes back. This page helps you decide whether it fits, before you install anything.

## What discern changes

Imagine adding search to an app. You explain what people should be able to find, and your agent works on the change in a separate workspace. The current shared version of the project stays apart from the unfinished work.

Before reporting the change complete, your agent runs the project's configured checks. discern records which version passed and returns that evidence with the result. You can try the search, ask what the checks cover, and decide whether the change is ready to join the shared project.

That sequence brings three useful things together:

- **A consistent meaning of finished.** The project's final quality check, called the **gate**, runs its own commands. Your agent gets failures to investigate while the work is still in progress, and you receive evidence of the checks that passed.
- **Room for work to move independently.** Each task gets an isolated workspace, called a **worktree**. Several agents can work without editing the same checkout. Changes that affect the same behavior still need coordination and review.
- **Knowledge the next session can use.** Instructions and a maintained project guide, called the **map**, live in ordinary project files. When an agent records a convention or decision there, a future session can pick it up without another explanation from you.

The completion evidence is called [Proof](../20-understand/proof.md). It belongs to one exact committed version of the change. A passing gate establishes that the configured checks passed; your review covers what those checks cannot decide, including whether the feature is useful and belongs in the product.

## What it asks of you

Setup is a working session with your agent, usually around 20 to 40 minutes of agent effort. The agent studies the project, connects its checks, and writes the project instructions future sessions will inherit. You confirm what setup may change and answer questions about the project's purpose, access, cost, or other choices the files cannot settle.

After setup, you can give ordinary requests:

> Add search to the saved items page. Show me how to try it, explain what you checked, and bring the finished change back for review.

You don't need to learn discern's command sequence to make that request. The agent receives the operating instructions and follows the reported next steps.

You do need time to review results and make decisions. For a small visible change, trying the behavior and understanding the checks may be enough. Changes with broader consequences may need deeper technical review. discern helps you see the evidence available for that decision; it does not supply every kind of expertise a project may need.

## What fits your project

discern works with projects kept in Git, the version-control system that records changes. It supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot on macOS, Linux, and Windows through WSL 2. The [platforms and providers reference](../30-reference/platforms-and-providers.md) gives the current requirements.

The project's language and tools can vary: discern runs the commands configured for that project. One setup covers an entire Git repository, including a repository with several apps or packages. If you're unsure whether your project is ready, ask your agent to check the prerequisites before installing.

It is most useful when you want to:

- give agents work while keeping unfinished changes separate;
- understand what was checked before a change becomes shared;
- preserve project decisions across sessions and supported coding tools;
- keep measured improvements from slipping back as the project grows.

A coding agent is the day-to-day operator. If your workflow has no coding agent, discern is unlikely to be a useful addition. It also runs locally rather than providing a hosted team dashboard.

## Where its boundary sits

discern is one local executable with no AI model, account, or API key of its own. Its activity record stays on your machine. Your coding agent still uses its own provider, and your project's commands can contact services as they normally would. [Local control](../20-understand/local-control.md) explains those boundaries.

The project's shared branch is called the **trunk**, usually `main`. Moving a completed change onto it is **landing**. discern requires your permission to land: you can decide change by change, or explicitly arrange permission for routine work within a defined scope. Passing the gate supplies evidence, but you still grant permission before the change lands. Landing also remains separate from publishing or deploying your app.

## How it leaves

The instructions, map, and other material you and your agents write remain ordinary files you own. If you later remove discern, its uninstall command removes the integration wiring and keeps that authored material. You also choose when to upgrade; the binary never updates itself. [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md) explains both operations.

## Decide

If this is the way you'd like your agents to work, [install and set up discern](installation-and-setup.md). The setup is reviewed before it lands, and the next tutorial takes you through a small change you can try for yourself.

For a closer look at the everyday relationship between you, the agent, and the project, read [Practice and roles](../20-understand/practice-and-roles.md).
