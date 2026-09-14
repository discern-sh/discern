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
  - "project.logbook"
  - "project.agents"
  - "repository"
  - "repository.trunk"
  - "repository.branch_prefix"
  - "repository.proof_notes"
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
  - "worktree.port"
  - "worktree.ignored_file_drift"
  - "worktree.resources"
  - "worktree.resources.<name>"
  - "worktree.resources.<name>.create"
  - "worktree.resources.<name>.destroy"
  - "worktree.resources.<name>.ensure"
  - "worktree.resources.<name>.required"
  - "worktree.resources.<name>.retries"
  - "worktree.resources.<name>.gc"
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
  - "gate.stream"
  - "gate.fail_fast"
  - "gate.timeout"
  - "gate.concurrent_test_runs"
  - "coupling.in_gate"
  - "scripts"
  - "scripts.dir"
  - "meta"
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

Fresh setup seeds `[scopes.map]` with the map and deferred-work ledger. `[scopes.instructions]` carries the project brief, instruction sources, authored skills, and materialized skills directories. The `[acceptance]` example names only `map`, so agent-instruction changes require owner review. Upgrade leaves existing named scopes unchanged; owners of earlier installs split their scope manually to adopt this boundary.

## `[project]`

The project's identity and the paths discern keeps for it. The name and slug appear in worktree, branch, and site names and in every compiled instruction file, so agents and humans see one identity everywhere.

| Key           | Type                                                              | Default             | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | string                                                            | `""`                | Display name, free text, used when compiled instructions address the project. Empty falls back to the slug.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `slug`        | string                                                            | `""`                | Short, lowercase, dash-separated identity, used in worktree, site, and branch names.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `gotchas_doc` | string                                                            | `""`                | The doc the gate points an agent at when a stage fails in a non-obvious way. Keep it current with your stack's traps; empty disables the pointer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `todo`        | string                                                            | `"discern/TODO.md"` | The deferred-work ledger: the running TODO list agents read and maintain, relative to the project root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `logbook`     | boolean                                                           | `true`              | When true, record one line of local, metadata-only history per verb run: timings, outcomes, and names, with no code or output. Files stay under .git, outside commits and any network; false stops all writes. Recording on is recommended. History cannot be recorded after the fact, and while recording is off this project goes without: - the practice and completion-cost report (`discern patterns`) - each worktree's last action and work in flight - fleet activity times that include verb runs - configuration-change attribution and each standard's limit history - advisory findings during work and merge-conflict recovery - wait estimates when concurrent test runs queue - the in-flight check on the contained-worktree offer - observed checkpoint economics (`discern checkpoints`) - Logbook storage checks in `discern doctor` |
| `agents`      | (`claude_code` \| `codex` \| `gemini` \| `cursor` \| `copilot`)[] | —                   | Which agent integrations to enable: claude_code, codex, gemini, cursor, copilot. Omit the key for the default pair (claude_code, codex); an explicit empty list emits for no agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## `[repository]`

Policy every checkout of this repository shares. The trunk is where accepted work lands and where the gate compares from. Branch naming and convergence commands keep the main checkout and every linked worktree usable after their tracked tree changes.

| Key             | Type               | Default    | Description                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trunk`         | string             | `"main"`   | The shared branch the gate compares against and completed work lands on. Detected at setup; DISCERN_TRUNK overrides it per invocation.                                                                                                                                                                               |
| `branch_prefix` | string             | `"agent/"` | Branch prefix for worktrees created by discern, e.g. "agent/my-feature".                                                                                                                                                                                                                                             |
| `proof_notes`   | `local` \| `fetch` | `"local"`  | Both modes record landed Proof notes locally. "fetch" also manages fetch-only transport. Publishing remains an explicit owner action; there is no off mode. `local` adds no transport; `fetch` manages a fetch-only mapping per remote. Publish only when the owner chooses: `git push <remote> refs/notes/discern`. |
| `ensure`        | string[]           | `[]`       | Idempotent commands that make any checkout usable for its tracked tree, such as installing dependencies from a lockfile. They run in order on every worktree pass and after a landing.                                                                                                                               |

## `[map]`

Where the project map lives. The map is the documentation tree agents maintain and `discern map` browses. Its location also feeds the `${map.dir}` reference other sections use.

| Key   | Type   | Default          | Description                                                                                                                      |
| ----- | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `dir` | string | `"discern/map/"` | Where the project map lives, relative to the project root. `discern setup begin` scaffolds it here and `discern map` browses it. |

## `[instructions]`

The instruction sources discern compiles into each agent's file. You write instructions once. `discern refresh` compiles discern's built-in instructions plus your sources into one generated file per agent, committed so every agent reads the same page and no generated file is edited by hand.

| Key       | Type     | Default                       | Description                                                                                                                                 |
| --------- | -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `sources` | string[] | `["discern/instructions.md"]` | Instruction source files or globs, relative to the project root. Missing files are skipped; `discern setup begin` seeds the default source. |

## `[skills]`

Where your authored skills live, and which skills to leave out. A skill is a focused, reusable playbook. discern materializes its bundled skills plus yours into each agent's skills directory; a skill of yours with the same name as a built-in replaces it.

```text
discern skills list          the effective set, and your overrides
discern skills eject <name>  copy a built-in here to customize it
```

| Key       | Type     | Default            | Description                                                                                                                                                                                                          |
| --------- | -------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir`     | string   | `"discern/skills"` | Where your authored skills live, relative to the project root. Read only when present, so a project with no authored skills uses the built-ins.                                                                      |
| `exclude` | string[] | `[]`               | Skill names, bundled or authored, to leave out of materialization. Each materialized skill occupies context in every agent session, so exclude what this project never needs; an unknown name warns and never fails. |

## `[jobs]`

The commands the gate runs, in one namespace. A known name derives its stage; a custom `[jobs.<name>]` table declares one. `discern done` runs the fix stage, then build, then check and test in parallel, and reports what each command returned, so done means the project's own bar was met.

```text
A value is one command, a list run in order, or a table giving the job
its own time budget: test = { run = "npm test", timeout = 1200 }.
A long-running command may report its own progress while it runs: print
DISCERN_PROGRESS {"units":{"kind":"files","completed":3,"total":8}}
lines and discern presents the counts, and any reported failures, live.
Reporting is optional during setup: consider runner hooks and check
runtime; keep exit status, failure diagnostics, and performance intact.
Leave a known job unwired until its command exists; `discern setup` has
your coding agent fill these from repository evidence.
```

| Key         | Type                         | Default | Description                                                                                                                                                                                                                                               |
| ----------- | ---------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`    | string \| string[] \| object | —       | A formatter or codemod. Mutating, so it runs first and serially. Keep `discern tidy` last: it formats the map, instructions, TODO, and this file. Put the project's own formatter before it, for example format = ["prettier --write .", "discern tidy"]. |
| `build`     | string \| string[] \| object | —       | Produce the artifacts later stages read: compile, bundle.                                                                                                                                                                                                 |
| `lint`      | string \| string[] \| object | —       | Read-only static analysis.                                                                                                                                                                                                                                |
| `typecheck` | string \| string[] \| object | —       | Read-only type checking.                                                                                                                                                                                                                                  |
| `test`      | string \| string[] \| object | —       | The test suite.                                                                                                                                                                                                                                           |
| `smoke`     | string \| string[] \| object | —       | A fast, side-effect-light readiness check: the app boots with real config in this checkout. `discern done` and `discern test` run it in the same fail-fast test group, so a quick failure cancels slower siblings.                                        |

### `[jobs.<name>]`

A custom job. Its name is open, but its stage and command are explicit.

| Key           | Type                                  | Default | Description                                                                                                                                                                                                                             |
| ------------- | ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stage`       | `fix` \| `build` \| `check` \| `test` | —       | The gate stage this job runs in: fix, build, check, or test.                                                                                                                                                                            |
| `run`         | string \| string[]                    | —       | The command(s) to run. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched. |
| `inputs`      | string[]                              | —       | Complete input closure as scope globs; omission binds evidence to the candidate.                                                                                                                                                        |
| `needs`       | string[]                              | —       | Producer selectors that must finish successfully before this producer runs.                                                                                                                                                             |
| `artifacts`   | string[]                              | —       | Project-relative outputs captured into immutable attempt storage after production.                                                                                                                                                      |
| `environment` | string[]                              | —       | Environment variable names whose effective values enter evidence identity as digests.                                                                                                                                                   |
| `toolchain`   | string[]                              | —       | Project-relative identity files for the applicable toolchain.                                                                                                                                                                           |
| `provides`    | string                                | —       | A free-text label for humans and audit.                                                                                                                                                                                                 |
| `timeout`     | number                                | —       | Time budget in seconds for this job alone, replacing [gate].timeout; 0 removes the bound. Omit to inherit the global budget.                                                                                                            |

A custom job: any name, an explicit stage, and its command:

```toml
[jobs.licenses]
stage    = "check"
run      = "./scripts/check-licenses.sh"
provides = "license-audit"
```

## `[setup]`

Known jobs that do not apply to this project. Setup measures how many applicable known jobs are wired. A lifecycle the project does not have is declared here, so the measure counts what exists; the gate's schedule still comes from [jobs].

```text
discern config set-job build --not-applicable   declare one
discern config set-job build --applicable       restore it
```

| Key              | Type                                                                  | Default | Description                                                                                                  |
| ---------------- | --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `not_applicable` | (`format` \| `build` \| `lint` \| `typecheck` \| `test` \| `smoke`)[] | `[]`    | Known jobs this project's lifecycle does not have. A job listed here cannot also be configured under [jobs]. |

## `[scopes.<name>]`

Named regions of the repository. A change inside a scope can skip the gate, run its own gate, or offer a preview. A path that matches no scope counts as code and runs every stage.

| Key           | Type               | Default | Description                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`       | string[]           | —       | The globs that define the scope: a directory prefix (src/**), a standard glob (src/**/_.ext, src/_), a *.ext suffix at any depth, a /seg/ segment, or an exact path. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched. |
| `neutral`     | boolean            | `false` | true: changes here need no gate, as for documentation and agent instructions.                                                                                                                                                                                                                                                                                                         |
| `preview`     | string \| string[] | —       | A read-only command an agent can run from this worktree to preview a change in this scope. discern reports this action but never executes it. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched.                        |
| `inputs`      | string[]           | —       | Complete input closure as scope globs; omission binds evidence to the candidate.                                                                                                                                                                                                                                                                                                      |
| `needs`       | string[]           | —       | Producer selectors that must finish successfully before this producer runs.                                                                                                                                                                                                                                                                                                           |
| `artifacts`   | string[]           | —       | Project-relative outputs captured into immutable attempt storage after production.                                                                                                                                                                                                                                                                                                    |
| `environment` | string[]           | —       | Environment variable names whose effective values enter evidence identity as digests.                                                                                                                                                                                                                                                                                                 |
| `toolchain`   | string[]           | —       | Project-relative identity files for the applicable toolchain.                                                                                                                                                                                                                                                                                                                         |
| `gate`        | string \| string[] | —       | A command `discern done` runs when this scope changed: a sub-component's own self-contained gate. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched.                                                                    |
| `timeout`     | number             | —       | Time budget in seconds for this job alone, replacing [gate].timeout; 0 removes the bound. Omit to inherit the global budget.                                                                                                                                                                                                                                                          |

A sub-component with its own self-contained gate and a read-only preview:

```toml
[scopes.native]
paths   = ["native/**"]
gate    = "make -C native check"
preview = "make -C native preview"
```

## `[generated.<name>]`

Committed artifacts that one generator owns. `discern prepare` and `discern done` rerun each generator and fail when the committed bytes differ, so a generated file cannot drift from its source and nobody edits it by hand.

| Key                  | Type               | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths`              | string[]           | —       | The scope-paths globs naming the committed artifacts this generator wholly owns: a directory prefix (`reference/**`), a standard glob (`reference/**/*.md`, `reference/*`), a `*.ext` suffix at any depth, a `/seg/` segment, or an exact path. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched. |
| `run`                | string \| string[] | —       | The deterministic command(s) that rewrite this group's artifacts: the same tree must produce the same bytes, and the generator must remove orphaned artifacts it no longer emits. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched.                                                               |
| `linguist_generated` | boolean            | `false` | true marks the group's paths generated for GitHub through the `linguist-generated` attribute: hidden in diffs by default and excluded from language statistics.                                                                                                                                                                                                                                                                                                  |
| `timeout`            | number             | —       | Time budget in seconds for this job alone, replacing [gate].timeout; 0 removes the bound. Omit to inherit the global budget.                                                                                                                                                                                                                                                                                                                                     |

A reference written from source; the same tree yields the same bytes:

```toml
[generated.reference]
paths = ["reference/**"]
run   = "tool write-reference --source source/ --output reference/"
```

## `[acceptance]`

Standing grants for landing without a conversation. Landing needs the owner's acceptance in the conversation unless a scope is named here. Widening a named scope widens its grant; the example grants documentation alone and keeps agent instructions owner-reviewed.

| Key              | Type     | Default | Description                                                                                                                                                                                                      |
| ---------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre_authorized` | string[] | `[]`    | Scope names whose changes may land without a per-landing conversation. An owner decision recorded on the trunk: widening a named scope widens its grant. Empty means every landing needs the owner's acceptance. |

## `[worktree]`

The isolated-worktree workflow. Each effort runs in its own checkout, so parallel agents never collide. The git mechanics are generic; the resources and setup commands below are what make a fresh worktree ready for this project.

| Key                  | Type     | Default                 | Description                                                                                                                                                                                                       |
| -------------------- | -------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`               | string   | `""`                    | Where per-worktree checkouts are created. Empty means a sibling of the repository, "<repo>.worktrees", outside the checkout. A relative path resolves against the repo root; absolute is used as-is.              |
| `inherit_env`        | string[] | `[]`                    | Names copied from the main checkout's declared env files. A value fills an empty entry or the first file's `<file>.example` default. A missing first file is created at mode 0600; existing modes stay unchanged. |
| `env_files`          | string[] | `[".env",".env.local"]` | Env files read and written in order: the last definition wins; new values use the first existing file. Inheritance alone may create the first file. Managed values share one scoped marker.                       |
| `port`               | boolean  | `false`                 | Record each worktree's deterministic dev-server port in its env files, for tooling that reads DISCERN_WORKTREE_PORT. `discern identity --port` reports it either way.                                             |
| `ignored_file_drift` | boolean  | `true`                  | Track ignored files at worktree setup and report the top-level ignored paths that changed before the worktree is removed. Turn it off when ignored outputs churn too much to be useful.                           |

### `[worktree.resources.<name>]`

External resources provisioned per worktree. Give each worktree a deterministic database, emulator, container, or queue handle. Resources are created top to bottom and destroyed bottom to top. discern records intent before create, cleans uncertain partial state before retry, and lets `discern worktree prune` reclaim a vanished worktree's recorded state.

```text
Runtime tokens, expanded per worktree when a command runs:
  @db@            a database-name-safe identity
  @site@          a DNS-safe dev-server site or host name
  @port@          the deterministic dev-server port
  @project_slug@  the project slug
  @dir@           this worktree's root
  @worktree@      this worktree's base handle (slug-id)
  @resource@      this resource's handle (slug-id-name)
```

| Key        | Type    | Default | Description                                                                                                                                                            |
| ---------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`   | string  | `""`    | Command run once at worktree setup. discern records cleanup intent before running it and skips it only after readiness is recorded. An empty command is a clean no-op. |
| `destroy`  | string  | `""`    | Command run once at teardown. Author it idempotent (it may re-run via worktree prune) and cwd-independent.                                                             |
| `ensure`   | string  | `""`    | Idempotently reconcile drift or re-readiness at session start.                                                                                                         |
| `required` | boolean | `true`  | false makes a create failure non-fatal, so setup continues.                                                                                                            |
| `retries`  | number  | `0`     | Retry create/destroy this many times.                                                                                                                                  |
| `gc`       | boolean | `true`  | false exempts the resource from orphan pruning, for data-loss-sensitive resources that only teardown may remove.                                                       |

A per-worktree database, so test runs never clash:

```toml
[worktree.resources.db]
create  = "createdb -T @project_slug@_template @db@"
destroy = "dropdb --if-exists @db@"
```

A per-worktree dev-server site: a container vhost, a tunnel, a proxy entry:

```toml
[worktree.resources.dev_server]
create  = "link-site @site@ @port@"
destroy = "unlink-site @site@"
```

### `[worktree.setup]`

Commands that ready a linked worktree. `steps` run once at creation. `ensure` runs on every pass, including session start and `discern update`, so each command must be idempotent. Checkout-generic installs belong in [repository].ensure so acceptance converges the trunk too.

| Key      | Type     | Default | Description                                                                                                                                                                                                 |
| -------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steps`  | string[] | `[]`    | Commands run once at worktree creation, in order, after the resources exist: one-shot scaffolding such as seeding fixtures.                                                                                 |
| `ensure` | string[] | `[]`    | Commands run on every linked-worktree pass: creation, session start, and after `discern update`. For convergence that depends on worktree identity, ports, or resources; the main checkout never runs them. |

## `[standards.<name>]`

Quality numbers that can never get worse. Every `discern done` requires current readings for each standard and refuses a limit looser than the trunk's. Producers run once for their consumers, and reusable evidence must match the declared inputs, policy, toolchain, and environment. Hold a raw count for an invariant, a rate through `per` for a quality that scales, and give a total that grows with the product a `margin`.

```text
A producer or extractor reports a number: DISCERN_METRIC <name> <number>
Set run for an inline producer, or producer for an existing selector.
An extract command receives captured output or the named artifact on stdin.
Lock in a gain with `discern standards --pin`; a hand-edited limit cannot
tell a gain from a loosening.
```

| Key           | Type               | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `metric`      | string             | —       | The metric name the run emits. Defaults to the standard's name.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `direction`   | `up` \| `down`     | —       | "up" when the value should rise, so the limit is a floor; "down" when it should fall, so the limit is a ceiling.                                                                                                                                                                                                                                                                                                                                                                                    |
| `limit`       | number             | —       | The floor or ceiling, compared with the trunk's: a floor may only rise and a ceiling may only fall.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `run`         | string \| string[] | —       | This standard's producer command. Emits DISCERN_METRIC <metric> <number>; cannot accompany producer.                                                                                                                                                                                                                                                                                                                                                                                                |
| `producer`    | string             | —       | Consume an existing job, scope gate, or standard producer instead of running a separate producer.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `extract`     | string \| string[] | —       | Extract readings from captured producer output on stdin; this is a separate operation from run.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `artifact`    | string             | —       | Declared producer artifact supplied on stdin to extract; requires extract.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `inputs`      | string[]           | —       | Complete input closure as scope globs; omission binds evidence to the candidate.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `needs`       | string[]           | —       | Producer selectors that must finish successfully before this producer runs.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `artifacts`   | string[]           | —       | Project-relative outputs captured into immutable attempt storage after production.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `environment` | string[]           | —       | Environment variable names whose effective values enter evidence identity as digests.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `toolchain`   | string[]           | —       | Project-relative identity files for the applicable toolchain.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `per`         | string \| object   | —       | Divide the metric to hold a rate rather than a raw count, so the number does not rise because the project grew: a second metric the run emits, or a built-in extent discern measures itself, per = { words = "${map.dir}**" } (files, lines, words, or bytes over a git pathspec). Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched. |
| `scale`       | number             | `1`     | Multiply the rate so the limit reads in human units; scale = 1000 reads as per 1,000.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `margin`      | number             | `0`     | Headroom `discern standards --pin` leaves when it tightens the limit to the measured value. Give a metric that drifts on unrelated changes, such as a size or a coverage percentage, a margin so a pinned limit is not tripped by ordinary fluctuation.                                                                                                                                                                                                                                             |
| `timeout`     | number             | —       | Time budget in seconds for this job alone, replacing [gate].timeout; 0 removes the bound. Omit to inherit the global budget.                                                                                                                                                                                                                                                                                                                                                                        |

Line coverage at or above a rising floor:

```toml
[standards.coverage]
direction = "up"
limit     = 80
run       = "your-coverage-tool"  # DISCERN_METRIC coverage <percent>
```

A bundle-size budget: shipped bytes are a true budget, so a raw count is right:

```toml
[standards.bundle]
metric    = "bundle_bytes"
direction = "down"
limit     = 500000
run       = "printf 'DISCERN_METRIC bundle_bytes %s\\n' \"$(wc -c < dist/app.js)\""
```

Lint density: a rate, so clean code can be added without breaching it:

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

Change-triggered review rules. A deterministic trigger decides when a change makes a question relevant; the agent answers the question and the answer travels with the Proof. The configuration at an effort's merge-base governs, so editing these tables on a branch never changes that branch's own gate.

```text
Naming a shipped checkpoint enables it with its built-in trigger, mode,
and question; a field set beneath it overrides the built-in. Delete or
comment out an entry to disable it.
```

| Key                 | Type                                   | Default | Description                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scope`             | string                                 | —       | Selector: a configured [scopes.<name>] whose paths choose the matched set. Prefer this over repeating the scope's globs in `paths`; a checkpoint takes one selector.                                                                                                                                                                                 |
| `paths`             | string[]                               | —       | Selector globs in the scope dialect: prefix, standard glob, suffix, segment, or exact path. Use either `scope` or `paths`. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched.          |
| `include_generated` | boolean                                | —       | true includes paths a [generated.<name>] group owns; the default evaluates authored change only.                                                                                                                                                                                                                                                     |
| `exclude_paths`     | string[]                               | —       | Globs removed after selection and before every predicate, subject, evidence, and `when`. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched.                                            |
| `unless_changed`    | string[]                               | —       | Hold fire when any changed path matches one of these globs or scope names: flag this change class unless its counterpart moved too. Registered path references (${map.dir}, ${skills.dir}, ${scripts.dir}, ${project.todo}, ${project.gotchas_doc}) resolve from this config before matching or execution; unregistered braced forms stay untouched. |
| `kinds`             | (`added` \| `modified` \| `deleted`)[] | —       | Narrow changed evidence to the named Git kinds: "added", "modified", or "deleted".                                                                                                                                                                                                                                                                   |
| `adds_matching`     | string[]                               | —       | Narrow text evidence to files with an added line containing any configured case-sensitive literal UTF-8 byte substring. Accepts up to 16 distinct patterns of 1–128 UTF-8 bytes; NUL, CR, and LF are invalid.                                                                                                                                        |
| `removes_matching`  | string[]                               | —       | Narrow text evidence to files with a removed line containing any configured case-sensitive literal UTF-8 byte substring. Accepts up to 16 distinct patterns of 1–128 UTF-8 bytes; NUL, CR, and LF are invalid.                                                                                                                                       |
| `new_directory`     | boolean                                | —       | Narrow to added files whose parent directory held no admitted file at the merge-base; root-level additions never qualify.                                                                                                                                                                                                                            |
| `binary`            | boolean                                | —       | Narrow to binary changes when true or text changes when false.                                                                                                                                                                                                                                                                                       |
| `min_changed_files` | number                                 | —       | Fire only when at least this many matched files changed. Omit for no threshold (any matched change fires).                                                                                                                                                                                                                                           |
| `min_changed_lines` | number                                 | —       | Require this many added-plus-removed text lines across the final narrowed evidence; binary files contribute zero.                                                                                                                                                                                                                                    |
| `deletion_dominant` | boolean                                | —       | Fire only when the matched change is deletion-dominant: line removals clearly outweigh additions and exceed a fixed floor, so a large cut is reviewed and an ordinary edit or balanced refactor is not.                                                                                                                                              |
| `similar_new_file`  | boolean                                | —       | Fire only when the change adds a file whose name closely resembles an existing sibling in the same directory, the signature of a parallel implementation growing beside the original.                                                                                                                                                                |
| `min_commits`       | number                                 | —       | Require this many commits in merge-base..HEAD, including merge commits; uncommitted work adds no commit.                                                                                                                                                                                                                                             |
| `when`              | string                                 | —       | Final executable condition: exit 0 fires, exit 10 passes; every other outcome is indeterminate. `DISCERN_MATCH <path>` narrows the structural matches.                                                                                                                                                                                               |
| `mode`              | `stop` \| `advise`                     | —       | "stop" (the default): the gate refuses to run until the agent declares the question met or unmet. "advise": the question and its evidence are delivered through the advisory channel and nothing blocks.                                                                                                                                             |
| `question`          | string                                 | —       | Inline judgment prose. A project checkpoint needs this or `question_file`; a built-in inherits unless overridden. Review surfaces serve it. Do not include secrets.                                                                                                                                                                                  |
| `question_file`     | string                                 | —       | Repository-relative Markdown path from the governing merge-base Git tree. Mutually exclusive with `question`; built-ins may inherit. Must be a regular Git blob, valid UTF-8, and at most 65536 bytes. Text can appear in terminal, MCP, CI, Proof, and landing review; repository access is its only privacy. Do not include secrets.               |
| `teach`             | string                                 | —       | Optional lesson prose carried into renderings: why the question matters and what good looks like.                                                                                                                                                                                                                                                    |
| `reference`         | string                                 | —       | Optional displayed pointer. discern performs no content loading or execution. Review surfaces may show it. Do not include secrets.                                                                                                                                                                                                                   |

Regions the owner watches; `stop` holds `discern done` for a stated risk:

```toml
[checkpoints.sensitive-paths]
paths = ["src/auth/**", "migrations/**"]
question = """
This change touches a region the owner marked sensitive. What could break
or leak if this is wrong, what protects against that, and what should a
reviewer look at first?
"""
```

A new dependency is a liability the owner carries; point paths at the manifest:

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

A deleted or skipped test is a lowered guard:

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

An interface changed; its contract docs moved too, or were judged unaffected:

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

How `discern done` runs its parallel stages. Fail-fast, a per-command time budget, and a cap on concurrent test runs keep the gate fast for one agent and fair across a fleet of worktrees sharing one machine.

| Key                    | Type    | Default | Description                                                                                                                                                                                                     |
| ---------------------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stream`               | boolean | `false` | false groups each job's complete output in a static transcript; true streams prefixed lines. Live terminals always show the gate frame's bounded tail; CI, pipes, and --plain are static.                       |
| `fail_fast`            | boolean | `true`  | Cancel the in-flight sibling commands the moment one fails; an agent-driven gate wants a fast abort. false runs every job and shows all failures in one pass.                                                   |
| `timeout`              | number  | `600`   | Time budget in seconds for every command the gate runs. A command that overruns is tree-killed and the stage fails with a timeout diagnostic, so a watch-mode runner cannot hang the gate. 0 removes the bound. |
| `concurrent_test_runs` | number  | `1`     | How many test stages may run on this machine at once; the rest wait for a slot. Fresh projects use 1; 0 is uncapped. `discern queue -- <command>` shares the cap.                                               |

## `[coupling]`

Co-change detection from git history. Files that habitually change together point at a sibling the current change may be missing. Coupling is read-only advice that calibrates itself to the repository, with no thresholds to tune; `discern coupling` reads it on demand.

| Key       | Type    | Default | Description                                                                                                                                                                    |
| --------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `in_gate` | boolean | `true`  | Surface coupling findings as trailing hints in `discern done` and `discern prepare`, while the change is hot. false keeps coupling available through `discern coupling` alone. |

## `[scripts]`

Where your executable project scripts live. `discern scripts <name>` resolves the name literally, runs it from the project root with `DISCERN_ROOT`, `DISCERN_TOML`, `DISCERN_SCRIPTS_DIR`, and `DISCERN_TRUNK`, and forwards every argument. Other config stays available through `discern config get`.

| Key   | Type   | Default             | Description                                                                                                                                           |
| ----- | ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir` | string | `"discern/scripts"` | Where your project scripts live, relative to the project root. The default works with no config; point it elsewhere, such as "tools/", if you prefer. |

## `[meta]`

Installer bookkeeping. discern writes these keys while setting up or upgrading the project. They record schema and setup evidence; nothing here needs hand-editing.

| Key                | Type                   | Default | Description                                                                                                                                               |
| ------------------ | ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`   | number                 | —       | The install schema version. `discern upgrade` bumps it; never edit it by hand. Written by discern.                                                        |
| `bootstrapped`     | boolean                | `false` | true once `discern setup` has completed, which retires the one-time setup redirect. Written by discern.                                                   |
| `setup_completion` | `proven` \| `unproven` | —       | Evidence recorded for the setup completion event: proven by the gate, or explicitly completed unproven. Written by discern.                               |
| `setup_model`      | string                 | `""`    | The model the agent declared at `discern setup begin --model`. Recorded for support triage; advisory, since discern cannot verify it. Written by discern. |
| `setup_version`    | string                 | `""`    | The discern version that ran setup, recorded for support triage. Written by discern.                                                                      |
