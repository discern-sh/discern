# ADR 0199: The gate ships the map-integrity preflight, scoped to domain-neutral rules

**Status**: accepted

## Context

[ADR 0146](0146-docs-integrity-gate-and-generated-cli-reference.md) made doc drift a build failure — but only here. The scanners (`extractDocLinks`, `headingAnchors`, `validateFencedCommand`, `validateFrontmatter`) shipped in the binary under `src/lib/`, while their only application lived in this repository's own `tests/`: dogfood-only enforcement. An end-user project could carry dead links, stale fenced `discern` examples, metadata blocks the lenient reader silently swallows, published pages linking into `_internal/`, and guidance recommending a skill that `[skills].exclude` removed — and `discern done` would stay green. Pre-launch is the cheap moment to close that gap strict: there is no installed base to migrate.

Shipping raised a boundary question the repo tests never had to answer: which rules are core map discipline, and which are this repository's own house style? Much of the strict frontmatter schema was added for the discern.sh site — `order` reorders help articles there, `redirect_from`/`aliases` are its routing and search machinery, and the title/description length bounds are its nav and SEO style. End-user projects also legitimately carry third-party frontmatter (site-generator keys such as `layout` or `sidebar_position`) that a closed schema would fight. And the repo test's published-tier predicate leaned on `BUNDLED_PUBLIC_DOC_DIRS` — the registry of discern's OWN manual sections, meaningless for an arbitrary project's map.

## Decision

`discern done` runs a **map & guidance integrity preflight** in every project — a blocking fail-fast precondition (`failed_stage: "map_integrity"`) beside the currency checks, with no warn tier and no configuration knob, exactly like the other artifact preflight checks. The core is pure — `checkDocsIntegrity(root, config, cli) → findings` in `src/lib/map_integrity.ts` — and one diagnostic groups every finding as `file:line` under its rule with the rule's remedy stated once.

**Corpus.** The configured map's current tree — non-`_` subtrees plus root docs, discovered live via the document model — plus the `[guidance].sources` files. The `_` trees stay exempt (dated records; no currency contract). Guidance sources are prose, not pages: they get the fenced-command and skill-citation checks only — explicitly **no** frontmatter, link, anchor, or audience checks there. The shipped-corpus guard over `templates/` (`tests/guidance_corpus_guard_test.ts`) is a different corpus with the opposite project-script policy and stays untouched.

**Rules shipped, and their deliberate escapes:**

1. **Links and anchors** — every intra-map link resolves; every fragment names a heading id the shared renderer mints. Root-relative targets (`/x`) are treated as external, like scheme-prefixed URLs: a map published to a site legitimately uses site-absolute routes the checkout cannot resolve.
2. **Frontmatter** — the domain-neutral shape tier only (`frontmatterShapeIssues`): a block that opens `---` but is broken (unterminated, invalid YAML, non-mapping), or a recognised key whose value the lenient reader would silently drop. Explicitly **not** shipped: unknown-key rejection (third-party frontmatter is legitimate), title/description length bounds, duplicate sibling `order`s, and the redirect registry — all discern.sh house style, held repo-locally by `tests/map_frontmatter_test.ts` over the same per-key shape rules (strict = neutral + extras; one definition per rule).
3. **Fenced `discern …` examples** — validated against the live command model, with Project Scripts enrolled as extra verbs from the configured scripts directory.
4. **Audience boundary** — a published page must not link into `_internal/` or `_private/`. "Published" is `isPublicDoc` over the corpus — the page-level `publish:` flag, the exact admission set of the shipped user-facing projections (`discern map --export public` filters through it and excludes the `_` trees; default map browsing hides them too). `BUNDLED_PUBLIC_DOC_DIRS` is NOT consulted: that tier axis classifies discern's own manual, not user maps. The sanctioned escape is `publish: false` — a page that must link inward declares itself internal-facing.
5. **Skill citations** — a citation must name a skill in the effective set (`resolveEffectiveSkills`, so `[skills].exclude` bites: an excluded skill cannot stay recommended by live prose). The false-positive escape for arbitrary user prose is structural, not a list: only an inline code span consisting **solely** of a grammar-shaped token (`` `discern-<verb>-<object>` ``, two-plus segments) counts, outside fenced blocks. A span carrying more than the token, a fenced example, a bare mention outside a code span, and a single-segment name are spellings, never citations — precision over recall, so no per-project exception map is needed. Explicitly **not** covered: citations of arbitrarily-named authored skills (undetectable by grammar).

The CLI model is built lazily inside the preflight via a dynamic import of the command registry, keeping the command tree off every other verb's load path. The repo's corpus tests become thin layers over the shipped core (`tests/map_integrity_test.ts`: the live-corpus run plus per-rule bite proofs); the wider bare-token citation sweep over `src/` and `templates/` stays repo-local in `tests/skill_name_parity_test.ts`, sharing the grammar's single source.

## Consequences

- Every installed project now gets the protection this repo had: a defect a reader would only find by following a broken reference fails `discern done` with a diagnostic an agent fixes in one loop. `discern refresh` can never clear this stage — the source files carry the defect.
- The gate pays one map read per `done` (milliseconds on realistic maps) plus one lazy CLI-model build.
- The neutral/strict split is now load-bearing: a new frontmatter key's shape rule lands once and both tiers inherit it; a new house-style bound lands in the strict tier only. Loosening either requires touching this record.
- A published page in any project may no longer link into the internal trees, including this repo's contributor-tier sections (stricter here than the old repo test, which was tier-scoped). The escape is page-level and costs nothing where the tier already withholds the page.
- Citation checking is deliberately blind to plain prose mentions; the convention every bundled surface teaches (wrap the skill name in a code span) is now also what makes a recommendation checkable.
