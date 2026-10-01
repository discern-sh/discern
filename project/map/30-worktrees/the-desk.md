---
title: The desk
description: Start work, open configured coding agents, and supervise every active worktree from discern's interactive fleet view.
order: 90
aliases:
  - discern desk
  - interactive worktree manager
  - fleet dashboard
  - worktree picker
---

# The desk

_Bare `discern` starts new work and opens the human view over work in progress (the desk)._

Individual worktree operations are available through Model Context Protocol (MCP) tools and JSON or Markdown CLI results. The desk gives a person starting or supervising several changes one interactive [fleet](../00-orientation/glossary.md#fleet) view. Run `discern` with no verb, or `discern desk`, from the main checkout to open it ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md), [ADR 0151](../_adr/0151-the-desk-starts-tasks-and-opens-agents.md)).

For direct movement between checkouts, [`discern enter`](opening-worktrees.md) opens a one-shot picker from any checkout and starts a child shell at the matching project-relative directory.

## Check for updates

**Check for updates…** is among the root desk commands, available with an empty fleet and before any reminder is due. Its description is the command's disclosure, built from the [command registry](../../../src/engine/desk/commands.ts): it opens the `discern.sh` release page in the browser, tells that page the running version, and installs nothing. Activation authorizes that handoff and its local timestamp. The action uses the [release core](../../../src/commands/releases.ts) through the shared desk executor, then shows the same result in the package-owned reader. Escape returns to the live desk with input and focus restored. A launcher failure retains readable URLs.

The advisory beside the action comes from status's clone-local clock. It does not enter tip history or change task ordering. The next observation after a recorded handoff removes it without a restart. Rendering, refreshing, and reading state have no release effects. Installation is a separate requested action.

## Start a task

The overview has a task list and `Desk commands`. Tab reaches either region, including one hidden by a short terminal. Commands include **New task…**, **Run a script in the main checkout…**, **Main checkout**, **Landing** (the queue), recent completions and **Read the manual**. Their keys, effects and bindings come from the [command registry](../../../src/engine/desk/commands.ts), and their labels from the desk vocabulary. The manual opens the same offline Markdown browser as `discern docs`. The desk suspends before the browser acquires stdin. Search, internal links, anchors, reading position, and external-link decisions belong to that shared browser. Escape returns to the desk.

**New task…** opens one sequential form. `What are you changing?` asks for a display title that preserves the submitted Unicode, case, and punctuation. A generated codename is a separate choice. The title remains separate from the normalized worktree id and branch. The preview shows each value and includes the planner's normalization note when their spellings differ.

The compact path starts from the configured trunk and opens the last-used configured agent's fresh-session action when its binary remains available on `PATH`. A missing or stale preference opens the agent-action picker. `More options` adds:

- trunk, a live task, or an unlanded branch as the starting point;
- an optional one-line brief;
- each available provider's fresh or continue action.

Landing pre-authorization is a separate explicit action on the created task.

Preferences remember the last agent and creation path in repository-local Git state. They carry no task fact or authority.

Before creation, the desk shows the retained start plan: title, brief, worktree id, branch, selected ref and commit, worktree root, resources, agent action, and landing authority. Confirmation applies that same plan through the `start` core, which rejects a stale base, id, branch, or path. The Start result names the resulting path and identity.

After creation, the desk opens the new row. `Refresh` runs another status survey, so a worktree created elsewhere appears in the root menu.

## Read current work

The desk is a bounded terminal application ([ADR 0398](../_adr/0398-the-desk-is-a-live-human-control-panel.md)). The package owns its viewport, scrolling, search, resizing and foreground handoff. It displays two regions beside each other when wide enough, stacks them when tall enough, and otherwise shows the active region. Below the package minimum it displays a resize notice. No essential overview or task control depends on terminal history.

Tasks sort by status's decision group (Ready for review, Needs attention, Working, Approved to land, Idle), then by case-folded, accent-aware title, then by stable identity. Each row shows its title and observed activity, with the [row state's](status.md#row-states) glyph and label in the row's indicator and status slots and in the state's tone; green marks only work that can land. Duplicate titles carry an identity suffix. A row whose files overlap another task's carries `⇄` (`&` without Unicode) beside its glyph; **Task details** holds the paths. An overlap does not block a task or change its state. A landing's integration worktree belongs to discern and never gets a row: its task's row reads Landing, Exception, Interrupted, or Refused while its agent owes a checkpoint answer about the combined code.

The row state is the only word a row shows. Proof validity, landing authority and submission stay separate facts: **Task details** lists `Checks: Passed 20m ago`, `Landing: Pre-authorized by you` and `Queue: #1 · lands with any landing` in status's words, and a [structural guard](../../../tests/engine_desk_proof_label_guard_test.ts) keeps every desk view from deriving a label or tone from the Proof alone. The landing queue renders status's submitted revisions, readiness and authority, including an older submitted revision when the branch has newer work. Running operations retain their progress handle. Outstanding emergency exceptions remain available in the queue view. Ending an operation never implies acceptance.

## Choose a task control

Selecting a task opens **Task controls**, titled with its state ([ADR 0413](../_adr/0413-the-desk-offers-each-tasks-next-decision.md)): the state's next step when it can run, then the state's other available keyed steps (at most three), then **Task details**, **More actions** and Back. A ready task offers **Land…**, **View changes** and **Pre-authorize…**; a stale one offers **View changes**, then **Land…** (when its Proof is honored), **Park…** and **Drop…**; a task whose checks failed offers **Open agent**. **More actions** lists every other registered action in registry order. **Task details** retains branch, path, stable identity and observed evidence.

The [action registry](../../../src/engine/desk/model.ts) owns each action's contract: its menu section, key, next-step and alternative states, summary, review question, consequence lines, confirmation, revision binding, command evidence and availability. Its one label lives only in the [desk vocabulary](../../../src/shared/desk_vocabulary.ts), which the registries, the views and every quoting module read, so no second copy can drift; it ends with `…` exactly when the action asks for a confirmation or more input. Hints, tips, status recovery advice, park refusals and plan titles import those labels; the [label guard](../../../tests/engine_desk_label_guard_test.ts) refuses a typed copy. The [manual](https://discern.sh/docs/reference/worktrees-and-status#desk-actions) lists every action with its key and section.

Availability stops advertising known refusals. **Land…** and **Queue for landing…** need an honored Proof on a clean branch with commits ahead; **Land…** also waits for the main checkout to have no tracked changes and to be on the trunk, the preconditions acceptance itself checks; an untracked file or generated files out of date on main never block it, because acceptance ignores the first and refreshes the second after it lands. A Proof that carries an unmet checkpoint answer or a standard proposal, or a landing copy retained for your variance, makes **Land…** and **Queue for landing…** unavailable with the exact `discern accept --target <branch> --confirmed --variance … --approve-standard …` command (plus `--composition-receipt` for a retained copy), because the desk does not record exceptions and queueing never decides one. When no observed fact names the decision, the reason names `discern accept --target <branch>`, which serves it. A copy retained for the agent's checkpoint answers makes both unavailable until the agent answers. An unavailable action shows as disabled, with its reason as the entry's description; it cannot be chosen. **Open agent** stays available while a discern command runs in the task.

Every key the desk understands, per layer, lives in [one key map](../../../src/engine/desk/keys.ts): task mnemonics and command keys come from their registries, number keys from status's decision groups, and a key that runs a control from a sheet or reader names that control instead of typing its label. The [registry guard](../../../tests/engine_desk_registry_guard_test.ts) proves one meaning per key per layer, keeps mnemonics clear of the package's keys, and holds the next-step table to one step per state, at most three keyed alternatives, and no Drop for degraded tasks. This desk answers `?`, `r` and `q`; **Keyboard shortcuts** lists them.

A menu is advisory. Activation observes current status again and validates the captured identity, branch and absolute path before dispatch. The existing lifecycle plan/apply core rechecks at its effect boundary. Reading and consent routes open on their content, so a short terminal shows the plan before the choices. Tab switches between reading and choices; Escape returns. A refused action opens a bounded reading view with its reason. It never falls through to the next row after removal.

Press `/` to find entries using the package editor. Enter leaves editing and preserves the filter; Enter again selects. Escape while editing clears the query. Outside editing, Escape goes Back, then exits from the overview. `?` opens **Keyboard shortcuts**. Typing does not invoke global shortcuts.

## Observe without stopping navigation

The initial frame appears before fleet discovery. Completed agent and script discovery applies to the latest task facts even when a status observation finishes first. One status observation runs at a time; the next starts five seconds after completion. Refresh and Retry use that same observation slot. Fleet reads use bounded workers. Agent and script discovery is limited to the selected task, with one background capability read at a time. A control that needs agent or script configuration rechecks that inventory before execution; other controls do not wait for it. Review Git reads and stored Proof documents wait for their intentional action route.

Immutable updates retain task identity, focus, search, selection and reading position. Back and foreground return use the package's retained region state. Obsolete observations cannot publish after a newer generation or session cancellation. A recoverable observation failure keeps the last good fleet and marks it stale with Retry; an initial failure remains an unknown fleet. Fatal application failures alone end the session.

Grant and revoke remain human-only actions inside `discern desk`. The grant action reads `Pre-authorize…` and asks `Let <task> land without asking?`. It binds to the task's branch: any later green `done` on that branch is covered once the agent or owner submits it, the landing consumes the grant, revoke removes it, and it dies with the worktree. It never covers a checkpoint variance, a standard limit proposal, or an emergency. Grant and revoke stay available while the gate runs; changing future landing authority does not conflict with the running check.

**Start follow-up…** fixes the selected task's reported branch as the new task's base. Its preview includes that ref and resolved commit before creation. The follow-up remains an independent worktree. Branch containment records the dependency without creating a landing queue.

**Rename…** previews and applies `discern worktree rename <title>`. The command updates the task-metadata record. Branch, worktree id, path, brief, creation source, resources, and lifecycle state remain unchanged.

## Recover a degraded task or main checkout

Recovery detail preserves independent observations instead of reducing a task to one broken state. It shows the exact failed Git, env-file, or setup observation, worktree registration, branch reachability, filesystem presence, checkout and task identity, setup marker and journal, resource identities, recent lifecycle failure, and every fact that could not be read. The bounded recovery reader presents the failure, retry classification, and next command ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)).

`Retry setup` appears only when the setup journal makes automatic replay safe. Completed setup-step identities stay skipped. A running one-shot step, a missing journal beside configured one-shot steps, or unreadable setup evidence keeps Retry disabled and shows the exact owner-confirmed setup recovery or doctor command.

The main checkout remains a project boundary. Its detail can inspect `git status --short --branch` and `git diff --stat HEAD`, open a shell, or open the configured editor at main. Its screen, **Main checkout** in the desk menu, says to inspect shared state there and start task work in its own worktree. It never offers agent work there.

## Run checks and review Proof

**Run checks…** calls the same gate core as `discern done`. A pass refreshes the task with its new Proof, and its state becomes Ready, Approved or Queued; submission and landing remain separate observations.

**View changes** starts with the checks in words, landing authority, and a small change summary. Separate reading routes expose the complete Proof and changed files and commits. Long content scrolls inside its reading region, and multi-line evidence such as a commit list or Git's error output keeps each line on its own row: the desk's [text module](../../../src/engine/desk/text.ts) is the only route to the terminal sanitizers, and its [guard](../../../tests/engine_desk_text_guard_test.ts) refuses any other. Failed and unknown reads stay explicit.

`View actual diff` opens `git diff --no-ext-diff --color=always <trunk>...HEAD` in the [shared pager](../../../src/lib/pager.ts), then returns to review. `Open in editor` runs an available simple command from `$VISUAL` or `$EDITOR`; unsafe values stay disabled with a reason.

## Choose how proven work lands

Proof, permission, and submission are independent. A pre-authorized task with honored Proof reads **Approved** until it is queued, including when its agent has stopped. **Pre-authorize…** records permission for the effort. Its feedback names any queued revision and offers the landing choices immediately when current Proof exists. Granting alone neither queues a revision nor starts a background run. Revocation leaves the submission awaiting authority.

**Land…** reviews the proven revision, submits it, and starts acceptance; its command evidence is `discern accept --target <branch> --confirmed`. Another landing may hold the turn. A moved trunk requires the existing integration checks; a refusal stops the walk. After the selected task lands, acceptance considers the other submissions under their own grants.

**Queue for landing…** calls `discern accept queue --target <branch>`. It records the reviewed revision and reuses an existing grant. If unattended landing needs permission, the flow reviews queueing and then asks for the separate effort grant. It runs no checks and starts no landing or scheduled task. An active or later walk can pick it up; **Land…** or `discern accept --target <branch>` starts a walk.

The queue displays its submitted commit even when the branch has newer Proof. A new commit or `done` does not replace it. Explicit resubmission requires current, complete Proof and a clean checkout. Same-revision queueing keeps its order. Checkpoint and standard decisions retain their exact requirements; an ordinary grant cannot supply them. [ADR 0399](../_adr/0399-acceptance-can-queue-without-starting-landing.md) records the shared boundary.

## Review effects before confirming

Before a lifecycle mutation, the desk puts its live plan, its registry consequence lines, and its command in a locally scrolling reader with fixed action controls, under the registry's review question. The authoritative core checks current state again after confirmation. Drop binds the selected absolute target, branch, revision, and changed contents to that review; a changed or unreadable subject requires a fresh review. Only the core's discard-work refusal can lead to typed force consent. Confirmations default to No; discarding work also requires the branch name.

The cleanup actions preserve separate contracts:

| Action  | Keeps                                                               | Removes                                                                                 | Later route                                                                                    |
| ------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Park    | Task branch, committed work, title, brief, and creation source      | Checkout, recorded resources, worktree Proof, landing grant, and other worktree records | Choose **Resume <branch>…** in the desk commands.                                              |
| Reclaim | Contained branch, containing live branch, and commits carried there | Contained checkout, recorded resources, worktree Proof, grant, and task metadata        | The retained branch self-cleans after its containing work lands; it also remains resumable.    |
| Drop    | Trunk, other tasks, and a bounded recovery ref for a deleted branch | Checkout, owned branch, resources, metadata, grant, Proof, and selected work            | Recover committed branch tips from the recovery ref; uncommitted files have no automatic path. |

Park has no force route. Reclaim requires verified containment. Drop remains available as a destructive decision, defaults to No, and retains typed branch confirmation when work may be discarded.

Before review, a Project Script asks for an optional argument line. Spaces separate arguments; quotes group spaces; every other character stays literal because the desk builds an argument vector and never invokes a shell. The review shows the script's name, description, exact executable and arguments, working directory, required confirmation, and undeclared destructive policy. Apply checks the reviewed executable against the branch-local configuration again. `Show command` displays that executable invocation and the equivalent `discern scripts <name> [args...]` command without running either. Missing or non-executable scripts stay disabled with recovery, and the recovery follows the file: one that names an interpreter is offered the executable bit, while one that does not is told it is not a command, because setting the bit there would list an entry that still cannot run.

The agent picker retains configured providers whose binary is missing from `PATH`, with a focused reason. Available actions keep the provider-owned labels and commands.

Before launch, the agent handoff shows the stored brief. The desk appends that brief to provider command arguments when the provider registry declares a documented prompt option with a separate argument value. Current provider entries declare no such option. The handoff therefore asks the person to copy the brief and leaves the configured command arguments unchanged.

Session state stays outside discern, and resume arguments come from the provider registry. Scripts, agents, and shells inherit the selected checkout's terminal and return to a fresh survey. Only results persist as the desk's message: what it printed while a child owned the terminal, such as how to come back, was true only until the child exited. Each task effect enters `executeOperation` under its own command identity and selected absolute target. Its journal begins before ownership or capacity waits; contention names the actual lease and progress handle. A shell, editor, agent, or Project Script is project code and holds no exclusion boundary while it runs: an agent's gate proceeds on the same checkout, and a running gate does not refuse the operator a look around ([ADR 0408](../_adr/0408-project-code-holds-no-exclusion-boundary.md)). Cancellation retains its result before returning control. Short results survive the return without an automatic pause; failures retain the detailed output. Failed final checks and acceptance use the [shared result reading boundary](../../../src/shared/emit.ts), including its registered recovery action, before the package reader opens. Their process groups stop with the desk ([ADR 0159](../_adr/0159-inherited-terminal-children-have-one-owned-lifecycle.md)).

## Resume worktree-less branches

Status-reported unlanded branches appear as selectable root items, each labeled **Resume <branch>…**. `Inspect commits and changed files` compares the reported branch ref with the trunk. `Resume in a worktree` uses that ref as the fixed creation base and returns to the created task's controls. A branch created by Park offers its retained title and brief as defaults while the recorded branch commit still matches.

After every repair, refusal, or cleanup, the desk surveys the fleet again. If the selected checkout became an unlanded branch, a short notice names that observation and the root Resume entry remains available. Matching landing evidence says `Task landed`. Other disappearances say `Task no longer observed`. The package selects the deterministic surviving neighbor.

`Recent completed tasks` is a bounded read-only view over successful local acceptance events and the latest landed Proof note. It distinguishes a recently landed task from an unexplained removal without creating a task archive.

The desk offers no branch-delete shortcut because the lifecycle has no guarded branch-only deletion core. Contained refs remain informational while another live branch contains their commits. Their existing reclaim workflow owns the applicable worktree action.

## Know when the desk stays closed

discern owns desk policy. The design-system package owns terminal effects. The desk stays closed under `--plain`, `--json`, CI, or when terminal input or output is unavailable. Bare `discern` shows help in those states. `discern desk` returns `invalid_arguments` and points to `discern status --json`. Ctrl+C and end-of-input cancel. During task creation, Ctrl+U returns to the previous applicable question and retains earlier answers.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

Start with [`live.ts`](../../../src/engine/desk/live.ts) for observation and routing, [`application_view.ts`](../../../src/engine/desk/application_view.ts) for bounded composition, and [`model.ts`](../../../src/engine/desk/model.ts) for status adaptation and the action registry. [`commands.ts`](../../../src/engine/desk/commands.ts) holds the desk-level command registry, [`keys.ts`](../../../src/engine/desk/keys.ts) the key map, [`text.ts`](../../../src/engine/desk/text.ts) the route to the terminal sanitizers, and [`step_labels.ts`](../../../src/shared/step_labels.ts) the human words for each built-in plan step. [`desk.ts`](../../../src/engine/desk/desk.ts) owns shared effects; [`reading.ts`](../../../src/engine/desk/reading.ts) places their evidence and choices in the package application. [`contracts.ts`](../../../src/engine/desk/contracts.ts) holds product routes and review facts. [`preferences.ts`](../../../src/engine/desk/preferences.ts) owns convenience defaults. [`terminal_interaction.ts`](../../../src/lib/terminal_interaction.ts) is the production prompt boundary, including sequential composition.

The subsystem has focused [model](../../../tests/engine_desk_model_test.ts), [live application](../../../tests/engine_desk_live_test.ts), [runtime](../../../tests/engine_desk_runtime_test.ts), [prompt-boundary](../../../tests/terminal_interaction_test.ts), and [real-terminal](../../../tests/engine_desk_tty_test.ts) tests.

## Current state and gotchas

- Agent launching is CLI-only. Desktop-app integrations for Codex and Claude remain deferred until an official lifecycle-aware handoff can retain accurate status after acceptance or drop.
- Current provider entries declare no prompt argument, so an agent launch displays the task brief for copying and keeps the configured invocation unchanged.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- A degraded checkout's next step is **Recovery steps** (or **Retry setup…** when replay is safe), with **Open shell** beside it when its folder exists. Drop stays under **More actions** and requires force when work cannot be verified.
- An Interrupted task's next step is **Recovery steps** too: its landing stopped and nothing landed, so the steps name `discern worktree prune` to reclaim discern's integration copy before landing again. The registry guard requires every written state's next step to be available on that state's own fixture.
- The key map declares a mnemonic for every keyed action, but this desk answers only `?`, `r` and `q`: the pinned package lets a key update the view, not hand the terminal to an action, so actions run from the task controls.

The [Desk terminal guard](../../../tests/engine_desk_terminal_guard_test.ts) enrolls authored modules in this subtree. It rejects raw terminal transport, control bytes, and generic foundation imports while admitting product state, routes, consent, and component composition. The full-screen evidence renderers have no fallback route.
