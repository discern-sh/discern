---
title: The logbook
description: The local, metadata-only record of discern's verb starts and completions, including storage, config epochs, and readers.
order: 55
aliases:
  - logbook internals
  - usage history
  - config epoch
---

# The logbook

_With recording on and `discern.toml` readable, each CLI verb run and each Model Context Protocol (MCP) invocation resolved to that project appends local, metadata-only history. Effectful verbs record their start and completion._

Every other discern surface answers "what is true now". The logbook remembers how the tool has been driven ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). Every invocation appends a completion line, green or red. Effectful invocations also append a `begin` line with an invocation id shared by the completion. The completion carries the writing version, verb, surface, raw driver signals, branch, short commit, cleanliness (plus a diff checksum when dirty), a four-way outcome with the refusal slug and failed gate stage, duration, the verb's target and flag names, the change's scale, touched scopes, per-step timings with their dispositions, diagnostic classes with counts, delivered hint ids, shown tip ids, per-standard readings, and a config-epoch fingerprint. `partial` separates an error after an irreversible effect from a read-only `refused` event; acceptance also records its landing-state booleans. Driver signals can include possible coding-agent identity markers, separated by provenance, plus the MCP client's bounded declaration. They never state which agent drove the run ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md)). [The logbook reference](../70-reference/the-logbook.md) lists every field.

The recorder stores evidence and leaves interpretation to readers: raw signals rather than derived scores, so a future reader can re-score every line it finds. [`discern patterns`](../20-quality-gate/patterns.md) runs a detector registry over the stream and reports findings in plain counts. Its result stays strength-ranked for JSON and MCP. The human report filters that order into a 3-finding attention pointer, then groups it into the canonical family sections. Standard trajectories carry a bounded series for their row sparkline. `discern status` reads the same local stream for fleet activity. The substrate records, rotates, and stays out of the way.

The substrate's constraints:

- **Metadata only.** No code, no prompts, no command output. The bar: any line is safe to read aloud.
- **Local, forever.** An architectural test walks the subsystem's module graph and fails on any network API, so the trust claim is held by the gate rather than by intent.
- **Recording never interferes.** A write failure of any kind degrades to silence; the verb's own result and exit code are untouched.

## Agent identity over time

MCP events keep the bounded client declaration in `driver.mcp_client` and the writing release's catalogue-derived signal in `driver.agent_signals`.

[`agent_identity.ts`](../../../src/engine/logbook/agent_identity.ts) owns the classifier used by recorders and readers. The read-time view preserves non-MCP evidence, classifies raw MCP metadata through the current catalogue, and merges equivalent pairs. A current match replaces stored MCP signals derived from the same declaration. With no current match, stored MCP evidence remains. Independent sources that disagree leave attribution unresolved.

The view never rewrites JSON Lines. Adding an exact catalogue name improves new and historical events on the next `patterns` run. Unknown clients remain visible. A guard confines stored-signal reads to the schema, recorders, and this view.

## Finding routing

[`routing.ts`](../../../src/engine/logbook/routing.ts) is the single policy seam. Every detector finding reaches `patterns`. An inline detector also reaches one working command according to its scope: `branch` to `done`, `session` to `status`, and `project` to `improvement`. Batch detectors have no working route.

`tip-adoption` is a batch, project-scoped behavior detector. It derives measured tips and their invited verbs from [`TIPS`](../../../src/shared/tips.ts). Each recorded showing opens one episode for that tip. Any analyzable run of an invited verb can resolve it, including a run on another surface, branch, or session. A repeated showing resolves it as not followed. History ends and missing setup fields censor it. Config epoch, writer release, and the dominant MCP-client release must match by setup equality. Interleaved runs from another setup do not break later re-entry. Each tip clears 3 resolved episodes on its own, so adding more declarations cannot pool sparse evidence into a finding ([ADR 0236](../_adr/0236-tip-adoption-clears-evidence-per-tip-across-setups.md)).

[`surfaces.ts`](../../../src/engine/logbook/surfaces.ts) reads at most the newest 200 parsed events, runs only the registry members whose tier is `inline`, and formats each consumer's addition. `done` adds a hint only after a green qualifying proof. Its detector must have 1 more qualifying event than the normal registry threshold, and the formatter returns at most 1 line. `status` waits until `[meta].bootstrapped = true`, then carries up to 3 session hints for the current branch. CI runs and previews leave every detector population. Agent-practice behavior detectors also exclude interactive human runs. Tip adoption keeps them because the human's action is part of its subject. `improvement` receives ranked project findings through `buildContext`; its static rules do not read them.

The inline registry members record the policy at the source: `done-thrash`, `skipped-prepare`, and `dirty-done-churn` are branch-scoped; `refusal-loop` is session-scoped; `trunk-edits`, `docs-gap`, `recurring-diagnostic`, and `standard-trajectory` are project-scoped. Every other detector remains batch-only under `patterns`.

All working text enters through `hints[]`, except `improvement`'s distinct `data.history.findings` group. The outcome guard exercises a populated envelope and proves advisory attachment changes only `hints[]`. End-to-end tests separately hold `ok`, `failed_stage`, scores, and proof data constant while findings fire.

## Fleet activity

`status` reads the newest 200 parsed events. Per branch, `last_action` is the newest completion. The reader retains every unmatched fresh begin and exposes the newest one as `running` for the compact fleet row. Duration priors carry the recent median, P90, and sample count for each verb, preferring the current config epoch. Consumers can select their own view of the full in-flight set without changing the compact fleet row.

Running expires after the greater of 1 hour or 10 times its prior, or 24 hours without one. The begin remains crash evidence and contributes to `last_activity`, the later git timestamp or newest branch event ([ADR 0210](../_adr/0210-effectful-verb-starts-are-paired-logbook-events.md)). It remains advice. With the logbook off, action fields disappear and activity stays git-only.

## Storage and rotation

Events live in month-stamped JSON Lines files beside the worktree resource ledger:

```
<git-common-dir>/discern/logbook/
  2026-07.jsonl   one month of events, one line each
  epoch.json      per-branch config-epoch state
```

The common dir is shared by every linked worktree, so fleet activity converges into one logbook with no unification logic, and nothing under the git admin area lands in a commit or needs a gitignore entry. Events attribute by branch name rather than worktree path, so history survives `accept` removing the worktree.

Appends are one `write()` of one whole line to an `O_APPEND` handle — atomic in practice for lines this small, across concurrent worktrees. Readers classify before trusting: a torn line (a crashed append) or a foreign line (an unknown schema major or event kind) is skipped and counted. A crash after an effectful begin leaves that unmatched event as evidence; a crash before the begin append can still leave no line. Rotation keeps the newest 24 month files and prunes oldest-first when a new month begins. Rotation digests each removed month first (line totals, verb-event counts by outcome and by verb). The digests ride the `prune` event, so coarse long-horizon trends survive the raw lines' removal.

`patterns reset` renames the live `logbook/` directory to a unique sibling before removing the detached snapshot. A recorder that arrives during cleanup writes to a new canonical directory. It cannot repopulate the snapshot or make recursive deletion fail.

## Config epochs

Longitudinal comparison needs to know when the config genuinely changed — but `discern.toml` churns by design, because every standards pin rewrites a limit. The epoch fingerprint therefore hashes each top-level config section separately with volatile values masked: a standard's `limit` is masked out (its command, `inputs`, and measure mode are kept), and `[meta]` bookkeeping is masked whole. A pin moves nothing; a real edit flips its one section, and the recorder appends a `config-change` event naming it. The section list iterates the config schema itself, so a new section enrols without a hand-kept list. Epoch state is tracked per branch in `epoch.json` — parallel worktrees legitimately hold different configs, and a shared comparison would report a phantom change on every interleaving.

The limits the epoch masks land in the stream through their own door. A `standards --pin` reports its applied pins in the verb's envelope (`data.pinned`), and the recorder appends one `pin` event per tightened limit: standard name, old bound, new bound, measured value. The ratchet's trajectory reads straight back out of the logbook, as the decision record promised.

## The recording points

Each surface records at one point after it has a project. MCP dispatch opens the recorder only after resolving a project root, then `runTool` completes that known-root result after delivery-time hints are attached. This includes refusals returned before a verb handler runs. An explicit `path` outside every discern project returns `not_initialized` without recording. That path has no project logbook to host the event and no readable `discern.toml` setting to consent to it.

CLI uses `recordedExit`, the shared action wrapper, which owns `Deno.exit`, timing, and completion recording. Both surfaces open the recorder with the verb, driver evidence, and flags known at invocation. From the canonical verb vocabulary, the recorder classifies effectful calls, automatically appends their begin, and reuses its id at completion. A parity test enrolls every effectful top-level CLI verb. Result envelopes reach the recorder through the `emitResult` and gate seams; verbs without one (`identity`, `script`) still record a minimal completion.

The desk records its shown tip through a process-local accumulator because the interactive session has no result envelope. CLI completion drains that accumulator once into `tip_ids`; a desk invocation that showed no tip omits the field. The registry id is stored verbatim, giving the adoption reader its join key.

A crash (an unexpected throw no verb turned into a result) reaches the event through invocation-owned state. The CLI wrapper keeps the signature in its local run; MCP carries it beside the result in the pending tool call. Completion records the error class name plus one trimmed code location beside the `failed` outcome. Concurrent MCP calls therefore cannot exchange crash signatures. The message stays out of the logbook. The drain parity guard still derives the shared delivery mailboxes from `result_capture.ts`'s `take*` exports and requires both recording points to clear them ([ADR 0248](../_adr/0248-crashes-leave-a-report-and-a-distinct-exit-code.md)).

Each interceptor also contributes what only its surface can see. The CLI wrapper gathers the parent-process session hint, the `--json`/terminal/CI signals, and the flag names on the command line. Both interceptors ask the logbook-only identity detector for every matching process or host marker. The recorder keeps marker names and drops environment values. The MCP recording point also stamps a per-server-instance session id, captures the call's argument names, and retains bounded `clientInfo`. Request `_meta` takes priority, with the initialized client as fallback. The recorder and readers pass that declaration through the same catalogue classifier. Flag capture keeps names only, pattern-restricted, and skips the `script` namespace because its arguments belong to the child. A successful `docs` or `map` page payload carries its canonical target beside the content; the recorder lifts the target by payload shape and drops the content. The one-slot target seam remains the fallback for human-only reads and failed lookups. Gate fields, standard readings, pins, a start's `from`, an update's counts, and acceptance consent and landing state also lift from `data` by shape rather than by verb name. The landing fields reuse the public result schema's Zod shape. A renamed verb therefore keeps recording correctly.

Context (branch, commit, config, toggle) is gathered from invocation, so `accept` reads its branch before removing the worktree. Completion waits for the concurrent begin append to preserve pair order. Both paths absorb write failures. With unreadable config, nothing is recorded.

`discern doctor` watches the substrate's health: recording off draws an advisory nudge, and an enabled logbook with no events ever landed is a red check, because a write failure would otherwise stay silent by design. The doctor run itself records an event as it finishes, so on a healthy new install the re-run turns green.

## Where it lives in code

| Concept                         | File                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| Event schema + tolerant parser  | [`src/engine/logbook/schema.ts`](../../../src/engine/logbook/schema.ts)                           |
| Agent identity catalogue        | [`src/shared/agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts)                         |
| Desk tip registry               | [`src/shared/tips.ts`](../../../src/shared/tips.ts)                                               |
| MCP classifier + effective view | [`src/engine/logbook/agent_identity.ts`](../../../src/engine/logbook/agent_identity.ts)           |
| Advisory identity detector      | [`src/engine/logbook/agent_signals.ts`](../../../src/engine/logbook/agent_signals.ts)             |
| Config-epoch fingerprint        | [`src/engine/logbook/epoch.ts`](../../../src/engine/logbook/epoch.ts)                             |
| Append, rotation, epoch sidecar | [`src/engine/logbook/store.ts`](../../../src/engine/logbook/store.ts)                             |
| The recorder                    | [`src/engine/logbook/record.ts`](../../../src/engine/logbook/record.ts)                           |
| Verb vocabulary + effect class  | [`src/shared/verbs.ts`](../../../src/shared/verbs.ts)                                             |
| The CLI wrapper + verb registry | [`src/engine/logbook/cli.ts`](../../../src/engine/logbook/cli.ts)                                 |
| The stream reader               | [`src/engine/logbook/read.ts`](../../../src/engine/logbook/read.ts)                               |
| The detector registry           | [`src/engine/logbook/detectors.ts`](../../../src/engine/logbook/detectors.ts)                     |
| Finding routing                 | [`src/engine/logbook/routing.ts`](../../../src/engine/logbook/routing.ts)                         |
| Working-command collection      | [`src/engine/logbook/surfaces.ts`](../../../src/engine/logbook/surfaces.ts)                       |
| The `patterns` verb + reset     | [`src/engine/logbook/patterns.ts`](../../../src/engine/logbook/patterns.ts)                       |
| The observed-envelope seam      | [`src/shared/result_capture.ts`](../../../src/shared/result_capture.ts)                           |
| Crash capture + report files    | [`src/engine/crash.ts`](../../../src/engine/crash.ts)                                             |
| Mailbox drain parity guard      | [`tests/result_capture_drain_parity_test.ts`](../../../tests/result_capture_drain_parity_test.ts) |
| The no-network guard            | [`tests/logbook_no_network_test.ts`](../../../tests/logbook_no_network_test.ts)                   |
| Behaviour tests                 | [`tests/engine_logbook_test.ts`](../../../tests/engine_logbook_test.ts)                           |
| Routing and outcome guards      | [`tests/logbook_routing_test.ts`](../../../tests/logbook_routing_test.ts)                         |
| Working-command tests           | [`tests/engine_findings_surfaces_test.ts`](../../../tests/engine_findings_surfaces_test.ts)       |

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the user-facing contract: what is recorded, the switch, and the deletion path.
- [ADR 0160](../_adr/0160-local-logbook-advisory-readers.md) — the decision of record, including the advisory readers to come.
- [ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md) — why coding-agent identity remains source-labelled evidence and never steers the product.
