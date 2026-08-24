---
title: FAQ and troubleshooting
description: Diagnose common setup, command, MCP, platform, monorepo, worktree, agent-workflow, and removal problems.
order: 50
aliases:
  - faq
  - troubleshooting
  - setup problems
  - doctor
---

# FAQ and troubleshooting

_Match the symptom below, apply the first fix, and use the linked guide when the problem belongs to another part of discern._

## Start with `discern doctor`

Run the install diagnostic from anywhere inside the project:

```sh
discern doctor
```

It checks that `discern.toml` parses, the schema matches the installed binary, configured commands resolve on `PATH`, and each selected coding agent has its expected integration. In a Git repository it also checks recovery retention, author and committer identity, required signing programs, hidden index flags and sparse checkout, worktree-local config placement, and repository ownership. It reads every registered worktree because one checkout can carry a narrower Git override than its siblings.

An empty enabled Logbook is healthy. A denied recording write warns and disables recording for this process without blocking setup; disabled, invalid, and missed-event states stay distinct.

Recovery advice warns without making doctor fail. An unusable commit identity or required signer, hidden tracked paths outside an intentional sparse checkout, unsafe worktree-config placement, or Git's dubious-ownership refusal fails and names the next command. For a bug report, capture the structured result:

```sh
discern doctor --json
```

## `discern: command not found`

Open a new shell, then run `which discern`. If it prints nothing, add the install directory reported by the installer to your shell's `PATH`. When a coding agent launches a non-interactive shell, make sure that shell reads the same `PATH`, or give the agent the absolute binary path.

## The Model Context Protocol tools are unreachable

After setup lands, start the fresh session requested by `setup accept` and run its provider check (`discern_status` for Model Context Protocol integrations). Unlanded `setup done` stops at Proof and landing.

If it is unavailable, follow the served local recovery and use `discern status --json` as the fallback. `discern doctor` diagnoses the integration. Generated files do not prove activation, and discern cannot grant provider trust ([Setup command boundaries](../70-reference/setup-command-boundaries.md)).

Use `--markdown` for concise, prioritized prose or `--json` for exact structured fields. People, coding agents, and scripts can choose either representation to fit the task. Every discern MCP tool has a CLI verb behind it. See [Result formats and delivery](../70-reference/result-surfaces.md).

## The session has left the workflow

Run `discern status` to recover the current state and next valid action. During setup it also reports the phase, branch, and bounded continuation. If the same command loop recurs, run `discern patterns`. It reports a recorded loop only after the evidence reaches that detector's threshold, and each finding recommends an investigation.

## `discern done` returned a failed Gate

Read the diagnostic returned for the failed job. It names the tool, the command that reproduces the failure, and the captured output. Give that result to your agent. [When the Gate fails](../20-quality-gate/when-the-gate-fails.md) covers stage failures and recovery. `discern doctor` rules out missing tools or an invalid install.

## The project schema is newer than this binary

Update the binary before running the project upgrade. The repository was upgraded by a newer discern, so the older binary refuses to stamp the schema backward. Follow [Upgrade discern](upgrade-discern.md).

## Windows reports an unsupported platform

Run discern under WSL2. Native Windows shells are not supported. macOS and Linux binaries are published for x86-64 and ARM64.

## A monorepo needs different commands per component

Use one discern install at the Git root. Root jobs cover shared checks. Add a scope for a component that needs its own Gate:

```toml
[scopes.web]
paths = ["apps/web/**"]
gate = "npm --prefix apps/web test"
```

The scoped command runs when a matching path changes.

## Worktrees are using too much disk

Land finished work with `discern accept`. It removes the accepted worktree. Then review `discern worktree prune --dry-run` and confirm it to reclaim clean merged worktrees and stale state that carry discern's positive ownership record in Git metadata. Foreign merged refs and prefix-shaped branches without that evidence stay untouched. Change `[worktree].root` if the default sibling directory is unsuitable.

If removal reports that the retired path or Git registration remains, stop the named writer or repair the exact Git worktree entry, then repeat the same lifecycle command. Do not replace it with a broad recursive delete: the retry checks containment, ownership, and the observed filesystem object again before continuing.

## A worktree or branch was dropped by mistake

`discern worktree drop` prints a recovery ref before it removes a branch. [Recover a dropped branch](../30-worktrees/drop-recovery.md) gives the listing and restore commands, the 32-ref bound, and the uncommitted-work limit. For other lost Git refs, use `git reflog`; `discern doctor` warns when reflog recording is disabled or its configured retention falls below discern's recovery floor.

## Remove discern from the repository

Preview removal, then apply it:

```sh
discern uninstall --dry-run
discern uninstall
```

The command removes generated artifacts and discern's entries in shared integration files. It keeps `discern.toml` and authored content under `discern/`. [Files & ownership](../70-reference/artifact-ownership.md) lists the full footprint and the final binary-removal step.

## Report a bug or security issue

Open a GitHub issue and include `discern doctor --json`. For a security issue, follow the repository's `SECURITY.md` instructions instead of posting publicly.
