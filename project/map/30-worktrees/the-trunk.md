---
title: The trunk
description: The shared branch accepted work lands on, what moves it, and why work stays off it.
order: 20
aliases:
  - the trunk
  - trunk branch
  - landing branch
---

# The trunk

_The trunk holds the project's agreed state while other branches remain in flight._

The trunk is the shared branch accepted work lands on: `[repository].trunk` in `discern.toml`, usually `main`. The main checkout keeps it checked out, every worktree forks from it, and the gate's merge check requires a branch to contain the current trunk before `discern done` can pass ([ADR 0050](../_adr/0050-merge-check-fail-fast.md)).

The main checkout derives every [identity field](identity-and-env.md) from the configured trunk. Its seed stays constant until that setting changes; worktree branches provide effort-stable fleet rotation ([ADR 0350](../_adr/0350-checkout-identity-supplies-test-order-seeds.md)).

## What moves it

`discern accept` advances the trunk only after conversation consent or a machine-verified standing or effort grant. It publishes the exact validated candidate, converges the main checkout, and separately retires an eligible released worktree ([ADR 0110](../_adr/0110-the-landing-model.md), [ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)). Fast-forward-only landing keeps trunk history as a sequence of accepted branches. Owner decisions that belong to the shared state, such as moving a standard's limit or changing `discern.toml` policy, are made on the trunk by the owner. Agent work lands only through acceptance.

## Why work stays off it

An edit on the trunk can enter every effort's next update because each worktree merges the trunk. It also bypasses the gate, Proof, and review. The protections arrive in layers: the compiled instructions says worktree-first, the session hook leads a main-checkout session with the same line, `discern status` warns when the main checkout is dirty, and the logbook's trunk-edits detector records changes that still occur there. Read-only investigation can stay in the main checkout. Run `discern start` when you intend to change something.

## When it advances under you

A landing elsewhere moves the trunk while your branch is in flight. `discern status` reports how far behind you are and names the files changed by both your branch and the incoming trunk. Re-read that overlap after merging because a clean merge can still introduce a semantic conflict. `discern update` brings the trunk in, re-materializes the generated files, and refuses with the exact next step when it cannot proceed. See [Start, update, and accept](lifecycle.md) for the full lifecycle and [Status and session hints](status.md) for reading the fleet.
