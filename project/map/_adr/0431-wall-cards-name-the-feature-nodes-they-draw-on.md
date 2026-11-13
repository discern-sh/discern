# ADR 0431: Wall cards name the feature nodes they draw on

**Status**: accepted on 2026-11-13. Extends the citation discipline of [ADR 0268](0268-the-benefit-canon-transposes-the-feature-registry.md) and [ADR 0370](0370-the-consequence-canon-records-second-order-effects.md) to the homepage wall of [ADR 0430](0430-the-homepage-ships-one-hydrated-react-island.md), and enrolls the wall's sets under [ADR 0176](0176-the-closed-sets-are-a-closed-set.md).

## Context

The homepage wall shows about seventy cards. Each card cites one entry: a human benefit, an agent benefit, a consequence, or a claim. A benefit cites the feature nodes it draws on, and its guard holds those citations live. A card reached a feature only through its entry.

That left a gap. A benefit often draws on several feature nodes, and a card's words usually describe one or two of them. When a node left the feature canon, the benefit's guard made the benefit drop it. The benefit stayed, so the card's citation stayed live, and the card could go on describing a feature that was gone.

The deck also sat outside the machinery the registries share. No generated page showed a card beside the entry it expresses. The registry atlas named neither the deck, its lenses, nor its tuning knobs, so a reader had no route from those sets to their guards.

Two facts bounded the choice:

- The homepage's browser bundle loads the deck module. Whatever the deck imports ships to every visitor.
- A published site joins the current website source to the released product's `src/` tree. The feature registry imports from `src/`. A deck that imported the registry would make every site publish depend on those imports matching the release.

## Decision

**Every card names the feature nodes it draws on.** A card's `drawsOn` lists the feature-canon node ids its own words depend on. It names at least one.

**A card draws only on nodes its cited entry rests on.** A human benefit rests on the nodes it draws on. An agent benefit also rests on the nodes that support it. A consequence rests on the nodes of the human benefits under it. A claim rests on the nodes of every benefit that carries it. A card therefore promises no more of the product than the entry it expresses.

**The deck stays a site module of ids and words.** [`site/wall/deck.ts`](../../../site/wall/deck.ts) imports no registry. [`scripts/brand/wall.ts`](../../../scripts/brand/wall.ts) reads the deck's ids against the registries they name, and only tests and code generation load it.

**The brand registry generates the wall's page.** [`homepage-wall.md`](../_internal/brand/homepage-wall.md) shows every card with its words, the entry it expresses, and the nodes it draws on. It ends with an index from each feature node to the cards that depend on it.

**The cards, the lenses, and the tuning knobs are canonical sets.** [`scripts/canonical_sets.ts`](../../../scripts/canonical_sets.ts) declares each one with its guards. Their sources remain under `site/wall`, beside the page that loads them.

## Consequences

- Removing a feature node fails the deck test at each card that draws on it, and the failure names the card. The same happens when a benefit stops drawing on a node that one of its cards names.
- A new card chooses its nodes from its entry's nodes. A wrong choice fails with the list of nodes the entry rests on.
- The test holds that a card's nodes are live and belong to its entry. It cannot judge whether they are the nodes the words describe. That review happens on the generated page.
- Each card's node ids ship in the homepage bundle, beside the `source` and `cites` fields that already did. Nothing in the browser reads them.
- The generated page changes with any card's words, any cited entry's title, and any drawn feature's title. Code generation rewrites it in the same change.
- The wall's clusters must stay equal to the Human Benefit Canon's clusters, because the page takes each cluster's title from that canon. The deck test holds the two lists equal.

## Alternatives considered

- **Derive a card's features from its entry.** This needs no authoring. A card would then follow its entry's whole list of nodes. Removing one node from a benefit that draws on several would never reach the card, so the gap stays open.
- **Move the deck under `scripts/brand/`.** The deck would sit beside the registries it cites. The browser bundle would then load a module from the tooling tree, and the site's own guards read the deck where it is. Enrollment and a generated page do not depend on where the file sits.
- **Keep the citations in a table beside the deck.** The table would stay out of the bundle. It would also split one card across two modules, and an author writes a card's words and its citations together.
- **Generate the browser's deck from a registry module.** A generated file would fix the supported agents' names at the time it was written. The page takes those names from the released product when the site is published.
