---
title: Setup walkthrough
description: Follow the setup conversation, verification run, first worktree, Gate Proof, and reviewed landing in detail.
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

discern commits the wiring it scaffolds before the handoff and the completion marker after setup passes. Those machine-composed commits keep your Git identity as author and add `discern <done@discern.sh>` as a co-author. The agent's authoring commits stay unchanged ([ADR 0203](../_adr/0203-discern-co-authors-only-commits-it-composes.md)).

Watch the branch rather than the main checkout. The agent makes small authoring commits as it completes the staged setup brief. [What setup added](after-setup.md) explains each group in the diff.

## Setup verifies the checkout can reproduce

When the authored files are committed, the agent runs `discern setup done`. That command refreshes generated guidance and Skills, runs `discern doctor`, runs the full Gate, and repeats the Gate in a temporary worktree created from the same committed setup branch ([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)).

A failure result includes the failed command and output. A pass records setup as complete and gives you the next actions:

1. Review and land the `discern-setup` branch.
2. Start a fresh coding-agent session.

The restart matters because Model Context Protocol (MCP) servers, hooks, and project instructions load when a session starts. The session that created them cannot gain those integrations retroactively.

## The first change uses the daily loop

In the fresh session, ask for a small, real change. The agent orients with `discern status`, then runs `discern start` from the main checkout. That creates a separate worktree and an `agent/…` branch for this task.

The agent edits and tests in that worktree. During iteration it can run `discern prepare`, the shorter loop of fixers, regenerations, and checks. For the intended final commit, it runs `discern done`. The full Gate runs the repository's configured commands and any triggered scope gates or Standards.

On green, discern records a Proof for the clean commit. The agent reports the change in its own words, ends with the one-line Proof, and waits. Read the full Proof with `discern status --verbose`, then review the branch. If you request another commit, the Proof becomes stale and the agent must run `discern done` again.

When you approve the landing, the agent runs `discern accept`. It fast-forwards the reviewed branch onto the trunk, destroys any worktree resources, removes the worktree directory, and deletes the merged branch ([ADR 0110](../_adr/0110-the-landing-model.md)).

If any step differs from this tour, start with the [FAQ and troubleshooting guide](faq.md).
