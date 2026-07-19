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

Every other discern surface answers "what is true now"; the logbook remembers how the tool has been driven ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)). Each verb invocation (CLI or MCP, green or red) appends one JSON line: verb, surface, branch, short commit, tree cleanliness, outcome, wall-clock duration, the per-step timings the gate already measured, diagnostic classes (tool, rule id, file path at most), and a config-epoch fingerprint. No reader ships in this wave; the substrate records, rotates, and stays out of the way.

The substrate's constraints:

- **Metadata, never payloads.** No code, no prompts, no command output. The bar: any line is safe to read aloud.
- **Local, forever.** An architectural test walks the subsystem's module graph and fails on any network API, so the trust claim is held by the gate rather than by intent.
- **Recording never interferes.** A write failure of any kind degrades to silence; the verb's own result and exit code are untouched.

## Storage and rotation

Events live in month-stamped JSON Lines files beside the worktree resource ledger:

```
<git-common-dir>/discern/logbook/
  2026-07.jsonl   one month of events, one line each
  epoch.json      per-branch config-epoch state
```

The common dir is shared by every linked worktree, so fleet activity converges into one logbook with no unification logic, and nothing under the git admin area lands in a commit or needs a gitignore entry. Events attribute by branch name rather than worktree path, so history survives `accept` removing the worktree.

Appends are one `write()` of one whole line to an `O_APPEND` handle — atomic in practice for lines this small, across concurrent worktrees. Readers classify before trusting: a torn line (a crashed append) or a foreign line (an unknown schema major) is skipped and counted. A hard crash between verb completion and the append loses that run's single event; v1 accepts this. Rotation keeps the newest 12 month files, prunes oldest-first when a new month begins, and records the removals as a `prune` event.

## Config epochs

Longitudinal comparison needs to know when the config genuinely changed — but `discern.toml` churns by design, because every standards pin rewrites a limit. The epoch fingerprint therefore hashes each top-level config section separately with volatile values masked: a standard's `limit` is masked out (its command, `inputs`, and measure mode are kept), and `[meta]` bookkeeping is masked whole. A pin moves nothing; a real edit flips its one section, and the recorder appends a `config-change` event naming it. The section list iterates the config schema itself, so a new section enrols without a hand-kept list. Epoch state is tracked per branch in `epoch.json` — parallel worktrees legitimately hold different configs, and a shared comparison would report a phantom change on every interleaving.

## The recording points

Each surface records at one point. MCP: `runVerb`, the single place every tool call already flows through. CLI: `recordedExit`, the shared action wrapper — every Cliffy action returns its exit code and the wrapper owns the `Deno.exit`, times the run, and records on completion. The wrapper registers each verb it wraps, and a parity test reconciles that registry against `KNOWN_VERBS`, so a future verb that skips it fails the gate. Result envelopes reach the recorder through a one-slot seam fed by `emitResult` and the gate entry points; a verb with no envelope (`identity`, `script`) records a minimal event, because a uniform stream is what verb-sequence readers need.

Context (branch, commit, config, toggle) is gathered concurrently with the verb itself, starting at invocation — which is also why `accept` still attributes correctly: the branch is read while the worktree exists. The toggle is `[project].logbook`; when the config is unreadable, the recorder writes nothing.

## Where it lives in code

| Concept                         | File                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Event schema + tolerant parser  | [`src/engine/logbook/schema.ts`](../../../src/engine/logbook/schema.ts)         |
| Config-epoch fingerprint        | [`src/engine/logbook/epoch.ts`](../../../src/engine/logbook/epoch.ts)           |
| Append, rotation, epoch sidecar | [`src/engine/logbook/store.ts`](../../../src/engine/logbook/store.ts)           |
| The recorder                    | [`src/engine/logbook/record.ts`](../../../src/engine/logbook/record.ts)         |
| The CLI wrapper + verb registry | [`src/engine/logbook/cli.ts`](../../../src/engine/logbook/cli.ts)               |
| The observed-envelope seam      | [`src/shared/result_capture.ts`](../../../src/shared/result_capture.ts)         |
| The no-network guard            | [`tests/logbook_no_network_test.ts`](../../../tests/logbook_no_network_test.ts) |
| Behaviour tests                 | [`tests/engine_logbook_test.ts`](../../../tests/engine_logbook_test.ts)         |

## See also

- [Trust & your data](../00-orientation/trust-and-data.md) — the user-facing contract: what is recorded, the switch, and the deletion path.
- [ADR 0160](../_adr/0160-local-logbook-advisory-readers.md) — the decision of record, including the advisory readers to come.
