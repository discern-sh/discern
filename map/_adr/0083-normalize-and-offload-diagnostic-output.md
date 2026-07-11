# ADR 0083: Captured diagnostic output is normalized and offloaded when truncated

**Status**: accepted; refines
[ADR 0028](0028-result-envelope-and-diagnostics.md)

## Context

[ADR 0028](0028-result-envelope-and-diagnostics.md) made a failed gate command's
captured stdout and stderr part of the `Diagnostic` envelope so an agent can
loop act -> read-error -> fix without re-running the command and scraping
stderr. That stack-neutral Tier-0 floor was intentionally simple: capture the
combined output, cap it inline, and leave tool-specific parsing to Tier 1.

Real command output exposed a gap between stack-neutral and byte-transparent.
Many tools write terminal controls even when their output is being captured:
ANSI colour, OSC hyperlinks, progress bars that redraw a single line with
carriage returns, bells, and cursor controls. Passing those bytes through makes
the JSON diagnostic harder to read, and a carriage-return progress bar can fill
the inline cap with overwritten states while pushing the real error past the
tail boundary. Even when the text is clean, some failures produce enough output
that a 16 KB inline excerpt is too much context for an agent to carry by
default.

The constraint is still discern's central one: the harness must not learn the
semantics of any particular tool. Normalizing terminal transport controls and
bounding the inline view are generic output hygiene; parsing compiler or test
messages is stack knowledge and remains out of Tier 0.

## Decision

Tier-0 diagnostic output is normalized at the diagnostic boundary before it is
capped. The normalizer is deliberately transport-only:

- carriage-return rewrites collapse to the final visible segment before any
  length cap is applied;
- ANSI CSI/SGR sequences, OSC sequences, and simple escape controls are removed;
- other C0 controls are dropped, while newlines and tabs remain.

The gate also tells spawned jobs they are being captured by passing `NO_COLOR=1`
and `TERM=dumb` into the `sh -c` process. This reduces colour and animation at
the source for tools that honor those conventions. It is only a hint: the
diagnostic boundary remains the guarantee, because some tools force terminal
controls anyway.

When the normalized capture exceeds the inline cap, the diagnostic keeps the
bounded head-and-tail excerpt in `output`, sets `truncated: true`, and
best-effort writes the full normalized capture to an OS temp file surfaced as
`output_path`. The file is written only when truncation happens. If creating or
writing it fails, discern omits `output_path` and still returns the capped
diagnostic; a convenience handle must never fail the gate.

The temp file is outside the repository. This preserves the single-root
`discern.toml` footprint from [ADR 0020](0020-dissolve-discern-dir.md) and
avoids a repo-local scratch directory or gitignore rule. The path is an
absolute, local handle: cheap for an agent to read when the excerpt is not
enough, absent from normal review history, and allowed to expire with the
operating system's temp cleanup.

The explicit noes:

- **No per-tool parsing in Tier 0.** SARIF and any future declared formats stay
  Tier 1.
- **No raw-byte promise for diagnostic `output`.** Terminal controls are not the
  message; the visible text is.
- **No repo-local diagnostic cache.** The full capture is a temporary handle,
  not a new committed footprint.
- **No gate failure for offload failure.** The inline excerpt remains the
  contract.

## Consequences

An agent reading a failed `discern_finish`, `discern_prepare`, or `discern_test`
result gets clean, bounded text instead of terminal-control noise. A noisy
progress bar collapses before the cap is applied, so progress bytes cannot bury
the real failure. When the excerpt is insufficient, the full normalized capture
is one file read away.

Tier 0 remains stack-neutral. It knows terminal transport conventions, not the
language, framework, compiler, test runner, package manager, or linter that
produced the output. Structured meaning still belongs to Tier 1.

The diagnostic shape gains `output_path?: string`, so the TypeScript interface,
the Zod schema, the MCP output schema, and schema-faithfulness tests must move
together. Diagnostic serialization now has a best-effort filesystem side effect
when truncation occurs.

The temp file can disappear after the run, and in streaming mode it contains the
same byte-capped capture window the runner retained, not a new unbounded stream.
That is acceptable: `output_path` is a convenience for the available full
normalized capture, not a promise to re-run or persist logs forever.

## Alternatives considered

**Leave Tier 0 byte-transparent and ask agents to post-process output.**
Rejected because it breaks the point of the result envelope: agents should fix
from diagnostics, not wrap discern in another summarizer.

**Add per-tool parsers for common noisy commands.** Rejected because it bakes
stack knowledge into the neutral core and still misses the long tail. Terminal
control normalization catches the transport problem without knowing the tool.

**Write every failed capture to a repo-local diagnostics directory.** Rejected
because it creates a new managed footprint and gitignore concern in every
project. Temp files keep the handle local and disposable.

**Always write `output_path`, even when `output` is not truncated.** Rejected
because a complete inline `output` needs no duplicate. The handle exists to
avoid context flooding, not to duplicate small diagnostics.
