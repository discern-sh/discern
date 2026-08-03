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

Run it when a session starts or the next move is unclear. Human, JSON, and Model Context Protocol (MCP) forms share one result ([ADR 0254](../_adr/0254-status-is-a-measured-responsive-dashboard.md)).

## Human dashboard

Inside a linked worktree, the default dashboard describes the current worktree. From the main checkout, it leads with the fleet summary, attention items, and worktrees. `--all` adds the fleet from a worktree; `--local` suppresses it. The 2 flags conflict because they request opposite views.

The renderer measures terminal width and caps the report at 104 columns. It uses a bounded table when every value fits and stacked rows otherwise. Prose and path detail wrap with hanging indents. A long branch or worktree id stays complete on an isolated line. The current marker sits beside it; a different worktree id gets a labelled secondary line, and a detached branch stays explicit.

Each row has one derived status. Precedence is broken, unreadable, failed, blocked, collision, behind, running, ready, stale, in progress, receipt unreadable, receipt unavailable, receipt stale, needs gate, then idle. A newer running action supersedes an older failed or refused action. A completed `status` observation stays in the activity field; it does not make dirty work healthy.

A collision remains the primary status when a receipt-backed branch is otherwise ready. Readiness and landing authority stay visible as secondary facts, so collision attention does not hide a branch that can land first.

The other fields explain that status:

- **Git** says `clean` or uses a precise count such as `6 files changed`. Divergence is `↑8`, `↓3`, or both; zero dimensions are absent. Overall status comes from the complete row.
- **Receipt** uses the gate-receipt vocabulary: honored, missing, stale, dirty worktree, unavailable, or unreadable. An honored receipt and a clean branch can establish readiness.
- **Activity** combines the winning clock with the newest completed action. In `running done 2m · usually 4m`, the usual time is historical context only.
- **Landing** appears on ready rows as granted, needs approval, or scope-limited. Longer grant detail moves to a wrapped secondary line.

Text and glyphs carry every state. Red marks failure or unreadable state; yellow marks attention; cyan marks current or running activity; green marks receipt-backed evidence or granted authority; mechanical detail is dim. A `discern …` command also uses cyan inside its unchanged backticks, so the action stands apart from its explanation. `--no-color` changes no words or facts.

The supervisor view reports main once, outside the worktree list, and shows collision paths in the attention block. Recent or running changes remain work in progress. Failed checks, stale work, behind branches, collisions, unreadable state, and ready receipts receive attention.

Default checks report configured changed scopes when present, planned gate jobs, and a standards count. Derived `code` and `previewable` markers remain structured facts rather than unclear human scope names. A linked worktree's assigned port and named resources appear separately under **Local environment**; they are not checks. The latest landing reports pass state, branch, files changed, diff size, commit, and age. `--verbose` adds stored receipt Markdown; raw storage details remain structured.

```sh
discern status
discern status --all
discern status --local
discern status --verbose
discern status --no-color
```

## Structured result

`discern status --json` and `discern_status` return the shared `DiscernResult` envelope, unaffected by width, color, or verbosity. `data.project`, `location`, `root`, `worktree`, and `git` locate the observation. Local results can include scopes, planned jobs, generated-file currency, resources, standards, receipt, and verified [landing authority](landing-authority.md).

A fleet result keeps the main row for compatibility. Every readable worktree row carries identity, Git state, divergence, activity, the complete `gate_receipt` check, and landing authority. The older honored-only receipt fields remain. Consumers can distinguish every receipt state without inferring from absence.

When Git can read the subject of the latest landed receipt, `landed_receipt.commit_at` carries its committer timestamp. The dashboard uses that additive fact for the landing age.

`last_action` is the newest completed event. `running` is a fresh unmatched begin event. `last_activity` remains the later Git or logbook timestamp. With `[project].logbook = false`, action fields are absent and activity stays Git-derived ([ADR 0210](../_adr/0210-effectful-verb-starts-are-paired-logbook-events.md)).

`fleet_collisions` pairs branches whose fork diffs touch the same files. `adr_collisions` names record numbers claimed by multiple in-flight branches, including branches without a worktree. Human output renders their paths; machine hints retain exact field references. JSON and MCP carry stored receipt content with or without `--verbose` ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)).

The result stays `ok: true` when a branch is dirty, behind, or missing a receipt. Those are observed states with advisory next steps. Invalid flag combinations and other operational refusals return `ok: false`.

## Session findings

After setup, recent session-scope detectors can add logbook observations to `hints[]`. They inspect at most 200 events and exclude CI, previews, interactive human activity, and findings from another branch. Setup in progress and `[project].logbook = false` suppress them.

Session findings are advice. They change no Git fact, gate result, receipt, exit code, or `ok` value. Run `discern patterns` for the retained report and its evidence thresholds ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

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
