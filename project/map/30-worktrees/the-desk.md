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

Within groups, recent worktrees appear first. The root board names the project and main-checkout state, then counts all tasks, tasks that need a person, and tasks ready to review. `Refreshed just now` is static until the Desk gains live refresh. A [Desk tip](desk-tips.md) stays secondary. Unlanded branches, reclaimed stages, and removed worktree paths that exist again remain separate bounded facts.

Each root row carries the display title, decision headline, one relevant factual detail, and the recommended action when space permits. The root is a triage queue; selecting a task opens its complete evidence. A collision can move a row into **Needs attention** without hiding what the task is doing. A ready task with a landing grant does not claim to need the same owner decision as one that still needs approval.

The row layout follows the live terminal width ([ADR 0351](../_adr/0351-desk-decisions-cross-a-pure-responsive-presentation-boundary.md)):

- At 96 columns and wider, task, state, and current activity or next action use separate columns.
- From 56 through 95 columns, task and state share the line; relevant detail and the next action use the selection description.
- Below 56 columns, the bounded task title leads and state, detail, and next action continue beneath it.

One title never widens every row. A bounded row may truncate identity, and the selected task's detail view is the full-title route. The static board or detail preamble retains at most one third of the terminal height on short screens; the design-system interaction fitter measures group headings, descriptions, the prompt, overflow cues, and key help in the remaining rows. Search appears when the fleet exceeds eight tasks. While its query field is active, no task row claims focus; moving into the results gives one row the focus marker and strongest emphasis.

## Choose an action

Selecting a task first shows its full title and decision headline. The evidence table then groups branch and path, running or last action, changed-file and commit facts, landing authority, collisions, containment, and available agents or Project Scripts with unavailable reasons. The Proof section names currency and preserves the recorded Proof line. Empty evidence blocks are omitted. On a short terminal the preamble may enter terminal history so the action picker remains coherent; every fact is emitted before the picker.

The decision represents each canonical action once. An action is enabled or disabled with one observed reason, and at most one enabled action is recommended. The current menu shows the enabled offers only:

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

Every enabled action echoes its CLI equivalent and calls the same core as the command. An effort grant belongs only to the selected task; acceptance consumes it, and removal clears it. Dropping work requires confirmation, with the branch name typed back when work would be discarded.

Accept requires a clean worktree with commits ahead of the trunk and no known branch lag. A branch behind the trunk disables Accept and recommends Update. The lifecycle core checks again before acting. The model retains disabled reasons, recommendations, Proof, authority, and collision facts even though the current menu hides disabled offers.

Reclaim appears only on a [contained](reclaiming-contained-worktrees.md) row: a spent `start --from` stage whose commits travel inside the live branch the row names. Its confirmation names what survives (the branch ref) and what the reclaim destroys (the checkout and its per-worktree state, Gate Proof included). The core re-validates the predicate before acting.

Project Scripts use one picker and process contract. The root action runs from the main checkout with `DISCERN_ROOT` set there; the selected-task action runs from that worktree. Both inherit the terminal and return to a fresh survey. Ctrl-C, SIGTERM, or SIGHUP stops the owned process group first ([ADR 0159](../_adr/0159-inherited-terminal-children-have-one-owned-lifecycle.md)). Background jobs remain caller-owned.

Open with agent appears only when an agent is configured in that checkout's `discern.toml` and one of its known binaries is on `PATH`. The provider registry owns each fresh and continued session command. The process inherits the terminal and worktree directory; exit or interrupt it to return to a fresh survey. The desk does not inspect private vendor session state.

## Know when the Desk stays closed

discern owns Desk policy; design-system package owns terminal effects. Vetoes: `--plain`, `--json`, CI, either non-TTY stream. Bare `discern`: help; `discern desk`: `invalid_arguments`; remedy: `discern status --json`. Ctrl+C/end-of-input cancel; Ctrl+U: no previous form step.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the Desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested Desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

| Responsibility                  | Source                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Interactive loop and dispatch   | [`src/engine/desk/desk.ts`](../../../src/engine/desk/desk.ts)                           |
| Decision and action-offer model | [`src/engine/desk/model.ts`](../../../src/engine/desk/model.ts)                         |
| Product mapping and composition | [`src/engine/desk/view.ts`](../../../src/engine/desk/view.ts)                           |
| Provider-owned CLI actions      | [`src/lib/providers.ts`](../../../src/lib/providers.ts)                                 |
| System-browser handoff          | [`src/lib/open_browser.ts`](../../../src/lib/open_browser.ts)                           |
| Model decision table tests      | [`tests/engine_desk_model_test.ts`](../../../tests/engine_desk_model_test.ts)           |
| Pure responsive view tests      | [`tests/engine_desk_view_test.ts`](../../../tests/engine_desk_view_test.ts)             |
| Interactive dispatch tests      | [`tests/engine_desk_runtime_test.ts`](../../../tests/engine_desk_runtime_test.ts)       |
| Real terminal journeys          | [`tests/engine_desk_tty_test.ts`](../../../tests/engine_desk_tty_test.ts)               |
| Non-interactive boundary tests  | [`tests/engine_non_interactive_test.ts`](../../../tests/engine_non_interactive_test.ts) |

## Current state and gotchas

- The first release of agent launching is CLI-only. Desktop-app integrations for Codex and Claude are a recorded follow-up: they need an official, lifecycle-aware handoff whose status stays accurate when discern later accepts or drops the worktree.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Broken or unreadable checkouts offer only drop. Without explicit force, drop refuses when discern cannot verify the work.
