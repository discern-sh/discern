---
title: The Desk
description: Start work, open configured coding agents, and supervise every active worktree from discern's interactive fleet view.
order: 90
aliases:
  - discern desk
  - interactive worktree manager
  - fleet dashboard
  - worktree picker
---

# The Desk

_Bare `discern` starts new work and opens the human view over work in progress (the Desk)._

Agents use Model Context Protocol (MCP) tools and JSON results to operate their own worktree. A person starting or supervising several changes can use a single [fleet](../00-orientation/glossary.md#fleet) view. Run `discern` with no verb, or `discern desk`, from the main checkout to open the interactive picker ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md), [ADR 0151](../_adr/0151-the-desk-starts-tasks-and-opens-agents.md)).

## Start a task

The root menu keeps project actions under **Desk** and refresh or quit under **Session**. `Start a task` is always present. `Run a Project Script` appears when the main checkout has executable Project Scripts. `Read discern's docs` opens [discern.sh/docs](https://discern.sh/docs) in the system browser.

`Start a task` asks for an optional name and runs the same lifecycle core as `discern start`. discern normalizes a supplied name into the worktree id and branch. A blank answer uses a random codename. It creates and sets up the worktree before the Desk continues.

After creation, the desk opens the new row's action menu immediately. Open its shell or a configured coding agent without finding and selecting the new branch first.

`Refresh` runs a new status survey, including a new `git worktree list`. A worktree created outside the Desk appears on the next root menu.

## Read the decision order

The Desk builds its rows from `discern status` and the recorded Gate Proofs. It groups active work by the decision it needs:

| Group           | Included worktrees                                            |
| --------------- | ------------------------------------------------------------- |
| Ready to land   | Clean, ahead, current with trunk, valid Proof.                |
| In flight       | Readable, active, behind trunk, or awaiting Gate.             |
| Needs attention | Broken, unreadable, or stale worktrees that still carry work. |

Every task group, including the first, has a ruled label; **Desk** and **Session** have their own. Within groups, recent worktrees appear first.

The root heading is `◮ discern | <project>`. The main status and tip sit together below it, with no blank row between them. The `Tip` label is yellow; its text stays secondary and wraps at the terminal width. Unlanded branches, reclaimed stages, and removed worktree paths that exist again follow as separate groups when present. The reappearance notice points to `discern worktree prune --dry-run`; cleanup stays in the confirmed prune flow. [Desk tips](desk-tips.md) covers selection, seen-state, and the Logbook record.

Each row starts with the task name supplied to `discern start`. The state puts the next action or problem first, followed by the relevant Git counts and last activity. A short identifier appears only when 2 task names collide. Fleets of 8 tasks or fewer open without a filter field. Type to filter a larger fleet by task name.

## Choose an action

The selected row offers only actions that fit its observed state:

| Action                           | What it runs                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Accept                           | Shows the landing plan, asks for confirmation, then runs the acceptance core. |
| Pre-authorize landing once green | Records one landing grant for this worktree in Git's administrative state.    |
| Revoke landing pre-authorization | Removes that worktree's unconsumed effort grant.                              |
| Update                           | Brings the trunk into the selected worktree.                                  |
| Reclaim checkout                 | Removes a contained worktree's checkout; its branch ref is always kept.       |
| Run script                       | Runs a discovered executable Project Script from that worktree.               |
| Open with agent                  | Starts or continues a configured coding-agent CLI inside the worktree.        |
| Open a shell                     | Starts `$SHELL` inside the worktree and returns to a refreshed desk on exit.  |
| Inspect                          | Shows commits, uncommitted changes, and a diffstat relative to the trunk.     |
| Drop                             | Runs the guarded abandoned-work removal path.                                 |

The action menu separates **Landing**, **Work in this task**, **Review**, and **Worktree**. Navigation has its own **Task** group. The agent picker adds one group per configured provider, so fresh and continued sessions remain together.

Every action echoes its CLI equivalent and calls the same core as the command. A landing pre-authorization belongs only to the selected effort: `accept` consumes it; revoke, drop, prune, and orphan cleanup remove it. Drop receives the selected row's absolute path. Dropping uncommitted or unlanded work requires the branch name typed back before the desk applies force.

Reclaim appears only on a [contained](reclaiming-contained-worktrees.md) row: a spent `start --from` stage whose commits travel inside the live branch the row names. Its confirmation names what survives (the branch ref) and what the reclaim destroys (the checkout and its per-worktree state, Gate Proof included). The core re-validates the predicate before acting.

Project Scripts use one picker and process contract. The root action runs from the main checkout with `DISCERN_ROOT` set there; the selected-task action runs from that worktree. Both inherit the terminal and return to a fresh survey. Ctrl-C, SIGTERM, or SIGHUP stops the owned process group first ([ADR 0159](../_adr/0159-inherited-terminal-children-have-one-owned-lifecycle.md)). Background jobs remain caller-owned.

Open with agent appears only when an agent is configured in that checkout's `discern.toml` and one of its known binaries is on `PATH`. The provider registry owns each fresh and continued session command. The process inherits the terminal and worktree directory; exit or interrupt it to return to a fresh survey. The desk does not inspect private vendor session state.

## Know when the Desk stays closed

Desk questions cross the shared discern prompt boundary. Product code owns eligibility, labels, groups, values, defaults, validation, and cancellation meaning. The design-system package owns terminal input, editing, frames, and restoration. `--plain`, `--json`, CI, or either non-terminal stream vetoes Desk interaction before raw mode. Commands that expose `--yes` pass that caller fact through the same policy. The Desk has no `--yes` option. Bare `discern` prints static help when interaction is unavailable. Named `discern desk` returns `invalid_arguments` and points automation at `discern status --json`. Ctrl+C or end-of-input cancels the current question. Ctrl+U reports that this single-step prompt has no previous form step.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the Desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested Desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

| Responsibility                      | Source                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Interactive loop and dispatch       | [`src/engine/desk/desk.ts`](../../../src/engine/desk/desk.ts)                           |
| Buckets and launch availability     | [`src/engine/desk/model.ts`](../../../src/engine/desk/model.ts)                         |
| Provider-owned CLI actions          | [`src/lib/providers.ts`](../../../src/lib/providers.ts)                                 |
| System-browser handoff              | [`src/lib/open_browser.ts`](../../../src/lib/open_browser.ts)                           |
| Model decision table tests          | [`tests/engine_desk_model_test.ts`](../../../tests/engine_desk_model_test.ts)           |
| Interactive dispatch tests          | [`tests/engine_desk_runtime_test.ts`](../../../tests/engine_desk_runtime_test.ts)       |
| Real terminal/non-interactive tests | [`tests/engine_non_interactive_test.ts`](../../../tests/engine_non_interactive_test.ts) |

## Current state and gotchas

- The first release of agent launching is CLI-only. Desktop-app integrations for Codex and Claude are a recorded follow-up: they need an official, lifecycle-aware handoff whose status stays accurate when discern later accepts or drops the worktree.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Broken or unreadable checkouts offer only drop. Without explicit force, drop refuses when discern cannot verify the work.
