---
title: The desk
description: Start work, open configured coding agents, and supervise every active worktree from discern's interactive inbox.
order: 90
aliases:
  - discern desk
  - interactive worktree manager
  - fleet dashboard
  - worktree picker
  - inbox
---

# The desk

_Bare `discern` starts new work and opens the human inbox over work in progress (the desk)._

Individual worktree operations are available through Model Context Protocol (MCP) tools and JSON or Markdown CLI results. The desk gives a person starting or supervising several changes one interactive [fleet](../00-orientation/glossary.md#fleet) view. Run `discern` with no verb, or `discern desk`, from the main checkout to open it ([ADR 0119](../_adr/0119-bare-discern-opens-the-operators-desk.md), [ADR 0151](../_adr/0151-the-desk-starts-tasks-and-opens-agents.md)).

For direct movement between checkouts, [`discern enter`](opening-worktrees.md) opens a one-shot picker from any checkout and starts a child shell at the matching project-relative directory.

## Read the inbox

The desk is one session on the design system's application runtime ([ADR 0415](../_adr/0415-the-desk-is-an-inbox-on-the-application-runtime.md)). The header names the project and trunk, shows chips for main-checkout conditions (changes on main, a needed refresh, emergency exceptions, ADR clashes, reappeared checkouts, an update check that is due), counts the tasks that need you, and shows whether the view is Live, Refreshing, Retrying or Offline. The window title carries the same count.

Tasks list in status's decision groups (Ready for review, Needs attention, Working, Approved to land, Idle) with case-folded, accent-aware titles inside each group; Parked and Landed follow as folded groups. Each row shows the [row state's](status.md#row-states) glyph and label in its tone, the behind count beside a stale or ready label, a progress meter beside a running one, and the idle or running time. Green marks only work that can land. A row whose changed files overlap another task's carries `⇄` (`&` without Unicode); an overlap blocks nothing. Duplicate titles carry an identity suffix. A landing's integration worktree belongs to discern and never gets a row. **Sort by title** puts every task in one group; the package folds the quieter groups first on a short screen and remembers which groups you leave folded.

A project with no tasks shows **No tasks yet**, one sentence about what a task is, **New task…** on Enter, and any parked branches below.

## Inspect the selected task

The inspector follows the selection and never takes focus, so Tab is never needed to reach a task's facts or controls ([ADR 0413](../_adr/0413-the-desk-offers-each-tasks-next-decision.md)). It shows the state and status's explanation, then separate facts: Checks (status's words, with the Proof's diffstat), Main, Landing, Queue, Changes, overlaps, setup and the last error, then the next step and its keyed alternatives with what each does. Below sit the evidence sections, the brief, and identity. Space hides or shows the inspector; a narrow screen shows a strip under the list instead, and zoom gives the inspector the whole body.

Proof validity, landing authority and submission stay separate facts in status's words, and a [structural guard](../../../tests/engine_desk_proof_label_guard_test.ts) keeps every desk view from deriving a label or tone from the Proof alone.

Tier-two evidence is read only for the selection once it rests for 150 ms ([`evidence.ts`](../../../src/engine/desk/evidence.ts)): the commits beyond the trunk, the changed files largest first, a dirty checkout's uncommitted files, and the retained record of a failed run. That is at most three Git reads, each with a two-second timeout, and each section fails on its own. Evidence is kept for the 32 most recently used items, keyed by the head, the trunk head and the dirty stamp, so returning to an unchanged task reads nothing.

## Choose an action

Enter runs the selected task's next step: the registry's step for its row state when it can run. `.` or Right opens **Actions**, every registered action in its section (Work, Review, Manage, Danger) with its key, the next step highlighted, and the actions that cannot run now folded under **Unavailable** with their reasons. Letters run their action in the menu, and the same keys run it from the inbox. An unavailable action answers with its reason on the message line and opens nothing.

The [action registry](../../../src/engine/desk/model.ts) owns each action's contract: its menu section, key, next-step and alternative states, summary, review question, consequence lines, confirmation, revision binding, command evidence and availability. Its one label lives only in the [desk vocabulary](../../../src/shared/desk_vocabulary.ts), which the registries, the views and every quoting module read; it ends with `…` exactly when the action asks for a confirmation or more input. The [label guard](../../../tests/engine_desk_label_guard_test.ts) scans every shipped module but the vocabulary and refuses a typed copy. A label that names the trunk carries a `<trunk>` placeholder the observation renders. The [manual](https://discern.sh/docs/reference/worktrees-and-status#desk-actions) lists every action with its section and key; [its test](../../../tests/engine_desk_action_docs_test.ts) derives the Key column from the keys the inbox binds.

Availability stops advertising known refusals. **Land…** and **Queue for landing…** need an honored Proof on a clean branch with commits ahead; **Land…** also waits for the main checkout to have no tracked changes and to be on the trunk, the preconditions acceptance itself checks; an untracked file or generated files out of date on main never block it, because acceptance ignores the first and refreshes the second after it lands. A Proof that carries an unmet checkpoint answer or a standard proposal, or a landing copy retained for your variance, makes **Land…** and **Queue for landing…** unavailable with the exact `discern accept --target <branch> --confirmed --variance … --approve-standard …` command (plus `--composition-receipt` for a retained copy), because the desk does not record exceptions and queueing never decides one. When no observed fact names the decision, the reason names `discern accept --target <branch>`, which serves it. A copy retained for the agent's checkpoint answers makes both unavailable until the agent answers. **Open agent** stays available while a discern command runs in the task.

Every key the desk understands lives in [one key map](../../../src/engine/desk/keys.ts): task mnemonics and command keys come from their registries, and number keys from status's decision groups. The package's own keys for the list (arrows, Home, End, page keys, Tab between groups, Enter, Space, Left, `/` to filter, `j` and `k`) are held equal to the package's reservation, and the [registry guard](../../../tests/engine_desk_registry_guard_test.ts) proves one meaning per key per layer. `?` opens **Keyboard shortcuts**, read from the same map. Escape closes the top layer or clears the filter and never quits; `q` and Ctrl+C quit.

## Use the command palette

Ctrl+K (or `:`) opens the palette: what needs you first (each such task's next step, and each header chip's route), then every desk command by section from the [command registry](../../../src/engine/desk/commands.ts), then every task and parked branch to go to. Commands include **New task…**, **Run a script in the main checkout…**, **Landing** (the queue), **Parked branches**, **Main checkout**, **Session activity**, **Keyboard shortcuts**, **Read the manual**, **Tip of the session**, **Check for updates…**, **Refresh**, the sort, details and mouse toggles, and **Quit**. Choosing a task's next step selects the task first.

Readers open over the inbox and paint from the last observation: the queue, the main checkout, the recovery steps, the session's activity, a parked branch's commits, a recent landing's stored Proof, and **View changes**. A reader's own keys lend the terminal to a child (the pager, an editor, a shell) and the reader is still open when the child returns.

## Start a task

**New task…** opens one form: a title that preserves the submitted Unicode, case, and punctuation (empty means a generated codename), and **More options** with the base (the trunk, a live task, or a parked or unlanded branch), an optional brief, and the agent to open. Its preview says what Create does, and the exact `discern start` command is one key away. Create reviews the start core's retained plan; confirming applies that same plan, which rejects a stale base, id, branch, or path, then selects the new task once a survey lists it. When an agent was chosen, it opens in the new checkout and becomes the remembered default.

**Start follow-up…** fixes the selected task's branch as the base; **Resume…** on a parked branch fixes that branch and offers its retained title and brief. Landing pre-authorization stays a separate explicit action on the created task.

Preferences live in repository-local Git state: the last agent, the mouse, details and sort toggles, and the folded groups. They carry no task fact or authority, and a version-one record keeps its agent.

## Review effects before confirming

A mutating action opens a review sheet that paints at once with "Checking current state…", then shows what its flow read: the registry's consequence lines and the plan's context, with the exact `renderPlan` output (`d`) and the command (`c`) one key away. The sheet opens on its safe choice, so Enter on open never confirms and Escape always keeps; the confirm button is reached with Tab and stays disabled until every line has been on screen. A destructive Drop asks for the branch name up front when its plan names work it would discard, and passes force only when the typed name matches. A review whose task leaves the inbox turns **gone**: it names why and offers only Close.

Confirming hands the terminal to the effect through the shared executor, after a painted handoff line. Each effect revalidates the reviewed task's identity, branch and absolute path against a fresh status read, and the lifecycle core rechecks at its effect boundary. When the effect returns, a message says what happened, a failure at length opens a result reader with the [shared result reading](../../../src/shared/emit.ts) and its recovery action, and the desk surveys again.

The cleanup actions preserve separate contracts:

| Action  | Keeps                                                               | Removes                                                                                 | Later route                                                                                    |
| ------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Park    | Task branch, committed work, title, brief, and creation source      | Checkout, recorded resources, worktree Proof, landing grant, and other worktree records | **Resume…** on its row in Parked.                                                              |
| Reclaim | Contained branch, containing live branch, and commits carried there | Contained checkout, recorded resources, worktree Proof, grant, and task metadata        | The retained branch self-cleans after its containing work lands; it also remains resumable.    |
| Drop    | Trunk, other tasks, and a bounded recovery ref for a deleted branch | Checkout, owned branch, resources, metadata, grant, Proof, and selected work            | Recover committed branch tips from the recovery ref; uncommitted files have no automatic path. |

Park has no force route. Reclaim requires verified containment. Only the core's discard-work refusal can lead to typed force consent; a generic refusal never does.

## Lend the terminal to a child

Agents, shells, editors, the pager, the manual and Project Scripts run with the terminal; the desk paints one handoff line first, and the session returns to the same screen. Launcher layers close when their child starts (the agent picker, the script form, the update disclosure); readers that lend the terminal stay open. On return the desk names what the child changed in its task ("Back from the shell · Docs glossary: 2 more files changed") once the next survey lands. A failed child's last words stay readable. When the session ends, its scrollback lists every command it ran.

A Project Script asks for an optional argument line first. Spaces separate arguments; quotes group spaces; every other character stays literal because the desk builds an argument vector and never invokes a shell. The form shows the working directory and the parsed arguments, and Run stays disabled while the line cannot be parsed. Missing or non-executable scripts stay listed as unavailable with their recovery.

The agent picker retains configured providers whose binary is missing from `PATH`, with a reason. When a task has a stored brief and its provider takes no prompt option, a review shows the brief to copy before the agent opens.

Each task effect enters `executeOperation` under its own command identity and selected absolute target. A shell, editor, agent, or Project Script is project code and holds no exclusion boundary while it runs ([ADR 0408](../_adr/0408-project-code-holds-no-exclusion-boundary.md)). Process groups stop with the desk ([ADR 0159](../_adr/0159-inherited-terminal-children-have-one-owned-lifecycle.md)).

## Observe without stopping navigation

The first frame paints before the fleet survey. One status survey runs at a time; a refresh during one queues exactly one follow-up, and the next survey starts five seconds after the last finishes. A survey must match the generation it was asked for. One failure reads Retrying; a second reads Offline with a persistent warning and `r` to retry, which you may close; the last good rows stay. Agent and script discovery runs for the selected task beside its evidence.

The package owns selection, focus, scroll, folds, zoom, filtering and field editing. The desk keeps product state in a pure state machine ([`desk_state.ts`](../../../src/engine/desk/desk_state.ts)) and reads the package's state only from its context. A selection whose row moves group or leaves the inbox follows the package's rule, and the desk names the move once ("Manual concision landed on main"). Only the owner opens or closes a layer: an observation never does, and a menu or picker whose task left says so and offers nothing.

## Recover a degraded task or main checkout

Recovery steps preserve independent observations instead of reducing a task to one broken state ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)). The reader shows the exact failed Git, env-file, or setup observation, registration, reachability, filesystem presence, identity, setup marker and journal, resources, the recent failure, and every fact that could not be read, with the next command.

`Retry setup` appears only when the setup journal makes automatic replay safe. Completed setup-step identities stay skipped. A running one-shot step, a missing journal beside configured one-shot steps, or unreadable setup evidence keeps it unavailable with the exact owner-confirmed recovery or doctor command.

The main checkout remains a project boundary. **Main checkout** reads its changes and can show `git status --short --branch` with `git diff --stat HEAD` in the pager, open a shell or editor there, or run its Project Scripts. It never offers agent work there.

## Run checks and review changes

**Run checks…** calls the same gate core as `discern done`. A pass refreshes the task with its new Proof, and its state becomes Ready, Approved or Queued; submission and landing remain separate observations.

**View changes** reads the checks in words, landing authority, the changed files and commits, and the complete Proof. Multi-line evidence keeps each line on its own row, and every single-line slot of the view passes through the desk's [text module](../../../src/engine/desk/text.ts), whose [guard](../../../tests/engine_desk_text_guard_test.ts) renders every view with multi-line observations and refuses a control picture. `o` opens `git diff --no-ext-diff --color=always <trunk>...HEAD` in the [shared pager](../../../src/lib/pager.ts); `e` runs an available simple command from `$VISUAL` or `$EDITOR`.

## Choose how proven work lands

Proof, permission, and submission are independent. A pre-authorized task with honored Proof reads **Approved** until it is queued. **Pre-authorize…** asks `Let <task> land without asking?` and records permission for the effort; when the task can land now, a next sheet offers **Land…** and **Queue for landing…**, and Done leaves it pre-authorized and not queued. Granting alone neither queues a revision nor starts a background run. The grant binds to the task's branch, the landing consumes it, revoke removes it, and it dies with the worktree. It never covers a checkpoint variance, a standard limit proposal, or an emergency. Grant and revoke stay available while the gate runs.

**Land…** reviews the proven revision, submits it, and starts acceptance with the review as its consent; its command evidence is `discern accept --target <branch> --confirmed`. **Queue for landing…** records the reviewed revision through `discern accept queue --target <branch>`; when unattended landing needs permission, it asks for the grant first. Explicit resubmission requires current, complete Proof and a clean checkout. [ADR 0399](../_adr/0399-acceptance-can-queue-without-starting-landing.md) records the shared boundary.

## Check for updates

**Check for updates…** is a desk command, available with an empty fleet and before any reminder is due. It asks **Check for updates?** with the registry's consequence lines (it opens the `discern.sh` release page, tells that page the running version, and installs nothing), with Cancel focused; only **Open** authorizes the handoff and its local timestamp. The action uses the [release core](../../../src/commands/releases.ts) through the shared executor. When the browser cannot open, a reader shows the release information with its address. The palette marks the command when status's clone-local clock says a check is due, and the next observation after a recorded handoff removes the mark without a restart.

## Know when the desk stays closed

discern owns desk policy. The design-system package owns terminal effects. The desk stays closed under `--plain`, `--json`, CI, or when terminal input or output is unavailable. Bare `discern` shows help in those states. `discern desk` returns `invalid_arguments` and points to `discern status --json`.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested desk entry; exit to return ([ADR 0157](../_adr/0157-the-desk-owns-launched-child-sessions.md)).

## Where it lives in code

[`desk.ts`](../../../src/engine/desk/desk.ts) owns the runtime seams and wires a session; [`live.ts`](../../../src/engine/desk/live.ts) schedules surveys, the evidence slot and terminal handoffs; [`desk_state.ts`](../../../src/engine/desk/desk_state.ts), [`desk_intent.ts`](../../../src/engine/desk/desk_intent.ts) and [`desk_transitions.ts`](../../../src/engine/desk/desk_transitions.ts) hold the pure product state machine. The views are pure: [`inbox_view.ts`](../../../src/engine/desk/inbox_view.ts) composes the whole view, [`inspector_view.ts`](../../../src/engine/desk/inspector_view.ts) builds the inspector and strip, and [`menu_view.ts`](../../../src/engine/desk/menu_view.ts), [`palette_view.ts`](../../../src/engine/desk/palette_view.ts), [`reader_view.ts`](../../../src/engine/desk/reader_view.ts) and [`sheet_view.ts`](../../../src/engine/desk/sheet_view.ts) build the layers. The [`flows/`](../../../src/engine/desk/flows/context.ts) modules prepare each review from its lifecycle core and run each effect and child. [`model.ts`](../../../src/engine/desk/model.ts) adapts status and holds the action registry, [`commands.ts`](../../../src/engine/desk/commands.ts) the command registry, [`keys.ts`](../../../src/engine/desk/keys.ts) the key map, and [`preferences.ts`](../../../src/engine/desk/preferences.ts) the convenience defaults.

The subsystem has focused [state machine](../../../tests/engine_desk_state_test.ts), [runtime](../../../tests/engine_desk_runtime_test.ts), [geometry](../../../tests/engine_desk_geometry_test.ts), [evidence](../../../tests/engine_desk_evidence_test.ts), [model](../../../tests/engine_desk_model_test.ts), and [real-terminal](../../../tests/engine_desk_tty_test.ts) tests. The runtime tests drive the real package runtime on a fake terminal and a manual clock through [one session driver](../../../tests/fixtures/desk_session.ts); the real-terminal journeys wait on the package's state reports.

## Current state and gotchas

- Agent launching is CLI-only. Desktop-app integrations for Codex and Claude remain deferred until an official lifecycle-aware handoff can retain accurate status after acceptance or drop.
- Current provider entries declare no prompt argument, so an agent launch displays the task brief for copying and keeps the configured invocation unchanged.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A degraded checkout's next step is **Recovery steps** (or **Retry setup…** when replay is safe), with **Open shell** beside it when its folder exists. Drop stays in the Danger section and requires the branch name when work cannot be verified.
- An Interrupted task's next step is **Recovery steps** too: its landing stopped and nothing landed, so the steps name `discern worktree prune` to reclaim discern's integration copy before landing again.
- Review sheets carry each lifecycle core's existing plan and consequence lines; they are not yet built from per-line sources.
- Three package limits have desk-local workarounds: the inspector's next step has no heading (a section whose blocks render nothing still draws one), the inbox sets its minimum title width to its longest title (the content-sized split could drop the age column), and tests wait for Escape in wall time (the lone-Escape window is not on the injected clock).

The [Desk terminal guard](../../../tests/engine_desk_terminal_guard_test.ts) enrolls authored modules in this subtree. It rejects raw terminal transport, control bytes, and generic foundation imports while admitting product state, types, and component composition.
