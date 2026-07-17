---
title: Strand detection
description: Find tracked files a gate stage changed after the final commit, with the responsible stage named.
order: 40
aliases:
  - tree drift
  - dirty gate
  - stranded changes
---

# Strand detection

_A green final gate must not leave a committed-clean tracked file changed._

Gate jobs can write files. Formatters commonly do so. A build may regenerate a manifest, and a test may update a golden file by accident. If `discern done` returned green while those changes remained uncommitted, the result would describe a different tree from the branch that would land.

Strand detection turns that situation into a `tree_drift` failure. The diagnostic names each changed file, attributes it to the first gate stage that made it dirty, includes a capped diff, and uses `git diff` as the reproduce command ([ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)).

## What the gate compares

Before any stage runs, discern records the tracked paths that already have staged or uncommitted changes. It records the set again after each successful stage group. At the end, a path is stranded when it meets both conditions:

- it was tracked and clean when the gate started;
- it is dirty when the otherwise-green gate finishes.

The first successful stage snapshot containing the path identifies its origin. This covers fix, build, the combined check-and-test group, and scope gates. A later stage that restores the file to its committed state leaves no strand, because the final tree is clean.

## Fix the failure

1. Read the diff in the diagnostic.
2. Decide whether the generated change belongs in the commit or whether the job is misconfigured.
3. Commit the intended output, or change the command so it verifies without rewriting.
4. Run `discern done` again on the final commit.

The gate never commits its own output. Only the author can choose the right commit boundary and message ([ADR 0047](../_adr/0047-fix-stage-strand-detection.md)).

## Where it lives in code

| Concern | Source |
| --- | --- |
| Dirty-path snapshots and attribution | [`tree_drift.ts`](../../../src/engine/gate/tree_drift.ts) |
| Snapshot timing and failure integration | [`finish.ts`](../../../src/engine/gate/finish.ts) |
| Cross-stage coverage | [`engine_gate_ergonomics_test.ts`](../../../tests/engine_gate_ergonomics_test.ts) |

## Current state & gotchas

- Paths already dirty when the gate begins are excluded. This keeps the rule useful during an inner loop where a fixer is expected to rewrite the author's current edits.
- New untracked files do not trigger strand detection. They remain visible in `git status` and still prevent a clean receipt or acceptance.
- If git cannot produce a snapshot, the strand check skips rather than inventing a failure. Other gate jobs continue to decide the result.
- The relevant source files contain no unfinished-work markers for strand behavior.
