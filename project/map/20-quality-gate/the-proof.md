---
title: The Proof
description: Read the review summary a clean green Gate records for the exact commit that passed.
order: 40
aliases:
  - gate proof
  - review proof
  - proof of done
---

# The Proof

_A clean green gate records what ran and identifies the exact branch state ready for review._

`discern done` derives a structured Proof when the run passes on a clean, committed branch that is ahead of trunk. It renders in two forms from the same object ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md), [ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md), [ADR 0361](../_adr/0361-the-proof-line-is-canonical-commonmark.md)):

- **The line**: a one-line CommonMark blockquote naming the branch, validated commit, diffstat, Standards state, any Standard limit proposals, and the page command. `data.proof.line` is the canonical Markdown source: JSON, MCP, the marker, and Proof notes carry it unchanged. Markdown results place it as a standalone block, while terminal and Desk surfaces render it through the shared Markdown presenter. `accept` derives `data.proof_line` by rewriting awaiting-decision segments to their resolved state and appending the consent source. Agents copy the source verbatim after their account, so Markdown-capable transcripts give it the same visual identity everywhere.
- **The page**: Standard limit proposals, routine Standards, declared jobs and scope gates, then the diff command. It stays in the worktree marker and landed Proof note. Terminal `status --verbose` prints a valid page. Git owns commit and per-file lists; `Inspect:` names the command.

The complete in-process Proof owns both renderings. Compact results use a projection with branch, trunk, validated commit, diff counts, and line. They omit the page, which can otherwise appear several times in one status fleet. `discern <verb> --markdown` selects an authored result presentation; it does not substitute the full Proof page for that presentation.

An ordinary `discern done` Proof is strict landing evidence. An explicit `discern done --ci` Proof is a separate report identity: it states that checkpoint review was reported and was not enforced. `status` retains that identity as `report_only`; both acceptance preview and apply refuse it and require ordinary `discern done`. A CI run at the same `HEAD` never replaces an already honored strict marker with weaker report evidence. The durable note writer also rejects report identity, so acceptance does not depend on one refusal path ([ADR 0307](../_adr/0307-ci-reports-checkpoint-review-and-proof-retains-drops.md)).

Proof also carries every structured checkpoint drop from the run. The same bounded record survives compact results, status, acceptance review, and the landed note. An indeterminate executable `stop` is served over full structural evidence; a Proof carrying that drop is never reused and can land only with current-conversation confirmation. A lost tracked-dirty strand observation is disclosed as unavailable rather than described as checked, and likewise prevents reusable Proof.

`done` and `prepare` share package progress, grouped jobs, activity, and commands. `done` adds review, recording, and readiness facts; only `recorded` passes. `prepare` names omitted work. The byte-exact CommonMark relay stays separate.

On exact, complete, current green Proof, ordinary `done` returns that Proof without gate work. `data.gate_ran` distinguishes measurement (`true`) from reuse (`false`).

`accept` and both setup verbs reuse it. Ordinary setup completion records `setup_completion = "proven"` and returns `data.proof` and `data.proof_line`. `discern setup done --unproven` records the completion event as unproven and returns neither; setup acceptance refuses it until a later ordinary completion converges the state to proven. Clean proven setup re-serves its evidence and inventory with `data.completion = "replayed"`, `data.effects_performed = false`, and `data.gate_ran = false`. Streaming stays raw. CI, `--plain`, oversized, or cursor-ineligible terminals stay static; pipes receive Proof; JSON and MCP omit Components. UTF-8 retains Unicode under `TERM=dumb` and no colour; exact `C` or `POSIX` uses ASCII.

`waited_ms` reports capped-run waits; durable Proof omits them ([ADR 0253](../_adr/0253-durable-proofs-project-runtime-receipts.md)).

Proof binds the full committed `HEAD`, a clean tree, checkpoint declaration evidence, and each reusable standard's definition fingerprint and measured provenance. Proof omits a trunk SHA. A later trunk advance does not itself stale the marker. Reuse first reads the configured local trunk and refuses when the branch is behind or the local ref is unavailable. A remote-tracking ref is not a substitute. Without a verified grant, the agent reports and waits. `discern accept --confirmed` records conversation consent; standing and effort grants need no flag. Landing returns the final line.

## Proposal-bearing Proof

A live standard limit proposal lets the gate explain one otherwise-forbidden limit change. The shared evaluator supplies a current applicable measurement for that standard. The measured value must equal the proposal; changed producer dependencies or context make the proposal stale. Proof carries the standard, trunk and proposed limits, measurement, signed delta, verbatim reason, responsible paths, definition fingerprint, immutable proposal commit and measured parent, and the current descendant commit to which renewed evidence is bound ([ADR 0354](../_adr/0354-standard-proposals-renew-descendant-evidence.md)).

The Proof line states the open proposal as awaiting the owner's exact approval. The page presents the proposal before routine standard results. Compact JSON, Markdown, Model Context Protocol results, status, and Proof notes retain the structured proposal. A green proposal-bearing Proof establishes gate success for that committed tree; it grants neither landing authority nor proposal approval.

Acceptance requires the worktree-local proposal record to equal the proposal set in Proof. It serves a token for each current standard/value/reason tuple and changes nothing. Generic consent and recorded grants cannot satisfy this decision. [Landing authority](../30-worktrees/landing-authority.md) covers the separate acceptance boundary.

A Proof may carry one `Logbook:` advisory from `hints[]`. `discern patterns` owns its evidence and next step. The advisory changes neither stored Proof, `ok`, nor acceptance ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

## When a Proof is recorded

The gate pins `HEAD` and worktree cleanliness before jobs, then checks both before recording. It also rechecks the trunk. Movement warns you to update and rerun. A Proof is withheld when:

- the worktree had staged, uncommitted, or untracked changes;
- `HEAD` moved while the gate was running;
- the current branch is trunk, detached, or has no commits ahead of trunk;
- the Git facts needed for the review summary could not be read.

Before jobs run and again before the Proof is written, the gate requires an empty tracked-refresh plan. Pending effects fail as `refresh_drift`; `done` names the paths without rewriting them.

The gate can still pass when a review Proof is withheld for one of those identity or summary reasons. Its result explains why no Proof was emitted and tells you what to do next. Commit the intended tree, then rerun `discern done` on the clean final commit.

Write authority is different. Before any declared job or standard measurement starts, discern performs a create, write, rename, and remove probe beside its Git administration marker files. If a sandbox or filesystem permission blocks that write, `done` fails immediately with `failed_stage = "write_access"` and a diagnostic naming the path. That early refusal prevents a green gate result from being discarded because its Proof could not be saved. The probe observes only that invocation; provider authority may change later ([ADR 0152](../_adr/0152-slow-workflows-prove-write-authority-first.md)).

The operation boundary also holds the checkout lock around effectful `done`, `prepare`, and `refresh` invocations. A second discern writer in that checkout refuses before its command body, states that the call made no change, and retries after the active operation finishes. Observations and dry runs remain concurrent. The lock keeps fixers, generated files, Gate inputs, and Proof evidence within one invocation's checkout state; the write probe still answers the separate question of filesystem authority ([ADR 0330](../_adr/0330-every-command-path-declares-its-operation-effects.md), [ADR 0331](../_adr/0331-common-repository-locks-precede-checkout-locks.md)).

## How later commands use it

discern stores the validated commit, structured Proof, and both renderings as a registered version-1 JSON document in the worktree's Git administration directory. `version`, `head`, and `mode` identify the record; `proof` carries the structured result, its two renderings, and any live standard-proposal set, while `evidence` binds checkpoint declarations. The marker is local to that worktree and disappears when the worktree is removed ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md), [ADR 0368](../_adr/0368-local-durable-formats-declare-forward-skew.md)).

Only a current-format marker with a complete structured Proof and line can enter a gate-reuse or landing fast path. Incomplete marker state remains inspectable but forces a fresh gate. Text without a version supplies no evidence. A marker written by a newer discern is diagnosed and retained until discern is updated; an older writer never replaces it.

| Surface                | What it does with the Proof                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`         | Prints measured results normally; exact current green evidence instead returns its Proof with `data.gate_ran = false` and no Gate step. JSON and MCP return compact `data.proof`; Markdown selects bounded evidence.                                                                                                                                                                                                       |
| `discern status`       | Reports whether the marker still matches the clean current `HEAD`. JSON, Markdown, MCP, and the status resource return Proof status plus compact facts; terminal `--verbose` retrieves the page. Status also reads a landed trunk-tip Proof from the local or fetched notes ref as `data.landed_proof`.                                                                                                                    |
| `discern accept`       | Uses an honored strict marker to avoid repeating the Gate jobs and checks the current tracked-refresh plan before the fast-forward. It rejects report-only Proof, requires separate token-bound approval for every Standard limit proposal, retains checkpoint drops through review, returns consent-qualified `data.proof_line`, and records the complete structured Proof plus presentation as a Git note after landing. |
| `discern setup done`   | Replays current Proof read-only or validates an existing clean marker. New completion commits and probes one marker, then runs the Gate last. Failure removes only its exact owned tip; changed state is retained.                                                                                                                                                                                                         |
| `discern setup accept` | Requires the complete current setup Proof before preview or apply. It refuses invalid evidence without moving refs, proves a moved-trunk merge separately, lands the full commit pinned by Proof, and writes the same durable Proof note as normal acceptance.                                                                                                                                                             |

Any commit, amend, or worktree edit invalidates the fast path because the marker no longer describes the tree that would land. A changed checkpoint conclusion or rationale invalidates it at an unchanged `HEAD`: the marker binds to the declaration evidence it recorded, so acceptance never honors a Proof whose agent-declared conclusions have moved ([ADR 0298](../_adr/0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md)). A changed, revoked, rebound, or stale standard proposal also invalidates reuse at the same `HEAD`. The live proposal set, including each renewable bound commit, must equal the Proof set. A `discern standards --pin` commit also moves `HEAD`; run `discern done` afterwards or acceptance performs that gate itself ([ADR 0106](../_adr/0106-standards-pin-carries-the-gate-receipt.md), [ADR 0368](../_adr/0368-local-durable-formats-declare-forward-skew.md)).

## After landing

After the trunk fast-forward, normal and setup acceptance write separate result and presentation blocks to a DSSE-compatible note under `refs/notes/discern`. Normal acceptance evidence includes each approved standard limit proposal. The local unsigned record is on by default and fail-open. Transport is opt-in. [Proof notes](proof-notes.md) covers inspection, publication, and recovery.

## Re-running an unchanged tree

Every completed run records its exact tree, checkpoint evidence, and verdict. Before any fixer or job, ordinary `done` on that state:

- returns canonical Proof with `data.gate_ran = false` only when strict evidence is complete and current; or
- refuses read-only after red, or when green evidence is missing, unreadable, stale, dirty, report-only, or declaration-stale.

`discern done --rerun` explicitly measures the same state and records that choice. Consent-bearing commands use `--confirmed`; Gate reruns do not. Changed trees run normally, while `--dry-run` creates and reuses no evidence ([ADR 0319](../_adr/0319-current-green-proof-composes-and-red-reruns-stay-explicit.md), [ADR 0298](../_adr/0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md)).

The public result fields are in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                         | Source                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Marker identity and validation  | [`proof.ts`](../../../src/engine/gate/proof.ts)                                     |
| Proposal authority and currency | [`standard_proposal_state.ts`](../../../src/engine/gate/standard_proposal_state.ts) |
| Write-authority probe           | [`write_preflight.ts`](../../../src/shared/write_preflight.ts)                      |
| Operation exclusion             | [`operation_lock.ts`](../../../src/engine/operation_lock.ts)                        |
| Proof facts and markdown        | [`proof_render.ts`](../../../src/engine/gate/proof_render.ts)                       |
| Pure human presentation         | [`presentation.ts`](../../../src/engine/gate/presentation.ts)                       |
| Live TTY effects and viewport   | [`gate_tty.ts`](../../../src/engine/gate/gate_tty.ts)                               |
| `done` proof panel              | [`done_tty.ts`](../../../src/engine/gate/done_tty.ts)                               |
| `done` integration              | [`finish.ts`](../../../src/engine/gate/finish.ts)                                   |
| `prepare` integration           | [`prepare.ts`](../../../src/engine/gate/prepare.ts)                                 |
| Landing validation              | [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)                         |
| Setup validation                | [`setup.ts`](../../../src/commands/setup.ts)                                        |
| Setup landing validation        | [`setup_accept.ts`](../../../src/commands/setup_accept.ts)                          |

## Current state & gotchas

- A green result over a dirty tree is useful while iterating, but it cannot describe a reviewable commit. Look at `data.gate_proof.status` before claiming the branch is ready.
- The marker is a cache of a real Gate result. Normal worktree acceptance can validate a missing or stale marker by rerunning the Gate. Setup acceptance refuses incomplete evidence and routes through `discern setup done`; that command replays honored evidence or validates the same clean marker commit while owning the structural worktree probe.
- The preflight is a point-in-time check. Proof writes remain best-effort against a permission change or filesystem failure that occurs after the probe; that rare late failure remains visible in `data.gate_proof`.
- A Logbook hint is advice beside the Proof. The stored Markdown and its commit identity remain unchanged.
- A proposal-bearing Proof is green Gate evidence with an unresolved owner decision. Report the proposal and use the approval command served by `discern accept`. Do not describe the branch as approved to land.
- A current registered marker retains its original Proof presentation while it remains exact. Local marker text without a version is not reusable evidence.
