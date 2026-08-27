---
title: Setup walkthrough
description: Follow the setup conversation, verification run, first worktree, Gate Proof, and reviewed landing in detail.
order: 40
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

The agent runs `discern`. In a repository without an install, discern serves a welcome with the model recommendation, switch route, and lasting outcome. [Setup decisions](setup-decisions.md) explains the owner boundary.

The selected agent runs `discern setup verify`. Read its consent message before answering. It reports the self-declared provider/model identifier, or `unreported`, proposes a project name from repository evidence, and names paths, coding agents, separate-workspace location, expected investment, removal, and confirmation authority. Correct a wrong project name, model path, or agent set first.

Reply in plain language, for example:

> Continue with this model. Set up Codex and Claude Code in this repository, keep the proposed worktree location, and begin the isolated setup branch.

The agent attests that consent happened when it begins ([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)). `verify` remains read-only. Each later effectful command checks its plan-derived writes before its first effect. Denial preserves the phase, and success is point-in-time rather than provider authorization; see [Setup command boundaries](../70-reference/setup-command-boundaries.md).

## Setup builds on its own branch

`discern setup begin` creates and checks out `discern-setup` from your repository's trunk. The setup files therefore appear as an ordinary branch diff. Your agent records the project's real format, lint, build, typecheck, test, and smoke commands and any known lifecycle that does not apply in `discern.toml`. It then fills the project instructions and initial map pages while those checks are live, including the seeded record of the adoption decision.

discern commits its scaffolded wiring before the handoff. Final completion commits the marker before producing [Gate Proof](../20-quality-gate/the-proof.md). Those commits keep your Git identity as author and add `discern <done@discern.sh>` as a co-author. Agent-authored commits stay unchanged ([ADR 0203](../_adr/0203-discern-co-authors-only-commits-it-composes.md)).

Watch the branch rather than the main checkout. The agent makes small authoring commits as it completes the staged setup brief. [What setup added](after-setup.md) explains each group in the diff.

The agent narrates each major stage with its owner benefit. It handles routine reversible authoring without asking for file-by-file permission. It waits only when repository evidence cannot settle product intent or a new quality protection needs a consequential effect. It also waits for substantive corrections to where later agents should start, and for owner decisions about cost, durable data, broader access, policies that bind future work, or unsafe merges.

If a project file points outside the repository, the agent reports the destination and its apparent role before reading it. You can authorize that specific inspection or keep the boundary in place. A missing conflict or outside reference produces no synthetic question or wait.

After interruption, run `discern setup` or `discern status`; the recorded phase, branch, and continuation avoid replaying completed writes. Stable step ids preserve resumption while their registry orders evidence and smoke before final documentation.

## Setup verifies the checkout can reproduce

When the authored files are committed, the agent runs `discern setup done`. A preparatory refresh stops if tracked generated artifacts still need a review commit. The final transaction then commits `[meta].bootstrapped = true`, refreshes and diagnoses that marker-bearing commit, and creates a temporary worktree from it. The temporary checkout must retain Gate Proof for the same commit. The main-checkout Gate runs last and records the canonical Proof that completion returns ([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md), [ADR 0313](../_adr/0313-setup-completion-and-acceptance-bind-one-final-proof.md)).

If any final check fails, setup removes only the marker commit this invocation can still prove it owns and restores the sampled predecessor. If the branch or checkout changed, discern retains that exact state and names recovery instead of moving the ref. A successful non-forced result includes the structured Proof inspection and a one-line Proof you can relay. Repeating it on the unchanged clean marker-bearing commit re-serves the same Proof and completion facts without another probe, Gate, or write. `--force` is visibly unproved and cannot be accepted through the proved setup landing path ([ADR 0351](../_adr/0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips.md)).

A failure result includes the failed command and output. A pass explains where later agents should begin, what that area owns, other areas with distinct responsibilities, one important rule setup discovered, checks that run, and concrete open items. Precise project-guide, deferred-work, and check inventories support that plain account ([ADR 0317](../_adr/0317-gate-commands-and-setup-applicability-are-separate-facts.md)).

An unlanded result offers landing, later review, or decline; the main shared version lacks setup, so restart and improvement stay absent. After `discern setup accept`, start fresh, inspect the session's registered tools, invoke its exact provider-local activation action, and use the served recovery or `discern doctor` if needed. Generated files do not prove activation. Success makes `discern improvement` optional ongoing work ([Setup command boundaries](../70-reference/setup-command-boundaries.md)).

`discern setup accept --dry-run` first validates that Proof without changing a branch or ref. Apply lands the full commit named by Proof and records the standard durable Proof note. If trunk moved after completion, setup acceptance merges trunk into `discern-setup`, runs the Gate on the merge commit, and lands only the new Proof. Missing, stale, dirty, unreadable, mismatched, forced, or declaration-stale evidence returns to `discern setup done` with trunk untouched.

## The first change uses the daily loop

In the fresh session, ask for a small change. After `discern status`, the agent runs `discern start` from the main checkout and re-roots at its returned worktree path on an `agent/…` branch.

The agent edits and tests in that worktree. During iteration it can run `discern prepare`, the shorter loop of fixers, regenerations, and checks. For the intended final commit, it runs `discern done`. The full Gate runs the repository's configured commands and any triggered scope gates or Standards.

On green, discern records a Proof for the clean commit. The agent reports the change in its own words, ends with the one-line Proof, and waits. Read the full Proof with `discern status --verbose`, then review the branch. If you request another commit, the Proof becomes stale and the agent must run `discern done` again.

When you approve the landing, the agent runs `discern accept`. It fast-forwards the reviewed branch onto the trunk, destroys any worktree resources, removes the worktree directory, and deletes the merged branch ([ADR 0110](../_adr/0110-the-landing-model.md)).

If any step differs from this tour, start with the [FAQ and troubleshooting guide](faq.md).
