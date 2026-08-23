# ADR 0314: The public manual and project Map are separate corpora on one document engine

**Status**: accepted; amends the source and audience model in [ADR 0130](0130-docs-site-renders-the-help-tree.md), extends the frontmatter contract in [ADR 0140](0140-validated-frontmatter-and-the-publish-predicate.md), and changes the staging source in [ADR 0142](0142-customer-binaries-carry-only-public-docs.md)

## Context

The documentation site originally rendered a public subset of discern's own Map. That decision removed a third content copy: one discovered Markdown tree fed the website, customer binary, command line, Model Context Protocol (MCP), raw Markdown, search, and machine editions. It also made discern's own agent-maintained understanding visible.

The Map has since grown into the comprehensive working account its primary readers need. Agents building discern and its maintainer need subsystem boundaries, implementation detail, contributor procedure, and exact operating state. Human end users and first-time website visitors need a deliberate learning path that starts from their goals and introduces product concepts at the point of use. External coding agents need the complete product contract without repository-only context. A single public/private filter cannot give all three groups the right sequence or register. Editing Map pages toward one audience weakens them for another, while publishing the whole admitted set makes the default human journey an implementation catalogue.

The shared machinery remains valuable. Discovery, validated metadata, publication parity, redirects, link and command checks, search fields, raw Markdown, site rendering, terminal rendering, MCP results, and binary staging should not fork. The Map is also the only live demonstration of a central product benefit: a person can inspect what agents understand about a project.

## Decision

**discern's public product manual and discern's project Map are separate authored corpora backed by one document engine.**

- The configured Map remains the agent-first account of this codebase. Agents working on discern and its maintainer are its primary readers. Its present-tense boundaries, invariants, navigation, freshness, and decision links remain under the Gate.
- A dedicated repository-owned manual tree is the one source for `/docs`, `discern docs`, `discern_docs`, bundled Markdown, raw editions, search, and machine indexes. The website never owns a second copy, and no surface receives inline body variants.
- The neutral document engine continues to own discovery, metadata parsing, ordering, resolution, search projection, redirects, rendering inputs, and integrity primitives for both trees. Corpus-specific registries decide admission, section order, front doors, and routes above that engine.
- `publish` continues to mean eligible for every published projection of its corpus. It does not mean prominent. The manual has one central, authored front-door set; new published pages enter full navigation and search without silently entering that scarce promoted set.
- Every manual page declares one purpose: `tutorial`, `guide`, `explanation`, `reference`, or `troubleshooting`. Purpose controls its authoring question and quantitative prose posture. Reference remains exact and uses canonical technical terms; it is not held to a human reading-grade ceiling.
- The public site also renders a separately framed, safely admitted view of discern's live Map as a trust exhibit. Public contributor tiers may appear there. `_internal`, `_private`, explicitly withheld pages, and other protected material do not. The exhibit is linked from trust or transparency context and never joins the manual's default journey, navigation, or search.
- Marketing pages create interest, the manual teaches and explains, reference supplies exact contracts, and the public Map supplies inspectable evidence. Commercial value may follow from all four, but they do not share one writing assignment.
- Human-facing manual drafts start from live product behavior and the technical feature entry, use the generated plain account for coverage rather than verbatim copy, use the Human Benefit Canon to select the human value, and follow the register bridge into product voice. Representative explanation and guide pages receive the maintainer's edit before broad agent drafting.
- Gate protection follows page purpose. Per-kind checkpoints ask the authoring agent whether the intended reader can understand or complete the page's promise. Manual prose measures are separate from the Map's prose posture; reference is excluded from readability ceilings. A protected front-door count prevents silent re-expansion, and a canonical mapping requires selected Human Benefit Canon obligations to retain a live guide or explanation home.
- Human comprehension remains an owner-held launch judgment. The repository records the questions and uses checkpoints to make authors pause over them, but no model-dependent evaluation enters the offline Gate. Later periodic human or agent-proxy evaluations may add evidence without becoming deterministic Proof.

Migration is staged. Existing routes receive one-hop redirects. During construction, the old public projection may remain live until the dedicated manual is complete enough to cut over atomically. After cutover, the Map and manual may link to one another, but neither silently becomes the other's publication source.

## Consequences

- Human readers receive an authored path instead of a filtered implementation inventory, while external agents retain complete exact documentation through the same canonical manual.
- The Map can stay comprehensive for its working readers and gains a clearer public role: evidence of dogfooding and inspectable agent understanding rather than accidental onboarding material.
- Two authored corpora can discuss the same product. Their jobs must remain distinct: the Map records codebase understanding; the manual teaches product use. Mechanically derivable reference stays generated from live registries, and benefit, route, publication, and parity guards expose drift between the two.
- The source tree, binary build, site loader, terminal and MCP readers, prose tooling, generated reference destinations, tests, and planned Docs Studio all need migration. Docs Studio cannot implement its earlier Map-as-manual assumption and must receive a replacement brief after this architecture lands.
- Promotion becomes explicit curation. Adding a supported page stays cheap; adding another default destination consumes a guarded budget and requires judgment.
- The public Map route adds a second documentation-shaped website family, so its framing, admission, sitemap behavior, link rewriting, and search separation need forcing-function tests.
- The migration costs more than another editorial pass. It removes the structural conflict that caused repeated editorial passes to leave the human problem intact.

## Alternatives considered

- **Keep one physical tree and add `kind` plus surface-specific projections.** Rejected because metadata can change navigation but not resolve the authoring conflict: the same page would still need to be both an internal Map account and a novice human explanation.
- **Rewrite the Map itself for human approachability.** Rejected because it would make the primary A1/H1 working artifact less useful and weaken the product's own dogfooding discipline.
- **Remove the Map from public view.** Rejected because it would discard the only live exhibit of the promise that humans can inspect what their agents understand.
- **Create website-owned documentation copy.** Rejected because the website, installed binary, MCP, raw Markdown, and terminal would drift; one manual source must continue to feed them all.
- **Publish the generated plain feature canon as the manual.** Rejected because an exhaustive catalogue is not a learning path, and mechanical plain-language substitutions can be less clear than established technical terms.
