---
id: guide-delegate-work
title: "Delegate work"
description: "Shape substantial work into owned seams, dispatch it deliberately, and inspect decisions in one place."
order: 90
publish: true
kind: guide
aliases:
  - "guide-delegate-work"
  - "The Desk"
  - "interactive worktree manager"
  - "fleet dashboard"
  - "worktree picker"
  - "desk tips"
  - "tip line"
  - "Bundled Skills"
  - "built-in skills"
  - "bundled playbooks"
  - "skill catalog"
redirect_from:
  - "/docs/worktrees/the-desk"
  - "/docs/worktrees/desk-tips"
  - "/docs/skills/bundled-skills"
---

# Delegate work

Shape substantial work into owned seams, dispatch it with named ownership, and inspect decisions in one place.

## The Desk

_Bare `discern` starts new work and opens the human view over work in progress (the Desk)._

Individual worktree operations are available through Model Context Protocol (MCP) tools and JSON or Markdown CLI results. The desk gives a person starting or supervising several changes one interactive [fleet](../30-reference/glossary.md#fleet) view. Run `discern` with no verb, or `discern desk`, from the main checkout to open it ([ADR 0119](https://discern.sh/docs/decisions/0119-bare-discern-opens-the-operators-desk), [ADR 0151](https://discern.sh/docs/decisions/0151-the-desk-starts-tasks-and-opens-agents)).

For direct movement between checkouts, [`discern worktrees`](coordinate-parallel-tasks.md) opens a one-shot picker from any checkout and starts a child shell at the matching project-relative directory.

### Start a task

The root menu groups project actions under **Desk commands** and refresh or quit under **Session**. It always includes `Start a task`, adds `Run a Project Script` when configured, and opens [discern.sh/docs](https://discern.sh/docs) from `Read discern's docs`. Task groups remain separate from both command groups, so `Choose a task or Desk command` names every selectable entry.

`Start a task` passes an optional name to `discern start`: a value becomes the worktree id and branch; blank draws a random codename. The Desk continues after setup.

After creation, the Desk opens the new row. `Refresh` runs another status survey, so a worktree created elsewhere appears in the root menu.

### Read the decision order

The Desk uses the same observed Fleet facts and task status as `discern status`; it does not classify the same work again. It groups each task into one of 5 human-decision states ([ADR 0318](https://discern.sh/docs/decisions/0318-the-desk-adapts-status-into-one-human-decision)):

| Group           | Included worktrees                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs attention | Broken or unreadable setup, a failed, partial, or refused action, stale work, unreadable or unavailable [Proof](../30-reference/glossary.md#proof), or overlap with another task. |
| Ready to review | A clean commit ahead of the trunk with honored Proof and no branch lag.                                                                                                             |
| Working         | A fresh running discern operation, including its verb, elapsed time, and typical duration when known.                                                                               |
| Paused          | Uncommitted or committed work without live activity; the row names the next unmet condition, such as Update or final checks.                                                        |
| Empty           | A healthy worktree with no uncommitted files or commits ahead of the trunk.                                                                                                         |

Within groups, recent worktrees appear first. The root board shows project and main-checkout state, task totals, counts that need a person or are ready to review, static `Refreshed just now`, bounded fleet notices, and a secondary [Desk tip](delegate-work.md). Each row shows its title, decision headline, one fact, and the recommended action when it fits. Selection opens the complete evidence.

Rows adapt at 96 and 56 columns ([ADR 0352](https://discern.sh/docs/decisions/0352-desk-decisions-cross-a-pure-responsive-presentation-boundary)): wide rows separate task, state, and activity or action; medium rows keep task and state together; narrow rows put state and detail below the task. Every row has an independent width, and task detail preserves a truncated title. Static content retains at most one third of the terminal height; the interaction fitter owns the rest. Search begins at 9 tasks. One result receives active focus; the query field receives it during typing.

### Choose an action

Task detail precedes the action picker. It groups the full title and headline, location, activity, Git facts, landing authority, collisions, containment, agent and Project Script availability, and Proof currency and line. Empty groups disappear. Short screens keep the action picker coherent by moving earlier evidence into terminal history.

The decision carries every action once, its availability reason, and at most one recommendation; the picker shows enabled actions only. Landing, work, review, and worktree groups cover Accept and its grant, Update, scripts, agents, shell, Inspect, Reclaim, and Drop. Each action echoes its CLI command and calls the same lifecycle core, which rechecks before effects.

Accept requires clean committed work ahead of the trunk without known branch lag. Grants belong to one task. Reclaim appears only for [contained work](../40-troubleshooting/worktrees-and-resources.md), keeps the branch, and removes the checkout and its per-worktree state after confirmation.

Project Scripts, agent CLIs, and shells inherit the selected checkout's terminal and return to a fresh survey. Root scripts run from main. Agent launch also requires a configured provider and an available binary; discern does not inspect vendor session state. Owned process groups stop on Ctrl-C, SIGTERM, or SIGHUP ([ADR 0159](https://discern.sh/docs/decisions/0159-inherited-terminal-children-have-one-owned-lifecycle)).

### Know when the Desk stays closed

discern owns Desk policy; design-system package owns terminal effects. Vetoes: `--plain`, `--json`, CI, either non-TTY stream. Bare `discern`: help; `discern desk`: `invalid_arguments`; remedy: `discern status --json`. Ctrl+C/end-of-input cancel; Ctrl+U: no previous form step.

Before setup completes, bare `discern` keeps showing the setup welcome. From inside a linked worktree, the Desk directs you to the main checkout because accept and drop operate from the fleet's supervisory view. Desk-launched processes reject nested Desk entry; exit to return ([ADR 0157](https://discern.sh/docs/decisions/0157-the-desk-owns-launched-child-sessions)).

### Where it lives in code

Start with [`model.ts`](https://github.com/jackwh/discern/blob/main/src/engine/desk/model.ts) for decisions and action legality, [`view.ts`](https://github.com/jackwh/discern/blob/main/src/engine/desk/view.ts) for pure composition, and [`desk.ts`](https://github.com/jackwh/discern/blob/main/src/engine/desk/desk.ts) for surveys, prompts, and effects. Their contracts are covered by [model](https://github.com/jackwh/discern/blob/main/tests/engine_desk_model_test.ts), [view](https://github.com/jackwh/discern/blob/main/tests/engine_desk_view_test.ts), [runtime](https://github.com/jackwh/discern/blob/main/tests/engine_desk_runtime_test.ts), and [real-terminal](https://github.com/jackwh/discern/blob/main/tests/engine_desk_tty_test.ts) tests.

### Current state and gotchas

- The first release of agent launching is CLI-only. Desktop-app integrations for Codex and Claude are a recorded follow-up: they need an official, lifecycle-aware handoff whose status stays accurate when discern later accepts or drops the worktree.
- There is no MCP tool with supervisory access to other efforts' worktrees.
- A row's menu is advisory. The invoked lifecycle core rechecks every precondition before changing state.
- Broken or unreadable checkouts offer only drop. Without explicit force, drop refuses when discern cannot verify the work.
## Desk tips

_Each Desk session puts a teaching line directly below the root status._

The Desk selects one tip when a session opens and keeps it stable until exit ([ADR 0234](https://discern.sh/docs/decisions/0234-tips-are-the-desks-human-advisory-channel)). The design system's Note cue keeps it secondary across terminal modes. The complete text wraps to the terminal and may enter terminal history on short screens.

### How the tip is chosen

Selection is deterministic: identical state shows the identical tip, and nothing is random. The Desk evaluates the registry against the fleet survey it already ran and picks the first match in this order:

1. Tips new since the seen-state's baseline version, in authored order. These carry a "New in \<version\>" prefix; a fresh install starts at the current version.
2. Unseen tips whose context currently applies. A relevance predicate reads the survey — "no standards configured", "a branch is behind the trunk" — and makes a tip timely.
3. Unseen tips in authored order. The authored order is the curriculum.
4. The tip shown longest ago. No tip repeats until the applicable pool exhausts.

A tip whose predicate does not hold is not applicable, rotation included.

### Where the state and the record live

Seen-state lives at `<git-common-dir>/discern/desk/tips.json`, beside the Logbook. Every linked worktree shares the rotation, nothing lands in a commit, and a missing or damaged file resets to fresh instead of blocking the session. Each shown tip's id is also recorded on the Desk session's Logbook event, so a later reader can measure whether the teaching was acted on.

### What a tip may say

Tips educate about capability; alarms about state belong to the board's own facts and `discern status`. Every action remains available without its tip. The register addresses a beginner: command names stay in code spans, and each concept receives a plain-language introduction. The curriculum opener directs the person to start under **Needs attention**, read the selected task's evidence and recommended next action, then choose **Back** to return to the triage queue.

### Where it lives in code

[`src/shared/tips.ts`](https://github.com/jackwh/discern/blob/main/src/shared/tips.ts) is the ordered registry; [`tips.ts`](https://github.com/jackwh/discern/blob/main/src/engine/desk/tips.ts) owns selection, [`tip_state.ts`](https://github.com/jackwh/discern/blob/main/src/engine/desk/tip_state.ts) owns storage, and [`view.ts`](https://github.com/jackwh/discern/blob/main/src/engine/desk/view.ts) composes the line. [Registry tests](https://github.com/jackwh/discern/blob/main/tests/engine_desk_tips_test.ts) and [session tests](https://github.com/jackwh/discern/blob/main/tests/engine_desk_runtime_test.ts) cover the boundary.

### Current state and gotchas

- The registry ships the complete curriculum. Its generated internal inventory shows every rendered line and every feature or verb kept out of the rotation.
- Shown ids are recorded from day one, ahead of any reader that consumes them.
- The generated tip inventory is an internal audit page, regenerated by `deno task codegen`.
## Bundled Skills

_Bundled Skills are task playbooks that discern ships in the binary and adds to a project's effective set._

Every bundled name carries the `discern-` prefix, so it remains identifiable beside project-authored and vendor-provided Skills. Run the live listing to see the bundled catalog together with this project's overrides and exclusions:

```sh
discern skills list
```

### The bundled catalog

| Skill                                                                                         | Reach for it when…                                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`discern-await-the-fleet`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-await-the-fleet/SKILL.md)       | A task depends on another effort. Hold one `await` call for green or landing, then compose what arrived.                                              |
| [`discern-clear-the-decks`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-clear-the-decks/SKILL.md)       | Duplicated helpers, dead code, or leftover scaffolding need a behavior-preserving sweep.                                                              |
| [`discern-cure-a-bug`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-cure-a-bug/SKILL.md)                 | A bug needs diagnosis, a class-level cure, or the suite needs auditing for guards weaker than they look.                                              |
| [`discern-delegate-work`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-delegate-work/SKILL.md)           | Work needs a self-contained handoff, parallel fan-out, or staged briefs.                                                                              |
| [`discern-document-subsystem`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-document-subsystem/SKILL.md) | A documentation subtree needs a grounded README and leaves.                                                                                           |
| [`discern-place-a-checkpoint`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-place-a-checkpoint/SKILL.md) | A recurring review judgment should be served when a matching change completes — trigger, mode, and question wired as a `[checkpoints.<id>]` entry.    |
| [`discern-set-the-standard`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-set-the-standard/SKILL.md)     | A quality number needs a non-regressing floor or ceiling, or a legacy pattern needs outlawing to zero.                                                |
| [`discern-teach-the-project`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-teach-the-project/SKILL.md)   | A session produced a durable lesson future agents need to inherit.                                                                                    |
| [`discern-write-adr`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-write-adr/SKILL.md)                   | A significant decision needs its context and reasoning recorded.                                                                                      |
| [`discern-write-it-once`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-write-it-once/SKILL.md)           | A request concerns agent-written code practices, a fact spans consumers, a set outgrows its guards, or an effectful workflow needs repeatable reruns. |

The table summarizes each live `SKILL.md` description. Open a Skill for its triggers, procedure, and completion conditions. A Skill can contain deeper procedures as files inside its directory. For example, `discern-cure-a-bug` contains the diagnose and suite-audit procedures, `discern-set-the-standard` contains the outlaw procedure, and `discern-write-it-once` contains the bind-the-fact and plan-the-effects procedures.

### Current state & gotchas

- Bundled Skills ship inside the binary. Their source appears in this repository under `templates/skills/`; an installed project receives materialized copies instead of that source tree.
- Bundled Markdown renders configured project paths when discern materializes it. The source remains generic across stacks and repository layouts.
- A registry-driven Gate test reads the same bundled directory set as the materialization code and fails when this catalog omits a name. Adding a bundled Skill therefore enrolls it in the documentation check.
- The catalog reached seven Skills through reductions, then added `discern-write-it-once` and `discern-await-the-fleet` to reach nine ([ADR 0173](https://discern.sh/docs/decisions/0173-trim-the-bundled-skills-to-seven), [ADR 0191](https://discern.sh/docs/decisions/0191-an-eighth-bundled-skill-write-it-once), [ADR 0263](https://discern.sh/docs/decisions/0263-a-ninth-bundled-skill-await-the-fleet)). Two `[standards.skills]` ceilings hold the count and total description budget.

### Where the catalog stays current

| Concern                         | Source                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| Canonical bundled directory set | [`skills.ts`](https://github.com/jackwh/discern/blob/main/src/lib/skills.ts) (`bundledSkillNames`)         |
| Bundled source                  | [`templates/skills/`](https://github.com/jackwh/discern/tree/main/templates/skills/)                       |
| Catalog coverage guard          | [`skills_wellformed_test.ts`](https://github.com/jackwh/discern/blob/main/tests/skills_wellformed_test.ts) |
