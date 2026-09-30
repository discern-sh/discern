---
id: start-installation-and-setup
title: "Install and set up discern"
description: "Install discern, have your agent set up your project, and review what every later session will inherit before it lands."
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

By the end of this tutorial, every coding session in your project will start from your project's instructions. Each task will get its own copy of the project, and a change will count as finished only when your project's own commands, such as its tests and linter, pass on it.

Your agent does most of the work, while you answer its questions and review the setup before it lands on your shared branch.

## Before you begin

You need a project and a coding agent that discern supports: Claude Code, Codex, Gemini, Cursor, or GitHub Copilot. discern runs on macOS and Linux, and on Windows through WSL 2. If your project isn't in Git yet, your agent asks before it creates a repository. [Platforms and providers](../30-reference/platforms-and-providers.md) lists the requirements.

Installing takes about a minute. Setup usually takes 20 to 40 minutes of agent time and a meaningful number of tokens. Use the strongest reasoning model you have, because setup writes what every later session relies on.

## 1. Install discern

Open a terminal and run:

<!-- discern-workflow:command -->

```sh
curl -fsSL https://discern.sh/install | sh
```

**Expected result:** The installer ends with a `Next:` line that tells you to hand the rest to your coding agent.

**If this fails:** If the installer prints a `PATH` warning instead, follow its instruction, open a new terminal, and run `discern --version` to check. For other problems, see [Setup and integrations](../40-troubleshooting/setup-and-integrations.md).

<!-- /discern-workflow -->

The installer verifies the program's checksum and doesn't change your project. If the main download address is down, use the fallback installer:

```sh
curl -fsSL https://raw.githubusercontent.com/discern-sh/discern/main/install.sh | sh
```

## 2. Ask your agent to set up the project

In a coding-agent session in your project, say:

> "Set this project up with discern. Explain the choices I need to make, and show me what future sessions will inherit before we land the setup."

Before it writes anything, your agent names its model, so you can switch to a stronger one first. It also proposes a project name, which coding tools to connect, and where task workspaces go. Answer in plain words, and add anything important it missed. Say your project is a reading-list app. You might add:

> "This app helps people keep track of books they want to read. Keeping their saved lists safe matters more than adding new features quickly."

When your agent offers to make a routine call for you, you can say "use your recommendation". Choices about cost, data, new dependencies, wider access, or rules for future work always need your decision.

## 3. Setup works on its own branch

Once you give the go-ahead, your agent works on a branch called `discern-setup`, so your shared branch doesn't change until you land the setup.

Your agent connects the commands your project already runs, such as its build, linter, and tests, to the **gate**: the commands every change must pass before it counts as finished. It also writes the project's instructions, a list of deferred work, and the **map**, your project's guide to how it works, which your agents keep current.

You don't need to watch every command. Your agent commits as it goes, investigates failing tests itself, and brings you only the decisions that need you. If the session ends early, ask a new one to carry on from setup's recorded progress. If progress stops, see [Setup and integrations](../40-troubleshooting/setup-and-integrations.md).

## 4. Setup proves itself

Before it calls setup complete, your agent runs `discern setup done`. discern runs the full gate in your project folder and again in a temporary **worktree**, a separate copy of the project made the way every future task's copy will be. Setup isn't complete until the gate passes there too.

When it passes, discern records **Proof** of which commands passed on setup's exact commit. Your agent's report ends with a line like this:

> **Proof:** Gate passed for `discern-setup` at `4561b231d9c4` · 26 files changed (+1758 −0) vs `main` · View the full Proof: `discern status --verbose`

The report also lists the commands the gate now runs, and anything setup couldn't connect. If the report says setup is **unproven**, your agent fixes what it names and runs `discern setup done` again.

## 5. Review and land setup

Check that setup describes your project correctly. Ask:

> "Walk me through the important setup changes. Show me where you recorded the project's purpose and rules, what the tests can catch, and anything that still needs attention."

Read the instructions and the start of the map for mistakes about the project's purpose or priorities. For the reading-list app, the instructions should say that keeping saved lists safe comes first. [After setup](after-setup.md) explains each new file. If you review code, ask which existing files setup changed.

If something is wrong, ask for a fix. Your agent runs `discern setup done` again, because the earlier Proof covered different files. When you're happy with it, say:

> "Land the setup."

Your agent runs `discern setup accept`, which checks the Proof and moves the setup onto your shared branch. You can ask for a preview first, or leave the branch for later review.

## 6. Restart your agent

Coding tools load instructions and tools when a session starts, so open a fresh one and ask:

> "Check that discern is active in this session, and summarize the project instructions you loaded."

The landing report names the check for your coding tool, such as calling `discern_status` and confirming it answers. For the reading-list app, the summary should say that saved lists come first. If the tool is missing, follow the report's recovery steps, or ask your agent to run `discern doctor`, which changes nothing. [Connect a coding agent](../20-guides/connect-a-coding-agent.md) has more detail.

## What you now have

Setup is on your shared branch, its gate passes, and a fresh session can use discern. Every later session starts from the instructions and map your agent wrote, so you don't have to repeat your priorities.

Next, [make and review your first change](first-real-change.md), a small one you can see.
