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

_Bare `discern` starts new work and opens the human view over work in progress (the desk)._

Individual worktree operations are available through Model Context Protocol (MCP) tools and JSON or Markdown CLI results. The desk gives a person starting or supervising several changes one interactive [fleet](../00-orientation/glossary.md#fleet) view. Run `discern` with no verb, or `discern desk`, from the main checkout to open it ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md), [ADR 0151](../_adr/0151-the-desk-starts-tasks-and-opens-agents.md)).

For direct movement between checkouts, [`discern enter`](opening-worktrees.md) opens a one-shot picker from any checkout and starts a child shell at the matching project-relative directory.

## Start a task

The root menu groups project actions under **desk commands** and refresh or quit under **Session**. It always includes `Start a task`, adds `Run a Project Script` when configured, and opens [discern.sh/docs](https://discern.sh/docs) from `Read discern's docs`. A changed or Git-unreadable main checkout adds `Inspect main checkout`. Local landing evidence adds `Recent completed tasks`. Task groups remain separate from both command groups, so `Choose a task or Desk command` names every selectable entry.

`Start a task` opens one sequential form. `What are you changing?` asks for a display title that preserves the submitted Unicode, case, and punctuation. A generated codename is a separate choice. The title remains separate from the normalized worktree id and branch. The preview shows each value and includes the planner's normalization note when their spellings differ.

The compact path starts from the configured trunk and opens the last-used configured agent's fresh-session action when its binary remains available on `PATH`. A missing or stale preference opens the agent-action picker. `More options` adds:

- trunk, a live task, or an unlanded branch as the starting point;
- an optional one-line brief;
- each available provider's fresh or continue action;
- optional landing pre-authorization.

Preferences remember the last agent and creation path in repository-local Git state. They carry no task fact or authority.

Before creation, the desk shows the retained start plan: title, brief, worktree id, branch, selected ref and commit, worktree root, resources, agent action, and landing authority. Confirmation applies that same plan through the `start` core, which rejects a stale base, id, branch, or path. The Start result names the resulting path and identity.

After creation, the desk opens the new row. `Refresh` runs another status survey, so a worktree created elsewhere appears in the root menu.

## Read the decision order

The desk uses the same observed fleet facts and task status as `discern status`; it does not classify the same work again. It groups each task into one of 5 human-decision states ([ADR 0318](../_adr/0318-the-desk-adapts-status-into-one-human-decision.md)):

| Group           | Included worktrees                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs attention | Broken or unreadable setup, a failed, partial, or refused action, stale work, unreadable or unavailable [Proof](../00-orientation/glossary.md#proof), or overlap with another task. |
| Ready to review | A clean commit ahead of the trunk with honored Proof and no branch lag.                                                                                                             |
| Working         | A fresh running discern operation, including its verb, elapsed time, and typical duration when known.                                                                               |
| Paused          | Uncommitted or committed work without live activity; the row names the next unmet condition, such as Update or final checks.                                                        |
| Empty           | A healthy worktree with no uncommitted files or commits ahead of the trunk.                                                                                                         |

Within groups, recent worktrees appear first. The root board shows project and main-checkout state, task totals, counts that need a person or are ready to review, static `Refreshed just now`, bounded fleet notices, and a secondary [desk tip](desk-tips.md). Each row shows its title, decision headline, one fact, and the recommended action when it fits. Selection opens the complete evidence.

Rows adapt at 96 and 56 columns ([ADR 0352](../_adr/0352-desk-decisions-cross-a-pure-responsive-presentation-boundary.md)): wide rows separate task, state, and activity or action; medium rows keep task and state together; narrow rows put state and detail below the task. Every row has an independent width, and task detail preserves a truncated title. Static content retains at most one third of the terminal height; the interaction fitter owns the rest. Search begins at 9 tasks. One result receives active focus; the query field receives it during typing.

## Choose one contextual action

Task detail shows the stored title and brief, creation source, normalized id, and location. It also presents activity, Git and Proof facts, landing authority, collisions, containment, and available agents and Project Scripts. Older worktrees without a task-metadata record retain the id-derived title. Short screens move earlier evidence into terminal history.

Every action remains visible in **Work**, **Review**, **Manage**, or **Danger**. Known refusals are disabled with a reason and recovery. At most one available action moves into **Recommended**:

- behind trunk: Update;
- failed: an available agent, otherwise Proof review;
- active, stale, or empty: the preferred available agent;
- clean commits without current Proof: final checks;
- honored Proof: review and landing;
- collisions: review;
- contained work: Reclaim.

Broken, setup-incomplete, or Git-unreadable tasks recommend `Show recovery steps`. They never recommend Drop.

The typed action registry owns menu order, grouping, contextual labels, command evidence, confirmation policy, and whether each action can coexist with a reported running operation. The decision model applies running compatibility centrally before the action's contextual predicate, so a newly enrolled action cannot bypass that boundary. The [product-manual action table](https://discern.sh/docs/guides/delegate-work#6-inspect-decisions-from-the-desk) projects every member for readers; its registry-driven test enrols future actions automatically.

Grant and revoke remain human-only actions inside `discern desk`. They stay available while the gate runs: the grant marker writer and acceptance claim share one atomic decision point, so changing future landing authority does not conflict with the running check.

`Start a follow-up from this task` fixes the selected task's reported branch as the new task's base. Its preview includes that ref and resolved commit before creation. The follow-up remains an independent worktree. Branch containment records the dependency without creating a landing queue.

`Change task title` previews and applies `discern worktree rename <title>`. The command updates the task-metadata record. Branch, worktree id, path, brief, creation source, resources, and lifecycle state remain unchanged.

## Recover a degraded task or main checkout

Recovery detail preserves independent observations instead of reducing a task to one broken state. It shows the exact failed Git or setup observation, worktree registration, branch reachability, filesystem presence, checkout and task identity, setup marker and journal, resource identities, recent lifecycle failure, and every fact that could not be read. Diagnostic, RetryNotice, and ResultSummary Components present the failure, retry classification, and next command ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)).

`Retry setup` appears only when the setup journal makes automatic replay safe. Completed setup-step identities stay skipped. A running one-shot step, a missing journal beside configured one-shot steps, or unreadable setup evidence keeps Retry disabled and shows the exact owner-confirmed setup recovery or doctor command.

The main checkout remains a project boundary. Its detail can inspect `git status --short --branch` and `git diff --stat HEAD`, open a shell, or open the configured editor at main. It explains which landing and cleanup operations depend on readable clean main state. It never offers agent work there.

## Run final checks and review Proof

`Run final checks` calls the same gate core as `discern done`. Without Proof, landing reads `Run final checks, then land on <trunk>`; honored Proof changes it to `Review and land on <trunk>`. Status shows a typical duration when known. A pass refreshes the task with its new Proof.

`Review Proof and changes` shows Proof currency, its stored line and Markdown page, checks and standards, every commit subject, Diffstat, changed and uncommitted paths, collisions, and landing authority. Failed reads remain failures with one next step.

`View actual diff` opens `git diff --no-ext-diff --color=always <trunk>...HEAD` in the [shared pager](../../../src/lib/pager.ts), then returns to review. `Open in editor` runs an available simple command from `$VISUAL` or `$EDITOR`; unsafe values stay disabled with a reason.

## Review effects before confirming

Before a lifecycle mutation, the desk renders its live plan and command in design-system Components with **Keeps**, **Changes**, **Removes**, and **Recoverable** facts. The authoritative core checks current state again after confirmation. Confirmations default to No; discarding work also requires the branch name.

The cleanup actions preserve separate contracts:

| Action  | Keeps                                                               | Removes                                                                                 | Later route                                                                                    |
| ------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Park    | Task branch, committed work, title, brief, and creation source      | Checkout, recorded resources, worktree Proof, landing grant, and other worktree records | Resume the branch from **Work without a worktree**.                                            |
| Reclaim | Contained branch, containing live branch, and commits carried there | Contained checkout, recorded resources, worktree Proof, grant, and task metadata        | The retained branch self-cleans after its containing work lands; it also remains resumable.    |
| Drop    | Trunk, other tasks, and a bounded recovery ref for a deleted branch | Checkout, owned branch, resources, metadata, grant, Proof, and selected work            | Recover committed branch tips from the recovery ref; uncommitted files have no automatic path. |

Park has no force route. Reclaim requires verified containment. Drop remains available as a destructive decision, defaults to No, and retains typed branch confirmation when work may be discarded.

Before review, a Project Script asks for an optional argument line. Spaces separate arguments; quotes group spaces; every other character stays literal because the desk builds an argument vector and never invokes a shell. The review then shows the script's name, description, exact executable and arguments, working directory, required confirmation, and undeclared destructive policy. `Show command` copies that executable invocation and the equivalent `discern scripts <name> [args...]` command without running either. Missing or non-executable scripts stay disabled with recovery, and the recovery follows the file: one that names an interpreter is offered the executable bit, while one that does not is told it is not a command, because setting the bit there would list an entry that still cannot run.

Configured agents remain visible when their binary is missing from `PATH`. One available action launches directly. Several actions keep provider-owned labels and commands.

Before launch, the AgentHandoff presentation shows the stored brief. The desk appends that brief to provider command arguments when the provider registry declares a documented prompt option with a separate argument value. Current provider entries declare no such option. The handoff therefore asks the person to copy the brief and leaves the configured command arguments unchanged.

Session state stays outside discern, and resume arguments come from the provider registry. Scripts, agents, and shells inherit the selected checkout's terminal and return to a fresh survey. Their process groups stop with the desk ([ADR 0159](../_adr/0159-inherited-terminal-children-have-one-owned-lifecycle.md)).

## Resume worktree-less branches

Status-reported unlanded branches appear as selectable root items. `Inspect commits and changed files` compares the reported branch ref with the trunk. `Resume in a worktree` uses that ref as the fixed creation base and returns to the created task's recommended action. A branch created by Park offers its retained title and brief as defaults while the recorded branch commit still matches.

After every repair, refusal, or cleanup, the desk surveys the fleet again. If the selected checkout became an unlanded branch, it opens that branch's resume detail. If landing evidence matches the vanished branch, it reports `Task landed; refreshed` and leaves recent completion evidence available. Every other disappearance reports `Task changed; refreshed` before returning to the nearest available selection.

`Recent completed tasks` is a bounded read-only view over successful local acceptance events and the latest landed Proof note. It distinguishes a recently landed task from an unexplained removal without creating a task archive.

The desk offers no branch-delete shortcut because the lifecycle has no guarded branch-only deletion core. Contained refs remain informational while another live branch contains their commits. Their existing reclaim workflow owns the applicable worktree action.

## Know when the Desk stays closed

discern owns desk policy. The design-system package owns terminal effects. The desk stays closed under `--plain`, `--json`, CI, or when terminal input or output is unavailable. Bare `discern` shows help in those states. `discern desk` returns `invalid_arguments` and points to `discern status --json`. Ctrl+C and end-of-input cancel. During task creation, Ctrl+U returns to the previous applicable question and retains earlier answers.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

Start with [`model.ts`](../../../src/engine/desk/model.ts) for decisions and action legality. [`view.ts`](../../../src/engine/desk/view.ts) owns pure composition, and [`desk.ts`](../../../src/engine/desk/desk.ts) owns surveys, prompts, and effects. [`preferences.ts`](../../../src/engine/desk/preferences.ts) owns convenience defaults. [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) is the production prompt boundary, including sequential composition.

The subsystem has focused [model](../../../tests/engine_desk_model_test.ts), [view](../../../tests/engine_desk_view_test.ts), [runtime](../../../tests/engine_desk_runtime_test.ts), [prompt-boundary](../../../tests/terminal_interaction_test.ts), and [real-terminal](../../../tests/engine_desk_tty_test.ts) tests.

## Current state and gotchas

- Agent launching is CLI-only. Desktop-app integrations for Codex and Claude remain deferred until an official lifecycle-aware handoff can retain accurate status after acceptance or drop.
- Current provider entries declare no prompt argument, so an agent launch displays the task brief for copying and keeps the configured invocation unchanged.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Degraded checkouts lead with recovery evidence. A shell remains available only while the directory is present. Drop remains a separate destructive offer and requires force when work cannot be verified.
