# ADR 0183: Agent task search uses an audience-specific ranker

**Status**: accepted; refines the shared search matcher in [ADR 0174](0174-agent-document-discovery-funnel.md).

## Context

ADR 0174 gave the docs site, `discern map`, and `discern help` one weighted full-text matcher over audience-specific document projections. The matcher requires every whitespace-separated term to occur in one document. That suits the browser palette and exact commands, config keys, and error text.

The MCP input contract also invites task language. A task can name concepts owned by several map pages, so no document contains every term even when the corpus contains all of the useful evidence. One broad overview can also satisfy every term while focused pages disappear. The whole-query metadata fallback cannot recover either case. Replacing conjunction with partial-word OR would admit noise: a short term such as `AI` also occurs inside unrelated words.

The site search is a launched human-facing contract. Changing it to solve an agent retrieval problem would couple 2 audiences with different query habits.

## Decision

Search field extraction and weights stay shared. The browser keeps the strict `searchPages` matcher. Map and help use `searchAgentPages`, an agent-specific ranker over the same admitted records:

- Natural words match lexical tokens, with bounded singular/plural equivalence. Technical phrases retain literal syntax.
- Complete matches lead. When fewer than 5 complete documents qualify, partial candidates may fill the remaining result slots if they cover at least 35% of the meaningful terms and meet the query-length-scaled minimum.
- Partial ordering rewards weighted field strength and terms not covered by an earlier partial, so one result set can span several subsystems.
- An exact technical phrase, or an exact phrase in a title, alias, heading, or code field, keeps high-precision behavior and returns phrase matches only.
- Results identify their match as `complete`, `partial`, or `metadata`. Metadata typo recovery requires at least 4 characters.

CLI and MCP calls continue through the same map/help result core. Admission, scopes, local-only execution, the 5-result public limit, and private ranking scores stay unchanged.

There is no embedding index, network search, synonym registry, or browser behavior change.

## Consequences

- An agent can submit the task it was given and receive complementary map pages even when no page covers the whole task.
- Exact technical lookup keeps its previous precision. Short lexical terms no longer match inside unrelated words or produce edit-distance guesses.
- The browser and agent surfaces now have separate ranking policies. Shared extraction and weights prevent field drift; audience-specific tests pin each policy.
- A partial result says so in terminal, JSON, and MCP output. Callers can distinguish useful coverage from a complete match without seeing internal scores.

## Alternatives considered

- **Teach agents to send several short searches.** Rejected because the tool contract invites task language, and every caller would have to rediscover the query planner.
- **Change the shared matcher to soft OR.** Rejected because it would retune the browser palette and admit weak partial-word matches.
- **Relax only after zero results.** Rejected because 1 or 2 broad complete pages can still hide focused pages that would use the remaining slots.
