# ADR 0225: Contained-worktree reclaim is offer-only and keeps the branch ref

**Status**: accepted. Extends the landing model of [ADR 0110](0110-the-landing-model.md) and the prune housekeeping it composes with. Bounded by [ADR 0160](0160-local-logbook-advisory-readers.md)'s advisory-only readers and [ADR 0210](0210-effectful-verb-starts-are-paired-logbook-events.md)'s begin events. The receipt consequence follows [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md)'s per-worktree state lifetime.

## Context

The landing model composes work below the trunk. Stage two forks from stage one's branch, stage three from stage two's, and only the final stack lands. Each finished stage stops, but its worktree stays — nothing before the last stage crosses the trunk. A deep train therefore carries every spent checkout to the end. `worktree prune` reclaims stale metadata and fully **landed** branches. It had no concept of "this worktree's work is complete and travels inside a sibling". The fleet survey and the disk therefore filled with dormant checkouts nobody could safely remove by hand.

Git can prove that concept cheaply. When a worktree's branch tip is a strict ancestor of another live local branch's tip, every commit it holds already travels inside that branch. The checkout is redundant, and the branch ref is cheap insurance. But the stakes differ from the landed-branch prune. A landed branch's work is on the trunk — deleting its remains loses nothing. Contained work is **unlanded**. The proof is a snapshot, the containing branch can be rewritten or abandoned tomorrow, and the only cheap recovery is the ref. Treating the two classes alike would let routine housekeeping destroy the sole local pointer to unlanded commits.

Two standing boundaries shape the design. Logbook readers advise and never gate, so recorded history may make an offer more conservative but can never decide an action. And per-worktree admin state — the gate receipt included — lives inside git's own worktree admin directory and dies with the checkout. Removing a worktree therefore affects anything that reads that state, `await --green` first among them.

## Decision

**`worktree prune` and the desk detect contained worktrees and offer the reclaim. Only a fresh, explicit human confirmation executes it, and the branch ref is never deleted on this path.**

A worktree is _contained_ when every clause holds:

- Its branch tip is a **strict** ancestor of another live local branch's tip. Equal tips are ambiguous twins, not containment.
- Its working tree is clean. Staged, modified, or untracked work disqualifies — no container can hold uncommitted work.
- It is **idle**. With the logbook on, no verb is in flight per the paired begin/finish events. With it off, a conservative git-derived quiet period holds: one hour, the same floor as the logbook's minimum in-flight horizon.
- It is neither the main checkout nor the checkout running the scan.

One module owns the predicate, so prune, `status`, and the desk cannot disagree. In a train, the container reported is the **nearest** live descendant. The offer carries tip hashes and the container's ahead-count — evidence a human can check, not a bare name.

The offer is always visible when candidates exist: a labelled section of the prune plan, an advisory fact on the fleet row, a marked desk row. The default apply skips it. Reclaiming requires the explicit opt-in — `worktree prune --contained` plus the ordinary confirmation, or the per-worktree desk action. Every confirmation names what the reclaim keeps (the branch ref) and what it destroys (the checkout and its per-worktree state, gate receipt included). Apply re-validates each candidate immediately before acting, the same discipline as the stale-worktree removal.

The reclaim runs the same teardown lifecycle acceptance uses. External resources die through their ledger commands, then the registration goes — never a raw `git worktree remove`. The ref survives as the recovery guarantee and needs no new cleanup machinery. Once the train lands, the existing landed-branch prune deletes it as ordinary fully merged history.

The explicit *no*s: no automatic or scheduled reclamation, and no configuration key or standing grant that authorizes it. This is deliberately not a place for pre-authorization — the predicate is a heuristic over a moving fleet, and a false positive would cost unlanded work its checkout. No ref deletion, ever, on this path. No logbook verdicts. Recorded history only narrows the offer (an in-flight begin withholds a row), and a logbook-off install gets the full feature with the weaker git-derived idle signal.

## Consequences

- A long integration train tidies as it goes. The prune output names and evidences each spent stage, and one confirmed action reclaims them instead of letting checkouts accumulate until the final landing.
- Reclaiming destroys the stage's gate receipt with its checkout, so a sibling's `await --green <stage>` can never succeed afterwards. The verb now refuses honestly at call start when no checkout holds the branch. It points at the nearest containing branch — the correct await target all along — with `--landed` for the literal arrival question.
- Keeping refs means `status` shows unlanded `agent/*` branches with no worktree until the train lands. That is the honest state — the refs **are** the recovery path — and they self-clean through the existing prune on landing.
- The offer costs ancestry reads per fleet survey. The fleet is small by construction, and the scan short-circuits on every disqualifying clause, so the cost stays trivial next to the per-row git snapshots the survey already pays for.
- A reclaimed checkout cannot come back. Recovery is `start --from <branch>`, which provisions resources fresh. The confirmation carries that weight, which is exactly why no configuration can stand in for it.

## Alternatives considered

- **Auto-reclaim once containment holds.** Rejected. Ancestry proves the commits travel; it cannot prove nobody is about to resume work in the checkout. Idleness is a heuristic — the logbook may be off, or an agent may return tomorrow — and a wrong automatic reclaim silently destroys a provisioned workspace and its receipt. The stakes are unlanded, so a human stays in the loop per action.
- **Delete the branch ref along with the checkout.** Rejected. The ref is the recovery guarantee and the cheapest possible insurance. Deleting it turns the reclaim into an irreversible discard the moment the containing branch is rewritten. Ref deletion stays the landed-branch path's job, where the trunk already holds the work.
- **Treat contained worktrees as ordinary prune candidates (one flag, one class).** Rejected. The landed class is safe by proof — the trunk contains the work. The contained class is safe only by heuristic over a moving target. Folding them together would either weaken the landed path with confirmations it does not need or extend its silence to a class that needs consent.
