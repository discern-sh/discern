# ADR 0403: The site map is a directory of repository sources

**Status**: accepted on 2026-09-15. Amends [ADR 0314](0314-separate-public-manual-and-project-map.md).

## Context

The product manual now gives external readers a dedicated learning and reference surface. The project map serves agents and maintainers working on discern itself. Its entries change and move with the codebase; publishing each entry as another website page creates a large, unstable URL surface that the owner does not want to maintain for launch.

## Decision

The website keeps one `/map` overview. It lists the same admitted sections and entries in their canonical order, with each destination derived from the repository URL authority and the Markdown source path. The overview has a brief introduction, the live-project-exhibit notice, and the shared public navigation. It has no document sidebars, collapsed directory, or search endpoint.

Individual map HTML and raw endpoints are absent from the route inventory and sitemap. These pre-release routes return 404 without claiming historical redirects. Manual and decision routes retain their contracts. The map root's raw edition remains the pristine configured README, while the browser overview has its own presentation.

The publication predicate still excludes protected directories, unregistered tiers, and explicitly withheld pages from the directory. Repository visibility is managed separately by the owner.

## Consequences

The public site keeps a focused route surface while readers can inspect the agents' working account in GitHub. A new admitted map entry adds a directory link without adding a site endpoint. Repository readers receive GitHub's Markdown presentation and navigation; website search covers the product manual. Publishing individual map pages later requires a new explicit URL and presentation decision.
