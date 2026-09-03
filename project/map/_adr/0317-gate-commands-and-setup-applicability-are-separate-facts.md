# ADR 0317: Gate commands and setup applicability are separate facts

**Status**: accepted; extends [ADR 0168](0168-the-gate-declares-jobs.md) and preserves the schema-v1 result boundary of [ADR 0208](0208-public-contracts-version-by-schema-major.md) and [ADR 0220](0220-self-supplied-commands-count-for-nothing-in-assurance.md)

> **Launch vocabulary amendment (2026-09-03):** the pre-v1 config path is `[setup].not_applicable`. The broader prerelease `[assurance]` spelling has no alias or migration. Public result `data.assurance` remains the separate setup coverage projection described below.

## Context

Known `[jobs]` values already accepted a scalar or ordered list, but `discern config set-job` could author only the scalar form. Setup agents needing a project formatter followed by `discern tidy` left the supported surface. A serialized array passed positionally was worse: it became one literal command.

Omission also conflated an unwired protection with a lifecycle the project does not have. Commands control Gate execution; applicability controls setup's coverage denominator. Neither can be inferred from the other.

Schema v1 closes row state as `enforced | deferred | absent`, so a fourth state would break exhaustive consumers. Existing summaries also require `full` to mean `enforced === total`.

## Decision

`[jobs]` remains the sole Gate-command authority. Repeat `--run <command>` to replace a known job with an ordered list; the positional scalar remains compatible. Mixed forms, empty or missing values, and serialized string arrays in the positional form are refused with a corrected invocation. Preview and apply share one edit plan and the comment-preserving TOML editor.

Setup applicability lives separately:

```toml
[setup]
  not_applicable = ["build"]
```

Every `KNOWN_JOBS` member applies unless listed. `discern config set-job <known> --not-applicable` adds an absent lifecycle; `--applicable` removes it. Custom names are invalid. Any configured `[jobs]` value contradicts the declaration, including a no-op or discern-only housekeeping. Setting any command value removes the declaration in the same edit.

Applicability never enters the Gate planner and cannot skip any command, Standard, or checkpoint.

Setup assurance keeps the three-state row. An inapplicable row is `state: "absent", not_applicable: true`. The summary emits:

- `enforced`: applicable rows that carry a project command;
- `total`: the applicable denominator;
- `known_total`: the complete `KNOWN_JOBS` population;
- `not_applicable`: the number of excluded rows;
- `verdict`: `full` when every applicable row is enforced, `partial` when some are, and `minimal` when none are.

The marker and new counts are optional in the runtime schema; current producers always emit them. Keeping `total` as the applicable denominator preserves the v1 invariant: an older consumer reads full five-of-five while a newer one can account for the sixth row. A zero denominator is `full`, with copy stating that no known protections apply.

## Consequences

Setup agents can author literal ordered commands without manual TOML edits. New known jobs auto-enrol as applicable and absent; config loading and writing reject contradictions.

Schema-v1 consumers keep the closed state and coherent legacy counts. New consumers gain the applicability distinction. The cost is a second config section and an explicit owner or setup-agent judgment, which prevents heuristics from changing coverage or execution.

## Alternatives considered

**Infer from omission.** Rejected because omission can also mean setup is incomplete.

**Put `applicable = false` under `[jobs]`.** Rejected because execution authority must not appear to suppress work.

**Add a fourth row state.** Rejected within schema v1. A future result-schema major may adopt it and reconsider the summary.

**Keep `total` canonical.** Rejected because `full` would no longer mean `enforced === total`; `known_total` carries the canonical population instead.
