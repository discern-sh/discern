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

Keep discern healthy and current in your project, or take it out, without losing anything you wrote. Your instructions, skills, and map belong to your project, so they stay when you upgrade, and they stay if discern goes.

Pick the task you need: [diagnose a problem](#diagnose-the-installation), [format discern's files](#format-your-instructions-map-and-settings), [check for a new release](#check-release-information), [upgrade](#upgrade-the-project), or [remove discern](#remove-discern-from-the-repository). Your agent can do most of this, but removing discern is a step you run yourself.

## Diagnose the installation

When a discern command or a coding tool's connection stops working, ask:

> "discern has stopped working in this project. Check the installation, explain what's wrong, and fix what you can within the existing setup. Tell me if anything needs access, a restart, or a decision from me."

Your agent starts with `discern doctor`, which changes nothing. It checks the configuration, the commands your project needs, generated files, coding-tool connections, and Git settings, and names a fix for each problem.

A missing command and a broken configuration need different fixes, so the agent explains what it found before changing anything, applies the fix doctor names, and runs doctor again. A clean doctor run covers the installation, and a repaired connection also needs a new coding-tool session that can reach discern.

For a bug report, `discern doctor --json` captures the full result. [Troubleshooting](../40-troubleshooting/README.md) matches common symptoms to their fixes.

## Format your instructions, map, and settings

If your instructions, map, or `discern.toml` have become hard to read, ask:

> "Tidy up the formatting of the files discern manages, and bring the changes back for review."

The agent works in the task's **worktree**, a separate copy of the project for this task, and previews before it formats:

```sh
discern tidy --dry-run
discern tidy
```

The preview lists the files that would change. Tidy formats your instruction sources, the map, the work ledger (`discern/TODO.md` by default), and `discern.toml`. It leaves your code, skills, and each coding tool's generated files alone, because your project's own formatter handles those.

Tidy reads every file before it writes any, so if one can't be parsed, tidy stops without changing anything and the agent fixes that file first. To format only one kind of file, use `discern tidy md` or `discern tidy toml`.

The agent reviews the changes, commits them, and runs the **gate**, your project's own commands, such as its formatter, linter, and tests, which a change must pass before it counts as finished. A second `discern tidy --dry-run` should then report `0 files would change`.

## Check release information

To find out whether a newer discern is out, ask your agent, choose **Check for updates** from the desk, or run:

```sh
discern releases
```

The **desk** is the interactive view that opens when you run `discern` in your main checkout, your original project folder. The release page shows what's changed and whether an upgrade is available. In a terminal, `discern releases` opens the page in your browser, and it always prints the link, so an agent can pass it to you.

If you only ask for a check, your agent reports what it finds and leaves the install to you, and you can also ask it to check and install in one request. Every 14 days, `discern status`, `discern doctor`, and the desk remind you to check again.

## Upgrade the project

discern never downloads a new version or replaces itself, so you install the new discern program, and then your agent updates your project's setup to match. Read the [release notes](https://discern.sh/releases) before you decide.

### 1. Install the new version

Use the installer from [Installation and setup](../00-start/installation-and-setup.md). It checks the download's checksum before replacing the program. Then open a new terminal and confirm which program runs:

```sh
command -v discern
discern --version
```

Restart your coding-agent sessions so they use the new version.

If your project needs a newer discern than you have installed, `discern upgrade` refuses and tells you to run the installer again.

### 2. Preview the upgrade

Say you've installed discern 1.0.1 on a project that 1.0.0 last set up. `discern doctor` and `discern status` now tell your agent:

```text
This project was last upgraded with discern 1.0.0; this binary is 1.0.1. Preview the changes with `discern upgrade --dry-run`, then run `discern upgrade`.
```

Give your agent a clear request:

> "Update this project's setup for the discern version I just installed. Preview the changes, keep our instructions and skills, and bring the upgrade back with what passed."

The agent works in a worktree, and upgrade needs one with no uncommitted changes. It previews first:

```sh
discern upgrade --check
discern upgrade --dry-run
```

`--check` lists what's pending: configuration changes the new version needs, and updates to the files discern manages. The dry run shows the planned changes and writes nothing.

### 3. Apply, check, and land

Your agent runs `discern upgrade` and reviews the result. The upgrade changes only discern's own settings and files, so your instructions, skills, scripts, and map stay yours. If upgrade can't finish, its result says what's left and how to recover.

Then the agent runs the gate and brings the upgrade back for review, as in [Finish and land a change](finish-and-land-a-change.md). After it lands, restart your coding-tool sessions. The agent confirms that `discern doctor` passes, `discern upgrade --check` lists nothing, and a new session can reach discern.

If your project runs discern in CI, raise the version CI installs in the same change. [Run the gate in CI](run-the-gate-in-ci.md) explains why.

### Share an upgrade with teammates

Commit the upgrade so your team gets it. `discern.toml` records the newest discern version that updated the project, as `[meta].managed_version`, and doesn't track which version each teammate has installed. So a teammate still on 1.0.0 sees:

```text
This project was last upgraded with discern 1.0.1; this binary is 1.0.0. Check releases before changing discern-managed files: run `discern releases`. After installing a suitable update, restart your coding-agent sessions. Development builds may be ahead of the latest public release.
```

Until they upgrade, their discern still reads the project and runs tests, but it won't run the gate or change discern's files. They run `discern releases`, install the new version, and restart their coding-agent sessions.

## Remove discern from the repository

You can stop using discern without losing the project knowledge you built. Ask your agent to help you prepare:

> "Help me remove discern from this repository. Find unfinished work and resources that need attention, then explain the removal preview and what will stay for me to keep."

You run the removal yourself, in your **main checkout**, your original project folder, because `discern uninstall` isn't among the tools discern gives your agent.

### 1. Finish or close open work

Run `discern status`. Land the work you want to keep, and review anything you want to throw away before you remove it.

Uninstall refuses while any task worktree is still registered, even a finished one you kept:

```text
refusing to uninstall while 1 linked worktree(s) are still active — land or remove them first, then uninstall from the main checkout.
```

It also refuses while discern still tracks resources a worktree set up, such as a test database. Those records hold the commands that remove each resource, so they have to go last. `discern worktree prune` cleans them up.

### 2. Preview what goes and what stays

```sh
discern uninstall --dry-run
```

Review the plan before you go on. discern removes:

- the files it generated, such as each tool's instruction file and skills folder;
- its entries in settings files it shares with you;
- its blocks in `.gitignore` and `.gitattributes`;
- its own Git settings and the working state it keeps inside `.git`.

It keeps `discern.toml`, your instructions, skills, scripts, map, and work ledger. It also keeps every Git reference, including recovery references that may be the only name left for some of your commits, and prints the commands to remove them later, once you've checked them.

The [Files and ownership](../30-reference/files-and-ownership.md) reference lists every file and who owns it.

### 3. Remove it and review the result

```sh
discern uninstall
```

In a terminal, uninstall asks you to confirm. Without a terminal, or with `--json` or `--markdown`, it changes nothing until you add `--yes`, so add it only after you've reviewed the preview.

Then check `git status` and commit the removal the way your repository usually takes changes.

### 4. Remove the program, if you want

Uninstall leaves the discern program installed, because other projects may still use it. If none do, find it with `which discern` and delete that file.

Removal is done when the planned removals have happened, everything you wrote is still there, and no resource was left without its cleanup record. [Worktrees and resources](../40-troubleshooting/worktrees-and-resources.md) helps when something blocks uninstall.
