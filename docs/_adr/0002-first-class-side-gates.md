# ADR 0002: Side-gates run with the slot phase model; path-scoped suppression deferred

**Status**: accepted

## Context

`[scopes.side_gates]` maps a scope name to a command that `agent finish` runs
when the branch changed that scope — the intended way a sub-component with its
own self-contained gate plugs into the top-level gate (e.g. a `native` sub-app
running `make -C native check` only when `native/` changed).

The slot phases (`fix∥build`, `check∥test`) run through `run_parallel`: every
command in a phase runs **concurrently**, output is **buffered and grouped under
a labelled banner**, and a single failure **aggregates** into one phase failure.
Side-gates did not get this treatment. They ran in a plain `for` loop _after_
the slot phases:

```sh
for scope in $(config_keys scopes.side_gates); do
    ... if changed ...
    eval "$gate_cmd" || die "The '$scope' side gate failed."
done
```

That means side-gates ran **sequentially**, **interleaved** their raw output
with no grouping, and **failed fast** — the first failing gate aborted before
the others ran, so you couldn't see all failures at once. They were second-class
relative to slots, despite being the generic monorepo / sub-project story.

Two further questions sit on top of this:

1. **`--json` aggregation.** Folding per-side-gate results into a
   machine-readable gate result presumes `agent finish` _has_ `--json`. It does
   not yet (that is a separate change). So the structured-output half is
   conditional on that work.
2. **Suppression.** A scope that owns its own gate ideally _suppresses_ the
   top-level slots for its paths, so a subdir isn't double-gated (once by its
   side-gate, once by the global `test`/`check` slots). But slots run
   **globally** today — there is one `test` slot for the whole repo; slot
   execution is not path-aware. Suppressing slots for a scope's paths means
   introducing path-scoped slot execution: a new execution model, not output
   plumbing.

## Decision

**Bring side-gate execution to parity with slots, and defer suppression.**

- **Parallel + grouped + aggregated.** The fired side-gates (those whose scope
  changed _and_ that have a non-empty command) are collected into a
  label/command list and run through the same `run_parallel` helper the slot
  phases use. Output is grouped under a `Running side gates for changed scopes…`
  banner, each gate labelled `side:<scope>`, and a single failure fails the
  gate.
- **Run-all, not fail-fast.** Because `run_parallel` runs every job to
  completion and returns non-zero if any failed, all fired gates now run even
  when one fails — you see every side-gate result in one pass. This is a
  deliberate behaviour change from the old fail-fast loop, matching how the slot
  phases already behave.
- **Phase position unchanged.** Side-gates still run _after_ `check∥test`, so a
  side-gate may still rely on the main `fix`/`build` having completed (e.g. it
  reads a built artifact). The change is the execution model, not the ordering.
- **No new config for the core change.** This is purely an upgrade to how the
  existing `[scopes.side_gates]` entries run. Existing configs benefit on the
  next `agent finish` with no edit.
- **`--json` aggregation is conditional on ADR 0004 (`finish --json`).** When
  that lands, each side-gate's pass/fail and duration join the per-slot results.
  Until then, side-gates aggregate into the human gate result and the process
  exit code, which stands alone.
- **Path-scoped slot suppression is deferred.** Shipping it would require making
  slot execution path-aware — a distinct execution model that deserves its own
  ADR and design. The intended eventual surface (sketch, **not implemented**) is
  a scope opting out of the global slots for its paths, e.g.

  ```toml
  [scopes.side_gates.native]
  run      = "make -C native check"
  # FUTURE (not implemented): suppress the global slots for this scope's paths
  # suppresses = ["check", "test"]
  ```

  Until then, a project that wants to avoid double-gating should scope its
  global slot commands itself (e.g. exclude the subdir in the tool's own
  config).

## Consequences

- Side-gates are now first-class: concurrent, legibly grouped, and aggregated —
  the monorepo / sub-project story works the way the slot phases do.
- A repo with several side-gates gets faster, clearer `finish` runs and sees all
  side-gate failures at once instead of stopping at the first.
- The run-all behaviour means a long side-gate is no longer skipped because an
  earlier one failed — marginally more work on a failing run, but complete
  information, consistent with the slot phases.
- Suppression remains a real gap for projects that genuinely double-gate. It is
  documented as deferred with a config sketch, so the direction is on the record
  without committing to a path-scoped execution model prematurely.
- `run_parallel` is now reused for a third caller; its grouped-output contract
  is load-bearing for side-gates too.

## Alternatives considered

- **Fold side-gates into the `check∥test` batch.** Rejected: a side-gate may
  depend on the main `fix`/`build` outputs, and conflating them removes the
  ability for a side-gate to assume the primary phases ran. Keeping side-gates
  as their own parallel group after the main phases preserves that ordering
  guarantee while still giving them parallelism.
- **Keep fail-fast.** Rejected for parity: the slot phases
  run-all-and-aggregate, and seeing every side-gate failure in one pass is more
  useful for a monorepo.
- **Ship suppression now.** Rejected as scope: it is a new execution model
  (path-scoped slots), not output plumbing, and the task explicitly calls for
  ADR-ing that decision on its own. The rest of the parity work stands without
  it.
