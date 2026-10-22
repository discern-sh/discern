---
id: guide-use-discern-alongside-other-agent-tools
title: "Use discern alongside other agent tools"
description: "Keep another tool's agent rules, skills, and settings working beside discern's, so neither tool undoes the other's files."
order: 135
publish: true
kind: guide
aliases:
  - "guide-use-discern-alongside-other-agent-tools"
  - "other agent tools"
  - "agent kit"
  - "skill installer"
  - "third-party agent tooling"
  - "tool-maintained agent file"
  - "coexist with another tool"
---

# Use discern alongside other agent tools

Your project can keep its other agent tools when you add discern, such as a framework's agent kit or a skill installer. Their rules, skills, and settings keep working beside discern's. If discern would overwrite another tool's lines in an agent file, it says so and lists them, so nothing disappears without notice.

Say your recipe app comes from a web framework. Its agent kit keeps a section of rules in `AGENTS.md`, installs skills into `.claude/skills/`, and adds its own server to `.mcp.json`.

## Where discern and other tools share files

What happens to the kit's content depends on the file.

| Shared file                                            | What happens to the kit's content                                               | Details                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Coding tools' configuration files, such as `.mcp.json` | discern changes only its own entries.                                           | [Shared provider configuration](../30-reference/files-and-ownership.md#shared-provider-configuration)             |
| Skills folders, such as `.claude/skills/`              | discern owns only the entries it placed.                                        | [Skills directories](../30-reference/files-and-ownership.md#skills-directories)                                   |
| Agent files, such as `AGENTS.md`                       | discern compiles every line from sources, so the kit needs a source of its own. | [Route a tool's instructions](#route-a-tools-instructions-through-a-source)                                       |
| `.gitignore`                                           | discern's block re-includes only its own files.                                 | [Integration files your rules ignore](../30-reference/files-and-ownership.md#integration-files-your-rules-ignore) |

Only the agent files need a change before the kit's lines survive `discern refresh`, which rebuilds them.

## Set up discern when a tool already writes agent files

Ask your agent to set up discern, and say what else writes into the project:

> "Set up discern here. Our framework's agent kit also writes agent rules and skills. Keep its output working, and ask me only what the files don't settle."

Your agent reads each existing agent file, such as `AGENTS.md`, and decides whether you wrote it or the kit maintains it. It asks you only when the file doesn't settle it.

- **Your own rules** move into your instruction source, `discern/instructions.md` by default. discern compiles that file into every agent file.
- **A file the kit maintains** is left out with [`--tool-maintained`](../30-reference/cli-reference.md#discern-setup-begin), because a copy would go stale as the kit rewrites its lines. The first compile replaces the file, and setup's result says how to route the kit.
- **A settings file that held the kit's entries** stays out of setup's commit if it isn't committed yet. Those entries can be personal settings or credentials, so your agent reviews the file first, as [Your ignore rules exclude agent tool folders](../40-troubleshooting/setup-and-integrations.md#your-ignore-rules-exclude-agent-tool-folders) describes.

## Route a tool's instructions through a source

The kit's rules reach every agent file the way yours do. The kit writes them into a file of its own. Your agent lists that file in `[instructions].sources`, and declares it under `[generated.<name>]` with its **generator**, the command that rebuilds it. [Another tool writes into an agent file](../40-troubleshooting/setup-and-integrations.md#another-tool-writes-into-an-agent-file) shows the settings.

**You choose the order.** Each agent file starts with discern's own instructions, then your sources in the order you list them. Put the kit's file first if your rules build on it, or after yours if it should have the last word.

**Formatting leaves the kit's file alone.** `discern tidy`, which formats Markdown and TOML files, skips any file a generator owns, so it doesn't reformat the kit's output.

**The kit's command runs with every check.** `discern prepare` reruns it, then rebuilds the agent files. `discern done` runs the **gate**: your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. The gate reruns the kit's command and fails at `generated_drift` if the committed file differs from its output, so no agent reads a stale copy.

## Keep another tool's skills

The kit's skills can stay where the kit puts them, or discern can link them into every coding tool.

### Leave them in each tool's skills folder

This is the default, and it needs nothing from you. The kit keeps writing its skills into the folders it knows, such as `.claude/skills/`, and discern leaves them alone. Your project commits them, so every worktree and fresh clone gets them. A coding tool whose folder the kit doesn't write gets none of them.

If a kit skill shares a name with one of discern's, `discern done` stops until you free the name, as [Skills directories](../30-reference/files-and-ownership.md#skills-directories) explains.

### Link them into every coding tool

Your agent can instead point the kit's skill output into `[skills].dir`, `discern/skills/` by default. It declares those paths under `[generated.<name>]`, and discern links each skill into every coding tool's skills folder, as it does your own. A kit that writes only into its own folder works too. Your agent links each of its skills from `[skills].dir`, and discern follows a relative link that stays inside the project.

- If your own skills live in `[skills].dir` too, your agent declares the kit's skill folders one by one. When branches merge, Git keeps one side of a generated file instead of combining both sides' edits, and your own skills need both.
- Never declare a generated group over a coding tool's skills folder, or over another file discern writes, such as an agent file. discern already writes those, and the two writers would keep undoing each other.

When a kit skill moves into `[skills].dir`, your agent deletes its old committed copy in the same commit. discern won't replace an entry it didn't place, so `discern done` stops at its `skills` stage and names any copy left behind.

## Keep results the same in every checkout

Other tools can behave differently from one session, checkout, or computer to the next.

### Open sessions in the worktree

Your coding tool starts some tools with each session, such as the kit's server, a language server, or a dev server, and they work in the folder the session opened. Say your agent moves into a **worktree**, a separate copy of the project on its own branch, during a session opened in the main checkout. discern moves only its own server there, so the kit's server still reads the main checkout. Prefer a session your coding tool opens in the worktree. [Platforms and providers](../30-reference/platforms-and-providers.md) says how each coding tool works with worktrees.

### Inherit the settings your app reads

discern copies only the env names listed in `[worktree].inherit_env` from the main checkout into a new worktree. If your app reads its mode or debug settings from `.env`, add those names, or the app can start differently in a worktree. Leave connection strings off the list, so each worktree keeps its own database. [Inherit selected env values](../30-reference/worktrees-and-status.md#inherit-selected-env-values) has the exact rules.

### Keep generated output stable across computers

The gate reruns each declared generator and compares its output with the committed file. A kit that writes the time into its output fails every run. One that writes its version or an absolute path fails wherever that value differs, such as on a teammate's computer. Pin the kit's version, or don't declare output that changes between computers.

### Watch for tools that detect agents

Some tools change their output when they detect a coding agent, often from a variable the coding tool sets. The gate passes the environment it runs in to each command, so a test or generator can behave differently in your agent's runs than in yours. If the gate passes for one of you and fails for the other, compare the two environments. For a declared generator, set that variable to one value in its `run` command.

### Keep one home for project knowledge

If the kit keeps its own store of rules or decisions, an agent can find two answers to one question. Pick one home for each kind of knowledge, or link one to the other. Then your project's **map**, its guide to how it works, stays the answer agents trust. [Pick the right home](../10-understand/instructions-skills-and-map.md#pick-the-right-home) shows where each kind of lesson belongs.

## When it's done

- Each agent file holds your rules and the kit's, compiled from their sources.
- The change passed the gate with the kit's command declared, and landed with your permission.
- The kit's skills reach every coding tool you use.
- A session opened in a worktree runs the kit's server against that worktree.

When you [connect another coding tool](connect-a-coding-agent.md) later, it gets the kit's rules too, because its agent file compiles from the same sources.
