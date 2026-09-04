---
title: Duplication census
description: Read discern's clone-group evidence and reduce the repository's held duplicate-line total.
order: 180
aliases:
  - duplicated lines
  - duplicate clone groups
  - duplication Standard
---

# Duplication census

_The discern repository holds semantic duplicate lines at a falling ceiling and names every source range that contributes._

Run `deno task duplication-census` to scan the Git-tracked JavaScript and TypeScript files that the repository classifies as authored. The command writes clone diagnostics to stderr and ends stdout with 2 metrics:

- `duplicate_clone_groups` is the advisory count of selected clone groups;
- `duplicated_lines` is the blocking Standard.

## Read a clone group

A clone group is one normalized semantic form with at least 2 source occurrences. Each `DuplicateCloneGroup` diagnostic carries a semantic fingerprint, normalized token and line counts, its contribution to `duplicated_lines`, and every one-based path and line range to consolidate.

Fixed token windows nominate candidates. The detector extends and combines those candidates before choosing groups in descending size order. A physical source range contributes to at most 1 selected group, so a copied routine produces one maximal finding instead of a series of overlapping windows. The same rule covers copies within one file and across files.

Comments, formatting, literal values, and local identifier names do not define a fingerprint. A bounded local edit can remain in the same group. Repeated runs and different input traversal orders preserve the fingerprint and count.

## Read the held number

For each selected group, `duplicated_lines` charges its normalized line count for every occurrence after the first. A third copy adds the group's normalized size even though the group count stays unchanged. The measure therefore tracks the number and size of implementations that can drift independently.

Import and re-export declarations, type-only declarations, syntax-declared top-level registry tables, and declared [generated artifacts](../00-orientation/glossary.md#generated-artifact) stay outside the population. These exclusions follow syntax and declared ownership. They do not depend on a maintained list of inconvenient paths ([ADR 0343](../_adr/0343-duplication-holds-maximal-non-overlapping-normalized-lines.md)).

## Reduce and pin the total

The census has no cache. Its [Standard](../20-quality-gate/standards.md) `inputs` cover authored source suffixes, generated-file ownership configuration, the parser dependency, and runner configuration. The gate measures a matching change and may replay the recorded value for unrelated work.

Consolidate the path and line ranges named by one diagnostic, then run `deno task duplication-census` again. When `duplicated_lines` falls, run `discern standards --pin duplicated_lines` to hold the lower ceiling.
