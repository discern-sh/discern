---
title: The logbook
description: The local, metadata-only record of discern's own verb runs — schema, storage, config epochs, and the recording points.
order: 55
aliases:
  - logbook internals
  - usage history
  - config epoch
---

# The logbook

_Every verb run appends one local, metadata-only event under the git common dir; this page covers the substrate that records it._

Every other discern surface answers "what is true now". The logbook remembers how the tool has been driven ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). Each verb invocation through the command line or Model Context Protocol (MCP), green or red, appends one JSON line. It carries the writing version, verb, surface, raw driver signals, branch, short commit, cleanliness (plus a diff checksum when dirty), a three-way outcome with the refusal slug and failed gate stage, duration, the verb's target and flag names, the change's scale, touched scopes, per-step timings with their dispositions, diagnostic classes with counts, per-standard readings, and a config-epoch fingerprint. Driver signals can include possible coding-agent identity markers, separated by provenance, plus the MCP client's bounded declaration. They never state which agent drove the run ([ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md)). [The logbook reference](../70-reference/the-logbook.md) lists every field. The recorder stores evidence and leaves interpretation to readers: raw signals rather than derived scores, so a future reader can re-score every line it finds. The first reader is [`discern patterns`](../20-quality-gate/patterns.md), which runs a detector registry over the stream and reports findings in plain counts; the substrate itself records, rotates, and stays out of the way.

The substrate's constraints:

- **Metadata only.** No code, no prompts, no command output. The bar: any line is safe to read aloud.
- **Local, forever.** An architectural test walks the subsystem's module graph and fails on any network API, so the trust claim is held by the gate rather than by intent.
- **Recording never interferes.** A write failure of any kind degrades to silence; the verb's own result and exit code are untouched.

## Finding routing

[`routing.ts`](../../../src/engine/logbook/routing.ts) is the single policy seam. Every detector finding reaches `patterns`. An inline detector also reaches one working command according to its scope: `branch` to `done`, `session` to `status`, and `project` to `improvement`. Batch detectors have no working route.

[`surfaces.ts`](../../../src/engine/logbook/surfaces.ts) reads at most the newest 200 parsed events, runs only the registry members whose tier is `inline`, and formats each consumer's addition. `done` adds a hint only after a green qualifying receipt. Its detector must have 1 more qualifying event than the normal registry threshold, and the formatter returns at most 1 line. `status` waits until `[meta].bootstrapped = true`, then carries up to 3 session hints for the current branch. Driver scoring excludes CI, previews, and interactive human runs before behavior detectors see the stream. `improvement` receives ranked project findings through `buildContext`; its static rules do not read them.

The inline registry members record the policy at the source: `done-thrash`, `skipped-prepare`, and `dirty-done-churn` are branch-scoped; `refusal-loop` is session-scoped; `trunk-edits`, `docs-gap`, `recurring-diagnostic`, and `standard-trajectory` are project-scoped. Every other detector remains batch-only under `patterns`.

All working text enters through `hints[]`, except `improvement`'s distinct `data.history.findings` group. The outcome guard exercises a populated envelope and proves advisory attachment changes only `hints[]`. End-to-end tests separately hold `ok`, `failed_stage`, scores, and receipt data constant while findings fire.

## Storage and rotation

Events live in month-stamped JSON Lines files beside the worktree resource ledger:

```
<git-common-dir>/discern/logbook/
  2026-07.jsonl   one month of events, one line each
  epoch.json      per-branch config-epoch state
```

The common dir is shared by every linked worktree, so fleet activity converges into one logbook with no unification logic, and nothing under the git admin area lands in a commit or needs a gitignore entry. Events attribute by branch name rather than worktree path, so history survives `accept` removing the worktree.

Appends are one `write()` of one whole line to an `O_APPEND` handle — atomic in practice for lines this small, across concurrent worktrees. Readers classify before trusting: a torn line (a crashed append) or a foreign line (an unknown schema major) is skipped and counted. A hard crash between verb completion and the append loses that run's single event, which v1 accepts. Rotation keeps the newest 24 month files and prunes oldest-first when a new month begins. Rotation digests each removed month first (line totals, verb-event counts by outcome and by verb). The digests ride the `prune` event, so coarse long-horizon trends survive the raw lines' removal.

## Config epochs

Longitudinal comparison needs to know when the config genuinely changed — but `discern.toml` churns by design, because every standards pin rewrites a limit. The epoch fingerprint therefore hashes each top-level config section separately with volatile values masked: a standard's `limit` is masked out (its command, `inputs`, and measure mode are kept), and `[meta]` bookkeeping is masked whole. A pin moves nothing; a real edit flips its one section, and the recorder appends a `config-change` event naming it. The section list iterates the config schema itself, so a new section enrols without a hand-kept list. Epoch state is tracked per branch in `epoch.json` — parallel worktrees legitimately hold different configs, and a shared comparison would report a phantom change on every interleaving.

The limits the epoch masks land in the stream through their own door. A `standards --pin` reports its applied pins in the verb's envelope (`data.pinned`), and the recorder appends one `pin` event per tightened limit: standard name, old bound, new bound, measured value. The ratchet's trajectory reads straight back out of the logbook, as the decision record promised.

## The recording points

Each surface records at one point. MCP: `runVerb`, the single place every tool call already flows through. CLI: `recordedExit`, the shared action wrapper — every Cliffy action returns its exit code and the wrapper owns the `Deno.exit`, times the run, and records on completion. The wrapper registers each verb it wraps, and a parity test reconciles that registry against `KNOWN_VERBS`, so a future verb that skips it fails the gate. Result envelopes reach the recorder through a one-slot seam fed by `emitResult` and the gate entry points. A verb with no envelope (`identity`, `script`) still records a minimal event, because a uniform stream is what verb-sequence readers need.

Each interceptor also contributes what only its surface can see. The CLI wrapper gathers the parent-process session hint, the `--json`/terminal/CI signals, and the flag names on the command line. Both interceptors ask the logbook-only identity detector for every matching process or host marker. The recorder keeps marker names and drops environment values. The MCP recording point also stamps a per-server-instance session id, captures the call's argument names, and retains bounded `clientInfo`. Request `_meta` takes priority, with the initialized client as fallback. The detector maps known MCP names separately. The raw declaration therefore remains available when client-name mappings improve later. Flag capture keeps names only, pattern-restricted, and skips the `script` namespace because its arguments belong to the child. `help` and `map` report the topic or page they served through a one-slot target seam beside the envelope's. Everything else (gate fields, standard readings, pins, a start's `from`, an update's counts) lifts from the envelope's `data` by shape rather than by verb name. A renamed verb therefore keeps recording correctly.

Context (branch, commit, config, toggle) is gathered concurrently with the verb itself, starting at invocation — which is also why `accept` still attributes correctly: the branch is read while the worktree exists. The toggle is `[project].logbook`; when the config is unreadable, the recorder writes nothing.

`discern doctor` watches the substrate's health: recording off draws an advisory nudge, and an enabled logbook with no events ever landed is a red check, because a write failure would otherwise stay silent by design. The doctor run itself records an event as it finishes, so on a healthy new install the re-run turns green.

## Where it lives in code

| Concept                         | File                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| Event schema + tolerant parser  | [`src/engine/logbook/schema.ts`](../../../src/engine/logbook/schema.ts)                     |
| Agent identity catalogue        | [`src/shared/agent_catalogue.ts`](../../../src/shared/agent_catalogue.ts)                   |
| Advisory identity detector      | [`src/engine/logbook/agent_signals.ts`](../../../src/engine/logbook/agent_signals.ts)       |
| Config-epoch fingerprint        | [`src/engine/logbook/epoch.ts`](../../../src/engine/logbook/epoch.ts)                       |
| Append, rotation, epoch sidecar | [`src/engine/logbook/store.ts`](../../../src/engine/logbook/store.ts)                       |
| The recorder                    | [`src/engine/logbook/record.ts`](../../../src/engine/logbook/record.ts)                     |
| The CLI wrapper + verb registry | [`src/engine/logbook/cli.ts`](../../../src/engine/logbook/cli.ts)                           |
| The stream reader               | [`src/engine/logbook/read.ts`](../../../src/engine/logbook/read.ts)                         |
| The detector registry           | [`src/engine/logbook/detectors.ts`](../../../src/engine/logbook/detectors.ts)               |
| Finding routing                 | [`src/engine/logbook/routing.ts`](../../../src/engine/logbook/routing.ts)                   |
| Working-command collection      | [`src/engine/logbook/surfaces.ts`](../../../src/engine/logbook/surfaces.ts)                 |
| The `patterns` verb + reset     | [`src/engine/logbook/patterns.ts`](../../../src/engine/logbook/patterns.ts)                 |
| The observed-envelope seam      | [`src/shared/result_capture.ts`](../../../src/shared/result_capture.ts)                     |
| The no-network guard            | [`tests/logbook_no_network_test.ts`](../../../tests/logbook_no_network_test.ts)             |
| Behaviour tests                 | [`tests/engine_logbook_test.ts`](../../../tests/engine_logbook_test.ts)                     |
| Routing and outcome guards      | [`tests/logbook_routing_test.ts`](../../../tests/logbook_routing_test.ts)                   |
| Working-command tests           | [`tests/engine_findings_surfaces_test.ts`](../../../tests/engine_findings_surfaces_test.ts) |

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the user-facing contract: what is recorded, the switch, and the deletion path.
- [ADR 0160](../_adr/0160-local-logbook-advisory-readers.md) — the decision of record, including the advisory readers to come.
- [ADR 0166](../_adr/0166-agent-identity-is-advisory-logbook-evidence.md) — why coding-agent identity remains source-labelled evidence and never steers the product.
