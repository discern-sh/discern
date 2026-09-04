---
description: Canon Editor edits the prose registries on their generated pages and proves every save with the canons' guards.
aliases:
  - Canon Editor
  - canon editor
  - canon registry editor
---

# Canon Editor

_Edit the canon through its generated pages. Every prose span knows which registry field it renders, closed lists open live-authority pickers, and the canons' guards prove a save before the tree keeps it._

The prose registries are read as generated pages but authored as TypeScript data under `scripts/`: the feature canon, the Human and Agent Benefit Canons, the demand canon, the practice canon, the glossary, and the claims ledger. Canon Editor closes that gap for editorial passes. The registry stays the store, the page supplies the editing surface, and `discern done` remains the authority on whether the work is done. Canon Editor moves the same checks earlier.

## Launching

```
discern scripts canon-editor
discern scripts canon-editor open proof
```

The server binds 127.0.0.1 only, on a port salted from the worktree identity, so each worktree's Canon Editor coexists with its site server, and `PORT` overrides. It answers `localhost` and `127.0.0.1` only, and every non-safe browser request carries a random authority minted for that server process; a webpage outside Canon Editor cannot drive its write, guard, or IDE routes. It also serves from worktrees only: Canon Editor edits the tree it runs in, and a launch on the main checkout refuses rather than aim write-back at the trunk. `open` resolves any entry id, slug, or title across the registries to its source line and opens PhpStorm there. The same resolution supports every jump in Canon Editor. `open` never writes, so it works from any checkout.

## The reading surface

A fresh subprocess evaluates the registries and renders the canon pages through the real renderers (`scripts/canon_editor/snapshot.ts`), with an annotation seam (`scripts/canon_editor/annotation.ts`) wrapping each field's text in markers that carry its registry, entry, and field. The glossary appears as separate map and Manual pages. The Map page comes from `renderGlossaryDoc()`; the Manual page comes from the codegen-owned `renderManualGlossaryArtifact()`, including the Manual wrapper and projection metadata. Their definition spans resolve to the same glossary field. Each page descriptor names its corpus and prose policy, so another corpus must declare how saves are judged.

The server turns annotation markers into spans, restores the committed pages' heading anchors, and reroutes canon-internal links into Canon Editor. A syntax-only view of the same files (`scripts/canon_editor/registry_ast.ts`) supplies each entry's source position and classifies every field literal: plain strings edit, supported arrays of string literals take typed pickers, and interpolated templates or computed values render locked and stay IDE jumps.

That syntax view uses ts-morph's official JSR distribution. Canon Editor remains a source-only development surface: the production compiler embeds npm packages from the product graph rather than the workspace dependency directory, so dependencies used only by Canon Editor, tests, or the site do not enter discern's binary ([ADR 0289](../_adr/0289-production-binaries-embed-only-product-reachable-npm-packages.md)).

The inspector rail shows the selected entry's source position, field inventory, citation web in each direction, claims carried, and registry guard roster. It also runs that roster on demand. Every existing literal prose field has an Edit button in the rail. A rendered annotation opens the workbench over its span; a literal such as glossary `plain.phrase` or `plain.keep` opens the same workbench inside the rail when the current page has no span for it. The workbench retains the field's register, reading-grade feedback, compare-and-swap request, and save pipeline. Glossary `plain.match`, templates, computed values, absent properties, and changes between the phrase and keep variants remain locked.

Every string-list field whose legal values come from a closed live set has searchable checkbox write-back. This covers feature `surfaces`; human-benefit `primaryFor`, `drawsOn`, and `claims`; agent-benefit `drawsOn`, `supportedBy`, `hints`, and `claims`; Demand Canon `forces`, `segments`, and `answer.benefits`; practice `mechanisms`, `yields`, `agentYields`, `holds`, and each `upheld` tier; and claim `evidence`. Options derive from the live feature, benefit, claim, hint, surface, project-inventory, evidence-class, demand-force, audience, verb, config-section, and bundled-skill authorities. Practice teaching offers bundled skills; enforcement and automation offer verbs and config sections. Existing order survives edits, additions append, stale values stay visible for removal, and the server refuses duplicate, unknown, retained stale, reordered, tier-invalid, or empty required lists before writing. Editing a registry or picker authority in the IDE refreshes Canon Editor automatically.

On the Demand Canon page, territory titles and tensions and each entry's title, situation, current alternative, cost, and recorded gap edit as brand-register prose. Benefit answers, forces, and audience segments use live pickers. Territory counterparts, free-form Heard as lists, and shared evidence constants remain source edits; their rendered fields still select the right entry and offer an IDE jump. The demand-center constants and supply push records also remain source edits, outside the entry inspector.

## The save-and-prove loop

A save compares the source literal with the value the editor opened before it replaces anything, so an IDE edit to the same field becomes a visible conflict rather than an overwrite. A current save replaces one prose string or ordered string array through the syntax view, formats the source, re-renders every annotated projection in a fresh subprocess, and writes changed pages to their generator bytes. Each changed map page runs the map prose policy; each changed Manual page runs the shared Manual prose implementation against that page. The registry and every projection participate in one transaction. A render failure, prose refusal, or red registry guard restores each path to its previous bytes or previous absence. A green glossary save therefore leaves its registry, Map projection, and Manual projection aligned.

Saving a technical field queues its plain twin for review, and the nudge rides the entry's rail until the twin is visited. Saving a plain field re-measures the `plain_reading_grade` standard.

## Judgment at the keystroke

While a field is open, the draft is judged live: retired synonyms from the glossary's own patterns (code spans stay legal names), the plain register's jargon scan for plain fields, and the field's own reading grade. On a pause, Vale runs through `scripts/vale_lib.ts` over a probe path chosen so the register's real section styles apply. The gate's judgment arrives at the keystroke instead of minutes later; the gate still has the final word.

## Briefing work outside the editor

The selected-entry rail includes **Brief an agent**. The panel accepts a short desired outcome and shows a selectable Markdown prompt. The pure composer in `scripts/canon_editor/ui/brief.js` includes bounded entry identity, source lines, page context, field value and server-authored semantics, locked reasons, citations, claims carried, and the registry's guard roster. It derives a short literal worktree name from the registry and entry and gives a fresh agent the required `discern_status` → `discern_start` → re-root → `discern_prepare` → commit → `discern_done` sequence.

**Copy brief** copies the visible preview. When clipboard access fails, the preview stays focused and selected with a manual-copy instruction. Composition happens in the browser from the entry data Canon Editor already loaded. The action has no dispatch, worktree, file-write, guard, gate, Git, or remote-request route.

## Enrolment

The guard net Canon Editor serves also holds the editor itself. `PROSE_REGISTRY_NAMES` owns the supported registry names, and the parity guard in `tests/canon_editor_parity_test.ts`, registered with each prose registry in [canonical sets](canonical-sets.md), pins annotated renders to their committed pages, requires every page to declare a corpus and prose policy, requires every canon entry to surface an annotated span, and holds the syntax enumeration equal to the evaluated registries. The field maps in `scripts/canon_editor/fields.ts` compile `satisfies` clauses over the registry interfaces, so a new registry field breaks the editor's typecheck until the field is classified. Closed live lists must declare picker write-back, and picker sources stay in two-way parity with their builders. The server guard enumerates those entries and fields through the HTTP projection and requires every locked leaf to carry a reason. `tests/canon_editor_isolation_test.ts` reruns the mutation suite without write authority over the checkout; a new live-tree write fails by permission under the parallel runner.

## Limits

- Interpolated prose, computed arrays, regex matchers, and non-literal values stay source-derived.
- Free-form lists such as Demand Canon `heardAs` and glossary `matches` stay source edits. Closed scalar fields also stay source edits.
- Structural work such as adding, retiring, reordering, renaming, inserting a property, or changing a glossary plain-rendering variant remains agent work. **Brief an agent** prepares the handoff but does not perform it.
- Canon Editor does not stage or commit changes. A stage-and-commit composer and scaffolded add, retire, and reorder forms remain future work.
