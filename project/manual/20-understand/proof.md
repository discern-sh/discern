---
id: explanation-proof
title: "Proof"
description: "Distinguish green, exact-tree Proof, declared conclusions, review, landing authority, landed state, and later release."
order: 30
publish: true
kind: explanation
aliases:
  - "gate"
  - "explanation-proof"
  - "The Proof"
  - "gate proof"
  - "review proof"
  - "proof of done"
  - "landing authority"
  - "standing grant"
  - "effort grant"
  - "pre-authorized landing"
redirect_from:
  - "/docs/quality-gate/the-proof"
  - "/docs/worktrees/landing-authority"
---

# Proof

Distinguish green, exact-tree Proof, declared conclusions, review, landing authority, landed state, and later release.

## The Proof

_A clean green Gate records what ran and identifies the exact branch state ready for review._

`discern done` derives a structured Proof when the run passes on a clean, committed branch that is ahead of trunk. It renders in two forms from the same object ([ADR 0114](https://discern.sh/docs/decisions/0114-the-gate-emits-the-receipt), [ADR 0188](https://discern.sh/docs/decisions/0188-the-receipt-relays-as-one-line)):

- **The line**: one sentence naming the branch, validated commit, diffstat, Standards state, any Standard limit proposals, and the page command. JSON and MCP carry it as `data.proof.line`; `accept` derives `data.proof_line` by rewriting awaiting-decision segments to their resolved state and appending the consent source. Agents quote that line verbatim after their account.
- **The page**: Standard limit proposals, routine Standards, declared jobs and scope gates, then the diff command. It stays in the worktree marker and landed Proof note. Terminal `status --verbose` prints a valid page. Git owns commit and per-file lists; `Inspect:` names the command.

The complete in-process Proof owns both renderings. Compact results use a projection with branch, trunk, validated commit, diff counts, and line. They omit the page, which can otherwise appear several times in one status fleet. `discern <verb> --markdown` selects an authored result presentation; it does not substitute the full Proof page for that presentation.

An ordinary `discern done` Proof is strict landing evidence. An explicit `discern done --ci` Proof is a separate report identity: it states that checkpoint review was reported and was not enforced. `status` retains that identity as `report_only`; both acceptance preview and apply refuse it and require ordinary `discern done`. The durable note writer also rejects report identity, so acceptance does not depend on one refusal path ([ADR 0307](https://discern.sh/docs/decisions/0307-ci-reports-checkpoint-review-and-proof-retains-drops)).

Proof also carries every structured checkpoint drop from the run: an uncertainty that prevented checkpoint enforcement while leaving the Gate fail-open. The same bounded record survives compact results, status, acceptance review, and the landed note. It tells the owner which enforcement uncertainty remained in a green run.

`done` and `prepare` share package progress, grouped jobs, activity, and commands. `done` adds review, recording, and readiness facts; only `recorded` passes. `prepare` names omitted work. The byte-exact relay stays separate.

On exact, complete, current green Proof, ordinary `done` returns that Proof without Gate work. `data.gate_ran` distinguishes measurement (`true`) from reuse (`false`).

`accept` and both setup verbs reuse it. Non-forced setup returns `data.proof` and `data.proof_line`; force returns neither. Clean completed setup re-serves its evidence and inventory with `data.completion = "replayed"`, `data.effects_performed = false`, and `data.gate_ran = false`. Streaming stays raw. CI, `--plain`, oversized, or cursor-ineligible terminals stay static; pipes receive Proof; JSON and MCP omit Components. UTF-8 retains Unicode under `TERM=dumb` and no colour; exact `C` or `POSIX` uses ASCII.

`waited_ms` reports capped-run waits; durable Proof omits them ([ADR 0253](https://discern.sh/docs/decisions/0253-durable-proofs-project-runtime-receipts)).

The Proof pins a reviewable `HEAD` even if trunk advances. Without a verified grant, the agent reports and waits. `discern accept --confirmed` records conversation consent; standing and effort grants need no flag. Landing returns the final line.

### Proposal-bearing Proof

A live Standard limit proposal lets the Gate explain one otherwise-forbidden limit change. The Gate forces a fresh measurement for that Standard, including `measure = "on-demand"` and replay-eligible entries. The measured value must equal the proposal. Proof then carries the Standard, trunk and proposed limits, measurement, signed delta, verbatim reason, responsible paths, definition fingerprint, and commit identities.

The Proof line states the open proposal as awaiting the owner's exact approval. The page presents the proposal before routine Standard results. Compact JSON, Markdown, Model Context Protocol results, status, and proof notes retain the structured proposal. A green proposal-bearing Proof establishes Gate success for that committed tree; it grants neither landing authority nor proposal approval.

Acceptance requires the worktree-local proposal record to equal the proposal set in Proof. It serves a token for each current Standard/value/reason tuple and changes nothing. Generic consent and recorded grants cannot satisfy this decision. [Landing authority](proof.md) covers the separate acceptance boundary.

A Proof may carry one `Logbook:` advisory from `hints[]`. `discern patterns` owns its evidence and next step. The advisory changes neither stored Proof, `ok`, nor acceptance ([ADR 0160](https://discern.sh/docs/decisions/0160-local-logbook-advisory-readers)).

### When a Proof is recorded

The Gate pins `HEAD` and worktree cleanliness before jobs, then checks both before recording. It also rechecks the trunk. Movement warns you to update and rerun. A Proof is withheld when:

- the worktree had staged, uncommitted, or untracked changes;
- `HEAD` moved while the gate was running;
- the current branch is trunk, detached, or has no commits ahead of trunk;
- the Git facts needed for the review summary could not be read.

Before jobs run and again before the Proof is written, the Gate requires an empty tracked-refresh plan. Pending effects fail as `refresh_drift`; `done` names the paths without rewriting them.

The Gate can still pass when a review Proof is withheld for one of those identity or summary reasons. Its result explains why no Proof was emitted and tells you what to do next. Commit the intended tree, then rerun `discern done` on the clean final commit.

Write authority is different. Before any declared job or Standard measurement starts, discern performs a create, write, rename, and remove probe beside its Git administration marker files. If a sandbox or filesystem permission blocks that write, `done` fails immediately with `failed_stage = "write_access"` and a diagnostic naming the path. That early refusal prevents a green Gate result from being discarded because its Proof could not be saved. The probe observes only that invocation; provider authority may change later ([ADR 0152](https://discern.sh/docs/decisions/0152-slow-workflows-prove-write-authority-first)).

The operation boundary also holds the checkout lock around effectful `done`, `prepare`, and `refresh` invocations. A second discern writer in that checkout refuses before its command body, states that the call made no change, and retries after the active operation finishes. Observations and dry runs remain concurrent. The lock keeps fixers, generated files, Gate inputs, and Proof evidence within one invocation's checkout state; the write probe still answers the separate question of filesystem authority ([ADR 0330](https://discern.sh/docs/decisions/0330-every-command-path-declares-its-operation-effects), [ADR 0331](https://discern.sh/docs/decisions/0331-common-repository-locks-precede-checkout-locks)).

### How later commands use it

discern stores the validated commit, structured Proof, and both renderings in the worktree's Git administration directory. The marker is local to that worktree and disappears when the worktree is removed ([ADR 0067](https://discern.sh/docs/decisions/0067-accept-validates-the-landed-tree)).

| Surface                | What it does with the Proof                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`         | Prints measured results normally; exact current green evidence instead returns its Proof with `data.gate_ran = false` and no Gate step. JSON and MCP return compact `data.proof`; Markdown selects bounded evidence.                                                                                                                                                                                                       |
| `discern status`       | Reports whether the marker still matches the clean current `HEAD`. JSON, Markdown, MCP, and the status resource return Proof status plus compact facts; terminal `--verbose` retrieves the page. Status also reads a landed trunk-tip Proof from the local or fetched notes ref as `data.landed_proof`.                                                                                                                    |
| `discern accept`       | Uses an honored strict marker to avoid repeating the Gate jobs and checks the current tracked-refresh plan before the fast-forward. It rejects report-only Proof, requires separate token-bound approval for every Standard limit proposal, retains checkpoint drops through review, returns consent-qualified `data.proof_line`, and records the complete structured Proof plus presentation as a Git note after landing. |
| `discern setup done`   | Replays current Proof read-only or validates an existing clean marker. New completion commits and probes one marker, then runs the Gate last. Failure removes only its exact owned tip; changed state is retained.                                                                                                                                                                                                         |
| `discern setup accept` | Requires the complete current setup Proof before preview or apply. It refuses invalid evidence without moving refs, proves a moved-trunk merge separately, lands the full commit pinned by Proof, and writes the same durable Proof note as normal acceptance.                                                                                                                                                             |

Any commit, amend, or worktree edit invalidates the fast path because the marker no longer describes the tree that would land. A changed checkpoint conclusion or rationale invalidates it at an unchanged `HEAD`: the marker binds to the declaration evidence it recorded, so acceptance never honors a Proof whose agent-declared conclusions have moved ([ADR 0298](https://discern.sh/docs/decisions/0298-declaration-evidence-binds-proof-currency-and-variance-authorization)). A changed, revoked, or stale Standard proposal also invalidates reuse at the same `HEAD`. The live proposal set must equal the Proof set. `discern standards --pin` is the narrow exception: when it creates a limits-only commit from an honored state, it carries the Gate Proof forward ([ADR 0106](https://discern.sh/docs/decisions/0106-standards-pin-carries-the-gate-receipt), [ADR 0339](https://discern.sh/docs/decisions/0339-proposed-standard-limits-and-shared-measurements)).

### After landing

After the trunk fast-forward, normal and setup acceptance write separate result and presentation blocks to a DSSE-compatible note under `refs/notes/discern`. Normal acceptance evidence includes each approved Standard limit proposal. The local unsigned record is on by default and fail-open. Transport is opt-in. [Proof notes](../30-reference/proof-and-checkpoint-formats.md) covers inspection, publication, and recovery.

### Re-running an unchanged tree

Every completed run records its exact tree, checkpoint evidence, and verdict. Before any fixer or job, ordinary `done` on that state:

- returns canonical Proof with `data.gate_ran = false` only when strict evidence is complete and current; or
- refuses read-only after red, or when green evidence is missing, unreadable, stale, dirty, report-only, or declaration-stale.

`discern done --rerun` explicitly measures the same state and records that choice. Existing `done --confirmed` scripts remain compatible; consent-bearing commands keep `--confirmed`. Changed trees run normally, while `--dry-run` creates and reuses no evidence ([ADR 0319](https://discern.sh/docs/decisions/0319-current-green-proof-composes-and-red-reruns-stay-explicit), [ADR 0298](https://discern.sh/docs/decisions/0298-declaration-evidence-binds-proof-currency-and-variance-authorization)).

The public result fields are in [MCP tools & results](../30-reference/mcp-and-results.md).

### Where it lives in code

| Concern                         | Source                                                                    |
| ------------------------------- | ------------------------------------------------------------------------- |
| Marker identity and validation  | [`proof.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/proof.ts)                           |
| Proposal authority and currency | [`standard_proposals.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/standard_proposals.ts) |
| Write-authority probe           | [`write_preflight.ts`](https://github.com/jackwh/discern/blob/main/src/shared/write_preflight.ts)            |
| Operation exclusion             | [`operation_lock.ts`](https://github.com/jackwh/discern/blob/main/src/engine/operation_lock.ts)              |
| Proof facts and markdown        | [`proof_render.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/proof_render.ts)             |
| Pure human presentation         | [`presentation.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/presentation.ts)             |
| Live TTY effects and viewport   | [`gate_tty.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/gate_tty.ts)                     |
| `done` proof panel              | [`done_tty.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/done_tty.ts)                     |
| `done` integration              | [`finish.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/finish.ts)                         |
| `prepare` integration           | [`prepare.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/prepare.ts)                       |
| Landing validation              | [`lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts)               |
| Setup validation                | [`setup.ts`](https://github.com/jackwh/discern/blob/main/src/commands/setup.ts)                              |
| Setup landing validation        | [`setup_accept.ts`](https://github.com/jackwh/discern/blob/main/src/commands/setup_accept.ts)                |

### Current state & gotchas

- A green result over a dirty tree is useful while iterating, but it cannot describe a reviewable commit. Look at `data.gate_proof.status` before claiming the branch is ready.
- The marker is a cache of a real Gate result. Normal worktree acceptance can validate a missing or stale marker by rerunning the Gate. Setup acceptance refuses incomplete evidence and routes through `discern setup done`; that command replays honored evidence or validates the same clean marker commit while owning the structural worktree probe.
- The preflight is a point-in-time check. Proof writes remain best-effort against a permission change or filesystem failure that occurs after the probe; that rare late failure remains visible in `data.gate_proof`.
- A Logbook hint is advice beside the Proof. The stored Markdown and its commit identity remain unchanged.
- A proposal-bearing Proof is green Gate evidence with an unresolved owner decision. Report the proposal and use the approval command served by `discern accept`. Do not describe the branch as approved to land.
## Landing authority

_discern verifies landing authority before moving the trunk._

A green [Proof](proof.md) records that an exact clean commit passed the declared Gate. Landing permission comes from conversation consent or a recorded grant for the worktree ([ADR 0194](https://discern.sh/docs/decisions/0194-standing-pre-authorization-is-a-recorded-checked-grant)).

A Proof that contains a Standard limit proposal also needs separate owner approval for each current Standard/value/reason tuple. Landing authority does not cover that narrower decision ([ADR 0339](https://discern.sh/docs/decisions/0339-proposed-standard-limits-and-shared-measurements)).

### Authority sources

| Source         | Evidence                                                                                               | Lifetime               |
| -------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- |
| Conversation   | `discern accept --confirmed` attests to acceptance in this conversation.                               | One call.              |
| Standing grant | The trunk's `[acceptance].pre_authorized` lists granted [scopes](../30-reference/glossary.md#scope). | Every covered landing. |
| Effort grant   | **Pre-authorize landing once green** at [the desk](../10-guides/delegate-work.md).                                       | That worktree.         |

`--confirmed` means conversation consent only. Standing authority comes from the trunk's committed `[acceptance]`. The worktree branch cannot supply it.

Fresh setup's standing-grant example names `docs`, whose seed contains the Map and deferred-work ledger. The separate `instructions` seed contains the project brief, instruction sources, authored Skills, and materialized Skill directories; it stays outside that example and reaches the owner for review. Upgrade leaves existing named scopes unchanged, so owners of earlier installs split their scope manually to adopt this boundary ([ADR 0209](https://discern.sh/docs/decisions/0209-fresh-seed-grants-cover-pure-documentation)).

### How discern resolves coverage

`start` reports possible standing scopes. `status` and green `done` classify the final paths: every path must match a known granted scope. Unknown grants and unmatched paths stay uncovered. Effort grants bind to their branch.

When a grant exists, `data.landing_authority` carries the result:

| Field             | Meaning                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`            | `authorized` or `conversation-required`.                                                                                                          |
| `source`          | `standing-grant` or `effort-grant`.                                                                                                               |
| `scopes`          | Standing scopes covering the tree.                                                                                                                |
| `standing_scopes` | Known grants, including prospective or partial matches.                                                                                           |
| `uncovered`       | Paths that still need conversation review. `[generated.<name>]`-owned paths carry `generated: true`: counted by authority, collapsed in displays. |
| `warnings`        | Untrusted evidence, such as an invalid recorded grant.                                                                                            |

Without grant evidence, the branch returns for [conversation review](../10-guides/finish-and-land-a-change.md). `accept` records the source and any scopes in its result and Proof ([ADR 0188](https://discern.sh/docs/decisions/0188-the-receipt-relays-as-one-line)).

When `accept` has no landing authority, it changes nothing. Every supported result says what would have landed, confirms that the worktree, branch, and trunk remain untouched, and routes the change to review. After the owner approves the change in the current conversation, run `discern accept --confirmed`. On success, `data.consent`, the proof line, and the Logbook name the permission source: current conversation, standing grant, or effort grant.

An interrupted call does not widen any source. [Interrupted landing recovery](../10-guides/recover-an-interrupted-task.md) explains how a journal binds consent to one transition and how a retry reconciles it.

### Approve a Standard limit proposal

`discern accept` checks Standard limit proposals before applying landing authority. The live worktree proposal record must equal the proposal set in the honored Proof. A mismatch, stale record, reason change, or revocation refuses without moving the trunk.

The read-only refusal names each Standard, old and proposed limits, measurement, delta, reason, responsible paths, and an approval token. The token is a 64-character lowercase hexadecimal digest of the exact Standard, value, and reason. It prevents an approval command copied for one tuple from approving a changed tuple; it grants no authority by itself. Relay those facts to the owner. After the owner approves the current tuples in this conversation, run the complete command returned by discern:

```sh
discern accept --confirmed --approve-standard <token>
```

Repeat the flag for every proposal. The token set must equal the current proposal set. `--confirmed` records current conversation consent. Each token identifies the approved Standard/value/reason tuple. Standing grants, effort grants, generic conversation consent, checkpoint variances, and earlier tokens do not supply this approval.

If the owner declines, leave acceptance stopped. Restore the trunk limit in the branch, commit the restoration, and run `discern done` under ordinary enforcement. Acceptance never changes the proposed limit after Proof.

### Where it lives in code

| Concern                   | Source                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolution and vocabulary | [`landing_authority.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/landing_authority.ts), [`consent.ts`](https://github.com/jackwh/discern/blob/main/src/shared/consent.ts)                             |
| Standing grants           | [`config_schema.ts`](https://github.com/jackwh/discern/blob/main/src/shared/config_schema.ts)                                                                                              |
| Effort grants             | [`effort_grant.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/effort_grant.ts), [`effort_grant_writer.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/effort_grant_writer.ts)      |
| Standard limit approval   | [`standard_proposals.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/standard_proposals.ts), [`lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts)                  |
| Results and surface guard | [`result_schemas.ts`](https://github.com/jackwh/discern/blob/main/src/shared/result_schemas.ts), [`engine_lifecycle_authority_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_lifecycle_authority_test.ts) |

### Current state & gotchas

- Standing authority is pinned to its trunk commit; concurrent advances refuse.
- Landing consumes the claim. Drop, prune, and orphan cleanup reap abandoned state.
- Uncertainty returns to conversation review; it never widens authority.
- Approval of a Standard limit proposal binds one acceptance call to the current proposal set. It is not a standing source of landing authority.
