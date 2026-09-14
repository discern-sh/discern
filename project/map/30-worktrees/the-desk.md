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

The overview has a task list and `Desk commands`. Tab reaches either region, including one hidden by a short terminal. Commands include Start, Project Scripts for the project root, main-checkout inspection, the landing queue, recent completions and the manual. The manual opens [discern.sh/docs](https://discern.sh/docs).

`Start a task` opens one sequential form. `What are you changing?` asks for a display title that preserves the submitted Unicode, case, and punctuation. A generated codename is a separate choice. The title remains separate from the normalized worktree id and branch. The preview shows each value and includes the planner's normalization note when their spellings differ.

The compact path starts from the configured trunk and opens the last-used configured agent's fresh-session action when its binary remains available on `PATH`. A missing or stale preference opens the agent-action picker. `More options` adds:

- trunk, a live task, or an unlanded branch as the starting point;
- an optional one-line brief;
- each available provider's fresh or continue action;
- landing pre-authorization for the new task.

Preferences remember the last agent and creation path in repository-local Git state. They carry no task fact or authority.

Before creation, the desk shows the retained start plan: title, brief, worktree id, branch, selected ref and commit, worktree root, resources, agent action, and landing authority. Confirmation applies that same plan through the `start` core, which rejects a stale base, id, branch, or path. The Start result names the resulting path and identity.

After creation, the desk opens the new row. `Refresh` runs another status survey, so a worktree created elsewhere appears in the root menu.

## Read current work

The desk is a bounded terminal application ([ADR 0398](../_adr/0398-the-desk-is-a-live-human-control-panel.md)). The package owns its viewport, scrolling, search, resizing and foreground handoff. It displays two regions beside each other when wide enough, stacks them when tall enough, and otherwise shows the active region. Below the package minimum it displays a resize notice. No essential overview or task control depends on terminal history.

Tasks sort by their case-folded display title, then stable identity. Activity, overlaps and Proof changes do not impose an urgency ranking. Each row shows a recognizable title, observed activity and a short Proof indicator. Duplicate titles carry an identity suffix. An `i` indicates advisory overlaps; **Proof and details** holds their paths. An overlap does not block a task or recommend an action.

Activity, Proof validity, landing authority and submission are separate facts. A green pre-authorized task can say **Not submitted**. The landing queue renders status's submitted revisions, readiness and authority, including an older submitted revision when the branch has newer work. Running operations retain their progress handle. Outstanding emergency exceptions remain available in the queue view. Ending an operation never implies acceptance.

## Choose a task control

Selecting a task opens **Start or resume agent**, **Project Scripts**, **Pre-authorize landing** or **Revoke pre-authorization**, **Accept**, and **Drop**. **Proof and details** retains branch, path, stable identity and observed evidence. **More actions** contains the remaining registered actions, including recovery, final checks, update, review, title changes, shell, follow-up and cleanup. The [action registry](../../../src/engine/desk/model.ts) owns their contracts; the [manual](https://discern.sh/docs/guides/delegate-work#inspect-decisions-from-the-desk) lists them.

A menu is advisory. Activation observes current status again and validates the captured identity, branch and absolute path before dispatch. The existing lifecycle plan/apply core rechecks at its effect boundary. A refused action opens a bounded reading view with its reason. It never falls through to the next row after removal.

Press `/` to find entries using the package editor. Enter leaves editing and preserves the filter; Enter again selects. Escape while editing clears the query. Outside editing, Escape goes Back, then exits from the overview. `?` opens keyboard help; its product shortcuts come from [one key map](../../../src/engine/desk/application_view.ts). Typing does not invoke global shortcuts.

## Observe without stopping navigation

The initial frame appears before fleet discovery. One status observation runs at a time; the next starts five seconds after completion. Refresh and Retry use that same observation slot. Fleet reads use bounded workers. Agent and script discovery is limited to the selected task, with one capability read at a time. Review Git reads and stored Proof documents wait for their intentional action route.

Immutable updates retain task identity, focus, search, selection and reading position. Back and foreground return use the package's retained region state. Obsolete observations cannot publish after a newer generation or session cancellation. A recoverable observation failure keeps the last good fleet and marks it stale with Retry; an initial failure remains an unknown fleet. Fatal application failures alone end the session.

Grant and revoke remain human-only actions inside `discern desk`. The grant action reads `Pre-authorize landing` and asks `Allow <branch> to land once green without a further conversation?`. It binds to the task's branch: any later green `done` on that branch is covered once its agent submits it, the landing consumes the grant, revoke removes it, and it dies with the worktree. It never covers a checkpoint variance, a standard limit proposal, or an emergency. Grant and revoke stay available while the gate runs; changing future landing authority does not conflict with the running check.

`Start a follow-up from this task` fixes the selected task's reported branch as the new task's base. Its preview includes that ref and resolved commit before creation. The follow-up remains an independent worktree. Branch containment records the dependency without creating a landing queue.

`Change task title` previews and applies `discern worktree rename <title>`. The command updates the task-metadata record. Branch, worktree id, path, brief, creation source, resources, and lifecycle state remain unchanged.

## Recover a degraded task or main checkout

Recovery detail preserves independent observations instead of reducing a task to one broken state. It shows the exact failed Git or setup observation, worktree registration, branch reachability, filesystem presence, checkout and task identity, setup marker and journal, resource identities, recent lifecycle failure, and every fact that could not be read. Diagnostic, RetryNotice, and ResultSummary Components present the failure, retry classification, and next command ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)).

`Retry setup` appears only when the setup journal makes automatic replay safe. Completed setup-step identities stay skipped. A running one-shot step, a missing journal beside configured one-shot steps, or unreadable setup evidence keeps Retry disabled and shows the exact owner-confirmed setup recovery or doctor command.

The main checkout remains a project boundary. Its detail can inspect `git status --short --branch` and `git diff --stat HEAD`, open a shell, or open the configured editor at main. It explains which landing and cleanup operations depend on readable clean main state. It never offers agent work there.

## Run final checks and review Proof

`Run final checks` calls the same gate core as `discern done`. The task control remains `Accept` regardless of Proof state. A pass refreshes the task with its new Proof; submission and landing remain separate observations.

`Review changes` shows Proof currency, its stored line and Markdown page, checks and standards, every commit subject, Diffstat, changed and uncommitted paths, collisions, and landing authority. Failed reads remain failures with one next step.

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

Status-reported unlanded branches appear as selectable root items. `Inspect commits and changed files` compares the reported branch ref with the trunk. `Resume in a worktree` uses that ref as the fixed creation base and returns to the created task's controls. A branch created by Park offers its retained title and brief as defaults while the recorded branch commit still matches.

After every repair, refusal, or cleanup, the desk surveys the fleet again. If the selected checkout became an unlanded branch, a short notice names that observation and the root Resume entry remains available. Matching landing evidence says `Task landed`. Other disappearances say `Task no longer observed`. The package selects the deterministic surviving neighbor.

`Recent completed tasks` is a bounded read-only view over successful local acceptance events and the latest landed Proof note. It distinguishes a recently landed task from an unexplained removal without creating a task archive.

The desk offers no branch-delete shortcut because the lifecycle has no guarded branch-only deletion core. Contained refs remain informational while another live branch contains their commits. Their existing reclaim workflow owns the applicable worktree action.

## Know when the Desk stays closed

discern owns desk policy. The design-system package owns terminal effects. The desk stays closed under `--plain`, `--json`, CI, or when terminal input or output is unavailable. Bare `discern` shows help in those states. `discern desk` returns `invalid_arguments` and points to `discern status --json`. Ctrl+C and end-of-input cancel. During task creation, Ctrl+U returns to the previous applicable question and retains earlier answers.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

Start with [`live.ts`](../../../src/engine/desk/live.ts) for observation and routing, [`application_view.ts`](../../../src/engine/desk/application_view.ts) for bounded composition, and [`model.ts`](../../../src/engine/desk/model.ts) for status adaptation and action availability. [`desk.ts`](../../../src/engine/desk/desk.ts) owns shared effects; [`view.ts`](../../../src/engine/desk/view.ts) composes their foreground reviews. [`preferences.ts`](../../../src/engine/desk/preferences.ts) owns convenience defaults. [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) is the production prompt boundary, including sequential composition.

The subsystem has focused [model](../../../tests/engine_desk_model_test.ts), [view](../../../tests/engine_desk_view_test.ts), [runtime](../../../tests/engine_desk_runtime_test.ts), [prompt-boundary](../../../tests/terminal_interaction_test.ts), and [real-terminal](../../../tests/engine_desk_tty_test.ts) tests.

## Current state and gotchas

- Agent launching is CLI-only. Desktop-app integrations for Codex and Claude remain deferred until an official lifecycle-aware handoff can retain accurate status after acceptance or drop.
- Current provider entries declare no prompt argument, so an agent launch displays the task brief for copying and keeps the configured invocation unchanged.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Degraded checkouts retain recovery in More actions. A shell requires a present directory. Drop remains a separate destructive offer and requires force when work cannot be verified.
