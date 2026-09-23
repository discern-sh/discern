---
id: reference-config
title: "Config reference"
description: "Find what each discern.toml setting does, which values it accepts, and what happens when you leave it out."
order: 30
publish: true
kind: reference
aliases:
  - "reference-config"
  - "configuration"
  - "discern.toml"
  - "config"
  - "project"
  - "project.name"
  - "project.slug"
  - "project.gotchas_doc"
  - "project.todo"
  - "project.record_logbook"
  - "project.agents"
  - "repository"
  - "repository.trunk"
  - "repository.branch_prefix"
  - "repository.proof_notes_mode"
  - "repository.ensure"
  - "map.dir"
  - "instructions.sources"
  - "skills.dir"
  - "skills.exclude"
  - "jobs"
  - "jobs.format"
  - "jobs.build"
  - "jobs.lint"
  - "jobs.typecheck"
  - "jobs.test"
  - "jobs.smoke"
  - "jobs.<name>"
  - "jobs.<name>.stage"
  - "jobs.<name>.run"
  - "jobs.<name>.inputs"
  - "jobs.<name>.needs"
  - "jobs.<name>.artifacts"
  - "jobs.<name>.environment"
  - "jobs.<name>.toolchain"
  - "jobs.<name>.provides"
  - "jobs.<name>.timeout"
  - "setup.not_applicable"
  - "scopes"
  - "scopes.<name>"
  - "scopes.<name>.paths"
  - "scopes.<name>.neutral"
  - "scopes.<name>.preview"
  - "scopes.<name>.inputs"
  - "scopes.<name>.needs"
  - "scopes.<name>.artifacts"
  - "scopes.<name>.environment"
  - "scopes.<name>.toolchain"
  - "scopes.<name>.gate"
  - "scopes.<name>.timeout"
  - "generated"
  - "generated.<name>"
  - "generated.<name>.paths"
  - "generated.<name>.run"
  - "generated.<name>.linguist_generated"
  - "generated.<name>.timeout"
  - "acceptance"
  - "acceptance.pre_authorized"
  - "worktree.root"
  - "worktree.inherit_env"
  - "worktree.env_files"
  - "worktree.export_port"
  - "worktree.track_ignored_drift"
  - "worktree.resources"
  - "worktree.resources.<name>"
  - "worktree.resources.<name>.create"
  - "worktree.resources.<name>.destroy"
  - "worktree.resources.<name>.ensure"
  - "worktree.resources.<name>.required"
  - "worktree.resources.<name>.retries"
  - "worktree.resources.<name>.prunable"
  - "worktree.setup"
  - "worktree.setup.steps"
  - "worktree.setup.ensure"
  - "standards.<name>"
  - "standards.<name>.metric"
  - "standards.<name>.direction"
  - "standards.<name>.limit"
  - "standards.<name>.run"
  - "standards.<name>.producer"
  - "standards.<name>.extract"
  - "standards.<name>.artifact"
  - "standards.<name>.inputs"
  - "standards.<name>.needs"
  - "standards.<name>.artifacts"
  - "standards.<name>.environment"
  - "standards.<name>.toolchain"
  - "standards.<name>.per"
  - "standards.<name>.scale"
  - "standards.<name>.margin"
  - "standards.<name>.timeout"
  - "checkpoints.<name>"
  - "checkpoints.<name>.scope"
  - "checkpoints.<name>.paths"
  - "checkpoints.<name>.include_generated"
  - "checkpoints.<name>.exclude_paths"
  - "checkpoints.<name>.unless_changed"
  - "checkpoints.<name>.kinds"
  - "checkpoints.<name>.adds_matching"
  - "checkpoints.<name>.removes_matching"
  - "checkpoints.<name>.new_directory"
  - "checkpoints.<name>.binary"
  - "checkpoints.<name>.min_changed_files"
  - "checkpoints.<name>.min_changed_lines"
  - "checkpoints.<name>.deletion_dominant"
  - "checkpoints.<name>.similar_new_file"
  - "checkpoints.<name>.min_commits"
  - "checkpoints.<name>.when"
  - "checkpoints.<name>.mode"
  - "checkpoints.<name>.question"
  - "checkpoints.<name>.question_file"
  - "checkpoints.<name>.teach"
  - "checkpoints.<name>.reference"
  - "gate.stream_output"
  - "gate.fail_fast"
  - "gate.timeout"
  - "gate.concurrent_test_runs"
  - "coupling.report_in_gate"
  - "scripts"
  - "scripts.dir"
  - "meta"
  - "meta.managed_version"
  - "meta.schema_version"
  - "meta.bootstrapped"
  - "meta.setup_completion"
  - "meta.setup_model"
  - "meta.setup_version"
---

<!-- This reference is generated from the configuration schema. -->

# `discern.toml` — config reference

`discern.toml` holds your project's discern settings. Use this page to check what a setting does, which values it accepts, and what happens when you leave it out. Your agent can make the edit for you once you have decided what should change.

Start with [jobs](#jobs) for checks, [worktree](#worktree) for task workspaces, [standards](#standardsname) for measured limits, or [checkpoints](#checkpointsname) for review questions. The tables below cover every public setting and come from the schema discern uses to validate your file.

The named-table sections (`[jobs.<name>]` for custom jobs, `[scopes.<name>]`, `[generated.<name>]`, `[worktree.resources.<name>]`, `[standards.<name>]`, `[checkpoints.<name>]`) are repeatable: declare as many as you like, each with its own `<name>`.

## Read the tables

A **Default** is the value discern uses when you omit a key. An em dash means there is no schema default; it does not mean an empty value. A table marked `<name>` lets you choose a name, such as `[standards.coverage]`. Other table and key names must match the reference.

The published [JSON Schema](https://discern.sh/schema/v1/discern-config.schema.json) is the external machine-readable contract. For editing and validation recovery, see [Configuration and setup troubleshooting](../40-troubleshooting/setup-and-integrations.md).

Fresh setup seeds `[scopes.map]` with the map and deferred-work ledger. `[scopes.instructions]` carries the project brief, instruction sources, authored skills, and materialized skills directories. The `[acceptance]` example names only `map`, so agent-instruction changes require owner review. `discern upgrade` leaves existing named scopes as they are.

## `[project]`

The project's name, its coding agents, and a few project-wide settings. The name heads every compiled instruction file, and the slug names each worktree's site, database, and resources, so people and agents see one identity everywhere.

| Key              | Type                                                              | Default             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | string                                                            | `""`                | The project's display name, in any words. Compiled instruction files use it to refer to the project; when it's empty, they use the slug.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `slug`           | string                                                            | `""`                | A short id of lowercase letters, digits, and dashes. discern builds each worktree's site, database, and resource names from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `gotchas_doc`    | string                                                            | `""`                | A doc of your project's known traps. When `discern done`, `prepare`, or `test` fails, discern points your agent to it, and quotes any entry that matches the failure. Leave it empty to turn this off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `todo`           | string                                                            | `"discern/TODO.md"` | The TODO list of deferred work that your agents read and keep up to date, relative to the project root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `record_logbook` | boolean                                                           | `true`              | When true, discern keeps a local logbook of each command it runs: timings, outcomes, and names, but no code or output. It stays inside `.git`, out of commits and off the network. false stops new writes. Keep recording on: history can't be recorded later, and while it's off this project goes without: - the practice and completion-cost report (`discern patterns`) - each worktree's last action and work in flight - fleet activity times that include verb runs - configuration-change attribution and each standard's limit history - advisory findings during work and merge-conflict recovery - wait estimates when concurrent test runs queue - the in-flight check on the contained-worktree offer - observed checkpoint economics (`discern checkpoints`) - Logbook storage checks in `discern doctor` |
| `agents`         | (`claude_code` \| `codex` \| `gemini` \| `cursor` \| `copilot`)[] | —                   | Which coding agents discern sets up: claude_code, codex, gemini, cursor, copilot. Leave it out for the default (claude_code, codex); an empty list sets up none. Each gets an instruction file, skills, discern's MCP tools, and a session-start hook. Removing an agent leaves its files in place.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## `[repository]`

Git settings that every checkout of this repository shares. The trunk is the branch finished work lands on and the gate checks against. The branch prefix names each task's branch, and `ensure` commands keep every checkout ready to use after its files change.

| Key                | Type               | Default    | Description                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trunk`            | string             | `"main"`   | Your project's shared branch: finished work lands here, and the gate checks each change against it. Setup detects it; `DISCERN_TRUNK` overrides it for one command.                                                                                                                                                                                                          |
| `branch_prefix`    | string             | `"agent/"` | The start of every branch discern creates for a worktree, as in "agent/my-feature". Include your own `/`: discern adds nothing between the prefix and the id. A change affects new worktrees only.                                                                                                                                                                           |
| `proof_notes_mode` | `local` \| `fetch` | `"local"`  | Proof notes are discern's records on landed commits. Both modes record them locally; "fetch" also lets `git fetch` bring in other clones' notes. Publishing is up to the owner, and there is no off mode. `local` changes nothing on your remotes; `fetch` adds a fetch-only rule for each remote. To publish notes, the owner runs: `git push <remote> refs/notes/discern`. |
| `ensure`           | string[]           | `[]`       | Commands that make any checkout ready to use after its files change, such as installing dependencies from a lockfile. They run in order, so each must be safe to repeat. They run when discern sets up a worktree, at each session start, after `discern update`, and in the main checkout after each landing.                                                               |

## `[map]`

Where the project map lives. The map is the documentation your agents keep about how the project works, and `discern map` browses it. Other settings can refer to its folder as `${map.dir}`, which ends in `/`, as in `${map.dir}**`.

| Key   | Type   | Default         | Description                                                                                                                                                                |
| ----- | ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir` | string | `"discern/map"` | The map's folder, relative to the project root. `discern setup begin` creates it here if it doesn't exist, and `discern map` reads it. Changing it doesn't move any files. |

## `[instructions]`

The instruction files discern compiles into each agent's file. You write your instructions once. `discern refresh` combines discern's built-in instructions with yours into one generated file per agent. Those files are committed, so every agent reads the same instructions, and the gate fails if one is edited by hand.

| Key       | Type     | Default                       | Description                                                                                                                                                                                                       |
| --------- | -------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources` | string[] | `["discern/instructions.md"]` | Your instruction files, or patterns that match them, relative to the project root. discern joins the matching files in path order and skips any that don't exist. `discern setup begin` creates the default file. |

## `[skills]`

Where your own skills live, and which skills to leave out. A skill is a reusable playbook your agents follow for one kind of task. discern copies its built-in skills into each agent's skills folder and links yours there, so edits to yours apply at once. A skill of yours with the same name as a built-in one replaces it.

```text
discern skills list          see which skills your agents get
discern skills eject <name>  copy a built-in here so you can edit it
```

| Key       | Type     | Default            | Description                                                                                                                                                                         |
| --------- | -------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir`     | string   | `"discern/skills"` | The folder for your own skills, relative to the project root, with a folder inside it for each skill. Until it exists, your agents get the built-in skills only.                    |
| `exclude` | string[] | `[]`               | Skills to leave out, built-in or your own. Each skill your agents get adds to every agent session, so leave out what this project never needs. An unknown name only gets a warning. |

## `[jobs]`

The commands the gate runs to check a change. A known name, such as `test`, has a fixed stage; a custom `[jobs.<name>]` table sets its own. `discern done` runs the fix stage, then build, then the check and test stages side by side. It reports what each command returned, so a pass means your project's own checks passed.

```text
Give a job one command, a list of commands run in order, or a table with
its own settings, such as test = { run = "npm test", timeout = 1200 }.
A long command can report its progress by printing lines such as
DISCERN_PROGRESS {"units":{"kind":"files","completed":3,"total":8}}
and discern shows the counts, and any failures reported, as it runs.
Leave a known job out until the project has that command. During setup,
your coding agent fills these in from what the repository already uses.
```

| Key         | Type                         | Default | Description                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`    | string \| string[] \| object | —       | A formatter or other tool that rewrites files, so it runs first, one command at a time. `discern prepare` leaves its edits for you to commit; `discern done` fails if it edits a committed file. Keep `discern tidy` last: it formats the map, instructions, TODO list, and this file. Put your own formatter first, for example format = ["prettier --write .", "discern tidy"]. |
| `build`     | string \| string[] \| object | —       | Builds what later stages need, such as compiling or bundling. `discern done` runs it; `discern prepare` doesn't.                                                                                                                                                                                                                                                                  |
| `lint`      | string \| string[] \| object | —       | A linter or other read-only check of the code.                                                                                                                                                                                                                                                                                                                                    |
| `typecheck` | string \| string[] \| object | —       | A read-only type check.                                                                                                                                                                                                                                                                                                                                                           |
| `test`      | string \| string[] \| object | —       | Your test suite. It waits for a free test-run slot before it starts.                                                                                                                                                                                                                                                                                                              |
| `smoke`     | string \| string[] \| object | —       | A quick check, with few side effects, that the app starts with real config in this checkout. `discern done` and `discern test` run it alongside the tests. With `[gate].fail_fast`, a quick failure stops the slower tests. It also runs in the main checkout after each landing.                                                                                                 |

### `[jobs.<name>]`

A custom job: any name of letters, digits, `_`, or `-`, with its stage and command set out.

| Key           | Type                                  | Default | Description                                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`       | `fix` \| `build` \| `check` \| `test` | —       | The gate stage this job runs in: fix, build, check, or test.                                                                                                                                                                                                                                                               |
| `run`         | string \| string[]                    | —       | The command to run, or a list of commands run in order, each only if the previous one succeeded. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written. |
| `inputs`      | string[]                              | —       | Every file pattern the command reads, in the scope glob syntax. With a complete list, discern can reuse an earlier result while those files and the command are unchanged; a file you leave out can let a stale result through. Without `inputs`, a result counts only for the commit it ran on.                           |
| `needs`       | string[]                              | —       | Other jobs, scope gates, or standards that must succeed before this command runs, named like `jobs.build`, `scopes.<name>.gate`, or `standards.<name>`.                                                                                                                                                                    |
| `artifacts`   | string[]                              | —       | Files the command produces, as exact paths relative to the project root. After each run, discern keeps its own copy, for example for a standard's `extract` to read.                                                                                                                                                       |
| `environment` | string[]                              | —       | Environment variables whose values affect the result. discern records a hash of each value, and a changed value stops it reusing an earlier result. Listing a variable doesn't set it.                                                                                                                                     |
| `toolchain`   | string[]                              | —       | Files that pin your tool versions, such as a lockfile, relative to the project root. A change to one stops discern reusing an earlier result.                                                                                                                                                                              |
| `provides`    | string                                | —       | A free-text note on what the job provides, for people reading the config. discern doesn't use it.                                                                                                                                                                                                                          |
| `timeout`     | number                                | —       | Time limit in seconds for this job, replacing `[gate].timeout`; 0 means no limit. Leave it out to use `[gate].timeout`.                                                                                                                                                                                                    |

A custom job: any name, an explicit stage, and its command:

```toml
[jobs.licenses]
stage    = "check"
run      = "./scripts/check-licenses.sh"
provides = "license-audit"
```

## `[setup]`

Known jobs this project doesn't have. Setup counts how many of the known jobs that apply to this project are configured. List a job here when the project has no such step, so setup doesn't count it as missing. The gate still runs only what `[jobs]` lists.

```text
discern config set-job build --not-applicable   mark a job as absent
discern config set-job build --applicable       count it again
```

| Key              | Type                                                                  | Default | Description                                                                                                           |
| ---------------- | --------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `not_applicable` | (`format` \| `build` \| `lint` \| `typecheck` \| `test` \| `smoke`)[] | `[]`    | Known jobs this project doesn't have. A job listed here can't also appear under `[jobs]`, even with an empty command. |

## `[scopes.<name>]`

Named regions of the repository. A scope can run its own gate command when a change touches it, offer a preview, or mark its changes as neutral, meaning not code. Landing grants, checkpoints, and `discern impact` refer to scopes by name. A path that matches no scope counts as code.

| Key           | Type               | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`       | string[]           | —       | The path patterns that define the scope: a folder prefix (`src/**`), a standard glob (`src/**/*.ext`, `src/*`), a `*.ext` suffix at any depth, a `/seg/` segment, or an exact path. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written. |
| `neutral`     | boolean            | `false` | Set to true when changes here aren't code, as for documentation and agent instructions. They trigger no scope gate, this scope's own `gate` never runs, and coupling ignores them. The gate's jobs still run.                                                                                                                                                                                                 |
| `preview`     | string \| string[] | —       | A read-only command your agent can run in its worktree to preview a change in this scope, such as building the docs. discern suggests it but never runs it. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written.                         |
| `inputs`      | string[]           | —       | Every file pattern the command reads, in the scope glob syntax. With a complete list, discern can reuse an earlier result while those files and the command are unchanged; a file you leave out can let a stale result through. Without `inputs`, a result counts only for the commit it ran on.                                                                                                              |
| `needs`       | string[]           | —       | Other jobs, scope gates, or standards that must succeed before this command runs, named like `jobs.build`, `scopes.<name>.gate`, or `standards.<name>`.                                                                                                                                                                                                                                                       |
| `artifacts`   | string[]           | —       | Files the command produces, as exact paths relative to the project root. After each run, discern keeps its own copy, for example for a standard's `extract` to read.                                                                                                                                                                                                                                          |
| `environment` | string[]           | —       | Environment variables whose values affect the result. discern records a hash of each value, and a changed value stops it reusing an earlier result. Listing a variable doesn't set it.                                                                                                                                                                                                                        |
| `toolchain`   | string[]           | —       | Files that pin your tool versions, such as a lockfile, relative to the project root. A change to one stops discern reusing an earlier result.                                                                                                                                                                                                                                                                 |
| `gate`        | string \| string[] | —       | A command `discern done` runs when a change touches this scope, such as a component's own checks. The reuse settings in this table apply to it. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written.                                     |
| `timeout`     | number             | —       | Time limit in seconds for this job, replacing `[gate].timeout`; 0 means no limit. Leave it out to use `[gate].timeout`.                                                                                                                                                                                                                                                                                       |

A component with its own gate command and a read-only preview:

```toml
[scopes.native]
paths   = ["native/**"]
gate    = "make -C native check"
preview = "make -C native preview"
```

## `[generated.<name>]`

Committed files that one command generates. `discern prepare` reruns each generator and leaves the new files for you to commit. `discern done` reruns them too, and fails when the committed files differ from what they produce. A generated file can't drift from its source, and nobody needs to edit it by hand.

| Key                  | Type               | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`              | string[]           | —       | Path patterns for the committed files this generator owns entirely, in the scope glob syntax: a folder prefix (`reference/**`), a standard glob (`reference/**/*.md`, `reference/*`), a `*.ext` suffix at any depth, a `/seg/` segment, or an exact path. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written. |
| `run`                | string \| string[] | —       | The command, or list of commands, that rewrites these files. The same source must always produce the same bytes, and the command must delete any file it no longer generates. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written.                                                                             |
| `linguist_generated` | boolean            | `false` | Set to true to mark these files as generated for GitHub, through the `linguist-generated` attribute. GitHub then collapses them in diffs and leaves them out of language statistics.                                                                                                                                                                                                                                                                                                |
| `timeout`            | number             | —       | Time limit in seconds for this job, replacing `[gate].timeout`; 0 means no limit. Leave it out to use `[gate].timeout`.                                                                                                                                                                                                                                                                                                                                                             |

A generated reference: the same source always gives the same bytes:

```toml
[generated.reference]
paths = ["reference/**"]
run   = "tool write-reference --source source/ --output reference/"
```

## `[acceptance]`

Standing grants: scopes whose changes can land without asking you each time. Without a grant, landing needs your approval in the conversation, or a grant you give one task from the desk. Widening a granted scope's paths widens its grant. The example grants documentation only, so you still review changes to agent instructions.

| Key              | Type     | Default | Description                                                                                                                                                                                                                                                                            |
| ---------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre_authorized` | string[] | `[]`    | Scopes whose changes can land without the owner's approval each time. A change qualifies only when every file it touches is in a listed scope. Empty means no scope is pre-approved. discern reads this list, and those scopes' paths, from the trunk, so a branch can't grant itself. |

## `[worktree]`

How discern creates and prepares task worktrees. Each task runs in its own checkout, so agents working side by side don't collide. The Git steps are the same for every project; the resources and setup commands below make a new worktree ready for this one.

| Key                   | Type     | Default                 | Description                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`                | string   | `""`                    | The folder where discern creates worktrees. Empty means "<repo>.worktrees" beside the repository; a relative path starts from the repository root. A change affects new worktrees only. An absolute path is used as written.                                                                                                                                                             |
| `inherit_env`         | string[] | `[]`                    | Environment variables to copy from the main checkout's env files into each worktree's when it's set up. A worktree keeps its own value unless it's empty or still a placeholder. A placeholder is the value in the first env file's `.example` copy. discern creates the first env file if it's missing, readable only by you (mode 0600), and leaves existing files' permissions alone. |
| `env_files`           | string[] | `[".env",".env.local"]` | The env files discern reads and writes, in order. When several set the same variable, the last one wins; a new value goes in the first listed file that exists. Only `inherit_env` creates a file. One comment line at the top of each file marks the values discern manages.                                                                                                            |
| `export_port`         | boolean  | `false`                 | Set to true to write each worktree's port into an env file that already exists, as `DISCERN_WORKTREE_PORT`. Every worktree has a port either way; `discern identity --port` prints it. When true, discern also avoids giving a new worktree a port another checkout uses, warns about a clash, and shows the port in `discern status`.                                                   |
| `track_ignored_drift` | boolean  | `true`                  | Record the Git-ignored top-level paths, such as `node_modules`, when a worktree is set up, and list the ones that changed when its work lands, for information only. Turn it off when ignored files change too often for the list to help.                                                                                                                                               |

### `[worktree.resources.<name>]`

Outside resources that each worktree gets its own copy of. Each worktree can have its own database, emulator, container, or queue, with a stable name. discern creates resources in the order listed and destroys them in reverse. It records how to destroy each one before creating it, so it can clean up a half-finished create, and `discern worktree prune` can clean up after a worktree deleted without discern.

```text
Tokens discern replaces with this worktree's values in these commands:
  @db@            a database-name-safe identity
  @site@          a DNS-safe dev-server site or host name
  @port@          the deterministic dev-server port
  @project_slug@  the project slug
  @dir@           this worktree's root
  @worktree@      this worktree's base handle (slug-id)
  @resource@      this resource's handle (slug-id-name)
```

| Key        | Type    | Default | Description                                                                                                                                                                                                                                                                                                          |
| ---------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`   | string  | `""`    | The command that creates the resource, run once when the worktree is first set up. Before running it, discern records the matching `destroy`, so if `create` fails partway, the next setup cleans up and tries again. Once `create` succeeds, it never runs again. An empty command does nothing.                    |
| `destroy`  | string  | `""`    | The command that removes the resource when its worktree is removed, or before discern retries a failed `create`. Make it safe to run twice, and don't rely on the current folder: `discern worktree prune` may run it after the worktree is gone. discern keeps the command as it was when the resource was created. |
| `ensure`   | string  | `""`    | A command that checks the resource and repairs it if needed, such as restarting a stopped database. It runs at each session start and when `discern worktree setup` runs again, but not at creation or after `discern update`. It must be safe to repeat, and a failure only warns.                                  |
| `required` | boolean | `true`  | Set to false to let setup finish when `create` fails. discern then doesn't retry `create`; only `ensure` runs later.                                                                                                                                                                                                 |
| `retries`  | number  | `0`     | How many times to retry a failed `create`, `destroy`, or `ensure`, from 0 to 5. `destroy` uses the count in effect when the resource was created.                                                                                                                                                                    |
| `prunable` | boolean | `true`  | Set to false to stop `discern worktree prune` from destroying this resource after its worktree was deleted without discern, for data you can't afford to lose. Removing the worktree through discern still destroys it. The value in effect when the resource was created applies.                                   |

A database for each worktree, so test runs never clash:

```toml
[worktree.resources.db]
create  = "createdb -T @project_slug@_template @db@"
destroy = "dropdb --if-exists @db@"
```

A development site for each worktree, such as a container host, tunnel, or proxy entry:

```toml
[worktree.resources.dev_server]
create  = "link-site @site@ @port@"
destroy = "unlink-site @site@"
```

### `[worktree.setup]`

Commands that prepare a task worktree for work. `steps` run once, when discern creates the worktree; `ensure` commands run on every pass, so each must be safe to repeat. Neither gets `@token@` replacement. Put installs that every checkout needs, such as dependencies, in `[repository].ensure`, so the main checkout gets them after a landing too.

| Key      | Type     | Default | Description                                                                                                                                                                                                                                                                                                                                |
| -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `steps`  | string[] | `[]`    | Commands run once, in order, when discern creates the worktree, after its resources exist, such as loading test data. A failing step stops creation. Steps you add later don't run in existing worktrees.                                                                                                                                  |
| `ensure` | string[] | `[]`    | Commands run whenever discern readies a task worktree, for setup that depends on its id, port, or resources. Each must be safe to repeat. The main checkout never runs them. They run at creation, at each session start, after `discern update`, and when `discern worktree setup` runs again. Only a failure at creation stops anything. |

## `[standards.<name>]`

Limits on measured numbers, such as test coverage or bundle size, that the gate holds. Every `discern done` needs a current measurement for each standard. A branch can tighten a limit but can't loosen, redefine, or delete a standard the trunk has. discern reuses a measurement only while its inputs, commands, toolchain, and environment match. Hold a raw count for a number that should stay fixed, a rate through `per` for one that grows with the project, and give a total that drifts a `margin`.

```text
The measuring command prints each reading as: DISCERN_METRIC <name> <number>
Set run to measure with a command, or producer to reuse a job's output.
An extract command reads that output, or the named artifact, on stdin.
Lock in a gain with `discern standards --pin`: it tightens the limit to
the measured value, keeping the margin as headroom, and commits it.
```

| Key           | Type               | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `metric`      | string             | —       | The metric name discern reads from the output: the producer's, or the `extract` command's when `extract` is set. Default: the standard's name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `direction`   | `up` \| `down`     | —       | "up" when higher is better, making the limit a floor; "down" when lower is better, making it a ceiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `limit`       | number             | —       | The floor or ceiling the measurement must meet; a measurement equal to the limit passes. A branch can raise a floor or lower a ceiling, but loosening one needs `discern standards propose` and the owner's approval.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `run`         | string \| string[] | —       | The command that measures this standard. It prints `DISCERN_METRIC <metric> <number>`, unless `extract` reads its output instead. Set exactly one of `run` or `producer`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `producer`    | string             | —       | Take the measurement from an existing job, scope gate, or standard, named like `jobs.test`, `scopes.<name>.gate`, or `standards.<name>`, instead of running a command of your own. That producer runs once for every standard that reads it. With `producer`, the standard's `needs`, `artifacts`, `environment`, and `toolchain` are ignored.                                                                                                                                                                                                                                                                                 |
| `extract`     | string \| string[] | —       | A second command that reads the producer's output, or the `artifact` file, on stdin and prints the `DISCERN_METRIC` line. With `extract`, discern reuses a measurement only when the standard declares `inputs`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `artifact`    | string             | —       | A file the producer lists in its `artifacts`, passed to `extract` on stdin in place of the output. Needs `extract`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `inputs`      | string[]           | —       | Every file pattern the command reads, in the scope glob syntax. With a complete list, discern can reuse an earlier result while those files and the command are unchanged; a file you leave out can let a stale result through. Without `inputs`, a result counts only for the commit it ran on.                                                                                                                                                                                                                                                                                                                               |
| `needs`       | string[]           | —       | Other jobs, scope gates, or standards that must succeed before this command runs, named like `jobs.build`, `scopes.<name>.gate`, or `standards.<name>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `artifacts`   | string[]           | —       | Files the command produces, as exact paths relative to the project root. After each run, discern keeps its own copy, for example for a standard's `extract` to read.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `environment` | string[]           | —       | Environment variables whose values affect the result. discern records a hash of each value, and a changed value stops it reusing an earlier result. Listing a variable doesn't set it.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `toolchain`   | string[]           | —       | Files that pin your tool versions, such as a lockfile, relative to the project root. A change to one stops discern reusing an earlier result.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `per`         | string \| object   | —       | Hold a rate instead of a raw count, so the number doesn't rise only because the project grew. Divide by a second metric the command prints, which must be above 0, or by a count discern takes itself: files, lines, words, or bytes in the files a pattern matches, for example per = { words = "${map.dir}**" }. Patterns use the scope glob syntax and match the files Git tracks or would track. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written. |
| `scale`       | number             | `1`     | Multiply a `per` rate into readable units: scale = 1000 gives a rate per 1,000. It has no effect without `per`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `margin`      | number             | `0`     | Headroom `discern standards --pin` keeps when it tightens the limit to the measured value. Give a margin to a number that moves with unrelated changes, such as a size or a coverage percentage, so ordinary movement doesn't fail a pinned limit. A branch can change it, or the standard's `timeout`, without the owner's approval, since neither changes what the standard measures.                                                                                                                                                                                                                                        |
| `timeout`     | number             | —       | Time limit in seconds for this job, replacing `[gate].timeout`; 0 means no limit. Leave it out to use `[gate].timeout`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Line coverage held at or above a floor that only rises:

```toml
[standards.coverage]
direction = "up"
limit     = 80
run       = "your-coverage-tool"  # DISCERN_METRIC coverage <percent>
```

A bundle-size budget: shipped bytes are a real budget, so a raw count fits:

```toml
[standards.bundle]
metric    = "bundle_bytes"
direction = "down"
limit     = 500000
run       = "printf 'DISCERN_METRIC bundle_bytes %s\\n' \"$(wc -c < dist/app.js)\""
```

Lint warnings per 1,000 lines: a rate, so adding clean code never breaks it:

```toml
[standards.lint_density]
metric    = "warnings"
direction = "down"
per       = { lines = "src/**" }   # discern counts the lines itself
scale     = 1000                   # warnings per 1,000 lines
limit     = 5
run       = "your-linter --count"  # DISCERN_METRIC warnings <count>
```

## `[checkpoints.<name>]`

Review questions your agent answers when a change matches a trigger. A trigger, such as a change to certain paths, decides when a question applies. Your agent answers it, and the answer goes into the Proof. A branch follows the checkpoint rules from the commit it started from, so editing these tables on a branch never changes that branch's own gate.

```text
Name a built-in checkpoint here to turn it on with its own trigger, mode,
and question. A field you set under it replaces the built-in value.
Delete or comment out an entry to turn it off.
```

| Key                 | Type                                   | Default | Description                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | -------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope`             | string                                 | —       | The name of a configured scope whose paths this checkpoint watches. Set at most one of `scope` and `paths`; with neither, it watches every file people or agents changed.                                                                                                                                                                                                                           |
| `paths`             | string[]                               | —       | Path patterns this checkpoint watches, in the scope glob syntax. Set at most one of `scope` and `paths`. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written.                                                                  |
| `include_generated` | boolean                                | —       | Set to true to also watch files a `[generated.<name>]` group owns. By default, a checkpoint watches only files people and agents write.                                                                                                                                                                                                                                                             |
| `exclude_paths`     | string[]                               | —       | Path patterns to ignore. discern removes them before any other trigger setting or `when` command looks at the change. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written.                                                     |
| `unless_changed`    | string[]                               | —       | Stay quiet when the change also touches one of these path patterns or scopes, anywhere in the project, such as the docs that go with an interface. You can write `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, `${project.todo}`, or `${project.gotchas_doc}` for a path this config sets; discern fills in its value before use and leaves other `${…}` text as written.                        |
| `kinds`             | (`added` \| `modified` \| `deleted`)[] | —       | Only count files changed in these ways: "added", "modified", or "deleted". A rename counts as a deletion and an addition.                                                                                                                                                                                                                                                                           |
| `adds_matching`     | string[]                               | —       | Only count text files where an added line contains one of these exact strings, matched case-sensitively. Up to 16 different strings of 1–128 UTF-8 bytes each, without NUL, CR, or LF. discern skips the check when a change is too large to scan, and records that it did.                                                                                                                         |
| `removes_matching`  | string[]                               | —       | Only count text files where a removed line contains one of these exact strings, matched case-sensitively. Up to 16 different strings of 1–128 UTF-8 bytes each, without NUL, CR, or LF. discern skips the check when a change is too large to scan, and records that it did.                                                                                                                        |
| `new_directory`     | boolean                                | —       | Only count files added in a folder that had no files where the branch started. Files added at the project root never count.                                                                                                                                                                                                                                                                         |
| `binary`            | boolean                                | —       | Only count binary files when true, or only text files when false.                                                                                                                                                                                                                                                                                                                                   |
| `min_changed_files` | number                                 | —       | Trigger only when at least this many watched files changed. Leave it out to trigger on any change.                                                                                                                                                                                                                                                                                                  |
| `min_changed_lines` | number                                 | —       | Trigger only when the counted files have at least this many added and removed lines in total. Binary files count as zero.                                                                                                                                                                                                                                                                           |
| `deletion_dominant` | boolean                                | —       | Trigger only when the change mostly removes lines: removals clearly outnumber additions and pass a fixed minimum. A large cut gets reviewed; an ordinary edit or a balanced refactor doesn't.                                                                                                                                                                                                       |
| `similar_new_file`  | boolean                                | —       | Trigger only when the change adds a file named like an existing file in the same folder, such as a copy, new, or v2 version of it, which suggests a second version growing beside the first.                                                                                                                                                                                                        |
| `min_commits`       | number                                 | —       | Trigger only when the branch has at least this many commits since it left the trunk, merge commits included. Uncommitted work doesn't count.                                                                                                                                                                                                                                                        |
| `when`              | string                                 | —       | A command that makes the final decision, run only when every other setting matches. Exit 0 triggers the checkpoint, and exit 10 doesn't; `DISCERN_MATCH <path>` lines it prints narrow the matched files. Any other result, including running out of time, counts as undecided: a `stop` checkpoint then fires over every matched file, and landing needs the owner's approval in the conversation. |
| `mode`              | `stop` \| `advise`                     | —       | "stop" holds `discern done` until the agent answers the question as met or unmet; an unmet answer then needs the owner's variance to land. "advise" shows the question as advice and blocks nothing. Your own checkpoints default to "stop"; a built-in one keeps its own mode.                                                                                                                     |
| `question`          | string                                 | —       | The question the agent answers, written here. Your own checkpoint needs this or `question_file`; a built-in one keeps its shipped question unless you set one. Review screens show it, so don't include secrets.                                                                                                                                                                                    |
| `question_file`     | string                                 | —       | A text file holding the question, relative to the repository root, used in place of `question`. discern reads it as committed where the branch started. It must be a regular file that Git tracks, valid UTF-8, and at most 65536 bytes. Its text can appear in the terminal, MCP, CI, Proof, and landing review, and only repository access keeps it private, so don't include secrets.            |
| `teach`             | string                                 | —       | Optional: why the question matters and what a good answer looks like. discern shows it with the question.                                                                                                                                                                                                                                                                                           |
| `reference`         | string                                 | —       | Optional: a pointer to more detail, such as a doc path or web address. discern shows it as written and never opens or runs it. Don't include secrets.                                                                                                                                                                                                                                               |

Paths the owner watches: `stop` holds `discern done` until the agent answers:

```toml
[checkpoints.sensitive-paths]
paths = ["src/auth/**", "migrations/**"]
question = """
This change touches a region the owner marked sensitive. What could break
or leak if this is wrong, what protects against that, and what should a
reviewer look at first?
"""
```

A new dependency is a cost the owner carries: point paths at the manifest:

```toml
[checkpoints.new-dependency]
paths = ["package.json"]
mode  = "advise"
question = """
This change edits a dependency manifest. For each dependency added or
upgraded: is it worth the liability it adds, against writing the small part
you need? State what it buys.
"""
```

A change that removes far more test code than it adds lowers protection:

```toml
[checkpoints.shrinking-tests]
paths             = ["tests/**"]
deletion_dominant = true
mode              = "advise"
question = """
This change removes clearly more test than it adds. Is every removed or
skipped case re-covered elsewhere, or is the narrowed protection intended?
Say which in the commit body.
"""
```

An interface changed: its docs change with it, or the agent judges them unaffected:

```toml
[checkpoints.interface-review]
paths          = ["src/api/**"]
unless_changed = ["docs/api/**"]
question = """
A changed interface is described in its docs before it lands: new entry
points state their failure modes; changed contracts note what callers must
revisit.
"""
```

## `[gate]`

How discern runs jobs, in `discern done` and the other commands that run them. Stopping at the first failure and a time limit for each job keep checks quick. A cap on test runs at once keeps them fair to every worktree of this repository.

| Key                    | Type    | Default | Description                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stream_output`        | boolean | `false` | How job output looks in CI, in a pipe, or with `--plain`: false shows each job's output as one block, and true prints lines as they arrive, marked with the job. A live terminal always shows a live view instead.                                                                                                                                                                   |
| `fail_fast`            | boolean | `true`  | Stop everything still running or waiting as soon as one job fails, so your agent hears about the failure quickly. false keeps going and shows more failures in one run. A job that depends on a failed fix or build step still doesn't run, and `discern standards` ignores this setting.                                                                                            |
| `timeout`              | number  | `600`   | Time limit in seconds for each job the gate runs, including scope gates, generators, and standard measurements. A job's own `timeout` replaces it; 0 means no limit. A job's list of commands shares one limit. discern stops a job that runs over, with every process it started, and fails its stage with a timeout message, so a command stuck in watch mode can't hang the gate. |
| `concurrent_test_runs` | number  | `1`     | How many test runs this repository's checkouts can have going at once; 0 means no limit. Test jobs, standard measurements, `discern test`, `discern standards`, and `discern queue -- <command>` each wait for a free slot.                                                                                                                                                          |

## `[coupling]`

Files that usually change together, found from Git history. When a change leaves out a file that usually changes with the ones it touches, discern names it. The finding is advice only, it adjusts to the repository's own history, and there are no thresholds to set. `discern coupling` shows it on demand.

| Key              | Type    | Default | Description                                                                                                                                                                                    |
| ---------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report_in_gate` | boolean | `true`  | Show coupling findings as hints at the end of a passing `discern done` or `discern prepare`, while the change is fresh. They never change the result. false leaves them to `discern coupling`. |

## `[scripts]`

Where your project's scripts live. `discern scripts <name>` runs the script with that name from the project root, with `DISCERN_ROOT`, `DISCERN_TOML`, `DISCERN_SCRIPTS_DIR`, and `DISCERN_TRUNK` set, and passes every argument through. A script can read other settings with `discern config get`.

| Key   | Type   | Default             | Description                                                                                                                                                                                         |
| ----- | ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir` | string | `"discern/scripts"` | The folder for your project scripts, relative to the project root. discern runs only the executable files in it. The default needs no setting; point it elsewhere, such as "tools/", if you prefer. |

## `[meta]`

A record of this project's setup and upgrades. discern writes these keys when it sets up or upgrades the project. They record the config format version and how setup went, so you never need to edit them.

| Key                | Type                   | Default | Description                                                                                                                                                                                                    |
| ------------------ | ---------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `managed_version`  | string                 | —       | The newest discern release whose setup or upgrade this project has completed. It only goes up, and it describes the project, whichever discern is installed. Written by discern.                               |
| `schema_version`   | number                 | —       | The install schema version: the version of this file's format. Setup writes it and `discern upgrade` raises it; don't edit it by hand. Written by discern.                                                     |
| `bootstrapped`     | boolean                | `false` | true once `discern setup done` finishes. Until then, commands that need a finished setup point you back to it. Written by discern.                                                                             |
| `setup_completion` | `proven` \| `unproven` | —       | How setup finished: `proven` when the gate passed, or `unproven` when `discern setup done --unproven` marked it complete without Proof. A later proven run changes `unproven` to `proven`. Written by discern. |
| `setup_model`      | string                 | `""`    | The model the agent named with `discern setup begin --model`, or `unreported`, kept for support. discern can't verify it. Written by discern.                                                                  |
| `setup_version`    | string                 | `""`    | The discern version that ran setup, kept for support. Written by discern.                                                                                                                                      |
