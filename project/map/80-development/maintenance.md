---
aliases:
  - code maintenance
  - duplication census
  - clone groups
  - duplicated lines
---

# Maintenance

_Use measured evidence to remove incidental repetition without merging code that has different reasons to change._

## Read a clone diagnostic

Run `deno task duplication-census` for the complete advisory report. Each `DuplicateCloneGroup` diagnostic contains one semantic fingerprint, a normalized token and line size, its duplicate-line contribution, and two or more exact one-based path/range occurrences. The final stdout lines expose `duplicate_clone_groups` for the group census and `duplicated_lines` for the blocking Standard.

Candidate token windows do not appear in this output. [`duplication_census_lib.ts`](../../../scripts/duplication_census_lib.ts) collapses them into maximal exact or small-edit groups, then selects occurrences globally so one source range contributes to at most one finding. Fingerprints derive from the normalized semantic skeleton rather than paths, traversal order, machine state, or physical formatting. Repeated runs over the same source produce the same groups, order, fingerprints, and scalar.

## Decide whether to consolidate

Treat a group as incidental duplication when its occurrences represent one behavior with one reason to change. Elect one authority, route every caller to it, delete the copies, and keep a regression test at the shared boundary. If occurrences have independent reasons to evolve, keep them separate and make that boundary legible in their owning modules; do not distort the implementation merely to move the number.

The detector deliberately ignores comments, whitespace, local identifier spelling, literal values, imports and re-exports, type-only declarations, syntax-declared top-level registry tables, and declared generated artifacts. These categories remove syntax and ownership noise rather than excusing named files. The census remains conservative: a reported clone is actionable evidence, not a proof that two routines have identical product intent.

## Capture each reduction

After a focused cleanup, run the relevant tests and `deno task duplication-census`. If `duplicated_lines` falls, run `discern standards --pin duplicated_lines` so the lower ceiling becomes the next branch's baseline. Keep each cleanup behavior-preserving and atomic. The cleanup ledger in [`project/TODO.md`](../../TODO.md) stays open while defensible incidental groups remain; a broad campaign to manufacture a convenient number is not a maintenance goal.

The Gate runs the census when a declared input changes and may replay its prior reading otherwise. It does not use a detector cache. Generated ownership and source membership come from the same configuration and Git-derived structural-scope authorities used elsewhere in the repository.
