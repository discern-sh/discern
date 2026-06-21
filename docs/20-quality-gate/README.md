# The quality gate

_`discern finish` — the compound gate that fixes, builds, checks, and tests
before work is called done._

This subtree covers the gate and everything it runs. The built-in
[`finish`](../../src/engine/gate/finish.ts) verb walks the **Stages** in order —
**fix** (serial, mutating fixers), **build** (parallel artifact producers), then
**check** and **test** in parallel — and each **Capability** and **Check** runs
as its own labelled job, so a failure points at the exact one rather than a
whole Stage. A known Capability's Stage is derived from its name; a Check states
its own. After the Stages come the **Scope** `gate`s for any Scope that changed,
then (in a Worktree) the main-merged check.

`discern tidy` is the fast inner loop: the fix-stage then check-stage work, with
no build or test. `--json` emits a machine-readable report of every Capability,
Check, and Scope gate (ADR 0004, ADR 0017) for an agent to consume.

The supporting ideas: **Capabilities** are the five known commands (`format` /
`build` / `lint` / `typecheck` / `test`) and a **Check** is custom gate work
with an explicit Stage (ADR 0017); **Scopes** classify which part of the repo a
change touches and **fail open** (an unknown path runs more gates, never fewer),
and a Scope can carry its own `gate` so a sub-component plugs in (ADR 0018);
**Ratchets** hold never-loosen metric floors on demand, outside `finish` because
they are slow (ADR 0003).

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../templates/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_       | What it will cover                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `the-finish-stages.md`       | The Stage order, serial-vs-parallel rules, fail-fast, and the gotchas pointer on fail.                |
| `capabilities-and-checks.md` | The five known Capabilities, the derived Stage, custom Checks, and how the Engine finds them.         |
| `scopes-and-gates.md`        | Scope globs, fail-open classification, and wiring a Scope `gate` (ADR 0018).                          |
| `ratchets.md`                | Never-loosen floors/ceilings, the `DISCERN_METRIC` protocol, holding against `main`.                  |
| `the-json-report.md`         | The `finish --json` shape and how an agent reads pass/fail per Capability/Check (ADR 0004, ADR 0017). |

## See also

- [concepts.md](../00-orientation/concepts.md) — the gate in the daily loop.
- [finish-gate-gotchas.md](../80-development/finish-gate-gotchas.md) —
  non-obvious ways `finish` fails.
