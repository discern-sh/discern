# ADR 0426: Ignored integration files are an owner decision

**Status**: accepted

## Context

discern writes each selected coding agent's Shared integration files, such as its MCP configuration, hooks, and rules files, and expects Git to track them. A bare clone, a cloud agent's only view, then carries discern's wiring ([ADR 0128](0128-enumerated-ownership-tracked-guidance.md)).

A compatibility probe installed discern into a freshly generated project whose default `.gitignore` excluded two agent tool folders. Many editor and tool `.gitignore` templates do the same. Every layer missed it:

- The read-only `setup verify` said nothing.
- `setup begin`'s machinery commit ran `git add` without `--force`, so it failed with Git's raw message on the first excluded file.
- The tracked-refresh plan considers only tracked paths, so refresh went on regenerating copies only that checkout had, silently.
- `discern doctor` had no such check.

Git also stages a tracked file beneath an ignored folder but still exits 1. A project that had once force-added such a file therefore broke update's regeneration commit as well.

## Decision

**One registry-derived set and one probe.** [`trackedSharedProviderPaths`](../../../src/lib/artifact_ownership.ts) is every Shared file a provider declares. It excludes skills directories, where Git ignores discern's own entries by design, and agent files, which the setup agent commits itself. [`ignoredIntegrationFiles`](../../../src/lib/ignored_integration_files.ts) asks Git, independent of the index, which of those paths an ignore rule matches and which Git already tracks. Setup's preflight, `setup begin`, and `discern doctor` read only that answer. A guard walks every provider declaration for Shared ownership, so a new provider or integration field enrolls without an edit.

**An untracked match is the owner's decision.** The preflight names each file and its rule, and serves one decision with three options:

- **Track anyway**, the recommendation: the machinery commit force-adds those files once. Git ignore rules don't apply to tracked files, so the rule keeps ignoring everything else it matches.
- **Keep local:** the commit leaves them out, and setup records them in `[project].local_integration_files`. Refresh and worktree setup regenerate them; fresh clones and cloud agents lack them until discern runs there.
- **Change the rule:** the owner edits and commits their rule before setup begins, so `begin` finds nothing.

The choice decides what the repository shares, so it is not delegable through "use your recommendation". `setup begin --ignored-integration-files track-anyway|keep-local` carries it. Without a choice, `begin` refuses with `awaiting_decision` before any write. discern never edits the project's own ignore rules.

**Doctor reports the state.** Its `integration files` check warns about an untracked, excluded file the record does not list, and about a listed file that no longer needs its entry. A recorded choice reads as settled.

**Tracked files beneath ignored folders are staged with `--force`.** The machinery commit forces exactly the decided and already-tracked paths. Update's regeneration commit forces its paths too: they come from `git status`, which never lists an ignored untracked file, so the flag admits nothing new.

## Alternatives considered

- **Always force-add.** It silently overrides a rule the owner wrote, and can share files they meant to keep out.
- **Always keep local, without a record.** That is the old failure without the error: cloud agents lose discern's wiring, and nobody decided it.
- **Negation rules in discern's managed block.** Git cannot re-include a file whose parent folder is excluded. A working negation would rewrite the owner's folder rule, which is editing project rules.
- **Recognize known templates.** discern is stack-neutral, and the next template would still fail.
- **No record, and a permanent doctor warning for kept-local files.** A warning about a settled choice teaches people to ignore doctor.

## Consequences

Setup in such a project costs one owner question and never fails its machinery commit on an ignore rule.

`discern.toml` gains `[project].local_integration_files`. Fresh installs render it empty, and `discern upgrade` adds it to existing ones.

A coding agent added after setup gets no preflight. Refresh writes its files; if a rule excludes them, doctor warns until the owner decides, applying a choice by hand.

Ignore rules that exclude an agent file, such as `AGENTS.md`, are outside this check: the setup agent commits those files itself, so this probe does not cover them.
