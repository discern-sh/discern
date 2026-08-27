---
id: explanation-worktrees-and-trunk
title: "Worktrees and trunk"
description: "Understand why unfinished work stays in isolated worktrees, what trunk means, and how update/composition/accept move evidence."
order: 60
publish: true
kind: explanation
aliases:
  - "explanation-worktrees-and-trunk"
  - "the trunk"
  - "trunk branch"
  - "landing branch"
  - "worktree"
redirect_from:
  - "/docs/worktrees/the-trunk"
---

# Worktrees and trunk

Understand why unfinished work stays in isolated worktrees, what trunk means, and how update/composition/accept move evidence.

# The trunk

_The trunk holds the project's agreed state while other branches remain in flight._

The trunk is the shared branch accepted work lands on: `[repository].trunk` in `discern.toml`, usually `main`. The main checkout keeps it checked out, every worktree forks from it, and the Gate's merge check requires a branch to contain the current trunk before `discern done` can pass ([ADR 0050](https://discern.sh/docs/decisions/0050-merge-check-fail-fast)).

The main checkout derives every [identity field](../30-reference/worktrees-and-status.md) from the configured trunk. Its seed stays constant until that setting changes; worktree branches provide effort-stable fleet rotation ([ADR 0350](https://discern.sh/docs/decisions/0350-checkout-identity-supplies-test-order-seeds)).

## What moves it

`discern accept` advances the trunk only after conversation consent or a machine-verified standing or effort grant. It fast-forwards to the worktree's validated commit, then converges the main checkout and removes the landed worktree ([ADR 0110](https://discern.sh/docs/decisions/0110-the-landing-model), [ADR 0194](https://discern.sh/docs/decisions/0194-standing-pre-authorization-is-a-recorded-checked-grant)). Fast-forward-only landing keeps trunk history as a sequence of accepted branches. Owner decisions that belong to the shared state, such as moving a Standard's limit or changing `discern.toml` policy, are made on the trunk by the owner. Agent work lands only through acceptance.

## Why work stays off it

An edit on the trunk can enter every effort's next update because each worktree merges the trunk. It also bypasses the Gate, Proof, and review. The protections arrive in layers: the compiled instructions says worktree-first, the session hook leads a main-checkout session with the same line, `discern status` warns when the main checkout is dirty, and the Logbook's trunk-edits detector records changes that still occur there. Read-only investigation can stay in the main checkout. Run `discern start` when you intend to change something.

## When it advances under you

A landing elsewhere moves the trunk while your branch is in flight. `discern status` reports how far behind you are and names the files changed by both your branch and the incoming trunk. Re-read that overlap after merging because a clean merge can still introduce a semantic conflict. `discern update` brings the trunk in, re-materializes the generated files, and refuses with the exact next step when it cannot proceed. See [Start, update, and accept](../10-guides/finish-and-land-a-change.md) for the full lifecycle and [Status and session hints](../30-reference/worktrees-and-status.md) for reading the fleet.
