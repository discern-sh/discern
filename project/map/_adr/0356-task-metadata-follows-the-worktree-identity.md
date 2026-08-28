# ADR 0356: Task metadata follows the worktree identity

**Status**: accepted. Extends the worktree creation and identity boundary from [ADR 0058](0058-start-verb-spawn-worktree-from-trunk.md), the Git-admin state registry from [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md), and the Desk's status-projection boundary from [ADR 0318](0318-the-desk-adapts-status-into-one-human-decision.md).

## Context

A worktree id and branch are machine identity. Their spelling must remain stable for Git refs, resource names, environment values, and lifecycle ownership. A person-facing task title has different requirements: it preserves Unicode, case, punctuation, and later edits. Deriving the title from the normalized id loses those properties and cannot carry a brief or creation source.

The title and brief must survive Desk refreshes and worktree moves without becoming a Desk preference. They must also disappear through the ordinary worktree teardown. Existing worktrees have no stored task metadata and still need a useful label.

The Logbook already owns lifecycle timestamps and records the ref used by successful starts. Its events are append-only evidence with a privacy boundary that excludes prompts and message bodies. A mutable display title and a person-authored brief do not belong in that stream.

## Decision

Stable identity remains derived from Git's linked-worktree registration and discern's identity settings. The existing id and branch are never copied into mutable task metadata and never change when a task title changes.

Each new discern-created worktree receives one versioned record at the `taskMetadata` entry in the Git-admin path registry. The entry has worktree scope and resolves to `discern/task-metadata.json` inside that linked worktree's Git administration directory. Its canonical stored schema contains:

- the display title, preserved as supplied after validation;
- an optional one-line brief, also preserved as supplied;
- the creation source as the accepted ref plus the commit it resolved to when creation was planned.

The record contains no timestamps. Git activity and Logbook events remain the authorities for creation and later activity time. The start core writes the record after Git creates the linked-worktree registration and before setup runs. A record-write failure participates in the existing failed-creation cleanup, so start cannot report a metadata-bearing task as ready when its record was not written.

Status combines the derived id and branch with the task record into the canonical public task projection. Start and task-title rename results use the same projection schema. A missing record is a supported legacy state: status derives the current human label from the id and marks the projection as an identity fallback. An unreadable or invalid record is reported as unavailable metadata and uses the same bounded fallback label; it is never classified as a legacy absence.

Titles and briefs are single-line Unicode strings. Validation rejects blank values, control characters, and bounded-size violations while preserving accepted text byte for byte. A title change is a plan/apply operation over the record. It changes the display title only; the id, branch, worktree path, creation source, brief, and lifecycle state remain unchanged.

The Git-admin placement supplies lifecycle semantics without another cleanup protocol:

- `git worktree move` retains the linked-worktree administration directory and its metadata;
- ordinary acceptance, drop, failed-start cleanup, and Git worktree removal remove the record with that administration directory;
- a retained branch with no worktree has no task record and is presented by its ref until resumed into a newly titled task;
- status, start, and rename result envelopes export the supported structured projection; cloning, fetching a branch, or exporting Logbook history does not export the local title or brief.

Repository-level creation preferences remain separate common-Git-dir state. They may remember the last available agent and compact or expanded creation path. They never carry task facts, landing grants, or lifecycle predicates.

## Consequences

- Display-title edits cannot rename a branch, directory, resource, database, or environment identity as a side effect.
- New starts preserve the person's title and brief while still surfacing the normalized id and branch when their spelling differs.
- Legacy worktrees retain the existing id-derived display instead of requiring migration.
- A worktree move needs no metadata rewrite. Removing its Git registration also removes the metadata authority.
- Orphan branches cannot retain a stale title after their worktree has gone. Resuming one creates a new task record with an explicit title and the orphan ref as its creation source.
- The Logbook keeps its bounded, metadata-only privacy contract. Task wording appears only in the local task record and structured results that explicitly report it.
- A future portable task bundle would need an explicit export/import design. It cannot infer portability from Git refs or Logbook archives.

## Alternatives considered

- **Use the normalized worktree id as the title.** Rejected because normalization necessarily loses human text and cannot represent a brief or later title edit.
- **Store task metadata in Desk preferences.** Rejected because Desk would become an independent lifecycle database and non-Desk status consumers would lose the facts.
- **Append title and brief changes to the Logbook.** Rejected because a brief crosses the Logbook's privacy boundary, and reconstructing mutable current state from history would make an analytical event stream an operational database.
- **Store a branch-keyed map in the common Git directory.** Rejected because branch retention and worktree teardown would need a second garbage-collection protocol, and stale entries could attach old human text to later work.
- **Commit metadata in the task branch.** Rejected because changing a label would dirty the worktree, enter review and landing history, conflict across follow-up branches, and travel to clones as project source.
- **Rename the branch and directory with the title.** Rejected because it would couple mutable presentation to stable lifecycle and resource identity.
