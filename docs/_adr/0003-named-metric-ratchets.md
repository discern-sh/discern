# ADR 0003: Named metric ratchets, with an explicit metric-emission convention

**Status**: accepted; **amended by the 1.0 redesign** — see _Update (1.0)_
below.

## Update (1.0)

The original decision (below) made coverage a privileged _built-in_ ratchet: the
`[ratchets].coverage_min` scalar, a reserved name `coverage`, a `0`-disables
rule, and a legacy `NN%` output-scraping fallback — all special cases the engine
carried for backward compatibility with the kit's first, coverage-only ratchet.

The 1.0 redesign **removes that privilege**. There is now exactly one model:

- **Every ratchet is a `[ratchets.<name>]` table** with `metric` / `direction` /
  `limit` / `slot`. Coverage is just the conventional name for one
  (`[ratchets.coverage]`); nothing about it is special.
- **`coverage_min`, the reserved name, the `0`-disables rule, and the `NN%`
  fallback are gone.** The `DISCERN_METRIC <name> <number>` marker is the _only_
  way a slot reports a number. A ratchet's `limit` and `slot` are both required.
- **One command, `agent ratchets`**, runs every `[ratchets.<name>]`.
  `agent finish:coverage` / `agent finish:ratchets` are removed.
- A measurement slot is an ordinary `[slots.<name>]` with **no `phase`** (the
  gate never runs it; the ratchet runs it on demand) — see _Update (1.0)_ in the
  slot/phase model. The phantom `coverage` phase is gone.

`discern migrate` rewrites a pre-1.0 `coverage_min` into a `[ratchets.coverage]`
table. Everything in the original decision about the _mechanism_ (two halves:
never-loosened-vs-`main`, measured-vs-limit; `up`/`down`; the emission
convention) stands unchanged — only coverage's special-casing was dropped.

## Context

The kit ships exactly one ratchet: coverage. `agent finish:coverage` enforces
two halves — the floor in `[ratchets].coverage_min` may never be lowered versus
`main` (the floor only rises), and measured coverage may never fall below it.
The measured value is obtained by a **fragile heuristic**: run the coverage slot
and grep the _last_ `NN%` it prints. That works for coverage tools that
conventionally end with a total percentage, but it is brittle (any stray
percentage wins) and single-purpose (only coverage, only percentages).

Plenty of other numbers deserve the same "only-ever-improve" treatment: lint or
type-error counts, bundle/artifact size, a performance budget, type-coverage.
The ratchet _mechanism_ — declare a limit, compare it against `main` so it can
only tighten, and check a measured value against it — is general. Only the
wiring is coverage-specific.

Two constraints bound the design:

- **Coverage must keep working unchanged.** `[ratchets].coverage_min` and its
  never-lowered-vs-`main` check are the template default and existing installs
  depend on them. Coverage has to become _one instance_ of the general mechanism
  without changing its behaviour or its config key.
- **Stack-neutral, no runtime.** The metric a slot produces is project-specific;
  the engine cannot know its output format. It needs a robust, declared way for
  a slot to _report_ a number, replacing the grep.

## Decision

Generalise to **N user-named numeric ratchets** with an explicit metric-emission
convention; coverage becomes the built-in instance.

### Metric-emission convention

A slot reports a metric by printing a line:

```
DISCERN_METRIC <name> <number>
```

The engine runs the slot, captures its output, and takes the **last**
`DISCERN_METRIC <name>` value (last-wins, so a re-measured value supersedes).
This replaces the grep with an explicit, named marker that cannot be confused
with incidental output. For **backward compatibility, the coverage ratchet also
accepts a trailing `NN%`** when no `DISCERN_METRIC coverage` line is present —
so existing coverage slots that print `87.4%` keep working untouched.

### Named ratchets

Each `[ratchets.<name>]` table declares:

| key         | meaning                                                                                                  | default          |
| ----------- | -------------------------------------------------------------------------------------------------------- | ---------------- |
| `metric`    | the metric name the slot emits                                                                           | the ratchet name |
| `direction` | `up` (value should rise; `limit` is a **floor**) or `down` (value should fall; `limit` is a **ceiling**) | `up`             |
| `limit`     | the floor/ceiling (a number) — **required**                                                              | —                |
| `slot`      | the `[slots.<name>]` whose output emits the metric — **required**                                        | —                |

Each ratchet enforces the same two halves coverage does, generalised by
direction:

- **Never loosened vs `main`.** The `limit` on this branch is compared to its
  value on `main` (read cheaply from `git show main:discern.toml`). For `up`,
  the floor may only rise; for `down`, the ceiling may only fall.
- **Measured vs limit.** Run the slot, read the metric, and for `up` fail when
  `measured < limit`; for `down` fail when `measured > limit`.

### Coverage as the built-in instance

Coverage is `name = coverage`, `direction = up`, `metric = coverage`,
`limit = [ratchets].coverage_min`, measured by the **coverage-phase slots**
(`slots_for_phase coverage`), with the legacy `%` fallback. `coverage_min <= 0`
disables it, exactly as before. The name `coverage` is reserved for this
instance.

### Commands

- `agent finish:coverage` runs **only** the coverage ratchet — unchanged
  behaviour, refactored to call the shared engine.
- `agent finish:ratchets` (new) runs **every** configured ratchet: coverage
  (when its floor is set) plus each `[ratchets.<name>]`. Every ratchet runs even
  if one fails (you see all shortfalls), and the recipe exits non-zero if any
  failed.
- Both are on-demand and slow, NOT part of `agent finish`. The `finish` coverage
  reminder now points at `agent finish:ratchets` when named ratchets exist.

The shared logic lives in `lib/ratchets.sh` (`ratchet_check <name>`), so there
is one implementation behind both recipes.

## Consequences

- Any only-ever-improve number is now ratchetable in any language — lint counts,
  artifact size, perf budgets, type-coverage — via a small, declarative table.
- The metric read is robust: an explicit `DISCERN_METRIC` marker instead of "the
  last percentage we happened to see". Coverage keeps its `%` fallback, so
  nothing existing breaks.
- Backward compatible: with no `[ratchets.<name>]` tables and the default
  `coverage_min = 0.0`, behaviour is identical to before;
  `agent finish:coverage` is byte-for-byte equivalent in semantics.
- One more on-demand recipe (`finish:ratchets`) and a new engine lib. The recipe
  set stays auto-discovered.
- A ratchet that shares its measurement slot with another runs that slot once
  per ratchet (the on-demand path is already slow; deduping is a future
  optimisation, noted not built).

## Alternatives considered

- **Keep grepping, just parameterise the regex.** Rejected: still brittle, still
  guessing at output shape. An explicit emitted marker is the robust fix and
  costs a slot one `printf`.
- **Write metrics to a file (`.discern/metrics/<name>`) instead of stdout.** A
  reasonable alternative, but it needs file-path coordination and cleanup, and
  couples the slot to a directory convention. A stdout marker is zero-setup and
  composes with any command via a pipe. (The file approach remains open as a
  future addition if a need appears.)
- **Measure the metric on `main` too (true measured-vs-main).** Rejected as too
  costly and stack-entangled: it means checking out / building `main`. Comparing
  the _declared limit_ vs `main` (as coverage already does) is cheap, git-only,
  and catches the real failure mode — silently loosening the gate.
- **A general `direction`-less "compare to a baseline" ratchet.** Rejected:
  `up`/`down` makes the floor-vs-ceiling intent explicit and the messages
  legible ("below the floor" / "exceeds the ceiling").
