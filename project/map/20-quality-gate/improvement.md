---
title: Continuous improvement
description: Use discern improvement to find one objective fix or qualitative review that raises the project's baseline.
order: 70
aliases:
  - discern improvement
  - improvement coach
  - practice health
  - audit
---

# The continuous-improvement coach

_`discern improvement` reports the project's objective baseline, keeps judgment work visible, and recommends one next action._

Run the coach after the current change is under control. The Gate reports whether this tree passed. The coach looks across the installed practices and points to the highest-weighted improvement available next ([ADR 0079](../_adr/0079-improvement-is-a-coach-not-an-audit.md)).

## Read the report

Every successful run reports:

- **Automated practice health**, a weighted score over facts discern can prove;
- the count of objective rules that are `partial` or `fail`;
- the number of qualitative reviews still open;
- one `next_action` with the action and the reason it matters;
- category detail, shown weakest first;
- project-scope advice from the local logbook under `history.findings`.

A deterministic rule checks a concrete fact such as whether tests are configured, guidance exists, or a standard is declared. A qualitative review asks an agent to inspect cited project material, such as whether tests isolate shared state or whether the map still matches the code. Those reviews remain open beside a `100/100` automated score because the binary does not claim judgments it cannot prove ([ADR 0029](../_adr/0029-best-practices-audit.md)).

## Presentation authority

The catalogue, evaluation, category order, score, review questions, Logbook findings, and selected next action remain product facts. The human renderer adapts that typed report into released design-system Result summary, Procedure, Diagnostic, Meter, Command, and section-rule Components. Package states express the existing `pass`, `partial`, and `fail` semantics. They do not manufacture urgency, success, or a second score.

The renderer receives terminal capabilities through the shared output context. It caps the report at 104 columns. Complete coaching facts survive at 39, 80, 104, and wider terminals. Unicode or plain-text glyphs and 24-bit, 256-color, 16-color, or no-color output change presentation only. Project excerpts and other untrusted evidence cross the shared safe-text boundary before entering Component props. Controls become visible escapes instead of terminal instructions.

## Findings from the logbook

The `From the Logbook` group carries recorded conditions that may need an owner decision. It currently includes edits made on the trunk, repeated documentation misses, one diagnostic class recurring across branches, and each Standard's recent value and limit trajectory. Every item retains its detector id, plain-count evidence, ranking strength, and recommended next step. A proposed guidance line, config change, class guard, or Standards stanza remains a proposal for you to decide ([ADR 0160](../_adr/0160-local-logbook-advisory-readers.md)).

This group is separate from the static catalogue. It changes no category score, weak-rule count, qualitative review, `next_action`, `ok`, or `--min-score` result. Inline detectors read at most the newest 200 logbook events here; longer analyses stay under `discern patterns`. Findings are strongest-first and disappear when the recent window is quiet, setup is unfinished, or recording is off.

## How the next action is chosen

Objective gaps lead. The coach chooses the fix that recovers the most weighted score; catalog order breaks a tie. Once every deterministic rule passes, the first applicable qualitative review becomes the recommendation. The review's question, source, excerpt, and teaching travel together on human, JSON, and MCP surfaces.

## Categories

| Category    | What the coach inspects                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `gate`      | Tests, static analysis, structured diagnostics, formatting, depth, isolation, and feedback speed. |
| `setup`     | Completed setup and useful failure memory.                                                        |
| `guidance`  | Substantive authored guidance and current compiled files.                                         |
| `map`       | A navigable Map, decision records, and documentation accuracy.                                    |
| `worktrees` | Isolation for shared external resources.                                                          |
| `standards` | At least one defended Standard and sensible use of rates.                                         |
| `skills`    | Repeated workflows captured as executable, verifiable Skills.                                     |

Every category applies to every install; discern has no feature-toggle layer ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)).

## Run it

```sh
discern improvement
discern improvement --plain
discern improvement --category gate
discern improvement --json
discern improvement --min-score 70
```

The default command offers an interactive category detail view on a terminal. `--plain` prints the full static report. `--category` focuses one area. `--min-score` turns the automated score into an optional failure signal. A result below the floor returns `ok: false` with `error: "below_min_score"`.

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
- Historical findings sit outside the score. They never change `--min-score` or replace the catalogue's selected next action.
- The relevant source files contain no unfinished-work markers for coach behavior.
