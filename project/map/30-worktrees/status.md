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

Worktrees default to a local view. The main checkout shows its state, fleet task rows grouped by [row state](#row-states), the **Landing queue**, **Owner attention**, **Landing risks**, and **Next action**. `--verbose` adds per-task evidence, configured checks, local environment, landing history, shared paths, and stored Proof pages.

The **Landing queue** lists each submission with honored Proof that has not landed: pre-authorized submissions first, by grant time, then submissions awaiting the owner, by submission time, one line each with the single reason it waits. A submission the trunk overtook stays ready — its landing composes and checks the combined code in an [integration worktree](../00-orientation/glossary.md#integration-worktree) — and its row carries that integration detail; a submission a running landing is checking says so and names the landing's progress handle; a submission whose branch has moved on says so and names `discern done` then `discern accept` for the new work. The current worktree's own effort is marked. A failed or abandoned run, or a run its agent never submitted, is absent. The desk and `accept --dry-run` show the same list, derived from the same projection, so the surfaces cannot disagree. `data.queue` carries the rows in the structured result. Fleet rows label an integration copy as discern-owned — live while its landing runs, interrupted with the `discern worktree prune` route when its owner died — so it is never read as an effort to adopt.

Some facts lead the result whenever they apply. A long operation this checkout started and has not finished leads the result with its verb, its latest recorded sentence, and the `discern progress` handle that reads it back (`data.operation`), and the ordinary start-a-run next steps stay out of the way. A trunk tip that landed as an emergency reads as `landed_exception`, with whether its skipped checks are still outstanding, never as a Proof format this build cannot read.

`--all` explicitly adds the fleet to a worktree's detailed local view; `--local` suppresses it. The flags conflict.

One observation feeds every projection; shared CLI components render each terminal view.

The 104-column report uses stored task titles when available; `--verbose` reveals complete worktree and branch identities. A title that differs from its normalized id never replaces the id or branch.

Fleet rows sit under their decision group's heading, in the fixed group order, with case-folded titles inside a group; the current checkout leads its group. The summary line counts the tasks that need you: those in Ready for review and Needs attention. A landing's integration copy is not a row of its own while its task has one: the task's row carries the Landing, Exception or Interrupted state instead. Shared-file and Architecture Decision Record (ADR) number collisions remain separate landing risks.

Each row reads `name · glyph Label · DRIFT … · Activity: …`, for example `Homepage session prototype · ! Stale · DRIFT ↑1 ↓361 · Activity: 1w ago`. The other fields explain that state:

- **Git** says `clean` or `6 files changed`; **DRIFT** keeps `↑8`, `↓3`, or both. Color reinforces the complete arrow-and-count text.
- **Proof** reads in human words: `Passed 20m ago`, `None yet`, `Not run on these changes`, `Outdated: for an older commit`, `Unavailable: <reason>`, `Unreadable: <reason>`, or `Reported only: not a landing Proof`. Report-only means CI reported checkpoint review without enforcing it; ordinary `discern done` is still required before landing.
- **Activity** combines the winning clock and completed action. A live Gate reads `Checking · 2m`; `usually 4m` is historical context.
- **Landing**, on rows with honored Proof or a grant, reads `Needs your approval`, `Pre-authorized by you`, `Covered by your standing approval (<scopes>)`, or `Needs your approval · 3 paths aren't covered`. "Scope limited" and "Authority unknown" never reach the dashboard; the structured `landing_authority` keeps the exact decision.
- **Queue**, on queued rows, reads `#1 · lands with any landing`, `#2 · needs your approval`, or `#2 · waiting: <reason>`.

Text and glyphs carry every state; `--no-color` changes no facts, and plain terminals use each state's ASCII form.

**Owner attention** holds lifecycle and landing decisions, including the next step of every row that needs you; **Landing risks** holds file, trunk, and ADR conflicts; **Next action** holds the executable continuation. `--verbose` adds evidence: each row's state line, its explanation, and its next step with the exact command. The ready, authorized-landing, and stale hints take their members from the row states, so a hint never calls a row ready that the dashboard labels stale. Lists, hints, and structured `state` and `group` share one membership, `listedFleetTasks`: a landing copy whose task has its own row has no state of its own and is never counted twice.

## Row states

One table, [`row_states.ts`](../../../src/engine/status/row_states.ts), names every state a fleet row can be in: its group, label of at most 13 cells, glyph, ASCII form, glyph and label tones, and the two facts a one-line summary leads with. `discern status`, [`discern enter`](opening-worktrees.md), and the desk read it, so the three surfaces show one vocabulary ([ADR 0414](../_adr/0414-status-owns-the-row-state-vocabulary.md)). Each state's sentences live beside it in [`row_sentences.ts`](../../../src/engine/status/row_sentences.ts): a short qualifier, an `explanation` in the human register with no commands, and an `attention` line in the CLI register with the exact command. The facts they read and their human wording (`proofHuman`, `authorityHuman`, `queueHuman`, `exceptionArgv`) live in [`row_facts.ts`](../../../src/engine/status/row_facts.ts).

Status first classifies a row into one of its closed kinds (`classifyRowKind`): degraded, failed, refused, running, stale, editing, ready, behind, then the Proof kinds and idle. `rowStateFor` refines the kind by a written precedence, and the first match wins:

1. Degraded kinds: Broken, Unreadable, or setup split by its record into Needs setup (retry or manual) and Setup unknown.
2. An integration copy landing this task: live is Landing; a copy retained for the owner's decision is Exception; a copy retained for the agent's checkpoint answers is Refused, because the next move is the agent's; a dead owner is Interrupted. These outrank the task's own kind because the landing is what is happening.
3. A running verb: `done` is Checking, `accept` is Landing, `update` is Updating, any other is Running.
4. A failed verb: `done` is Checks failed, `accept` is Didn't land, any other is Failed.
5. A refusal, by its `last_action.error` slug while the work can still land: a variance or standard approval wait is Exception, a consent wait is Wants to land; anything else is Refused.
6. Stale work: Stale either way; honored Proof keeps its own state so its explanation can say landing is still open. A clean contained branch stays Contained however long it idles, because its commits travel on in a later task.
7. Uncommitted work: Editing.
8. Ready work: unmet checkpoint answers or standard proposals in the Proof are Exception; a queue row awaiting the owner is Wants to land; recorded authority is Queued #N when queued and Approved when not; otherwise Ready.
9. Containment, then the behind and Proof kinds: Contained, Behind, Proof error, Proof unknown, Needs recheck, Needs checks.
10. Idle: Empty when clean with nothing ahead, otherwise Idle. A clean task with nothing ahead reads Empty however far main has moved, because it has no work to update or check yet.

Containment resolves before the behind and Proof kinds because a contained branch carries commits without its own Proof; the queue's `awaiting-owner` authority is the durable form of a consent refusal, which the agent's next command overwrites.

The groups are `FLEET_ROW_DECISIONS` (Ready for review, Needs attention, Working, Approved to land, Idle) and `FLEET_BRANCH_GROUPS` (Parked, Landed). Green marks only the states that can land (Ready, Wants to land, Approved, Queued). An Exception's next step is the exact hand-off: `discern accept --target <branch> --confirmed`, one `--variance <id>` per unmet checkpoint and one `--approve-standard <token>` per standard proposal, with the token acceptance serves. A copy retained for a variance names the combined code's checkpoint ids from its `integration.judgment` and adds `--composition-receipt <receipt>`. When no fact names the decision, as after a variance refusal whose Proof carries none, the hand-off is `discern accept --target <branch>`, which serves the exact decision.

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

During setup, this read-only result reports the recorded phase, dedicated branch, and bounded continuation. It reports incomplete setup even before the first commit; completion-history readers skip a checkout whose `HEAD` has no commit. It performs no write probe; the later effectful command checks its own targets ([Setup command boundaries](../70-reference/setup-command-boundaries.md)).

## Structured result

`discern status --json`, MCP `structuredContent`, and the status resource default to the bounded orientation projection. `data.projection.mode` is `orientation`; `data.projection.omitted` gives the true overflow for each capped collection. Repeated collections retain at most six members. Fleet uses a distinct bounded shape: the main row plus six non-main samples, while `data.fleet_total` records the complete non-main count. Landing history stays out of the orientation payload.

Every default result includes the route to full structured detail. Run `discern status --verbose --json`, or call `discern_status` with `verbose: true`. The resulting `data.projection.mode` is `full`; repeated collections and landing history are complete. The shared wire projection still removes rendered Proof pages and the fleet row's earlier compatibility copies. One serialization policy serves CLI JSON, MCP, and the live resource.

`discern status --markdown` and MCP `content` return the authored Markdown presentation. It leads with local state and bounded evidence, states authority, separates decisions that need **Owner attention**, lists secondary work under **Other actions**, and closes with the immediate **Next action**. Cross-effort lifecycle decisions never become the reading agent's next action. `data.project`, `location`, `root`, `worktree`, and `git` locate the structured result; local results can add scopes, jobs, currency, resources, Standards, Proof, and [landing authority](landing-authority.md).

`data.pending_tracked_refresh` lists tracked paths an ordinary refresh would change. `data.tracked_refresh_plan_errors` lists problems that prevent the plan from being derived. Drift in ignored generated files remains visible through the corresponding registered hint.

Fleet retains the main row. Each sampled row carries independent recovery facts: Git registration and branch reachability, filesystem presence, clean state and divergence when readable, the failed Git command and diagnostic when unavailable, and setup-ready marker, journal, and repair classification. Full status adds resource identities. Missing facts stay absent or carry an explicit unavailable state; they never supply a clean fallback.

`read_failure` records any other checkout-local read that failed, with its reason, and marks the checkout Unreadable. When a configured env file caused it, `file` names that file. The row then keeps its derived `id` and `port` and omits `resources`. The local `worktree` block carries the same field, with empty `resources`. A row whose remaining reads fail keeps its registration and Git facts, so one checkout's failure never fails the survey ([identity and environment](identity-and-env.md#inherit-selected-env-values)).

Every task row carries `state` and `group` from the [row-state table](#row-states); the main checkout's row carries neither. The Markdown projection names both on each fleet line.

Readable worktrees also carry activity, one `gate_proof`, and authority. Newer rows carry `task`: the display title, title source, optional brief, and creation ref and commit. `title_source: "identity-fallback"` identifies an older worktree with no record. Unavailable metadata remains a separate diagnostic. `gate_proof` always carries its inspection status, and an honored marker adds compact structured Proof facts. Every structured mode omits rendered Proof pages, legacy one-line marker copies, and the earlier `proof_honored`, `proof`, and `proof_line` compatibility copies at fleet-row level. Status authority keeps the exact decision, six authored-first path examples plus uncovered totals and scopes. In full mode, `landed_proof.proof` is compact and `landed_proof.commit_at` supplies landing age when Git can read it.

Ahead and behind are non-negative integers, `"unknown"` after a failed or malformed count, and `null` on local status when the trunk is missing. Only a number can support readiness or containment ([ADR 0328](../_adr/0328-absence-and-unknown-observations-stay-distinct.md)).

Status carries no landing outcome for a checkout that stayed after its submission landed. The acceptance result's first sentence names that route ([Land the reviewed commit](lifecycle.md#land-the-reviewed-commit)); afterwards the row reports the checkout's current state like any other task. Local feedback stays visible as changed files.

`last_action` records the newest completed task action, with its `error` slug when the verb refused or failed with one. An invocation the verb registry classifies as observation — `status`, `progress`, `doctor`, `map` and `docs` reads — never replaces it ([`isTaskAction`](../../../src/engine/logbook/read.ts)), so an agent reading status can't erase a failed gate; it still counts as activity. `running` records a recent start with no matching completion, and `last_activity` takes the later Git or logbook time. Disabling the logbook removes the action fields; Git activity remains available ([ADR 0210](../_adr/0210-effectful-verb-starts-are-paired-logbook-events.md)).

`fleet_collisions` pairs branches sharing changed files and retains the shared-file count; `adr_collisions` retains each contested number and its claimant branches, including branches without worktrees. Their path lists stay out of structured results. Terminal `--verbose` shows those paths, and a later `update` result names the shared paths that need re-reading. Full stored Proof pages appear only through terminal `--verbose`; structured modes carry the compact Proof claim ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)). Dirty, behind, and missing-Proof states remain `ok: true`; operational refusals do not.

`reappeared_worktree_paths` lists paths removed through discern's worktree lifecycle that currently exist without a live Git registration. Each row carries `path`, `removed_at`, `kind`, `entries`, a bounded `contents` sample, and `cleanup_blocked_reason` when prune must preserve it. The agent result places cleanup under Owner attention. The human dashboard retains the dry-run review route; status itself remains read-only ([ADR 0265](../_adr/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md)).

`parked_tasks` joins local Park metadata to the existing `unlanded_branches` population. It carries the retained branch commit, Park time, and task wording used by the desk and `start --from` resume flow. When those records cannot be read, `parked_tasks_unavailable` names the failure and `discern doctor` as the next command while the underlying unlanded branches stay visible. `recent_completed_tasks` is a bounded local tail from successful acceptance events and the latest landed Proof. These remain read-only views over existing lifecycle evidence ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)).

## Session findings

After setup, detectors can add recent logbook observations to `hints[]`. They inspect at most 200 events and exclude CI, previews, human activity, and other branches. Findings change no Git fact, Gate result, Proof, exit code, or `ok`; setup in progress and a disabled logbook suppress them. Run `discern patterns` for retained evidence ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

## Where it lives in code

| Concern                               | Source                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Status facts and hints                | [`status.ts`](../../../src/engine/status/status.ts)                                   |
| Pure package-component adaptation     | [`tty.ts`](../../../src/engine/status/tty.ts)                                         |
| Fleet row model shared by every view  | [`fleet_rows.ts`](../../../src/engine/status/fleet_rows.ts)                           |
| Row states, groups, and precedence    | [`row_states.ts`](../../../src/engine/status/row_states.ts)                           |
| Row-state matrix and wording guards   | [`engine_status_row_states_test.ts`](../../../tests/engine_status_row_states_test.ts) |
| Shared terminal facts and safe text   | [`terminal.ts`](../../../src/lib/terminal.ts)                                         |
| Result and Proof schemas              | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                          |
| Human and machine hint routing        | [`hints.ts`](../../../src/shared/hints.ts)                                            |
| Width, degradation, and state matrix  | [`engine_status_tty_test.ts`](../../../tests/engine_status_tty_test.ts)               |
| End-to-end status behavior            | [`engine_status_test.ts`](../../../tests/engine_status_test.ts)                       |
| Terminal-observation structural guard | [`terminal_boundary_guard_test.ts`](../../../tests/terminal_boundary_guard_test.ts)   |

## Current state and gotchas

- `status` never runs the Gate. A valid Proof is evidence from an earlier `done` run on the current clean `HEAD`.
- Fleet worktrees belong to separate efforts. A clean sibling remains occupied until its owner lands or drops it.
- A reappeared worktree path is no longer an active fleet member. Review its contents and close any program still writing there before confirmed prune.
- The dashboard and Markdown result are projections. Default JSON and MCP are also bounded for orientation; request verbose structured status only when exact full collections are needed.

## Release reminder

Status reads [release handoff evidence](../../../src/shared/release_check.ts) through its observation boundary and routes the registered `release-check-sequence` hint when the UTC calendar interval is due. The hint preserves the current request's authorization: proceed with an already requested check, ask if only the reminder prompted it, and install only within installation authority. It carries no claim that an update exists. The optional `release_reminder` fact also supplies the desk's advisory; neither observer writes the clock. Logbook settings do not change this evidence.
