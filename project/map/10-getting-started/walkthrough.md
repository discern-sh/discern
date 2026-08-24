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

_The [quickstart](quickstart.md) gives you the commands. This tour explains the handoffs: why the flow pauses, changes branches, or asks you to restart a session._

## Setup asks before it writes

Tell your coding agent:

> Set this project up with discern.

The agent runs `discern`. In a repository without an install, discern routes it into setup and serves a welcome message. The agent then runs `discern setup verify`, which returns a consent message for you.

Read that message before answering. It names the paths setup plans to add or share, the coding agents it can wire, and the commands it expects to run. It also explains removal. If the plan names the wrong repository or agents, correct the request before you approve it.

Reply in plain language, for example:

> Yes. Set up Codex and Claude Code in this repository.

The agent attests that consent happened when it begins. A fresh interactive setup cannot write without that attestation ([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).

That attestation records the owner's consent. `verify` performs no write probe. In the later effectful invocation, setup checks whether the process can write: it derives the required targets from its command plan and exercises them after consent and other cheap read-only checks but before its first effect. A denial returns `write_access` with the exact path and a complete retry command, leaving the setup phase unchanged. The probe observes point-in-time authority; it cannot persist or bypass the host's sandbox policy.

## Setup builds on its own branch

`discern setup begin` creates and checks out `discern-setup` from your repository's trunk. The setup files therefore appear as an ordinary branch diff. Your agent records the project's real format, lint, build, typecheck, test, and smoke commands and any known lifecycle that does not apply in `discern.toml`. It then fills the project instructions and initial map pages while those checks are live, including the seeded record of the adoption decision.

discern commits its scaffolded wiring before the handoff. Final completion commits the marker before producing [Gate Proof](../20-quality-gate/the-proof.md). Those commits keep your Git identity as author and add `discern <done@discern.sh>` as a co-author. Agent-authored commits stay unchanged ([ADR 0203](../_adr/0203-discern-co-authors-only-commits-it-composes.md)).

Watch the branch rather than the main checkout. The agent makes small authoring commits as it completes the staged setup brief. [What setup added](after-setup.md) explains each group in the diff.

If the process is interrupted or the provider requires a restart, do not reconstruct the sequence with raw Git. Run `discern setup` or `discern status`; the recorded phase reports the dedicated branch and the exact bounded setup command that continues. Repeating that phase does not replay already completed setup writes.

## Setup verifies the checkout can reproduce

When the authored files are committed, the agent runs `discern setup done`. A preparatory refresh stops if tracked generated artifacts still need a review commit. The final transaction then commits `[meta].bootstrapped = true`, refreshes and diagnoses that marker-bearing commit, and creates a temporary worktree from it. The temporary checkout must retain Gate Proof for the same commit. The main-checkout Gate runs last and records the canonical Proof that completion returns ([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md), [ADR 0313](../_adr/0313-setup-completion-and-acceptance-bind-one-final-proof.md)).

If any final check fails, setup restores `[meta].bootstrapped` to the incomplete state. A successful non-forced result includes the structured Proof inspection and a one-line Proof you can relay. `--force` is visibly unproved and cannot be accepted through the proved setup landing path.

A failure result includes the failed command and output. A pass records completion, reports applicable protection coverage, and gives the next actions ([ADR 0317](../_adr/0317-gate-commands-and-setup-applicability-are-separate-facts.md)):

1. Review and land the `discern-setup` branch.
2. Start a fresh coding-agent session.

The restart matters because Model Context Protocol (MCP) servers, hooks, and project instructions load when a session starts. The session that created them cannot gain those integrations retroactively. Completion derives one exact check for each configured coding agent from the provider registry. In the fresh session, run that check. If it is unavailable, follow the provider's one local recovery step and use `discern status --json` as the CLI fallback. Do not infer activation merely because the generated files exist ([ADR 0320](../_adr/0320-setup-plans-own-write-authority-and-activation-recovery.md)).

`discern setup accept --dry-run` first validates that Proof without changing a branch or ref. Apply lands the full commit named by Proof and records the standard durable Proof note. If trunk moved after completion, setup acceptance merges trunk into `discern-setup`, runs the Gate on the merge commit, and lands only the new Proof. Missing, stale, dirty, unreadable, mismatched, forced, or declaration-stale evidence returns to `discern setup done` with trunk untouched.

## The first change uses the daily loop

In the fresh session, ask for a small, real change. The agent orients with `discern status`, then runs `discern start` from the main checkout. That creates a separate worktree and an `agent/…` branch for this task.

The agent edits and tests in that worktree. During iteration it can run `discern prepare`, the shorter loop of fixers, regenerations, and checks. For the intended final commit, it runs `discern done`. The full Gate runs the repository's configured commands and any triggered scope gates or Standards.

On green, discern records a Proof for the clean commit. The agent reports the change in its own words, ends with the one-line Proof, and waits. Read the full Proof with `discern status --verbose`, then review the branch. If you request another commit, the Proof becomes stale and the agent must run `discern done` again.

When you approve the landing, the agent runs `discern accept`. It fast-forwards the reviewed branch onto the trunk, destroys any worktree resources, removes the worktree directory, and deletes the merged branch ([ADR 0110](../_adr/0110-the-landing-model.md)).

If any step differs from this tour, start with the [FAQ and troubleshooting guide](faq.md).
