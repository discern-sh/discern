---
title: Status and session hints
description: Read the current worktree or fleet dashboard and its next actions without running the Gate.
order: 80
aliases:
  - discern status
  - worktree status
  - fleet status
  - session findings
---

# Status and session hints

_`discern status` reports what is true now and what deserves attention next. It runs no Gate job, test, Standard measurement, or setup action._

Run it when a session starts or the next move is unclear. Human, JSON, and Model Context Protocol (MCP) forms share one result ([ADR 0255](../_adr/0255-status-is-a-measured-responsive-dashboard.md)).

## Human dashboard

Worktrees default to a local view. Main leads with the fleet summary, attention, and worktrees. `--all` adds the fleet from a worktree; `--local` suppresses it. The flags conflict.

`statusResult` owns observation: Git, Proof, Logbook activity, collisions, receipts, and landing. The pure dashboard receives those facts with time, width, verbosity, and shared terminal context. It observes nothing; Fleet and supporting Components own layout.

Fleet's lossless mode caps at 104 columns, stacking at 39 or when its table cannot fit. It never truncates or hashes branch and worktree text. Current and detached markers plus secondary facts stay labelled.

Each row derives one status: broken, unreadable, failed, blocked, collision, behind, running, ready, stale, in progress, proof unreadable, proof unavailable, proof stale, needs gate, then idle. New running work supersedes an older failure. A completed `status` contributes activity time and no health evidence. Collision takes precedence without hiding Proof readiness or authority.

The other fields explain that status:

- **Git** says `clean` or `6 files changed`; divergence is `↑8`, `↓3`, or both, with zero dimensions omitted.
- **Proof** is honored, missing, stale, dirty worktree, unavailable, or unreadable. A clean branch with a valid Proof can be ready.
- **Activity** combines the winning clock and completed action. In `running done 2m · usually 4m`, `usually 4m` is the historical median.
- **Landing** is granted, needs approval, or scope-limited on ready rows; detail wraps below it.

Text and glyphs classify every state; color does not. Exhaustive adapters preserve status and Proof precedence through every terminal mode. `--no-color` changes no facts.

The supervisor view reports main once and shows collision paths. Recent changes remain normal work in progress; failures, stale or behind work, collisions, unreadable state, ready Proofs, and removed worktree paths that exist again receive attention. A reappeared path shows when discern removed its worktree, a bounded content sample, and any reason prune must keep it.

Checks show configured changed scopes, planned Gate jobs, and a Standards count. Derived `code` and `previewable` markers stay machine-only. Port and resources sit under **Local environment**. Landing shows pass, branch, files changed, diff size, commit, and age. `--verbose` adds stored Proof Markdown.

```sh
discern status
discern status --all
discern status --local
discern status --verbose
discern status --no-color
```

## Structured result

`discern status --json` and `discern_status` return one `DiscernResult`, unaffected by layout. `data.project`, `location`, `root`, `worktree`, and `git` locate it; local results can add scopes, jobs, currency, resources, standards, proof, and [landing authority](landing-authority.md).

`data.pending_tracked_refresh` lists tracked paths an ordinary refresh would change. `data.tracked_refresh_plan_errors` lists problems that prevent the plan from being derived. `stale_generated`, `stale_materialized`, `stale_integrations`, and `stale_adr_index` remain compatibility projections of the same plan.

Fleet retains the main row for compatibility. Each readable worktree carries identity, Git state, divergence, activity, full `gate_proof`, and authority. Honored-only proof fields remain. `landed_proof.commit_at` supplies landing age when Git can read it.

`last_action` records the newest completion. `running` records a recent start with no matching completion, and `last_activity` takes the later Git or Logbook time. Disabling the Logbook removes the action fields; Git activity remains available ([ADR 0210](../_adr/0210-effectful-verb-starts-are-paired-logbook-events.md)).

`fleet_collisions` pairs branches sharing changed files. `adr_collisions` includes duplicate record claims from branches without worktrees. Human output shows paths; machine hints retain field references. Stored Proofs remain in JSON and MCP regardless of `--verbose` ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)). Dirty, behind, and missing-proof states remain `ok: true`; operational refusals do not.

`reappeared_worktree_paths` lists paths removed through discern's worktree lifecycle that currently exist without a live Git registration. Each row carries `path`, `removed_at`, `kind`, `entries`, a bounded `contents` sample, and `cleanup_blocked_reason` when prune must preserve it. The related hint points to `discern worktree prune --dry-run`; status remains read-only ([ADR 0265](../_adr/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md)).

## Session findings

After setup, detectors can add recent Logbook observations to `hints[]`. They inspect at most 200 events and exclude CI, previews, human activity, and other branches. Findings change no Git fact, Gate result, Proof, exit code, or `ok`; setup in progress and a disabled Logbook suppress them. Run `discern patterns` for retained evidence ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

## Where it lives in code

| Concern                               | Source                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| Status facts and hints                | [`status.ts`](../../../src/engine/status/status.ts)                                 |
| Pure package-component adaptation     | [`tty.ts`](../../../src/engine/status/tty.ts)                                       |
| Shared terminal facts and safe text   | [`terminal.ts`](../../../src/lib/terminal.ts)                                       |
| Result and Proof schemas              | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                        |
| Human and machine hint routing        | [`hints.ts`](../../../src/shared/hints.ts)                                          |
| Width, degradation, and state matrix  | [`engine_status_tty_test.ts`](../../../tests/engine_status_tty_test.ts)             |
| End-to-end status behavior            | [`engine_status_test.ts`](../../../tests/engine_status_test.ts)                     |
| Terminal-observation structural guard | [`terminal_boundary_guard_test.ts`](../../../tests/terminal_boundary_guard_test.ts) |

## Current state and gotchas

- `status` never runs the Gate. A valid Proof is evidence from an earlier `done` run on the current clean `HEAD`.
- Fleet worktrees belong to separate efforts. A clean sibling remains occupied until its owner lands or discards it.
- A reappeared worktree path is no longer an active fleet member. Review its contents and close any program still writing there before confirmed prune.
- The dashboard is a projection. Use JSON or MCP when automation needs every structured field.
