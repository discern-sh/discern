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

Keep discern healthy and current in your project, or take it out, without losing anything you wrote. Your instructions, skills, and map belong to your project. They stay when you upgrade, and they stay if discern goes.

Pick the task you need: [diagnose a problem](#diagnose-the-installation), [format discern's files](#format-discerns-files), [check for a new release](#check-release-information), [upgrade](#upgrade-the-project), or [remove discern](#remove-discern-from-the-repository). Your agent can do most of this. Removing discern is a step you run yourself.

## Diagnose the installation

When a command or a coding tool's connection stops working, ask:

> Check this project's discern installation and explain what's wrong. Fix what you can within the existing setup, then tell me whether anything needs access, a restart, or a decision from me.

Your agent starts with `discern doctor`. It changes nothing. It checks the configuration, the commands your project needs, generated files, coding-tool connections, and Git settings. For each problem, it names a fix.

A missing command and a broken configuration need different fixes. So the agent explains what it found before changing anything, applies the fix doctor names, and runs doctor again. A clean doctor run covers the installation. A repaired connection also needs a new coding-tool session that can reach discern.

For a bug report, `discern doctor --json` captures the full result. [Troubleshooting](../40-troubleshooting/README.md) matches common symptoms to their fixes.

## Format discern's files

If your instructions, map, or `discern.toml` have become hard to read, ask:

> Format the files discern manages, review the changes, and bring them back through the project's checks.

In the task's worktree, a separate copy of the project for this task, the agent previews and then formats:

```sh
discern tidy --dry-run
discern tidy
```

The preview lists the files that would change. Tidy formats your instruction sources, the map, the work ledger (`discern/TODO.md` by default), and `discern.toml`. It leaves your code, skills, and each coding tool's generated files alone. Your project's own formatter handles those.

Tidy reads every file before it writes any. If one can't be parsed, tidy stops without changing anything, so the agent fixes that file first. To format only one kind of file, use `discern tidy md` or `discern tidy toml`.

The agent reviews the changes, commits them, and runs the gate, the full set of checks your project requires. A second `discern tidy --dry-run` should then list nothing.

## Check release information

Ask your agent to **check for updates**, choose **Check for updates** from the desk, or run:

```sh
discern releases
```

The **desk** is the interactive view that opens when you run `discern` in your main checkout. The release page shows what's changed and whether an upgrade is available. In a terminal, `discern releases` opens the page in your browser. It always prints the link, so an agent can pass it to you.

If you only ask for a check, your agent reports what it finds and leaves the install to you. You can also ask it to check and install in one request. Every 14 days, `discern status`, `discern doctor`, and the desk remind you to check again.

## Upgrade the project

To upgrade, you install the new discern program, then your agent updates your project's setup to match. discern never downloads a new version or replaces itself. Read the [release notes](https://discern.sh/releases) before you decide.

### 1. Install the new version

Use the installer from [Installation and setup](../00-start/installation-and-setup.md). It checks the download's checksum before replacing the program. Then open a new terminal and confirm which program runs:

```sh
command -v discern
discern --version
```

Restart your coding-agent sessions so they use the new version.

If your project needs a newer discern than you have installed, `discern upgrade` refuses and tells you to run the installer again.

### 2. Preview the upgrade

Give your agent a clear request:

> Update this project's setup for the installed discern version. Preview the changes, keep our instructions and skills, and bring the upgrade back with its check results.

The agent works in a worktree, and upgrade needs one with no uncommitted changes. It previews first:

```sh
discern upgrade --check
discern upgrade --dry-run
```

`--check` lists what's pending: configuration changes the new version needs, and updates to the files discern manages. The dry run shows the planned changes and writes nothing.

### 3. Apply, check, and land

Your agent runs `discern upgrade` and reviews the result. Your instructions, skills, scripts, and map stay yours. The upgrade only changes discern's own settings and files. If upgrade can't finish, its result says what's left and how to recover.

Then the agent runs the gate and brings the upgrade back for review, as in [Finish and land a change](finish-and-land-a-change.md). After it lands, restart your coding-tool sessions. The agent confirms that `discern doctor` passes, `discern upgrade --check` lists nothing, and a new session can reach discern.

If your project runs discern in CI, raise the version CI installs in the same change. [Run the gate in CI](run-the-gate-in-ci.md) explains why.

### Share an upgrade with teammates

Commit the upgrade so your team gets it. `discern.toml` records the newest discern version that updated the project, as `[meta].managed_version`. It doesn't track which version each teammate has installed.

A teammate with an older discern sees a message saying so. Until they upgrade, their discern still reads the project and runs tests, but it won't run the gate or change discern's files. They run `discern releases`, install the new version, and restart their coding-agent sessions.

## Remove discern from the repository

You can stop using discern without losing the project knowledge you built. Ask your agent to help you prepare:

> Help me remove discern from this repository. Find unfinished work and resources that need attention, then explain the removal preview and what will stay for me to keep.

You run the removal yourself, in your main checkout, your original project folder. It isn't among the tools discern gives your agent.

### 1. Finish or close open work

Run `discern status`. Land the work you want to keep. Review anything you want to throw away before you remove it.

Uninstall refuses while any task worktree is still registered, even a finished one you kept. It also refuses while discern still tracks resources a worktree set up, such as a test database. Those records hold the commands that remove each resource, so they have to go last. `discern worktree prune` cleans them up.

### 2. Preview what goes and what stays

```sh
discern uninstall --dry-run
```

Review the plan before you go on. discern removes:

- the files it generated, such as each tool's instruction file and skills folder;
- its entries in settings files it shares with you;
- its blocks in `.gitignore` and `.gitattributes`;
- its own Git settings and the working state it keeps inside `.git`.

It keeps `discern.toml`, your instructions, skills, scripts, map, and work ledger. It also keeps every Git reference, including recovery references that may be the only name left for some of your commits. discern prints the commands to remove them later, once you've checked them.

The [Files and ownership](../30-reference/files-and-ownership.md) reference lists every file and who owns it.

### 3. Remove it and review the result

```sh
discern uninstall
```

In a terminal, uninstall asks you to confirm. `--yes` skips the question, and so do `--json` and `--markdown`. Only use them after you've reviewed the preview.

Then check `git status` and commit the removal the way your repository usually takes changes.

### 4. Remove the program, if you want

Uninstall leaves the discern program installed, because other projects may still use it. If none do, find it with `which discern` and delete that file.

Removal is done when the planned removals have happened, everything you wrote is still there, and no resource was left without its cleanup record. [Worktrees and resources](../40-troubleshooting/worktrees-and-resources.md) helps when something blocks uninstall.
