---
id: troubleshoot-setup-and-integrations
title: "Setup and integrations"
description: "Recover when installation, setup, or a coding-agent integration can't begin, resume, prove, land, or activate — without replaying effects or starting over."
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
  - "not_initialized"
  - "write_access"
  - "schema_version_too_new"
  - "partial_refresh"
  - "unsupported platform"
redirect_from:
  - "/docs/reference/setup-command-boundaries"
  - "/docs/reference/worktree-setup-step-recovery"
---

# Setup and integrations

You're installing discern, connecting a coding agent, or returning to a setup that stopped partway — and something won't begin, resume, or take effect. Setup is built for this moment: every effect is consent-gated, every phase is resumable, and an interrupted run picks up where it stopped rather than replaying writes. The recovery is almost never to start over, and never to delete what a previous attempt created.

If setup completed long ago and the problem is a failing Gate or a worktree, this page isn't the match — start from the [troubleshooting index](README.md) instead.

## `discern: command not found`

The binary isn't on the shell's `PATH`. Open a new shell and run `which discern`; if it prints nothing, add the install directory the installer reported to your shell's `PATH`. One case catches people connecting agents: a coding agent may launch a _non-interactive_ shell that reads different startup files, so a command that works in your terminal can be missing in the agent's. Make sure that shell sees the same `PATH`, or give the agent the absolute path to the binary.

## Setup won't start

Each of these stops before any effect, and the message says which you have:

- **No project found.** discern reports that this directory and its parents have no `discern.toml`, and offers the two exits: run `discern setup` to create one here, or move into the project that has one.
- **Unsupported platform.** discern runs on macOS and Linux (x86-64 and ARM64); on Windows, run it under WSL2. [Platforms and providers](../30-reference/platforms-and-providers.md) has the exact support matrix.
- **The project's config is newer than the binary.** A newer discern already upgraded this repository, so an older binary refuses to touch it rather than downgrade the schema. Update the binary first — [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md) covers upgrading — then rerun what you were doing.
- **A required write was denied.** Effectful setup commands probe the exact paths their plan needs before touching anything. A denial names the path and preserves the phase; grant the current invocation access to that path and rerun. A successful probe confirms access at that moment only — discern doesn't change your system's permissions, and can't.

## Setup was interrupted

An interrupted `discern setup begin`, `done`, or `accept` leaves durable phase state behind. Run `discern setup` (or `discern status`) and it reports the phase it reached, the branch it's on, and the bounded next step — resuming never replays completed writes.

A couple of interruption shapes deserve their own recognition:

- **The result was cut off but the work finished.** If a `setup done` result was truncated — a dropped session, a closed terminal — repeat `discern setup done` on the unchanged commit. It returns the same Proof and completion facts, explicitly marked as replayed, without rerunning effects or the Gate. Never rerun an effectful command merely to re-read output you lost; the replay path exists so you don't have to.
- **A project-authored worktree setup step is stuck.** Projects can declare their own per-worktree setup commands, and each records `running` before it starts and `completed` after it succeeds. A step still marked `running` means the process stopped between the two — and discern refuses to guess whether the command's external effect happened. Observe that effect yourself (did the database appear? the seed load?), then record your observation:

  ```sh
  discern worktree setup --mark-step-complete <id> --confirmed
  ```

  when it completed, or authorize another run when it didn't:

  ```sh
  discern worktree setup --retry-step <id> --confirmed
  ```

  Both are idempotent, and `--confirmed` records that a person judged the observed state. discern preserves the ambiguity because automatically replaying a command whose outcome it couldn't see is how half-applied effects get doubled.

## Setup can't prove or land

`discern setup done` validates the committed setup and produces [Proof](../20-understand/proof.md) — so it inherits the Gate's own preconditions. A dirty tree, or a tree that moved mid-run, means committing the final state and rerunning; the [Gate and Proof page](gate-and-proof.md) covers those classes. Off the trunk, `setup done` stops at Proof: landing setup into the project is the owner's decision, as it is for any other change, and the result names the acceptance step that follows. `discern setup accept` is safe to repeat — where no landing applies (no Git repository, or already on the trunk), it reports a typed no-op rather than failing.

## `discern doctor` reports a failed check

`discern doctor` is the read-only install diagnostic: it verifies that `discern.toml` parses and matches the binary, that configured job and script commands resolve, that selected coding agents have their integration files, and (in a Git repository) a set of repository-health facts: recovery retention, commit identity, hidden index flags, sparse-checkout shape, worktree-local configuration, generated-file merge protection, and directory ownership.

Doctor distinguishes advice from failure. A warning (low reflog retention, say) doesn't fail the run; a condition that would break real work (an unusable commit identity, Git's dubious-ownership refusal, a job command that doesn't resolve) fails the check and names the exact fix, usually as a runnable command. Apply the fix listed under each failed check, then run `discern doctor` again; a clean second run is the success condition. Findings worth recognizing:

- **A generated-file merge is unprotected.** discern protects its generated files with a Git merge driver, and a later or more local Git attribute can override it. Doctor names the affected paths and the owning rule; correct that rule (for a linked worktree, doctor supplies the two `git config` commands that enable worktree-local configuration), verify with the `git check-attr` command in the finding, and rerun doctor.
- **A check you can't act on.** Doctor's job is diagnosis, not repair — when a finding belongs to your Git hosting, your filesystem, or another tool, fix it there and rerun. For a bug report, capture the structured result with `discern doctor --json`.

## An agent's integration files are missing or stale

Setup and upgrade generate each selected provider's integration (instruction files, MCP registration, settings entries), and `discern status` or the Gate reports when those artifacts drift from their sources. The recovery is one command:

```sh
discern refresh
```

Review and commit what it rewrites. The direction is the part that prevents repeats: to change instructions or Skills, edit the authored sources (`[instructions].sources`, `[skills].dir`), because refresh overwrites generated copies by design and a hand-edit to a generated file is undone at the next refresh. Variants to recognize:

- **Refresh reports a malformed provider settings file.** Something else edited the file into a state discern won't rewrite blindly. Repair the named file, then run `discern refresh` again.
- **A setup or upgrade finished with a partial instruction refresh.** The result says so explicitly, keeps every completed effect, and marks the retry safe: run `discern refresh`, confirm the failures cleared, and don't infer completion from the absence of a warning — the result's own status is the fact.

## The tools don't appear in the agent's session

Integration files on disk prove generation, not activation — a provider reads them when a session starts. After `setup accept` (or an upgrade), start a fresh agent session, then have the agent inspect its registered tools and invoke the exact callable the handoff named — namespaced on hosts that namespace, such as `mcp__discern__discern_status`. If the tools still aren't there:

1. `discern doctor` verifies the integration files and MCP registration exist and parse.
2. The command line is the full fallback — every MCP tool fronts a CLI verb, so `discern status --json` (or `--markdown`) keeps the agent working while you sort the session out.
3. If the provider requires you to approve or trust the MCP server, that approval happens in the provider's own interface. discern can't grant it, and no discern output will ever claim to.

[MCP, terminal, and docs](mcp-terminal-and-docs.md) covers tools that were working and then went missing or stale mid-session.

## When to stop

Stop when the next step is consent rather than repair: setup's effects, its landing, and a worktree step's `running` resolution all wait for a person by design, and no retry substitutes for the confirmation. Stop as well when the blocker lives outside discern (provider trust approval, filesystem ownership, a corporate shell profile) and fix it at its owner. And a failure that names no next step at all is a bug worth reporting: [Crashes and local state](crashes-and-local-state.md) shows what to capture.
