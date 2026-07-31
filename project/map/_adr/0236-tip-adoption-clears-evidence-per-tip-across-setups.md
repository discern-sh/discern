# ADR 0236: Tip adoption clears evidence per tip across comparable setups

**Status**: accepted. Extends [ADR 0234](0234-tips-are-the-desks-human-advisory-channel.md)'s cross-surface measurement contract, [ADR 0207](0207-hint-follow-through-is-declared-and-episode-based.md)'s episode model, and [ADR 0224](0224-trend-comparability-is-setup-equality.md)'s setup grouping.

## Context

A tip reaches a person at the desk, while the invited action may come from that person or from an agent they direct. Branch, session, and invocation surface therefore identify no useful correlation boundary. Treating them like hint correlation would miss the normal adoption path.

The tip registry groups declarations into measurement families, but members of one family invite different verbs. The useful question is whether each piece of advice lands. Pooling three resolved episodes across several tips would let a collection of one-off observations clear the evidence bar even though no individual tip had enough history to support a finding. A larger curriculum would then make sparse tips speak sooner.

The shared logbook also interleaves events written under several configurations and releases. A position-based boundary would fragment a setup when worktrees append in parallel. Missing writer or config evidence cannot establish whether a later action belongs to the showing that preceded it.

## Decision

`tip-adoption` derives its families, members, and invited verbs from `TIPS`. It keeps one episode population per declaring tip.

A recorded showing opens an episode. A later run of any verb that tip declares resolves it as followed on any branch, session, or surface. The next showing of the same tip without an intervening declared run resolves it as not followed and opens the next episode. The end of retained history censors the open episode.

Correlation requires setup equality: config epoch, discern writer release, and the dominant MCP client's version in effect. Relevant events under another setup do not resolve the episode; a later event under the original setup can re-enter it. A relevant event missing a required setup field censors the episode. CI runs, previews, and setup-branch events stay outside the shared analysis population.

Each tip needs three resolved episodes before it produces a finding. Resolved counts do not pool across members of a declared family. The detector-level `considered` count is the largest per-tip resolved population, so the registry runner's single threshold remains truthful as the inventory grows.

Findings are batch, project-scoped behavior findings. Each reporting tip carries raw `fired`, `followed`, `not_followed`, and `censored` counts. A tip with no not-followed episode carries favorable tone. Within a declared family, every row shares one next step. When any row has not-followed evidence, the step names the reporting tip with the largest not-followed count and asks the owner to reword or retire it. An all-followed family keeps its strongest-evidence tip in rotation. This choice changes presentation only.

The explicit noes: no detector-side tip table, no branch/session/surface restriction, no pooled threshold, no unresolved episode counted against a tip, and no enforcement effect.

## Consequences

- A person can adopt a tip by running the verb or by asking an agent to run it; both paths produce the same episode outcome.
- Adding declarations widens measurement without changing when existing tips clear the evidence bar.
- Favorable and unfavorable advice remains visible in the same raw-count vocabulary.
- Conservative setup correlation delays findings when older events lack fields. It does not turn gaps into evidence against the wording.
- One family can produce several rows. The report still prints one family-level next step, naming the tip to review first.

## Alternatives considered

- **Pool resolved episodes within the declared family.** Rejected because a larger registry would let individually sparse tips clear the bar together.
- **Reuse hint correlation.** Rejected because the person at the desk commonly delegates the action to an agent on another branch or surface.
- **Treat the newest setup as a contiguous window.** Rejected because worktree events interleave; setup equality preserves comparable re-entry.
- **Count missing or trailing evidence as not followed.** Rejected because the absence of an event that can be correlated does not show that the advice was ignored.
