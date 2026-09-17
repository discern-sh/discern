---
id: troubleshoot-setup-and-integrations
title: "Setup and integrations"
description: "Resume an interrupted setup, fix installation problems, or activate discern in your coding agent."
order: 20
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-setup-and-integrations"
  - "Setup command boundaries"
  - "setup write authority"
  - "setup activation"
  - "setup recovery"
  - "Recover an interrupted worktree setup step"
  - "worktree setup recovery"
  - "setup step journal"
  - "ambiguous setup step"
  - "command not found"
  - "no_project"
  - "write_access"
  - "schema_version_too_new"
  - "partial_refresh"
  - "unsupported platform"
---

# Setup and integrations

If installation or setup stopped, keep the files it created. Ask your agent:

> Find where setup stopped and follow the next action in its result. Tell me what already completed, what still needs doing, and whether you need a decision from me.

For a first installation, start with the symptom below. For setup already underway, run `discern setup` to read its saved phase. You usually have part of a working setup to continue.

## `discern: command not found`

Open a new shell and run `which discern`. If it prints nothing, add the install directory the installer reported to that shell's `PATH`, then try again.

If discern works in your terminal but your agent cannot find it, ask the agent to check its own `PATH`. Agents may use a non-interactive shell with different startup files. Make the install directory available there, or give the agent the binary's absolute path.

You are ready to continue when `discern --version` works in the shell that will run the task.

## Setup won't start

Use the reported condition to choose the next step:

| What you see                    | What to do                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| No project found                | Move into the existing project. For a new installation here, read `discern setup`, then begin with `discern setup begin`.                     |
| Unsupported platform            | Use a supported macOS or Linux environment. On Windows, use WSL 2. See the [support matrix](../30-reference/platforms-and-providers.md).      |
| `schema_version_too_new`        | [Upgrade the binary](../10-guides/maintain-or-remove-discern.md), then retry. This project's configuration was written by a newer discern.    |
| `write_access` or a denied path | Check the exact path named in the result. Give the invocation access to that path through your environment's permission controls, then retry. |

A denied write leaves the setup phase available to resume. discern checks the paths its plan needs; it cannot change your system's permissions or promise that access will remain available later.

## Setup was interrupted

Run `discern setup` or `discern status`. Read the saved phase, branch, and next action before issuing another setup command. Completed scaffold writes remain recorded, so resuming `setup begin` can reprint the brief and continue the work.

**The completion result was lost.** First read status or the stored result. If `setup done` already completed and the proved commit remains unchanged and clean, repeating `discern setup done` has a specific replay path: it returns the saved Proof and completion facts with no gate run or repeated effects. A changed or unproven setup needs the recovery reported for its current state.

**A worktree setup step is marked `running`.** This is a different interruption: a project command may have changed something outside Git before its result was recorded. Have your agent inspect the named effect, such as whether a local database was created. When a person has confirmed that it completed, record that observation:

```sh
discern worktree setup --mark-step-complete <id> --confirmed
```

When a person has confirmed that another run is appropriate, use:

```sh
discern worktree setup --retry-step <id> --confirmed
```

Use the step id in the result. The first action records completion; the second authorizes a retry. Neither should be chosen from the journal alone: `running` does not tell you whether the external effect happened. If you cannot establish that, preserve the state and involve whoever owns the resource.

## Setup can't prove or land

Read the first diagnostic from `discern setup done`. Ask your agent to fix that specific problem, verify the correction, and retry setup completion. Common blockers include unfinished instructions, uncommitted files, a failed project check, or worktree setup that cannot recreate what the project needs.

If the check works in the original checkout but fails in the worktree used to prove setup, inspect what the copy is missing. Shared dependencies belong in `[repository].ensure`, repeatable worktree preparation in `[worktree.setup]`, and external resources in `[worktree.resources]`. The result names the failing command; use it to locate the missing prerequisite.

Success is a proven setup with its returned Proof. On a setup branch, the next step is the owner's landing decision through `discern setup accept`. A repeated acceptance recognizes an already completed landing. An installation with no Git repository cannot become proven until Git is initialized and the setup files are committed.

The [gate and Proof page](gate-and-proof.md) explains failed checks and changed files in more detail.

## `discern doctor` reports a failed check

Apply the correction printed for the failed check, then run `discern doctor` again. A passing recheck confirms that particular installation problem is resolved. Warnings are advice; failed checks identify conditions that can prevent work, such as a missing job command or an unusable Git identity.

For a generated-file merge finding, use the remedy for the named configuration or attribute:

- A missing or stale discern-managed entry may need `discern refresh`.
- An overriding Git attribute needs correction at the file and rule the finding names.
- A merge-driver configuration error needs the printed Git configuration fix. The driver belongs in the clone's common local configuration, shared by its linked worktrees.

Verify an attribute correction with the finding's `git check-attr` command, then rerun doctor. Avoid applying a generic Git configuration recipe to every finding: the owning setting determines the repair.

If the fix belongs to another system, such as filesystem ownership, resolve it there. Keep `discern doctor --json` output when you need to explain the unresolved finding to someone else.

## An agent's integration files are missing or stale

Run:

```sh
discern refresh
```

Ask your agent to review the result and commit any intended tracked changes. Refresh rebuilds selected agents' instructions, skills, and integration files from their configured sources.

If refresh reports a malformed provider settings file, repair the named file first and retry. If setup or upgrade reports `partial_refresh`, its earlier effects remain in place; the reported recovery is `discern refresh`. Completion means the refresh result reports `complete`, which can include no rewritten files when everything was already current.

To keep a wording change, edit the authored instruction or skill source, then refresh. The [files and ownership reference](../30-reference/files-and-ownership.md) distinguishes those sources from generated copies.

## The tools don't appear in the agent's session

Start a fresh agent session after setup acceptance or an upgrade. Have the agent inspect its available tools and invoke the exact callable named in the handoff, for example `mcp__discern__discern_status` on a host that uses that namespace.

If it is still unavailable:

1. Run `discern doctor` to check that the selected provider's integration files and MCP registration exist and parse.
2. Check the provider's interface for a required server trust or approval step.
3. Continue through `discern status --markdown` or `--json` while resolving activation. The CLI provides the corresponding discern commands.

Activation is confirmed when the new session can call the registered status tool. Files on disk alone cannot confirm that the provider loaded them. For tools that stopped working during a session, see [MCP, terminal, and docs](mcp-terminal-and-docs.md#the-discern-tools-are-missing-from-the-session).

## When to stop

Your agent can continue routine diagnosis and repair within the task you authorized. A new decision is needed when the result asks for setup or landing consent, or when an ambiguous external effect needs a person's confirmation. Provider trust approval happens in the provider's interface.

If the documented correction fails, keep the result and the state it describes. [Crashes and local state](crashes-and-local-state.md) explains what to capture for a report.
