---
title: The desk
description: Use discern's interactive fleet view to inspect, update, enter, land, script, or discard active worktrees.
order: 50
aliases:
  - discern desk
  - interactive worktree manager
  - fleet dashboard
  - worktree picker
---

# The desk

_Bare `discern` opens the human decision surface over every active worktree._

Agents use Model Context Protocol (MCP) tools and JSON results to operate their own worktree. A person supervising several changes needs a fleet view. Run `discern` with no verb, or `discern desk`, from the main checkout to open the interactive picker ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md)).

## Read the decision order

The desk builds its rows from `discern status` and the recorded gate receipts. It groups active work by the decision it needs:

| Group           | Included worktrees                                            |
| --------------- | ------------------------------------------------------------- |
| Ready to land   | Clean, ahead of the trunk, with an honored gate receipt.      |
| In flight       | Healthy work that is still active or awaiting a gate result.  |
| Needs attention | Broken, unreadable, or stale worktrees that still carry work. |

Within each group, the most recently active worktree appears first. The header also reports the main checkout's state and unlanded branches that have no worktree.

## Choose an action

The selected row offers only actions that fit its observed state:

| Action     | What it runs                                                                  |
| ---------- | ----------------------------------------------------------------------------- |
| Accept     | Shows the landing plan, asks for confirmation, then runs the acceptance core. |
| Update     | Brings the trunk into the selected worktree.                                  |
| Run script | Runs a discovered executable Project Script from that worktree.               |
| Jump in    | Starts `$SHELL` inside the worktree and returns to a refreshed desk on exit.  |
| Inspect    | Shows commits, uncommitted changes, and a diffstat relative to the trunk.     |
| Drop       | Runs the guarded abandoned-work removal path.                                 |

Every action prints the CLI command before it runs. The desk teaches the underlying verbs and uses their real cores, so every refusal and recovery message matches the command-line surface. Dropping work with uncommitted or unlanded changes requires the branch name typed back. The desk then applies force.

Run script appears only when the selected checkout's configured scripts directory contains an executable Project Script. The script inherits the terminal, uses that worktree as its current directory, receives `DISCERN_ROOT`, and returns to a new fleet survey when it exits.

## Know when the desk stays closed

Interactive prompts require terminal stdin and stdout. Bare `discern` prints static help under `--plain`, `--json`, CI, pipes, or closed input. Named `discern desk` returns an `interactive_only` result in those environments and points automation at `discern status --json`.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view.

## Where it lives in code

| Responsibility                | Source                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Interactive loop and dispatch | [`src/engine/desk/desk.ts`](../../../src/engine/desk/desk.ts)                           |
| Buckets and legal actions     | [`src/engine/desk/model.ts`](../../../src/engine/desk/model.ts)                         |
| Model decision table tests    | [`tests/engine_desk_model_test.ts`](../../../tests/engine_desk_model_test.ts)           |
| Terminal behavior tests       | [`tests/engine_non_interactive_test.ts`](../../../tests/engine_non_interactive_test.ts) |

## Current state and gotchas

- The desk is CLI-only. There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Broken or unreadable checkouts offer only drop. Without explicit force, drop refuses when discern cannot verify the work.
