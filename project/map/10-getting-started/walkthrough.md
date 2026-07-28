---
title: Setup walkthrough
description: Follow the setup conversation, proof run, first worktree, gate receipt, and reviewed landing in detail.
order: 30
aliases:
  - walkthrough
  - setup walkthrough
  - first session
---

# Walkthrough: watch one change from setup to landing

_The [quickstart](quickstart.md) gives you the commands. This tour explains the handoffs you see while your coding agent does the work._

Use this page after the quickstart when you want to understand why the flow pauses, changes branches, or asks you to restart a session.

## Setup asks before it writes

Tell your coding agent:

> Set this project up with discern.

The agent runs `discern`. In a repository without an install, discern routes it into setup and serves a welcome message. The agent then runs `discern setup verify`, which returns a consent message for you.

Read that message before answering. It names the paths setup plans to add or share, the coding agents it can wire, and the commands it expects to run. It also explains removal. If the plan names the wrong repository or agents, correct the request before you approve it.

Reply in plain language, for example:

> Yes. Set up Codex and Claude Code in this repository.

The agent attests that consent happened when it begins. A fresh interactive setup cannot write without that attestation ([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).

## Setup builds on its own branch

`discern setup begin` creates and checks out `discern-setup` from your repository's trunk. The setup files therefore appear as an ordinary branch diff. Your agent first wires the project's real format, lint, build, typecheck, test, and smoke commands into `discern.toml`. It then fills the project guidance and initial map pages while those checks are live.

Watch the branch rather than the main checkout. The agent makes small authoring commits as it completes the staged setup brief. [What setup added](after-setup.md) explains each group in the diff.

## Setup proves the checkout can reproduce

When the authored files are committed, the agent runs `discern setup done`. That command refreshes generated guidance and skills, runs `discern doctor`, runs the full gate, and repeats the gate in a throwaway worktree created from the same committed setup branch ([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)).

A failure returns to the agent with the failed command and output. A pass records setup as complete and gives you the next actions:

1. Review and land the `discern-setup` branch.
2. Start a fresh coding-agent session.

The restart matters because MCP servers, hooks, and project instructions load when a session starts. The session that created them cannot gain those integrations retroactively.

## The first change uses the daily loop

In the fresh session, ask for a small, real change. The agent orients with `discern status`, then runs `discern start` from the main checkout. That creates a separate worktree and an `agent/…` branch for this task.

The agent edits and tests in that worktree. During iteration it can run `discern prepare`, the shorter fix-and-check loop. When the change is ready, it runs `discern done`. The full gate runs the repository's configured commands and any triggered scope gates or standards.

On green, discern records a receipt for the clean commit. The agent reports the change in its own words, ends with the one-line receipt, and waits; read the full receipt with `discern status --verbose`. Review the branch. If you request another commit, the receipt becomes stale and the agent must run `discern done` again.

When you approve the landing, the agent runs `discern accept`. It fast-forwards the reviewed branch onto the trunk, destroys any worktree resources, removes the worktree directory, and deletes the merged branch ([ADR 0110](../_adr/0110-the-landing-model.md)).

If any step differs from this tour, start with the [FAQ and troubleshooting guide](faq.md).
