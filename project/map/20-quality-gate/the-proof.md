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

_A clean green Gate records what ran and identifies the exact branch state ready for review._

`discern done` derives a structured Proof when the run passes on a clean, committed branch that is ahead of trunk. It renders in two forms from the same object ([ADR 0114](../_adr/0114-the-gate-emits-the-receipt.md), [ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)):

- **The line**: one sentence naming the branch, validated commit, diffstat, Standards state, and page command. JSON and MCP carry it as `data.proof.line`; `accept` derives `data.proof_line` from it and appends the recorded consent source. Agents quote that line verbatim after their account.
- **The page**: Standards, declared jobs and scope gates, then the diff command. It stays in the worktree marker and landed Proof note. Terminal `status --verbose` prints a valid page. Git owns commit and per-file lists; `Inspect:` names the command.

The complete in-process Proof owns both renderings. Compact results use a projection with branch, trunk, validated commit, diff counts, and line. They omit the page, which can otherwise appear several times in one status fleet. `discern <verb> --markdown` selects an authored result presentation; it does not substitute the full Proof page for that presentation.

`done` and `prepare` share package progress, grouped jobs, activity, and commands. `done` adds review, recording, and readiness facts; only `recorded` passes. `prepare` names omitted work. The byte-exact relay stays separate.

`accept` and `setup done` reuse it. Streaming stays raw. CI, `--plain`, oversized, or cursor-ineligible terminals stay static; pipes receive Proof; JSON and MCP omit Components. UTF-8 retains Unicode under `TERM=dumb` and no colour; exact `C` or `POSIX` uses ASCII.

`waited_ms` reports capped-run waits; durable Proof omits them ([ADR 0253](../_adr/0253-durable-proofs-project-runtime-receipts.md)).

The Proof pins a reviewable `HEAD` even if trunk advances. Without a verified grant, the agent reports and waits. `discern accept --confirmed` records conversation consent; standing and effort grants need no flag. Landing returns the final line.

A Proof may carry one `Logbook:` advisory from `hints[]`. `discern patterns` owns its evidence and next step. The advisory changes neither stored Proof, `ok`, nor acceptance ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

## When a Proof is recorded

The Gate pins `HEAD` and worktree cleanliness before jobs, then checks both before recording. It also rechecks the trunk. Movement warns you to update and rerun. A Proof is withheld when:

- the worktree had staged, uncommitted, or untracked changes;
- `HEAD` moved while the gate was running;
- the current branch is trunk, detached, or has no commits ahead of trunk;
- the Git facts needed for the review summary could not be read.

Before jobs run and again before the Proof is written, the Gate requires an empty tracked-refresh plan. Pending effects fail as `refresh_drift`; `done` names the paths without rewriting them.

The Gate can still pass when a review Proof is withheld for one of those identity or summary reasons. Its result explains why no Proof was emitted and tells you what to do next. Commit the intended tree, then rerun `discern done` on the clean final commit.

Write authority is different. Before any declared job or Standard measurement starts, discern performs a create, write, rename, and remove probe beside its Git administration marker files. If a sandbox or filesystem permission blocks that write, `done` fails immediately with `failed_stage = "write_access"` and a diagnostic naming the path. That early refusal prevents a green Gate result from being discarded because its Proof could not be saved ([ADR 0152](../_adr/0152-slow-workflows-prove-write-authority-first.md)).

## How later commands use it

discern stores the validated commit, structured Proof, and both renderings in the worktree's Git administration directory. The marker is local to that worktree and disappears when the worktree is removed ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)).

| Surface          | What it does with the Proof                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern done`   | Prints the job table and line at a TTY, or the page when piped. JSON and MCP return compact `data.proof`; Markdown selects the bounded facts for its evidence section.                                                                                                                                  |
| `discern status` | Reports whether the marker still matches the clean current `HEAD`. JSON, Markdown, MCP, and the status resource return Proof status plus compact facts; terminal `--verbose` retrieves the page. Status also reads a landed trunk-tip Proof from the local or fetched notes ref as `data.landed_proof`. |
| `discern accept` | Uses an honored marker to avoid repeating the Gate jobs and checks the current tracked-refresh plan before the fast-forward. It returns consent-qualified `data.proof_line` and records the complete structured Proof plus presentation as a Git note after landing.                                    |

Any commit, amend, or worktree edit invalidates the fast path because the marker no longer describes the tree that would land. A changed checkpoint conclusion or rationale invalidates it the same way at an unchanged `HEAD`: the marker binds to the declaration evidence it recorded, so acceptance never honors a Proof whose agent-declared conclusions have moved ([ADR 0298](../_adr/0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md)). `discern standards --pin` is the narrow exception: when it creates a limits-only commit from an honored state, it carries the Gate Proof forward ([ADR 0106](../_adr/0106-standards-pin-carries-the-gate-receipt.md)).

## After landing

After the trunk fast-forward, acceptance writes separate result and presentation blocks to a DSSE-compatible note under `refs/notes/discern`. The local unsigned record is on by default and fail-open; transport is opt-in. [Proof notes](proof-notes.md) covers inspection, publication, and recovery.

## Re-running an unchanged tree

Beside the Proof, every completed run records the exact tree it judged, its checkpoint declaration evidence, and the verdict in a last-run marker, including red runs. Ask `discern done` to run again on that identical state and it refuses read-only before any job or fixer runs. An unchanged tree expects an unchanged verdict. A green rerun repeats the full Gate for the result `discern status` already shows; retrying a red run until it passes can hide a flake. `discern done --confirmed` reruns it as an attested, recorded probe. Any edit, commit, changed checkpoint conclusion, or `--dry-run` runs as normal ([ADR 0185](../_adr/0185-done-refuses-an-unchanged-tree-rerun-without-confirmed.md), [ADR 0298](../_adr/0298-declaration-evidence-binds-proof-currency-and-variance-authorization.md)).

The public result fields are in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                        | Source                                                         |
| ------------------------------ | -------------------------------------------------------------- |
| Marker identity and validation | [`proof.ts`](../../../src/engine/gate/proof.ts)                |
| Write-authority probe          | [`write_preflight.ts`](../../../src/shared/write_preflight.ts) |
| Proof facts and markdown       | [`proof_render.ts`](../../../src/engine/gate/proof_render.ts)  |
| Pure human presentation        | [`presentation.ts`](../../../src/engine/gate/presentation.ts)  |
| Live TTY effects and viewport  | [`gate_tty.ts`](../../../src/engine/gate/gate_tty.ts)          |
| `done` proof panel             | [`done_tty.ts`](../../../src/engine/gate/done_tty.ts)          |
| `done` integration             | [`finish.ts`](../../../src/engine/gate/finish.ts)              |
| `prepare` integration          | [`prepare.ts`](../../../src/engine/gate/prepare.ts)            |
| Landing validation             | [`lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)    |
| Setup validation               | [`setup.ts`](../../../src/commands/setup.ts)                   |

## Current state & gotchas

- A green result over a dirty tree is useful while iterating, but it cannot describe a reviewable commit. Look at `data.gate_proof.status` before claiming the branch is ready.
- The marker is a cache of a real Gate result. If it is missing, stale, or unreadable, acceptance validates the tree again.
- The preflight is a point-in-time check. Proof writes remain best-effort against a permission change or filesystem failure that occurs after the probe; that rare late failure remains visible in `data.gate_proof`.
- A Logbook hint is advice beside the Proof. The stored Markdown and its commit identity remain unchanged.
