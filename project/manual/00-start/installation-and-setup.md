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

By the end of this tutorial, every coding session in your project will start with your project's instructions. Each task will get its own copy of the project, and your project's checks will run before any change counts as finished.

Your agent does most of the work. You install one program, answer the questions only you can answer, and review the setup before it lands on your shared branch. The [next tutorial](first-real-change.md) then takes you through a small change you can see.

## Before you begin

You need a project and a coding agent that discern supports: Claude Code, Codex, Gemini, Cursor, or GitHub Copilot. discern runs on macOS and Linux, and on Windows through WSL 2. It works through Git, so if your project folder isn't a Git repository yet, your agent asks before it creates one. [Platforms and providers](../30-reference/platforms-and-providers.md) lists the exact requirements.

Installing takes about a minute. Setup takes one working session, usually 20 to 40 minutes of agent time and a meaningful number of tokens. Your agent studies the project and writes what every later session will rely on, so use the strongest reasoning model you have for this step.

Stay close at the start and at the end. Your agent asks its questions first, does the technical work, and then brings the result back for your review. While it works, it asks only when it needs a decision from you.

## 1. Install discern

Open a terminal and run:

<!-- discern-workflow:command -->

```sh
curl -fsSL https://discern.sh/install | sh
```

**Expected result:** The installer ends with a `Next:` line that tells you to hand the rest to your coding agent.

**If this fails:** If the installer prints a `PATH` warning instead, follow its instruction, open a new terminal, and run `discern --version` to check. For other problems, see [Setup and integrations](../40-troubleshooting/setup-and-integrations.md).

<!-- /discern-workflow -->

The installer downloads one program and checks it before installing it. It doesn't change your project, and your project doesn't need Deno or Node for discern.

If the main download address isn't available, use the fallback installer:

```sh
curl -fsSL https://raw.githubusercontent.com/discern-sh/discern/main/install.sh | sh
```

## 2. Ask your agent to set up the project

Open a coding-agent session in your project and say:

> Set this project up with discern. Explain the choices I need to make, and show me what future sessions will inherit before we land the setup.

Before it writes anything, your agent brings you a proposal. It names the model doing the setup, so you can switch to a stronger one before work begins. It suggests a name for the project, which coding tools to connect, and where task workspaces will live. It also gives the expected time and token cost.

Answer in plain words. Confirm the project name or correct it, and tell the agent anything important about the project that it has missed. For example:

> This app helps people keep track of books they want to read. Keeping their saved lists safe matters more than adding new features quickly.

For a routine choice the agent marks as safe to hand over, you can say “use your recommendation”. Choices about cost, data, new dependencies, wider access, or rules for future work always need your own decision.

Your go-ahead lets the agent set things up on a separate branch. It doesn't land anything. You make that decision at the end.

## 3. Setup works on its own branch

The agent creates a branch called `discern-setup`, a separate line of work in Git. Your shared branch doesn't change while setup works there.

The agent studies the project and connects the project's existing checks to the **gate**: the checks every change must pass before it counts as finished. These might check formatting, build the app, or run its tests. The agent also writes the project's instructions, a guide to the project called the **map**, and a list of deferred work. It saves its work in small commits and tells you what it has learned as it goes.

You don't need to watch every command. If a question needs you, the agent explains what's at stake and what it recommends. A failing check is work for the agent to investigate. If progress stops, see [Setup and integrations](../40-troubleshooting/setup-and-integrations.md).

If the session ends before setup finishes, open a new session and ask the agent to resume setup. discern records its progress, so finished steps aren't repeated.

## 4. Setup proves itself

Before it calls setup complete, your agent runs `discern setup done`. discern checks the setup and runs the full gate. It also tries the project in a temporary **worktree**, a separate copy of the project like the ones future tasks will use. Setup doesn't count as complete until that trial passes.

When it passes, discern records **Proof**: a record that your project's checks passed on one exact commit, a saved version of the code. The agent's report ends with a line like this one, with your own branch details and counts:

> **Proof:** Gate passed for `discern-setup` at `4561b231d9c4` · 26 files changed (+1758 −0) vs `main` · View the full Proof: `discern status --verbose`

The code after `at` names the commit the checks ran on. The file count shows how much setup changed, and the last command shows the full record. The report also says which checks now run, and anything setup couldn't connect yet. Ask your agent to explain it in terms of your project.

If the agent reports setup as **unproven**, this step isn't finished. The agent needs to fix what the report names and run `discern setup done` again before setup can land.

## 5. Review and land setup

Check whether the setup describes the project you want future agents to work on. Ask:

> Walk me through the important setup changes. Show me where the project's purpose and working rules are recorded, explain what the checks can catch, and point out anything that still needs attention.

Read the short instructions and the start of the map. Look for mistakes about the project's purpose, priorities, or assumptions. [After setup](after-setup.md) explains what each new file does. If you review code, ask the agent to point out changes to existing checks, settings, or app files.

If something is wrong or unclear, ask for a fix. The agent checks the revised setup again, because the earlier Proof covered different files.

When you're happy with it, say:

> Land the setup.

The agent runs `discern setup accept`. It checks the Proof and moves the setup onto your shared branch. To see the plan first, ask the agent to run `discern setup accept --dry-run`. You can also leave the branch for later review.

## 6. Restart your agent

Open a fresh session in your project. Coding tools load instructions and tools when a session starts, so a fresh session is the real test of what setup prepared. Ask:

> Check that discern is active in this session, and summarize the project instructions you loaded.

When setup lands, the agent's report names the exact check for your coding tool. The new agent calls one of discern's tools, such as `discern_status`, and confirms it answers. Files on disk don't prove that a session can use them, so this step checks the running session.

If the tool is missing, follow the recovery steps the report gives for your tool, or ask the agent to run `discern doctor`. [Connect a coding agent](../20-guides/connect-a-coding-agent.md) has more detail.

## What you now have

Setup is on your shared branch, its checks pass, and a fresh session can use discern. Every later session starts from the instructions and map your agent wrote, and your agents keep them up to date.

Next, [make and review your first change](first-real-change.md). It uses a small change you can see, and shows how your own review fits with the Proof your agent brings back.
