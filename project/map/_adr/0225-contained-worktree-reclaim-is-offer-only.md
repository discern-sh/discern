# ADR 0225: Contained-worktree reclaim is offer-only and keeps the branch ref

**Status**: accepted; extends the landing model of [ADR 0110](0110-the-landing-model.md) and the prune housekeeping it composes with; bounded by [ADR 0160](0160-local-logbook-advisory-readers.md)'s advisory-only readers and [ADR 0210](0210-effectful-verb-starts-are-paired-logbook-events.md)'s begin events; consequence shaped by [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md)'s per-worktree state lifetime

## Context

The landing model composes work below the trunk: stage two forks from stage one's branch, stage three from stage two's, and only the final stack lands. Each finished stage stops, but its worktree stays — by design, since nothing before the last stage crosses to the trunk — so a deep train carries every spent checkout to the end. `worktree prune` reclaims stale metadata and fully **landed** branches; it has no concept of "this worktree's work is complete and travels inside a sibling", so the fleet survey and the disk fill with dormant checkouts nobody can safely remove by hand.

Git can prove that concept cheaply: when a worktree's branch tip is a strict ancestor of another live local branch's tip, every commit it holds is contained in that branch. The checkout is redundant; the branch ref is cheap insurance. But the stakes differ from the landed-branch prune. A landed branch's work is on the trunk — deleting its remains loses nothing. Contained work is **unlanded**: the proof of containment is a snapshot, the containing branch can be rewritten or abandoned tomorrow, and the only cheap recovery is the ref. Treating the two classes alike would let routine housekeeping destroy the sole local pointer to unlanded commits.

Two standing boundaries shape the design. Logbook readers advise and never gate, so recorded history may make an offer more conservative but can never decide an action. And per-worktree admin state — the gate receipt included — lives inside git's own worktree admin directory and dies with the checkout, so removing a worktree has consequences for anything that reads that state, `await --green` first among them.

## Decision

**`worktree prune` and the desk detect contained worktrees and offer the reclaim; a fresh, explicit human confirmation is the only thing that ever executes it, and the branch ref is never deleted on this path.**

A worktree is _contained_ when every clause holds: its branch tip is a **strict** ancestor of another live local branch's tip (equal tips are ambiguous twins, not containment); its working tree is clean — staged, modified, or untracked work disqualifies, because uncommitted work is not contained anywhere; it is **idle** — no verb in flight per the logbook's paired begin/finish events when the logbook is on, and a conservative git-derived quiet period (one hour, the same floor as the logbook's minimum in-flight horizon) when it is off; and it is neither the main checkout nor the checkout running the scan. One module owns the predicate, so prune, `status`, and the desk cannot disagree. In a train, the container reported is the **nearest** live descendant, with tip hashes and the container's ahead-count carried as the evidence a human confirms against.

The offer is always visible when candidates exist — a labelled section of the prune plan, an advisory fact on the fleet row, a marked desk row — but the default apply skips it. Reclaiming requires the explicit opt-in (`worktree prune --contained` plus the ordinary confirmation, or the per-worktree desk action), and every confirmation names what is kept (the branch ref) and what is destroyed (the checkout and its per-worktree state, gate receipt included). Apply re-validates each candidate against live state immediately before acting, the same discipline as the stale-worktree removal.

The reclaim itself runs the same teardown lifecycle acceptance uses — external resources destroyed through their ledger commands, then the registration removed — never a raw `git worktree remove`. The ref survives as the recovery guarantee and needs no new cleanup machinery: once the train finally lands, the existing landed-branch prune deletes it as ordinary fully-merged history.

The explicit *no*s: no automatic or scheduled reclamation, and no configuration key or standing grant that authorizes it — this is deliberately not a place for pre-authorization, because the predicate is a heuristic over a moving fleet and its false positives cost unlanded work its checkout. No ref deletion, ever, on this path. No logbook verdicts — recorded history only narrows the offer (an in-flight begin withholds a row); a logbook-off install gets the full feature with the weaker git-derived idle signal.

## Consequences

- A long integration train tidies as it goes: spent stages are named, evidenced, and reclaimable in one confirmed action, instead of accumulating until the final landing.
- Reclaiming destroys the stage's gate receipt with its checkout, so a sibling's `await --green <stage>` can never be satisfied afterwards. The verb now refuses honestly at call start when no checkout holds the branch and points at the nearest containing branch — which was the correct await target all along — with `--landed` for the literal arrival question.
- Keeping refs means `status` shows unlanded `agent/*` branches with no worktree until the train lands. That is the honest state — the refs **are** the recovery path — and they self-clean through the existing prune on landing.
- The offer costs ancestry reads per fleet survey. The fleet is small by construction, and the scan short-circuits on every disqualifying clause, so the cost stays trivial next to the per-row git snapshots the survey already pays for.
- A reclaimed checkout cannot be un-reclaimed: recovery is `start --from <branch>`, which re-provisions resources fresh. The confirmation carries that weight, which is exactly why it is never delegated to configuration.

## Alternatives considered

- **Auto-reclaim once containment is proven.** Rejected. Ancestry proves the commits travel; it cannot prove nobody is about to resume work in the checkout. Idleness is a heuristic (the logbook may be off; an agent may return tomorrow), and a wrong automatic reclaim destroys a provisioned workspace and its receipt silently. The stakes are unlanded, so a human stays in the loop per action.
- **Delete the branch ref along with the checkout.** Rejected. The ref is the recovery guarantee and the cheapest possible insurance; deleting it makes the reclaim an irreversible discard of unlanded history the moment the containing branch is rewritten. Ref deletion stays the landed-branch path's job, where the trunk already holds the work.
- **Treat contained worktrees as ordinary prune candidates (one flag, one class).** Rejected. The landed class is safe by proof (the trunk contains the work); the contained class is safe by heuristic against a moving target. Folding them together would either weaken the landed path with confirmations it does not need or extend its silence to a class that needs consent.
