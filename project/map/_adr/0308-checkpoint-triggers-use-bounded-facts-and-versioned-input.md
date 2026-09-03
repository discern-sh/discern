# ADR 0308: Checkpoint triggers use bounded facts and a versioned command input

**Status**: accepted; extends the checkpoint trigger boundary in [ADR 0296](0296-when-delegates-trigger-conditions-under-a-v1-boundary.md)

## Context

The first checkpoint trigger menu could select changed paths, recognize broad or deletion-heavy changes, find a similar new sibling, and delegate other conditions to `when`. Review moments such as an added dependency line, a removed test, a new subsystem, a binary asset, meaningful line churn, or a many-commit story still required a script to rediscover Git state.

That rediscovery widened the trust and consistency boundary. Each script could choose a different diff, generated-file policy, path interpretation, or history order. Content is branch-controlled input, so matching also needs hard resource limits and cannot copy raw source into a Result or Proof. Commit history presents a separate identity problem: an amend or `git rebase` can leave the final bytes unchanged while changing the history a `min_commits` question asks about.

## Decision

**Checkpoint triggers use one closed, conjunctive vocabulary over bounded facts collected by discern. Executable conditions receive those facts through one versioned temporary-file protocol.**

The public menu adds `kinds`, `adds_matching`, `removes_matching`, `new_directory`, `binary`, `min_changed_lines`, and `min_commits`. Arrays within one field are OR; configured fields are AND. Adding another public entry field requires classifying it in `CHECKPOINT_FIELD_ROLES`, then enrolling policy resolution, seed fallback, definition hashing, summaries, evaluation, and tests. There is no general Boolean expression language.

Evaluation has one fixed order:

1. The governing generated-path classification establishes the authored universe unless `include_generated` opts in. `scope` or `paths` selects changed candidates, then `exclude_paths` removes checkpoint-local noise.
2. `kinds`, `adds_matching`, `removes_matching`, `new_directory`, `binary`, and `similar_new_file` narrow the surviving changed evidence in that order. An empty narrowed set vetoes the checkpoint. A similar existing sibling remains related evidence and never enters changed-file or changed-line totals.
3. `unless_changed`, `min_changed_files`, `min_changed_lines`, `deletion_dominant`, and `min_commits` test the filtered or narrowed facts defined for each condition, in that order.
4. `when` runs last and may only narrow the structurally admitted paths through `DISCERN_MATCH`.

Content patterns are case-sensitive literal UTF-8 byte substrings on individual added or removed lines. Each of `adds_matching` and `removes_matching` accepts 1–16 distinct patterns, each 1–128 UTF-8 bytes; NUL, CR, and LF are invalid. The collector admits lines up to 8 KiB, 65,536 changed-line facts, one file up to 256 KiB, and 2 MiB of attempted bytes across the governing content candidates. Evaluation charges each line's payload plus one separator unit per pattern and admits no more than 64 MiB of comparison work before matching. It never returns partial matches: an unavailable, inconsistent, or over-budget fact drops only the checkpoint definitions that require that fact. Binary content has available empty line facts. Raw lines never enter Results, Proof, the Logbook, or command input.

Branch-controlled untracked content is opened with `O_NONBLOCK`, then its descriptor and post-open path are verified against the regular file observed before open. A replacement is rejected before the first read. An untracked symlink or special file therefore supplies no guessed binary or content fact. Subject calculation hashes symlink target text as a Git symlink without following the target; a directory, special file, or current gitlink working tree that cannot supply a safe Git identity records an unavailable subject instead of guessing. Gitlinks likewise never masquerade as ordinary text or binary content.

History comes from `git rev-list --reverse --topo-order mergeBase..HEAD`. The ordered list includes merge commits; dirty, staged, and untracked changes add zero commits. A versioned fingerprint covers the validated full object ids. Only a definition with `min_commits` mixes that fingerprint into its subject, so an amend or `git rebase` reopens the history-sensitive question without churning an ordinary sibling. A `when` command receives history when available, but `when` alone does not make the declaration history-sensitive.

Every production `when` run receives `DISCERN_CHECKPOINT_INPUT`, whose v1 JSON shape is:

```json
{
  "version": 1,
  "checkpoint": { "id": "example", "mode": "stop" },
  "policy_commit": "<merge-base object id>",
  "changed_files": [
    {
      "path": "src/example.ts",
      "kind": "modified",
      "insertions": 4,
      "deletions": 1,
      "binary": false
    }
  ],
  "history": { "count": 2, "fingerprint": "<ordered-history hash>" }
}
```

`changed_files` is sorted by path and contains the final narrowed evidence. `history` is optional when the fact is unavailable or not collected. The input contains no raw file content, process environment, question, rationale, or secret. discern creates the registered UTF-8 file with mode `0600` only for an actual command run, caps protocol output at 256 KiB, and removes the file on fire, pass, invalid exit, timeout, cancellation, spawn failure, and input failure. Cleanup completes before interrupt release can re-raise a signal; failed cleanup is a typed indeterminate outcome under ADR 0296. Read surfaces and dry runs create no input and run no command.

The merge-base still governs the `when` command text, while execution occurs in the candidate worktree. Scripts, interpreters, dependencies, and configuration named by the command therefore resolve from the candidate worktree. The policy identity does not claim a hermetic dependency closure.

## Consequences

- Common change-shape judgments share one Git view, generated-file policy, path dialect, history order, and bounded content collector.
- A required fact can be unavailable. The durable drop names that loss, no checkpoint fires from a partial scan or guessed classification, and incomplete evidence cannot silently become reusable Proof.
- History-sensitive questions reopen after history-only rewrites. Other checkpoint subjects remain tied to their definition and matched content.
- `when` scripts can consume structured facts without rerunning Git, but their candidate-worktree dependencies remain outside the policy hash.
- The byte limits reject some large or unusual changes from content-sensitive enforcement. The failure is visible and safer than treating an incomplete search as a negative match.

## Alternatives considered

- **JavaScript regular expressions or a Boolean rule language.** Rejected: both widen the public language and make bounded, portable evaluation harder to prove.
- **Let every `when` script discover its own diff and history.** Rejected: scripts would continue to disagree with structural triggers about admitted paths and governing identity.
- **Fail every checkpoint when any file fact is unavailable.** Rejected: an unrelated hostile path must not disable a definition whose admitted evidence remains knowable.
- **Bind every checkpoint subject to ordered history.** Rejected: history-only rewrites would reopen questions that do not ask about history.
- **Hash the executable dependency closure.** Deferred: v1 governs command text and states the candidate-worktree dependency boundary instead of implying hermetic execution.
