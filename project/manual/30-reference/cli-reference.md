---
id: reference-cli
title: "CLI reference"
description: "Find discern commands and options, understand their results, and use the terminal documentation reader."
order: 20
publish: true
kind: reference
aliases:
  - "reference-cli"
  - "discern setup"
  - "discern setup verify"
  - "discern setup begin"
  - "discern setup step"
  - "discern setup done"
  - "discern setup accept"
  - "discern upgrade"
  - "discern uninstall"
  - "discern doctor"
  - "discern releases"
  - "discern licenses"
  - "discern map"
  - "discern docs"
  - "discern help"
  - "discern config"
  - "discern config set-job"
  - "discern config set-scope"
  - "discern config set-standard"
  - "discern config set"
  - "discern config get"
  - "discern config array"
  - "discern config has"
  - "discern config subsections"
  - "discern config keys"
  - "discern config explain"
  - "discern done"
  - "discern prepare"
  - "discern test"
  - "discern queue"
  - "discern improvement"
  - "discern checkpoints"
  - "discern progress"
  - "discern mcp"
  - "discern scripts"
  - "discern standards"
  - "discern standards propose"
  - "discern refresh"
  - "discern tidy"
  - "discern skills"
  - "discern skills list"
  - "discern skills eject"
  - "discern impact"
  - "discern coupling"
  - "discern await"
  - "discern patterns"
  - "discern patterns archives"
  - "discern patterns reset"
  - "discern patterns seal"
  - "discern status"
  - "discern desk"
  - "discern enter"
  - "discern start"
  - "discern accept"
  - "discern update"
  - "discern identity"
  - "discern worktree"
  - "discern worktree setup"
  - "discern worktree ensure"
  - "discern worktree rename"
  - "discern worktree teardown"
  - "discern worktree park"
  - "discern worktree drop"
  - "discern worktree prune"
  - "interactive documentation reader"
  - "terminal reader controls"
  - "Tab picker"
  - "Press Enter to continue"
  - "$PAGER"
---

<!-- This reference is generated from the live command registry. -->

# CLI reference

Find a command, check its options, or look up how the terminal reader works. Your agent usually runs these commands for you; this page is here when you want to understand an invocation or use the terminal yourself.

`discern <command> --help` shows the same command options in your terminal. Help works before project setup; commands that need a configured project return `not_set_up` until setup is complete.

## Find a command

| Area                | Commands                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Your desk           | [`desk`](#discern-desk), [`enter`](#discern-enter)                                                                                                                                                                                                                                                                                                                                                                       |
| Agentic loop        | [`status`](#discern-status), [`prepare`](#discern-prepare), [`done`](#discern-done), [`test`](#discern-test), [`progress`](#discern-progress), [`queue`](#discern-queue), [`tidy`](#discern-tidy)                                                                                                                                                                                                                        |
| Worktree lifecycle  | [`start`](#discern-start), [`update`](#discern-update), [`await`](#discern-await), [`accept`](#discern-accept), [`worktree`](#discern-worktree-subcommand), [`identity`](#discern-identity)                                                                                                                                                                                                                              |
| Project Scripts     | [`scripts`](#discern-scripts)                                                                                                                                                                                                                                                                                                                                                                                            |
| Setup & maintenance | [`setup`](#discern-setup-subcommand), [`upgrade`](#discern-upgrade), [`doctor`](#discern-doctor), [`config`](#discern-config-subcommand), [`refresh`](#discern-refresh), [`uninstall`](#discern-uninstall)                                                                                                                                                                                                               |
| Inspect & explore   | [`improvement`](#discern-improvement), [`standards`](#discern-standards), [`checkpoints`](#discern-checkpoints), [`skills`](#discern-skills-subcommand), [`impact`](#discern-impact), [`coupling`](#discern-coupling), [`patterns`](#discern-patterns), [`map`](#discern-map), [`docs`](#discern-docs), [`help`](#discern-help), [`licenses`](#discern-licenses), [`releases`](#discern-releases), [`mcp`](#discern-mcp) |

For options shared by commands, see [Global options](#global-options). For keyboard and mouse controls, see [Interactive documentation reader](#interactive-documentation-reader). To interpret a returned status code, see [Exit behavior](#exit-behavior).

## Global options

These options apply to commands unless an entry says otherwise. When discern runs another command, options after that boundary belong to the command it runs. For example, options after `discern queue --` are passed to the queued command.

| Option            | Description                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--json`          | Emit one JSON result on stdout.                                                                                                                                              |
| `--markdown`      | Emit one Markdown result on stdout.                                                                                                                                          |
| `--render`        | Render the Markdown result as terminal output.                                                                                                                               |
| `--no-color`      | Disable color (also honors NO_COLOR and non-TTY output).                                                                                                                     |
| `--plain`         | Disable interactive input and paging; use static output. CI and non-terminal input imply this behavior.                                                                      |
| `--theme <theme>` | Set the terminal theme to `auto`, `light`, or `dark`. Default: `auto`. The automatic mode senses a colored interactive background; `--no-color` and `NO_COLOR` skip sensing. |

## Your desk

Interactive task supervision and worktree entry.

### `discern desk`

Open the live desk: see tasks, review Proof and changes, open an agent, run Project Scripts, or review acceptance and worktree controls. Bare `discern` opens the desk.

Usage: `discern desk [options]`

| Option   | Description                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------ |
| `--json` | The desk is interactive only; use `status --markdown` or `status --json` to list every worktree. |

### `discern enter`

Choose a worktree and open a child shell at the matching project-relative directory.

Usage: `discern enter [options]`

| Option   | Description                                                                       |
| -------- | --------------------------------------------------------------------------------- |
| `--json` | This command is interactive only; use `status --all --json` to inspect the fleet. |

## Agentic loop

Your coding agent runs these as it works.

### `discern status`

Show what's true right now and what to do next (read-only; does not run the gate, the project's full quality check).

Usage: `discern status [options]`

| Option      | Description                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--all`     | Include every worktree even when called from one (local view plus all worktrees).                                                                                                                         |
| `--local`   | Show only this checkout, even in the main checkout.                                                                                                                                                       |
| `--verbose` | Expand fleet attention, per-worktree evidence, configured checks, landing history, and full Proof pages. With JSON, return complete structured status; the default is the bounded orientation projection. |
| `--json`    | Emit a bounded orientation result; add `--verbose` for complete structured status.                                                                                                                        |

### `discern prepare`

Fast inner loop: fixers, [generated] regenerations, complete refresh, then read-only checks (no other build jobs, no tests).

Usage: `discern prepare [options]`

### `discern done`

Require a clean, committed tree. Run finishing steps that may change files, then verify the gate — the project's full quality check: format, lint, type-check, and tests.

Usage: `discern done [options]`

| Option                | Description                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`           | Show the gate plan (the jobs and scope-gates that would run); touch nothing.                                                                                                                                                                                    |
| `--policy-base <ref>` | Use the fetched immutable policy base for a standalone CI report. Strict completion checks against the trunk's current tip.                                                                                                                                     |
| `--standalone`        | Run complete diagnostic feedback, including on a dirty tree. Results are transient and issue no Proof.                                                                                                                                                          |
| `--rerun`             | Run the full gate even when current green Proof covers this exact tree, or explicitly retry an unchanged red verdict. The rerun is recorded.                                                                                                                    |
| `--ci`                | Run the machine gate and report checkpoint questions without enforcing or recording review. The resulting Proof cannot be accepted.                                                                                                                             |
| `--met <id>`          | Declare a served checkpoint's question met (repeatable). Valid only for a checkpoint with an active open question here; the declaration is recorded as your judgment, and the gate runs in the same invocation once every awaiting checkpoint has a conclusion. |
| `--unmet <id>`        | Declare a served checkpoint's question unmet (one per invocation; requires --why). The gate still runs; landing then needs the owner to authorize a variance for it.                                                                                            |
| `--why <rationale>`   | The required rationale for --unmet: one paragraph, 1-500 characters, no newlines or control characters. Recorded opaquely as Proof evidence for the owner's landing decision.                                                                                   |

### `discern test`

Run the project's configured tests on their own, outside the full gate.

Usage: `discern test [options]`

### `discern progress`

Read a long operation back after a lost call: its phase, the counts and failures known so far, and the retained result. Pass the progress handle the operation announced; with no handle, read this checkout's most recently started operation. Reading changes nothing.

Usage: `discern progress [handle] [options]`

### `discern queue`

Run a command while holding one configured concurrent test-run slot. Use `discern await` to watch a fleet condition instead. This command has no `--json`, `--markdown`, or `--render` mode; tokens after `--` belong to the child.

Usage: `discern queue -- <command> [args...]`

### `discern tidy`

Canonically format discern's configured Markdown sources and root discern.toml, and check that fenced box-drawing diagrams stay aligned. Select `md` or `toml`; omit the type to run both. A Markdown file whose frontmatter is not valid YAML, or whose table rows would drop cells when formatted (escape pipes inside code spans as `\|`), is refused and left unchanged.

Usage: `discern tidy [type] [options]`

| Option      | Description                                      |
| ----------- | ------------------------------------------------ |
| `--dry-run` | List the files that would change; touch nothing. |

## Worktree lifecycle

Isolated workspaces your agent drives.

### `discern start`

From the main checkout, create a worktree with a separate checkout and branch for one effort. Base it on the trunk, the shared landing branch, then print its path.

Usage: `discern start [options]`

| Option            | Description                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`       | Show the start plan; touch nothing.                                                                                                      |
| `--name <name>`   | Set the task title and seed its worktree id. discern preserves this text as the title and normalizes the id. Omit for a random codename. |
| `--title <title>` | Set the display title separately from --name. With no --name, the title also seeds the worktree id.                                      |
| `--brief <brief>` | Store an optional one-line brief for task detail and agent handoff.                                                                      |
| `--from <source>` | Branch the new worktree from a ref or an unambiguous worktree id or path. Omit it to start from the trunk.                               |

### `discern update`

Update this branch: merge the trunk's latest into this branch and re-run generated groups and refresh Agent artifacts. The trunk is the shared landing branch. Use `discern upgrade` for discern itself; use `discern refresh` for agent files alone.

Usage: `discern update [options]`

| Option            | Description                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`       | Show the update plan; touch nothing.                                                                                                                                        |
| `--from <source>` | Pull a ref or an unambiguous worktree id or path into this worktree instead of the trunk. For composing on unlanded work — omit it for the routine bring-the-trunk-in call. |

### `discern await`

Block until a fleet condition holds: a sibling branch is green (its worktree holds an honored gate Proof), a branch's work has landed on the trunk, or the trunk has moved. Timing out is not an error; the result carries a short continuation handle that preserves the original condition across calls. To wrap a command behind the concurrent test-run cap, use `discern queue -- <command> [args...]`.

Usage: `discern await [options]`

| Option                | Description                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--green <worktree>`  | Select a sibling by worktree id, path, local branch, or full local ref; wait until its checkout holds an honored gate Proof (a landing also satisfies it). |
| `--landed <worktree>` | Select a sibling by worktree id, path, local branch, or full local ref; wait until its work reaches the trunk.                                             |
| `--trunk-moved`       | Wait until the trunk ref moves from its position at call start.                                                                                            |
| `--resume <handle>`   | Continue a previous not-met wait without resetting its pinned state; pass no condition flag with it.                                                       |
| `--timeout <seconds>` | Seconds before answering "not yet". Omit to wait once for up to 3300s; the condition returns early, and 0 checks once.                                     |

### `discern accept`

Submit this worktree's proven commit and land it on the trunk, the shared landing branch. Landing needs the owner's consent in this conversation or a recorded grant; without one, the submission waits in the landing queue. If the trunk moved after the Proof, the landing composes and checks the combined code in a disposable integration worktree and lands that exact proven commit; a second accept waits its turn. Landing removes the worktree and its branch when the branch holds nothing beyond the landed commit. Use accept emergency --reason <text> to review an explicit exception against actual trunk. Emergency integration requires fresh exact owner confirmation and issues no passing Proof.

Usage: `discern accept [action] [options]`

| Option                       | Description                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                  | Show the selected acceptance plan; touch nothing.                                                                                                                                                                                                                                                                                              |
| `--queue-only`               | Record the current clean, proven revision in the landing queue and return without starting checks or landing. Reuses recorded authority; an active or later accept --target <effort> walk can pick it up.                                                                                                                                      |
| `--target <effort>`          | Select the effort by id, path, or branch, from any checkout. With --queue-only, record its current proven revision; otherwise start landing under applicable authority.                                                                                                                                                                        |
| `--prepare`                  | Emergency only: run checkpoint triggers and retain exact review evidence without validation or integration.                                                                                                                                                                                                                                    |
| `--preparation <receipt>`    | Emergency only: the checkpoint-preparation receipt for this exact repair and trunk.                                                                                                                                                                                                                                                            |
| `--met <id>`                 | Record a satisfied served checkpoint question (repeatable): the continuation of a landing whose combined result awaits your judgment, or emergency preparation with accept emergency --prepare.                                                                                                                                                |
| `--unmet <id>`               | Declare one served integration checkpoint question not satisfied (requires --why). The retained composition is still proved; the owner then decides the declared-unmet landing.                                                                                                                                                                |
| `--why <rationale>`          | The required one-paragraph rationale for --unmet.                                                                                                                                                                                                                                                                                              |
| `--composition <receipt>`    | The served composition receipt an answer or resumed variance decision binds to; the judgment refusal serves it. A replaced composition refuses the receipt and re-serves its own question.                                                                                                                                                     |
| `--reason <text>`            | Emergency only: explain why integration must precede validation.                                                                                                                                                                                                                                                                               |
| `--confirmation <token>`     | Emergency only: the current preview token approved by the owner, with --confirmed.                                                                                                                                                                                                                                                             |
| `--recover <id>`             | Emergency only: reconcile one recorded exception transition and cleanup without new landing authority.                                                                                                                                                                                                                                         |
| `--confirmed`                | Attest that your owner accepted this landing in the current conversation. Recorded standing and effort grants are checked directly. Consent bound to an interrupted transaction may authorize recovery of that transaction only. Without applicable evidence, acceptance refuses read-only; a dry-run needs none.                              |
| `--variance <id>`            | Record that your owner authorized landing this declared-unmet checkpoint without changing it (repeatable; requires --confirmed). The ids must equal the current declared-unmet set, id for id, and recorded grants never authorize a variance.                                                                                                 |
| `--approve-standard <token>` | Record that the owner approved the exact standard/value/reason tuple carried by the current Proof (repeatable; requires --confirmed). Use the proposal-bound token served by the read-only refusal; the token set must equal the current proposal set. Standing, effort, and generic landing grants never authorize a standard limit proposal. |

### `discern worktree <subcommand>`

Manage worktrees — separate checkouts and branches for individual changes.

Usage: `discern worktree <subcommand>`

#### `discern worktree setup`

Set up or re-sync the current worktree.

Usage: `discern worktree setup [options]`

| Option                      | Description                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                 | Show the setup plan; touch nothing.                                                                                                    |
| `--mark-step-complete <id>` | After observing an interrupted setup command's external state, mark its running journal entry complete without replaying it.           |
| `--retry-step <id>`         | After observing an interrupted setup command's external state, reset its running journal entry and run it again.                       |
| `--confirmed`               | Attest that the owner observed the interrupted command's external state and chose this recovery. Required with either recovery option. |

#### `discern worktree ensure`

Idempotent session-start worktree setup.

Usage: `discern worktree ensure [options]`

#### `discern worktree rename`

Change this worktree's display title. Its id, branch, path, brief, and creation source stay unchanged.

Usage: `discern worktree rename <title> [options]`

| Option      | Description                                |
| ----------- | ------------------------------------------ |
| `--dry-run` | Show the title-change plan; touch nothing. |

#### `discern worktree teardown`

Discard this worktree's resources (destroy without accepting).

Usage: `discern worktree teardown [options]`

| Option      | Description                            |
| ----------- | -------------------------------------- |
| `--dry-run` | Show the teardown plan; touch nothing. |

#### `discern worktree park`

Remove a clean task checkout and its resources while retaining its branch and task wording for resume. Select it by worktree id, path, local branch, or full local ref.

Usage: `discern worktree park <worktree> [options]`

| Option      | Description                        |
| ----------- | ---------------------------------- |
| `--dry-run` | Show the Park plan; touch nothing. |

#### `discern worktree drop`

Discard a worktree from the main checkout: tear down its resources, remove it, and delete its branch. Protects uncommitted work and commits not on the trunk, the shared landing branch, unless --force is set. Select it by worktree id, path, local branch, or full local ref.

Usage: `discern worktree drop <worktree> [options]`

| Option      | Description                                                                           |
| ----------- | ------------------------------------------------------------------------------------- |
| `--force`   | Discard even when the worktree holds uncommitted changes or commits not on the trunk. |
| `--dry-run` | Show the drop plan; touch nothing.                                                    |

#### `discern worktree prune`

Reclaim positively-owned merged worktrees, stale state, reappeared paths, and orphaned resources.

Usage: `discern worktree prune [options]`

| Option        | Description                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `-y, --yes`   | Non-interactive: skip confirmation.                                                                                                       |
| `--contained` | Also reclaim contained worktrees — checkouts whose committed work is fully contained in another live branch. Branch refs are always kept. |
| `--dry-run`   | Report what would be removed/reclaimed without acting.                                                                                    |

### `discern identity`

Print stable values that keep each checkout's branch, development host, port, database, and external resources separate.

Usage: `discern identity [worktree] [options]`

| Option              | Description                                                               |
| ------------------- | ------------------------------------------------------------------------- |
| `--id`              | Print the safe base name for this checkout (default).                     |
| `--site`            | Print its development server's host name.                                 |
| `--branch`          | Print its branch name.                                                    |
| `--port`            | Print its stable development-server port.                                 |
| `--db`              | Print its database-safe name.                                             |
| `--seed`            | Print its stable test-order seed.                                         |
| `--worktree`        | Print its base resource handle — a stable project-prefixed external name. |
| `--resource <name>` | Print the stable external name for one declared resource.                 |
| `--resources`       | Print every declared resource as name=stable-external-name lines.         |

## Project Scripts

Project-owned automation, listed or run by name.

### `discern scripts`

List executable Project Scripts, or run one literal name at the project root with the four supported DISCERN_* variables and every following argument forwarded unchanged.

Usage: `discern scripts [name] [args...] [options]`

## Setup & maintenance

You or your agent tend the installation.

### `discern setup <subcommand>`

Read the setup welcome and learn the canonical first step. Run `discern setup begin` only after the owner is ready to scaffold.

Usage: `discern setup <subcommand>`

#### `discern setup verify`

Preview what setup will do and the consent checklist to confirm with your human (read-only).

Usage: `discern setup verify [options]`

#### `discern setup begin`

Scaffold discern, record provenance, and print the setup brief (the first mutating step).

Usage: `discern setup begin [options]`

| Option                     | Description                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--name <name>`            | Project name (free text).                                                                                                                                   |
| `--slug <slug>`            | Project slug (^[a-z0-9][a-z0-9-]*$).                                                                                                                        |
| `--branch-prefix <prefix>` | Branch prefix for worktrees.                                                                                                                                |
| `--brief <brief>`          | Free-text project description, or @path to read it from a file.                                                                                             |
| `--agents <agents>`        | Comma-separated agent files to emit: claude_code, codex, gemini, cursor, copilot.                                                                           |
| `--map <path>`             | Project-relative directory for the project map — discern's agent-maintained documentation tree.                                                             |
| `--config <file>`          | JSON answers file (or - for stdin) to scaffold declaratively.                                                                                               |
| `--model <model>`          | Your self-declared provider/model identifier, or `unreported`; advisory self-reported setup provenance.                                                     |
| `--dry-run`                | Print the plan and write nothing.                                                                                                                           |
| `--reseed`                 | Run setup again and refresh discern's files and settings.                                                                                                   |
| `--allow-dirty`            | Advanced/CI: set up on the current branch as-is, skipping the clean-tree check and the isolated discern-setup branch.                                       |
| `--confirmed`              | Attest you have held the setup consent conversation with your human — required for a fresh, non-declarative begin; its absence re-serves that conversation. |

#### `discern setup step`

Re-serve one numbered step of the setup brief (read-only; for a mid-setup re-focus).

Usage: `discern setup step <n> [options]`

#### `discern setup done`

Prove the committed setup, return canonical Proof and completion inventory, and record [meta].bootstrapped.

Usage: `discern setup done [options]`

| Option       | Description                                                       |
| ------------ | ----------------------------------------------------------------- |
| `--unproven` | Record completion without Proof; setup acceptance will refuse it. |

#### `discern setup accept`

Land the proved setup branch on the trunk, then return provider activation checks.

Usage: `discern setup accept [options]`

| Option      | Description                        |
| ----------- | ---------------------------------- |
| `--dry-run` | Print the plan and change nothing. |

### `discern upgrade`

Bring this project forward to the installed discern: run pending config migrations, reconcile discern-owned config, .gitignore and .gitattributes blocks, and refresh bundled skills and instructions. Never replaces the binary. Use `discern update` to bring trunk into a task branch; use `discern refresh` to regenerate project artifacts only.

Usage: `discern upgrade [options]`

| Option          | Description                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--dry-run`     | Preview the pending migrations and skills refresh; write nothing.                                                                                                                                                        |
| `--check`       | Report pending managed-version adoption, config migrations, fixed config scaffold or managed-banner drift, and discern-owned .gitignore or .gitattributes block drift; exit non-zero for any; write nothing; no network. |
| `--allow-dirty` | Upgrade even with uncommitted changes (skips the clean-tree check).                                                                                                                                                      |

### `discern doctor`

Check the install and Git safety settings, then print each verb's execution model.

Usage: `discern doctor [options]`

| Option          | Description                                                             |
| --------------- | ----------------------------------------------------------------------- |
| `-v, --verbose` | Show the hint explaining each execution-model step (hidden by default). |

### `discern config <subcommand>`

Edit jobs, scopes, and standards with set-*; edit generated groups, checkpoints, and resources with set <dotted.key>; read or explain discern.toml.

Usage: `discern config <subcommand>`

#### `discern config set-job`

Set a gate job. Known names (format, build, lint, typecheck, test, smoke) derive their stage and accept a positional scalar or repeatable ordered --run. Custom names require --stage and --run. Known-job applicability uses --not-applicable or --applicable.

Usage: `discern config set-job <name> [command] [options]`

| Option                  | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `--stage <stage>`       | Custom jobs only: when it runs (fix\|build\|check\|test).             |
| `--run <command>`       | Literal command; repeat to preserve order.                            |
| `--provides <label>`    | Custom jobs only: free-text label.                                    |
| `--timeout <seconds>`   | Command budget in seconds; 0 removes the bound.                       |
| `--not-applicable`      | Known jobs: exclude an absent lifecycle from setup assurance.         |
| `--applicable`          | Known jobs: restore lifecycle applicability.                          |
| `--inputs <value>`      | Complete input glob; repeat for every input.                          |
| `--needs <value>`       | Required producer selector; repeat for every dependency.              |
| `--artifacts <value>`   | Output artifact path to capture; repeat for every artifact.           |
| `--environment <value>` | Environment variable name to bind to evidence; repeat for every name. |
| `--toolchain <value>`   | Toolchain identity file; repeat for every file.                       |
| `--dry-run`             | Print the edit and write nothing.                                     |

#### `discern config set-scope`

Set a scope — a named region of the repository a change can touch.

Usage: `discern config set-scope <name> <globs...> [options]`

| Option                  | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `--neutral`             | Changes here need no gate.                                            |
| `--preview <cmd>`       | A read-only command an agent can run to preview changes here.         |
| `--gate <cmd>`          | A command to run when this scope changed.                             |
| `--timeout <seconds>`   | Per-scope gate-command budget in seconds; 0 removes the bound.        |
| `--inputs <value>`      | Complete input glob; repeat for every input.                          |
| `--needs <value>`       | Required producer selector; repeat for every dependency.              |
| `--artifacts <value>`   | Output artifact path to capture; repeat for every artifact.           |
| `--environment <value>` | Environment variable name to bind to evidence; repeat for every name. |
| `--toolchain <value>`   | Toolchain identity file; repeat for every file.                       |
| `--dry-run`             | Print the edit and write nothing.                                     |

#### `discern config set-standard`

Set a quality standard — standards are numbers that can never get worse.

Usage: `discern config set-standard <name> [options]`

| Option                     | Description                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `--limit <n>`              | The floor (up) or ceiling (down).                                                                        |
| `--metric <name>`          | Metric name the run emits (default: <name>).                                                             |
| `--direction <dir>`        | Either "up" or "down".                                                                                   |
| `--run <cmd>`              | The command that emits the metric line.                                                                  |
| `--producer <selector>`    | Existing producer to consume; mutually exclusive with --run.                                             |
| `--extract <cmd>`          | Read metrics from captured producer output or an artifact on stdin.                                      |
| `--artifact <path>`        | Declared producer artifact supplied to --extract.                                                        |
| `--per <metric-or-extent>` | Denominator metric, or one built-in extent as files=<glob>, lines=<glob>, words=<glob>, or bytes=<glob>. |
| `--scale <n>`              | Multiply a rate into human units.                                                                        |
| `--margin <n>`             | Headroom left when pinning the limit.                                                                    |
| `--timeout <seconds>`      | Measurement-command budget in seconds; 0 removes the bound.                                              |
| `--inputs <value>`         | Complete input glob; repeat for every input.                                                             |
| `--needs <value>`          | Required producer selector; repeat for every dependency.                                                 |
| `--artifacts <value>`      | Output artifact path to capture; repeat for every artifact.                                              |
| `--environment <value>`    | Environment variable name to bind to evidence; repeat for every name.                                    |
| `--toolchain <value>`      | Toolchain identity file; repeat for every file.                                                          |
| `--dry-run`                | Print the edit and write nothing.                                                                        |

#### `discern config set`

Set a config key (section.key). The value's TOML type follows the schema; an array-of-strings key wraps a single value.

Usage: `discern config set <key> <value> [options]`

| Option      | Description                                           |
| ----------- | ----------------------------------------------------- |
| `--number`  | Treat the value as a number (union-typed keys only).  |
| `--bool`    | Treat the value as a boolean (union-typed keys only). |
| `--string`  | Treat the value as a string (union-typed keys only).  |
| `--dry-run` | Print the edit and write nothing.                     |

#### `discern config get`

Print a scalar config value.

Usage: `discern config get <key> [options]`

#### `discern config array`

Print an array config value, one item per line.

Usage: `discern config array <key> [options]`

#### `discern config has`

Test whether a key or section exists. Bare: print nothing and exit 0/1. JSON: report `data.present` and exit 0.

Usage: `discern config has <key> [options]`

| Option   | Description                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------- |
| `--json` | Emit a JSON result with the predicate in `data.present` and exit successfully for either Boolean value. |

#### `discern config subsections`

Print the immediate child table names under a section.

Usage: `discern config subsections <key> [options]`

#### `discern config keys`

Print the flat key names declared in a section.

Usage: `discern config keys <key> [options]`

#### `discern config explain`

Explain a config section, named-table family, or key: what it governs, why it matters, its keys and defaults, the current value, and worked examples. Works outside a project too.

Usage: `discern config explain <path> [options]`

### `discern refresh`

Refresh the agent files, skills, provider integrations, and the maintained ADR index. Use `discern update` for this branch; use `discern upgrade` for discern itself.

Usage: `discern refresh [options]`

| Option      | Description                                                                |
| ----------- | -------------------------------------------------------------------------- |
| `--dry-run` | List every refresh target and create/update/remove effect; change nothing. |

### `discern uninstall`

Remove discern's wiring from this project (keeps your discern.toml, instructions, and map).

Usage: `discern uninstall [options]`

| Option      | Description                                             |
| ----------- | ------------------------------------------------------- |
| `--dry-run` | Preview what would be removed and kept; change nothing. |
| `-y, --yes` | Skip the confirmation.                                  |

## Inspect & explore

Read-only views for you or your agent.

### `discern improvement`

Find the highest-value next improvement, with the health audit and open reviews for agent and owner to evaluate together.

Usage: `discern improvement [options]`

| Option              | Description                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `--category <name>` | Review a single area (gate, setup, instructions, map, worktrees, standards, checkpoints, skills). |
| `--min-score <n>`   | Exit non-zero when the overall score is below this floor (a CI/agent gate).                       |

### `discern standards`

Measure the named quality standards, or every configured standard when no names are given: numbers that can never get worse. `discern done` already verifies and measures them on every run. Authoring one? Hold a rate (`per`) for a number that rises as the project grows, and give a drifting total a `margin` — a ceiling pinned at today's value fails the next legitimate change.

Usage: `discern standards [names...] [options]`

| Option      | Description                                                                                                                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run` | Show the standards that would be measured; touch nothing.                                                                                                                                                                                                                         |
| `--force`   | Run standards on a dirty worktree; intended only while authoring standards.                                                                                                                                                                                                       |
| `--pin`     | Capture measured improvements for the named standards, or every one with slack. Same-commit values are reused; named measurement narrows only when gate Proof already validates the clean tree. Commit the limit change alone and carry Proof forward. Requires a clean worktree. |

#### `discern standards propose`

Finalize a proposed limit for a standard breached by this change. On a clean final HEAD, measure the named standard, then create its config-only proposal commit or renew an unchanged descendant binding. Acceptance still requires explicit approval for the value and reason.

Usage: `discern standards propose <name> [options]`

| Option              | Description                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--reason <reason>` | The exact non-empty owner-facing reason for the standard limit proposal (1-500 visible, secret-free characters). |
| `--dry-run`         | Show the proposal plan; touch nothing.                                                                           |

### `discern checkpoints`

Report the governing checkpoint policy, each open question's declaration state, and a read-only preview of what the current change would fire. Nothing runs and nothing is recorded.

Usage: `discern checkpoints [options]`

### `discern skills <subcommand>`

Manage skills: list the effective set, or eject a built-in to customize it.

Usage: `discern skills <subcommand>`

#### `discern skills list`

List the effective skills (built-ins + yours; which override which).

Usage: `discern skills list [options]`

#### `discern skills eject`

Copy a bundled built-in into [skills].dir so you can customize it.

Usage: `discern skills eject <name> [options]`

| Option      | Description                                                            |
| ----------- | ---------------------------------------------------------------------- |
| `--dry-run` | Preview every ejection and materialization target without changing it. |

### `discern impact`

Show which configured scopes the branch and working tree wake in the quality gate. Scopes are named regions of the repository with their own gate jobs.

Usage: `discern impact [options]`

| Option          | Description                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `--json`        | Emit a JSON result; `--has` reports `data.membership` and exits successfully for either Boolean value. |
| `--has <scope>` | Test one scope. Bare: print nothing and exit 0/1. JSON: report `data.membership` and exit 0.           |

### `discern coupling`

Report files that historically change together as a read-only advisory. With no args, report likely siblings missing from the change. With file, report its top partners. Add with to report commits where both changed.

Usage: `discern coupling [file] [with] [options]`

### `discern patterns`

Report the patterns in this project's discern use, read from the local logbook: validation, evidence reuse, waits, landing latency, gate fit and standard trends. Counts include observation limits. A read-only advisory.

Usage: `discern patterns [options]`

| Option                      | Description                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--stats`                   | Report practice stats instead: changes accepted, green streaks, cycle times, standards trends, and agent cohorts, counted from the same local evidence. With --json, the counts join the result as data.stats. |
| `--all`                     | Report every finding from every detector.                                                                                                                                                                      |
| `--logbook-file <filename>` | Read one sealed archive basename listed by `discern patterns archives` instead of the active logbook.                                                                                                          |

#### `discern patterns archives`

List sealed logbook archives with their event counts, date spans, and byte sizes.

Usage: `discern patterns archives [options]`

#### `discern patterns reset`

Permanently remove the active logbook after terminal confirmation. Sealed archives and other Git-admin state remain.

Usage: `discern patterns reset [options]`

| Option      | Description                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `--json`    | Preview as one result; apply is refused with `--json` or `--markdown`.      |
| `--dry-run` | Render the complete plan without requesting confirmation or changing files. |

#### `discern patterns seal`

Seal the active event history into a timestamped archive and begin a fresh active logbook after terminal confirmation.

Usage: `discern patterns seal [options]`

| Option      | Description                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `--json`    | Preview as one result; apply is refused with `--json` or `--markdown`.      |
| `--dry-run` | Render the complete plan without requesting confirmation or changing files. |

### `discern map`

Browse the configured project map that coding agents maintain, or read a named map page.

Usage: `discern map [target] [options]`

| Option             | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `--raw`            | Print a doc's pristine Markdown source instead of rendering it.             |
| `--list`           | Print a plain table of contents and exit without interaction.               |
| `--search <query>` | Search the map with task language or exact text; use a target to narrow it. |
| `--pager`          | Open rendered documents in an external pager (uses $PAGER or less -R).      |
| `--dir <path>`     | Map directory to browse (default: the project's [map].dir).                 |
| `--width <cols>`   | Wrap width for rendered output.                                             |
| `--export <scope>` | Concatenate Markdown: public, all, select, or a configured scope name.      |
| `--output <path>`  | Write an export to a file instead of stdout.                                |

### `discern docs`

Browse the complete bundled product manual, or read a named manual page.

Usage: `discern docs [target] [options]`

| Option             | Description                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `--raw`            | Print a doc's pristine Markdown source instead of rendering it.                                              |
| `--list`           | Print a plain table of contents and exit without interaction.                                                |
| `--search <query>` | Search the manual with task language or exact text; use a target to narrow it.                               |
| `--adr`            | Browse this project's decision records, or show their published location when local records are unavailable. |
| `--pager`          | Open rendered documents in an external pager (uses $PAGER or less -R).                                       |
| `--width <cols>`   | Wrap width for rendered output.                                                                              |
| `--export <scope>` | Concatenate Markdown to stdout: public.                                                                      |
| `--output <path>`  | Write an export to a file instead of stdout.                                                                 |

### `discern help`

Show command-line help.

Usage: `discern help [command...] [options]`

### `discern licenses`

Print discern's licenses and bundled third-party software notices.

Usage: `discern licenses [options]`

### `discern releases`

Open release information in the browser, sending this process's version to discern.sh. Always print the URL; never fetch or install.

Usage: `discern releases [options]`

| Option      | Description                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| `--dry-run` | Show the release handoff without opening a browser or recording a timestamp. |

### `discern mcp`

The stdio MCP server, exposing the verbs to an agent as tools. You don't usually need to run this; agents should connect automatically.

Usage: `discern mcp [options]`

| Option                | Description                                                                |
| --------------------- | -------------------------------------------------------------------------- |
| `--long-tool-calls`   | Use the long-call transport profile; await calls may run for 3300 seconds. |
| `--strict-tool-calls` | Use the strict transport profile; await calls may run for 45 seconds.      |

## Help, version, and parser-owned flags

No project setup is required to read help or the version. The command parser owns command usage, argument validation, aliases, and option help. `discern <command> --help` and `discern help <command>` read the same command tree as this page.

| Spelling          | Scope         | Meaning                                                 |
| ----------------- | ------------- | ------------------------------------------------------- |
| `-h`, `--help`    | Every command | Show command help and exit without running the command. |
| `-V`, `--version` | Root only     | Show the installed discern version and exit.            |

Options after an exec-style boundary, including `discern queue --` and a project script name, belong to the child command rather than discern.

## Interactive documentation reader

Bare `discern docs` on an interactive terminal opens the grouped documentation reader. The picker searches document titles and paths. `discern map` uses the same reader for the configured project map.

| Context       | Input                            | Contract                                                                                     |
| ------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| Picker        | Type text                        | Filter the grouped document titles and paths.                                                |
| Picker        | `Up`, `Down`, `Ctrl-P`, `Ctrl-N` | Move one selectable entry. With no document open, `Tab` and `Shift-Tab` also move one entry. |
| Picker        | `Page Up`, `Page Down`           | Move by one visible picker page.                                                             |
| Picker        | `Home`, `End`                    | Move to the first or last selectable entry.                                                  |
| Picker        | `Enter`                          | Open the selected document or run the selected action.                                       |
| Picker        | `Escape`, `Ctrl-C`, end of input | Leave the reader without changing project state.                                             |
| Open document | `Tab`, `Shift-Tab`               | Move focus between the picker and document panes.                                            |
| Open document | `Up`, `Down`, `Ctrl-P`, `Ctrl-N` | Scroll the document by one rendered row.                                                     |
| Open document | `Page Up`, `Page Down`           | Scroll by one visible document page.                                                         |
| Open document | `Home`, `End`                    | Jump to the start or end of the document.                                                    |
| Open document | `[`, `]`                         | Focus the previous or next addressable link.                                                 |
| Focused link  | `Enter`                          | Follow the link. `Escape` clears link focus and returns to scrolling.                        |
| Open document | `Escape`, `q`                    | Close the document and retain the picker query and selection.                                |

Admitted relative-document links and heading fragments stay inside the reader. Absolute `http://` and `https://` destinations open in the system browser only after discern restores the terminal. Other external schemes are not supported.

With mouse tracking available, the wheel moves three picker entries or three document rows under the pointer. A left click focuses a pane and selects a picker entry; clicking a link follows it. Other mouse buttons and releases have no product action. Use the terminal application's own selection modifier to select terminal text while tracking is active; discern does not define that modifier.

The rich reader requires ANSI terminal control and at least 32 columns. With the default three chrome rows, the picker-only layout needs 10 total rows, document-only needs 11, and the split layout begins at 18. Between those bounds, the focused pane occupies all usable rows.

If the rich reader cannot start because ANSI control is unavailable or the terminal is too small, discern uses the sequential picker. An internally rendered document then waits at the exact prompt `Press Enter to continue.` and the next picker restores the remembered document selection. `--pager` selects this sequential flow and hands each document to `$PAGER`, or `less -R` when `$PAGER` is unset, when the pager succeeds.

A direct `discern docs <target>` renders and exits without waiting. Bare `discern docs` off a terminal prints the table of contents and never requests input. `--list`, `--json`, and `--raw` never enter the reader; `--search` prints matches. Export writes or returns one Markdown stream, except `--export select` can request a selection on an interactive terminal.

The implementation and real-terminal contract are public in [`src/commands/docs.ts`](https://github.com/jackwh/discern/blob/main/src/commands/docs.ts) and [`tests/docs_test.ts`](https://github.com/jackwh/discern/blob/main/tests/docs_test.ts).

## Exit behavior

| Exit status         | Contract                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `0`                 | The command completed successfully. A bare predicate exits `0` when true.                                               |
| `1`                 | A controlled failure or refusal, a false bare predicate, or an unmet enforcement threshold.                             |
| `2`                 | The command grammar or arguments were invalid, including a bare quiet-result invocation.                                |
| `70`                | discern crashed on an unexpected internal error.                                                                        |
| `124`               | `discern await` reached its call budget before the watched condition held; its result includes the continuation handle. |
| `127`               | A child executable selected by an exec-style boundary could not be started.                                             |
| `129`               | An interrupted run preserved the conventional status derived from SIGHUP.                                               |
| `130`               | An interrupted run preserved the conventional status derived from SIGINT.                                               |
| `143`               | An interrupted run preserved the conventional status derived from SIGTERM.                                              |
| Child status        | `discern queue -- <command>` and `discern scripts <name>` preserve a started child's own exit status.                   |
| Other signal status | A platform-reported child signal preserves its conventional signal status when available.                               |

Quiet JSON and Markdown results evaluate their completion policy before choosing the controlled exit status. Predicate result modes exit `0` and place the boolean in `data`; bare predicates use `0` or `1`.

For result-envelope fields and Model Context Protocol delivery, see [MCP and results](mcp-and-results.md). For symptom-led recovery, see [Troubleshooting](../40-troubleshooting/README.md).
