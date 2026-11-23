# ADR 0432: Ignored directories are opaque to drift fingerprints

**Status**: accepted. Amends [ADR 0147](0147-ignored-drift-uses-bounded-hybrid-fingerprints.md).

## Context

Acceptance warns before removing a worktree when ignored files differ from its setup baseline. [ADR 0147](0147-ignored-drift-uses-bounded-hybrid-fingerprints.md) gave every root Git reports a metadata fingerprint. For a directory, that meant visiting every entry beneath it. The record accepted the cost: a large ignored tree paid one pass proportional to its entry count.

That choice assumed an entry lookup is nearly free. On a fast local disk it is: 120,000 entries took 1.8 seconds. On a checkout reached through a remote file protocol, one worktree's installed dependencies, 28,000 files, took 112 seconds. `discern start` paid that once and acceptance paid it again. `discern worktree drop` paid it twice, because the removal review binds to the same fingerprint and plans again under its lock.

The cost followed the largest directory a project ignores, and no project chooses that directory with discern in mind. The same directories also say the least. A dependency or build tree changes on every install or build, so its entry in the report is noise an owner learns to skip.

## Decision

The listing Git returns is the inspection boundary. In its `matching` mode, Git names a directory that an ignore rule covers as one root and does not descend into it. discern treats that root as opaque. Its fingerprint records that the directory exists. Nothing beneath it is listed or read: not at setup, not at acceptance, and not for a removal review.

Individually ignored files keep the comparison from ADR 0147. Each receives a metadata fingerprint, and the smallest are upgraded to content fingerprints within the aggregate budget of 16 MiB and 2,048 files. That budget no longer admits directories.

The baseline format moves to version 2. A version-1 baseline carries digests of directory contents, so it reads as missing and the next setup replaces it. It never reads as drift.

There is no entry budget and no per-path exclusion. `track_ignored_drift` stays on by default.

## Consequences

- Fingerprinting costs one lookup per root Git reports. It no longer depends on what a project installs or builds into an ignored directory, on any filesystem.
- The warning still covers an individually ignored file that changed, and an ignored directory that appeared or disappeared since setup.
- A change beneath a directory ignored as a whole goes unreported. A hand-made file kept in such a directory is the case the warning now misses. This is the accepted limit.
- A removal review no longer notices a change beneath an ignored directory between review and confirmation.
- A rule that ignores a directory's members instead of the directory, such as `cache/*`, makes Git list each file as its own root. Those files still cost one lookup each.
- A worktree set up by an earlier version reports no ignored-file changes when it lands, because its baseline reads as missing.

## Alternatives considered

An entry budget would cap the cost, but no single figure suits both a project with a few dependencies and one with hundreds of thousands of files. A faster walk leaves the cost proportional to entry count, and concurrent lookups ran twice as slowly on a local disk. Per-path exclusions fail for the reason ADR 0147 gave: every stack would have to classify its own disposable output. Turning the setting off by default would remove the warning for the individually ignored files that carry it.
