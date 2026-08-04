# ADR 0256: The patterns report keeps each detector's strongest findings

**Status**: accepted

## Context

`patterns` shipped every finding its detectors produced. Findings scale with recorded history — branch-scoped detectors emit one per qualifying branch, trajectory detectors one per standard — so on this repository's own logbook the wire result reached ~64K characters, 88% of it `data.findings`, and overflowed the MCP tool-result budget agents read it through. The result spilled to a file, costing every reader either the report or a large slice of context. Every other history-fed surface already bounds itself (`status` caps its logbook hints, `update` caps its commit and file lists, `improvement` reads a bounded recent tail); the complete reader was the one unbounded wire.

Two constraints shaped the remedy. The result contract permits same-major additions only — no required field may weaken — and the ranked flat list is load-bearing for consumers and the human renderer alike.

## Decision

`data.findings` keeps each detector's strongest `PATTERNS_FINDINGS_PER_DETECTOR` (3) findings, preserving the existing rank order. When the bound elides anything, `data.findings_total` joins with the uncapped count, a notice hint names the elision and the escape hatch, and the human report marks each truncated detector block; `--all` (CLI) / `all: true` (MCP) lifts the bound. Detector rows keep counting everything they found, capped or not.

The bound is per detector, not global: strengths are unitless across detector kinds, so a global top-N would starve low-count detectors and erase report breadth. The wire result therefore scales with the detector registry, never with recorded history — `engine_patterns_test.ts` holds a plateau guard that grows the corpus and asserts the serialized result does not follow.

## Consequences

- Default reads stay small on any history; agents get the whole report shape (every detector accounted, strongest evidence per detector) in context.
- A consumer wanting exhaustive findings must ask (`--all`), and the elision is always declared — nothing is silently complete.
- The subject diversity inside one detector is bounded: a fourth standard's trajectory or a fourth thrashing branch is visible only as a count until `--all`. The attention banner already bounded itself, so nothing ranked above the cut disappears from the top of the report.

## Alternatives considered

Relocating `next_step` to the detector rows would remove most remaining repetition (per-detector advice repeats on every finding). Rejected for now: it weakens a required finding field, which the same-major result-contract policy forbids; the cap already bounds the repetition to the per-detector limit. Worth revisiting at the next result-schema major.
