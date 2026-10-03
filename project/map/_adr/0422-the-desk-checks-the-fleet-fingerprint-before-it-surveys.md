# ADR 0422: The Desk checks the fleet's fingerprint before it surveys

**Status**: accepted; amends the refresh cadence [ADR 0415](0415-the-desk-is-an-inbox-on-the-application-runtime.md) gave the Desk

## Context

The Desk surveyed the whole fleet five seconds after each survey finished, whether or not anything had changed. A survey is the `status` core over every checkout. Over a scratch fleet of 15 tasks, each survey spawned 258 Git processes and spent 1.8 seconds of the Desk's own CPU, eight times a minute: 34 Git processes a second and a quarter of a core while the owner looked away. An owner's Desk left open for fourteen hours spent nearly two CPU-hours that way.

Most of that work re-read facts that hadn't moved. A survey's inputs are few in kind: Git registrations, refs and HEADs; each checkout's working-tree changes; discern's records under the Git administration directory; a few ignored files; and the clock.

## Decision

**The cadence checks before it surveys.** A [fleet fingerprint](../../../src/engine/status/fleet_fingerprint.ts) digests everything a survey reads except the clock. It runs one Git process per checkout plus two: `git worktree list`, `git for-each-ref`, and each checkout's `git status`, plus a few hundred file stats. A retired checkout path is read through the same bounded inspection status reports a reappeared path from. Each survey records the fingerprint taken just before it reads. When the cadence comes round, the Desk reads the fingerprint again. Unchanged, it adopts the last survey again as of the check: a running verb's clock counts on from where the survey read it, and the rest of what it shows is derived from the clock afresh, so a check changes nothing on screen. Changed, it surveys at once, still within the five-second cadence.

**What the fingerprint watches is declared where state is declared.** Each [`GIT_ADMIN_STATE`](../../../src/shared/git_admin_paths.ts) entry names its `changeProbe`: watched by its contents (state written in place), by its entries (record stores written by rename), through the records that address it (content-addressed documents), or not at all (state status never reads). The [fingerprint guard](../../../tests/engine_fleet_fingerprint_test.ts) records every path a real survey of its fixture reads and fails, naming them, when one falls outside what the fingerprint watches. It sees only the reads the fixture's states trigger, so the fixture holds one of each kind of state a survey reads, a reappeared checkout path among them. Every watched entry must move the fingerprint when written, and every unwatched one must leave it alone.

**A survey still runs when a check can't vouch for one.** The Desk surveys instead of checking when:

- it has no survey yet, or no fingerprint to compare;
- the last read failed;
- a child returned or a new task waits to be selected;
- the owner asks with `r`;
- an operation the Desk runs ends, or still runs;
- a run of a verb that changes discern's state, a landing, or the calling checkout's own operation is under way;
- the adopted survey is a minute old.

The minute ceiling covers what the clock alone changes: a task turning stale after days idle, a quiet period ending, a release check falling due. A running Desk session itself, an agent, or a project command changes discern's state only through files the fingerprint watches, so it doesn't count as a run under way.

**A check is part of being Live.** The header says Refreshing only while a survey reads.

**No read takes a lock.** The fingerprint's `git status` runs without optional locks, so a background check never holds the index lock a commit in that checkout needs.

## Consequences

- Idle over the same 15-task fleet, the Desk now spends a check about every five seconds and one survey a minute. That comes to about 430 Git processes and 2.8 seconds of CPU a minute, against 2,060 and 14 before. A Desk test holds the idle minute to 11 checks, 1 survey and no terminal writes, and shows a commit on the next cadence.
- The ceiling's survey is now most of the idle cost. Raising it trades CPU against how late a clock-driven fact appears.
- A new status input outside the watched set fails the guard until the fingerprint watches it, once the fixture holds a state that reads it. A new kind of state therefore needs a fixture member too. A record store written in place under an `entries` declaration would escape the guard; such stores write by rename, and their declaration says so.
- Clock-driven facts, such as staleness, can appear up to a minute late, where they appeared within one cadence before.

## Alternatives considered

- **Filesystem events.** Watching the checkouts and the Git directory would make an idle Desk free. Recursive watches on large trees exhaust Linux's limits, a survey's own index refresh would wake it, and a deterministic test would need a fake watcher anyway. Polling a fingerprint costs a little and behaves the same everywhere.
- **A cheaper survey on the same cadence.** Deduplicating Git reads inside a survey and caching results keyed by commit IDs would cut a survey by perhaps a third. That still repeats the whole survey eight times a minute when nothing changed.
- **A longer cadence.** Rejected: a real change would take longer to appear.
