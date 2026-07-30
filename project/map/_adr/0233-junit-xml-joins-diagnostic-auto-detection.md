# ADR 0233: JUnit XML joins diagnostic auto-detection

**Status**: accepted. Extends [ADR 0028](0028-result-envelope-and-diagnostics.md)'s Tier-1 normalization and follows [ADR 0083](0083-normalize-and-offload-diagnostic-output.md)'s offload boundary; the declared text-format slice stays future work.

## Context

A failed gate job becomes structured diagnostics only when its output arrives in a machine format discern recognizes. Until now that meant SARIF, which linters and type-checkers emit and test runners generally do not. A red test stage therefore produced one Tier-0 diagnostic: the job label, the exit code, and a captured output blob.

The local logbook made the cost concrete. It records diagnostics as classes — tool, rule, file — so a recurring failure can be attributed across branches. With test failures carrying neither rule nor file, the record read `test` and nothing else. When the practice logbook flagged one tree flipping red and green across four identical runs, no recorded evidence could name the test that flipped: the flake analysis had to be reconstructed from run durations and timestamps.

JUnit XML is the test-runner counterpart of SARIF: a cross-runner report format most test tools can emit behind a flag (`--reporter=junit`, `--junit-xml`, and similar), naming each failing case, its file when the runner knows it, and its failure message.

## Decision

**Diagnostic normalization auto-detects JUnit XML beside SARIF.** The doctrine is unchanged from ADR 0028: discern recognizes the format, never the tool, so the stack-neutral core stays neutral and a project opts in by making its command emit the format — no configuration surface is added.

Detection requires a real `<testsuites>`/`<testsuite>` element with a matching close tag, sliced out of surrounding runner noise. Only cases carrying a failure or error element become diagnostics: `file` prefers the case's own `file` attribute, then a path-like `classname`, then a path-like enclosing suite name — a dotted language identifier is never mistaken for a path. The test's name rides in `rule`, so a recorded diagnostic class identifies the exact test. A report with no failing cases keeps the Tier-0 raw output: a runner that crashed before the suite still shows its real output rather than an empty normalization.

This repository's own test job now runs with `--reporter=junit`, dogfooding the tier.

## Consequences

- A red test stage names each broken test with file, line, and message instead of handing back one opaque blob; agents jump to the failure without scraping output.
- Logbook diagnostic classes for test failures become attributable, so recurring-failure and flake findings can name the test rather than the stage.
- Parsing is a bounded, defensive scan, not a full XML parser: a writer that leaves a raw `>` inside attribute values (real emitters escape it) degrades that case's parse, and any unrecognized document falls back to Tier-0 untouched.
- The gate's captured raw output for this repository's test job is now XML. That trade is deliberate: when normalization succeeds the structured findings replace the blob, and when it cannot, the XML still carries the failure text.

## Alternatives considered

- **The declared regex slice (`[diagnostics.<name>]`) first.** Rejected for this need: it requires a new config surface, and test runners already share a structured format the SARIF precedent handles config-free. The regex slice remains the plan for tools with no machine format at all.
- **Parsing each runner's human text.** Rejected: it binds the core to named tools, which the stack-neutral rule forbids.
- **A JUnit file path (`--junit-path`) read from disk.** Rejected: diagnostics normalize from captured output; reading report files would add a second evidence channel with its own lifecycle and staleness questions.
