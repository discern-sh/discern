---
id: guide-index
title: "Guides"
description: "Find the procedure that matches the outcome and current state."
order: 0
publish: true
kind: guide
aliases:
  - "guide-index"
  - "Find the discern task you need"
  - "task index"
  - "find a task"
  - "what do I do"
  - "workflow tasks"
  - "The quality gate"
  - "quality gate"
  - "worktrees"
  - "isolated worktrees"
  - "parallel work"
  - "agent instructions"
  - "AGENTS.md"
  - "agent skills"
  - "playbooks"
  - "SKILL.md"
redirect_from:
  - "/docs/getting-started/tasks"
  - "/docs/quality-gate"
  - "/docs/worktrees"
  - "/docs/agent-instructions"
  - "/docs/skills"
---

# Guides

Find the procedure that matches the outcome and current state.

## In this section

- [Finish and land a change](finish-and-land-a-change.md): Prepare, prove, review, hand back, authorize, and land one exact worktree change.
- [Fix a red gate](fix-a-red-gate.md): Use a failed Gate result to select a bounded fix and return to evidence-bearing state.
- [Set and raise standards](set-and-raise-standards.md): Add a meaningful Standard, respond without weakening it, and pin an earned gain.
- [Place and answer checkpoints](place-and-answer-checkpoints.md): Place a scarce judgment stop, answer it with evidence, and route an unmet conclusion to the owner.
- [Coordinate parallel tasks](coordinate-parallel-tasks.md): Start, inspect, compose, open, and resource parallel work without treating separate checkouts as separate products.
- [Wait for another task](wait-for-another-task.md): Wait on green, landed, or trunk movement without polling or making the human relay status, then compose from the returned hint.
- [Recover an interrupted task](recover-an-interrupted-task.md): Resume a partially completed or dropped task from durable state without widening cleanup.
- [Delegate work](delegate-work.md): Shape substantial work into owned seams, dispatch it with named ownership, and inspect decisions in one place.
- [Write project instructions](write-project-instructions.md): Put durable provider-neutral rules in one source and regenerate every supported agent surface safely.
- [Create and manage skills](create-and-manage-skills.md): Author, customize, exclude, use, and teach a focused Skill without bloating always-loaded instructions.
- [Connect a coding agent](connect-a-coding-agent.md): Connect one supported coding agent using the shared setup path and the provider-specific facts it needs.
- [Run the Gate in CI](run-the-gate-in-ci.md): Run report-only Gate evidence in CI and require the result without implying landing authority.
- [Improve the practice](improve-the-practice.md): Inspect local evidence, coupling, and improvement findings, then make one bounded practice change.
- [Maintain or remove discern](maintain-or-remove-discern.md): Format discern-owned surfaces, upgrade safely, diagnose the installation, or remove discern while preserving project-owned work.

## Find the discern task you need

_Start with the outcome you want, then follow the link to the page that owns it._

This index follows the lifecycle of a change: get discern running, do the work in isolation, check the result, and hand the finished branch back. Each task links to the manual page with its commands, preconditions, and recovery paths.

If this is your first visit, the [quickstart](../00-start/first-success.md) is the shortest route from installation to a landed change. Use this page when you already know the outcome and want its instructions before learning the manual's subsystem names.

### Starting work

Begin here when discern is not installed yet, the repository has not completed setup, or a new change needs its own checkout.

| I want to…                   | Go here                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Install the discern binary   | [Install the binary](../00-start/first-success.md#1-install-the-binary), then follow the printed `Next:` instruction.                           |
| Add discern to a project     | [Ask your agent to run setup](../00-start/first-success.md#2-ask-your-agent-to-set-the-project-up) and review the scaffold on its setup branch. |
| Troubleshoot an installation | [Start with `discern doctor`](../40-troubleshooting/README.md#start-with-discern-doctor), then match the reported symptom to its fix.           |
| Work in an isolated worktree | [Start an isolated checkout](finish-and-land-a-change.md#start-an-isolated-checkout) from the main checkout and enter the returned path.        |

### Doing work

Keep the change current and put durable project knowledge in the surface that future agent sessions load.

| I want to…                    | Go here                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Update my branch from trunk   | [Bring the trunk into the branch](finish-and-land-a-change.md#bring-the-trunk-into-the-branch), review the incoming overlap, and rerun the gate. |
| Add project instructions      | [Write project instructions](write-project-instructions.md) in the configured source, then run `discern refresh`.                                |
| Record a significant decision | Ask your agent to use [`discern-write-adr`](delegate-work.md#the-bundled-catalog), which applies the project's decision-record format.           |
| Create a reusable Skill       | [Create a project Skill](create-and-manage-skills.md), give it a trigger-rich description, and materialize it with `discern refresh`.            |

### Checking work

Use the fast loop while editing. Run the project's final quality check (the Gate) on the intended final commit.

| I want to…                       | Go here                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Run the Gate                     | [Use `discern done`](README.md) on a clean final commit and read the returned result.                                                  |
| Fix a failed check               | [Start with the first diagnostic](fix-a-red-gate.md), run its `reproduce_cmd`, and return to `discern done` after the fix.             |
| Understand or tighten a Standard | [Read Standards](set-and-raise-standards.md), choose a metric that survives growth, and capture a gain with `discern standards --pin`. |

### Handing off work

A green Gate begins review. The owner still decides whether the branch lands.

| I want to…                | Go here                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Hand work back for review | [Report the branch and its Proof](finish-and-land-a-change.md), wait for the owner's decision, then accept only with their authorization. |

## The quality gate

_Start with the current failure, then follow the Gate from fast feedback to final review evidence._

If `discern done` failed, go to [When the Gate fails](fix-a-red-gate.md). Each precondition or job failure includes a specific next action, the command, and its captured output.

The Gate defines done. It requires latest trunk, non-weakened Standards, current [generated artifacts](../30-reference/glossary.md#generated-artifact), and consistent Map and instructions. Its integrity check rejects broken references, metadata, and Skills ([ADR 0202](https://discern.sh/docs/decisions/0202-the-gate-ships-the-map-integrity-preflight)). It runs fix serially; build, check, test, Standards, and changed-scope gates follow. Undeclared generated output fails ([ADR 0247](https://discern.sh/docs/decisions/0247-generated-artifacts-regenerate-never-merge)), as does changing a tracked file that began clean ([ADR 0148](https://discern.sh/docs/decisions/0148-strand-detection-covers-every-gate-stage)).

A scope with `preview = "<command>"` declares the read-only action an agent can run from its worktree. `impact`, `status`, Gate plans, and successful Gate results carry the same typed scope-and-command record and state that discern did not run it. The action remains advice outside the Gate. Changing the command once changes terminal, JSON, Markdown, and Model Context Protocol (MCP) projections together ([ADR 0346](https://discern.sh/docs/decisions/0346-machine-facts-are-typed-advisories)).

Use `discern prepare` before the final commit. It runs fix and generated jobs, then the complete refresh and checks. Green means tracked agent files are canonical; incomplete provider or Skill refresh is red.

`discern done` reruns the test stage. For a red test, use its diagnostic's reproduce command; use `discern test` only for standalone runs.

Use `discern done` on the intended final commit. A green run on a clean branch ahead of trunk records a Proof for review ([ADR 0114](https://discern.sh/docs/decisions/0114-the-gate-emits-the-receipt)).

### Live terminal presentation

On a cursor-controlled terminal, `done`, `prepare`, `test`, and human composite Gate runs share the package activity frame: lifecycle facts stay pinned; complete and partial subprocess lines feed a bounded tail. `[gate].stream` never gates this frame.

The package fits full, then compact, then append-only output. Resizes retain the same producer feed; interrupts restore the cursor. Success leaves stable facts without replaying the tail. Failure follows them with diagnostics and the full-output-artifact route.

CI, pipes, `--plain`, and terminals without cursor control remain static: `stream = false` groups complete per-job output; `true` streams prefixed lines. JSON, Markdown, and MCP omit human job output.

[`execute.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/execute.ts) resolves presentation separately from capture. [`gate_tty.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/gate_tty.ts) feeds the package; [`command.ts`](https://github.com/jackwh/discern/blob/main/src/engine/jobs/command.ts) retains raw evidence. For result contracts, see [MCP tools & results](../30-reference/mcp-and-results.md).

| Read next                                                                  | What it helps you do                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [When the gate fails](fix-a-red-gate.md)                                   | Read a red result and take the shortest route to the fix.                        |
| [Standards](set-and-raise-standards.md)                                    | Hold a metric floor or ceiling and respond when it fires.                        |
| [Checkpoints](../20-understand/checkpoints.md)                             | Serve a judgment when a change makes it relevant, and record the conclusion.     |
| [The Proof](../20-understand/proof.md)                                     | Read the review evidence a clean green run records for one commit.               |
| [Proof notes](../30-reference/proof-and-checkpoint-formats.md)             | Carry a landed Proof with its trunk commit and opt into fetch transport.         |
| [Strand detection](../40-troubleshooting/gate-and-proof.md)                | Fix tracked files a gate stage changed after the final commit.                   |
| [Run the gate in CI](run-the-gate-in-ci.md)                                | Require the same gate on pull requests and trunk pushes.                         |
| [Continuous improvement](improve-the-practice.md)                          | Find the highest-value practice to improve after the current change passes.      |
| [Co-change coupling](improve-the-practice.md)                              | Check whether this change omitted a file that usually moves with it.             |
| [Practice patterns](../20-understand/evidence-and-improvement.md)          | Read recurring workflow evidence from the local Logbook.                         |
| [`discern tidy`](maintain-or-remove-discern.md)                            | Format discern-owned Markdown and TOML directly or through the format job.       |
| [The fleet test-run cap](coordinate-parallel-tasks.md)                     | Queue concurrent test-stage runs so parallel agents share one machine.           |
| [Practice stats](../30-reference/logbook.md)                               | Share what went well as one card of plain counts from the local logbook.         |
| [Validation findings](../20-understand/evidence-and-improvement.md)        | Compare per-job verdicts within and across recorded execution conditions.        |
| [Patterns decision evidence](../20-understand/evidence-and-improvement.md) | Read the evidence required before Patterns recommends a Gate or Standard change. |
| [Pattern investigations](../20-understand/evidence-and-improvement.md)     | Trace related findings into bounded diagnostic paths.                            |
| [Checkpoint recipes](place-and-answer-checkpoints.md)                      | Adapt nine copyable triggers for common review moments.                          |

## Worktrees

_Each discern task uses an isolated workspace (a Git worktree) with its own checkout, branch, identity, and local dependencies._

`discern start` creates a separate checkout and `agent/…` branch for one task. The main checkout remains the fleet's shared view.

Every checkout has a stable identity, development port, and test-order seed. Linked worktrees additionally receive their declared resources and isolated setup. The main checkout derives its constant identity from the configured trunk branch.

The lifecycle starts from the main checkout. Commit the change in its worktree, run `discern update` when the trunk advances, and finish with `discern done`. Once conversation consent or a recorded grant authorizes landing, `discern accept` moves the validated commit to the trunk and tears down the worktree. `--confirmed` attests only to consent in the current conversation. Automatic cleanup requires recorded fleet ownership; merge status alone never authorizes deletion.

Treat every worktree as occupied, even when Git reports it clean. [`discern status`](../30-reference/worktrees-and-status.md) surveys the fleet and adds recent session findings. Bare `discern` opens the human view over work in progress (the Desk) to inspect, update, land, or drop tasks across the fleet.

| Order | Read next                                                                          | What's in it                                                                    |
| ----: | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
|    10 | [Start, update, and accept](finish-and-land-a-change.md)                           | The full lifecycle, including cleanup and refusal paths.                        |
|    20 | [The trunk](../20-understand/worktrees-and-trunk.md)                               | What the shared branch is, what moves it, and why work stays off it.            |
|    30 | [Per-worktree resources](coordinate-parallel-tasks.md)                             | Provisioning, teardown, the resource ledger, and orphan cleanup.                |
|    40 | [Identity and environment](../30-reference/worktrees-and-status.md)                | Stable names, ports, env inheritance, and runtime discovery.                    |
|    50 | [Parallel and team work](coordinate-parallel-tasks.md)                             | Fleet ownership, branch composition, multiple repos, and new clones.            |
|    60 | [Awaiting the fleet](wait-for-another-task.md)                                     | Block until a sibling is green, its work lands, or the trunk moves.             |
|    70 | [Multi-repo workspaces](coordinate-parallel-tasks.md)                              | One install per repository: trunk links, registries, umbrellas, and submodules. |
|    80 | [Status and session hints](../30-reference/worktrees-and-status.md)                | Read current worktree or fleet state and the next actions it implies.           |
|    90 | [The desk](delegate-work.md)                                                       | Start tasks, open agents, and supervise every active worktree.                  |
|   100 | [Open another worktree](coordinate-parallel-tasks.md)                              | Move sideways into another checkout while preserving your relative directory.   |
|   110 | [Desk tips](delegate-work.md)                                                      | One deterministic teaching line per session and where its record lands.         |
|   120 | [Landing authority](../20-understand/proof.md)                                     | See how conversation consent and recorded grants control landing.               |
|   130 | [Interrupted landing recovery](recover-an-interrupted-task.md)                     | Reconcile a journal without replaying authority or overwriting local data.      |
|   140 | [Hand work back](finish-and-land-a-change.md)                                      | Finish, report the Proof, wait for review, and accept after approval.           |
|   150 | [Reclaiming contained worktrees](../40-troubleshooting/worktrees-and-resources.md) | Reclaim spent train stages on explicit confirmation; branch refs always stay.   |
|   160 | [Cleanup ownership and teardown](../40-troubleshooting/worktrees-and-resources.md) | Prove cleanup authority and verify checkout absence before reporting success.   |
|   170 | [Reappeared worktree paths](../40-troubleshooting/worktrees-and-resources.md)      | Review files written after removal and reclaim only evidence-backed paths.      |
|   180 | [Recover a dropped branch](recover-an-interrupted-task.md)                         | Restore committed work from discern's bounded local recovery refs.              |

## Agent instructions

_Agent instructions are shared project instructions, written once and supplied to every configured coding agent._

discern combines its built-in operating instructions with the instruction sources your project owns. `discern refresh` compiles that text into the instruction files for each configured agent, including `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. Compiled local Markdown links retain their source-relative targets. Several agent integrations can then share one body of project rules.

Start with [Write project instructions](write-project-instructions.md). It covers `[instructions].sources`, the default `discern/instructions.md`, source globs, and what belongs in instructions that every agent reads. Keep those sources provider-neutral: name the project's commands, paths, and invariants rather than one agent's interface.

Then [Compile and check instructions](write-project-instructions.md). It shows when to run `discern refresh` or `discern prepare`, which files appear for each agent, and why edits belong in their sources. The Gate compares generated files with those sources and reports a stale copy as a failed check.

A [Skill](README.md) is a reusable agent playbook for a focused procedure. Every session reads the agent instructions. An agent loads a Skill when its description matches the work. Use instructions for rules every session must carry, and a Skill for a repeatable procedure that needs steps and judgment.

| Read next                                                       | What it helps you do                          |
| --------------------------------------------------------------- | --------------------------------------------- |
| [Write project instructions](write-project-instructions.md)     | Choose sources and write shared instructions. |
| [Compile and check instructions](write-project-instructions.md) | Refresh, inspect, and commit agent files.     |

## Skills

_A Skill is a reusable agent playbook for work that needs a focused procedure._

A Skill is a directory centered on `SKILL.md`. Its description states when the playbook applies. Its body contains the steps, judgment points, and completion conditions. Each configured agent receives the project's effective set and can load a Skill when the request matches. You can also name a Skill in your request to require that procedure.

discern ships a [bundled catalog](delegate-work.md) of development playbooks. A project adds its own under `[skills].dir`, which defaults to `discern/skills`. `discern refresh` materializes the effective set into each configured agent's Skills directory, alongside the compiled [agent instructions](README.md).

Put a short rule every session needs in the agent instructions. Put a repeatable procedure with several steps in a Skill, where it loads for relevant work. [What a Skill is](../20-understand/instructions-skills-and-map.md) explains that boundary.

You control the effective set. [Author a Skill](create-and-manage-skills.md) for project-specific work, [customize or exclude](create-and-manage-skills.md) a bundled one, and use [Teach the project](create-and-manage-skills.md) to record a durable lesson in its smallest project-owned source.

| Read next                                                          | What it helps you do                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [What a Skill is](../20-understand/instructions-skills-and-map.md) | Decide when a procedure belongs in a Skill.                        |
| [Bundled Skills](delegate-work.md)                                 | Find the playbooks discern ships.                                  |
| [Author a Skill](create-and-manage-skills.md)                      | Add a project-specific playbook and make it discoverable.          |
| [Customize or exclude](create-and-manage-skills.md)                | Override a built-in or remove a Skill from the effective set.      |
| [Teach the project](create-and-manage-skills.md)                   | Preserve a correction, procedure, or decision for future sessions. |
