---
id: guide-maintain-or-remove-discern
title: "Maintain or remove discern"
description: "Format discern-owned surfaces, upgrade safely, diagnose the installation, or remove discern while preserving project-owned work."
order: 150
publish: true
kind: guide
aliases:
  - "upgrade"
  - "guide-maintain-or-remove-discern"
  - "Upgrade discern"
  - "update discern"
  - "update the binary"
  - "migrate"
  - "`discern tidy`: format discern-owned surfaces"
  - "tidy"
  - "markdown formatter"
  - "toml formatter"
  - "format discern files"
redirect_from:
  - "/docs/getting-started/upgrade-discern"
  - "/docs/quality-gate/tidy"
---

# Maintain or remove discern

Format discern-owned surfaces, upgrade safely, diagnose the installation, or remove discern while preserving project-owned work.

## Upgrade discern

_Replace the binary first, then run the project upgrade so `discern.toml`, generated instructions, Skills, and shared files match that binary._

discern does not check the network for updates and never updates itself. You choose when to replace the binary. The `discern upgrade` command handles a different job: it brings an existing project forward to the schema and bundled material in the binary currently on your `PATH`.

Before starting, commit or stash uncommitted tracked changes in the project. The upgrade command checks for a clean tree so its changes remain reviewable and revertible ([ADR 0014](https://discern.sh/docs/decisions/0014-versioned-migration-system)).

### 1. Replace the binary

Run the same installer used for the first install:

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

It downloads the latest released binary and checksum for your operating system and architecture. The installer replaces the existing `discern` file only after the checksum passes. If it prints a shell-profile instruction instead of the setup handoff, apply it and open a new shell.

Confirm which binary the shell sees:

```sh
which discern
discern --version
```

If the project reports that its schema is newer than the binary, repeat this step. An older binary refuses to downgrade a project created or upgraded by a newer one.

### 2. Preview the project changes

From anywhere inside the repository, run:

```sh
discern upgrade --dry-run
```

The preview lists pending schema migrations and any managed config or `.gitignore` reconciliation. It also states that instructions and Skills would refresh. It writes nothing.

Review the plan and the clean git status. `--allow-dirty` bypasses the clean-tree guard, but use it only when another snapshot already makes the working changes recoverable.

### 3. Apply the project upgrade

```sh
discern upgrade
```

The command performs these actions in order:

| Area                    | What the upgrade does                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Schema migrations       | Runs each pending step, validates the migrated config, then stamps the current schema. |
| `discern.toml` scaffold | Restores missing fixed sections, keys, and managed banners from the current template.  |
| `.gitignore` block      | Reconciles discern's marked block with the current artifact registry.                  |
| Instructions and Skills | Recompiles agent files and re-materializes bundled and authored Skills.                |

Migrations are idempotent: a step can run again against its own output without compounding the change. The command validates the migrated config before stamping the new schema ([ADR 0085](https://discern.sh/docs/decisions/0085-validate-migrations-before-schema-stamping)).

Every config mutation leaves `discern.toml` in the same canonical form as `discern tidy toml`, preserving its comments and ruled banners. An upgrade does not add a new command to an existing project's format job. To opt into automatic formatting for the Map, instructions, TODO, and root config, add `discern tidy` after any project formatter. [The tidy guide](maintain-or-remove-discern.md) gives the exact scope.

Your configured values, ordinary comments, instruction sources, authored Skills, project scripts, and Map content remain project-owned. Review the resulting diff before committing it.

### 4. Restart coding-agent sessions

Close and restart every open coding-agent session for this repository. A session that started `discern mcp` before the binary changed keeps the old engine and embedded templates in memory until the session ends.

### 5. Verify the upgraded install

Run both read-only checks:

```sh
discern doctor
discern upgrade --check
```

`discern doctor` checks the complete installation and integrations. `discern upgrade --check` exits successfully when the project's schema, fixed config scaffold, managed banners, `.gitignore` block, and managed `.gitattributes` fragment match the installed binary. It checks fragment currency. Doctor separately diagnoses effective per-path attributes. Neither command queries the network for a newer release.

Commit the reviewed upgrade diff. If the agent files changed, keep them in the same commit as their source and the migration changes.
## `discern tidy`: format discern-owned surfaces

_An offline formatter for the files whose conventions discern defines._

Fresh installations put bare `discern tidy` in the [format job](../30-reference/glossary.md#gate-job). The project declares that formatter in its jobs table, so the Gate runs it as an ordinary fix-stage command. The Gate resolves `discern` in a job command to the engine running that Gate, so this self-invocation works even where the surrounding environment has no discern on `PATH`.

### What it formats

| Type     | Included                                                                                                      | Left alone                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Markdown | Every `.md` file under `[map].dir`, the `[project].todo` file, and files matched by `[instructions].sources`. | The project brief, authored Skills, generated agent files, and Markdown outside those configured sources. |
| TOML     | The root `discern.toml`.                                                                                      | Every other TOML file, including files owned by the project's stack or a coding-agent provider.           |

Markdown prose is unwrapped, two-space indented, space-based, and LF-terminated. Fenced code stays unchanged. Box-drawing diagrams in fenced or indented code blocks must align; a bad glyph reports `diagrams_misaligned` with file, line, and column. Only a fence tagged `freeform` opts out, because indented blocks have no tag. TOML preserves comments and shows dotted depth with two-space steps. The embedded formatter makes no network call and needs no project runtime ([ADR 0321](https://discern.sh/docs/decisions/0321-diagram-geometry-follows-markdown-code-block-semantics)).

### Run it directly

| Command                  | Effect                                               |
| ------------------------ | ---------------------------------------------------- |
| `discern tidy`           | Format both Markdown and TOML targets.               |
| `discern tidy md`        | Format only the configured Markdown targets.         |
| `discern tidy toml`      | Format only the root config.                         |
| `discern tidy --dry-run` | List every file that would change and write nothing. |

The planner reads and formats every target before the first write. A file that cannot be parsed fails the run, leaving all files unchanged. A missing configured path is a successful no-op, and a run rewrites only changed files. A second run is a no-op.

### Keep a project formatter first

`discern tidy` does not format source code or detect a project's stack. When the project already has a formatter, run that command first and keep discern's formatter last:

```sh
discern config set-job format \
  --run "<the project's formatter>" \
  --run "discern tidy"
```

The commands remain literal and run in that order as one serial fix stage ([ADR 0317](https://discern.sh/docs/decisions/0317-gate-commands-and-setup-applicability-are-separate-facts)).

Seeded alone, the format job provides housekeeping. `setup done` and `discern doctor` report `minimal` assurance until a project check joins it ([ADR 0220](https://discern.sh/docs/decisions/0220-self-supplied-commands-count-for-nothing-in-assurance)). During setup, doctor fails when every form of `discern tidy` leaves the format job; afterward it is an informational opt-out.

`discern config set-job format` is the existing-installation path. Every config writer (`discern upgrade`, `discern config`, setup, presets, skill ejection, `standards --pin`) emits the canonical form.
