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

discern sets no minimum model. Each refusal and failure report names the next valid action. Choose a model that can follow the project's instructions and perform the requested task.

## 1. Install the binary

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

When the installer prints `Next:`, continue to step 2. If it prints a `PATH` instruction instead, follow it and open a new shell. Run `discern --version`, then continue. There is nothing else to configure by hand.

## 2. Ask your agent to set the project up

In your project, tell your agent:

> Set this project up with discern.

The agent runs `discern`, which starts a staged setup ([ADR 0075](../_adr/0075-setup-staged-handshake.md)). Before writing, discern serves a consent message for the agent to relay. The message names each planned change: a `discern.toml` file at the repository root, a visible `discern/` folder for project-owned content, the agent-maintained Map, the agent files each coding agent reads, and a delimited `.gitignore` block. Project-authored instructions, Map pages, and Skills remain plain Markdown. `discern uninstall` removes the wiring.

Answer in plain language: "Yes. Set up Claude Code and Codex." Setup cannot proceed until the agent records your consent ([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).

`discern setup verify` is strictly read-only. Consent does not prove write access: in the later `setup begin`, `setup done`, and `setup accept` invocations, discern first exercises the filesystem and Git-admin writes that command's effect plan requires. If the environment denies one, setup returns the exact path and retry command before changing phase or starting slow work. A successful probe is valid only at that point in that invocation; discern neither grants nor caches provider authorization ([ADR 0320](../_adr/0320-setup-plans-own-write-authority-and-activation-recovery.md)).

Setup writes ordinary files on a separate `discern-setup` branch, keeping those changes off `main` until you land them. The format job already contains `discern tidy` for discern-owned Markdown and the root config. The agent puts your stack's formatter before it, then wires lint, test, and the other commands your project runs. It fills in instructions and the first Map pages under that live Gate. From that point, each configured agent reads the same compiled instructions and runs the same commands.

The Static Analysis Results Interchange Format (SARIF) is a machine-readable findings format. During setup, configure tools to emit SARIF or JUnit XML to captured `stdout` or `stderr`. Failed jobs become per-finding diagnostics. discern does not inspect report files. Other captured output remains raw.

## 3. Verify setup in an isolated checkout

`discern setup done` commits the completion marker, refreshes and diagnoses that commit, proves it in a temporary worktree, then runs the final Gate and returns its [one-line Proof](../20-quality-gate/the-proof.md). A failure in either checkout restores setup to incomplete ([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md), [ADR 0313](../_adr/0313-setup-completion-and-acceptance-bind-one-final-proof.md)).

Then it's your turn:

1. **Start a fresh agent session and run the served check.** The Model Context Protocol (MCP) tools and session hooks load at session start, so the session that ran setup cannot see them yet. `setup done` names one exact provider-aware check. If it is unavailable, follow the one local recovery step and use `discern status --json` as the command-line fallback; generated files alone do not prove activation.
2. **Review and land the `discern-setup` branch.** Setup is ordinary file edits on a branch you can read.

<!-- discern-workflow:procedure -->

## 4. Take a change through the Gate

In the fresh session, ask for a small, real change. The agent takes it through the same isolated lifecycle every time.

**Before you start:**

- Setup's `discern-setup` branch is reviewed and landed.
- The coding agent is running in a fresh session.

**Steps:**

1. **Start the worktree.** The agent runs `discern start` and gets an isolated checkout on an `agent/…` branch without editing the main checkout.
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
