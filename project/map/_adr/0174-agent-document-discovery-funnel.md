# ADR 0174: Agent document discovery is regions, search, then canonical targets

> **Amendments.**
>
> - **Vocabulary ([ADR 0218](0218-docs-owns-the-manual-help-owns-cli-reference.md)):** the manual tool ships as `discern_docs` (formerly `discern_help`); the decision below is unchanged.

**Status**: accepted; extends the shared document model ([ADR 0130](0130-docs-site-renders-the-help-tree.md)), self-describing MCP surface ([ADR 0041](0041-self-describing-mcp-surface.md)), and tracked compiled guidance ([ADR 0128](0128-enumerated-ownership-tracked-guidance.md)); agent ranking refined by [ADR 0183](0183-agent-task-search-uses-an-audience-specific-ranker.md).

## Context

`discern_map` could return the whole index or read a known page, but an agent that did not already know a slug had to fetch and inspect the full index. The generated guidance named the map without naming its regions, so the primary day-to-day user of the map was blind to its useful entry points. The public docs site already had effective weighted full-text search, but its implementation and policy lived on the site surface.

Copying the site's complete behavior into the engine would conflate audiences. The site searches published product guidance, excludes decision history, returns routes, and serves a human palette. The project map must expose the corpus an agent may inspect, including pages withheld from publication, and return targets suitable for another tool call. Listing every leaf in generated guidance would solve target discovery by making tracked agent files churn whenever any page was added or moved.

## Decision

**Agent document discovery follows a compact regions → search → read funnel.**

- `discern_map` and `discern_help`, plus their CLI counterparts, accept `search`. A top-level region is also an exact `target`: without `search` it returns that region's compact index; with `search` it scopes the query. A document target can scope search to one page.
- Search returns at most five ranked documents with a contextual snippet and a canonical `target` that can be passed back to the same surface. Ranking scores do not enter the public contract. No match is a successful empty result. Weighted full-text matching falls back to typo-tolerant document metadata only when full text finds nothing.
- Search extraction and ranking live under `src/lib/`. Code generation copies the authored matcher into the site's tracked browser module. The site keeps an audience-policy adapter that admits published guidance, strips human-only material, returns routes, and retains its twelve-result behavior. Map and help apply their own existing audience projections before indexing. The engine does not import the site.
- Search runs locally. Query values are not written to the logbook; the invocation may record only that the `search` flag was present.
- Compiled agent guidance lists each non-internal top-level map region by exact target and title. It does not list leaves, page counts, descriptions, or freshness. Adding or renaming a region, or changing its front-door title, changes generated guidance; other leaf changes do not. The renderer keeps the insertion slot internal: emitted agent files contain a plain Markdown list, while setup derives an ownership pattern that lets only the region payload vary when recognising one of its own surviving files. Every byte outside that slot must still match. A fresh setup recompiles after laying its starter map so the agent files are current when the command returns.
- `path` remains the project or worktree selector for an MCP call. `target` selects a region or document inside that project's admitted documentation corpus.

The canonical region set comes from the document model, so map overview, exact region targets, and generated guidance cannot maintain separate lists.

## Consequences

- An agent can begin with subsystem names already in its instructions, search using task language, and follow one returned target into the full page without downloading the full index.
- The public site's search behavior stays stable while improvements to the shared matcher can benefit every surface under cross-surface tests. Changing the matcher requires regenerating its tracked browser copy.
- Top-level information is duplicated into tracked agent guidance by design, but leaf growth does not cause regular generated-file churn.
- Each map/help search reads and projects the admitted Markdown corpus for that call. This favors current results and no index cache over lower per-call I/O.
- The shared matcher is now a compatibility point: field weights and site projection behavior remain pinned even if agent-specific fallback or result limits evolve.

## Alternatives considered

- **Duplicate the site matcher in the engine.** Rejected because ranking fixes would drift between two implementations.
- **Import the site search module from the engine.** Rejected because audience policy and web routes would flow in the wrong architectural direction.
- **List every map leaf in generated guidance.** Rejected because routine documentation growth would churn every tracked agent file and consume context before an agent needs it.
- **Use embeddings, a network service, or query telemetry.** Rejected because the corpus is local, lexical terms such as commands and error strings matter, and search does not need a new trust boundary.
- **Use `path` as the search subtree.** Rejected because `path` already selects another project or worktree; overloading it would recreate the ambiguity this change removes.
