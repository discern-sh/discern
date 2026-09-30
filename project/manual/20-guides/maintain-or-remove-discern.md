---
id: guide-maintain-or-remove-discern
title: "Maintain or remove discern"
description: "Diagnose, tidy, and upgrade discern in your project, or remove it and keep everything you wrote."
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

Keep discern healthy and current in your project, or take it out, without losing anything you wrote. Your agent does most of the work. Your instructions, skills, and map belong to your project, so they stay when you upgrade, and they stay if discern goes.

## Diagnose the installation

When a discern command or a coding tool's connection stops working, ask:

> "discern has stopped working. Check the installation, fix what you can, and tell me what you need from me."

Your agent runs `discern doctor`, which changes nothing and names a fix for each problem it finds. The agent explains what it found, applies the fixes, and runs doctor again. A clean run covers the installation, and a repaired connection also needs a new coding-tool session. [Troubleshooting](../40-troubleshooting/README.md) matches common symptoms to their fixes.

## Format your instructions, map, and settings with tidy

If your instructions, map, or `discern.toml` get hard to read, ask:

> "Tidy up the formatting of the files discern manages, and bring the changes back for review."

The agent previews, then formats, in its **worktree**, a separate copy of the project:

```sh
discern tidy --dry-run
discern tidy
```

Tidy formats your instruction sources, the map, the work ledger (`discern/TODO.md` by default), and `discern.toml`, and leaves your code, skills, and generated files to your project's own formatter. If a file can't be parsed, tidy changes nothing until the agent fixes it.

The agent reviews and commits the changes, then runs the **gate**, your project's own commands, such as its linter and tests. It's done when a second `discern tidy --dry-run` reports `0 files would change`.

## Check release information

To find out whether a newer discern is out, ask your agent or run:

```sh
discern releases
```

`discern releases` points you to the release page, which shows what's changed and whether an upgrade is available. The **desk**, the interactive view that opens when you run `discern` in your main checkout, your original project folder, offers **Check for updates** too. Your agent does only what you ask: a check, or a check and an install. `discern status`, `discern doctor`, and the desk remind you to check every 14 days.

## Upgrade the project

discern never downloads a new version or replaces itself, so you install the new program, and then your agent updates your project's setup to match.

### 1. Install the new version

Use the installer from [Installation and setup](../00-start/installation-and-setup.md), then open a new terminal and confirm which program runs:

```sh
command -v discern
discern --version
```

Restart your coding-agent sessions so they use the new version.

### 2. Preview the upgrade

Say you've installed discern 1.0.1 on a project that 1.0.0 last set up. `discern doctor` and `discern status` now tell your agent:

```text
This project was last upgraded with discern 1.0.0; this binary is 1.0.1. Preview the changes with `discern upgrade --dry-run`, then run `discern upgrade`.
```

Ask your agent:

> "Update this project for the discern version I just installed. Keep our instructions and skills, and bring the upgrade back with what passed."

The agent previews first, in a clean worktree:

```sh
discern upgrade --check
discern upgrade --dry-run
```

### 3. Apply, check, and land

The agent runs `discern upgrade`, which changes only discern's own settings and files. If upgrade can't finish, its result says what's left and how to recover. Then the agent runs the gate and brings the upgrade back for review, as in [Finish and land a change](finish-and-land-a-change.md). If your project runs discern in CI, raise the version CI installs in the same change, as [Run the gate in CI](run-the-gate-in-ci.md) explains.

After it lands, restart your coding-agent sessions. The upgrade is done when `discern doctor` passes, `discern upgrade --check` lists nothing, and a new session can reach discern.

### Share an upgrade with teammates

Teammates get the upgrade when they pull it. A teammate still on 1.0.0 then sees:

```text
This project was last upgraded with discern 1.0.1; this binary is 1.0.0. Check releases before changing discern-managed files: run `discern releases`. After installing a suitable update, restart your coding-agent sessions. Development builds may be ahead of the latest public release.
```

Until they upgrade, their discern still reads the project and runs tests, but it won't run the gate or change discern's files.

## Remove discern from the repository

You can stop using discern and keep everything you wrote. Ask your agent to help you prepare:

> "Help me remove discern from this repository. Find unfinished work that needs attention, and explain the removal preview and what will stay."

You run the removal yourself, in your **main checkout**, your original project folder, because `discern uninstall` isn't among the tools discern gives your agent.

### 1. Finish or close open work

Land the work you want to keep, and review anything you'll throw away. Uninstall refuses while any task worktree is still registered, even a finished one you kept:

```text
refusing to uninstall while 1 linked worktree(s) are still active — land or remove them first, then uninstall from the main checkout.
```

It also refuses while discern still tracks a resource a worktree set up, such as a test database, because that record holds the command that removes it. `discern worktree prune` cleans these up.

### 2. Preview what goes and what stays

```sh
discern uninstall --dry-run
```

The plan lists what discern removes:

- the files it generated, such as each tool's instruction file;
- its entries in files it shares with you, such as `.gitignore`;
- its own Git settings and the state it keeps inside `.git`.

It keeps `discern.toml`, your instructions, skills, scripts, map, and work ledger. It also keeps every Git reference, including recovery references that may be the only name left for some of your commits, and prints the commands to remove them later. [Files and ownership](../30-reference/files-and-ownership.md) lists every file and who owns it.

### 3. Remove it and review the result

```sh
discern uninstall
```

In a terminal, uninstall asks you to confirm. Without that prompt, it changes nothing until you add `--yes`, so add that only after you've reviewed the preview. Then check `git status` and commit the removal as you usually would.

### 4. Remove the program, if you want

Uninstall leaves the discern program installed, because other projects may still use it. If none do, find it with `which discern` and delete that file.

Removal is done when the planned removals have happened, everything you wrote is still there, and no resource was left without its cleanup record. [Worktrees and resources](../40-troubleshooting/worktrees-and-resources.md) helps when something blocks uninstall.
