---
title: The trunk
description: The shared branch accepted work lands on — what moves it, and why work stays off it.
order: 15
aliases:
  - the trunk
  - trunk branch
  - landing branch
---

# The trunk

_One branch holds the project's agreed state; everything else is in flight._

The trunk is the shared branch accepted work lands on: `[repository].trunk` in `discern.toml`, usually `main`. The main checkout keeps it checked out, every worktree forks from it, and the gate's merge check requires a branch to contain the current trunk before `discern done` can pass ([ADR 0050](../_adr/0050-merge-check-fail-fast.md)).

## What moves it

`discern accept --confirmed` advances the trunk by fast-forwarding it to a reviewed worktree's validated commit, then converges the main checkout and removes the landed worktree ([ADR 0110](../_adr/0110-the-landing-model.md)). Fast-forward-only landing keeps trunk history the plain sequence of accepted branches. Owner decisions that belong to the shared state (moving a standard's limit, changing `discern.toml` policy) are made trunk-side by the owner. Agent work lands only through acceptance.

## Why work stays off it

An edit on the trunk collides with every effort in flight: each worktree merges the trunk in, so a stray change becomes everyone's conflict, and it bypasses the gate, the receipt, and review. The protections arrive in layers: the compiled guidance says worktree-first, the session hook leads a main-checkout session with the same line, `discern status` warns when the main checkout is dirty, and the logbook's trunk-edits detector records what slipped through anyway. Reading needs none of that ceremony — investigate from the main checkout freely; `discern start` is for the moment you intend to change something.

## When it advances under you

A landing elsewhere moves the trunk while your branch is mid-flight. `discern status` reports how far behind you are and names the files you changed that the incoming trunk also changed — the hot zone to re-read after merging, since a clean merge can still break them. `discern update` brings the trunk in, re-materializes the generated files, and refuses with the exact next step when it cannot proceed. See [Start, update, and accept](lifecycle.md) for the full lifecycle and [Status and session hints](status.md) for reading the fleet.
