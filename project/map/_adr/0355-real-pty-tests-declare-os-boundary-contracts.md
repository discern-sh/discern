# ADR 0355: Real PTY tests declare operating-system boundary contracts

**Status**: accepted. Extends the pure Desk presentation boundary from [ADR 0352](0352-desk-decisions-cross-a-pure-responsive-presentation-boundary.md), the external terminal rendering boundary from [ADR 0279](0279-external-terminal-rendering-crosses-one-process-boundary.md), and canonical-set parity from [ADR 0051](0051-canonical-set-parity.md).

## Context

Terminal regressions need two different kinds of proof. State legality, semantic grouping, focus, content, layout, viewport policy, defaults, and Unicode editing are product decisions. Running their variant matrices through an operating-system process and pseudo-terminal made those assertions depend on scheduling even though production model, runtime, presenter, and visible-cell seams could decide them deterministically.

Line discipline, signal and end-of-input delivery, kernel resize notification, terminal-mode restoration, control-sequence rendering, hardware wrapping, descendant cleanup, and the BSD or util-linux `script(1)` transport do not exist below the host boundary. Replacing those journeys with mocks would remove the property under test.

Filename conventions could identify the existing `*_tty_test.ts` population but could not find a new transport in another fixture tree, an ordinary engine test that reused the driver, or a repository capture command. A maintained file inventory would drift in the same way. The test architecture needs one unavoidable transport, an explicit reason for crossing it, and enrollment that widens when Git sees a new container.

## Decision

[`tests/real_pty.ts`](../../../tests/real_pty.ts) is the canonical set of operating-system contracts that justify real pseudo-terminal work. Every test crosses the boundary through `realPtyTest`; repository capture tooling crosses it through `withRealPtyBoundary`. Each declaration names one or more contracts and states whether the journey is a retained cross-platform canary. The canonical PTY driver rejects an undeclared caller before it constructs `script(1)` and includes the declaration, host platform, phase, readiness predicate, and raw transcript in failure evidence.

[`tests/real_pty_guard_test.ts`](../../../tests/real_pty_guard_test.ts) scans the Git-derived TypeScript universe that includes executable fixtures. It permits PTY and terminal-mode primitives only in the canonical driver and resize harnesses, validates literal boundary declarations, and requires every contract to retain a canary. A fresh fixture container that constructs a transport and a fresh caller that invokes the canonical driver both fail without adding guard cases.

Semantic matrices run at the deterministic production seam that owns their decision. A mixed journey keeps one representative PTY route for its host-owned property and moves its content, fleet-size, focus, layout, viewport, mode-policy, or dispatch variants below the boundary. A real PTY is not retained merely because a test already uses one.

The canary flag selects from the same declarations the class guard validates. Canary tests remain ordinary discovered Deno tests; there is no separate workflow or manually duplicated canary file list. The canonical `deno task test` therefore carries them through the complete Ubuntu Gate and the configured macOS and Windows Subsystem for Linux 2 (WSL 2) Gate lanes.

## Consequences

- New PTY transports and new canonical-driver consumers auto-enroll even when their filenames and directories are novel.
- Every retained journey names the host behavior its deterministic siblings cannot create. Review can distinguish a required kernel boundary from a semantic permutation before paying its runtime and flake surface.
- Variant matrices fail at the model, runtime, presenter, adapter, or visible-cell seam with semantic assertions and no process scheduling.
- The declaration wrapper and structural scan add repository-only test infrastructure. Capture scripts must also declare their boundary because they deliberately reuse the test transport.
- The canary set is mechanically complete per contract but not minimal by count. Multiple journeys may retain the same contract when they exercise different product-to-host wiring.
- Cross-platform differences remain visible only when the complete Gate lane runs; the local guard proves enrollment and declaration, not BSD or util-linux behavior on a host that is absent.

## Alternatives considered

- **Keep real pseudo-terminals for all terminal assertions.** Rejected because semantic matrices would continue to infer product correctness through process scheduling and make coverage runs pay for unrelated kernel work.
- **Replace every PTY with a fake terminal.** Rejected because fakes cannot create line discipline, signals, end-of-input, resize notification, restoration, process lifecycle, hardware wrapping, or platform transport differences.
- **Maintain a registry of PTY test files.** Rejected because a new fixture container or ordinary test module could bypass a copied file list. Git-derived primitive detection and driver rejection make enrollment unavoidable.
- **Add a dedicated PTY workflow.** Rejected because the complete Gate already runs the canonical suite on Ubuntu and through its configured macOS and Windows Subsystem for Linux 2 (WSL 2) lanes. A second full run would duplicate cost without shortening diagnosis.
