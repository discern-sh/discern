# ADR 0248: Crashes leave a report and a distinct exit code

**Status**: accepted.

## Context

A crash — an unexpected throw no verb turned into a structured refusal — had no treatment of its own. The CLI's top-level catch recognized only the two config-error classes; anything else propagated to the Deno runtime's default handler: a raw stack dump on stderr, exit 1, stdout empty in `--json` mode, and nothing retained anywhere. The MCP catch-all kept the server alive but discarded the stack entirely. The logbook recorded a bare `failed` event indistinguishable from an ordinary red verb.

The users who hit these failures are exactly the ones who cannot debug them: they run a compiled binary, on states we never reproduced (filesystem races, odd git configurations, permission errors). Their realistic bug report was a pasted stack of unknown version and platform — or, over MCP, nothing at all. Exit 1 also made a discern bug indistinguishable from a red gate to any script or CI wrapper.

Two standing promises constrain the design. The logbook records metadata only — names and numbers safe to read aloud, never message bodies. And discern makes no network calls, so any crash evidence must stay on the machine until the user chooses to share it.

## Decision

**Every surface routes an unexpected throw through one shared crash module (`src/engine/crash.ts`), with four evidence surfaces and a distinct CLI exit code.**

- **A report file** under `<git-common-dir>/discern/crash/` (a common-scope Git-admin-state registry entry, beside the logbook — never inside the project tree), named by sortable timestamp, process id, and a random unique suffix. It carries the discern version, Deno runtime, platform, verb, error, and full stack. The newest 20 are kept; outside a repository the report falls back to a system temp file. Writing is best-effort and never throws — a reporting failure must not mask the crash.
- **A stderr frame** (CLI only): the version, the verb, the full error, the saved report's path or write failure, and the issue tracker. The terminal keeps the full story even if the file is never found.
- **A uniform machine envelope**: `ok: false`, `error: "internal_error"`, with the report path in `message` when a file was written. The CLI emits it on stdout in `--json` mode; MCP returns it as the tool result and the server keeps serving. It carries no `data` or stack, so the typed per-verb output schemas stay intact.
- **A logbook signature when recording is available**: the `failed` event gains `crash: {name, frame}` — the error's class name and one trimmed code location, never the message, inside the metadata-only bar. Root or config resolution can fail before recording opens, and `[project].logbook = false` disables it. `recordedOutcome` maps `internal_error` to `failed`, not `refused`: a crash is work that died, and refusal statistics must not absorb it.
- **Exit code 70** (the `sysexits` convention's `EX_SOFTWARE`) for a CLI crash, so automation can tell "discern is broken" from an ordinary failed verb's exit 1. Signal exits (129/130/143) are unchanged.

The signature stays in invocation-owned state from catch to recorder. The CLI wrapper keeps it in a local variable. MCP returns it beside the result as part of the pending tool call, so overlapping requests cannot exchange signatures through process-global state. The existing drain parity guard (`tests/result_capture_drain_parity_test.ts`) remains responsible for the shared delivery mailboxes in `result_capture.ts`.

`DISCERN_CRASH_PROBE` (any non-empty value) makes each CLI verb or MCP tool handler that reaches the recording chokepoint throw while the variable remains set: deterministic fault injection for the end-to-end tests, and a way for a user to see the whole path fire. Last-resort `unhandledrejection`/`error` listeners, registered only in the real binary, route stray async failures through the same frame with a re-entrancy latch.

## Consequences

- A v1.0.0 bug report can carry a version-stamped, platform-stamped stack that maps onto the published source at that tag (`deno compile` rewrites module paths to a virtual root, so no build-machine paths leak — and no user paths beyond what the error message itself quotes).
- Agents driving `--json` or MCP read a crash as a structured result instead of a broken stream, and can relay the report path when one was written.
- `discern patterns` and support can separate crashes from red gates in the logbook, and join an event to its report file by time and verb.
- The crash directory adds one Git-admin-state entry and at most 20 small files per repository; the report file itself may quote user paths inside error messages, so the docs tell users to skim before attaching.
- A crash inside the crash path still exits 70 (the latch), at worst without a saved report.

## Alternatives considered

- **Keep propagating to the runtime's default handler.** Free, but it drops the version, the verb, the exit-code distinction, and every retained artifact — the status quo this record replaces. Rejected.
- **Carry the report path and signature in the envelope's `data`.** It would break the typed per-verb output schemas MCP declares. The message already carries the user action, while invocation-owned state carries the signature to the recorder. Rejected.
- **Record the error message or stack in the logbook.** Messages quote paths and values; the logbook's bar is metadata safe to read aloud. The report file already holds the full text, under the user's control. Rejected.
- **Upload crash reports.** discern makes no network calls; a crash reporter is not the place to start. Rejected.
- **A doctor-style support bundle command.** Complements rather than replaces the crash path, and nothing yet shows it is needed; revisit if reports arrive missing context.
