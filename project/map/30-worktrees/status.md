---
title: Status and session hints
description: Read the current worktree or fleet state, its next actions, and recent session findings without running the gate.
order: 50
aliases:
  - discern status
  - worktree status
  - fleet status
  - session findings
---

# Status and session hints

_`discern status` reports what is true now and what to do next. It runs no gate job, test, standard measurement, or setup action._

Use it at the start of every agent session and whenever the next workflow move is unclear. The JSON, command-line, and Model Context Protocol (MCP) forms derive from the same result envelope.

## What status reads

Inside a linked worktree, the default view is local. It reports the branch, cleanliness, commits ahead of and behind the [trunk](../00-orientation/glossary.md#trunk), incoming overlap, changed [scopes](../00-orientation/glossary.md#scope), the gate jobs those changes wake, generated-file currency, worktree identity, and whether the clean `HEAD` has an honored [receipt](../20-quality-gate/the-receipt.md). When it does, `data.gate_receipt` carries the stored receipt page and line.

From the main checkout, `status` leads with the fleet when worktrees exist. Every row names its checkout and branch, git state, ahead/behind counts, last activity, and whether the checkout is broken. A row whose clean `HEAD` holds an honored receipt also carries `receipt_honored`, the stored page, and the line, so you review a ready branch from where you sit. `--local` suppresses the fleet. `--all` adds it from a worktree. Those 2 flags conflict because they request opposite views.

`--verbose` prints each honored receipt page in the interactive output — the local branch's, and every ready fleet row's beneath the table. The JSON and MCP payloads carry the receipt with or without the flag ([ADR 0188](../_adr/0188-the-receipt-relays-as-one-line.md)).

Two collision scans watch concurrent efforts. `fleet_collisions` pairs fleet branches whose changes touch the same files. `adr_collisions` lists ADR record numbers claimed by more than one in-flight branch — different files that merge cleanly, so this warning is the only signal before the gate refuses the landed duplicate ([ADR 0186](../_adr/0186-adr-number-uniqueness-is-gate-enforced.md)). The ADR scan covers unlanded branches without a worktree too, and the local worktree view keeps the collisions the current branch is party to.

The result remains an observation when the branch is dirty, behind, or missing a receipt. Those states keep `ok: true`; `hints[]` recommends the next command. Operational refusals, such as conflicting flags, use `ok: false`.

```sh
discern status
discern status --json
discern status --all
discern status --local
discern status --verbose
```

## Session findings

After setup is complete, inline session-scope detectors can append recent logbook observations to `hints[]`. A repeated refusal is the clearest case: the hint states how many calls returned the same slug and carries the detector registry's next step. The text arrives while the agent is already orienting, before another retry.

These detectors inspect at most the newest 200 [logbook](../70-reference/the-logbook.md) events. Driver scoring removes CI runs, previews, and interactive human activity from agent-behavior populations. A finding from another branch is absent from the local worktree view. Setup in progress and `[project].logbook = false` suppress the additions.

Session findings are advice. They change no git fact, gate result, receipt, exit code, or `ok` value. Run `discern patterns` for the complete report and its evidence thresholds ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

## Where it lives in code

| Concern                   | Source                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Status facts and hints    | [`status.ts`](../../../src/engine/status/status.ts)                                   |
| Detector registry         | [`detectors.ts`](../../../src/engine/logbook/detectors.ts)                            |
| Scope and tier routing    | [`routing.ts`](../../../src/engine/logbook/routing.ts)                                |
| Bounded inline reader     | [`surfaces.ts`](../../../src/engine/logbook/surfaces.ts)                              |
| End-to-end route coverage | [`engine_findings_surfaces_test.ts`](../../../tests/engine_findings_surfaces_test.ts) |

## Current state & gotchas

- `status` does not run the gate. An honored receipt is evidence from an earlier `done` run on the current clean `HEAD`.
- Fleet rows belong to separate work. A clean sibling is occupied until its owner lands or discards it.
- Session hints are capped and recent. The full retained history remains available through `discern patterns`.
