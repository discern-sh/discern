---
aliases:
  - code maintenance
  - duplication census
  - clone groups
  - duplicated lines
  - dead exports
  - complexity census
  - FTA
---

# Maintenance

_Use measured evidence to remove unreachable code, incidental repetition, and concentrated responsibilities without distorting ownership to improve a number._

## Keep direct exports reachable

Run `deno task dead-exports` to scan the canonical authored-Deno universe. The detector reports direct named declarations that are referenced only by their own `export` modifier. The repository test holds this census at zero, so a new declaration cannot acquire artificial reachability merely by being exported.

The detector is conservative. Public modules, declaration files, re-exports, namespace imports, and dynamic imports remain live because a repository-local static scan cannot prove which member an external or runtime consumer selects. [`dead_exports_lib.ts`](../../../scripts/dead_exports_lib.ts) records the exceptional generated-copy root whose consumer imports the projected module rather than its authored source. The existing byte-parity test binds that projection to the source. A new exception needs equivalent external evidence; it is not a general allowlist.

## Read a clone diagnostic

Run `deno task duplication-census` for the complete advisory report. Each `DuplicateCloneGroup` diagnostic contains one semantic fingerprint, a normalized token and line size, its duplicate-line contribution, and two or more exact one-based path/range occurrences. The final stdout lines expose `duplicate_clone_groups` for the group census and `duplicated_lines` for the blocking standard.

Candidate token windows do not appear in this output. [`duplication_census_lib.ts`](../../../scripts/duplication_census_lib.ts) collapses them into maximal exact or small-edit groups, then selects occurrences globally so one source range contributes to at most one finding. Fingerprints derive from the normalized semantic skeleton rather than paths, traversal order, machine state, or physical formatting. Repeated runs over the same source produce the same groups, order, fingerprints, and scalar.

## Decide whether to consolidate

Treat a group as incidental duplication when its occurrences represent one behavior with one reason to change. Elect one authority, route every caller to it, delete the copies, and keep a regression test at the shared boundary. If occurrences have independent reasons to evolve, keep them separate and make that boundary legible in their owning modules; do not distort the implementation merely to move the number.

The detector ignores comments, whitespace, local identifier spelling, literal values, imports and re-exports, type-only declarations, syntax-declared top-level registry tables, and declared generated artifacts. These categories remove syntax and ownership noise rather than excusing named files. The census remains conservative: a reported clone is actionable evidence, not a Proof that two routines have identical product intent.

## Capture each reduction

After a focused cleanup, run the relevant tests and `deno task duplication-census`. If `duplicated_lines` falls, run `discern standards --pin duplicated_lines` so the lower ceiling becomes the next branch's baseline. Keep each cleanup behavior-preserving and atomic. The cleanup ledger in [`project/TODO.md`](../../TODO.md) stays open while defensible incidental groups remain; a broad campaign to manufacture a convenient number is not a maintenance goal.

The gate runs the census when a declared input changes and may replay its prior reading otherwise. It does not use a detector cache. Generated ownership and source membership come from the same configuration and Git-derived structural-scope authorities used elsewhere in the repository.

## Read the complexity tail

Run `deno task complexity` for the pinned FTA report. The wrapper projects the exact canonical authored-Deno source set into an owned temporary directory and fails if FTA omits a supported source, returns a duplicate, or analyzes an unexpected file. The omission of declaration files by FTA remains explicit. Generated projections stay visible in the report but do not consume a maintenance budget.

Read the production, tooling, and test lanes separately. Each lane ranks FTA score, `cyclo` count, physical lines, and full-history Git touches independently. These are file-level advisory signals. Function-level cognitive complexity remains outside the measurement. In particular, a large declarative catalogue can have a high score without hiding a tangled algorithm. There is no repository-wide average and no cap tied to today's single worst file.

Only the extreme tail blocks: a non-generated file whose score exceeds 100 or whose `cyclo` count exceeds 200. Every existing member has an exact, reviewed score and `cyclo` ceiling in [`complexity_hotspots.ts`](../../../scripts/complexity_hotspots.ts). A new member, a regression beyond either file budget, or a registry row whose file has improved below both thresholds fails the census. When a behavior-preserving decomposition clears both thresholds, remove that row and pin `complexity_hotspots`; the falling standard holds the legacy-tail population so it can only shrink.
