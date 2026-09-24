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

`discern <command> --help` shows the same command options in your terminal. Help works before project setup; commands that need a configured project return `setup_unfinished` until setup is complete.

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

| Option            | Description                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--json`          | Print the result as one JSON document on stdout.                                                                                                                                                                          |
| `--markdown`      | Print the result as one Markdown document on stdout.                                                                                                                                                                      |
| `--render`        | Print the Markdown result formatted for the terminal.                                                                                                                                                                     |
| `--no-color`      | Turn off color. discern also leaves color off when `NO_COLOR` is set to any non-empty value, when `TERM` is `dumb`, or when output isn't a terminal.                                                                      |
| `--plain`         | Turn off prompts, paging, the full-screen reader, and live progress, and print static output. discern also skips prompts in CI, with `--json`, `--markdown`, or `--render`, and when input or output isn't a terminal.    |
| `--theme <theme>` | Choose colors for a `light` or `dark` terminal, or `auto`. Default: `auto`, which asks an interactive terminal for its background color and assumes dark when it can't tell. `--no-color` and `NO_COLOR` skip that check. |

## Your desk

You use these in an interactive terminal.

### `discern desk`

Open the desk, your interactive view of every task in this project. From the desk you can start tasks and agents, run project scripts, review changes and Proof, land work or pre-approve it, and clean up worktrees. Run it from the main checkout; bare `discern` opens it too. It needs an interactive terminal. To list worktrees from a script, use `discern status --all --json`.

Usage: `discern desk [options]`

### `discern enter`

Open a shell in another worktree, in the same folder you're in now. Pick the main checkout or a worktree from the list, and exit the shell to return. If that folder doesn't exist there, the shell opens in the nearest one that does. It changes nothing and needs an interactive terminal. To list worktrees from a script, use `discern status --all --json`.

Usage: `discern enter [options]`

## Agentic loop

Your coding agent runs these as it works.

### `discern status`

Show where this checkout stands and what to do next. It runs no checks, tests, or measurements, and changes nothing in your project. From the main checkout, it also lists the task worktrees.

Usage: `discern status [options]`

| Option          | Description                                                                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--all`         | Also list every worktree when you run it from a task worktree. You can't combine it with `--local`.                                                                                                                              |
| `--local`       | Show only this checkout, even in the main checkout.                                                                                                                                                                              |
| `-v, --verbose` | Show everything: each worktree in full, its evidence, the configured checks, landing history, and full Proof pages. With `--json`, return the complete status instead of the shorter summary; full Proof pages stay out of JSON. |

### `discern prepare`

Run the quick checks while you work: fix and regenerate files, then run the read-only checks, without tests. In order, it runs the fix jobs, such as the formatter, the `[generated]` commands, and `discern refresh`, then the check jobs, such as lint and type-check. It works on uncommitted changes, may change files, and never commits. It skips build and test jobs, scope gates, and standards, and records no Proof. Run it before your final commit, so `discern done` has nothing left to rewrite.

Usage: `discern prepare [options]`

### `discern done`

Run the gate on a clean, committed tree and record Proof when it passes. The gate is your project's full quality check: the jobs it configures, such as format, lint, type-check, and tests. Uncommitted or untracked files stop it before anything runs. Its fixers may change files, and a change to a committed file fails the run without committing anything, so run `discern prepare` and commit first. discern asks any checkpoint questions before the checks run. If current Proof already covers this commit, `done` returns it without running the checks again.

Usage: `discern done [options]`

| Option                | Description                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`           | Show which checks, jobs, and scope gates would run, without running them. It still needs a committed tree.                                                                                                          |
| `--policy-base <ref>` | For a CI report, with `--ci` and `--standalone`: judge the change against the settings in this fetched commit instead of the trunk's current tip.                                                                   |
| `--standalone`        | Run every check for feedback, even with uncommitted changes. discern records no Proof and no results it can reuse.                                                                                                  |
| `--rerun`             | Run the checks again even when current passing Proof covers this commit, or retry a failure on unchanged code. discern records the rerun, and the newest result wins.                                               |
| `--ci`                | For continuous integration: run the checks and list any checkpoint questions, without waiting for or recording answers. Its Proof can't be used to land.                                                            |
| `--met <id>`          | Answer a checkpoint question as met, as your recorded judgment (repeatable). It applies only to a question this worktree is waiting on. Once every waiting question has an answer, the checks run in the same call. |
| `--unmet <id>`        | Answer one checkpoint question as unmet, with `--why`. The checks still run, but landing then needs the owner to approve a variance.                                                                                |
| `--why <rationale>`   | Why the question isn't met, for `--unmet`: one paragraph of 1–500 characters, without line breaks or control characters. The Proof keeps it, as written, for the owner's landing decision.                          |

### `discern test`

Run your project's tests on their own, without the rest of the gate. It runs every test-stage job, such as `test` and `smoke`, and waits for a free test-run slot first. It works on uncommitted changes and records no Proof. You don't need it before `discern done`, which runs the tests itself.

Usage: `discern test [options]`

### `discern progress`

Check on a long operation, such as `discern done`, after losing track of it. It shows the operation's current phase, the counts and failures so far, and its result once it finishes. Pass the progress handle that an MCP call announced or `discern status` shows; without one, it reads this checkout's latest operation. It changes nothing and never reruns the operation.

Usage: `discern progress [handle] [options]`

### `discern queue`

Run a command, such as a test suite, once a test-run slot is free, so parallel tasks don't overload this machine. `[gate].concurrent_test_runs` sets how many slots every checkout shares. Outside a project, or when that setting is 0, the command runs straight away. discern runs it directly, not through a shell, and passes its output and exit status through unchanged. Everything after `--` belongs to the command, and there's no `--json`, `--markdown`, or `--render` form. To wait for another task instead, use `discern await`.

Usage: `discern queue -- <command> [args...]`

### `discern tidy`

Format the files discern manages: the map, the TODO list, your instruction files, and `discern.toml`. Pass `md` or `toml` to format one kind; leave it out for both. It also checks that box-drawing diagrams in code blocks stay aligned: a misaligned diagram fails the run without stopping the formatting, and a fence marked `freeform` is skipped. If any file can't be parsed, such as Markdown with invalid YAML frontmatter, or formatting would drop cells from a table row, discern changes no files at all. Escape a pipe inside a code span as `\|` to keep its cell.

Usage: `discern tidy [type] [options]`

| Option      | Description                                              |
| ----------- | -------------------------------------------------------- |
| `--dry-run` | List the files that would change, without changing them. |

## Worktree lifecycle

Your agent starts, updates, and lands each task with these.

### `discern start`

Create a worktree for a new task: a separate checkout on its own branch, started from the trunk, your project's shared branch. Run it from the main checkout. discern sets the worktree up, including its resources and setup commands, then prints its path. Uncommitted work in the main checkout stays where it is.

Usage: `discern start [options]`

| Option            | Description                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`       | Show what `start` would create, without creating anything. The real run picks a new id.                                                              |
| `--name <name>`   | Name the task. discern keeps your text as the title and derives the worktree id from it. Without `--name` or `--title`, the id is a random codename. |
| `--title <title>` | Set a display title that differs from `--name`. Without `--name`, discern derives the id from the title.                                             |
| `--brief <brief>` | Save a one-line description of the task, shown in task details and when an agent starts on it.                                                       |
| `--from <source>` | Start from something other than the trunk: a branch, tag, commit, or another worktree's id or path. To resume a parked task, pass its branch.        |

### `discern update`

Merge the latest trunk, your project's shared branch, into this branch, and refresh what depends on it. For a newer discern, use `discern upgrade`; for agent files alone, use `discern refresh`. Run it in a task worktree with no uncommitted changes to tracked files. discern settles conflicts in generated files by regenerating them; any other conflict stops the merge and leaves your files as they were. Then it reruns the generators, refreshes agent files, and runs the `ensure` commands, even when there was nothing to merge. It lists the files both sides changed, so you can re-read them.

Usage: `discern update [options]`

| Option            | Description                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`       | Show what the update would bring in and change, without changing anything.                                                                     |
| `--from <source>` | Merge something other than the trunk: a branch, tag, commit, or another worktree's id or path. Use it to build on work that hasn't landed yet. |

### `discern await`

Wait for another task: until its work passes the gate, until it lands, or until the trunk moves. By default it waits up to 3300 seconds and returns as soon as the condition holds. If time runs out first, it exits with status 124 and returns a short handle; pass it to `--resume` to keep waiting for the same thing. It doesn't change any work, and it blocks only the command that called it. To wait for a free test-run slot before running a command, use `discern queue -- <command> [args...]` instead.

Usage: `discern await [options]`

| Option                | Description                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--green <worktree>`  | Wait until that task's worktree has a current, passing Proof. Name it by worktree id, path, local branch, or full local ref. Its landing also counts. |
| `--landed <worktree>` | Wait until that task's work reaches the trunk. Name it by worktree id, path, local branch, or full local ref.                                         |
| `--trunk-moved`       | Wait until the trunk moves from where it was when the wait began.                                                                                     |
| `--resume <handle>`   | Keep waiting for an earlier wait's condition, using the handle it returned. Don't add a condition option.                                             |
| `--timeout <seconds>` | How many seconds to wait before answering "not yet". Default: up to 3300. It returns early once the condition holds; 0 checks once without waiting.   |

### `discern accept`

Land this worktree's proven commit on the trunk, your project's shared branch. A proven commit is one that `discern done` passed. It lands only with the owner's approval in this conversation or a recorded grant; otherwise discern records it in the landing queue for the owner. If the trunk moved since the Proof, discern checks the combined code in a temporary integration worktree and lands exactly what passed. A second `accept` waits its turn. After landing, discern removes the worktree, its resources, and its branch, unless the branch has newer commits or the checkout has uncommitted changes. `discern accept queue` adds the commit to the landing queue without landing it. `discern accept emergency --reason <text>` starts an emergency landing of a repair whose checks haven't passed: it needs the owner's fresh, explicit approval and issues no passing Proof.

Usage: `discern accept [action] [options]`

| Option                            | Description                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--dry-run`                       | Show the landing plan without landing or recording anything. From the main checkout without `--target`, list the landing queue.                                                                                                                                                                                                |
| `--target <effort>`               | Choose the task by id, path, or branch, from any checkout. From the main checkout, it's required. After that task lands, discern lands the rest of the queue in order, each under its own recorded grant. With `accept queue`, add the task's proven commit to the queue instead.                                              |
| `--prepare`                       | Emergency only: answer checkpoint questions before an emergency landing. discern runs the checkpoint triggers and keeps the evidence for review, but runs no checks and lands nothing. Needs `--reason`.                                                                                                                       |
| `--preparation-receipt <receipt>` | Emergency only: the receipt `--prepare` returned for this repair and trunk.                                                                                                                                                                                                                                                    |
| `--met <id>`                      | Answer a checkpoint question as met (repeatable): a question about the combined code, with `--composition-receipt`, or an emergency question, with `accept emergency --prepare`.                                                                                                                                               |
| `--unmet <id>`                    | Answer one checkpoint question about the combined code as unmet, with `--why` and `--composition-receipt`. discern still checks the combined code; landing then needs the owner's variance.                                                                                                                                    |
| `--why <rationale>`               | Why the question isn't met, for `--unmet`, in one paragraph.                                                                                                                                                                                                                                                                   |
| `--composition-receipt <receipt>` | The receipt that came with a question about the combined code. Pass it with `--met`, `--unmet`, or `--variance` so your answer applies to that exact combination. If discern has replaced the combination, it refuses the old receipt and asks its own question again.                                                         |
| `--reason <text>`                 | Emergency only: why the repair must land before its checks pass. The owner reviews it, and the approval token is tied to it.                                                                                                                                                                                                   |
| `--approval-token <token>`        | Emergency only: the preview token the owner approved, with `--confirmed`. It's valid only briefly, and only while the repair, trunk, and reason stay the same.                                                                                                                                                                 |
| `--recover <id>`                  | Emergency only: finish an interrupted emergency landing, named by its landing id. discern records whether the trunk moved and cleans up; it lands nothing new and needs no new approval.                                                                                                                                       |
| `--confirmed`                     | Record that the owner approved this landing in the current conversation. It covers only the selected landing. discern checks standing and task grants on its own. Approval given for an interrupted landing covers only finishing that landing. Without approval or a grant, discern lands nothing; `--dry-run` needs neither. |
| `--variance <id>`                 | Record that the owner approved landing despite this unmet checkpoint answer, without changing it (repeatable; needs `--confirmed`). The ids must match the current unmet answers exactly. No recorded grant can approve a variance.                                                                                            |
| `--approve-standard <token>`      | Record that the owner approved a proposed standard limit (repeatable; needs `--confirmed`). Use the token from the refusal or the emergency plan: it binds one standard, value, and reason, and the tokens must match the current proposals exactly. No grant can approve a limit change.                                      |

### `discern worktree <subcommand>`

Manage worktrees: separate checkouts, each on its own branch, for one task.

Usage: `discern worktree <subcommand>`

#### `discern worktree setup`

Set up this worktree, or bring its setup up to date. `discern start` runs it for you. The first run creates the worktree's resources, env values, and port, and runs its one-time setup steps. Later runs check the resources and rerun the `ensure` commands. Run it inside the worktree. If a setup step was interrupted, it stops and shows how to recover.

Usage: `discern worktree setup [options]`

| Option                      | Description                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`                 | Show the setup plan without changing anything.                                                                                                       |
| `--mark-step-complete <id>` | Recover an interrupted setup step that you've checked finished: mark it done without running it again. Needs `--confirmed`.                          |
| `--retry-step <id>`         | Recover an interrupted setup step by running it again. Needs `--confirmed`.                                                                          |
| `--confirmed`               | Record that the owner checked what the interrupted step left behind and chose this recovery. Required with `--mark-step-complete` or `--retry-step`. |

#### `discern worktree ensure`

Make sure this worktree is set up; it's safe to run any number of times. Coding agents' session-start hooks run it. In a worktree that isn't set up yet, it runs the full setup. In one that is, it checks the resources and reruns the `ensure` commands, and a failure never blocks the session. In the main checkout it changes nothing and reminds the agent to start a worktree before editing.

Usage: `discern worktree ensure [options]`

#### `discern worktree rename`

Change this worktree's title. Its id, branch, path, brief, and starting point stay the same.

Usage: `discern worktree rename <title> [options]`

| Option      | Description                        |
| ----------- | ---------------------------------- |
| `--dry-run` | Show the change without making it. |

#### `discern worktree teardown`

Remove this worktree's resources, such as its database, and keep everything else. The checkout, branch, and Proof stay. Run it inside the worktree. To remove the worktree as well, use `discern worktree drop` from the main checkout.

Usage: `discern worktree teardown [options]`

| Option      | Description                                            |
| ----------- | ------------------------------------------------------ |
| `--dry-run` | Show what would be removed, without removing anything. |

#### `discern worktree park`

Set a task aside: remove its checkout and resources, and keep its branch, title, and brief so you can resume it. Run it from the main checkout. The worktree must have no uncommitted or untracked changes. Parking also removes the task's Proof, grant, and landing-queue entry. Resume with `discern start --from <branch>`. Name the worktree by id, path, local branch, or full local ref.

Usage: `discern worktree park <worktree> [options]`

| Option      | Description                                                |
| ----------- | ---------------------------------------------------------- |
| `--dry-run` | Show what parking would remove, without changing anything. |

#### `discern worktree drop`

Delete a worktree, its resources, and its branch. Run it from the main checkout. discern refuses when the worktree has uncommitted changes or commits that aren't on the trunk, unless you pass `--force`, and it never drops a locked worktree. It first saves the branch's last commit to a recovery ref and prints it. It deletes the branch only if discern created it. Name the worktree by id, path, local branch, or full local ref.

Usage: `discern worktree drop <worktree> [options]`

| Option      | Description                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `--force`   | Drop the worktree even when it has uncommitted changes or commits that aren't on the trunk. Uncommitted work is lost for good. |
| `--dry-run` | Show what would be removed, without removing anything.                                                                         |

#### `discern worktree prune`

Clean up what finished work leaves behind: landed worktrees and their branches, stale records, folders that reappeared, and orphaned resources. discern removes only what it can show it created, such as a clean worktree whose branch is fully merged. Commits that haven't landed stay on their branches. Run it from the main checkout; it asks before changing anything unless you pass `--yes`.

Usage: `discern worktree prune [options]`

| Option        | Description                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `-y, --yes`   | Skip the confirmation. Required without an interactive terminal.                                     |
| `--contained` | Also remove clean, idle worktrees whose commits are all on another live branch. Their branches stay. |
| `--dry-run`   | List what would be removed, without removing anything or asking.                                     |

### `discern identity`

Print a stable value discern derives for a checkout's branch, development host, port, database, and external resources. Choose one value per call; the default is the id. Name another checkout by id, path, local branch, or full local ref; the default is the checkout you're in.

Usage: `discern identity [worktree] [options]`

| Option              | Description                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `--id`              | Print the checkout's id (the default).                                                                |
| `--site`            | Print its development-server host name, safe to use in a web address.                                 |
| `--branch`          | Print its branch name.                                                                                |
| `--port`            | Print its stable development-server port. discern doesn't reserve the port.                           |
| `--db`              | Print a name for it that's safe to use as a database name.                                            |
| `--seed`            | Print its stable seed for ordering tests.                                                             |
| `--worktree`        | Print its resource handle: a stable name, starting with the project slug, for its external resources. |
| `--resource <name>` | Print the stable external name of one declared resource.                                              |
| `--resources`       | Print every declared resource as `name=handle` lines.                                                 |

## Project Scripts

Your project's own scripts, listed or run by name.

### `discern scripts`

List your project's scripts, or run one by name. discern looks the name up as written, with no partial matches. It runs the script from the project root with `DISCERN_ROOT`, `DISCERN_TOML`, `DISCERN_SCRIPTS_DIR`, and `DISCERN_TRUNK` set, passes every following argument through unchanged, and returns its exit status.

Usage: `discern scripts [name] [args...] [options]`

## Setup & maintenance

You or your agent set up, check, and look after discern.

### `discern setup <subcommand>`

Start here to set up discern: see what setup involves and which step comes next. It changes nothing, and it works even outside a Git repository. Run `discern setup begin` only once the owner is ready for discern to add its files.

Usage: `discern setup <subcommand>`

#### `discern setup verify`

Preview what setup will change, and the checklist to agree with the owner first. It changes nothing. It reports what it finds, such as existing agent instructions and the coding agents installed here, and where worktrees will go. Then it prints the consent checklist your agent goes through with the owner before anything is written.

Usage: `discern setup verify [options]`

#### `discern setup begin`

Set discern up in this project: add its files and settings, and print the setup brief for your agent. This is the first setup step that changes files. A fresh setup starts on the trunk with no uncommitted changes to tracked files. It works on a new `discern-setup` branch, commits discern's own wiring, and records which discern version and model ran it. Without `--confirmed` or `--config`, it writes nothing and shows the consent checklist again. Partway through setup, it prints the brief again; once setup is complete, it does nothing unless you pass `--reseed`.

Usage: `discern setup begin [options]`

| Option                     | Description                                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--name <name>`            | The project's display name, in any words. Default: the current folder's name.                                                                                                                                                                                     |
| `--slug <slug>`            | A short id for the project, used in each worktree's site, database, and resource names: lowercase letters, digits, and dashes, starting with a letter or digit (`^[a-z0-9][a-z0-9-]*$`). Default: derived from the name.                                          |
| `--branch-prefix <prefix>` | The prefix for task branch names. Default: `agent/`.                                                                                                                                                                                                              |
| `--brief <brief>`          | What the project is, in your own words, or `@path` to read it from a file. discern saves it as the project brief.                                                                                                                                                 |
| `--agents <agents>`        | Which coding agents to set up, separated by commas: claude_code, codex, gemini, cursor, copilot. Default: the agents installed on this machine, or claude_code and codex when none are found. An empty value sets up none.                                        |
| `--map <path>`             | Where to keep the project map, the documentation your agents maintain, relative to the project root. Default: `discern/map`.                                                                                                                                      |
| `--config <file>`          | Read the setup answers from a JSON file, or `-` for stdin, instead of from the conversation. The file can also fill `discern.toml` sections such as jobs and scopes; options you pass win over it.                                                                |
| `--model <model>`          | The provider and model running setup, as you'd name them, or `unreported`. discern records it for support and can't verify it.                                                                                                                                    |
| `--dry-run`                | Show the plan without writing anything.                                                                                                                                                                                                                           |
| `--reseed`                 | Run setup again on a project that has it: add any missing starter files, without overwriting existing ones, and refresh discern's settings and generated files.                                                                                                   |
| `--allow-dirty`            | For CI and advanced use: set up on the current branch as it is, even with uncommitted changes. discern skips the `discern-setup` branch and its own commit and needs no `--confirmed`; you commit and merge yourself, since `discern setup accept` won't land it. |
| `--confirmed`              | Record that the owner agreed to setup in this conversation. A fresh setup needs it unless you use `--config`; without it, discern writes nothing and shows the consent checklist again.                                                                           |

#### `discern setup step`

Show one numbered step of the setup brief again, to refocus partway through setup. It changes nothing.

Usage: `discern setup step <n> [options]`

#### `discern setup done`

Finish setup: run the gate on the committed setup, record its Proof and a summary of what was set up, and mark setup complete (`[meta].bootstrapped`). Everything must be committed, with every setup placeholder filled in. discern commits the completion, checks it in a temporary worktree, and runs the full gate; if that fails, it removes its own commit. Then `discern setup accept` lands the setup.

Usage: `discern setup done [options]`

| Option       | Description                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--unproven` | Mark setup complete without the checks or Proof. `discern setup accept` then refuses to land it; running `discern setup done` again later proves it. |

#### `discern setup accept`

Land the proven setup branch on the trunk, then list the checks that confirm each coding agent can reach discern. Run it from the `discern-setup` branch. If the trunk has moved, discern merges it in and runs the gate again first. It records a Proof note, switches you to the trunk, and deletes the setup branch. It doesn't push.

Usage: `discern setup accept [options]`

| Option      | Description                                                            |
| ----------- | ---------------------------------------------------------------------- |
| `--dry-run` | Show the plan without changing anything. It still needs a valid Proof. |

### `discern upgrade`

Bring this project up to date with the discern you have installed. To bring the trunk into a task branch, use `discern update`; to regenerate agent files only, use `discern refresh`. It runs any pending config migrations and restores discern's sections, keys, and comment banners in `discern.toml` without touching your values. It updates discern's blocks in `.gitignore` and `.gitattributes`, and refreshes agent files, skills, and integrations. Run it from the project root. It never installs a newer discern, uses no network, and doesn't commit.

Usage: `discern upgrade [options]`

| Option          | Description                                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run`     | Show the pending migrations and changes without writing anything.                                                                                                                                                                                                                                                                                                                      |
| `--check`       | Check whether this project needs an upgrade, without writing anything or using the network. It exits non-zero when config migrations are pending, when the project hasn't adopted this discern version, when `discern.toml` is missing a section or key discern ships or has an outdated comment banner, or when discern's blocks in `.gitignore` or `.gitattributes` are out of date. |
| `--allow-dirty` | Upgrade even when tracked files have uncommitted changes.                                                                                                                                                                                                                                                                                                                              |

### `discern doctor`

Check that discern is installed correctly and that Git is set up safely for it. It checks the config, jobs, generated groups, agent integrations, skills, worktree resources, and logbook, and Git settings such as commit identity and history retention. Then it lists the steps each workflow command runs. It changes nothing, and exits 1 only when a check fails.

Usage: `discern doctor [options]`

| Option          | Description                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `-v, --verbose` | Explain each step the workflow commands run. With `--json`, include those steps in the result. |

### `discern config <subcommand>`

Read, explain, and edit `discern.toml`, keeping its comments. `set-job`, `set-scope`, and `set-standard` edit those tables; `set <dotted.key>` edits other keys, such as generated groups, checkpoints, and resources. discern checks each edit against the schema, writes nothing if the result would be invalid, and never commits. Run edits from the project root.

Usage: `discern config <subcommand>`

#### `discern config set-job`

Add or change a gate job: one of the commands the gate runs. A known name (format, build, lint, typecheck, test, smoke) has a fixed stage: give its command as the argument, or with `--run`, repeated for commands that run in order. A custom name needs `--stage` and `--run`. For a known job this project doesn't have, use `--not-applicable`.

Usage: `discern config set-job <name> [command] [options]`

| Option                  | Description                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--stage <stage>`       | Custom jobs only: the stage it runs in, `fix`, `build`, `check`, or `test`.                                                                    |
| `--run <command>`       | A command to run, as written. Repeat it for more commands; they run in order, each only if the previous one succeeded.                         |
| `--provides <label>`    | Custom jobs only: a short label saying what the job provides.                                                                                  |
| `--timeout <seconds>`   | Time limit for the job, in seconds; 0 means no limit. Default: `[gate].timeout`.                                                               |
| `--not-applicable`      | Known jobs: record that this project has no such step, so setup doesn't count it as missing. The gate's jobs don't change.                     |
| `--applicable`          | Known jobs: undo `--not-applicable`, so setup counts the job again.                                                                            |
| `--inputs <value>`      | A file pattern the job reads. Repeat it until every input is listed; discern can then reuse an earlier result while those files are unchanged. |
| `--needs <value>`       | Another job, scope gate, or standard that must succeed first, such as `jobs.build`. Repeat it for each one.                                    |
| `--artifacts <value>`   | A file the job produces, which discern keeps for later steps to read. Repeat it for each one.                                                  |
| `--environment <value>` | An environment variable that affects the result; a changed value stops discern reusing an earlier result. Repeat it for each one.              |
| `--toolchain <value>`   | A file that pins tool versions, such as a lockfile; a change to it stops discern reusing an earlier result. Repeat it for each one.            |
| `--dry-run`             | Show the edit without writing it.                                                                                                              |

#### `discern config set-scope`

Add or change a scope: a named region of the repository, defined by path patterns. The patterns you give replace the scope's `paths`, and options you leave out keep their current values.

Usage: `discern config set-scope <name> <globs...> [options]`

| Option                  | Description                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--neutral`             | Mark changes here as not code, as for documentation: they trigger no scope gate, and this scope's own gate never runs.                                  |
| `--preview <cmd>`       | A read-only command your agent can run to preview changes here. discern suggests it but never runs it.                                                  |
| `--gate <cmd>`          | A command `discern done` runs when a change touches this scope.                                                                                         |
| `--timeout <seconds>`   | Time limit for the scope's gate command, in seconds; 0 means no limit.                                                                                  |
| `--inputs <value>`      | A file pattern the scope's gate reads. Repeat it until every input is listed; discern can then reuse an earlier result while those files are unchanged. |
| `--needs <value>`       | A job, scope gate, or standard that must succeed before the scope's gate, such as `jobs.build`. Repeat it for each one.                                 |
| `--artifacts <value>`   | A file the scope's gate produces, which discern keeps for later steps to read. Repeat it for each one.                                                  |
| `--environment <value>` | An environment variable that affects the result; a changed value stops discern reusing an earlier result. Repeat it for each one.                       |
| `--toolchain <value>`   | A file that pins tool versions, such as a lockfile; a change to it stops discern reusing an earlier result. Repeat it for each one.                     |
| `--dry-run`             | Show the edit without writing it.                                                                                                                       |

#### `discern config set-standard`

Add or change a standard: a limit on a measured number, such as test coverage, that the gate holds. Give exactly one of `--run` or `--producer`.

Usage: `discern config set-standard <name> [options]`

| Option                     | Description                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--limit <n>`              | The limit: a floor when `--direction` is `up`, a ceiling when it's `down`.                                                                                  |
| `--metric <name>`          | The metric name the measurement prints. Default: the standard's name.                                                                                       |
| `--direction <dir>`        | `up` when higher is better, `down` when lower is better.                                                                                                    |
| `--run <cmd>`              | The command that measures the metric and prints its `DISCERN_METRIC <metric> <number>` line.                                                                |
| `--producer <selector>`    | Measure from an existing job, scope gate, or standard, such as `jobs.test`, instead of `--run`.                                                             |
| `--extract <cmd>`          | A command that reads the metric from the producer's output, or from `--artifact`, on stdin.                                                                 |
| `--artifact <path>`        | A file the producer lists in its artifacts, passed to `--extract` on stdin.                                                                                 |
| `--per <metric-or-extent>` | Hold a rate: divide by another metric, or by a count discern takes itself: `files=<glob>`, `lines=<glob>`, `words=<glob>`, or `bytes=<glob>`.               |
| `--scale <n>`              | Multiply a `--per` rate into readable units: 1000 gives a rate per 1,000. Default: 1.                                                                       |
| `--margin <n>`             | Headroom `discern standards --pin` keeps when it tightens the limit. Default: 0.                                                                            |
| `--timeout <seconds>`      | Time limit for the measuring command, in seconds; 0 means no limit.                                                                                         |
| `--inputs <value>`         | A file pattern the measurement reads. Repeat it until every input is listed; discern can then reuse an earlier measurement while those files are unchanged. |
| `--needs <value>`          | A job, scope gate, or standard that must succeed before the measurement, such as `jobs.build`. Repeat it for each one.                                      |
| `--artifacts <value>`      | A file the measuring command produces, which discern keeps for `--extract` to read. Repeat it for each one.                                                 |
| `--environment <value>`    | An environment variable that affects the result; a changed value stops discern reusing an earlier measurement. Repeat it for each one.                      |
| `--toolchain <value>`      | A file that pins tool versions, such as a lockfile; a change to it stops discern reusing an earlier measurement. Repeat it for each one.                    |
| `--dry-run`                | Show the edit without writing it.                                                                                                                           |

#### `discern config set`

Set one key in `discern.toml`, named as `section.key`, including keys in named tables. discern takes the value's type from the schema, and turns a single value into a one-item list for a key that takes a list of strings. It refuses sections, unknown keys, and retired names, and writes nothing if the result would be invalid.

Usage: `discern config set <key> <value> [options]`

| Option      | Description                                                                  |
| ----------- | ---------------------------------------------------------------------------- |
| `--number`  | Treat the value as a number, for a key that accepts more than one type.      |
| `--bool`    | Treat the value as true or false, for a key that accepts more than one type. |
| `--string`  | Treat the value as text, for a key that accepts more than one type.          |
| `--dry-run` | Show the edit without writing it.                                            |

#### `discern config get`

Print one value as it's written in `discern.toml`, such as `repository.trunk`. It fails for a key the file doesn't set; use `discern config has` to check first.

Usage: `discern config get <key> [options]`

#### `discern config array`

Print a list value from `discern.toml`, one item per line.

Usage: `discern config array <key> [options]`

#### `discern config has`

Check whether `discern.toml` sets a key or section. On its own, it prints nothing and exits 0 if it does, 1 if not. With `--json`, it reports the answer in `data.present` and exits 0.

Usage: `discern config has <key> [options]`

#### `discern config subsections`

Print the names of the tables directly under a section, such as each named table under `standards`.

Usage: `discern config subsections <key> [options]`

#### `discern config keys`

Print the names of the keys a section sets, without its nested tables.

Usage: `discern config keys <key> [options]`

#### `discern config explain`

Explain a section, a family of named tables, or one key of `discern.toml`: what it controls, why it matters, its keys and defaults, your current value, and examples. It works outside a project too.

Usage: `discern config explain <path> [options]`

### `discern refresh`

Regenerate your agent files, skills, agent integrations, and ADR index from their sources. To bring the trunk into this branch, use `discern update`; to update the project for a newer discern, use `discern upgrade`. It also updates discern's block in `.gitattributes` and discern's settings in the repository's Git config. It writes files but never commits. It never removes an agent's files, even when you drop that agent from `[project].agents`.

Usage: `discern refresh [options]`

| Option      | Description                                                                   |
| ----------- | ----------------------------------------------------------------------------- |
| `--dry-run` | List each file it would create, update, or remove, without changing anything. |

### `discern uninstall`

Remove discern's wiring from this project, and keep the files you wrote. It removes the generated agent files, installed skills, agent integrations, and discern's blocks and settings. Your `discern.toml`, instruction source, map, own skills, project scripts, and TODO list stay. It asks before removing anything. It refuses while task worktrees or their resources exist. It keeps local Git refs such as Proof notes, doesn't remove the discern program, and doesn't commit.

Usage: `discern uninstall [options]`

| Option      | Description                                                                                                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run` | Show what would be removed and kept, without changing anything.                                                                                                                   |
| `-y, --yes` | Skip the confirmation. Without an interactive terminal, in CI, or with `--plain`, `--json`, `--markdown`, or `--render`, uninstall needs it whenever there's something to remove. |

## Inspect & explore

Reports, reviews, and documentation for you or your agent.

### `discern improvement`

Find the most valuable improvement to make next in how this project uses discern. It scores what discern can check automatically, lists the review questions it can't, for your agent and you to weigh together, and suggests one next step. It changes nothing.

Usage: `discern improvement [options]`

| Option              | Description                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--category <name>` | Review one area only: gate, setup, instructions, map, worktrees, standards, checkpoints, skills.                     |
| `--min-score <n>`   | Exit non-zero when the score is below this number, for use as a CI check. With `--category`, it's that area's score. |

### `discern standards`

Measure your project's standards: limits on measured numbers, such as test coverage or bundle size. A change can tighten a limit, but loosening one needs the owner's approval. Name standards to measure only those; otherwise discern measures them all. It first checks that no limit is looser than the trunk's, and saves each measurement so a later `--pin` or `discern done` can reuse it for the same commit. You don't need it before finishing: `discern done` checks every standard. For a number that grows with the project, hold a rate with `per`. Give a total that drifts a `margin`, or a limit pinned at today's value fails the next ordinary change.

Usage: `discern standards [names...] [options]`

| Option      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dry-run` | List the standards that would be measured, without measuring them.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--force`   | Measure even with uncommitted changes. Use it only while writing a standard; `--pin` ignores it.                                                                                                                                                                                                                                                                                                                                                                          |
| `--pin`     | Lock in improvements: tighten each named standard's limit, or every limit with room to tighten, to its measured value, keeping its margin as headroom. It needs a clean worktree and reuses measurements already taken for this commit. With names, it measures only those standards when current Proof covers the commit; otherwise it measures them all. discern commits the new limits by themselves, and that commit needs a fresh `discern done` before it can land. |

#### `discern standards propose`

Propose a looser limit for a standard this change breaks, for the owner to approve. Run it on the branch's final, clean commit. discern measures the standard and commits a proposal that changes only its limit, set to the measured value. Rerun after later commits, with the same reason, to carry an unchanged proposal forward without a new commit. Landing still needs the owner's explicit approval of the value and reason.

Usage: `discern standards propose <name> [options]`

| Option              | Description                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `--reason <reason>` | Why the limit should change, for the owner to read: 1–500 characters on one line, with no secrets and no claim that anyone has approved it. |
| `--dry-run`         | Show the proposal without making it.                                                                                                        |

### `discern checkpoints`

Show the checkpoints that apply to this task, whether each question has an answer, and which ones the current change would trigger. It also shows how often each checkpoint has fired, been answered unmet, and needed a variance. It runs no `when` commands and changes no checkpoint state.

Usage: `discern checkpoints [options]`

### `discern skills <subcommand>`

Manage skills, the reusable playbooks your agents follow: list them, or copy a built-in one so you can edit it.

Usage: `discern skills <subcommand>`

#### `discern skills list`

List the skills your agents get: discern's built-in skills and yours, which of yours replace a built-in, and which are excluded.

Usage: `discern skills list [options]`

#### `discern skills eject`

Copy a built-in skill into your skills folder, `[skills].dir`, so you can edit it; your copy then replaces the built-in. If `discern.toml` doesn't set `[skills].dir` yet, discern adds it. It refuses a name that isn't a built-in skill, or one you've already copied, and it doesn't commit.

Usage: `discern skills eject <name> [options]`

| Option      | Description                                                                         |
| ----------- | ----------------------------------------------------------------------------------- |
| `--dry-run` | Show what would be copied and where agents would get it, without changing anything. |

### `discern impact`

Show which scopes this branch's changes touch, and so which scope gates `discern done` will run. Scopes are named regions of the repository, set in `discern.toml`. It counts the branch's commits since it left the trunk, plus uncommitted and untracked files. Neutral scopes never appear. It also lists `code` when any file outside the neutral scopes changed, and `previewable` when a scope with a preview command changed.

Usage: `discern impact [options]`

| Option          | Description                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--has <scope>` | Check one scope, or `code` or `previewable`. On its own, it prints nothing and exits 0 if the change touches it, 1 if not. With `--json`, it reports the answer in `data.membership` and exits 0. |

### `discern coupling`

Find files that usually change together in your Git history, so a change doesn't miss one. With no arguments, it lists files that often change with the ones you changed but are missing from your change. With one file, it lists that file's usual partners. With two files, it lists recent commits that changed both. It's advice only and always exits 0.

Usage: `discern coupling [file] [with] [options]`

### `discern patterns`

Show patterns in how this project uses discern, from its local logbook. Findings cover standard trends, how well the gate fits the work, habits such as repeated failures, and the path from start to landing. Each finding shows its counts and what the logbook couldn't see, and says when there isn't enough evidence. It's advice only.

Usage: `discern patterns [options]`

| Option                      | Description                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--stats`                   | Show usage statistics instead: changes landed, passing streaks, cycle times, standard trends, and results grouped by coding agent, from the same logbook. With `--json`, they're added to the result as `data.stats`. |
| `--all`                     | Show every finding. Without it, each kind of check shows its first few.                                                                                                                                               |
| `--logbook-file <filename>` | Read a sealed archive instead of the active logbook. Give a file name that `discern patterns archives` lists.                                                                                                         |

#### `discern patterns archives`

List the logbook's sealed archives, with each one's event count, date range, and size.

Usage: `discern patterns archives [options]`

#### `discern patterns reset`

Delete the active logbook for good, once you confirm in an interactive terminal. Sealed archives and discern's other files in `.git` stay. The confirmation defaults to keeping the logbook. In CI, with `--plain`, or with `--json` or `--markdown`, only `--dry-run` works.

Usage: `discern patterns reset [options]`

| Option      | Description                                                               |
| ----------- | ------------------------------------------------------------------------- |
| `--dry-run` | Show the full plan without asking for confirmation or changing any files. |

#### `discern patterns seal`

Archive the active logbook under a timestamped name and start a fresh one, once you confirm in an interactive terminal. The confirmation defaults to keeping the logbook as it is. In CI, with `--plain`, or with `--json` or `--markdown`, only `--dry-run` works.

Usage: `discern patterns seal [options]`

| Option      | Description                                                               |
| ----------- | ------------------------------------------------------------------------- |
| `--dry-run` | Show the full plan without asking for confirmation or changing any files. |

### `discern map`

Browse your project's map, the documentation your agents keep about how the project works, or read one page by name.

Usage: `discern map [target] [options]`

| Option             | Description                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--raw`            | Print a page's Markdown source instead of rendering it.                                                                                                                                                        |
| `--list`           | Print a plain table of contents instead of opening the reader.                                                                                                                                                 |
| `--search <query>` | Search the map by describing a task or quoting exact text. Add a target to search one page or section.                                                                                                         |
| `--pager`          | Show each rendered page in your pager: `$PAGER`, or `less -R` when it's unset.                                                                                                                                 |
| `--dir <path>`     | Browse this folder instead of the project's map folder (`[map].dir`).                                                                                                                                          |
| `--width <cols>`   | Wrap rendered output at this many columns.                                                                                                                                                                     |
| `--export <scope>` | Join pages into one Markdown document: `public` for published pages, `all` for every page, `select` to choose sections in a terminal (with `--output`), or a configured scope's name for the pages it matches. |
| `--output <path>`  | Write the export to this file instead of stdout. The file can't be inside the map folder.                                                                                                                      |

### `discern docs`

Browse discern's manual, which comes with discern, or read one page by name.

Usage: `discern docs [target] [options]`

| Option             | Description                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--raw`            | Print a page's Markdown source instead of rendering it.                                                                               |
| `--list`           | Print a plain table of contents instead of opening the reader.                                                                        |
| `--search <query>` | Search the manual by describing a task or quoting exact text. Add a target to search one page or section.                             |
| `--adr`            | Browse discern's own architecture decision records. An installed discern doesn't include them, so it shows where to read them online. |
| `--pager`          | Show each rendered page in your pager: `$PAGER`, or `less -R` when it's unset.                                                        |
| `--width <cols>`   | Wrap rendered output at this many columns.                                                                                            |
| `--export <scope>` | Join the manual's pages into one Markdown document. `public` is the only scope.                                                       |
| `--output <path>`  | Write the export to this file instead of stdout.                                                                                      |

### `discern help`

Show help for discern, or for one command, such as `discern help worktree prune`.

Usage: `discern help [command...] [options]`

### `discern licenses`

Print discern's licenses and notices, and the notices for the third-party software built into it.

Usage: `discern licenses [options]`

### `discern releases`

Open discern's release notes in your browser, to see what's new and whether a newer discern is out. discern itself makes no network request: the page compares your version with the latest. The browser opens only from an interactive terminal. Inside a project, discern records when you last looked, for its reminder to check for releases.

Usage: `discern releases [options]`

| Option      | Description                                                                      |
| ----------- | -------------------------------------------------------------------------------- |
| `--dry-run` | Show the address it would open, without opening a browser or recording anything. |

### `discern mcp`

Run discern's MCP (Model Context Protocol) server, which gives coding agents most of discern's commands as tools. You don't need to run it yourself: setup and `discern refresh` configure each agent to start it. It talks over standard input and output.

Usage: `discern mcp [options]`

| Option                | Description                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--long-tool-calls`   | For agents that allow long tool calls: let each await call wait up to 3300 seconds.                                                                                                    |
| `--strict-tool-calls` | For agents that end long tool calls early: keep each await call to 45 seconds, and suggest the command line for long work. Without either option, await calls also stop at 45 seconds. |

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
