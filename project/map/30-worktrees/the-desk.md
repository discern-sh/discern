---
title: The desk
description: Start work, open configured coding agents, and supervise every active worktree from discern's interactive fleet view.
order: 70
aliases:
  - discern desk
  - interactive worktree manager
  - fleet dashboard
  - worktree picker
---

# The desk

_Bare `discern` starts new work and opens the human decision surface over every active worktree._

Agents use Model Context Protocol (MCP) tools and JSON results to operate their own worktree. A person starting or supervising several changes needs one [fleet](../00-orientation/glossary.md#fleet) view. Run `discern` with no verb, or `discern desk`, from the main checkout to open the interactive picker ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md), [ADR 0151](../_adr/0151-the-desk-starts-tasks-and-opens-agents.md)).

## Start a task

The root menu includes `Start a task` even when the fleet is empty. It asks for an optional name and runs the same lifecycle core as `discern start`: a name is normalised to the worktree id and branch, while a blank answer uses a random codename. The new worktree is created, set up, and ready before the desk continues.

After creation, the desk opens the new row's action menu immediately. Open its shell or a configured coding agent without finding and selecting the new branch first.

## Read the decision order

The desk builds its rows from `discern status` and the recorded gate receipts. It groups active work by the decision it needs:

| Group           | Included worktrees                                            |
| --------------- | ------------------------------------------------------------- |
| Ready to land   | Clean, ahead, current with trunk, honored receipt.            |
| In flight       | Healthy, active, behind trunk, or awaiting gate.              |
| Needs attention | Broken, unreadable, or stale worktrees that still carry work. |

Within each group, the most recently active worktree appears first. The header also reports the main checkout's state and unlanded branches that have no worktree.

Each row starts with the task name supplied to `discern start`. The state puts the next action or problem first, followed by the relevant Git counts and last activity. A short identifier appears only when 2 task names collide. Fleets of 8 tasks or fewer open without a filter field. Type to filter a larger fleet by task name.

## Choose an action

The selected row offers only actions that fit its observed state:

| Action          | What it runs                                                                  |
| --------------- | ----------------------------------------------------------------------------- |
| Accept          | Shows the landing plan, asks for confirmation, then runs the acceptance core. |
| Update          | Brings the trunk into the selected worktree.                                  |
| Run script      | Runs a discovered executable Project Script from that worktree.               |
| Open with agent | Starts or continues a configured coding-agent CLI inside the worktree.        |
| Open a shell    | Starts `$SHELL` inside the worktree and returns to a refreshed desk on exit.  |
| Inspect         | Shows commits, uncommitted changes, and a diffstat relative to the trunk.     |
| Drop            | Runs the guarded abandoned-work removal path.                                 |

Every action prints the CLI command before it runs. The desk teaches the underlying verbs and uses their real cores, so every refusal and recovery message matches the command-line surface. Dropping work with uncommitted or unlanded changes requires the branch name typed back. The desk then applies force.

Run script appears for executable Project Scripts in the selected checkout. Scripts inherit the terminal, run from that worktree with `DISCERN_ROOT`, and return to a fresh survey. Ctrl-C, SIGTERM, or SIGHUP stops the owned process group first ([ADR 0159](../_adr/0159-inherited-terminal-children-have-one-owned-lifecycle.md)). Background jobs remain caller-owned.

Open with agent appears only when an agent is both configured in that checkout's `discern.toml` and one of its known binaries is currently on `PATH`. A detected but unconfigured agent stays hidden; a configured but unavailable agent does too. The provider registry owns the exact actions:

| Provider       | Start fresh    | Continue through the provider's session flow |
| -------------- | -------------- | -------------------------------------------- |
| Claude Code    | `claude`       | `claude --continue`                          |
| Codex          | `codex`        | `codex resume`                               |
| Gemini         | `gemini`       | `gemini --resume latest`                     |
| Cursor         | `cursor-agent` | `cursor-agent resume`                        |
| GitHub Copilot | `copilot`      | `copilot --resume`                           |

The selected process inherits the terminal and worktree directory. Exit or interrupt it to return to a fresh survey. The desk does not inspect or reproduce private vendor session state.

## Know when the desk stays closed

Interactive prompts require terminal stdin and stdout. Bare `discern` prints static help under `--plain`, `--json`, CI, pipes, or closed input. Named `discern desk` returns an `interactive_only` result in those environments and points automation at `discern status --json`.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

| Responsibility                      | Source                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Interactive loop and dispatch       | [`src/engine/desk/desk.ts`](../../../src/engine/desk/desk.ts)                           |
| Buckets and launch availability     | [`src/engine/desk/model.ts`](../../../src/engine/desk/model.ts)                         |
| Provider-owned CLI actions          | [`src/lib/providers.ts`](../../../src/lib/providers.ts)                                 |
| Model decision table tests          | [`tests/engine_desk_model_test.ts`](../../../tests/engine_desk_model_test.ts)           |
| Interactive dispatch tests          | [`tests/engine_desk_runtime_test.ts`](../../../tests/engine_desk_runtime_test.ts)       |
| Real terminal/non-interactive tests | [`tests/engine_non_interactive_test.ts`](../../../tests/engine_non_interactive_test.ts) |

## Current state and gotchas

- The first release of agent launching is CLI-only. Desktop-app integrations for Codex and Claude are a recorded follow-up: they need an official, lifecycle-safe handoff whose status stays accurate when discern later accepts or drops the worktree.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Broken or unreadable checkouts offer only drop. Without explicit force, drop refuses when discern cannot verify the work.
