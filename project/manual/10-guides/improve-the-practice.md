---
id: guide-improve-the-practice
title: "Improve the practice"
description: "Inspect local evidence, coupling, and improvement findings, then make one bounded practice change."
order: 140
publish: true
kind: guide
aliases:
  - "guide-improve-the-practice"
  - "The continuous-improvement coach"
  - "improvement coach"
  - "practice health"
  - "audit"
  - "Coupling"
  - "cochange"
  - "change partners"
redirect_from:
  - "/docs/quality-gate/improvement"
  - "/docs/quality-gate/coupling"
---

# Improve the practice

Inspect local evidence, coupling, and improvement findings, then make one bounded practice change.

## The continuous-improvement coach

_`discern improvement` reports the project's objective baseline, keeps judgment work visible, and recommends one next action._

Run the coach after the current change is under control: the Gate reports whether this tree passed; the coach points to the highest-weighted improvement available next ([ADR 0079](https://discern.sh/docs/decisions/0079-improvement-is-a-coach-not-an-audit)).

### Read the report

Every successful run reports:

- **Automated practice health**, a weighted score over facts discern can prove;
- the count of objective rules that are `partial` or `fail`;
- the number of qualitative reviews still open;
- one `next_action` — a fix, a review, or an evidence-backed owner decision;
- checkpoint `recommendations` backed by recorded evidence;
- category detail, shown weakest first;
- project-scope advice from the local logbook under `history.findings`.

A deterministic rule checks a concrete fact, such as whether tests are configured. A qualitative review asks an agent to inspect cited project material. Reviews remain open beside a `100/100` automated score because the binary does not claim judgments it cannot prove ([ADR 0029](https://discern.sh/docs/decisions/0029-best-practices-audit)).

### Presentation authority

The catalogue, evaluation, order, score, reviews, findings, and next action remain facts; the renderer maps them to package Components and adds no judgment. One terminal snapshot per invocation caps the report at 104 columns; safe text escapes untrusted controls.

### Findings from the logbook

The `From the Logbook` group carries recorded conditions that may need an owner decision. Every item retains its detector id, plain-count evidence, ranking strength, and recommended next step. A proposed instructions line, config change, class guard, or Standards stanza remains a proposal for you to decide ([ADR 0160](https://discern.sh/docs/decisions/0160-local-logbook-advisory-readers)).

This group is separate from the static catalogue. It changes no category score, weak-rule count, qualitative review, `ok`, or `--min-score` result. Inline detectors read at most the newest 200 logbook events here; longer analyses stay under `discern patterns`. Findings are strongest-first and disappear when the recent window is quiet, setup is unfinished, or recording is off.

### The checkpoint loop

Configured checkpoints join the improvement audit ([ADR 0301](https://discern.sh/docs/decisions/0301-the-coach-closes-the-checkpoint-loop)): one serving a canonical question verbatim marks that review boundary-guarded; any other renders an audit row under `checkpoints`, identical in id and prose to `discern checkpoints`. Recorded evidence (a frequently-varied checkpoint, a recurring diff-introduced finding class) surfaces under `recommendations` as an owner decision with its counts, and variance prose keeps the declared-unmet conclusion.

### How the next action is chosen

Objective gaps lead. The coach chooses the fix that recovers the most weighted score; catalog order breaks a tie. With the baseline clear, an evidence-backed owner decision leads; otherwise the first applicable qualitative review does. The question, source, excerpt, and teaching travel together through terminal, JSON, Markdown, and MCP presentations.

### Categories

| Category       | What the coach inspects                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `gate`         | Tests, static analysis, structured diagnostics, formatting, depth, isolation, and feedback speed. |
| `setup`        | Completed setup and useful failure memory.                                                        |
| `instructions` | Substantive authored instructions and current compiled files.                                     |
| `map`          | A navigable Map, decision records, and documentation accuracy.                                    |
| `worktrees`    | Isolation for shared external resources.                                                          |
| `standards`    | At least one defended Standard and sensible use of rates.                                         |
| `checkpoints`  | The placement ladder and configured checkpoints audited project-wide.                             |
| `skills`       | Repeated workflows captured as executable, verifiable Skills.                                     |

Every category applies to every install; discern has no feature-toggle layer ([ADR 0101](https://discern.sh/docs/decisions/0101-retire-the-features-toggles)).

### Run it

```sh
discern improvement
discern improvement --plain
discern improvement --category gate
discern improvement --json
discern improvement --min-score 70
```

The default command offers an interactive category detail view on a terminal. `--plain` prints the full static report. `--category` focuses one area. `--min-score` turns the score into an optional failure signal: below the floor returns `ok: false` with `error: "below_min_score"`.

The old `audit` name has no alias. `improve` is accepted as a grammatical variant and normalizes to `improvement`.

The result fields and Model Context Protocol wrapper are in [MCP tools & results](../30-reference/mcp-and-results.md).

### Where it lives in code

| Concern                                | Source                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Category and rule catalog              | [`rules.ts`](https://github.com/jackwh/discern/blob/main/src/engine/improve/rules.ts)                        |
| Rule and report vocabulary             | [`types.ts`](https://github.com/jackwh/discern/blob/main/src/engine/improve/types.ts)                        |
| Scoring, prioritization, and rendering | [`improve.ts`](https://github.com/jackwh/discern/blob/main/src/engine/improve/improve.ts)                    |
| Scope and tier routing                 | [`routing.ts`](https://github.com/jackwh/discern/blob/main/src/engine/logbook/routing.ts)                    |
| Responsive and closed-set coverage     | [`engine_improvement_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_improvement_test.ts) |

### Current state & gotchas

- The score covers deterministic rules only. Do not report it as a measure of overall project maturity.
- `--min-score` enforces the automated floor; open qualitative reviews do not change `ok`.
- Historical findings sit outside the score and never change `--min-score`; a recommendation they back stays advice.
- The relevant source files contain no unfinished-work markers for coach behavior.
## Coupling

_`discern coupling` names files that usually move together, with the history behind each suggestion._

`discern coupling` reads Git history for files that repeatedly change together, such as a schema and its validator or an implementation and its test. It reports relationships and evidence. The result is an [advisory](../30-reference/glossary.md#advisory). You decide whether each relationship matters ([ADR 0084](https://discern.sh/docs/decisions/0084-co-change-coupling-advisory)).

### Choose a mode

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

### Read the evidence

Each partner carries plain counts:

- `from`, the changed or queried source file;
- `path`, the suggested partner;
- `cochanges`, the recent commits that touched both;
- `of`, the recent commits that touched `from`;
- `confidence`, the share represented by `cochanges`;
- `lift`, the association relative to the partner's background frequency.

Before the `<2` check, basket-size fence, or counts, coupling removes neutral paths and paths owned by `[generated.<name>]`. It removes paths from a commit, preserving authored pairs beside a declared output. Neutrality comes from scope rules. Generated ownership remains separate and applies to non-neutral paths.

Declared outputs are projections and never candidate siblings. Explicit queries name the owner in `excluded_generated`. Evidence omits counts and commit rows when a generated group owns either argument. The model drops sweeping commits, requires repeated and statistically significant co-change, ranks, and caps results ([ADR 0247](https://discern.sh/docs/decisions/0247-generated-artifacts-regenerate-never-merge)).

### Keep it in the gate

Fresh configs append the diff-aware advisory to green `discern prepare` and `discern done` results:

```toml
[coupling]
in_gate = true
```

Gate hints use a stricter threshold and fewer partners. They run at the end of a successful, set-up result and add only `hints[]`. Set `in_gate = false` to keep the standalone command without the Gate advisory ([ADR 0196](https://discern.sh/docs/decisions/0196-coupling-advice-runs-with-the-gate-by-default)).

### Decide what to enforce

A repeated relationship asks you to inspect the pair. When the files express an essential invariant, add a forcing function driven by the canonical set so future members enroll automatically. Incidental co-change needs no rule ([ADR 0051](https://discern.sh/docs/decisions/0051-canonical-set-parity)).

The subsystem is core. It is read-only and self-calibrating. `in_gate` controls whether the Gate pays its cost ([ADR 0101](https://discern.sh/docs/decisions/0101-retire-the-features-toggles)). The full config reference is in [config-reference.md](../30-reference/config-reference.md#coupling).

The result fields and Model Context Protocol arguments are in [MCP tools & results](../30-reference/mcp-and-results.md).

### Where it lives in code

| Concern                              | Source                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Mining, ranking, and all three modes | [`coupling.ts`](https://github.com/jackwh/discern/blob/main/src/engine/coupling/coupling.ts)                                              |
| Result data schema                   | [`result_schemas.ts`](https://github.com/jackwh/discern/blob/main/src/shared/result_schemas.ts)                                           |
| Gate and prepare integration         | [`finish.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/finish.ts), [`prepare.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/prepare.ts) |
| Behavioral coverage                  | [`engine_coupling_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_coupling_test.ts)                                    |

### Current state & gotchas

- Each invocation recomputes the model; there is no persisted cache.
- Neutral-path classification comes from the same scope rules as the gate. A path classified as neutral contributes no edges.
- If Git history cannot be read, the advisory returns no partners and does not fail the command or Gate.
- The relevant source files contain no unfinished-work markers for coupling behavior.
