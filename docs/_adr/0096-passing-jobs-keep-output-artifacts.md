# ADR 0096: Passing jobs keep output artifacts

**Status**: accepted; refines
[ADR 0028](0028-result-envelope-and-diagnostics.md) and
[ADR 0083](0083-normalize-and-offload-diagnostic-output.md)

## Context

The result envelope made failed gate jobs agent-readable: a non-zero command
produces a failed `steps[]` entry plus `diagnostics[]` carrying the command and
captured output. Successful jobs were intentionally lean. Their captured output
was used only for human buffered printing and then disappeared from the JSON/MCP
result.

That left a blind spot for tools whose exit code does not reflect every
important thing they print. For example, some analyzers pass compiler
diagnostics through while still exiting zero because their own contract is
"return non-zero only for lint violations." Under quiet `--json` and MCP, such a
job was indistinguishable from one that printed nothing. An agent could not ask
whether a passing step was loud, nor fetch the output when the project looked
suspicious.

The constraint remains the same as ADR 0028: discern is stack-neutral. It can
observe exit codes and output bytes; it should not hard-code tool-specific
meaning into the gate. Error-shaped text is a useful signal, but it is not a
portable failure predicate.

## Decision

Every gate job records a best-effort OS-temp output artifact and exposes it on
the corresponding executed `steps[]` entry as `output_path`. The step also
reports `output_lines` and `error_like_lines`, where "error-like" is a generic
transport-level heuristic for lines such as `error:`, `warning:`, Rust-style
`error[...]`, and compiler caret lines.

When a job exits zero but prints many error-like lines, discern adds an advisory
`hints[]` entry pointing at the output artifact. The advisory never changes
`ok`, `outcome`, `failed_stage`, diagnostics, or the process exit code. Exit
status remains the pass/fail contract.

The artifact path is separate from diagnostic `output_path`. A failed diagnostic
still carries its capped, normalized Tier-0 excerpt and only offloads that full
normalized diagnostic text when truncation happens. The step artifact is the
job-level escape hatch: a local handle for inspecting the whole run, including
successful jobs and stream-mode output.

The explicit noes:

- **No hard failure based on text patterns.** Error-like output has false
  positives and stack-specific meaning.
- **No per-tool parser in the gate core.** SARIF and future declared formats
  stay diagnostic Tier 1.
- **No repo-local log directory.** The artifact is temporary local state, not a
  new project footprint.
- **No diagnostic for a passing job.** `diagnostics[]` remains the structured
  "why this failed" channel.

## Consequences

Agents can now inspect loud successful jobs through the same envelope they
already read for failures. A SwiftLint-like analyzer that exits zero while
printing many compiler-shaped diagnostics is no longer silent in MCP: the step
shows counts and an output path, and the result carries a hint.

The result schema grows three optional step fields, so the TypeScript result
types, Zod schemas, MCP output schemas, and schema-faithfulness tests must move
together. This is a small wire-shape expansion, but it stays backward-compatible
for consumers that ignore unknown optional fields.

The heuristic can still be noisy or miss a tool's real warning vocabulary. That
is acceptable because it is advice, not a verdict. Projects fix noisy-success
cases by scoping or configuring their own commands, not by asking discern to
guess tool semantics.

Artifacts are best-effort temp files. If creating or writing one fails, the job
result still reports the exit status and counts it observed, and the gate result
does not change.

## Alternatives considered

**Fail the gate when a passing job prints error-like output.** Rejected because
the pattern is not a portable correctness rule. Some commands legitimately quote
failing examples, summarize past errors, or pass through harmless diagnostics.

**Only add counts, with no output file.** Rejected because it recreates the
original visibility problem at one remove: an agent can see that something was
loud but still cannot inspect it without re-running outside the harness.

**Only persist output for suspicious passing jobs.** Rejected because deciding
whether output is suspicious is the fragile part. Persisting every job's output
keeps the mechanism simple and makes the heuristic optional advice on top.
