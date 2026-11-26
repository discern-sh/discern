---
title: Upgrade discern
description: Update the discern binary, migrate the project to match it, restart agent sessions, and verify the result.
order: 70
aliases:
  - upgrade
  - update discern
  - update the binary
  - migrate
---

# Upgrade discern

_Replace the binary first, then run the project upgrade so `discern.toml`, generated instructions, Skills, and shared files match that binary._

discern does not check the network for updates and never updates itself. You choose when to replace the binary. The `discern upgrade` command handles a different job: it brings an existing project forward to the schema and bundled material in the binary currently on your `PATH`.

Before starting, commit or stash uncommitted tracked changes in the project. The upgrade command checks for a clean tree, so every change it leaves is its own. It then commits those changes as one reviewable, revertible commit ([ADR 0014](../_adr/0014-versioned-migration-system.md), [ADR 0436](../_adr/0436-upgrade-commits-the-diff-it-composes.md)).

## Check release information

Run `discern releases` or choose **Check for updates** in the desk. The shared [handoff core](../../../src/commands/releases.ts) supplies HTML and JSON URLs using the running process's numeric version. An ordinary terminal invocation or explicit desk action attempts a browser launch. The terminal prints the browser URL; structured results retain both addresses. JSON, Markdown, non-terminal, and dry-run invocations never launch. Dry-run also writes no state.

The [public maintenance guide](https://discern.sh/docs/guides/maintain-or-remove-discern#check-release-information) explains request-scoped checking and installation. The [shared update sequence](../../../src/shared/product_identity.ts) owns their order. Use the stable recommendation, keep prereleases separate, and avoid installation advice when there is no stable target or the supplied version is ahead.

The binary makes no network request. The browser or an authorized agent tool sends the running version to `discern.sh`. That version does not establish which binary is on disk. The [local clock](../../../src/shared/release_check.ts) records adoption and handoff, without claiming a fetch or an available update. Doctor, status, and the desk only read it.

## 1. Replace the binary

Run the same installer used for the first install:

```sh
curl -fsSL https://discern.sh/install | sh
```

It downloads the latest released binary and checksum for your operating system and architecture. The installer replaces the existing `discern` file only after the checksum passes. If it prints a shell-profile instruction instead of the setup handoff, apply it and open a new shell.

Confirm which binary the shell sees:

```sh
command -v discern
discern --version
```

Human version output includes the compiled codename when the release family has one. Numeric fields and protocol identities keep plain SemVer. Restart agent and MCP sessions after replacement, before applying project changes.

If the project reports that its schema is newer than the binary, repeat this step. An older binary refuses to downgrade a project created or upgraded by a newer one.

## 2. Preview the project changes

From anywhere inside the repository, run:

```sh
discern upgrade --dry-run
```

The preview lists pending schema migrations and any managed config or `.gitignore` reconciliation. It also states that instructions and skills would refresh. It writes nothing.

It includes the exact previous and proposed `meta.managed_version`. Missing adoption is pending even when every managed byte matches. Successful upgrade records the higher SemVer precedence; equal precedence preserves the existing value. The [adoption model](../50-engine-internals/managed-adoption.md) owns this boundary and its distinction from installed binaries and content currency.

Review the plan and the clean git status. `--allow-dirty` bypasses the clean-tree guard, but use it only when another snapshot already makes the working changes recoverable. The upgrade then leaves its changes uncommitted, because your edits and its own can share a file.

## 3. Apply the project upgrade

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
| Commit                  | Commits every path it changed or created, when the tree was clean beforehand.          |

Migrations are idempotent: a step can run again against its own output without compounding the change. The command validates the migrated config before stamping the new schema ([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)).

Every config mutation leaves `discern.toml` in the same canonical form as `discern tidy toml`, preserving its comments and ruled banners. An upgrade does not add a new command to an existing project's format job. To opt into automatic formatting for the map, instructions, TODO, and root config, add `discern tidy` after any project formatter. [The tidy guide](../20-quality-gate/tidy.md) gives the exact scope.

Your configured values, ordinary comments, instruction sources, authored skills, project scripts, and map content remain project-owned.

The [commit step](../../../src/commands/upgrade_commit.ts) takes every tracked change and each file the upgrade created. A file you had left untracked stays untracked. The commit keeps your Git identity and adds `discern` as a co-author ([ADR 0203](../_adr/0203-discern-co-authors-only-commits-it-composes.md)). Review it with `git show`, and undo it with `git revert`.

Git can refuse that commit: a hook rejects it, signing fails, or `HEAD` is detached. The upgrade still stands. The result's `commit` field names the reason and the paths, and the changes wait in the working tree for you to commit. A new worktree starts from the committed trunk, so it lacks the upgrade until that commit exists.

## 4. Restart coding-agent sessions

Close and restart every open coding-agent session for this repository. A session that started `discern mcp` before the binary changed keeps the old engine and embedded templates in memory until the session ends.

## 5. Verify the upgraded install

Run both read-only checks:

```sh
discern doctor
discern upgrade --check
```

`discern doctor` checks the complete installation and integrations. `discern upgrade --check` exits successfully when the project's schema, fixed config scaffold, managed banners, `.gitignore` block, and managed `.gitattributes` fragment match the installed binary. It checks fragment currency. Doctor separately diagnoses effective per-path attributes. Neither command queries the network for a newer release.

An upgrade run with `--allow-dirty` needs your own commit. Keep changed agent files in the same commit as their source and the migration changes.

The committed adoption fact travels to teammates through Git. An older schema-capable binary can read status and run the test stage, while its managed-file writers and ordinary Proof remain unavailable. The [team upgrade sequence](https://discern.sh/docs/guides/maintain-or-remove-discern#share-an-upgrade-with-teammates) separates release checking, verified installation, session restart, and successful project adoption.
