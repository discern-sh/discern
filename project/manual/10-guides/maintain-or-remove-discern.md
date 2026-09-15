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

Ask your agent to **check for updates**, or choose **Check for updates** from the desk commands. You can also run:

```sh
discern releases
```

The command prints browser and JSON addresses for this running process's version. In an ordinary terminal it also tries to open the browser. The desk action opens the same information and retains a readable result until you return. Opening the address sends the version number to `discern.sh`; no project data is included. The binary makes no network request and installs nothing.

An agent uses `discern releases --json` and fetches the returned JSON address with its permitted network tool. Your request to check already authorizes that check. **Check and install the latest stable version** authorizes both within your requested scope; a request to check alone does not authorize installation. A reminder alone requires your decision before either action.

Read the stable recommendation and notes. The page labels prereleases separately. If no stable release is published, there is no default installation target; a version ahead of the published stable release receives no downgrade advice.

The clone can show a reminder after 14 UTC calendar days. Successful setup or upgrade starts its local clock; a release handoff resets it. A handoff records neither a completed fetch nor known update availability. Showing a reminder does not dismiss it. Linked worktrees share the clock, and turning the logbook off does not affect it.

`--dry-run` writes no timestamp and opens no browser. JSON, Markdown, and non-terminal invocations open no browser. If the launcher is unavailable, use the printed URL. A failed local timestamp write leaves the URL usable.

## Upgrade the project

Updating the installed program and updating a project's setup are separate steps. discern does not check the network for newer releases or replace its own binary.

Read [release notes](https://discern.sh/releases) before choosing an update. The release page compares a supplied version with published stable releases. Opening or fetching it contacts `discern.sh` with that version and no project data.

### 1. Replace and identify the binary

Once you decide to install a newer version, use the supported installer described in [installation and setup](../00-start/first-success.md). It verifies the download checksum before replacing the binary. Open a new shell and check which program will run:

```sh
command -v discern
discern --version
```

Human version output may include a codename after the version number. Names do not affect version comparison. Restart agent and MCP sessions after replacing the binary so the next project operation uses the new process.

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

A successful setup or upgrade records `[meta].managed_version` in `discern.toml`. It is the highest discern release whose managed material the project adopted. Commit it with the reviewed managed-file changes.

When another teammate pulls that commit, their running binary compares itself with the recorded value. An older binary explains both versions and routes them to `discern releases`. It can still report status and run `discern test`, but it refuses to replace newer managed files or issue ordinary Proof without being able to verify their currency.

The teammate checks releases, installs a suitable verified binary within their authorization, and restarts agent and MCP sessions. Binary replacement alone does not adopt the project. They preview and apply `discern upgrade` in the chosen project; only successful adoption records or advances the value. Development builds and prereleases may be ahead of every public stable release, so the release page must establish a suitable target before installation.

If the running binary is newer, the project has not yet adopted its managed material. Preview the upgrade before applying it. If the versions have equal SemVer precedence, the advisory clears and normal managed-file drift checks continue. A same-version upgrade remains useful for reconciliation and preserves the existing value, including build metadata.

This committed number shares project history, not an inventory of installed programs. It is independent of `schema_version`, which controls hard format compatibility, and `setup_version`, which records setup provenance. It does not identify exact executable bytes or prove a public release exists.

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
