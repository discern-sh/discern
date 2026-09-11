---
title: Progress & reconnect
description: How long operations report progress while they run, the producer progress protocol, and the handle that reads an operation back after a lost call.
order: 135
aliases:
  - progress
  - reconnect
  - operation handle
  - DISCERN_PROGRESS
  - progress handle
---

# Progress & reconnect

_A long `done`, `test`, `standards`, `accept`, or MCP `await` reports what it is doing while it runs, and records the same facts behind a short handle so a lost call can be read back afterwards._

## One set of facts, every surface

Progress is a stream of typed facts ([`src/engine/completion/events.ts`](../../../src/engine/completion/events.ts)): the current phase, a composed sentence, producer-reported counts, an owner-must-act flag, and one fact per failure the moment it is established. The sentences are composed once ([`progress_prose.ts`](../../../src/engine/completion/progress_prose.ts)) and read identically on a live terminal frame, in static human output, in Model Context Protocol (MCP) `notifications/progress` messages, and in the recorded journal — no surface derives its own account, completion fraction, or time estimate. Unequal units cannot compose into one completion fraction, and an unknown total stays unknown in the words themselves.

A terminal shows counts as a transient status line and pins failures and waits above the live tail. Every fact has exactly one presenter ([`progress_presenter.ts`](../../../src/engine/gate/progress_presenter.ts)): a producer's own counts and failures belong to the run executing that producer, and queue, environment, pending, and operation facts belong to the outermost operation — so when `accept` validates an effort, the acceptance narrates the coordination, its nested validation narrates the producers, and no sentence prints twice. A `--json` or `--markdown` run stays quiet because the result envelope is its entire output; the same facts still reach the journal and any MCP progress token.

## The producer progress protocol

A producer command may report its own progress by printing lines to stdout or stderr:

```text
DISCERN_PROGRESS {"units":{"kind":"partitions","completed":3,"total":8},"results":{"passed":120,"failed":1,"skipped":2},"elapsed_ms":45210}
DISCERN_PROGRESS {"failure":{"name":"alpha holds","message":"expected 2, got 3","file":"tests/alpha_test.ts","line":42,"reproduce":"deno task test tests/alpha_test.ts --filter 'alpha holds' --shuffle=7"}}
```

One JSON object per line; every field is optional. `units` carries completed work and a total, where `null` (or an omitted total) is a valid unknown total. `results` carries only the counts the producer established — an absent count stays unknown, and an empty `results` object means the same as none. `active` lists currently running work labels, `elapsed_ms` is the producer's own elapsed time, and `partial: true` marks counts that cover only part of the completed units; once a producer reports partial counts they stay marked partial. A `failure` names the failing test or obligation, its message and location, and a focused reproduction carrying the recorded seed and instrumentation. The parser ignores unknown keys, and it ignores whole any line that does not validate completely, so a malformed report can never present as a smaller true one.

[`progress_lines.ts`](../../../src/engine/validation/progress_lines.ts) is the shared formatter and parser; [`scripts/test_partitions.ts`](../../../scripts/test_partitions.ts) is this repository's producer example, deriving its reports from each settled partition's native test report without touching membership, seeded order, admission, or coverage. It reports only where the runner partitions the suite — on macOS with `DENO_JOBS` unset — and stays silent on the single-child path, where the gate still shows phase-level progress. The protocol is stack-neutral: any project's runner in any language can print the same lines.

## Handles and the operation journal

Every one of these operations announces a [progress handle](../00-orientation/glossary.md#progress-handle) (`R1-XXXX-XXXX-XX`, checksum-protected like `await`'s `C1` continuations) as its first progress fact, together with the command that reads it back. The journal lives under the common Git directory (`discern/operations/`) and records the operation's verb, checkout, branch, and process; the latest progress fact; the merged per-producer counts; each established failure; named timing intervals; and the final result envelope, bounded and marked `result_truncated` when reduced. A record is kept for up to 7 days in a bounded store shared by every worktree of the repository. When the store is full, finished `await` records leave first — a wait's resume continuation already survives a lost call — then the oldest finished operations; a running operation is kept while anything finished can go.

After a disconnect — a closed terminal, a timed-out MCP call, a killed process — one call shows the same operation:

```
discern progress <handle>
```

With no handle, `discern progress` reads the most recently started operation. The result leads with the operation named by its branch and what happened to it, then the recorded facts, then the retained result when one exists — nothing re-runs to recover output. Full producer output stays with the run's own artifacts: job transcripts under the 24-hour temp retention ([temp files & retention](temp-files-and-retention.md)) and durable attempt artifacts under `discern/completion/artifacts/`.

The journal is advisory presentation state. It carries no validation or landing authority, reading it starts and repairs nothing, and a store failure runs the operation without one. Only the executor finishing or being cancelled closes a record, and a reader distinguishes a finished operation from a recorded executor process that is gone — the latter reads as stopped without finishing, and discern invents no verdict for it. The liveness probe delivers no signal, so reading a stopped process leaves it stopped. It is a process check, not an identity check: "still running" means a process with the recorded id exists, which after a reboot or a long interval can be a different process that reused the id, so treat it as a strong indication rather than proof. A process the reader is not allowed to signal still counts as present, and when the check itself cannot run the reading says so instead of guessing.

Observers divide by what they hold. A read-only observer — a reconnect read, an `await` watch, a second session following the run — can stop, time out, or die without touching execution; the [journey guard](../../../tests/engine_progress_journey_test.ts) holds that boundary. The MCP call that is itself executing a verb is not a separate observer: by the established transport contract, its explicit cancellation, or its transport closing, cancels the executor, and the journal records the run as cancelled with its facts retained for reconnect.

## Named timing boundaries

A producer's own elapsed time, a producer budget (`[gate].timeout` or a per-entry `timeout`, always named with its config key when it fires), an environment return interval, and the command's own wall span are separate recorded facts. No surface infers one from another, and the layer that owns a deadline diagnoses its timeout.
