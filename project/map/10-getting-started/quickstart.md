---
title: Quickstart
description: Install discern, hand setup to your coding agent, and land your first gated change.
order: 20
aliases:
  - quickstart
  - getting started
  - install
---

# Quickstart: from install to a green Gate

_Install the binary, let your agent set the project up, and take one change through the Gate._

You need a Git repository and a coding agent. discern supports Claude Code, Codex, Gemini, Cursor, and GitHub Copilot. An installed project does not need Deno or Node to run discern because the product is one self-contained binary. Once installed, discern makes zero network calls.

discern sets no hard minimum model. For this one-time setup, use the strongest suitable reasoning model available. That model studies the repository. It authors the Gate, worktree policy, Map, and instructions later sessions inherit. Stronger reasoning is more likely to catch false assumptions and preserve existing workflows before those choices become project context.

Use your coding tool's model selector before setup begins. When changing models, open a fresh session in this project and give that session the setup request below. During consent, the executing agent reports its current self-declared provider/model identifier, or `unreported`, before you choose. Setup records the same advisory provenance only when you continue. Neither the report nor the record verifies capability.

## 1. Install the binary

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

When the installer prints `Next:`, continue to step 2. If it prints a `PATH` instruction instead, follow it and open a new shell. Run `discern --version`, then continue. There is nothing else to configure by hand.

## 2. Ask your agent to set the project up

In your project, tell your agent:

> Set this project up with discern.

The agent runs `discern`, which starts a staged setup ([ADR 0075](../_adr/0075-setup-staged-handshake.md)). Before writing, discern serves a consent message for the agent to relay. The message names each planned change: a `discern.toml` file at the repository root, a visible `discern/` folder for project-owned content, the agent-maintained Map, the agent files each coding agent reads, and a delimited `.gitignore` block. Project-authored instructions, Map pages, and Skills remain plain Markdown. `discern uninstall` removes the wiring.

The consent message repeats the model recommendation and names the available paths. Continue with the current model, or use the coding tool's model selector and open a fresh project session. Repeat the setup request there. The current agent stops when you switch.

Consent also covers the coding tools to wire, worktree location, time and token investment, and setup branch footprint. Answer each item in plain language. Setup cannot proceed until the agent attests that the complete consent exchange happened ([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).

`setup verify` is read-only. Each later effectful command checks its own plan-derived write targets before effects; denial preserves the phase and names the path and retry. The check is point-in-time, not cached provider authority ([Setup command boundaries](../70-reference/setup-command-boundaries.md)).

Setup works on `discern-setup` until landing. The agent inventories code and commands, preserves existing workflows, and authors final orientation after smoke. Before synthesis, it shows you the proposed primary subsystem, start point, boundary, and non-obvious invariant. You can correct that project understanding before it becomes lasting context. The Map gets the substantive primary-subsystem page plus only distinct durable boundaries.

Keep routine green output concise. Recognized captured formats include SARIF and JUnit XML; use them only when they preserve exit status and improve failure diagnostics. File-only and inherently verbose formats stay off the routine path.

## 3. Verify setup in an isolated checkout

`discern setup done` commits the completion marker, refreshes and diagnoses that commit, proves it in a temporary worktree, then runs the final Gate and returns its [one-line Proof](../20-quality-gate/the-proof.md). A failure in either checkout restores setup to incomplete ([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md), [ADR 0313](../_adr/0313-setup-completion-and-acceptance-bind-one-final-proof.md)).

The result carries Proof, its branch, and configured-job assurance. Its derived account covers the primary subsystem, project principles, protections, open items, instruction sources, Map regions, and jobs. Then it's your turn:

1. **Review and land.** Preview with `discern setup accept --dry-run`, or leave the proved branch for later. Do not restart before landing.
2. **Start a fresh session.** Follow the provider check or CLI fallback served by acceptance.
3. **Verify activation.** Report the check. Success completes setup; `discern improvement --json` remains optional.

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
