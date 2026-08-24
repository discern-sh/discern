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

Run it when a session starts or the next move is unclear. Terminal, JSON, Markdown, and Model Context Protocol (MCP) forms share one result ([ADR 0255](../_adr/0255-status-is-a-measured-responsive-dashboard.md), [ADR 0281](../_adr/0281-main-fleet-status-is-a-decision-brief.md)).

## Human dashboard

Worktrees default to a local view. The main checkout shows its state, fleet task rows, **Owner attention**, **Landing risks**, and **Next action**. `--verbose` adds per-task evidence, configured checks, local environment, landing history, shared paths, and stored Proof pages.

`--all` explicitly adds the fleet to a worktree's detailed local view; `--local` suppresses it. The flags conflict.

One observed result, invocation clock, and terminal snapshot feed every projection. Published design-system CLI Components render each visible block and responsive frame; discern composes the product facts.

The report caps at 104 columns. Default rows use human task labels, revealing a generated tail only to disambiguate duplicate names. `--verbose` shows complete worktree and branch identities; narrow layouts wrap them without loss.

Each row names its own condition. Live, stale, or uncommitted work precedes branch lag while **DRIFT** still exposes it. A completed `status` contributes activity time only. Shared-file and Architecture Decision Record (ADR) number collisions remain pairwise landing risks outside row state, Proof readiness, and authority.

The other fields explain that status:

- **Git** says `clean` or `6 files changed`; **DRIFT** keeps `↑8`, `↓3`, or both. Color reinforces the complete arrow-and-count text.
- **Proof** is honored, report-only, missing, stale, dirty worktree, unavailable, or unreadable. Report-only means the commit is current but CI reported checkpoint review without enforcing it; ordinary `discern done` is still required before landing. A clean branch with an honored strict Proof can be ready.
- **Activity** combines the winning clock and completed action. A live Gate reads `Gate running · 2m`; `usually 4m` is historical context.
- **Landing** is granted, needs approval, or scope-limited on ready rows; detail wraps below it.

Text and glyphs classify every state; color does not. Exhaustive adapters preserve status and Proof precedence through every terminal mode. `--no-color` changes no facts.

**Owner attention** contains lifecycle and landing decisions. **Landing risks** contains shared-file, incoming-trunk, and ADR-number relationships. **Next action** contains executable continuation. `--verbose` adds diagnostics and shared paths. A reappeared-path card shows when discern removed a worktree, a bounded content sample, and any reason prune must keep it.

In the expanded view, **Checks** shows configured changed scopes, planned Gate jobs, and a Standards count. Derived `code` and `previewable` markers stay machine-only. Port and resources sit under **Local environment**. **Landing** shows pass, branch, files changed, diff size, commit, and age. **Proofs** contains stored Proof Markdown.

```sh
discern status
discern status --all
discern status --local
discern status --verbose
discern status --markdown
discern status --json
discern status --verbose --json
discern status --no-color
```

During an unfinished setup, the same read-only result reports the recorded setup phase, dedicated `discern-setup` branch, and exact bounded setup continuation. Use it after interruption or restart; do not replay completed branch, scaffold, completion, or landing writes with raw Git. Status performs no write probe and cannot cache provider authority for the later effectful command. That command derives and exercises its own required targets in its invocation ([ADR 0320](../_adr/0320-setup-plans-own-write-authority-and-activation-recovery.md)).

## Structured result

`discern status --json`, MCP `structuredContent`, and the status resource default to the bounded orientation projection. `data.projection.mode` is `orientation`; `data.projection.omitted` gives the true overflow for each capped collection. Repeated collections retain at most six members. Fleet uses a distinct bounded shape: the main row plus six non-main samples, while `data.fleet_total` records the complete non-main count. Landing history stays out of the orientation payload.

Every default result includes the route to full structured detail. Run `discern status --verbose --json`, or call `discern_status` with `verbose: true`. The resulting `data.projection.mode` is `full`; repeated collections and landing history are complete. The shared wire projection still removes rendered Proof pages and the fleet row's earlier compatibility copies. One serialization policy serves CLI JSON, MCP, and the live resource.

`discern status --markdown` and MCP `content` return the authored Markdown presentation. It leads with local state and bounded evidence, states authority, separates decisions that need **Owner attention**, lists secondary work under **Other actions**, and closes with the immediate **Next action**. Cross-effort lifecycle decisions never become the reading agent's next action. `data.project`, `location`, `root`, `worktree`, and `git` locate the structured result; local results can add scopes, jobs, currency, resources, Standards, Proof, and [landing authority](landing-authority.md).

`data.pending_tracked_refresh` lists tracked paths an ordinary refresh would change. `data.tracked_refresh_plan_errors` lists problems that prevent the plan from being derived. `stale_generated`, `stale_materialized`, `stale_integrations`, and `stale_adr_index` remain compatibility projections of the same plan.

Fleet retains the main row. Each sampled readable worktree carries identity, Git state, divergence, activity, one `gate_proof`, and authority. `gate_proof` always carries its inspection status. A current honored marker adds compact Proof facts and the one-line rendering; an older marker may add only `proof_line`. Every structured mode omits rendered Proof pages and the earlier `proof_honored`, `proof`, and `proof_line` compatibility copies at fleet-row level. Status authority keeps the exact decision, six authored-first path examples plus uncovered totals and scopes. In full mode, `landed_proof.proof` is compact and `landed_proof.commit_at` supplies landing age when Git can read it.

`last_action` records the newest completion. `running` records a recent start with no matching completion, and `last_activity` takes the later Git or Logbook time. Disabling the Logbook removes the action fields; Git activity remains available ([ADR 0210](../_adr/0210-effectful-verb-starts-are-paired-logbook-events.md)).

`fleet_collisions` pairs branches sharing changed files and retains the shared-file count; `adr_collisions` retains each contested number and its claimant branches, including branches without worktrees. Their path lists stay out of structured results. Terminal `--verbose` shows those paths, and a later `update` result names the shared paths that need re-reading. Full stored Proof pages appear only through terminal `--verbose`; structured modes carry the compact Proof claim ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)). Dirty, behind, and missing-Proof states remain `ok: true`; operational refusals do not.

`reappeared_worktree_paths` lists paths removed through discern's worktree lifecycle that currently exist without a live Git registration. Each row carries `path`, `removed_at`, `kind`, `entries`, a bounded `contents` sample, and `cleanup_blocked_reason` when prune must preserve it. The agent result places cleanup under Owner attention. The human dashboard retains the dry-run review route; status itself remains read-only ([ADR 0265](../_adr/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md)).

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
- Fleet worktrees belong to separate efforts. A clean sibling remains occupied until its owner lands or discards it; its maintenance state appears under Owner attention.
- A reappeared worktree path is no longer an active fleet member. Review its contents and close any program still writing there before confirmed prune.
- The dashboard and Markdown result are projections. Default JSON and MCP are also bounded for orientation; request verbose structured status only when exact full collections are needed.
