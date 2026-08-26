# ADR 0343: Duplication holds maximal non-overlapping normalized lines

**Status**: accepted. Applies the growth-proof Standard policy in [ADR 0161](0161-growth-proof-standards-and-breach-escalation.md), generated-artifact ownership from [ADR 0247](0247-generated-artifacts-regenerate-never-merge.md), and the structural-scope contract in [ADR 0324](0324-structural-guards-declare-git-derived-source-universes.md).

## Context

A fixed token window can find copied source, but it cannot represent the debt. One copied routine contains many overlapping windows, so counting every match inflates one maintenance problem into dozens. Physical lines add another unstable dimension: comments, wrapping, and formatting can move the number without changing behavior.

Clone-group count alone loses important growth. A third copy of an existing routine increases the number of implementations that can drift, but it still belongs to one group. A useful blocking scalar must therefore reflect both the shared routine's size and every additional occurrence without charging the same source range twice.

Repository-wide syntax also repeats for reasons unrelated to maintenance risk. Imports, type declarations, registry tables, and generated mirrors can dominate a lexical detector. Excluding whichever files happen to be noisy would turn calibration into a growing allowlist and let new roots escape.

## Decision

**The duplication census reports maximal clone groups and holds the non-overlapping normalized lines contributed by every occurrence after the first.**

[`duplication_census.ts`](../../../scripts/duplication_census.ts) obtains the complete Git-derived `authored-deno` universe through `structuralGuardScope`. Declared generated artifacts leave the population through the generated-ownership registry. Imports and re-exports, interfaces and type aliases, and top-level multi-entry tables that declare themselves with `as const` or `satisfies` leave through parser-owned syntax categories rather than path exceptions.

The analyzer parses TypeScript and JavaScript tokens once per source. It ignores comments and whitespace, normalizes literal values, and alpha-normalizes local identifiers while retaining property and recognized platform names as behavioral evidence. A fixed ten-token window nominates exact anchors. Exact extension, nearby-edit chaining, and routine-level similarity then collapse anchors into maximal candidates. Candidate windows never become findings directly.

Candidates are ordered by normalized semantic size. A group is admitted only with at least two exact path/range occurrences, and each physical source range can belong to at most one admitted group. This global selection prevents nested or overlapping candidates from inflating the census. Same-file and cross-file occurrences use the same rule.

Each `DuplicateCloneGroup` records a versioned, path-independent SHA-256 fingerprint of its normalized skeleton, normalized token and logical-line sizes, duplicate-line contribution, and exact one-based occurrence ranges. A normalized logical line is a statement or block boundary in the shared token skeleton, not a physical source line. The group contributes `normalizedLineCount * (occurrences - 1)` duplicated lines.

`duplicate_clone_groups` remains advisory. The blocking `duplicated_lines` Standard sums the contribution of the globally selected groups. Duplication is not healthy product growth: a new pasted implementation creates another place that can drift, so the raw total is a down-only invariant rather than a density. The detector uses no private cache; Gate replay depends only on its declared Standard inputs.

The qualification suite fixes the contract through the three pre-consolidation `pollUntil` copies, renamed variants, comment and formatting changes, a small semantic edit, same-file and nested-overlap cases, clean controls, and syntax and ownership exclusions. It also requires identical results under reversed input traversal. Threshold or normalization changes must preserve those cases and are a recalibration of this blocking contract, not a convenient way to lower the number.

## Consequences

- One copied routine reports once, even when it contains many matching windows or a duplicated nested routine.
- Adding another occurrence to an existing group increases the held scalar; formatting and comments do not.
- Every diagnostic names the fingerprint and all source ranges needed to decide whether one authority should replace the copies.
- The detector is conservative rather than exhaustive. Short clones and routines with substantial edits may remain unreported, while a reported group still requires judgment about whether its occurrences have one reason to change.
- The census performs a fresh parse and comparison when measured. On the merged wave-11 tree it completes in seconds, so it stays in the ordinary Gate rather than becoming on-demand or relying on a hidden cache.
- A legitimate new duplicate still breaches the ceiling. The owner may approve an exact Standard limit proposal; unrelated consolidation must not offset it.

## Alternatives considered

- **Count every matching shingle.** Rejected because overlapping windows turn one clone into a volatile pile of debt.
- **Hold clone-group count.** Rejected because a new occurrence in an existing group would not change the number.
- **Count physical duplicate lines.** Rejected because formatting and comments would redefine the metric.
- **Hold a duplication rate.** Rejected because healthy growth does not require another implementation of behavior that already has an authority.
- **Exclude noisy files by name.** Rejected because ownership and syntax explain the exclusion while a path allowlist only memorializes current noise.
- **Adopt another clone-analysis dependency.** Rejected because the existing parser supports the qualified contract at proportionate cost; dependency avoidance would not outrank accuracy if these cases failed.
