---
title: The Logbook
description: The local, metadata-only record of discern's verb starts and completions, including storage, config epochs, and readers.
order: 55
aliases:
  - logbook internals
  - usage history
  - config epoch
---

# The Logbook

_A local activity record (the Logbook) stores metadata for each CLI verb run and each Model Context Protocol (MCP) invocation resolved to the project. Effectful verbs record their start and completion._

The Logbook records how discern has been used ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). Every invocation appends a completion line. Effectful invocations also append a `begin` line with an invocation id shared by the completion. The completion carries the writing version, verb, surface, raw driver signals, branch, short commit, invocation-start cleanliness and legacy diff checksum, outcome (`ok`, `failed`, `refused`, or `partial`) with the refusal slug and failed Gate stage, duration, the verb's target and flag names, the change's scale, touched scopes, per-step timings with their dispositions, diagnostic classes with counts, delivered hint ids, shown tip ids, per-standard readings, and a config-epoch fingerprint. Completed validation runs also carry versioned validation-start state and execution evidence. `partial` identifies an error after an irreversible effect, while `refused` identifies a read-only refusal. Acceptance also records its landing-state booleans. Checkpoint observations ride the same completions: servings (fired, reopened, advise), declarations with conclusion, revision flag, fingerprints, and elapsed time, variances, and abandoned episodes — never the unmet rationale. Driver signals can include possible coding-agent identity markers, separated by provenance, plus the MCP client's bounded declaration. These signals do not identify which agent drove the run ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md)). [The Logbook reference](../70-reference/the-logbook.md) lists every field.

The recorder preserves raw evidence. Readers derive their views from those signals, so a future reader can recompute its view from the stored lines. A practice report that finds recurring friction and trends (`discern patterns`) derives setup identity, client release, and completed Gate-job indexes once per stream, then runs the detector registry over those facts. The report states findings in plain counts. Its structured result stays strength-ranked for JSON and MCP. The terminal and Markdown presentations filter that order into a bounded attention pointer, then group it into the canonical family sections. Standard trajectories carry a bounded series for their row sparkline. `discern status` reads the same local stream to show activity across current tasks in flight (the fleet). The subsystem records and rotates events without changing the result of the command being observed.

The substrate's constraints:

- **Metadata only.** Lines contain no code, prompts, or command output.
- **Local.** The Logbook stays on the machine. An architectural test walks the subsystem's module graph and fails on any network API, so the Gate enforces this boundary.
- **Recording never interferes.** A write failure drops the event. The failure cannot change the verb's result or exit code.

## Report presentation

Schemas, readers, detectors, statistics, investigations, and lifecycle plans own Logbook facts. One terminal snapshot per human invocation builds output. Presentation observes nothing and maps results to result-summary, stat, meter, procedure, Proof, file-change, command, and section Components. JSON and MCP match.

Patterns retains order, families, its advisory boundary, evidence, actions, quiet-detector account, and falsifiers. Statistics retain exact counts and provenance. Archive and reset retain exact file, byte, and destination facts. Confirmation stays on the shared default-No interaction boundary.

At 39, 80, 104, and wider widths in every mode, safe text shows controls. Components add no payload, prompt, output, or network access; the metadata-only, offline contract remains unchanged.

## Validation evidence

`done` samples after fix/build and before check/test; standalone `test` samples before its test group. A shared registry selects planned jobs by stage, automatically enrolling future jobs.

The state HMAC covers HEAD; index tag/mode/object/stage/path; matching checkout bytes; untracked files Git does not ignore; and recursively clean submodule commits. It ignores index storage while retaining sparse/assume-unchanged state. Uncertain or over-budget state is incomplete. Git probes share the 20,000-path, 64-MiB, 5-second envelope.

The regular `0600` key at `discern/validation-hmac-key` is checked on every use. Events store opaque digests and bounded, keyed execution metadata/outcomes, mode, concurrency, and writer version. The execution ceiling is 1,000 jobs and 1 MiB before serialization. Capture failure leaves the Gate verdict unchanged.

Patterns compares only complete state and execution envelopes of the same evidence version. Legacy identity is a separate group. Ignored files, external services, clocks, random seeds, runtime environment, and concurrent external processes remain disclosed exclusions ([ADR 0273](../_adr/0273-validation-comparisons-require-complete-keyed-semantic-evidence.md)).

## Agent identity over time

MCP events keep the bounded client declaration in `driver.mcp_client` and the writing release's catalog-derived signal in `driver.agent_signals`.

[`agent_identity.ts`](../../../src/engine/logbook/agent_identity.ts) owns the classifier used by recorders and readers. The read-time view preserves non-MCP evidence, classifies raw MCP metadata through the current catalog, and merges equivalent pairs. A current match replaces stored MCP signals derived from the same declaration. With no current match, stored MCP evidence remains. Independent sources that disagree leave attribution unresolved.

The view never rewrites JSON Lines. Adding an exact catalog name improves new and historical events on the next `patterns` run. Unknown clients remain visible. A guard confines stored-signal reads to the schema, recorders, and this view.

## Finding routing

[`routing.ts`](../../../src/engine/logbook/routing.ts) is the single policy seam. Every detector finding reaches `patterns`. An inline detector also reaches one working command according to its scope: `branch` to `done`, `session` to `status`, and `project` to `improvement`. Batch detectors have no working route.

`tip-adoption` is a batch, project-scoped behavior detector. It derives measured tips and their invited verbs from [`TIPS`](../../../src/shared/tips.ts). Each recorded showing opens one episode for that tip. Any analyzable run of an invited verb can resolve it, including a run on another surface, branch, or session. A repeated showing resolves it as not followed. History ends and missing setup fields censor it. Config epoch, writer release, and the dominant MCP-client release must match by setup equality. Interleaved runs from another setup do not break later re-entry. Each tip clears 3 resolved episodes on its own, so adding more declarations cannot pool sparse evidence into a finding ([ADR 0236](../_adr/0236-tip-adoption-clears-evidence-per-tip-across-setups.md)).

[`surfaces.ts`](../../../src/engine/logbook/surfaces.ts) reads at most the newest 200 parsed events, runs only the registry members whose tier is `inline`, and formats each consumer's addition. `done` adds a hint only after a green qualifying Proof. Its detector must have 1 more qualifying event than the normal registry threshold, and the formatter returns at most 1 line. `status` waits until `[meta].bootstrapped = true`, then carries up to 3 session hints for the current branch. Detector populations exclude CI runs and previews. Agent-practice behavior detectors also exclude interactive human runs. Tip adoption includes them because the human's action is part of its subject. `improvement` receives ranked project findings through `buildContext`; its static rules do not read them.

The inline registry members record the policy at the source: `done-thrash`, `skipped-prepare`, and `dirty-done-churn` are branch-scoped; `refusal-loop` is session-scoped; `trunk-edits`, `docs-gap`, `recurring-diagnostic`, and `standard-trajectory` are project-scoped. Every other detector remains batch-only under `patterns`.

All working text enters through `hints[]`, except `improvement`'s distinct `data.history.findings` group. The outcome guard exercises a populated envelope and proves advisory attachment changes only `hints[]`. End-to-end tests separately hold `ok`, `failed_stage`, scores, and Proof data constant while findings fire.

## Fleet activity

`status` reads the newest 200 parsed events. Per branch, `last_action` is the newest completion. The reader retains every unmatched fresh begin and exposes the newest one as `running` for the compact fleet row. Duration priors carry the recent median, P90, and sample count for each verb, preferring the current config epoch. Consumers can select their own view of the full in-flight set without changing the compact fleet row.

Running expires after the greater of 1 hour or 10 times its prior, or 24 hours without one. The begin remains crash evidence and contributes to `last_activity`, the later Git timestamp or newest branch event ([ADR 0210](../_adr/0210-effectful-verb-starts-are-paired-logbook-events.md)). The `running` field remains advisory. With the Logbook off, action fields disappear and activity stays Git-only.

## Storage and rotation

Events live in month-stamped JSON Lines files beside the worktree resource ledger:

```
<git-common-dir>/discern/logbook/
  2026-07.jsonl   one month of events, one line each
  epoch.json      per-branch config-epoch state

<git-common-dir>/discern/logbook-archives/
  logbook-20260811T143015Z.jsonl   sealed event history
```

Every linked worktree shares the common directory, so fleet activity converges into one Logbook with no unification logic. Nothing under the Git admin area lands in a commit or needs a gitignore entry. Events attribute by branch name rather than worktree path, so history survives `accept` removing the worktree.

Each append makes 1 `write()` of 1 whole line to an `O_APPEND` handle. For lines of this size, that write is atomic in practice across concurrent worktrees. Readers classify a line before using it. They skip and count a torn line from a crashed append or a foreign line with an unknown schema major or event kind. A crash after an effectful begin leaves that unmatched event as evidence. A crash before the begin append can still leave no line. Rotation keeps the newest 24 month files and prunes oldest-first when a new month begins. Rotation digests each removed month first, including line totals and verb-event counts by outcome and verb. The `prune` event carries the digests, so coarse long-horizon trends survive removal of the raw lines.

`patterns reset` and `patterns archive` share a repository-common advisory lock. Before confirmation they inspect the active stream for a fresh unmatched begin from another invocation and refuse when one remains. After confirmation they verify that the reviewed source bytes have not changed. The recorder does not acquire this lock: recording remains fail-open, and a racing append lands wholly on one side of the atomic directory detachment.

Reset renames the live `logbook/` directory into the registered recovery area before removing that detached snapshot. A recorder that arrives during cleanup writes to a new canonical directory. It cannot repopulate the snapshot or make recursive deletion fail. Reset never targets `logbook-archives/` or another registered Git-admin sibling.

Archive uses the same detachment, then streams each month shard's raw bytes in name order into a synced temporary file. It omits `epoch.json`, active per-branch recorder state. Publication uses an atomic no-clobber link in `logbook-archives/`; only after that durable name exists does the executor remove the detached source. A sealing failure leaves the detached source in `logbook-recovery/`. UTC-second filenames gain a numeric suffix on collision.

The full historical reader accepts a regular archive basename resolved inside `logbook-archives/`. It reuses the tolerant line parser, so torn and foreign lines keep the same accounting. `data.logbook.source` distinguishes active and archive reads. Operational readers retain their active-only entrypoints.

## Config epochs

Longitudinal comparison needs to identify config changes that affect behavior. Every Standard pin rewrites a limit in `discern.toml`, so the epoch fingerprint hashes each top-level config section separately with volatile values masked. It masks a Standard's `limit` while retaining its command, `inputs`, and measure mode, and masks `[meta]` bookkeeping as a whole. A pin does not move the epoch. A behavioral edit changes its section, and the recorder appends a `config-change` event naming it. The section list iterates the config schema itself, so a new section enrolls without a hand-kept list. `epoch.json` tracks epoch state per branch. Parallel worktrees can hold different configs, and a shared comparison would report a phantom change on every interleaving.

The Logbook records masked limits separately. Standard readings lift the configured margin and the Gate's mechanical `pin_eligible` decision, plus `pin_target` when eligible, alongside measurement source, value, limit, direction, and verdict. Patterns reads those fields without reconstructing Gate arithmetic. A `standards --pin` reports its applied pins in the verb's envelope (`data.pinned`), and the recorder appends one `pin` event per tightened limit: Standard name, old bound, new bound, and measured value. The Standard trajectory reads these values from the Logbook ([ADR 0276](../_adr/0276-patterns-recommendations-require-project-local-decision-evidence.md)).

## The recording points

Each surface has 1 recording point after it resolves a project. MCP dispatch opens the recorder only after resolving a project root, then `runTool` completes that known-root result after delivery-time hints are attached. This includes refusals returned before a verb handler runs. An explicit `path` outside every discern project returns `not_initialized` without recording. That path has no project Logbook to host the event and no readable `discern.toml` setting to consent to it.

CLI uses `recordedExit`, the shared action wrapper, which owns `Deno.exit`, timing, and completion recording. Both surfaces open the recorder with the verb, driver evidence, and flags known at invocation. From the canonical verb vocabulary, the recorder classifies effectful calls, automatically appends their begin, and reuses its id at completion. A parity test enrolls every effectful top-level CLI verb. Result envelopes reach the recorder through the `emitResult` and gate seams; verbs without one (`identity`, `script`) still record a minimal completion.

The Logbook lifecycle registry defines an exception. `patterns reset` and `patterns archive` record neither a begin nor a completion, because either event could be detached from its pair or recreate the active store after the action. The same registry drives dispatch, this recording exclusion, and the terminal-only safety tests. A future action that can detach active history therefore inherits its confirmation policy and no-split recording boundary.

The desk records its shown tip through a process-local accumulator because the interactive session has no result envelope. CLI completion drains that accumulator once into `tip_ids`; a desk invocation that showed no tip omits the field. The registry id is stored verbatim, giving the adoption reader its join key.

The checkpoint machinery records the same way: the gate pre-flight and the acceptance transition observe each lifecycle fact into a process-local accumulator, both recording points drain it into the event's `checkpoints` block (the drain-parity guard holds them to it), and the recorder's fallback take stops leaks. An import-graph guard keeps the flow one-directional: no checkpoint decision module may reach the Logbook, so observed history informs the owner and never a refusal.

A crash (an unexpected throw no verb turned into a result) reaches the event through invocation-owned state. The CLI wrapper keeps the signature in its local run; MCP carries it beside the result in the pending tool call. Completion records the error class name plus one trimmed code location beside the `failed` outcome. Concurrent MCP calls therefore cannot exchange crash signatures. The message stays out of the logbook. The drain parity guard still derives the shared delivery mailboxes from `result_capture.ts`'s `take*` exports and requires both recording points to clear them ([ADR 0248](../_adr/0248-crashes-leave-a-report-and-a-distinct-exit-code.md)).

Each interceptor also contributes what only its surface can see. The CLI wrapper gathers the parent-process session hint, the `--json`/`--markdown`, terminal, and CI signals, and the flag names on the command line. Both interceptors ask the Logbook-only identity detector for every matching process or host marker. The recorder keeps marker names and drops environment values. The MCP recording point also stamps a per-server-instance session id, captures the call's argument names, and retains bounded `clientInfo`. Request `_meta` takes priority, with the initialized client as fallback. The recorder and readers pass that declaration through the same catalog classifier. Flag capture keeps names only, pattern-restricted, and skips the `script` namespace because its arguments belong to the child. A successful `docs` or `map` page payload carries its canonical target beside the content; the recorder lifts the target by payload shape and drops the content. The one-slot target seam remains the fallback for human-only reads and failed lookups. Gate fields, Standard readings, pins, a start's `from`, an update's counts, and acceptance consent and landing state also lift from `data` by shape rather than by verb name. The landing fields reuse the public result schema's Zod shape. A renamed verb therefore keeps recording correctly.

Context (branch, commit, config, toggle) is gathered from invocation, so `accept` reads its branch before removing the worktree. Completion waits for the concurrent begin append to preserve pair order. Both paths absorb write failures. With unreadable config, nothing is recorded.

`discern doctor` reports Logbook health. Recording off produces an advisory nudge. An enabled Logbook with no landed events produces a red check because a write failure otherwise leaves the command result unchanged. The doctor run records an event as it finishes, so rerun `discern doctor` on a healthy new install to turn the check green.

## Where it lives in code

| Concept                          | File                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Event schema + tolerant parser   | [`src/engine/logbook/schema.ts`](../../../src/engine/logbook/schema.ts)                                   |
| Agent identity catalog           | [`src/shared/agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts)                                 |
| Desk tip registry                | [`src/shared/tips.ts`](../../../src/shared/tips.ts)                                                       |
| MCP classifier + effective view  | [`src/engine/logbook/agent_identity.ts`](../../../src/engine/logbook/agent_identity.ts)                   |
| Advisory identity detector       | [`src/engine/logbook/agent_signals.ts`](../../../src/engine/logbook/agent_signals.ts)                     |
| Config-epoch fingerprint         | [`src/engine/logbook/epoch.ts`](../../../src/engine/logbook/epoch.ts)                                     |
| Validation model and outcomes    | [`src/engine/logbook/validation.ts`](../../../src/engine/logbook/validation.ts)                           |
| Repository validation key        | [`src/engine/logbook/validation_key.ts`](../../../src/engine/logbook/validation_key.ts)                   |
| Bounded validation-state capture | [`src/engine/logbook/validation_state.ts`](../../../src/engine/logbook/validation_state.ts)               |
| Append, rotation, epoch sidecar  | [`src/engine/logbook/store.ts`](../../../src/engine/logbook/store.ts)                                     |
| The recorder                     | [`src/engine/logbook/record.ts`](../../../src/engine/logbook/record.ts)                                   |
| Verb vocabulary + effect class   | [`src/shared/verbs.ts`](../../../src/shared/verbs.ts)                                                     |
| The CLI wrapper + verb registry  | [`src/engine/logbook/cli.ts`](../../../src/engine/logbook/cli.ts)                                         |
| The stream reader                | [`src/engine/logbook/read.ts`](../../../src/engine/logbook/read.ts)                                       |
| The detector registry            | [`src/engine/logbook/detectors.ts`](../../../src/engine/logbook/detectors.ts)                             |
| Checkpoint economics reader      | [`src/engine/logbook/checkpoint_economics.ts`](../../../src/engine/logbook/checkpoint_economics.ts)       |
| Finding routing                  | [`src/engine/logbook/routing.ts`](../../../src/engine/logbook/routing.ts)                                 |
| Working-command collection       | [`src/engine/logbook/surfaces.ts`](../../../src/engine/logbook/surfaces.ts)                               |
| The `patterns` verb + reset      | [`src/engine/logbook/patterns.ts`](../../../src/engine/logbook/patterns.ts)                               |
| The observed-envelope seam       | [`src/shared/result_capture.ts`](../../../src/shared/result_capture.ts)                                   |
| Crash capture + report files     | [`src/engine/crash.ts`](../../../src/engine/crash.ts)                                                     |
| Mailbox drain parity guard       | [`tests/result_capture_drain_parity_test.ts`](../../../tests/result_capture_drain_parity_test.ts)         |
| The no-network guard             | [`tests/logbook_no_network_test.ts`](../../../tests/logbook_no_network_test.ts)                           |
| Observation-boundary guard       | [`tests/checkpoint_observation_boundary_test.ts`](../../../tests/checkpoint_observation_boundary_test.ts) |
| Report parity and safety matrix  | [`tests/engine_patterns_test.ts`](../../../tests/engine_patterns_test.ts)                                 |
| Terminal-observation guard       | [`tests/terminal_boundary_guard_test.ts`](../../../tests/terminal_boundary_guard_test.ts)                 |
| Behavior tests                   | [`tests/engine_logbook_test.ts`](../../../tests/engine_logbook_test.ts)                                   |
| Routing and outcome guards       | [`tests/logbook_routing_test.ts`](../../../tests/logbook_routing_test.ts)                                 |
| Working-command tests            | [`tests/engine_findings_surfaces_test.ts`](../../../tests/engine_findings_surfaces_test.ts)               |

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the user-facing contract: what the Logbook records, the switch, and the deletion path.
- [ADR 0160](../_adr/0160-local-logbook-advisory-readers.md) — the decision of record, including the advisory readers to come.
- [ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md) — why coding-agent identity remains source-labeled evidence and never steers the product.
