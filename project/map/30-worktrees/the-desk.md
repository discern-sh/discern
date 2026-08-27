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

## Choose one contextual action

Task detail precedes the action picker. It groups the full title and headline, location, activity, Git facts, landing authority, collisions, containment, agent and Project Script availability, and Proof currency and line. Empty evidence groups disappear. Short screens keep the action picker coherent by moving earlier evidence into terminal history.

The decision carries every task action once. One available action may move into **Recommended**; every other action remains in **Work**, **Review**, **Manage**, or **Danger**. An action the current facts would refuse stays visible and disabled with the observed reason and recovery. The lifecycle core rechecks those facts after confirmation.

The recommendation follows the task state:

- a branch behind the trunk recommends Update;
- a current failure recommends an available configured agent, or Proof review when no agent command can run;
- active or stale work recommends an available configured agent;
- clean commits without current Proof recommend final checks;
- honored Proof recommends review and landing;
- an empty task recommends the preferred available agent action;
- collision evidence recommends review;
- contained work recommends Reclaim.

Broken or unreadable tasks receive no destructive recommendation. Drop remains a separate Danger action while the task keeps its factual recovery evidence.

<!-- BEGIN DESK ACTION REGISTRY -->

| Id             | Group  | Contextual label                                                                | Command evidence                     | Confirmation                                                     |
| -------------- | ------ | ------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `done`         | Work   | Run final checks                                                                | `discern done`                       | No by default; Run                                               |
| `accept`       | Review | Run final checks, then land on &lt;trunk&gt; / Review and land on &lt;trunk&gt; | `discern accept`                     | No by default; Land                                              |
| `update`       | Manage | Update branch from &lt;trunk&gt;                                                | `discern update`                     | No by default; Update                                            |
| `agent`        | Work   | Continue with an agent                                                          | `<configured-agent>`                 | None                                                             |
| `scripts`      | Work   | Run a Project Script                                                            | `discern scripts <name>`             | No by default; Run                                               |
| `jump`         | Work   | Open a shell                                                                    | `<user-shell>`                       | None                                                             |
| `inspect`      | Review | Review Proof and changes                                                        | `git diff`                           | None                                                             |
| `grant`        | Manage | Pre-authorize landing once green                                                | `discern desk`                       | No by default; Allow                                             |
| `revoke_grant` | Manage | Revoke landing pre-authorization                                                | `discern desk`                       | No by default; Revoke                                            |
| `reclaim`      | Manage | Reclaim checkout, keep branch (work contained in &lt;later-branch&gt;)          | `discern worktree prune --contained` | No by default; Reclaim                                           |
| `drop`         | Danger | Drop worktree and branch                                                        | `discern worktree drop <path>`       | No by default; Drop, then type the branch before discarding work |

<!-- END DESK ACTION REGISTRY -->

The table is held to [`DESK_ACTION_REGISTRY`](../../../src/engine/desk/model.ts) by a parity test. Grant and revoke remain human-only actions inside `discern desk`; their command evidence names that interactive entry point.

## Run final checks and review Proof

`Run final checks` invokes the same Gate core as `discern done`. A clean committed task without Proof presents `Run final checks, then land on <trunk>`; honored Proof changes the landing label to `Review and land on <trunk>`. A running Gate carries its elapsed and typical duration when status knows them. A passing Gate returns to a fresh task view with the new Proof.

`Review Proof and changes` opens a Proof-first composition. It renders Proof currency, the stored line, and the stored Markdown page through the shared Markdown renderer. The same view carries all commit subjects, Diffstat and changed-file Components, uncommitted paths, collision context, landing authority, and any structured Standard proposal evidence. Git read failures remain failures through Diagnostic and RetryNotice Components.

`View actual diff` sends `git diff --no-ext-diff --color=always <trunk>...HEAD` through the [shared explicit pager boundary](../../../src/lib/pager.ts). The review returns after the pager exits. `Open in editor` runs the exact command and arguments declared by `$VISUAL` or `$EDITOR` when the command is available; unavailable or unsafe shell-shaped editor values stay disabled with a reason.

## Review effects before confirming

Every lifecycle mutation presents its live read-only plan and command evidence through the design system's Command, Procedure, ProcedureStep, ExpectedResult, and DestructiveActionNotice Components where applicable. The same composition gives a structured **Keeps**, **Changes**, **Removes**, and **Recoverable** account. Landing, Update, grant, revoke, Reclaim, and Drop apply through their authoritative cores, which revalidate after confirmation. Mutation confirmations default to No. Drop additionally requires the branch name before a refused safe drop may discard work.

Project Scripts show their canonical name, description, resolved executable path, working directory, required confirmation, and undeclared destructive policy before they run. `Show command` prints the exact executable command and arguments and the corresponding `discern scripts <name>` spelling without running either. Missing directories and non-executable files remain disabled with exact recovery. Root scripts use the same review and No-default confirmation from main.

Configured agent actions remain visible when a provider binary is missing from `PATH`. One available action can launch directly; several retain provider-owned labels and exact command arguments in a provider-owned choice. Provider session state stays outside discern, and resume arguments come only from the provider registry. Project Scripts, agent CLIs, and shells inherit the selected checkout's terminal and return to a fresh survey. Owned process groups stop on Ctrl-C, SIGTERM, or SIGHUP ([ADR 0159](../_adr/0159-inherited-terminal-children-have-one-owned-lifecycle.md)).

## Know when the Desk stays closed

discern owns Desk policy; design-system package owns terminal effects. Vetoes: `--plain`, `--json`, CI, either non-TTY stream. Bare `discern`: help; `discern desk`: `invalid_arguments`; remedy: `discern status --json`. Ctrl+C/end-of-input cancel; Ctrl+U: no previous form step.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the Desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested Desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

Start with [`model.ts`](../../../src/engine/desk/model.ts) for decisions and action legality, [`view.ts`](../../../src/engine/desk/view.ts) for pure composition, and [`desk.ts`](../../../src/engine/desk/desk.ts) for surveys, prompts, and effects. Their contracts are covered by [model](../../../tests/engine_desk_model_test.ts), [view](../../../tests/engine_desk_view_test.ts), [runtime](../../../tests/engine_desk_runtime_test.ts), and [real-terminal](../../../tests/engine_desk_tty_test.ts) tests.

## Current state and gotchas

- The first release of agent launching is CLI-only. Desktop-app integrations for Codex and Claude are a recorded follow-up: they need an official, lifecycle-aware handoff whose status stays accurate when discern later accepts or drops the worktree.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Broken or unreadable checkouts keep shell, review when Git is readable, and Drop as separate offers. They never recommend Drop. Without explicit force, Drop refuses when discern cannot verify the work.
