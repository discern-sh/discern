---
title: Upgrade discern
description: Update the discern binary, migrate the project to match it, restart agent sessions, and verify the result.
order: 50
aliases:
  - upgrade
  - update discern
  - update the binary
  - migrate
---

# Upgrade discern

_Replace the binary first, then run the project upgrade so `discern.toml`, generated guidance, skills, and shared files match that binary._

discern does not check the network for updates and never updates itself. You choose when to replace the binary. The `discern upgrade` command handles a different job: it brings an existing project forward to the schema and bundled material in the binary currently on your `PATH`.

Before starting, commit or stash uncommitted tracked changes in the project. The upgrade command checks for a clean tree so its changes remain reviewable and revertible ([ADR 0014](../_adr/0014-versioned-migration-system.md)).

## 1. Replace the binary

Run the same installer used for the first install:

```sh
curl -fsSL https://raw.githubusercontent.com/jackwh/discern/main/install.sh | sh
```

It downloads the latest released binary for your operating system and architecture and replaces the `discern` file in the install directory. Open a new shell if that directory was newly added to `PATH`.

Confirm which binary the shell sees:

```sh
which discern
discern --version
```

If the project reports that its schema is newer than the binary, repeat this step. An older binary refuses to downgrade a project created or upgraded by a newer one.

## 2. Preview the project changes

From anywhere inside the repository, run:

```sh
discern upgrade --dry-run
```

The preview lists pending schema migrations and any managed config or `.gitignore` reconciliation. It also states that guidance and skills would refresh. It writes nothing.

Review the plan and the clean git status. `--allow-dirty` bypasses the clean-tree guard, but use it only when another snapshot already makes the working changes recoverable.

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
| Guidance and skills     | Recompiles agent files and re-materializes bundled and authored skills.                |

Migrations are idempotent: a step can run again against its own output without compounding the change. The command validates the migrated config before stamping the new schema ([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)).

Your configured values, ordinary comments, guidance sources, authored skills, project scripts, and map content remain project-owned. Review the resulting diff before committing it.

## 4. Restart coding-agent sessions

Close and restart every open coding-agent session for this repository. A session that started `discern mcp` before the binary changed keeps the old engine and embedded templates in memory until the session ends.

## 5. Verify the upgraded install

Run both read-only checks:

```sh
discern doctor
discern upgrade --check
```

`discern doctor` checks the complete installation and integrations. `discern upgrade --check` exits successfully when the project's schema, fixed config scaffold, managed banners, and `.gitignore` block match the installed binary. It does not query the network for a newer release.

Commit the reviewed upgrade diff. If the agent files changed, keep them in the same commit as their source and the migration changes.
