---
id: troubleshoot-gate-and-proof
title: "Gate and Proof"
description: "Recover from a gate that refuses, fails, rewrites files, or passes without Proof — and know which conclusions belong to the owner."
order: 30
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-gate-and-proof"
  - "Strand detection"
  - "tree drift"
  - "tree_drift"
  - "dirty gate"
  - "stranded changes"
  - "generated_drift"
  - "gate_failed"
  - "unchanged_tree_rerun"
  - "stale Proof"
  - "Proof skipped"
---

# Gate and Proof

The agent ran `discern done` and didn't get the green result you were expecting — or got green without the Proof that makes the work reviewable. Gate failures are designed to be recoverable: each one names its failed stage, carries a diagnostic with the exact command that reproduces it, and states the next step. This page helps you match what you're seeing to its class, so the agent recovers with the smallest change — and so neither of you trades away evidence, or an owner decision, to make a result turn green.

A pair of rules hold everywhere on this page. Recovery never means weakening the project's declared checks: a loosened standard, a hand-edited generated file, or a deleted check clears the symptom by removing the protection. And green establishes evidence rather than permission — [Proof](../20-understand/proof.md) explains what a green gate does and doesn't authorize.

## Read the failure before acting

A failed `discern done` names its failed stage and returns one diagnostic per problem. Each diagnostic identifies the tool, a message, the captured output, and a `reproduce_cmd` — the exact command that reruns that failure alone:

> **test** — test failed (exit 1) · reproduce: `sh scripts/test.sh`

The agent iterates on that reproduce command, or on `discern prepare` for fix and check failures, rather than rerunning the full gate each time. When the project keeps a gotchas document, a failure it recognizes arrives with the recorded fix inlined in the result.

The result is the first authority. If its message and diagnostics genuinely don't explain the failure, the classes below distinguish the less obvious causes.

## The gate refuses before running anything

A refusal is not a failed check: nothing ran, and the message names what to change.

- **The branch doesn't contain the current trunk.** Another task landed while this one was in flight. The agent runs `discern update` to bring the trunk in, re-reads any files the update names as overlapping, then reruns `discern done`. The same recovery applies when the trunk advances _during_ a gate run: the result is green for the tree it tested, but the branch is now behind.
- **A checkpoint awaits the agent's judgment.** The refusal lists each fired question and its changed paths. See [a checkpoint needs an answer](#a-checkpoint-needs-an-answer) below.
- **This exact tree already passed.** `discern done` reports that green Proof already covers the current commit and runs nothing. That's confirmation, not an error — the evidence is current. `discern done --rerun` repeats the full gate anyway and records that it was a rerun.
- **discern can't write its own state.** The result names the path that was denied. Allow the current invocation to write it and rerun; a successful probe confirms write access at that moment only — discern doesn't change your system's permissions.

Each refusal is safe to retry after its named step: the command re-checks its preconditions from the current state.

## A job failed

The most common red gate: a configured check (build, lint, types, tests, or a changed scope's own gate) found a real problem in the change. The diagnostic carries the failing command and output. [Fix a red gate](../10-guides/fix-a-red-gate.md) is the working procedure: reproduce narrowly, fix, and return.

Nearby results invite misreading:

- **A pass that prints errors.** A job can exit successfully while printing error-like lines — a suite that swallows failures, for instance. The result flags this loud success and points at the captured output; have the agent review it rather than trusting the exit code alone.
- **Queued tests.** When the project caps concurrent test runs, a gate arriving while every slot is busy reports that its tests are queued and starts them as a slot frees. The run isn't stuck, and waiting is correct. The same cap is why agents wrap direct test commands in `discern queue -- <command>` instead of racing the fleet.

## The gate finished with a different tree than it started

You committed a clean tree, and the result says files changed anyway. The gate never commits its own output — it stops and shows you, because a green result must describe the tree that would land, with nothing left over. The diagnostic tells you which cause you have:

**A stage rewrote a tracked file** (the result calls it a strand, or `tree_drift`). A formatter normalized something, a build refreshed a manifest, a test updated a snapshot. The diagnostic names each file, the stage that changed it, and a capped diff; `git diff` reproduces the full picture. Decide whether the rewrite is intended output (usually it is), then commit it and rerun `discern done`. If the job should never write at all, change its command to a verify-only form instead.

**A declared generator's output was stale** (`generated_drift`). The change edited a source without regenerating what's derived from it. The diagnostic names the owning `[generated.<name>]` group and its exact regeneration command. Run that command, commit the regeneration, and rerun. If the tree goes dirty again immediately after committing the regeneration, stop: the generator is producing different bytes from the same input, and that nondeterminism is the defect to fix — not a file to keep re-committing.

**discern's own maintained artifacts drifted.** Compiled agent instructions, materialized skills, or other refresh-managed files no longer match their authored sources — commonly after editing a source directly, or after an upgrade. The agent runs `discern refresh`, reviews the rewrite, and commits it. The direction matters: to change these files, edit the authored source (`[instructions].sources`, `[skills].dir`), never the generated copy — refresh overwrites generated copies by design. If the result instead reports generated artifacts _tracked_ that should be ignored, it names the exact `git rm -r --cached` command to run before refreshing.

Recovery is complete when `discern done` runs green from a clean commit — and stays clean.

## Green, but no Proof

The gate can pass while telling you it recorded no Proof. The checks ran; what's missing is the durable claim that they describe one exact commit that could land:

- **The tree was dirty.** Uncommitted edits mean there's no single commit for the evidence to bind to. This is normal mid-iteration — `discern prepare` and `discern test` are the faster loop there. Before handoff, the agent commits the final tree and reruns `discern done` on the clean commit.
- **The commit moved during the run.** Something amended or committed while the gate ran, so the passing result describes a tree that's no longer HEAD. Rerun on the final commit.
- **Proof couldn't be written.** The result identifies the storage or recovery failure. Preserve the recorded evidence and follow that diagnosis. Acceptance can refresh stale evidence only in an eligible released environment; otherwise the source agent follows the printed `update`, `done`, and acceptance steps.
- **The run was standalone.** `discern done --standalone` provides complete diagnostics without queue admission or landing Proof. Run ordinary `discern done` on the final clean commit when the task is ready for review.
- **It was a CI run.** `discern done --ci` produces report-only evidence and reports open checkpoint questions without answering them. That's its job; report-only Proof can never be used to land. [Run the gate in CI](../10-guides/run-the-gate-in-ci.md) covers the setup.

## Proof was current and went stale

`discern status` or `discern accept` reports that Proof no longer covers the branch. Some edit arrived after the green run — a commit, an uncommitted change, a regenerated file, or a changed checkpoint conclusion. This is routine: Proof binds to one exact tree and its recorded judgments, so anything that changes either retires the old evidence. The agent commits the intended final state and reruns `discern done`; fresh Proof covers the new tree. [Proof](../20-understand/proof.md#why-proof-becomes-stale) explains why staleness is the feature doing its job.

## A standard failed

A standard is a project measure held at a limit that may only improve. Distinct failures share the word:

- **The measured value got worse.** Cut the waste the change introduced until the measure recovers. Sometimes the work itself legitimately grew the number — a feature that genuinely adds code to a size budget, say. That's not the agent's call to absorb: report it, because moving a limit is an owner decision made on the trunk. A branch that edits the limit to pass fails the gate on that edit itself.
- **The limits couldn't be verified.** The never-loosen comparison reads the trunk, and in a shallow CI clone the trunk branch may be absent. The result names the exact fetch to run — typically `git fetch origin main:main` — so the comparison has both sides.

[Set and raise standards](../10-guides/set-and-raise-standards.md) covers responding to a firing standard in depth, including the owner-approval path for a limit that should move.

## A checkpoint needs an answer

A checkpoint pairs a change trigger with a written question the agent must judge — so when `discern done` refuses until it's answered, the design is working:

- **Awaiting declaration.** The refusal lists each question and its changed paths. The agent judges the question against the change, then declares in the same breath as the gate: `discern done --met <id>` when the change satisfies it, or `discern done --unmet <id> --why "<rationale>"` when it doesn't.
- **Declared unmet, and now landing is blocked.** A green gate with an unmet conclusion stops at `discern accept`, which serves the question and rationale back for review. Only the owner can authorize that exact variance, in the current conversation — no recorded grant covers one. The alternative is always available: change the work until the question is satisfied, declare it met, and rerun.
- **A conclusion was recorded but reopened.** Later edits to the matching paths unbind the earlier answer, and its Proof goes stale with it. The agent judges the question again against the current change.

[Checkpoints](../20-understand/checkpoints.md) explains declarations, drops, and variance as a model; [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) holds the exact states.

## When to stop

Stop and involve a person when the next step is a decision rather than a repair: authorizing a variance, moving a standard limit, accepting a landing, or choosing whether a generated rewrite belongs in this change's scope. Those are owner conclusions; a recovered symptom doesn't grant them. And if the same failure returns identically after its named recovery has been applied, stop retrying. Capture the result (`discern done --json`) and treat it as a defect to report rather than a loop to win.
