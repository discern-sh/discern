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
---

# Maintain or remove discern

discern's setup belongs to your project. You can inspect it, keep it current, or remove its wiring while retaining the instructions, skills, and project knowledge you have written.

Choose the task you need: [diagnose a problem](#diagnose-the-installation), [format discern's files](#format-discern-owned-surfaces), [check releases](#check-release-information), [upgrade](#upgrade-the-project), or [remove discern](#remove-discern-from-the-repository). Your agent can handle most maintenance; removal includes a terminal operation for you.

## Diagnose the installation

When an integration or command stops working, you can ask:

> Check this project's discern installation and explain what's wrong. Repair what you can within the existing setup, then tell me whether anything needs access, a restart, or a decision from me.

Your agent starts with `discern doctor`. Doctor is read-only: it checks configuration, required commands, generated files, integrations, and other parts of the installation, then names the recovery for anything it finds.

A missing command and a broken configuration need different fixes. The agent should explain the observed problem before changing settings, apply the reported remedy, and run doctor again. A passing result establishes the installation checks; a repaired coding-tool connection also needs a successful call from a fresh session.

For a bug report, `discern doctor --json` captures a structured result. [Troubleshooting](../40-troubleshooting/README.md) helps match a symptom to a recovery.

## Format discern-owned surfaces

If your instructions, map, work ledger, or `discern.toml` have become hard to scan, ask:

> Format the files discern manages, review the changes, and bring them back through the project's checks.

In the task's worktree, the agent previews `discern tidy --dry-run` and applies `discern tidy`. The planner parses every target before writing. A malformed file stops the run without changing the targets, so the agent can correct it first.

Tidy covers the configured instruction sources, map, TODO ledger, and root config. It does not format application source, authored skills, generated agent files, or arbitrary repository files. Your project's own formatter remains responsible for those.

The agent reviews the diff, prepares and commits it, and runs the gate. A second tidy preview should report no changes. For a narrower task, `discern tidy md` or `discern tidy toml` formats only the selected type.

## Check release information

Ask your agent to **check for updates**, choose **Check for updates** from the desk, or run:

```sh
discern releases
```

The release page shows what's changed and whether an upgrade is available. The command opens it in your browser and prints the link so you can open it yourself if needed.

You can ask your agent to check and install an update in one request. If you only ask for a check, it will report what it finds and leave installation for you to decide. discern may remind you to check every couple of weeks.

## Upgrade the project

Updating the installed program and updating a project's setup are separate steps. discern does not check the network for newer releases or replace its own binary.

Read the [release notes](https://discern.sh/releases) before choosing an update.

### 1. Replace and identify the binary

Once you decide to install a newer version, use the supported installer described in [installation and setup](../00-start/first-success.md). It verifies the download checksum before replacing the binary. Open a new shell and check which program will run:

```sh
command -v discern
discern --version
```

Restart your coding-agent sessions after installation so they use the new version.

If the project reports a schema newer than the installed program, install a version that understands it. The schema describes the configuration format; an older program will refuse to stamp it backward.

### 2. Preview from a clean upgrade worktree

Give your agent a bounded request:

> Update this project's setup for the installed discern version. Preview the changes, preserve our authored instructions and skills, and bring the upgrade back with its check results.

The agent uses an isolated worktree and reviews any existing edits before upgrading. It runs:

```sh
discern upgrade --check
discern upgrade --dry-run
```

`--check` reports pending adoption as well as migration and managed-scaffold changes. A migration brings older configuration into the format the running version expects. The dry run shows the previous and proposed `meta.managed_version` values and writes nothing.

### 3. Apply, review, and prove

Your agent runs `discern upgrade`, inspects the changes, and follows any partial-operation recovery. Your authored instructions, skills, scripts, and map remain project-owned; the plan identifies which managed settings or files need changes.

It then uses [Finish and land a change](finish-and-land-a-change.md) to prepare the result for review. After landing, restart coding-tool sessions so their discern connection loads the installed version and current setup. The agent checks `discern doctor`, `discern upgrade --check`, and the fresh connection.

The upgrade is complete when the intended version is installed, no migrations remain, and the changed setup has passed its checks and works in a fresh session.

### Share an upgrade with teammates

When you upgrade a project, commit the changes with your team. The `managed_version` field in `discern.toml` records the newest discern version used to update its managed files; it does not track what teammates have installed.

A teammate using an older discern version will see a message explaining how to update. They check releases, install the update, and restart their coding-agent sessions. They preview and apply `discern upgrade` in the project.

## Remove discern from the repository

You can stop using discern without throwing away the project knowledge you built. Ask your agent to help prepare:

> Help me remove discern from this repository. Identify unfinished work and resources that need attention, then explain the removal preview and what will remain for me to keep.

Uninstall is a CLI-only owner operation. The steps below happen in the main checkout after active work is resolved.

### 1. Close active work safely

Read `discern status`. Land work you want to keep, and review any work you want discarded before explicitly dropping it. Follow the reported cleanup instructions for orphaned resources.

Uninstall refuses while any linked Git worktree remains registered, including a completed checkout you retained, or while the resource ledger records provisioned resources. Those records include the information needed to remove external resources, so deleting the records first would lose the cleanup instructions.

### 2. Preview what leaves and what stays

```sh
discern uninstall --dry-run
```

Review the complete plan. It removes discern's generated files, its entries in shared integration files, managed ignore and attribute blocks, and its Git-admin runtime state. It keeps `discern.toml`, your authored instructions and skills, map content, and recovery refs that may be the only remaining names for your commits.

If a shared setting cannot be removed safely, inspect that setting's ownership before changing it. The [files and ownership reference](../30-reference/files-and-ownership.md) explains the full boundary.

### 3. Apply and inspect the repository diff

```sh
discern uninstall
```

Confirm the prompt after reviewing the plan. `--yes` is available for a non-interactive run you have already authorized.

Inspect `git status` and commit the removal through the repository's ordinary process. Keep recovery refs until you have reviewed the work they preserve.

### 4. Remove the binary separately

Repository uninstall keeps the shared discern program installed. Other projects may still use it. If none do and you want to remove it, use `which discern` to identify the installed program before deleting it.

Removal is complete when the planned wiring has gone, your authored content remains, and no active resource is left without its cleanup record. [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) covers cleanup that prevents uninstall.
