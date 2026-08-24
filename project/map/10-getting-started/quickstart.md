---
title: Quickstart
description: Install discern, hand setup to your coding agent, and land your first gated change.
order: 20
aliases:
  - quickstart
  - getting started
  - install
---

# Quickstart: from install to a passing final check

_Install the binary, let your agent set the project up, and take one change through the project's final quality check, called the Gate._

You need a Git repository and a coding agent. discern supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. An installed project does not need Deno or Node to run discern because the product is one self-contained binary. Once installed, discern makes zero network calls.

discern sets no hard minimum model. For setup, it recommends the strongest suitable reasoning model available because that model authors the final quality check, separate-task rules, maintained project guide, and instructions later sessions inherit. [Setup decisions](setup-decisions.md) explains the long-term benefit, how to switch models, and which later choices remain yours.

## 1. Install the binary

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

When the installer prints `Next:`, continue to step 2. If it prints a `PATH` instruction instead, follow it and open a new shell. Run `discern --version`, then continue. There is nothing else to configure by hand.

## 2. Ask your agent to set the project up

In your project, tell your agent:

> Set this project up with discern.

The agent runs `discern`, which starts a staged setup ([ADR 0075](../_adr/0075-setup-staged-handshake.md)). Before writing, its consent message covers the `discern.toml` and `discern/` footprint, coding-tool integrations, removal behavior, model, evidence-backed project name, separate-workspace location, and expected time and tokens. Confirm each item in plain language; the agent records that the complete exchange happened ([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).

`setup verify` is read-only. Later commands check their planned write targets before effects and preserve the setup phase on denial ([Setup command boundaries](../70-reference/setup-command-boundaries.md)).

Setup stays on `discern-setup` until landing. After proving existing workflows together, the agent explains where later agents start, that area's responsibility, one important rule, and any other distinct area. Correct a substantive misunderstanding, or say “use your recommendation.”

## 3. Verify setup in an isolated checkout

`discern setup done` commits and diagnoses completion, proves it in a separate working copy, runs the final quality check, and returns [proof that the finished change passed the project's checks](../20-quality-gate/the-proof.md), called Proof. A failure restores setup to incomplete ([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md), [ADR 0313](../_adr/0313-setup-completion-and-acceptance-bind-one-final-proof.md)).

The result explains where later agents start, which other areas have distinct responsibilities, one important rule setup found, which checks now run, and what remains open. It also carries the precise branch, check, guide, and instruction inventories for technical review. Then it's your turn:

1. **Review and land.** Preview with `discern setup accept --dry-run`, or leave the proved branch for later. Do not restart before landing.
2. **Start a fresh session.** Inspect its registered tools before opening external documentation.
3. **Verify activation.** Invoke the exact provider-local action served by acceptance. If it is missing, use that provider's local recovery or `discern doctor`; `discern improvement --json` remains optional after success.

<!-- discern-workflow:procedure -->

## 4. Take a change through the Gate

In the fresh session, ask for a small, real change. The agent takes it through the same isolated lifecycle every time.

**Before you start:**

- Setup's `discern-setup` branch is reviewed and landed.
- The coding agent is running in a fresh session.

**Steps:**

1. **Start the worktree.** The agent runs `discern start`, then re-roots at its returned isolated checkout path on an `agent/…` branch.
2. **Make the change.** It edits and checks the requested work inside that worktree.
3. **Run the full Gate.** It runs `discern done`. The Gate runs the format, build, lint, and test commands declared in `discern.toml`. A failure gives the agent the failing command and its output.
4. **Report the result.** On green, the agent ends its report with the one-line Proof and waits. Read the full Proof with `discern status --verbose`.

**You are done when:** The reviewed branch and its Proof have been authorized, and `discern accept` has fast-forwarded the trunk.

<!-- /discern-workflow -->

Review the branch. When you authorize landing, the agent runs `discern accept`, which fast-forwards your trunk to the reviewed branch and removes the worktree ([ADR 0110](../_adr/0110-the-landing-model.md)). Acceptance reuses the Proof while the branch remains unchanged. A later commit invalidates the Proof, so the agent must run `discern done` again.

To drive the handoff yourself, run bare `discern` from the main checkout. The human view over work in progress ([the Desk](../30-worktrees/the-desk.md)) can start the task, open a configured coding-agent CLI found on `PATH` in its new worktree, and present the valid actions through review and landing.

The change stays in its worktree until the Gate passes and recorded authority permits landing.

<!-- discern-workflow:branch-choice -->

**Choose what happens next**

- **Recommended:** Follow the [walkthrough](walkthrough.md) through one complete session.
- **Something went wrong:** Match the symptom in the [FAQ](faq.md) to its fix.

<!-- /discern-workflow -->
