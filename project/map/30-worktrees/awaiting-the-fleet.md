---
title: Awaiting the fleet
description: Block until a sibling branch is green, its work lands, or the trunk moves — one call instead of guessed polling.
order: 60
aliases:
  - discern await
  - await a sibling
  - wait for a branch
  - fleet coordination
---

# Awaiting the fleet

_One bounded call answers "is the work I depend on ready?" — and says when to ask again if not._

A dependent task used to poll `discern status` on a guessed interval or wait for a human relay. `discern await` replaces the loop: it blocks until a fleet condition holds, then reports what it observed and the next step.

## The three conditions

Pass one condition per call:

| Condition           | Holds when                                                                           | Grounded in          |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------- |
| `--green <branch>`  | The branch's worktree holds an honored gate receipt (a watched landing also counts). | The gate receipt     |
| `--landed <branch>` | The branch's work — its tip at call start — is reachable from the trunk.             | Git ancestry         |
| `--trunk-moved`     | The trunk ref differs from its position at call start.                               | The trunk ref itself |

Every verdict comes from authoritative state: a git ancestry read or a receipt inspection. The logbook — one append per verb completion anywhere in the fleet — only wakes the wait early and prices the retry advice; recorded history never decides truth ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md), [ADR 0212](../_adr/0212-await-blocks-on-authoritative-fleet-conditions.md)).

`--landed` pins the tip sha when the call starts, because acceptance deletes a landed branch: the sha stays answerable after the ref is gone. A branch already missing at call start is a refusal that names both readings — not started yet, or landed and cleaned up.

Choose by question: `--green` watches work in flight; `--landed` asks whether it arrived. A call started after the landing answers immediately under `--landed`, while `--green` refuses to treat a freshly forked branch's trivially-reachable tip as proof of anything.

## Timing out is an answer

A wait that outlives its `--timeout` returns `ok: true` with `data.met: false`, the observed state, and `data.retry_after_seconds` — priced from the fleet's typical verb durations when the awaited branch has work in flight (a dependency one minute into a typical four-minute gate suggests a three-minute retry), a longer backoff when the fleet is quiet, and a labelled flat default when the logbook is off. Bounded calls compose into an arbitrarily long watch.

The CLI exits `0` when the condition was met, `1` on a refusal, and `124` on "not yet" — so this composes in a shell:

```sh
discern await --landed agent/upload-retry --timeout 100 && discern update
```

Defaults sit just under the calling surface's own tool-call budget with headroom: 100 seconds on the CLI, 45 seconds over MCP (`discern_await`), each re-derivable from the recorded per-client research ([ADR 0212](../_adr/0212-await-blocks-on-authoritative-fleet-conditions.md)). `--timeout 0` checks once and answers immediately.

## Compose below the trunk

The landing model's pull axis ([ADR 0110](../_adr/0110-the-landing-model.md)) makes `await` the coordination half of multi-wave delegation. A dependent brief reads: wait for the sibling to go green, then build on its unlanded branch —

```sh
discern await --green agent/upload-retry --timeout 100
discern update --from agent/upload-retry
```

— and when the condition fires, the result's hint names that exact follow-up: `update --from <branch>` after a green receipt, plain `discern update` after a landing or a trunk move. A met landing also previews what the update would bring in: how far behind this worktree sits and which of its own files the incoming work touched — the hot zone to re-read.

The wait itself is visible fleet activity: `await` is a begin-recorded verb, so while it holds, the blocked branch's fleet row in `discern status` reads `running: await`.

## Where it lives in code

| Responsibility                      | Source                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Conditions, wait loop, retry advice | [`src/engine/await/await.ts`](../../../src/engine/await/await.ts)       |
| Surface timeout defaults            | [`src/engine/await/defaults.ts`](../../../src/engine/await/defaults.ts) |
| Behavioural coverage                | [`tests/engine_await_test.ts`](../../../tests/engine_await_test.ts)     |

## Current state and gotchas

- `await` blocks only its own caller. It gates nothing, holds no locks, and keeps no state beyond its process.
- With `[project].logbook = false` every condition still works through the polling fallback; only the retry advice degrades, and the result says so.
- Raise `--timeout` past the defaults only when the calling agent's own tool-call budget allows it — the strictest MCP clients kill calls at 60 seconds with no configuration.
