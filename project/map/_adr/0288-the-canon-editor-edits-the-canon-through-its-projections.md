# ADR 0288: Canon Editor edits the canon through its projections

**Status**: accepted

## Context

The five prose registries — feature canon, benefit canon, practice canon, glossary, claims ledger — are read as generated map pages but authored as TypeScript data thousands of lines deep in `scripts/`. During the launch editorial period every wording pass pays a hunt-and-correlate toll per sentence: proof-read the page, find the literal, edit, regenerate, wait for the gate to judge the register. Three properties block the obvious fixes. The generated pages are lossy projections (one node renders into several pages plus coverage tables), so parsing page edits back is structurally unsound. Some prose is not text — statements interpolate other registries at module evaluation. And the register judgments (retired synonyms, plain-register jargon, reading grade, Vale) arrive at gate time, minutes after the edit they judge.

## Decision

Build Canon Editor: a repo-internal local web app under `scripts/canon_editor/`, launched as a project script, where the generated pages themselves are the editing surface and the registries stay the store.

- **One renderer, annotated.** The real render functions gain one seam: every prose field routes through `annotateProse`, an identity function until the editor installs a marker annotator. The committed pages are byte-identical with no annotator installed, and a parity guard (`tests/canon_editor_parity_test.ts`, registered against all five registries in the meta-registry) pins the annotated render to the plain render, through the canonical formatter, with every entry covered.
- **Two views of one file, pinned to each other.** Module evaluation (a fresh subprocess per refresh) supplies what the prose says; a syntax-only ts-morph view supplies where it lives and what the editor may touch. Interpolated templates and computed values classify as locked from syntax alone, so the locked state has one authority and no hand-kept list. The parity guard holds both views to the same entry set.
- **Write-back is deliberately narrow.** The local server answers requests addressed to `localhost` or `127.0.0.1` only, and every non-safe request carries a per-process browser authority. A save is compare-and-swap: it replaces exactly one editable literal only while the source still equals the value the editor opened. Editable literals are prose strings and the existing string arrays explicitly marked for typed picker write-back (`drawsOn`, `claims`, `surfaces`, and `hints`); computed lists stay locked, and list values must belong to their live registry authority. The save formats via the repository's formatter, re-renders in a fresh subprocess, rewrites the committed pages to the generator's exact bytes, and runs the registry's guard files from its `canonical_sets.ts` roster. Any red step restores every path to its prior bytes or prior absence. Field semantics compile `satisfies Record<keyof …>` against the registry interfaces, so a new field fails the editor's typecheck until classified.
- **The gate stays the authority.** The editor runs the same guard files and the same measuring code (`plain_reading_grade_lib`, the glossary's retired patterns, `vale_lib` — the one sanctioned Vale spawn site) earlier, never differently, and adds no second path around `discern done`.

## Consequences

- Editorial passes edit in reading order with keystroke-latency register judgment; the save-and-prove loop measures well under a second warm, so proving every save is cheap enough to be the default.
- A green save leaves the registry and its generated pages agreeing on disk — the natural unit for one atomic commit per wording change.
- An IDE edit to the open field produces a conflict instead of being overwritten by a stale browser draft; reloading chooses the new base explicitly.
- The editor is a second surface, but its maintenance failure mode is a compiler error or a red parity guard, not quiet rot: renderer drift, a new registry field, or an entry the editor cannot reach all fail the gate.
- The annotation seam adds one call per rendered field to the registries' renderers, and the benefit canon's at-a-glance table stays unannotated because in-cell markers would widen the formatter's column padding.
- Structural operations — adding, retiring, or reordering entries and fields, plus a commit composer — are deliberately out of scope; agent-mediated editing remains the tool for campaigns.

## Alternatives considered

**Move authority to per-entry data files (Markdown plus frontmatter).** Rejected: trades away typed claim citations and evaluation-time interpolation, demands an interpolation notation to win them back, and reverses the registry lineage without delivering the editing surface.

**Make the generated pages editable and parse edits back.** Rejected: the projections are lossy and derived spans are not text; bidirectional sync is a standing drift machine.

**A terminal editor or an IDE plugin.** Rejected: paragraph prose, side-by-side registers, and the citation web want a browser; a plugin locks to one editor and still cannot render the projections without reimplementing the renderers.

**Agent-mediated editing only.** Kept for campaigns and structural work; rejected as the only path because a chat round-trip per sentence is the wrong tool for editorial passes in reading order.
