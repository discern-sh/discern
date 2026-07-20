# ADR 0152: Slow workflows prove predictable write authority before project work

**Status**: accepted. Refines the gate receipt's best-effort write policy ([ADR 0067](0067-accept-validates-the-landed-tree.md)), extends the measurement-receipt flow ([ADR 0112](0112-standard-measurement-receipt.md)), and preserves `smoke` as the project's fast readiness capability ([ADR 0090](0090-setup-proves-worktree-viability.md)).

> **Registry amendment ([ADR 0165](0165-git-admin-state-namespaced-by-lifetime.md)):** The former `ADMIN_STATE_FILES` registry is now represented by the validation-marked subset of the complete `GIT_ADMIN_STATE` registry. The branded authority and auto-enrolment rule are unchanged; the nested namespace is created before its write probe.

## Context

`discern done` can spend minutes running builds, checks, tests, scope gates, and standard measurements before it records the gate and measurement receipts in Git's per-worktree administration directory. In a linked worktree, that directory is usually inside the main checkout's `.git/worktrees/<name>/`, not inside the sibling worktree directory. A sandbox can therefore allow every project job while denying the final marker write.

The receipt writer treated that denial as best-effort: the gate remained green and reported `record_failed`. That policy preserved the quality result, but it interacted badly with the lifecycle. Without a receipt, `discern accept` reruns the full gate. An agent commonly responds to the first denial by retrying with wider authority, so the user pays for the same slow suite twice even though the missing permission was knowable in milliseconds. `discern standards` had the same shape for its measurement receipt, and `standards --pin` could measure first and only then discover that it could not rewrite `discern.toml` or commit the tightened limit.

Permission metadata is not a reliable answer. In sandboxed processes, an `access(W_OK)` check can succeed while the actual write is denied. The proof has to exercise the real operation class during the invocation that will perform the later write.

There are two different kinds of readiness to keep distinct. Discern knows its own future effects and their paths. The project knows whether its app, configuration, and runtime dependencies are ready. A new configurable `preflight` command would overlap the existing `smoke` capability while still asking users to predict Discern's internals.

## Decision

**Every potentially slow workflow proves its predictable Discern-owned write authority with a tiny real operation before it starts project work. Project-owned readiness continues to use `smoke`.**

- `done` resolves every registered gate/measurement state path and creates, writes, renames, and removes a hidden temporary entry in the target Git-admin directory. An existing marker is also opened for write without changing its bytes. The probe runs after the existing cheap gate preconditions and before the first capability or check.
- Ordinary `standards` performs the same validation-state probe before measuring. `standards --pin` additionally opens the installed config for write without truncating it and exercises a temporary create/rename/remove in Git's common directory before it measures or replays anything.
- A denial is structured and immediate: `done` uses `failed_stage = "write_access"`; standards uses `error = "write_access"`; both attach a `write-access` diagnostic with the exact path and reproduce command. No provider-specific security setting is changed or recommended automatically.
- Git-admin filenames live in one `ADMIN_STATE_FILES` registry. Its preflight iterates that registry, and successful preflight returns a branded authority token required by every state writer. A new state-file sibling therefore joins the probe from the single source and cannot be called through the typed writer API without authority.
- The marker writers remain best-effort after preflight. The probe proves authority at one moment; a concurrent permission change, disk failure, or other time-of-check/time-of-use event can still make the final write fail, and the existing result status continues to expose that rare case.
- No user-facing `[preflight]` option is added. `smoke` stays the fast, side-effect-light project readiness check: boot with real config and any essential shared runtime dependency. Both `discern done` and `discern test` include it in the fail-fast test group, so a quick failure cancels slower siblings. A prerequisite unique to one custom check or standard belongs at the start of that command.
- `discern test` and `discern prepare` gain no built-in probe because they have no delayed Discern-owned persistent write. Arbitrary project-command permission needs are opaque to the engine; they remain project readiness or command-local concerns.

## Consequences

- A sandbox denial now costs a few filesystem operations rather than a complete gate or measurement suite. The same invocation can be retried with user-approved authority once, with no first full run to discard.
- A green `done` now requires the authority needed to persist its validation state. That deliberately changes the former “green without a receipt” behavior when the denial is knowable before jobs start. Identity reasons such as a dirty tree or a moving `HEAD` can still withhold a review receipt without turning the quality result red.
- The probes briefly create hidden random files and remove them immediately. Cleanup runs on both success and failure. The production paths are not used as sentinels, so an existing receipt is never overwritten or made temporarily malformed.
- `accept` and `setup done` inherit the guard whenever they invoke the gate core. A sandbox that blocks the linked worktree's Git metadata is caught before their fallback gate run becomes expensive.
- The split is explainable in `discern.toml`: `smoke` covers fast project/runtime readiness; built-in probes cover engine-known writes; one-off prerequisites live with their command. There is no second conceptually overlapping project command.
- The guard cannot predict effects hidden inside arbitrary shell commands, and fail-fast cancellation cannot undo work a sibling completed before `smoke` failed. Those are explicit residuals rather than a reason to grow an open-ended preflight language.

## Alternatives considered

- **Add a configurable `[preflight]` command.** Rejected because it duplicates `smoke` for shared project readiness and cannot safely infer command-specific requirements. The existing capability gets clearer guidance instead.
- **Change Codex or another provider's sandbox configuration.** Rejected because Discern must not widen a user's security policy. It reports the exact blocked path and leaves escalation to the user and provider.
- **Check mode bits or `access(W_OK)`.** Rejected because sandbox policy can deny the actual operation after metadata says writable. The sentinel performs the real create/write/rename/remove sequence.
- **Probe when the worktree is created.** Rejected because authority belongs to a command invocation and can differ between sessions. It would also warn far from the slow operation it protects.
- **Keep receipt writes best-effort with no early failure.** Rejected for known denials: preserving a green result is not useful when the lifecycle must repeat the whole gate to obtain the missing receipt. Best-effort remains only for failures that arise after a successful probe.
