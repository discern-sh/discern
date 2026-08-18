---
title: Checkpoint state & declarations
description: The checkpoint episode states, the declaration and variance flags, and the surfaces that report them.
order: 160
aliases:
  - checkpoints
  - discern checkpoints
  - discern_checkpoints
  - declared met
  - declared unmet
  - variance
  - episode
  - --met
  - --unmet
  - --why
  - --variance
---

# Checkpoint state and declarations

A [checkpoint](../00-orientation/glossary.md#checkpoint) pairs a deterministic trigger with a criterion the agent judges. This page is the reference for its states, flags, and surfaces. The governing definitions are read from `[checkpoints]` at the effort's merge-base with the trunk — the **policy identity** every report and Proof names. A `stop` checkpoint interlocks `discern done`; an `advise` checkpoint serves its criterion through the advisory channel and blocks nothing.

## Episode states

A fired `stop` checkpoint opens an effort-scoped **[episode](../00-orientation/glossary.md#episode)** — the record a declaration binds to, carrying the resolved-definition hash and the subject fingerprint of the matched content.

| State                  | Meaning                                                                       | Resolved by                                            |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `awaiting_declaration` | The trigger fired; no current conclusion is recorded.                         | `discern done --met <id>`, or `--unmet <id> --why "…"` |
| `declared_met`         | The agent recorded that the criterion is satisfied for the current subject.   | Standing evidence; reopens on a relevant change        |
| `declared_unmet`       | The agent recorded that it is not satisfied, with a one-paragraph rationale.  | An owner-authorized variance at `discern accept`       |
| `reopened`             | A relevant change unbound the recorded conclusion; it must be declared again. | A fresh declaration at `discern done`                  |

Reopening is relevance-sensitive: a declaration stales only when the checkpoint's definition or the matched content changes. Unrelated edits and trunk advances leave it standing.

## Declarations at the gate

`discern done --met <id>` (repeatable) records a declared-met conclusion; `discern done --unmet <id> --why "<rationale>"` records a declared-unmet conclusion, one per invocation, with a required rationale of 1–500 characters in one paragraph. A declaring invocation records every valid conclusion first, then proceeds into the gate in the same run. Recording a conclusion is the caller's own act; every surface qualifies it as **[declared met](../00-orientation/glossary.md#declared-met)** or **[declared unmet](../00-orientation/glossary.md#declared-unmet)** — recorded judgment, distinct from machine-verified results. The Proof carries declared conclusions separately, and changed declaration evidence stales a recorded Proof even at an unchanged `HEAD`.

## Variance at acceptance

A current declared-unmet conclusion makes `discern accept` refuse until the owner authorizes each named variance in the current conversation: `discern accept --confirmed --variance <id>` (repeatable; the id set must equal the declared-unmet set). Recorded standing and effort grants cover no variance. Each authorization binds to the exact declaration (checkpoint id, definition hash, subject fingerprint, rationale) and to the landed commit.

## Read surfaces

`discern checkpoints` (CLI, `--json`, `--markdown`, and the MCP tool `discern_checkpoints`) reports the governing policy with each checkpoint's criterion and trigger summary, every episode's state, a structural preview of what the current change would fire, recorded episodes outside the governing policy, observed per-checkpoint economics (plain counts with denominators), and fail-open advisories. `discern prepare` and `discern status` serve each coming `stop` criterion early through the advisory channel, and `discern done --dry-run` previews the same projection. Every read surface is effect-free: it runs no configured `when` command (an undecided condition reports as pending) and writes no episode. Command details live in the [CLI reference](cli-reference.md#discern-checkpoints); the result contract in [MCP tools & results](mcp-and-results.md).
