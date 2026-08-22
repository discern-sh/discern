---
description: Canon Editor edits the prose registries on their generated pages and proves every save with the canons' guards.
aliases:
  - Canon Editor
  - canon editor
  - canon registry editor
---

# Canon Editor

_Edit the canon through its generated pages. Every prose span knows which registry field it renders, typed list fields open from the inspector rail, and the canons' guards prove a save before the tree keeps it._

The prose registries are read as generated pages but authored as TypeScript data under `scripts/`: the feature canon, the Human and Agent Benefit Canons, the demand canon, the practice canon, the glossary, and the claims ledger. Canon Editor closes that gap for editorial passes. The registry stays the store, the page supplies the editing surface, and `discern done` remains the authority on whether the work is done. Canon Editor moves the same checks earlier.

## Launching

```
discern scripts canon-editor
discern scripts canon-editor open proof
```

The server binds 127.0.0.1 only, on a port salted from the worktree identity, so each worktree's Canon Editor coexists with its site server, and `PORT` overrides. It answers `localhost` and `127.0.0.1` only, and every non-safe browser request carries a random authority minted for that server process; a webpage outside Canon Editor cannot drive its write, guard, or IDE routes. It also serves from worktrees only: Canon Editor edits the tree it runs in, and a launch on the main checkout refuses rather than aim write-back at the trunk. `open` resolves any entry id, slug, or title across the registries to its source line and opens PhpStorm there. The same resolution supports every jump in Canon Editor. `open` never writes, so it works from any checkout.

## The reading surface

A fresh subprocess evaluates the registries and renders the canon pages through the real renderers (`scripts/canon_editor/snapshot.ts`), with an annotation seam (`scripts/canon_editor/annotation.ts`) wrapping each field's text in markers that carry its registry, entry, and field. The server turns those markers into spans, restores the committed pages' heading anchors, and reroutes canon-internal links into Canon Editor. A syntax-only view of the same files (`scripts/canon_editor/registry_ast.ts`) supplies each entry's source position and classifies every field literal: plain strings edit, supported arrays of string literals take typed pickers, and interpolated templates or computed values render locked and stay IDE jumps.

That syntax view uses ts-morph's official JSR distribution. Canon Editor remains a source-only development surface: the production compiler embeds npm packages from the product graph rather than the workspace dependency directory, so dependencies used only by Canon Editor, tests, or the site do not enter discern's binary ([ADR 0289](../_adr/0289-production-binaries-embed-only-product-reachable-npm-packages.md)).

The inspector rail shows the selected entry's source position, field inventory, citation web in both directions (which human or agent benefits draw on a node, which demand entries a human benefit answers, which practice tenets enable an agent outcome, and which public claims ride on an entry), and its registry's guard roster with an on-demand runner. A practice tenet's `agentYields` field points outward to its Agent Benefit Canon outcomes; selecting an outcome points back to every enabling tenet. Human-benefit `drawsOn` and `claims`; agent-benefit `drawsOn`, `supportedBy`, `hints`, and `claims`; feature `surfaces`; and Demand Canon `answer.benefits` arrays open searchable checkbox pickers there. Choices come from the live feature, human-benefit, claim, surface, and hint registries; existing order survives edits, and a newly selected value appends. Editing a registry or picker authority in the IDE refreshes Canon Editor automatically.

On the Demand Canon page, territory titles and tensions and each entry's title, situation, current alternative, cost, and recorded gap edit as brand-register prose. Benefit answers use the live benefit picker. Territory counterparts, forces, segments, free-form Heard as lists, and shared evidence constants remain source edits; their rendered fields still select the right entry and offer an IDE jump. The demand-center constants and supply-push records also remain source edits, outside the entry inspector.

## The save-and-prove loop

A save compares the source literal with the value the editor opened before it replaces anything, so an IDE edit to the same field becomes a visible conflict rather than an overwrite. For typed lists, the server also rejects duplicates and values absent from the current picker authority before the first write. A current save replaces that one prose string or ordered string array through the syntax view, formats the file as the repository would, swaps it into place, re-renders every projection in a fresh subprocess, and rewrites the committed canon pages to the generator's own bytes. The rewritten pages are then held to the gate's own prose command with its blocking severity, and the registry's guard files run from the meta-registry roster. Any red step restores every path to its previous bytes or previous absence, so an unprovable save leaves the tree as it was. A green save leaves the registry and its generated pages agreeing on disk, ready for an atomic commit.

Saving a technical field queues its plain twin for review, and the nudge rides the entry's rail until the twin is visited. Saving a plain field re-measures the `plain_reading_grade` standard.

## Judgment at the keystroke

While a field is open, the draft is judged live: retired synonyms from the glossary's own patterns (code spans stay legal names), the plain register's jargon scan for plain fields, and the field's own reading grade. On a pause, Vale runs through `scripts/vale_lib.ts` over a probe path chosen so the register's real section styles apply. The gate's judgment arrives at the keystroke instead of minutes later; the gate still has the final word.

## Enrolment

The guard net Canon Editor serves also holds the editor itself. `PROSE_REGISTRY_NAMES` owns the supported registry names, and the parity guard in `tests/canon_editor_parity_test.ts`, registered with each prose registry in [canonical sets](canonical-sets.md), pins the annotated render to the committed pages byte for byte, requires every canon entry to surface an annotated span, holds the syntax enumeration equal to the evaluated registries, and binds every picker-enabled field to one option builder. The field maps in `scripts/canon_editor/fields.ts` compile `satisfies` clauses over the registry interfaces, so a new registry field breaks the editor's typecheck until the field is classified. The server guard enumerates those same entries and fields through the HTTP projection, while `tests/canon_editor_isolation_test.ts` reruns the mutation suite without write authority over the checkout; a new live-tree write fails by permission rather than by luck under the parallel runner.

## Limits

- Derived spans — prose interpolated from sets like the known job names — stay IDE jumps by design.
- Computed lists stay IDE jumps. Picker write-back covers existing literal `drawsOn`, `supportedBy`, `claims`, `surfaces`, `hints`, and Demand Canon `answer.benefits` arrays; other classified list fields remain read-only.
- Structural work — adding, retiring, or reordering entries or fields, and batch campaigns — remains agent work, briefed the ordinary way.
