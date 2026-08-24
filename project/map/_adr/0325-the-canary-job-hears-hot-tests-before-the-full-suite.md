# ADR 0325: The canary job hears hot tests before the full suite

**Status**: accepted.

## Context

The suite's recorded failures concentrate in a small, cheap class: the content and structure guards agents trip while rephrasing gated wording, plus a few unit suites with a hot record. The Logbook's per-file test diagnostics show the inversion plainly — the most-failing files run in seconds while the suite's median run costs minutes. An agent that trips a wording guard therefore pays the full test stage to learn a fact the tree could have surfaced immediately, and `discern prepare`, the inner loop agents actually run between edits, never surfaces it at all because tests sit outside the check stage.

Three membership rules were considered for such a subset. A naming convention alone auto-enrols new guards but cannot admit hot files outside the class or expel a member that grows slow. A curated list alone matches how membership is actually judged — hot and cheap are two measurements — but goes stale silently. Deriving membership from the Logbook at run time optimizes the true objective yet makes Gate behaviour depend on mutable per-machine history: a fresh clone would run a different canary than a seasoned checkout, and membership would be invisible to review.

## Decision

**A check-stage `canary` job runs the hot, cheap subset; a committed registry decides membership; recorded failure evidence audits it.**

`[jobs.canary]` runs [`scripts/canary_tests.ts`](../../../scripts/canary_tests.ts) at the check stage. In `discern prepare` a tripped member reports in seconds; in `discern done` a red canary ends the concurrent check-and-test group early under `[gate].fail_fast`. Every member still runs in the test stage, so the canary changes when a failure is heard, never what a green Gate proves. The job stays outside `discern queue`: the fleet cap paces whole-suite runs, and a seconds-scale subset must not wait behind one.

Membership combines the two deterministic rules and keeps the evidence rule advisory:

- **Convention** — guard- and enrolment-named modules under `tests/` enrol the moment they exist, so a new guard is protected from its first commit.
- **Registry** — [`scripts/canary_registry.ts`](../../../scripts/canary_registry.ts) records the judgments: extras promoted on failure evidence, and refusals with their cost measurements. [`tests/canary_registry_guard_test.ts`](../../../tests/canary_registry_guard_test.ts) holds every entry to a tracked module with a one-line reason and re-derives membership from the Git-derived module universe.
- **Evidence** — `discern scripts canary-audit` ([`scripts/canary_audit.ts`](../../../scripts/canary_audit.ts)) ranks the Logbook's per-file test failures against the registry and names drift in both directions: hot uncovered files, and extras with no record left. It never joins the Gate, because failure history differs per machine and Gate behaviour must not.

## Consequences

- Agents editing gated wording learn about a tripped guard in the inner loop, seconds after the edit, instead of after the full test stage.
- A red canary in `discern done` cancels the running suite early, so the common failure class stops costing its slowest observer minutes of wall clock.
- Canary members run twice in a full green Gate. The duplication is a few seconds by construction, and the registry's cost bar keeps it there.
- Membership is reviewable in one diff and identical on every machine; the price is that promoting a newly hot file takes a recorded judgment, prompted by the audit rather than automatic.
- The audit's nomination threshold and the seconds bar are judgment calls recorded in code; revisiting them is an edit to the registry, not a Gate change.
