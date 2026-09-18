---
id: start-installation-and-setup
title: "Install and set up discern"
description: "Have your agent set up the project, understand what future sessions will inherit, and review the result before it lands."
order: 30
publish: true
kind: tutorial
aliases:
  - "First success"
  - "install"
  - "start-first-success"
  - "Quickstart: from install to a passing final check"
  - "quickstart"
  - "The decisions setup asks you to make"
  - "setup choices"
  - "setup model"
  - "setup consent"
  - "Walkthrough: watch one change from setup to landing"
  - "walkthrough"
  - "setup walkthrough"
  - "first session"
---

# Install and set up discern

By the end of this tutorial, your project will have shared instructions for its coding agents, checks that define when work is complete, and a separate workspace for each task. Your agent builds that setup around the project you already have, so future sessions can begin with useful context and a consistent way to work.

You will install discern, give the setup request, review what your agent prepares, and open a fresh session to confirm it works. A [second tutorial](first-real-change.md) then guides you through a small, visible change.

## Before you begin

You need a project stored in Git and a supported coding agent: Claude Code, Codex, Gemini, Cursor, or GitHub Copilot. discern runs on macOS, Linux, and Windows through WSL 2. Your agent can check the [platforms and prerequisites](../30-reference/platforms-and-providers.md) if you're unsure.

Allow a working session. Installation takes about a minute; setup usually takes 20 to 40 minutes of agent effort and uses a meaningful number of tokens. The agent studies the repository and writes material that later sessions will rely on, so discern recommends your strongest suitable reasoning model for this step.

Stay reachable for the initial choices and final review. Your agent handles the technical work in between and asks when it needs a decision the project files cannot supply.

## 1. Install the binary

Open a terminal and run:

<!-- discern-workflow:command -->

```sh
curl -fsSL https://discern.sh/install | sh
```

**Expected result:** The installer prints `Next:` and tells you to hand the rest to your coding agent.

**If this fails:** If it prints a `PATH` instruction, follow that line and open a new terminal. This lets your shell find the installed program. Run `discern --version` to confirm. For other failures, use [Setup and integrations](../40-troubleshooting/setup-and-integrations.md).

<!-- /discern-workflow -->

The installer downloads one self-contained executable. Your project does not need Deno or Node for discern itself. Installation leaves the project alone; the next step asks before changing it.

If the main download endpoint is unavailable, the fallback installer is:

```sh
curl -fsSL https://raw.githubusercontent.com/discern-sh/discern/main/install.sh | sh
```

## 2. Ask your agent to set the project up

Open a coding-agent session in your project and say:

> Set this project up with discern. Explain the choices I need to make and show me what future sessions will inherit before we land the setup.

Your agent reads discern's setup instructions and brings you an initial proposal. It covers the project name, which installed coding tools to connect, where task workspaces will live, and the expected time and token use. It also gives the model recommendation, so you can switch before work begins.

Review that proposal in ordinary language. Confirm or correct the project name and explain any important purpose the agent has missed. For example:

> This app helps people keep track of books they want to read. Keeping their saved lists matters more than adding new features quickly.

For a routine choice the proposal marks as suitable for delegation, “use your recommendation” is an answer. Choices involving cost, data, new dependencies, broader access, or future policy need your explicit decision.

Your go-ahead authorizes setup work on a separate branch. The decision to make it part of the shared project comes later.

## 3. Setup works on its own branch

The agent creates a branch called `discern-setup`: a separate line of work tracked by Git. It can prepare the setup there without advancing the shared branch.

It studies the existing project and connects its commands to the final quality check, called the **gate**. Those commands might check formatting, build the app, or run tests. The agent also writes the instructions, project guide, and deferred-work list that later sessions will use. It explains its progress and saves the work as it goes.

You should be able to follow what it has learned without supervising each command. If a question needs you, the agent explains the consequence and its recommendation. A failing check is work for the agent to investigate; [setup troubleshooting](../40-troubleshooting/setup-and-integrations.md) explains what to do if progress stops.

If the session ends, ask the next agent to resume the existing setup. discern records its progress so completed setup steps do not need to be repeated from scratch.

## 4. Setup proves itself

Before calling setup complete, your agent runs `discern setup done`. discern checks the setup, tries it in a temporary isolated workspace, and runs the full gate. That trial matters: future tasks need to work in their own workspaces, too.

Setup also settles what each future check will cost. Every quality number the project holds gets a producer the gate already runs, and a check whose inputs are declared is reused when those inputs are unchanged. The agent tells you in plain terms which evidence is produced again for every commit and which is reused.

A successful result includes **Proof**, the evidence that the configured checks passed for one exact commit. A commit is a saved version of the project. This illustrative Proof line shows the format; your result will contain its own identifier and counts:

> **Proof:** Gate passed for `discern-setup` at `4561b231d9c4` · 26 files changed (+1758 −0) vs `main` · View the full Proof: `discern status --verbose`

The identifier after `at` tells you which version was checked. The file count tells you how much changed, and the final command retrieves the detailed account. Ask your agent to explain that account in terms of your project: which checks are active, what they cover, and what remains open.

If setup is reported as **unproven**, this stage is unfinished. The agent needs to resolve the reported gap and verify setup before it can land.

## 5. Review and land setup

The most useful review question is: **does this describe the project I want future agents to work on?** Ask:

> Walk me through the important setup changes. Show me where the project purpose and working rules are recorded, explain what the checks can catch, and point out anything that still needs attention.

Read the short instructions and the introduction to the project guide. Look for mistakes in purpose, priorities, or assumptions. The [After setup](after-setup.md) page shows what the new files do. If you review code, the full branch diff is available too; ask the agent to highlight changes to existing checks, settings, or application files.

Ask for revisions when something is wrong or unclear. The agent verifies the revised version again, because the earlier Proof covered different files.

When you're satisfied, say:

> Land the setup.

The agent runs `discern setup accept`, which checks the evidence and moves the setup onto the shared branch. You can also leave it for later review. If you want to preview the landing first, ask the agent to run `discern setup accept --dry-run`.

## 6. Restart your agent

Open a fresh coding-agent session in the project. Coding tools load instructions and integrations when sessions start, so this confirms that the next session receives what setup prepared.

Ask:

> Check that discern is active in this session and summarize the project instructions you loaded.

The setup handoff supplies the exact activation check for your tool. The new agent calls a registered discern tool, such as `discern_status`, and confirms it answers. Files existing on disk are only part of setup; this checks that the running session can use them.

If the tool is missing, follow the provider's recovery steps in the handoff or ask the agent to run `discern doctor`. [Connect a coding agent](../10-guides/connect-a-coding-agent.md) has more detail.

## What you now have

Setup is on the shared branch, its checks have passed, and a fresh session can use discern. The instructions and project guide are available for later sessions to inherit and maintain.

You are ready to [make and review your first change](first-real-change.md). That tutorial uses a small improvement you can see, then shows how to connect your own review with the evidence your agent returns.
