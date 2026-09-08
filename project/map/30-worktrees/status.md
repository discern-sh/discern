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

_`discern status` reports what is true now and what deserves attention next. It runs no gate job, test, Standard measurement, or setup action._

Run it when a session starts or the next move is unclear. Terminal, JSON, Markdown, and Model Context Protocol (MCP) forms share one result ([ADR 0255](../_adr/0255-status-is-a-measured-responsive-dashboard.md), [ADR 0281](../_adr/0281-main-fleet-status-is-a-decision-brief.md)).

## Human dashboard

Worktrees default to a local view. The main checkout shows its state, fleet task rows, **Owner attention**, **Landing risks**, and **Next action**. `--verbose` adds per-task evidence, configured checks, local environment, landing history, shared paths, and stored Proof pages.

`--all` explicitly adds the fleet to a worktree's detailed local view; `--local` suppresses it. The flags conflict.

One observation feeds every projection; shared CLI components render each terminal view.

The 104-column report uses stored task titles when available; `--verbose` reveals complete worktree and branch identities. A title that differs from its normalized id never replaces the id or branch.

Rows prioritize live, stale, or uncommitted work while still showing branch drift. Shared-file and Architecture Decision Record (ADR) number collisions remain separate landing risks.

The other fields explain that status:

- **Git** says `clean` or `6 files changed`; **DRIFT** keeps `↑8`, `↓3`, or both. Color reinforces the complete arrow-and-count text.
- **Proof** is honored, report-only, missing, stale, dirty worktree, unavailable, or unreadable. Report-only means the commit is current but CI reported checkpoint review without enforcing it; ordinary `discern done` is still required before landing. A clean branch with an honored strict Proof can be ready.
- **Activity** combines the winning clock and completed action. A live Gate reads `Gate running · 2m`; `usually 4m` is historical context.
- **Landing** is granted, needs approval, or scope-limited on ready rows; detail wraps below it.

Text and glyphs carry every state; `--no-color` changes no facts.

**Owner attention** holds lifecycle and landing decisions; **Landing risks** holds file, trunk, and ADR conflicts; **Next action** holds the executable continuation. `--verbose` adds evidence.

In the expanded view, **Checks** shows configured changed scopes, each changed scope's configured preview command, planned gate jobs, and a standards count. It labels preview commands as not run. Derived `code` and `previewable` markers stay machine-only. Port and resources sit under **Local environment**. **Landing** shows pass, branch, files changed, diff size, commit, and age. **Proofs** contains stored Proof Markdown.

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

During setup, this read-only result reports the recorded phase, dedicated branch, and bounded continuation. It performs no write probe; the later effectful command checks its own targets ([Setup command boundaries](../70-reference/setup-command-boundaries.md)).

## Structured result

`discern status --json`, MCP `structuredContent`, and the status resource default to the bounded orientation projection. `data.projection.mode` is `orientation`; `data.projection.omitted` gives the true overflow for each capped collection. Repeated collections retain at most six members. Fleet uses a distinct bounded shape: the main row plus six non-main samples, while `data.fleet_total` records the complete non-main count. Landing history stays out of the orientation payload.

Every default result includes the route to full structured detail. Run `discern status --verbose --json`, or call `discern_status` with `verbose: true`. The resulting `data.projection.mode` is `full`; repeated collections and landing history are complete. The shared wire projection still removes rendered Proof pages and the fleet row's earlier compatibility copies. One serialization policy serves CLI JSON, MCP, and the live resource.

`discern status --markdown` and MCP `content` return the authored Markdown presentation. It leads with local state and bounded evidence, states authority, separates decisions that need **Owner attention**, lists secondary work under **Other actions**, and closes with the immediate **Next action**. Cross-effort lifecycle decisions never become the reading agent's next action. `data.project`, `location`, `root`, `worktree`, and `git` locate the structured result; local results can add scopes, jobs, currency, resources, Standards, Proof, and [landing authority](landing-authority.md).

`data.pending_tracked_refresh` lists tracked paths an ordinary refresh would change. `data.tracked_refresh_plan_errors` lists problems that prevent the plan from being derived. Drift in ignored generated files remains visible through the corresponding registered hint.

Fleet retains the main row. Each sampled row carries independent recovery facts: Git registration and branch reachability, filesystem presence, clean state and divergence when readable, the failed Git command and diagnostic when unavailable, and setup-ready marker, journal, and repair classification. Full status adds resource identities. Missing facts stay absent or carry an explicit unavailable state; they never supply a clean fallback.

Readable worktrees also carry activity, one `gate_proof`, and authority. Newer rows carry `task`: the display title, title source, optional brief, and creation ref and commit. `title_source: "identity-fallback"` identifies an older worktree with no record. Unavailable metadata remains a separate diagnostic. `gate_proof` always carries its inspection status, and an honored marker adds compact structured Proof facts. Every structured mode omits rendered Proof pages, legacy one-line marker copies, and the earlier `proof_honored`, `proof`, and `proof_line` compatibility copies at fleet-row level. Status authority keeps the exact decision, six authored-first path examples plus uncovered totals and scopes. In full mode, `landed_proof.proof` is compact and `landed_proof.commit_at` supplies landing age when Git can read it.

Ahead and behind are non-negative integers, `"unknown"` after a failed or malformed count, and `null` on local status when the trunk is missing. Only a number can support readiness or containment ([ADR 0328](../_adr/0328-absence-and-unknown-observations-stay-distinct.md)).

When this effort's exact committed source has already landed, local status names that source and explains the separate checkout state. Status does not suggest updating an already-landed source as a cleanup step merely because later work reached the trunk. Local feedback stays visible as changed files. The [source-bound projection](../../../src/engine/status/checkout_landing.ts) reads the same retirement decision as acceptance; historical cleanup from other efforts cannot supply this result.

`last_action` records the newest completion. `running` records a recent start with no matching completion, and `last_activity` takes the later Git or logbook time. Disabling the logbook removes the action fields; Git activity remains available ([ADR 0210](../_adr/0210-effectful-verb-starts-are-paired-logbook-events.md)).

`fleet_collisions` pairs branches sharing changed files and retains the shared-file count; `adr_collisions` retains each contested number and its claimant branches, including branches without worktrees. Their path lists stay out of structured results. Terminal `--verbose` shows those paths, and a later `update` result names the shared paths that need re-reading. Full stored Proof pages appear only through terminal `--verbose`; structured modes carry the compact Proof claim ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)). Dirty, behind, and missing-Proof states remain `ok: true`; operational refusals do not.

`reappeared_worktree_paths` lists paths removed through discern's worktree lifecycle that currently exist without a live Git registration. Each row carries `path`, `removed_at`, `kind`, `entries`, a bounded `contents` sample, and `cleanup_blocked_reason` when prune must preserve it. The agent result places cleanup under Owner attention. The human dashboard retains the dry-run review route; status itself remains read-only ([ADR 0265](../_adr/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md)).

`parked_tasks` joins local Park metadata to the existing `unlanded_branches` population. It carries the retained branch commit, Park time, and task wording used by the desk and `start --from` resume flow. When those records cannot be read, `parked_tasks_unavailable` names the failure and `discern doctor` as the next command while the underlying unlanded branches stay visible. `recent_completed_tasks` is a bounded local tail from successful acceptance events and the latest landed Proof. These remain read-only views over existing lifecycle evidence ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)).

## Session findings

After setup, detectors can add recent logbook observations to `hints[]`. They inspect at most 200 events and exclude CI, previews, human activity, and other branches. Findings change no Git fact, Gate result, Proof, exit code, or `ok`; setup in progress and a disabled logbook suppress them. Run `discern patterns` for retained evidence ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

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
- Fleet worktrees belong to separate efforts. A clean or landed sibling can still be held for review or further edits. Its recorded release and cleanup checks govern retirement.
- A reappeared worktree path is no longer an active fleet member. Review its contents and close any program still writing there before confirmed prune.
- The dashboard and Markdown result are projections. Default JSON and MCP are also bounded for orientation; request verbose structured status only when exact full collections are needed.
