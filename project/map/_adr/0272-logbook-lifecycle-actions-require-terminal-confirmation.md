# ADR 0272: Logbook lifecycle actions require terminal confirmation, and archives remain readable

> **Amendment ([ADR 0365](0365-the-v1-cli-has-one-command-model-and-one-spelling.md)).** The effectful singular action is `discern patterns seal`; `discern patterns archives` remains the read-only archive listing. The former action spelling is not an alias. The terminal-confirmation and archive-read contracts below are unchanged.

**Status**: accepted. Supersedes the no-confirmation clause in [ADR 0163](0163-patterns-reset-cli-only.md) and amends the paired-start rule in [ADR 0210](0210-effectful-verb-starts-are-paired-logbook-events.md) for the two commands that replace the Logbook they would otherwise record into.

## Context

The Logbook is local and deletable by design. `discern patterns reset` originally made that promise as an unattended one-command deletion: its apply path accepted pipes, CI, `--plain`, and `--json`, and ADR 0163 explicitly rejected confirmation so scripts could erase the active history. That makes the measured party able to delete its evidence without a person at the terminal. A dry-run is not an authorization boundary when the destructive command does not require it.

Owners also need a less destructive lifecycle action. They should be able to seal the current event history, begin a fresh active Logbook, and later run Patterns or Stats against the sealed evidence. The active recorder and operational readers still need one unambiguous current source. An archive selector must therefore affect one advisory read only; it cannot redirect recording, fleet activity, queue estimates, Gate hints, or work-in-flight checks.

Archive creation crosses concurrent writers. Renaming the active directory is the only atomic boundary available without making the fail-open recorder acquire a lock and thereby allowing recording to interfere with a command. The transaction must preserve every raw event line, keep a recovery route after a sealing failure, avoid publishing a partial archive, and avoid splitting the archive command's own begin and completion events across two histories.

## Decision

`discern patterns reset` and `discern patterns archive` are CLI-only owner actions. Their apply paths require terminal stdin, terminal stdout, operation outside CI, global non-plain output, and an explicit positive answer to a confirmation that defaults to No. `--json` apply returns one structured refusal. Pipes, CI, and `--plain` apply refuse without changing Logbook state. There is no `--yes`, `--confirmed`, environment variable, or other unattended attestation. No such bypass is added until demonstrated owner demand justifies reopening the safety boundary. `--dry-run` remains unattended and machine-readable in every output mode.

The reset confirmation states the parsed event count, date span, source filenames, total bytes, permanent-loss consequence, and the capabilities whose evidence resets. That capability account derives from `LOGBOOK_POWERED`. Declining uses the product's cancellation outcome: success with “Aborted. Nothing changed.” Reset detaches and removes only the registered active Logbook. Sealed archives, recovery snapshots, and every other registered Git-admin sibling survive.

Archives live at the registered common Git-admin path `discern/logbook-archives/`. A sealed file is portable JSON Lines named from UTC, such as `logbook-20260811T143015Z.jsonl`; an existing name gains a numeric suffix rather than being overwritten. Month shards are concatenated in name order, preserving their raw nonempty lines without parsing and serializing them again. Torn and foreign lines therefore retain the tolerant reader's accounting. `epoch.json` is active recorder state, not historical event data: it moves with the detached snapshot for recovery, is omitted from the sealed file, and is discarded only after successful publication. The fresh recorder creates new epoch state when it next writes.

Archive apply runs under one registered repository-common advisory lock shared with reset. Under that lock it recomputes the reviewed plan and refuses if the active source changed. It also refuses while the active stream contains another fresh unmatched invocation, naming that work and telling the operator to wait for it to finish before retrying. The archive directory and recovery parent are prepared first; the active Logbook directory is then renamed atomically into a unique recovery snapshot. Event lines are sealed into a unique temporary file, the file is synced, and the final archive is published through an atomic no-clobber hard link in the same directory. The detached snapshot is removed only after publication. A sealing or publication failure removes any partial temporary file when possible and retains the detached snapshot at the reported recovery path. No archive deletion or retention policy ships with this lifecycle.

The advisory lock serializes reset and archive with each other; it does not enter the recorder. The action rechecks observable in-flight work immediately before detachment, but a recorder can begin in the remaining race. That race stays fail-open: the arriving writer creates or appends to the canonical active directory and no recording failure changes its verb. The sealed snapshot remains the exact directory detached at the transaction boundary.

Reset and archive themselves write neither a `begin` nor a completion event. This narrow exception to ADR 0210 keeps a lifecycle command out of the substrate it replaces, makes refusal and cancellation byte-for-byte read-only, and prevents one invocation appearing unfinished in the archive while its completion appears active. The next eligible invocation begins the fresh active history when recording is enabled. The common lifecycle-action registry owns this recording exception and the interaction policy, so a new sibling action enrolls in both by construction.

`discern patterns archives` lists sealed archives with filename, parsed event count, date span, skipped-line count, and bytes. `discern patterns --logbook-file <filename>` and its `--stats`, `--all`, and `--json` forms read one archive. The selector accepts only a valid archive basename resolved inside the registered archive directory; separators, traversal, arbitrary paths, symbolic links, directories, active month names, and names outside the archive format refuse. `data.logbook.source` identifies either the active Logbook or the selected archive, and terminal output names an archive explicitly. The read-only `discern_patterns` MCP tool accepts the equivalent optional selector.

Historical selection is advisory and invocation-scoped. It never changes the active recorder. The historical command's own completion, when recording is enabled, goes to the active Logbook. Operational readers always read the active Logbook, including `status`, Gate hints, queue estimates, fleet activity, and work-in-flight checks. Archive reads open no write path and no network path.

## Consequences

- An unattended reset script now refuses. Existing automation must switch to `--dry-run` for inspection or put a person at a terminal for deletion; there is deliberately no migration flag that preserves scripted apply.
- Permanent deletion and history replacement become observable owner decisions with an exact reviewed scope. A dry-run remains suitable for scripts and agents.
- Archive creation preserves every raw month line, starts the next active history at a single atomic directory boundary, and prints the exact command that reads the sealed file.
- A failed seal can leave the canonical active directory empty while its old contents remain in the reported recovery snapshot. A later recorder may already have created a new active directory, so recovery is intentionally explicit rather than an automatic merge of two histories.
- Lifecycle actions no longer contribute events to the Patterns corpus. That small evidence gap is the price of avoiding self-referential deletion and split invocations.
- Archives accumulate until an owner manages them outside discern. Automatic retention and archive deletion remain deliberately out of scope.

## Alternatives considered

- **Keep unattended reset and add only archive.** Rejected because it leaves the original evidence-erasure problem intact.
- **Offer `--yes`, `--confirmed`, or a secret environment switch.** Rejected because each recreates unattended deletion and turns the confirmation into ceremony rather than authority.
- **Record the archive begin in the sealed file and its completion in the fresh Logbook.** Rejected because readers would see one permanently unmatched invocation in each source and could misclassify the archived begin as in-flight work.
- **Copy the active directory before detaching it.** Rejected because writers can change several shards during the copy, producing no single transaction boundary and delaying the fresh start until an unbounded copy finishes.
- **Make the recorder acquire the lifecycle lock.** Rejected because lock contention or failure could then delay or affect ordinary verbs, violating recording noninterference.
- **Archive `epoch.json` beside the events.** Rejected because its per-branch hashes are mutable input to the next recording decision, not historical evidence consumed by Patterns.
- **Accept arbitrary archive paths.** Rejected because it would turn a local advisory reader into a general filesystem reader and make the active-vs-historical boundary uncheckable.
