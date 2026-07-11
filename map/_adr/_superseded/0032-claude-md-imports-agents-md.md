# ADR 0032: The Claude Code mirror imports AGENTS.md instead of duplicating it

> **Consolidated into
> [ADR 0034](../0034-agents-md-untracked-currency-check.md).** Its tracking
> premise was superseded there; the surviving `@AGENTS.md` pointer mechanism is
> described there. Kept for history.

**Status**: accepted; extends [ADR 0031](../0031-typed-provider-integration.md)
(the provider registry this adds a capability to). The _tracking_ premise here
("`AGENTS.md` is the one tracked file") is superseded by
[ADR 0034](../0034-agents-md-untracked-currency-check.md), which makes
`AGENTS.md` an untracked artifact; the pointer mechanism this ADR introduces is
unchanged.

## Context

`discern refresh` compiles one body —
`[built-in base] + [a section per enabled
feature] + [your sources]` — and
writes it to every provider file named in `[guidance].agents` (default
`claude_code` → `CLAUDE.md`, `codex` → `AGENTS.md`). `AGENTS.md` is the one
**tracked** file (so guidance changes show in review); `CLAUDE.md`/`GEMINI.md`
are gitignored mirrors.

Until now every provider file held a **byte-for-byte copy** of the compiled
body. For a project that emits both `claude_code` and `codex` that means two
identical multi-kilobyte files in the tree — `AGENTS.md` and `CLAUDE.md` —
differing only in name. The duplication is harmless to correctness (both are
regenerated) but genuinely confusing: a reader opening `CLAUDE.md` next to
`AGENTS.md` can't tell which is authoritative, and the redundancy invites the
question "why two copies?".

Claude Code already supports an **`@<path>` import** in `CLAUDE.md` (and in
`~/.claude/CLAUDE.md`): the referenced file's content is expanded in place at
load time. So a `CLAUDE.md` that is just `@AGENTS.md` is, to the agent,
identical to the full copy — without the second copy on disk.

## Decision

**A provider's guidance file can be a _pointer_ to the canonical tracked file
rather than a duplicate.** The `Provider.guidanceFile` record gains an optional
`pointer(canonicalPath) → body`; Claude Code's sets it to emit a do-not-edit
banner plus an `@<canonicalPath>` import line.

`compileGuidelines` resolves the **canonical** file — the tracked provider in
the current run (`codex` → `AGENTS.md`) — and, for each provider that declares a
`pointer`, writes the pointer body when that canonical file is also being
emitted (and isn't the file itself). Otherwise it writes the full compiled body.
So:

- `AGENTS.md` (tracked) — the full compiled body, the single source.
- `CLAUDE.md` — `@AGENTS.md`, expanded by Claude Code at load time.
- `GEMINI.md` — still a full copy; Gemini's include syntax isn't wired, so it
  has no `pointer` and falls through to the full body.
- A project emitting **only** `claude_code` (no tracked `AGENTS.md`) —
  `CLAUDE.md` falls back to the full body, since there is nothing to point at.

## Consequences

- **One source of truth on disk, visibly.** The guidance lives in `AGENTS.md`;
  the Claude mirror imports it, so the two can never drift and it is obvious
  which is authoritative. The confusing identical-twin files are gone.
- **No behaviour change for the agent.** Claude Code expands `@AGENTS.md` to the
  same bytes it used to read inline.
- **The pointer is a typed provider capability**, not a Claude-Code special case
  — a future agent with its own include syntax sets its own `pointer`, and the
  fallback keeps any single-provider or tracked-file-absent setup correct.
- **A stale `AGENTS.md` still fails CI** (`git diff --exit-code`); the
  gitignored `CLAUDE.md` pointer is stable text that doesn't change with the
  guidance, so it doesn't churn.

## Alternatives considered

- **Keep the byte-for-byte copy.** Rejected: it's the confusion this removes,
  and it duplicates a growing body in the tree for no benefit.
- **Make `CLAUDE.md` the tracked canonical and have `AGENTS.md` point at it.**
  Rejected: `AGENTS.md` is the cross-agent standard and the one we already track
  for review; Codex reads it literally and has no import syntax to rely on, so
  the full body must live there.
- **Also convert `GEMINI.md` to a pointer now.** Deferred: the `@`-import is
  Claude Code's mechanism; emitting it into `GEMINI.md` without confirming
  Gemini expands it would risk a broken guidance file. A full copy is safe until
  its syntax is wired (then it sets a `pointer` like Claude Code).
