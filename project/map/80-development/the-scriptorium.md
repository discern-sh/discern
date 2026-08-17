---
description: The repo-internal studio that edits the five prose registries on their own generated pages, with every save proven by the canons' guards before it survives.
aliases:
  - scriptorium
  - canon studio
  - canon editor
---

# The Scriptorium

_The canon registries, where you read them. The scriptorium serves the generated canon pages as the editing surface: every prose span knows which registry field it renders, typed list fields open from the inspector rail, and a save proves itself against the canons' own guards before the tree keeps it._

The prose registries are read as generated pages but authored as TypeScript data under `scripts/`: the feature canon, the benefit canon, the practice canon, the glossary, and the claims ledger. The scriptorium closes that gap for editorial passes. The registry stays the store, the page is the lens with write-back, and `discern done` remains the authority on whether the work is done; the studio only moves that judgment earlier.

## Launching

```
discern scripts scriptorium
discern scripts scriptorium open proof
```

The server binds 127.0.0.1 only, on a port salted from the worktree identity, so each worktree's studio coexists with its site server, and `PORT` overrides. It answers `localhost` and `127.0.0.1` only, and every non-safe browser request carries a random authority minted for that server process; a webpage outside the studio cannot drive its write, guard, or IDE routes. It also serves from worktrees only: the studio edits the tree it runs in, and a stray launch on the main checkout refuses rather than aim write-back at the trunk. `open` resolves any entry id, slug, or title across the registries to its source line and opens PhpStorm there — the same resolution behind every jump in the studio. It never writes, so it works from any checkout.

## The reading surface

A fresh subprocess evaluates the registries and renders the canon pages through the real renderers (`scripts/scriptorium/snapshot.ts`), with an annotation seam (`scripts/scriptorium/annotation.ts`) wrapping each field's text in markers that carry its registry, entry, and field. The server turns those markers into spans, restores the committed pages' heading anchors, and reroutes canon-internal links into the studio. A syntax-only view of the same files (`scripts/scriptorium/registry_ast.ts`) supplies each entry's source position and classifies every field literal: plain strings edit, supported arrays of string literals take typed pickers, and interpolated templates or computed values render locked and stay IDE jumps.

The inspector rail shows the selected entry's source position, field inventory, citation web in both directions (which benefits draw on a node, which tenets cite it, which public claims ride on it through citing benefits), and its registry's guard roster with an on-demand runner. `drawsOn`, `claims`, `surfaces`, and `hints` arrays open searchable checkbox pickers there. Choices come from the live feature, claim, surface, and hint registries; existing order survives edits, and a newly selected value appends. Editing a registry or picker authority in the IDE refreshes the studio automatically.

## The save-and-prove loop

A save compares the source literal with the value the editor opened before it replaces anything, so an IDE edit to the same field becomes a visible conflict rather than an overwrite. For typed lists, the server also rejects duplicates and values absent from the current picker authority before the first write. A current save replaces that one prose string or ordered string array through the syntax view, formats the file as the repository would, swaps it into place, re-renders every projection in a fresh subprocess, and rewrites the committed canon pages to the generator's own bytes. The rewritten pages are then held to the gate's own prose command with its blocking severity, and the registry's guard files run from the meta-registry roster. Any red step restores every path to its previous bytes or previous absence, so an unprovable save leaves the tree as it was. A green save leaves the registry and its generated pages agreeing on disk, ready for an atomic commit.

Saving a technical field queues its plain twin for review, and the nudge rides the entry's rail until the twin is visited. Saving a plain field re-measures the `plain_reading_grade` standard.

## Judgment at the keystroke

While a field is open, the draft is judged live: retired synonyms from the glossary's own patterns (code spans stay legal names), the plain register's jargon scan for plain fields, and the field's own reading grade. On a pause, Vale runs through `scripts/vale_lib.ts` over a probe path chosen so the register's real section styles apply. The gate's judgment arrives at the keystroke instead of minutes later; the gate still has the final word.

## Enrolment

The guard net the studio serves also holds the studio. The parity guard in `tests/scriptorium_parity_test.ts`, registered with each prose registry in [canonical sets](canonical-sets.md), pins the annotated render to the committed pages byte for byte, requires every canon entry to surface an annotated span, holds the syntax enumeration equal to the evaluated registries, and binds every picker-enabled field to one option builder. The field maps in `scripts/scriptorium/fields.ts` compile `satisfies` clauses over the registry interfaces, so a new registry field breaks the studio's typecheck until the editor says how to treat it. The server guard enumerates those same entries and fields through the HTTP projection, while `tests/scriptorium_isolation_test.ts` reruns the mutation suite without write authority over the checkout; a new live-tree write fails by permission rather than by luck under the parallel runner.

## Limits

- Derived spans — prose interpolated from sets like the known job names — stay IDE jumps by design.
- Computed lists stay IDE jumps. Picker write-back covers existing literal `drawsOn`, `claims`, `surfaces`, and `hints` arrays; other classified list fields remain read-only.
- Structural work — adding, retiring, or reordering entries or fields, and batch campaigns — remains agent work, briefed the ordinary way.
