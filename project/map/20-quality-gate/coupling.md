---
title: Coupling
description: Use git history to find files that usually change with the work on your branch and may have been missed.
order: 80
aliases:
  - discern coupling
  - cochange
  - change partners
---

# Coupling

_`discern coupling` names files that usually move together, with the history behind each suggestion._

Use [coupling](../00-orientation/glossary.md#coupling) when a change may have a habitual sibling: a schema and its validator, a registry and its consumers, or an implementation and its test. The command mines the repository's own git history and reports the strongest relationships it finds. It is an [advisory](../00-orientation/glossary.md#advisory), so you decide whether each relationship matters ([ADR 0084](../_adr/0084-co-change-coupling-advisory.md)).

## Choose a mode

```sh
discern coupling
discern coupling src/shared/result.ts
discern coupling src/shared/result.ts src/shared/result_schemas.ts
```

| Invocation | Mode       | What it reports                                                                 |
| ---------- | ---------- | ------------------------------------------------------------------------------- |
| No path    | Diff-aware | Partners missing from the branch's committed and uncommitted change set.        |
| 1 path     | Query      | The file's strongest co-change partners, useful before editing it.              |
| 2 paths    | Evidence   | The recent commits where both files changed, with each file's own commit count. |

Diff-aware mode compares the branch with trunk and includes worktree edits. A clean worktree can still produce suggestions when the branch has commits ahead. Evidence mode lets you inspect subjects and dates before turning a pattern into a rule.

## Read the evidence

Each partner carries plain counts:

- `from`, the changed or queried source file;
- `path`, the suggested partner;
- `cochanges`, the recent commits that touched both;
- `of`, the recent commits that touched `from`;
- `confidence`, the share represented by `cochanges`;
- `lift`, the association relative to the partner's background frequency.

The model reads a bounded window of recent non-merge commits. It removes neutral paths, drops sweeping outlier commits, requires repeated co-change and statistical significance, ranks the survivors, and caps the result. These choices keep generated documentation and repository-wide formatting commits from manufacturing a recommendation.

## Keep it in the gate

Fresh configs append the diff-aware advisory to green `discern prepare` and `discern done` results:

```toml
[coupling]
in_gate = true
```

Automatic gate hints use a stricter evidence threshold and show fewer partners than a direct query. They appear at the end of a successful, fully set-up run and only add `hints[]`. Set `in_gate = false` to keep the standalone command available without running the advisory in the gate ([ADR 0196](../_adr/0196-coupling-advice-runs-with-the-gate-by-default.md)).

## Decide what to enforce

A repeated relationship asks you to inspect the pair. When the files express one essential invariant, add a forcing function driven by the canonical set so future members enroll automatically. Incidental co-change needs no rule ([ADR 0051](../_adr/0051-canonical-set-parity.md)).

The subsystem is core. It is read-only and self-calibrating; `in_gate` is its cost decision ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). The full config reference is in [config-reference.md](../70-reference/config-reference.md#coupling).

The result fields and Model Context Protocol arguments are in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                              | Source                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Mining, ranking, and all three modes | [`coupling.ts`](../../../src/engine/coupling/coupling.ts)                                              |
| Result data schema                   | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                                           |
| Gate and prepare integration         | [`finish.ts`](../../../src/engine/gate/finish.ts), [`prepare.ts`](../../../src/engine/gate/prepare.ts) |
| Behavioral coverage                  | [`engine_coupling_test.ts`](../../../tests/engine_coupling_test.ts)                                    |

## Current state & gotchas

- Each invocation recomputes the model; there is no persisted cache.
- Neutral-path classification comes from the same scope rules as the gate. A path classified as neutral contributes no edges.
- If git history cannot be read, the advisory returns no partners and does not fail the command or gate.
- The relevant source files contain no unfinished-work markers for coupling behavior.
