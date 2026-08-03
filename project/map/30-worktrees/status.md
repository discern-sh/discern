---
title: Status and session hints
description: Read the current worktree or fleet dashboard and its next actions without running the gate.
order: 80
aliases:
  - discern status
  - worktree status
  - fleet status
  - session findings
---

# Status and session hints

_`discern status` reports what is true now and what deserves attention next. It runs no gate job, test, standard measurement, or setup action._

Run it when a session starts or the next move is unclear. Human, JSON, and Model Context Protocol (MCP) forms share one result ([ADR 0255](../_adr/0255-status-is-a-measured-responsive-dashboard.md)).

## Human dashboard

Worktrees default to a local view. Main leads with the fleet summary, attention, and worktrees. `--all` adds the fleet from a worktree; `--local` suppresses it. The flags conflict.

The renderer measures width, capped at 104 columns. It uses a bounded table when all facts fit and stacked rows otherwise. Section content starts beneath its heading text. Glyphs use the preceding 2 columns, keeping all item text aligned. Detail wraps with hanging indents. Long identities remain complete on isolated lines; current, secondary, and detached identities stay explicit.

Each row derives one status: broken, unreadable, failed, blocked, collision, behind, running, ready, stale, in progress, receipt unreadable, receipt unavailable, receipt stale, needs gate, then idle. New running work supersedes an older failure. A completed `status` remains activity, not evidence of health. Collision takes precedence without hiding receipt readiness or authority.

The other fields explain that status:

- **Git** says `clean` or `6 files changed`; divergence is `↑8`, `↓3`, or both, with zero dimensions omitted.
- **Receipt** is honored, missing, stale, dirty worktree, unavailable, or unreadable. A clean branch with an honored receipt can be ready.
- **Activity** combines the winning clock and completed action. `running done 2m · usually 4m` labels the median as history, not progress.
- **Landing** is granted, needs approval, or scope-limited on ready rows; detail wraps below it.

Text and glyphs carry every state. Red is failure or unreadable; yellow needs attention; cyan is current, running, or a `discern …` command inside preserved backticks; green is receipt-backed evidence or granted authority; mechanical detail is dim. `--no-color` changes no facts.

The supervisor view reports main once and shows collision paths. Recent changes remain normal work in progress; failures, stale or behind work, collisions, unreadable state, and ready receipts receive attention.

Checks show configured changed scopes, planned gate jobs, and a standards count. Derived `code` and `previewable` markers stay machine-only. Port and resources sit under **Local environment**. Landing shows pass, branch, files changed, diff size, commit, and age. `--verbose` adds stored receipt Markdown.

```sh
discern status
discern status --all
discern status --local
discern status --verbose
discern status --no-color
```

## Structured result

`discern status --json` and `discern_status` return one `DiscernResult`, unaffected by layout. `data.project`, `location`, `root`, `worktree`, and `git` locate it; local results can add scopes, jobs, currency, resources, standards, receipt, and [landing authority](landing-authority.md).

Fleet retains the main row for compatibility. Each readable worktree carries identity, Git state, divergence, activity, full `gate_receipt`, and authority. Honored-only receipt fields remain. `landed_receipt.commit_at` supplies landing age when Git can read it.

`last_action` is the newest completion, `running` a fresh unmatched start, and `last_activity` the later Git or logbook time. Disabling the logbook removes action fields, not Git activity ([ADR 0210](../_adr/0210-effectful-verb-starts-are-paired-logbook-events.md)).

`fleet_collisions` pairs branches sharing changed files. `adr_collisions` includes duplicate record claims from branches without worktrees. Human output shows paths; machine hints retain field references. Stored receipts remain in JSON and MCP regardless of `--verbose` ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)). Dirty, behind, and missing-receipt states remain `ok: true`; operational refusals do not.

## Session findings

After setup, detectors can add recent logbook observations to `hints[]`. They inspect at most 200 events and exclude CI, previews, human activity, and other branches. Findings change no Git fact, gate result, receipt, exit code, or `ok`; setup in progress and a disabled logbook suppress them. Run `discern patterns` for retained evidence ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

## Where it lives in code

| Concern                         | Source                                                                  |
| ------------------------------- | ----------------------------------------------------------------------- |
| Status facts and hints          | [`status.ts`](../../../src/engine/status/status.ts)                     |
| Pure responsive dashboard       | [`tty.ts`](../../../src/engine/status/tty.ts)                           |
| Terminal measurement and wrap   | [`text.ts`](../../../src/lib/text.ts)                                   |
| Result and receipt schemas      | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)            |
| Human and machine hint routing  | [`hints.ts`](../../../src/shared/hints.ts)                              |
| Width and semantic-state matrix | [`engine_status_tty_test.ts`](../../../tests/engine_status_tty_test.ts) |
| End-to-end status behavior      | [`engine_status_test.ts`](../../../tests/engine_status_test.ts)         |

## Current state and gotchas

- `status` never runs the gate. An honored receipt is evidence from an earlier `done` run on the current clean `HEAD`.
- Fleet worktrees belong to separate efforts. A clean sibling remains occupied until its owner lands or discards it.
- The dashboard is a projection. Use JSON or MCP when automation needs every structured field.
