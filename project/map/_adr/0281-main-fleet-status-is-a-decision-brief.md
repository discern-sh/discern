# ADR 0281: Main fleet status is a decision brief

> **Presentation amendment (2026-08-21):** The brief now leads with main checkout state, displays human task labels instead of generated branch and worktree identities, and separates **Owner attention**, **Landing risks**, and **Next action**. Collision remains pairwise landing evidence and never replaces a task's state. Live, stale, and uncommitted lifecycle states precede branch lag. Published CLI Components render every visible block. **DRIFT** retains complete ahead/behind arrows and counts, with semantic color as reinforcement. These rules supersede the numbered order and collision-as-row-state wording below; `--verbose` retains complete Git identities and paths.

**Status**: accepted. Refines the human projection in [ADR 0255](0255-status-is-a-measured-responsive-dashboard.md).

## Context

The main-checkout `discern status` dashboard is the fleet supervisor view. It once rendered every available presentation of the same fact in one default report: a fleet summary, an attention card per worktree, collision cards with path samples, the fleet table, a second evidence and Proof card per worktree, next steps, checks, local environment, and the last landing. Six colliding worktrees could therefore produce hundreds of lines before the operator reached the action.

The information was valid, but the repetition obscured the fleet state. A default status read usually needs to answer which workstreams exist, which need attention, and what the operator can do next. Complete collision paths, activity histories, configured-check inventories, landing receipts, and stored Proof pages remain valuable when investigating one of those answers.

The local worktree view has a different job. It guides the active effort and should continue to show its detailed evidence. `status --all` is also an explicit request to expand a local view with fleet context.

## Decision

From the main checkout, `discern status` defaults to a bounded decision brief:

1. fleet state and counts;
2. one classified row per active worktree;
3. the main checkout state;
4. the valid next actions.

The brief does not render the attention section, the detailed card beneath every fleet row, configured checks, local environment, landing history, or stored Proof pages. The fleet summary and row classifier still expose broken, unreadable, failed, colliding, behind, running, ready, stale, dirty, and idle states, so omission of repeated evidence does not turn an unsafe state into silence. The main checkout retains its own Git fact.

`discern status --verbose` expands the same observed result with attention diagnostics, collision and ADR paths, per-worktree Git, Proof, activity and authority evidence, configured checks, local environment, landing history, and complete stored Proof pages. It performs no second collection. `--verbose` is the investigation and copy-ready evidence surface, not a compatibility mode.

The detailed local worktree view remains the default outside the main checkout. `--all` continues to add the fleet to that view without silently changing its local-detail contract. JSON, Markdown, MCP, and the status resource are governed by the result-format projection contract in [ADR 0280](0280-authored-markdown-result-presentations.md), not by terminal verbosity.

## Consequences

- A routine fleet read is proportional to the number of worktrees instead of the number of worktree, collision, and evidence combinations.
- The operator sees the next actions at the end without first crossing repeated Proof and collision detail.
- Investigations add one explicit `--verbose` flag and receive the complete human evidence that previously appeared by default.
- Existing structured consumers do not lose fields. The change is confined to the human projection.
- Tests hold both sides of the split: default main output omits expanded sections, while verbose output proves those facts remain available.

## Alternatives considered

- **Keep every section and improve headings.** Rejected because clearer labels do not remove repeated evidence or shorten the path to the action.
- **Truncate each attention and Proof card.** Rejected because six bounded cards plus collision pairs still grow quickly, while truncation weakens an investigation surface.
- **Remove the detailed evidence entirely.** Rejected because collision paths, Proof pages, and landing history are useful for diagnosis and review.
- **Apply the compact brief to local worktree status.** Rejected because the active effort needs its own detailed state and authority evidence without another flag.
