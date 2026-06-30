# The quality gate

_`discern finish` — the compound gate that fixes, builds, checks, and tests
before work is called done._

This subtree covers the gate and everything it runs. The built-in
[`finish`](../../src/engine/gate/finish.ts) verb first runs a fail-fast **merge
check** — in a Worktree, that the branch contains the latest `main`
([ADR 0050](../_adr/0050-merge-check-fail-fast.md)); behind it, the gate stops
before spending the slow Stages on a result the forced re-integration would
discard. It then walks the **Stages** in order — **fix** (serial, mutating
fixers), **build** (parallel artifact producers), then **check** and **test** in
parallel — and each **Capability** and **Check** runs as its own labelled job,
so a failure points at the exact one rather than a whole Stage. A known
Capability's Stage is derived from its name; a Check states its own. After the
Stages come the **Scope** `gate`s for any Scope that changed.

`discern prepare` is the fast inner loop: the fix-stage then check-stage work,
with no build or test. `--json` emits the **`DiscernResult` envelope** — the one
result shape every verb returns
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)):
`{ok, verb, steps, diagnostics?, hints?, data}`, a serialization of the plan
`finish` executed, not a re-derivation. Each Capability/Check/Scope gate is a
`steps[]` entry; a genuine failure also yields a `diagnostics[]` entry carrying
the command to reproduce it and its captured output (normalized to
file/line/rule when the tool emits SARIF) — so an agent loops act→read-error→fix
instead of re-running and scraping stderr. `hints[]` carries the next-step
advice the human tail prints. Under `--json` the envelope is the **entire**
output: all narration and command output is suppressed (not rerouted), so the
combined stdout+stderr is exactly that one object — safe for an agent to capture
([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).
`finish --dry-run` prints the plan (the jobs and Scope gates that _would_ run)
without running anything
([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)); it is honest that it
cannot predict which jobs fail-fast would skip. The same envelope is served to
agents natively over MCP by `discern mcp`.

The supporting ideas: **Capabilities** are the five known commands (`format` /
`build` / `lint` / `typecheck` / `test`) and a **Check** is custom gate work
with an explicit Stage (ADR 0017); **Scopes** classify which part of the repo a
change touches and **fail open** (an unknown path runs more gates, never fewer),
and a Scope can carry its own `gate` so a sub-component plugs in (ADR 0018);
**Ratchets** hold never-loosen metric floors and ceilings — a raw value or, via
`per`, a rate that doesn't rise just because the project grew — on demand,
outside `finish` because they are slow (ADR 0003, ADR 0057).

Alongside the gate sits the **[continuous-improvement coach](improve.md)**:
where `finish` asks _did this change pass?_,
[`improve`](../../src/engine/improve/rules.ts) asks _what should get better
next?_ It reports objective baseline health, keeps qualitative reviews visible,
and prioritizes one action. Deterministic rules remain distinct from subjective
reviews the agent judges against cited material
([ADR 0029](../_adr/0029-best-practices-audit.md),
[ADR 0078](../_adr/0078-improve-is-a-coach-not-an-audit.md)).

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet (except the written [`improve.md`](improve.md) and
> [`the-result-envelope.md`](the-result-envelope.md)). Fill the rest with the
> [`document-subsystem`](../../templates/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_                                         | What it will cover                                                                                                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `the-finish-stages.md`                                         | The Stage order, serial-vs-parallel rules, fail-fast, and the gotchas pointer on fail.                                                                            |
| `capabilities-and-checks.md`                                   | The five known Capabilities, the derived Stage, custom Checks, and how the Engine finds them.                                                                     |
| `scopes-and-gates.md`                                          | Scope globs, fail-open classification, and wiring a Scope `gate` (ADR 0018).                                                                                      |
| `ratchets.md`                                                  | Never-loosen floors/ceilings, raw counts vs `per` rates, the `DISCERN_METRIC` protocol, holding against `main`.                                                   |
| [`the-result-envelope.md`](the-result-envelope.md) _(written)_ | The `DiscernResult` envelope every verb returns, its `diagnostics[]`, the typed result schemas, and `discern mcp`'s self-describing surface (ADR 0028, ADR 0041). |

## See also

- [concepts.md](../00-orientation/concepts.md) — the gate in the daily loop.
- [finish-gate-gotchas.md](../80-development/finish-gate-gotchas.md) —
  non-obvious ways `finish` fails.
