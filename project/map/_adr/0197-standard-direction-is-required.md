# ADR 0197: Every standard declares its direction

**Status**: accepted; amends [ADR 0003](0003-named-metric-standards.md)

## Context

A standard's direction decides what its limit means. `up` makes the limit a floor; `down` makes it a ceiling. Defaulting an omitted direction to `up` saved one line of configuration, but it also let a size, count, or latency budget silently acquire the opposite policy from the one its author intended.

That ambiguity is most expensive at the quality boundary. The same number drives branch comparison, measurement diagnostics, pinning, and the never-loosen rule. Those consumers should read declared intent rather than infer it from absence.

## Decision

Every `[standards.<name>]` table must declare `direction = "up"` or `direction = "down"`. The config schema rejects an omission, and `discern config set-standard` requires `--direction`.

Schema 23 does not infer or insert a direction for an existing custom standard. The shipped standards already declare one, and an owner-defined standard with an omission must be made explicit by its owner.

## Consequences

- Every standard is legible as a floor or ceiling at the point of definition.
- A copied or hand-authored standard cannot silently inherit a floor.
- Adding a standard through the CLI takes one more required option.
- An existing custom standard that relied on the old implicit `up` must add `direction = "up"` before its config is valid under schema 23.

## Alternatives considered

- **Keep `up` as the default.** Rejected because terseness is not worth hiding the policy that controls whether a number may rise or fall.
- **Infer direction from the metric name or command.** Rejected because names are open-ended and a command reports a number, not the owner's intent for it.
