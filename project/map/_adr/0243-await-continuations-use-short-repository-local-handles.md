# ADR 0243: Await continuations use short repository-local handles

**Status**: accepted. Supersedes [ADR 0232](0232-await-continuations-spend-the-transport-budget.md)'s self-contained token representation and [ADR 0213](0213-await-blocks-on-authoritative-fleet-conditions.md)'s no-Git-admin-state rule. Extends the common-state lifetime registry of [ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md).

## Context

An `await` call that ends before its condition returns must preserve the original trunk baseline, the latest observed branch tip, and the landing transition across the next call. ADR 0232 put that state in versioned JSON and Base64URL-encoded the complete payload. The result was often 300–600 characters because it included an absolute repository path, a branch name, and commit IDs.

The caller is a generative model. MCP and CLI output enter its context, then the model must reproduce the continuation as a later argument. Arbitrary encoded strings split across many model tokens and one changed character can leave valid JSON with a different branch or commit ID. The self-contained format removed state management from discern by assigning exact state relay to the component least suited to it.

A short value cannot carry the continuation payload itself. It must identify state stored by discern. That changes `await`'s earlier no-state rule and requires an owned location, collision behavior, expiry, capacity, crash behavior, and compatibility for watches already holding the former token.

## Decision

**A not-met `await` result carries a fixed 15-character handle backed by repository-local continuation state.**

- The wire form is `C1-XXXX-XXXX-XX`. Eight symbols from a reduced Base32 alphabet provide a 40-bit random identity. Two check symbols detect every one-symbol substitution and every adjacent transposition within that identity. The alphabet omits `I`, `L`, `O`, and `U`; lowercase input normalizes to uppercase.
- Creation checks for an existing file and retries a collision. The handle is an identifier, never an authority or secret.
- Versioned records live under `<git-common-dir>/discern/continuations/`, a common-scope entry in the Git-admin-state registry. The main checkout, sibling worktrees, new CLI processes, and a restarted MCP server therefore resolve the same handle without a daemon.
- The store uses a short-held file lock around reads and writes. It writes a new record before a not-met call begins blocking, then atomically replaces that record with the latest observation before returning. No lock is held during the wait.
- Records expire 7 days after their last update. Creation reaps expired records and evicts the oldest record before the repository would exceed 512. A met result removes its record; failed cleanup falls through to expiry.
- A missing, expired, or malformed record produces a refusal. An unavailable or read-only state directory does the same. Continuation state never supplies a condition verdict: Git ancestry, gate receipts, and landing receipt notes remain authoritative.
- The previous `v1.…` self-contained tokens remain accepted. A legacy watch that is still not met returns a short handle on its next call. discern emits no new self-contained token.

The continuation store is internal protocol bookkeeping. It changes no project file, Git ref, receipt, or external system, so `await` keeps its observational MCP annotation and remains outside plan/apply.

## Consequences

- The model relays 15 checksum-protected characters regardless of repository path, branch name, commit format, or future payload growth.
- Resumption now requires the same repository's Git administrative directory. That was already the useful scope of a fleet watch, and the common directory spans every linked worktree.
- An expired or capacity-evicted handle cannot recover activity that crossed its gap. The refusal tells the caller to restart from the condition.
- A repository can retain up to 512 small records plus one lock file. Terminal and age cleanup keep ordinary use near zero.
- A not-met wait requires a writable Git administrative directory. discern tests persistence before spending the transport-sized wait.

## Alternatives considered

- **Keep the Base64URL payload.** This preserves statelessness while retaining the copy-failure mechanism. Rejected.
- **Use a denser self-contained binary format.** Commit IDs and branch identity still require dozens of arbitrary characters, and future payload growth would lengthen the relay again. Rejected.
- **Keep an in-memory MCP lookup.** It fails across CLI invocations, MCP restarts, and agent sessions. Rejected.
- **Resume the latest watch implicitly.** Concurrent watches make “latest” ambiguous, and a wrong match can preserve the wrong baseline. Rejected.
- **Write continuation objects or refs into Git's object database.** That mixes protocol bookkeeping with repository history and gives temporary state Git's retention semantics. Rejected.
