# ADR 0261: The prepare inner loop runs the [generated] regenerations

**Status**: accepted

## Context

`prepare` composed the fix stage and the check stage — never build or tests. `[generated]` groups run in the full gate's build stage, so an agent whose change fed a generator (a registry edit, a verb description) could iterate green through `prepare`, commit, and only then have `done`'s build stage rewrite the committed artifacts. Strand detection (ADR 0047/0148) rightly fails that run as tree drift, and the only remedy is to commit the gate's own output and pay a second full gate — the tests re-verify a tree whose bytes the first run already proved green. Three parallel delegated streams hit exactly this in one day; with the fleet test-run cap at two slots, the doubled suites queued into roughly half an hour of lost wall clock. The documented avoidance — "run `prepare` before your final commit" — could not actually cover the class, because `prepare` never ran the generators.

## Decision

`preparePlanGroups` composes fix (serial), then the `[generated]` regenerations as their own parallel group, then check. The generated jobs come from the same build-stage planning (`jobsInStage`) `done` uses — one derivation, filtered to `kind: "generated"` — so the two verbs can never regenerate differently. Build jobs and tests stay `done`-only, and slot enrolment is unchanged: the generated group carries no test-stage job, so `prepare` still never draws a fleet test slot. Generated groups already declare their contract — deterministic bytes from the same tree, seconds when warm, with a per-group `timeout` — which is what qualifies them for the inner loop while build jobs stay out.

## Consequences

- A `prepare` pass after the last edit now converges everything the full gate's mutating stages would touch: formatters via fix, committed artifacts via the regenerations. `prepare` → commit → `done` is a finish order that cannot tree-drift on fix- or build-stage output.
- The inner loop pays each generator's warm runtime. Groups are parallel and declared fast; a genuinely slow generator already needs its own `timeout` and is equally a problem in `done`.
- `prepare` can now fail with `failed_stage: "build"` (a regeneration failed), which its failure tail names.
- A dry run still lists generators without executing them; `discern doctor`'s execution model follows the real plan composition automatically.

## Alternatives considered

Teaching the finish order alone (guidance, briefs, the gotchas page) was rejected as the sole fix: it prevents the formatter half but not the generator half, and it relies on every future brief remembering. Running the full build stage in `prepare` was rejected: build jobs carry no determinism or speed contract, and the inner loop's value is its latency. Replaying a tree-drift-failed run's green verdict when the committed tree matches the verified bytes is complementary, larger, and deferred — it makes the failure cheap when it still happens, where this change makes it not happen.
