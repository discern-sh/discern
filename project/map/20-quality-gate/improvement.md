---
title: Continuous improvement
description: Use discern improvement to find one objective fix or qualitative review that raises the project's baseline.
order: 80
aliases:
  - discern improvement
  - improvement coach
  - practice health
  - audit
---

# The continuous-improvement coach

_`discern improvement` reports the project's objective baseline, keeps judgment work visible, and recommends one next action._

Run the coach after the current change is under control: the gate reports whether this tree passed; the coach points to the highest-weighted improvement available next ([ADR 0079](../_adr/0079-improvement-is-a-coach-not-an-audit.md)).

## Read the report

Every successful run reports:

- **Automated practice health**, a weighted score over facts discern can prove;
- the count of objective rules that are `partial` or `fail`;
- the number of qualitative reviews still open;
- one `next_action` — a fix, a review, or an evidence-backed owner decision;
- checkpoint `recommendations` backed by recorded evidence;
- category detail, shown weakest first;
- project-scope advice from the local logbook under `history.findings`.

A deterministic rule checks a concrete fact, such as whether tests are configured. A qualitative review asks an agent to inspect cited project material. Reviews remain open beside a `100/100` automated score because the binary does not claim judgments it cannot prove ([ADR 0029](../_adr/0029-best-practices-audit.md)).

## Presentation authority

The catalogue, evaluation, order, score, reviews, findings, and next action remain facts; the renderer maps them to package Components and adds no judgment. One terminal snapshot per invocation caps the report at 104 columns; safe text escapes untrusted controls.

## Findings from the logbook

The `From the Logbook` group carries recorded conditions that may need an owner decision. Every item retains its detector id, plain-count evidence, ranking strength, and recommended next step. A proposed instructions line, config change, class guard, or standards stanza remains a proposal for you to decide ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

This group is separate from the static catalogue. It changes no category score, weak-rule count, qualitative review, `ok`, or `--min-score` result. Inline detectors read at most the newest 200 logbook events here; longer analyses stay under `discern patterns`. Findings are strongest-first and disappear when the recent window is quiet, setup is unfinished, or recording is off.

## The checkpoint loop

Configured checkpoints join the improvement audit ([ADR 0301](../_adr/0301-the-coach-closes-the-checkpoint-loop.md)): one serving a canonical question verbatim marks that review boundary-guarded; any other renders an audit row under `checkpoints`, identical in id and prose to `discern checkpoints`. Recorded evidence (a frequently-varied checkpoint, a recurring diff-introduced finding class) surfaces under `recommendations` as an owner decision with its counts, and variance prose keeps the declared-unmet conclusion.

## How the next action is chosen

Objective gaps lead. The coach chooses the fix that recovers the most weighted score; catalog order breaks a tie. With the baseline clear, an evidence-backed owner decision leads; otherwise the first applicable qualitative review does. The question, source, excerpt, and teaching travel together through terminal, JSON, Markdown, and MCP presentations.

## Categories

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

Every category applies to every install; discern has no feature-toggle layer ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)).

## Run it

```sh
discern improvement
discern improvement --plain
discern improvement --category gate
discern improvement --json
discern improvement --min-score 70
```

The default command offers an interactive category detail view on a terminal. `--plain` prints the full static report. `--category` focuses one area. `--min-score` turns the score into an optional failure signal: below the floor returns `ok: false` with `error: "below_min_score"`.

The old `audit` name has no alias. `improve` is accepted as a grammatical variant and normalizes to `improvement`.

The result fields and Model Context Protocol wrapper are in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                                | Source                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| Category and rule catalog              | [`rules.ts`](../../../src/engine/improve/rules.ts)                        |
| Rule and report vocabulary             | [`types.ts`](../../../src/engine/improve/types.ts)                        |
| Scoring, prioritization, and rendering | [`improve.ts`](../../../src/engine/improve/improve.ts)                    |
| Scope and tier routing                 | [`routing.ts`](../../../src/engine/logbook/routing.ts)                    |
| Responsive and closed-set coverage     | [`engine_improvement_test.ts`](../../../tests/engine_improvement_test.ts) |

## Current state & gotchas

- The score covers deterministic rules only. Do not report it as a measure of overall project maturity.
- `--min-score` enforces the automated floor; open qualitative reviews do not change `ok`.
- Historical findings sit outside the score and never change `--min-score`; a recommendation they back stays advice.
- The relevant source files contain no unfinished-work markers for coach behavior.
