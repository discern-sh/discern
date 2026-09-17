---
title: After setup
description: Read the setup diff file by file, including what you edit, what discern shares, and what it regenerates.
order: 50
aliases:
  - after setup
  - what discern writes
  - setup diff
  - installed files
---

# What setup added to your repo

_Setup works on a `discern-setup` branch. This guide tells you what each part of that branch is for and who edits it._

Review the branch before landing it. The paths depend on the coding agents you selected and any locations you configured, but each written file belongs to one of the groups below. For the exhaustive inventory and uninstall behavior, use [Files & ownership](../70-reference/artifact-ownership.md).

Successful `discern setup done` records `setup_completion = "proven"` and returns [gate Proof](../20-quality-gate/the-proof.md) for that clean tip. Repeating it unchanged re-serves the Proof and inventory without effects. `discern setup accept` validates and records that Proof on the landed trunk version. `discern setup done --unproven` instead records `setup_completion = "unproven"`, returns no Proof, and cannot be accepted; a later ordinary completion can converge it to proven.

Before landing, the handoff explains where later sessions start, which other areas have distinct responsibilities, one important project rule, the checks now active, and what remains open. Its explanation and supporting inventory derive from committed project files. [Setup decisions](setup-decisions.md) explains the owner review.

## Files you edit

These are project sources. Your agents maintain them as the project changes.

<!-- discern-workflow:artifact-ownership -->

| Path                      | Ownership     | What it contains                                                | How to change it                                         |
| ------------------------- | ------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `discern/instructions.md` | Project-owned | Instructions shared by every configured coding agent.           | Edit the Markdown, then run `discern refresh`.           |
| `discern/TODO.md`         | Project-owned | Deferred work the agents keep visible.                          | Edit it like any tracked project file.                   |
| `discern/brief.md`        | Project-owned | The project description captured during setup.                  | Update it when the project's purpose materially moves.   |
| `discern/skills/`         | Project-owned | Skills your project creates or overrides.                       | Add or edit each Skill at its source.                    |
| `discern/scripts/`        | Project-owned | Project-specific executables reached through `discern scripts`. | Edit and test the executable itself.                     |
| `discern/map`             | Project-owned | The maintained project Map agents keep current with the code.   | Edit the authored Markdown. `[map].dir` can relocate it. |

<!-- /discern-workflow -->

The `discern/` namespace contains authored material only. Generated copies do not belong there ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).

## Files discern shares with you

`discern.toml` is the root configuration file. You own its values and ordinary comments. `discern upgrade` may restore missing fixed sections or keys and refresh discern-owned ruled banners from the current template; it does not replace values you set.

`discern config set-job format --run "<project formatter>" --run "discern tidy"` keeps `discern tidy` last; repeat `--run` to preserve order. See [Format discern-owned surfaces](../20-quality-gate/tidy.md).

`--not-applicable` marks a missing known lifecycle; `--applicable` restores it. It changes assurance only, and configuring the job restores applicability ([ADR 0317](../_adr/0317-gate-commands-and-setup-applicability-are-separate-facts.md)).

The `.gitignore` file gains one marked block for materialized skills and machine-local state. `.gitattributes` gains another marked block for generated-file merging and Markdown diffs. Keep project rules outside those blocks; discern rebuilds only its owned regions from the registries.

Each selected coding agent also has registry-declared integration files. discern adds its Model Context Protocol (MCP) server and supported hooks while preserving unrelated Shared entries. Claude Code receives no permission rules; its named local server is pre-approved only after workspace trust, and normal MCP tool permissions still apply. Codex receives only `git add` and `git commit` command-prefix allowances; those prefixes have no working-directory boundary and grant no push, reset, broader Git, or general shell access. The [agent integration guides](../60-agent-integrations/) list the exact paths and trust steps for every provider.

Unlanded `setup done` stops at Proof and the landing choice. After `setup accept` lands, it serves one provider-owned fresh-session instruction: inspect the registered tool inventory, invoke the exact local action, and use the included local recovery if that action is missing. See [Setup command boundaries](../70-reference/setup-command-boundaries.md).

## Files discern regenerates

Agent files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` come from discern's built-in instructions plus your authored sources. The files are committed, so a bare clone retains the instructions. Without the local binary, its MCP server and hooks cannot run and the ignored materialized skill directories are absent. Install discern, run `discern refresh`, and open a fresh provider session to restore the integration. Edit instruction sources instead of compiled files, then run `discern refresh`; the gate rejects a tracked generated copy that has drifted ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)).

Git ignores materialized skill directories such as `.agents/skills/` and `.claude/skills/`. `discern refresh` recreates them from bundled and authored skills.

## One repository, one installation

Setup resolves the Git top level and writes one root `discern.toml`. A monorepo uses that installation's scopes and custom jobs for its parts. Another config in an ordinary nested directory has no independent ownership. A nested independent Git repository is a separate project and may have its own installation.

## The worktree directory appears later

The first `discern start` creates a sibling directory named `<repo>.worktrees/` by default. Each child is an isolated workspace for one task (a Git worktree). `discern accept` removes a landed worktree. `discern worktree prune` clears merged or orphaned leftovers.

Next, follow the [setup walkthrough](walkthrough.md), or go to the manual's [troubleshooting section](https://discern.sh/docs/troubleshooting) if the diff does not match this guide.
