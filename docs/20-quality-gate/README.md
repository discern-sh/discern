# The quality gate

_`agent finish` — the compound gate that fixes, builds, checks, and tests before
work is called done._

This subtree covers the gate and everything it runs. The
[`finish`](../../templates/.icculus/engine/finish) Recipe walks the **Phases**
in order — **fix** (serial, mutating fixers), **build** (parallel artifact
producers), then **check** and **test** in parallel — and each **Slot** runs as
its own labelled job, so a failure points at the exact Slot rather than a whole
Phase. After the Phases come the **Side gates** for any **Scope** that changed,
then (in a Worktree) the main-merged check.

`agent tidy` is the fast inner loop: the fix Slots, then the check Slots, with
no build or test. `--json` emits a machine-readable report of every Slot and
Side gate (ADR 0004) for an agent to consume.

The supporting ideas: **Scopes** classify which part of the repo a change
touches and **fail open** (an unknown path runs more gates, never fewer); **Side
gates** let a sub-component plug its own gate in (ADR 0002); **Ratchets** hold
never-loosen metric floors on demand, outside `finish` because they are slow
(ADR 0003); **Evidence** is an optional per-branch proof-of-work gate, off by
default.

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../.icculus/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_     | What it will cover                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `the-finish-phases.md`     | The Phase order, serial-vs-parallel rules, fail-fast, and the gotchas pointer on fail.  |
| `slots-and-phases.md`      | Declaring `[slots]`, the four Phases, measurement slots, and how the Engine finds them. |
| `scopes-and-side-gates.md` | Scope globs, fail-open classification, and wiring a Side gate (ADR 0002).               |
| `ratchets.md`              | Never-loosen floors/ceilings, the `ICCULUS_METRIC` protocol, holding against `main`.    |
| `the-json-report.md`       | The `finish --json` shape and how an agent reads pass/fail per Slot (ADR 0004).         |
| `evidence.md`              | The optional work-evidence gate and how to enable it.                                   |

## See also

- [concepts.md](../00-orientation/concepts.md) — the gate in the daily loop.
- [finish-gate-gotchas.md](../80-development/finish-gate-gotchas.md) —
  non-obvious ways `finish` fails.
