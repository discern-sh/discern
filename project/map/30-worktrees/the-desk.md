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

Individual worktree operations are available through Model Context Protocol (MCP) tools and JSON or Markdown CLI results. The desk gives a person starting or supervising several changes one interactive [fleet](../00-orientation/glossary.md#fleet) view. Run `discern` with no verb, or `discern desk`, from the main checkout to open it ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md), [ADR 0151](../_adr/0151-the-desk-starts-tasks-and-opens-agents.md)).

For direct movement between checkouts, [`discern worktrees`](opening-worktrees.md) opens a one-shot picker from any checkout and starts a child shell at the matching project-relative directory.

## Start a task

The root menu groups project actions under **Desk commands** and refresh or quit under **Session**. It always includes `Start a task`, adds `Run a Project Script` when configured, and opens [discern.sh/docs](https://discern.sh/docs) from `Read discern's docs`. Task groups remain separate from both command groups, so `Choose a task or Desk command` names every selectable entry.

`Start a task` passes an optional name to `discern start`: a value becomes the worktree id and branch; blank draws a random codename. The Desk continues after setup.

After creation, the Desk opens the new row. `Refresh` runs another status survey, so a worktree created elsewhere appears in the root menu.

## Read the decision order

The Desk uses the same observed Fleet facts and task status as `discern status`; it does not classify the same work again. It groups each task into one of 5 human-decision states ([ADR 0318](../_adr/0318-the-desk-adapts-status-into-one-human-decision.md)):

| Group           | Included worktrees                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs attention | Broken or unreadable setup, a failed, partial, or refused action, stale work, unreadable or unavailable [Proof](../00-orientation/glossary.md#proof), or overlap with another task. |
| Ready to review | A clean commit ahead of the trunk with honored Proof and no branch lag.                                                                                                             |
| Working         | A fresh running discern operation, including its verb, elapsed time, and typical duration when known.                                                                               |
| Paused          | Uncommitted or committed work without live activity; the row names the next unmet condition, such as Update or final checks.                                                        |
| Empty           | A healthy worktree with no uncommitted files or commits ahead of the trunk.                                                                                                         |

Within groups, recent worktrees appear first. The root board shows project and main-checkout state, task totals, counts that need a person or are ready to review, static `Refreshed just now`, bounded fleet notices, and a secondary [Desk tip](desk-tips.md). Each row shows its title, decision headline, one fact, and the recommended action when it fits. Selection opens the complete evidence.

Rows adapt at 96 and 56 columns ([ADR 0352](../_adr/0352-desk-decisions-cross-a-pure-responsive-presentation-boundary.md)): wide rows separate task, state, and activity or action; medium rows keep task and state together; narrow rows put state and detail below the task. Every row has an independent width, and task detail preserves a truncated title. Static content retains at most one third of the terminal height; the interaction fitter owns the rest. Search begins at 9 tasks. One result receives active focus; the query field receives it during typing.

## Choose an action

Task detail precedes the action picker. It groups the full title and headline, location, activity, Git facts, landing authority, collisions, containment, agent and Project Script availability, and Proof currency and line. Empty groups disappear. Short screens keep the action picker coherent by moving earlier evidence into terminal history.

The decision carries every action once, its availability reason, and at most one recommendation; the picker shows enabled actions only. Landing, work, review, and worktree groups cover Accept and its grant, Update, scripts, agents, shell, Inspect, Reclaim, and Drop. Each action echoes its CLI command and calls the same lifecycle core, which rechecks before effects.

Accept requires clean committed work ahead of the trunk without known branch lag. Grants belong to one task. Reclaim appears only for [contained work](reclaiming-contained-worktrees.md), keeps the branch, and removes the checkout and its per-worktree state after confirmation.

Project Scripts, agent CLIs, and shells inherit the selected checkout's terminal and return to a fresh survey. Root scripts run from main. Agent launch also requires a configured provider and an available binary; discern does not inspect vendor session state. Owned process groups stop on Ctrl-C, SIGTERM, or SIGHUP ([ADR 0159](../_adr/0159-inherited-terminal-children-have-one-owned-lifecycle.md)).

## Know when the Desk stays closed

discern owns Desk policy; design-system package owns terminal effects. Vetoes: `--plain`, `--json`, CI, either non-TTY stream. Bare `discern`: help; `discern desk`: `invalid_arguments`; remedy: `discern status --json`. Ctrl+C/end-of-input cancel; Ctrl+U: no previous form step.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the Desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested Desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

Start with [`model.ts`](../../../src/engine/desk/model.ts) for decisions and action legality, [`view.ts`](../../../src/engine/desk/view.ts) for pure composition, and [`desk.ts`](../../../src/engine/desk/desk.ts) for surveys, prompts, and effects. Their contracts are covered by [model](../../../tests/engine_desk_model_test.ts), [view](../../../tests/engine_desk_view_test.ts), [runtime](../../../tests/engine_desk_runtime_test.ts), and [real-terminal](../../../tests/engine_desk_tty_test.ts) tests.

## Current state and gotchas

- The first release of agent launching is CLI-only. Desktop-app integrations for Codex and Claude are a recorded follow-up: they need an official, lifecycle-aware handoff whose status stays accurate when discern later accepts or drops the worktree.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Broken or unreadable checkouts offer only drop. Without explicit force, drop refuses when discern cannot verify the work.
