# Working in Demo

discern's built-in instructions appear first. Demo's own instructions follow the divider and take precedence where they conflict.

## Operating discern

discern gives each development task an isolated workspace, runs the project's configured checks, records completion evidence, and controls how changes land on the shared branch. Its configuration lives in **`discern.toml`**. Use its **MCP tools** as the primary interface.

- **Orient first.** Call **`discern_status`** at the start of every session, including investigation-only and resumed sessions. It reports current state and the next action without running checks or changing the project.
- **Use the effort's worktree before editing.** An effort is one task carried through implementation and review. Continue in its existing worktree across feedback and resumed sessions. For a new effort requiring edits, call **`discern_start`** from the main checkout and move your file operations to the returned path. Read-only investigation does not require creating a worktree.
- **Finish through `discern_done`.** It verifies the configured gate: the checks required to call the change complete. Use **`discern_prepare`** or a diagnostic's reproduce command while iterating. A long call announces a `discern progress` handle; after a lost call, read the run back with it instead of rerunning. Follow the finishing sequence below before reporting completion.
- **Follow the reported next action.** Use the result's diagnostics and recovery instructions instead of bypassing them with raw Git or shell operations. If the remedy cannot be followed, use **`discern_docs`** for the relevant procedure or report the unresolved condition to the owner.
- **Find the right reference.** **`discern_docs`** explains discern; **`discern_map`** reads the current project's documentation; **`discern_doctor`** diagnoses installation problems.

**When MCP is unavailable:** tell the owner and use the **`discern` CLI**, with `--markdown` for readable results or `--json` for structured fields. Read the reported state, diagnostics, recovery instructions, and any owner relay or Proof. If output is truncated, retrieve its structured or stored view; never repeat an effectful command just to recover omitted output. If the CLI is also unavailable, stop and let the owner choose between installing discern (`curl discern.sh` explains how) and continuing without its protections.

## Communicating with the owner

Explain discern's findings through their consequences for the requested work: what happened, what remains unverified, and what you will do next. Match the owner's technical familiarity; explain unfamiliar terms when needed. Distinguish observed facts from suspected causes. Continue authorized investigation and repair before asking the owner to resolve routine implementation choices. When a decision is needed, present the supported tradeoff, your recommendation, and what approval would authorize. Keep completion claims within the available evidence.

## Generated files — don't hand-edit

discern compiles the project's instruction sources (`discern/instructions.md`) into the agent files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) and materializes skills into their directories (`.claude/skills`, `.agents/skills`). To change what you read, edit the source and run **`discern refresh`** — edits to a generated file are overwritten on the next compile.

## Isolated worktree workflow

discern keeps each effort in its own **linked git worktree** so parallel work doesn't collide.

No per-worktree resources are configured. If parallel worktrees collide over shared state (a database, a port), the `[worktree.resources]` table isolates it per worktree.

Keep one worktree for the whole effort, through review feedback and resumed sessions.

- **Resume the assigned worktree.** If this effort already has a worktree, continue at its recorded path and pass `path` to discern tools that accept it. If that path is unavailable, ask which worktree belongs to this effort instead of creating another. Do not call `discern_start` again.
- **Never adopt another effort's worktree**, even when it is idle or clean. Fleet rows in `discern_status` do not say which effort is yours.
- **Move your own file operations.** `discern_start` creates a worktree from `main` with branch prefix `agent/` and re-aims discern's tools. Your shell and editor must also use the returned path. If you can't change your working root, prefix shell commands with `cd <path> &&` and target file operations explicitly.
- **Update through `discern_update`.** Call it when behind `main` mid-work; no Git pre-check or hand-merge is needed. Re-read files named in its overlap report. A proven revision needs no update: `discern_accept` composes the moved trunk itself.
- **Wait through `discern_await`.** Use one longest-safe call when work depends on a sibling effort or the trunk; follow its continuation or recovery instructions.
- **Use the test queue.** Limit: 1 concurrent test run across checkouts (`[gate].concurrent_test_runs`). Run direct tests through `discern queue -- <command>`.

### Finishing an effort

1. Run **`discern_prepare`**, review its changes, and commit the intended work for this effort. `prepare` may rewrite files; staging and committing remain your responsibility. Commit each logical change separately.
2. After the final commit, call **`discern_done`** directly on the clean, committed final tree. `discern_done` includes the complete test stage; the final gate needs no standalone test preflight. Use `discern_test` only when its complete test stage is the requested result; it publishes no reusable completion evidence. Before an expensive repeat, name what changed or what it will prove. Diagnose a timeout at the named budget; never raise a limit to pass.
3. Read the completion evidence and landing-authority result. **Proof** records what the configured gate established for the exact validated commit. Later edits require renewed verification.
4. Report what changed, what was verified, and anything still unresolved. End with the returned Proof line verbatim.

`discern_done` proves this worktree's committed tip and records Proof for that exact commit. It lands nothing; the worktree stays yours.

**`discern_accept` submits and lands.** It records the submission — the exact proven commit — and lands it on `main`. A passing gate is evidence; landing requires explicit owner consent or machine-verified authority (`--confirmed` attests the conversation; recorded grants are checked automatically), and a task brief or handoff is never consent. Follow `done`'s authority-aware next action: report and wait when consent is needed, or proceed under the verified authority. Without authority it refuses read-only and the submission waits; relay the Proof line and stop. Landing removes the worktree, resources, and branch once nothing beyond the landed submission remains. If `main` moved after your Proof, `accept` proves the combination in a disposable integration worktree and lands that exact result, waiting behind another landing. A conflict or failed combined check names the cause, lands nothing: run `discern_update`, resolve, commit, `discern_done`, `discern_accept` again. Never adopt an `integration/` worktree — discern's disposable copy.

## Quality standards

No quality standards yet. When a number the user cares about comes up — coverage, bundle size, TODO count — offer `discern-set-the-standard`.

## Checkpoints

A checkpoint asks you to judge a specific question about the change. `discern_status` and `discern_prepare` identify relevant checkpoints; `discern_done` supplies any question that needs a recorded answer.

Judge the question against the actual change and record your conclusion using the supplied instructions. If it does not hold, explain the tradeoff for the owner without including secrets. The gate can still run, but landing requires the owner to approve an exception for the exact unmet questions. Recorded landing grants do not authorize that exception.

## Skills

discern makes **skills** — focused, reusable task playbooks — discoverable to **you**; reach for one when a task matches. **`discern skills list`** shows the set.

When a session yields a durable lesson — a correction, a hard-won procedure, an unrecorded decision — **offer to capture it** with the `discern-teach-the-project` skill at a natural pause, so future sessions inherit it.

## The Map & decisions

`discern/map/` is the **map**, browsable with **`discern_map`**: maintained explanations for agents and an account of their understanding for humans.

Keep affected pages accurate when behavior, boundaries, constraints, or workflows change. Keep the map in the present, not as change history; remove resolved-bug narratives. Explain what readers need for correct changes; link supporting code, tests, configuration, and requirements. Useful implementation summaries belong here. Name functions for entry points or contracts; never transcribe every method or duplicate derivable inventories.

Extend existing sections first. Split pages for distinct reader tasks; create folders with READMEs for durable responsibilities. Keep the root for overview and navigation. Follow existing ordering; numbers are optional.

Link relevant instructions, skills, checks, checkpoints, and ADRs; each keeps its own authority.

Separate current behavior, agreed requirements, and open questions. Put concrete open work in `discern/TODO.md`. Preserve significant architectural rationale as **Architecture Decision Records** under `discern/map/_adr/`. ADRs record decisions; they cannot authorize exceptions to agreed requirements.

- `development` — Working on this project
- `orientation` — Orientation

Find context with `discern_map` `search` in task language, then retrieve the returned `target`.

---

# Demo — project instructions

<!-- setup fills this -->

<!--
  `discern setup` has your coding agent fill this in from the repository. This file
  holds ONLY this project's own conventions — discern's built-in instructions
  (the map, TODO, the worktree workflow, and the quality gate) are bundled and auto-prepended
  when the agent files compile, so don't repeat the standing disciplines here. Delete
  these comments as you fill each section.
-->

_(One-line pitch: what Demo is and who it's for — replace this line.)_

## Conventions

_(Replace this section.)_ Language idioms, style, structure, naming, error handling — anything the tooling enforces. Keep it aligned with the `[jobs]` you wire in `discern.toml`, so the written rule and the enforced rule never disagree.
