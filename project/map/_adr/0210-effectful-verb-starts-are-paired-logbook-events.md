# ADR 0210: Effectful verb starts are paired logbook events

> **Amendments.**
>
> - **[ADR 0272](0272-logbook-lifecycle-actions-require-terminal-confirmation.md) — lifecycle exception:** the paired-start rule is amended for the two lifecycle commands that replace the Logbook they would otherwise record into — they write neither a `begin` nor a completion event, and confirm at the terminal instead.
> - **[ADR 0357](0357-lock-boundary-evidence-retires-superseded-logbook-starts.md) — superseded liveness:** the Logbook records the operation registry's resolved exclusion boundary, and a later-started paired invocation that completes under an overlapping boundary retires an older unmatched start from the live view while preserving its crash evidence.

**Status**: accepted; amends the completion-only recording sentence in [ADR 0160](0160-local-logbook-advisory-readers.md)

## Context

The logbook recorded a verb only after it finished. A fleet row could therefore name recent completed work, yet it had no evidence that a gate or test was running. During a long run, the git-derived activity timestamp stayed still and made active work look dormant. A process that crashed before completion left no event at all.

Liveness cannot depend on `discern start`. Worktrees can be created by another harness and later enter discern through `worktree ensure`, so every effectful invocation must supply its own evidence. The recording boundary must still preserve ADR 0160: local metadata only, no network path, no reader that gates, and no recording failure that changes the verb's result.

## Decision

Effectful verb invocations append a `begin` event automatically at invocation start. The completion event remains a `verb` event. Both carry one opaque invocation id, which joins the pair without timing, branch, or process heuristics.

The effectful class derives from the canonical top-level verb vocabulary. The pure-observation verbs are explicit exceptions; a new top-level verb therefore enrolls as effectful until classified otherwise. Effectful invocations cover `done`, `prepare`, `test`, `standards`, `refresh`, `tidy`, `desk`, `accept`, `update`, `start`, `script`, `preset`, `uninstall`, and the effectful paths under `setup`, `upgrade`, `config`, `patterns`, `worktree`, and `skills`. `help` and `map` join only when `--output` writes a file. Their ordinary reads, `upgrade --check`, the read forms of mixed command groups, and the pure-observation verbs remain completion-only. A parity guard reconciles the effectful top-level set with the CLI actions registered through the begin-recording path.

The begin line records the invocation time, writer version, verb, surface, raw driver evidence, branch, `HEAD`, config epoch, and invocation id. It contains no payload. Context and driver collection run beside the verb. The append is best-effort, and its promise absorbs every error. Completion waits for that promise only to preserve append order; a failed begin append never suppresses the completion attempt or changes the command.

An unmatched begin is crash evidence. Fleet activity treats a fresh unmatched begin as running. It stops making that live claim after the greater of 1 hour or 10 times the verb's recent median duration; with no duration prior, the horizon is 24 hours. The begin remains in the logbook and remains activity evidence after that cutoff.

The logbook schema stays at version 1. `begin` is an additive event kind: an older reader already classifies an unknown kind as foreign and continues. The invocation id is additive on completion events, and the new parser keeps it optional so pre-amendment version-1 verb lines remain readable. New writers always include it.

There is no declared “I have begun” action and no new state file. Agents do not maintain liveness. The invocation wrapper does.

## Consequences

- An effectful invocation normally adds 2 lines instead of 1. Existing detectors continue to analyze completed `verb` events and can adopt crash evidence separately.
- Fleet readers can name live work and update branch activity while git state is unchanged.
- A crash becomes inspectable local evidence. Its unmatched begin ages out of the running view without being deleted or rewritten.
- Duration priors are advisory medians over the bounded recent tail. Samples from the current config epoch take priority, with older epochs used only when the current one has no sample for that verb.
- Version-1 compatibility remains additive. Old readers skip begin lines; new readers accept historical completions without invocation ids.

## Alternatives considered

- **Require an agent to declare that work began.** Rejected. Ceremony decays into noise, `start` already declares intent, and recording must never become a precondition.
- **Record a begin only for `start`.** Rejected. Worktrees can enter discern without that verb, and one lifecycle event cannot establish whether a later gate or test is running.
- **Move to schema version 2.** Rejected. No existing field changes meaning, and the tolerant version-1 reader already supplies the required compatibility behavior for an additive kind and field.
