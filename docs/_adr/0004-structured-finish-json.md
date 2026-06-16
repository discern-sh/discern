# ADR 0004: `agent finish --json` — structured gate output

**Status**: accepted; **amended by the 1.0 redesign** — see _Update (1.0)_
below.

## Update (1.0)

The original decision (below) reports gate results **per phase**, on the
reasoning that slots within a phase ran joined (`&&`), so the engine could not
see an individual slot's pass/fail.

The 1.0 redesign makes each slot its **own tracked job** (the `fix` slots
serial, the rest concurrent within their stage — see ADR 0002's _Update_). The
honest unit is now the **slot**, and the JSON reports it:

- `"phases"` becomes `"slots"`; each entry is
  `{name, phase, status, duration_s}`.
- `status` gains **`skipped`** — a real slot whose stage aborted before it ran
  (a failed serial fixer, or a fail-fast cancellation) — alongside `ok` /
  `failed` / `noop`.
- `failed_stage` now distinguishes `fix` from `build` (they are separate
  stages): `evidence` | `fix` | `build` | `check/test` | `side_gates` | `merge`.

Everything else — stdout-carries-only-JSON, human mode unchanged, the
`side_gates[]` entries, second-granular durations — stands.

## Context

`init` and `doctor` already speak `--json`; `agent finish` did not. But finish
is the recipe an agent-driven workflow most wants to consume — it is the gate
that says "is this work done?". Without machine-readable output, an agent has to
scrape human text and the exit code, which conflates _what failed_ into a single
bit.

ADR 0002 made side-gates first-class and noted that folding their results into a
structured gate result depends on finish having `--json`. This ADR adds it, so
item 2's aggregation can complete.

The execution unit matters for what the JSON can honestly report. Slots within a
phase run **joined** (`fix` slots run serially with `&&` because one fixer's
output feeds the next; `check`/`test` likewise run as one command). So
`run_parallel` sees **one job per phase**, not one per slot — the engine does
not know an individual slot's pass/fail when several share a phase. The honest
unit of structured reporting is therefore the **phase** (plus each side-gate,
which _is_ a distinct job).

## Decision

Add `agent finish --json`, emitting a single JSON object on stdout and routing
all human output to stderr.

- **Contract.** In `--json` mode, stdout carries exactly one JSON object and
  nothing else; every heading, grouped phase output, and progress line goes to
  stderr (saved via `exec 3>&1 1>&2`, with the JSON written to the saved
  descriptor). The process exit code still reflects pass/fail.
- **Shape.**

  ```json
  {
    "ok": true,
    "phases": [{ "name": "fix", "status": "ok|failed|noop", "duration_s": 0 }],
    "side_gates": [
      { "scope": "native", "status": "ok|failed|skipped", "duration_s": 3 }
    ],
    "scopes_changed": ["web", "native"],
    "failed_stage": null
  }
  ```

  `phases` lists the gated phases that actually ran (a phase whose slots are all
  no-ops reports `noop`); `side_gates` lists every configured gate —
  `ok`/`failed` for those that fired, `skipped` for those whose scope didn't
  change (this is the "what ran vs was skipped by scope" view); `failed_stage`
  names the stage that failed (`evidence` | `fix/build` | `check/test` |
  `side_gates` | `merge`) or is `null` on success.
- **Reporting unit is the phase, not the slot.** Because slots within a phase
  run joined, the JSON reports per-phase results (the genuine execution unit)
  plus per-side-gate results. This is faithful to what ran; a synthetic per-slot
  status would be a guess.
- **Durations** are whole wall-clock seconds, captured per job by
  `run_parallel`. `run_parallel` gains an opt-in side channel: when
  `ICCULUS_JOBS_RESULTS` names a file, it appends `<label>\t<code>\t<seconds>`
  per job. With the variable unset (every existing caller), behaviour is
  unchanged.
- **Failure still produces JSON.** A failing stage in `--json` mode emits the
  object with `ok:false` and the `failed_stage` set, then exits non-zero —
  instead of the human `die`+gotchas path. The gotchas pointer is suppressed in
  `--json` mode (the structured object is the machine's guidance).
- **Human mode is unchanged.** Without `--json`, finish behaves exactly as
  before — same headings, same grouped output, same `die`+gotchas on failure,
  same informational tail. The `--json` branches are purely additive.

## Consequences

- Agent-driven workflows — icculus's reason for being — can consume gate results
  cleanly: which phase/side-gate failed, what was skipped by scope, how long
  each took, all without scraping.
- Item 2's side-gate aggregation is now complete: side-gates appear in
  `side_gates[]` alongside their pass/fail and duration.
- The JSON reports per-phase, not per-slot. Anyone wanting per-slot granularity
  would first need per-slot execution (the same path-scoped-execution work ADR
  0002 deferred). Documented, not a silent gap.
- `run_parallel` carries a small, opt-in results side channel; its human output
  contract is otherwise untouched.
- Durations are second-granular (portable `date +%s`); sub-second jobs report
  `0`. Adequate for a gate; finer timing would need non-portable tooling.

## Alternatives considered

- **A separate `finish-json` recipe.** Rejected: it would duplicate the phase
  sequence and drift from `finish`. A flag on the one recipe keeps a single
  source of truth for the gate's shape.
- **Per-slot results.** Rejected for now: slots run joined within a phase, so
  per-slot pass/fail isn't known without changing the execution model. Per-phase
  is the honest unit.
- **Emit JSON to a file instead of stdout.** Rejected: stdout with human output
  on stderr is the conventional, composable contract (matches `init`/`doctor`),
  and needs no path coordination.
