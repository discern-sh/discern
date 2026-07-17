# ADR 0146: The gate validates the map's substance, and the CLI reference is generated

**Status**: accepted

## Context

The map carried ~1,700 cross-links, ~100 of them anchored to specific headings, and dozens of fenced `discern …` examples — none checked by anything. A renamed verb, a retired flag, a moved file, or a reworded heading rotted silently until a reader hit it; the docs-site launch would promote that rot from an internal annoyance to a public defect. The launch strategy assigned this stream the integrity guards and a generated CLI verb reference, alongside the codegen discipline the config reference already had ([ADR 0026](0026-typed-config-schema.md)).

Two boundary questions needed a ruling. First, WHICH docs are held current: the ADRs quote commands as they stood when each decision was taken, and re-editing dated records to track CLI renames would falsify history. Second, WHOSE anchor algorithm is canonical: the shared renderer collapsed whitespace runs and dropped underscores while authors demonstrably wrote fragments against GitHub's de-facto slugs — two files already carried anchors (`#your-files--yours`, `#bookkeeping--integration`) that were dead on the rendered surface, and the tree is read both on GitHub and through the renderer.

## Decision

Four architectural tests make doc drift a build failure (`tests/map_integrity_test.ts`), each driven off a live registry so new members auto-enrol ([ADR 0051](0051-canonical-set-parity.md)) and each proven to bite on a bad fixture (`tests/docs_integrity_test.ts`) before the tree relies on it:

1. **Fenced commands**: every fenced `discern …` example must validate against the live command tree — verbs, subcommands, aliases, and flags walked off `buildCli` (`cliCommandModel`), project-script names enrolled from the live scripts directory. Placeholders (`<name>`), optional brackets, alternation, comments, and shell operators are documentation conventions the validator honours, not failures.
2. **Links**: every intra-map link must resolve to a real file.
3. **Anchors**: every fragment must be a heading id the shared renderer actually mints. The renderer's slugger is now GitHub-compatible — punctuation drops, underscores survive, and every whitespace character becomes its own dash — so one anchor works on both reading surfaces.
4. **Audience boundary**: no published page (a published tier admitted by `isPublicDoc`, [ADR 0140](0140-validated-frontmatter-and-the-publish-predicate.md)) may link into `_internal/` or the private tree. Citing `_adr/` stays legal — decisions publish ([ADR 0141](0141-adr-citations-strip-at-render.md)).

The guarded corpus is the CURRENT map — every doc outside `_`-prefixed subtrees, root docs included. The `_` trees are exempt by design: ADRs are dated records, while `_internal` and the private tree carry no currency contract.

The CLI reference (`70-reference/cli-reference.md`) is a **generated, committed artifact** off the same live command tree, emitted by `deno task codegen` and held by the codegen drift family (`tests/cli_reference_codegen_test.ts`): the committed page must equal the generator, generation must be total over the visible surface, and no hidden command may leak. It ships `publish: false` (as does its section README) until the reference tier's authoring pass publishes it; flipping the withhold is a deliberate generator edit. Provider docs get the same totality: every registry-supported agent must have an integration page, tied by the page title to the registry's own label.

## Consequences

- A discern agent can no longer rename a verb, retire a flag, move a page, or reword a heading without the gate holding the documentation to the same change. The fix for a red guard is to update the doc (or the registry), never to weaken the guard.
- Anchors written the way authors already write them (GitHub-style) are now correct by construction on every surface; the renderer's algorithm is pinned by test and must not drift from GitHub's again.
- Example prose in fenced blocks is now a lightly constrained dialect: quote real commands, mark stand-ins as `<placeholders>`. Transcript output lines are untouched.
- External URLs stay ungated — network checks belong to the periodic verification stream, never a local gate dependency.
- The leaf-density standard's corpus now follows the document model too: the measurement admits pages through the publication predicate, so an unpublished page (this reference, its stub README) counts toward neither leaves nor words until it publishes. The metric was the last surface deriving "public" by path alone; the limit itself is untouched.
- The ADR exemption means a retired spelling can survive in a dated record (e.g. `config set-slot` in [ADR 0005](0005-declarative-config.md)) — that is history working as intended, not rot.
