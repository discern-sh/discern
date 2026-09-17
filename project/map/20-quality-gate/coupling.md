---
title: Coupling
description: Use Git history to find files that usually change with the work on your branch and may have been missed.
order: 90
aliases:
  - discern coupling
  - cochange
  - change partners
---

# Coupling

_`discern coupling` names files that usually move together, with the history behind each suggestion._

`discern coupling` reads Git history for files that repeatedly change together, such as a schema and its validator or an implementation and its test. It reports relationships and evidence. The result is an [advisory](../00-orientation/glossary.md#advisory). You decide whether each relationship matters ([ADR 0084](../_adr/0084-co-change-coupling-advisory.md)).

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

Diff-aware mode includes commits ahead of trunk and worktree edits. Evidence mode shows subjects and dates before you turn a pattern into a rule.

## Read the evidence

Each partner carries plain counts:

- `from`, the changed or queried source file;
- `path`, the suggested partner;
- `cochanges`, the recent commits that touched both;
- `of`, the recent commits that touched `from`;
- `confidence`, the share represented by `cochanges`;
- `lift`, the association relative to the partner's background frequency.

Before the `<2` check, basket-size fence, or counts, coupling removes neutral paths and paths owned by `[generated.<name>]`. It removes paths from a commit, preserving authored pairs beside a declared output. Neutrality comes from scope rules. Generated ownership remains separate and applies to non-neutral paths.

Declared outputs are projections and never candidate siblings. Explicit queries name the owner in `excluded_generated`. Evidence omits counts and commit rows when a generated group owns either argument. The model drops sweeping commits, requires repeated and statistically significant co-change, ranks, and caps results ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

## Keep it in the gate

Fresh configs append the diff-aware advisory to green `discern prepare` and `discern done` results:

```toml
[coupling]
report_in_gate = true
```

Gate hints use a stricter threshold and fewer partners. They run at the end of a successful, set-up result and add only `hints[]`. Set `report_in_gate = false` to keep the standalone command without the gate advisory ([ADR 0196](../_adr/0196-coupling-advice-runs-with-the-gate-by-default.md)).

## Decide what to enforce

A repeated relationship asks you to inspect the pair. When the files express an essential invariant, add a forcing function driven by the canonical set so future members enroll automatically. Incidental co-change needs no rule ([ADR 0051](../_adr/0051-canonical-set-parity.md)).

The subsystem is core. It is read-only and self-calibrating. `report_in_gate` controls whether the gate pays its cost ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). The full config reference is in the manual's [`[coupling]` table](https://discern.sh/docs/reference/config-reference#coupling).

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
- If Git history cannot be read, the advisory returns no partners and does not fail the command or Gate.
- The relevant source files contain no unfinished-work markers for coupling behavior.
