# ADR 0196: Coupling advice runs with the gate by default

**Status**: accepted; amends [ADR 0084](0084-co-change-coupling-advisory.md) and [ADR 0101](0101-retire-the-features-toggles.md)

## Context

ADR 0084 kept `[coupling].in_gate` off until its fixed judgment constants had been tested across repositories with different sizes, ages, and commit habits. That calibration is complete. The unsolicited gate threshold has proved reliable across the reviewed repositories, while the direct command retains its broader exploratory threshold.

The opt-in default now hides a useful result from the place it was designed to matter: the end of `discern prepare` and `discern done`, while the change is still open. The advisory is already bounded, suppressed during setup, and incapable of changing `ok`, the exit code, or the failed stage.

## Decision

`[coupling].in_gate` defaults to `true`. Fresh configs write that value, and the schema uses it when the section or key is absent. `in_gate = false` remains the explicit way to keep coupling available only through `discern coupling`.

Schema 23 enables the setting for prerelease installs. Their templates wrote `false`, so the migration cannot distinguish the generated value from an early opt-out. The migration turns it on once; a project that wants on-demand-only coupling can set it back to `false` after upgrading.

The advisory remains non-blocking. Automatic hints continue to use the stricter presentation threshold and appear only after a successful, fully set-up run.

## Consequences

- Fresh and upgraded projects receive diff-aware coupling suggestions during the normal agent loop without configuration.
- Repositories with too little usable history receive no suggestion. Gate outcomes remain unchanged.
- Every invocation still recomputes the bounded history model; enabling the default spends that read cost on successful `prepare` and `done` runs.
- The calibration idea is complete and leaves the ideas index.

## Alternatives considered

- **Keep the default off.** Rejected because the completed calibration removed the uncertainty that justified opt-in, and an undiscovered setting cannot help an agent during a change.
- **Promote coupling findings to failures.** Rejected because historical association remains evidence for inspection, not proof that a companion change is required.
