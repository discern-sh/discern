# ADR 0315: The Desk adapts status into one complete human decision

**Status**: accepted; extends the Desk in [ADR 0119](0119-bare-discern-opens-the-operators-desk.md), consumes the Fleet row projection from [ADR 0255](0255-status-is-a-measured-responsive-dashboard.md), and preserves the landing-risk separation from [ADR 0281](0281-main-fleet-status-is-a-decision-brief.md).

## Context

The Desk originally classified worktrees from a small subset of Git facts and rendered a compact summary such as `Awaiting gate · 2 files changed · now`. It ignored live and failed operations, the complete Proof inspection, landing authority, and collision evidence already carried by `status`. Its action table also offered Accept for any clean branch with commits, even when the same row reported that the branch was behind the trunk and the lifecycle core would refuse the landing.

`status` now has one closed Fleet row-status vocabulary and one precedence point for broken, unreadable, failed, blocked, running, stale, dirty, behind, Proof, ready, and idle work. The Desk needs a coarser answer to a different question: what decision does a supervisor face, and which available action addresses the next observed condition? Repeating status precedence in the Desk would create two meanings for the same survey.

The action menu and later renderers also need disabled reasons, recommendations, Proof, authority, and collision facts. If each renderer derives those independently from raw fields, a copy or layout change can silently alter behavior.

## Decision

**Status classifies each Fleet row; the Desk adapts that classification into one complete `DeskDecision`.** The Desk does not probe Git, Proof, authority, activity, or collisions and does not implement another row-status precedence.

- `presentFleetRow()` remains the canonical row classifier and compatibility adapter for the survey's complete `gate_proof` inspection. `DESK_STATE_BY_STATUS_KIND` exhaustively maps its closed kinds into `needs_attention`, `ready_to_review`, `working`, `paused`, or `empty`.
- Changed-file and ADR collisions remain pairwise landing evidence rather than status kinds. A collision can place an otherwise ready or working row in `needs_attention` while retaining its original status kind in the decision.
- `DeskDecision` carries the state, source status kind, short headline, ordered factual details, human-decision flag, landing readiness, typed Proof, authority and collision facts, every action offer, and at most one recommendation. Renderers arrange those fields; they do not reinterpret raw status.
- `DESK_ACTIONS` is the closed action vocabulary. Every decision contains every member exactly once as enabled or disabled. A disabled offer names one observed reason, and a recommendation can name only an enabled offer. A known positive behind count disables Accept and recommends Update.
- Capability facts that only the Desk discovers, such as Project Scripts and available agent launchers, affect action availability but never redefine status. Containment can recommend reclaim while retaining the status-derived state.
- The model is pure. Time, the trunk name, survey collisions, and Desk capabilities are inputs. Lifecycle cores still revalidate every mutation at execution time and remain authoritative when facts change after the survey.

The worktree picker consumes the same decision copy instead of retaining a second compact summary model.

## Consequences

- A new Fleet status kind, Desk state, or Desk action cannot enter unnoticed: exhaustive records and table tests require its mapping, copy metadata, availability, and fixtures.
- The Desk can distinguish live work, failed checks, stale work, Proof faults, readiness, and empty tasks without changing the status dashboard or duplicating its precedence.
- Action menus stop advertising known lifecycle refusals, while the lifecycle boundary still protects against races and conditions the survey could not observe.
- Collision evidence can change the human grouping without corrupting the row's underlying status meaning. Consumers can explain both facts.
- Decision copy and data are larger than the former one-line Git summary. Current renderers use a compact projection of the decision; later layout work can reveal more detail without adding state rules.
- The shared classifier currently lives in the status terminal-presentation module. If that dependency becomes costly, its non-rendering semantics may move to a neutral module, provided both status and the Desk continue to consume the same authority.

## Alternatives considered

- **Keep a Desk-specific status switch.** Rejected because the two precedence tables would drift as soon as status adds or reorders a kind.
- **Expose only enabled actions.** Rejected because absence has no reason, recommendations cannot be checked against a complete vocabulary, and later renderers would have to rediscover why an action is unavailable.
- **Let lifecycle refusal be the menu's availability test.** Rejected because a supervisory menu should not lead with an action already known to fail. Lifecycle revalidation remains necessary for races, not for ignoring observed blockers.
- **Make collisions a Fleet row-status kind.** Rejected because a collision is a relationship between branches, not the operating state of either worktree.
