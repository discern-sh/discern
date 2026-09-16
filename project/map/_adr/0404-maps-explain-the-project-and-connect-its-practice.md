# ADR 0404: Maps explain the project and connect its practice

**Status**: accepted on 2026-09-16. Amends [ADR 0100](0100-project-map-is-the-agents-map.md), [ADR 0202](0202-the-gate-ships-the-map-integrity-preflight.md), and the map workflow described in [ADR 0314](0314-separate-public-manual-and-project-map.md).

## Context

A project's map is an explanation for its agents and a way for its owner to inspect their understanding. discern's own extensive numbered map and former publication workflow are local choices. Shipping them as universal requirements encourages code transcription, unfinished setup pages, and unnecessary documentation machinery.

## Decision

Setup completes the smallest useful structured map: a substantive overview, orientation, real subsystem boundaries, development guidance, and a completed adoption decision. The design-principles page gives the owner and future agents agreed rules for current and future work. The gate-gotchas page starts with stack-independent recovery advice and grows with verified project lessons. These remain dedicated references; other short topics can share a region README. Numbered folders remain optional. New features extend the appropriate region; a new durable responsibility can earn another region.

Pages explain behavior, constraints, boundaries, and relationships with links to evidence. They may summarize implementation when that helps a reader make a correct change. They do not transcribe methods or maintain independent copies of derivable inventories. Requirements, observed behavior, and open questions remain distinct.

Setup, compiled guidance, checkpoints, and a maintenance guide carry the generic method. The bundled subsystem-documenting skill and its seeded assignment manifests retire. Project-specific editorial policy stays project-owned. The map connects instructions, skills, checks, decisions, and outstanding work by linking their authorities.

Local discovery, currency, and publication are separate. Current supporting pages under `_internal` are searchable and checked. Historical ADR bodies are not a current account; private material stays outside default discovery. Publication filters remain explicit for the manual, website directory, and exports. Freshness is page-level evidence of linked source changes, not a verdict on correctness. Checkpoints direct review toward affected explanations and substantive map changes.

An ADR preserves a significant architectural choice that is hard to reverse, surprising without context, and involves a real trade-off. Current implementation explanations belong in the map; tests and architectural guards protect behavior. It records an approved exception; it does not grant permission to override a project constraint. The seeded adoption record establishes the convention without proving that other important decisions have been captured.

## Consequences

Projects get a finished starting point and a clear extension rule without inheriting discern's private editorial machinery. Linking evidence and making review judgments still requires agents; mechanical checks establish structural integrity and review candidates, not semantic truth. Existing authored maps and optional numeric ordering remain supported.
