---
title: Checkpoint when protocol
description: The versioned DISCERN_CHECKPOINT_INPUT facts, DISCERN_MATCH output, lifecycle, and candidate-worktree execution boundary.
order: 165
aliases:
  - checkpoint when input
  - checkpoint when command
  - DISCERN_CHECKPOINT_INPUT
  - DISCERN_MATCH
---

# Checkpoint `when` protocol

A structurally holding checkpoint may delegate its final firing decision to `when = "<command>"`. An actual strict or CI run creates one temporary UTF-8 JSON file for the command and exposes its absolute path as `DISCERN_CHECKPOINT_INPUT`. Version 1 has this shape:

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

`changed_files` is sorted by path and contains the final structurally narrowed changed evidence. Each `kind` is `added`, `modified`, or `deleted`; line counts are non-negative integers and `binary` is a known Boolean. `history` is optional and, when present, describes the ordered merge-base-to-`HEAD` commit list. The object contains no raw file content, environment dump, question, rationale, or secret.

The registered input file has mode `0600` and exists only while its command runs. discern removes it after fire, pass, invalid exit, timeout, cancellation, spawn failure, or input failure, completing cleanup before an interrupt can be re-raised. A cleanup failure or protocol output beyond 256 KiB fails the checkpoint open and leaves a typed drop. `discern checkpoints`, `status`, `prepare`, and every dry run create no input file and run no command.

Exit 0 fires, exit 1 passes, and another exit or execution error fails open. `DISCERN_MATCH <path>` lines may narrow the matched set but cannot admit a path absent from `changed_files`. Without a valid declared match, the command retains the structural matched set.

The merge-base governs the command text. The command runs in the candidate worktree, so its scripts, dependencies, configuration, and interpreter resolve there and do not form a hermetic policy dependency closure ([ADR 0308](../_adr/0308-checkpoint-triggers-use-bounded-facts-and-versioned-input.md)).
