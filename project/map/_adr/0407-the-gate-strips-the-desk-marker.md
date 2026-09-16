# ADR 0407: The gate strips the desk marker

**Status**: accepted on 2026-09-16; extends [ADR 0157](0157-the-desk-owns-launched-child-sessions.md)

## Context

ADR 0157 gives every arbitrary-code child of the desk the `DISCERN_DESK_SESSION` marker so a nested desk refuses to start. It accepted that commands and tests run beneath a desk child inherit the marker too, on the grounds that only desk entry and `doctor` context consume it, so project automation stays deterministic.

That consequence did not hold. A project's own checks may run `discern`: a test that captures `doctor` output, or one that drives the desk or bare `discern` in a pseudo-terminal, reads the marker and behaves differently beneath the desk. This repository's gate showed it directly. `discern done` launched from a desk-owned shell failed two real-terminal tests — one because the desk under test refused to open, one because `doctor` printed an extra environment line — and those failures took the coverage standards down with them, while the same commit passed from an ordinary shell. Two test spawn helpers already blanked the marker for exactly this reason, but a later pseudo-terminal harness was never enrolled, so the fix protected instances rather than the class.

The gate already fixes the environment its commands inherit: `CI=1`, `NO_COLOR=1`, `TERM=dumb`, and a blanked `FORCE_COLOR`, so evidence does not depend on the terminal that launched the gate. The desk marker is the same kind of ambient launch context.

## Decision

**The gate's fixed child environment blanks `DISCERN_DESK_SESSION`.** Every configured job runs with the marker neutralized, whatever the launching shell holds. One overlay, `withoutDeskSessionEnv()`, sits beside the overlay that sets the marker and the predicate that reads it, so the blank cannot drift from the value the predicate recognizes.

The marker is blanked rather than removed. A child environment merges over its parent's, and clearing the whole environment would discard `PATH`, `HOME`, and every toolchain setting the project's commands need. A blank value is what `inDeskSession` treats as absent.

This repository applies the same overlay at its own suite entry and in its canonical pseudo-terminal driver, so `deno task test` and a lone real-terminal test stay deterministic even when they bypass the gate. A test that needs the marker sets it explicitly, exactly as before.

## Consequences

- A gate launched beneath the desk records the same evidence as one launched from any shell. Proof no longer depends on whether the operator reached the gate through a desk shell.
- The desk's nested-start refusal is unaffected: the marker still reaches every shell, coding agent, and Project Script the desk launches, and the desk still refuses beneath it. Only the gate's job boundary neutralizes it.
- ADR 0157's claim that project automation beneath a desk child remains deterministic now rests on this boundary rather than on the set of consumers staying small.
- A future spawn funnel in this repository inherits the blank from the suite entry, so a forgotten overlay no longer reproduces the failure; a raw `deno test` launched beneath the desk fails one self-explaining check instead of a cascade.

## Alternatives considered

**Blank the marker in each test helper as the need appears.** That was the previous state. It cured the helpers that existed and missed the next one.

**Make `doctor` and bare `discern` ignore the marker when not interactive.** Rejected because it makes every consumer responsible for guessing whether it is under test, and ADR 0157 already rejected verb-by-verb desk awareness for the same reason.

**Clear the gate's environment and rebuild it from an allowlist.** Rejected because the gate deliberately inherits the operator's toolchain environment; the fixed values are overrides on top of it, and the marker joins them as one more override.

**Have the desk stop passing the marker to shells.** Rejected because the marker exists to stop a nested desk from inside precisely those shells.
