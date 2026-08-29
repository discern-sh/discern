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

Use this guide to diagnose an installation, format the surfaces discern owns, bring a project forward after replacing the binary, or remove discern's wiring while retaining project-authored work. Choose one outcome below; each has a different starting state and completion condition.

discern never checks the network for a newer release and never replaces its own binary. Project upgrade and binary replacement are separate acts.

## Diagnose the installation

Start here when a command, configured job, provider integration, Git safety setting, or worktree environment appears wrong.

**Person or coding agent:** From anywhere inside the project, run:

```sh
discern doctor
```

Doctor is read-only. It checks config and schema validity, configured commands on `PATH`, Git recovery and identity, generated files, Skills, integrations, resource commands, and Logbook storage. A failure names the observed fact and recovery; apply that action and rerun doctor.

For a bug report or machine consumer, capture the structured result:

```sh
discern doctor --json
```

Diagnosis is complete when doctor passes or the result identifies an external decision or prerequisite the person must supply. Use [Troubleshooting](../40-troubleshooting/README.md) to match that symptom to its recovery family.

## Format discern-owned surfaces

Use this path when configured instruction sources, the Map, the TODO ledger, or root `discern.toml` need canonical formatting.

**Coding agent:** Work in the task's owned worktree. Preview first:

```sh
discern tidy --dry-run
```

Review the named files, then apply both Markdown and TOML formatting:

```sh
discern tidy
```

Use `discern tidy md` or `discern tidy toml` only when the task intentionally covers one type. The planner parses every target before the first write; a malformed file refuses the run and leaves all targets unchanged.

Review the diff. Tidy does not format application source, authored Skills, generated agent files, or files outside the configured owned surfaces. When the project has its own formatter, keep that formatter first and discern tidy last in the serial fix-stage job.

Run `discern prepare`, commit the formatting, and run the full Gate. Formatting is complete when a second `discern tidy --dry-run` reports no changes and the Gate stays green.

## Upgrade the project

Use this path after the person decides to install a newer discern binary.

### 1. Replace and identify the binary

**Person:** Use the same supported installer used for the first install. The [quickstart](../00-start/first-success.md) holds the current command and platform prerequisites.

Open a new shell, then verify which program will run:

```sh
which discern
discern --version
```

If the project says its schema is newer than this binary, stop and install a binary at least as new as the project. An older binary refuses to stamp the config backward.

### 2. Preview from a clean upgrade worktree

**Coding agent:** Keep the upgrade diff isolated in one worktree and commit or otherwise recover any existing edits first.

```sh
discern upgrade --check
discern upgrade --dry-run
```

`--check` exits nonzero when project migrations are pending. The dry run lists migrations, fixed scaffold reconciliation, managed Git-ignore and attribute fragments, and instruction or Skill refresh without writing.

Review the plan. `--allow-dirty` bypasses the clean-tree guard and makes the resulting diff harder to attribute; use it only when the person has supplied another recoverable snapshot and accepts that tradeoff.

### 3. Apply, review, and prove

```sh
discern upgrade
```

The command runs pending migrations in order, validates before stamping the schema version, reconciles discern-owned shared entries, and refreshes generated instructions, Skills, and integrations. Project-owned instruction sources, authored Skills, scripts, Map pages, and configured values remain owned by the project.

Review every changed file. Follow a partial refresh recovery until top-level `ok` is true. Run `discern prepare`, commit the complete upgrade diff, then run `discern done`.

After the change lands, **person:** close and restart provider sessions so their MCP process loads the new binary and embedded material. Then verify:

```sh
discern doctor
discern upgrade --check
```

The upgrade is complete when the installed version is the intended one, the project check reports no pending migration, doctor passes, fresh provider sessions activate, and the landed diff has current Proof.

## Remove discern from the repository

Use this path only after the person decides the repository should stop using discern. Uninstall is a CLI-only owner operation.

### 1. Close active work safely

**Person:** From the main checkout, inspect `discern status`. Land work that should be kept, or review and explicitly drop work that should be discarded. Reclaim orphaned resources through `discern worktree prune`.

Uninstall refuses while a discern worktree is in flight or the resource ledger still records provisioned resources. Those records hold the destroy commands needed for safe cleanup.

### 2. Preview what leaves and what stays

```sh
discern uninstall --dry-run
```

Read the complete plan. It should remove generated files, discern-owned entries in shared integration files, managed ignore and attribute blocks, and discern's Git-admin runtime state. It keeps `discern.toml`, project-owned instructions, authored Skills, Map content, and drop recovery refs that may be the only names for user commits.

If the plan names a shared setting it cannot remove safely, handle that exact setting after reviewing its owner. Do not delete the surrounding shared file.

### 3. Apply and inspect the repository diff

```sh
discern uninstall
```

Confirm the prompt after reviewing the plan. Use `--yes` only in an already-authorized noninteractive run.

Inspect `git status` and commit the removal according to the repository's ordinary process. Review retained recovery refs before deleting any with `git update-ref -d <ref>`.

### 4. Remove the binary separately

```sh
which discern
```

**Person:** Delete that installed binary only when no other project on the machine needs it. Repository uninstall does not remove a shared program from the machine.

Removal is complete when the repository no longer carries discern's generated or shared wiring, project-owned content named by the plan remains, no active resource is orphaned, and the person has made a separate decision about the installed binary.

## Reference and recovery

[Files and ownership](../30-reference/files-and-ownership.md) lists the full footprint and uninstall boundary. [Setup and integrations troubleshooting](../40-troubleshooting/setup-and-integrations.md) covers partial refresh and activation, while [Worktree troubleshooting](../40-troubleshooting/worktrees-and-resources.md) covers resources or cleanup that block removal.
