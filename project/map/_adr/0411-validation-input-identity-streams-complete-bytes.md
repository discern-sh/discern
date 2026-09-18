# ADR 0411: Validation input identity streams complete bytes

**Status**: accepted on 2026-09-18.

## Context

Every producer receipt binds the complete declared input closure: the content and executable-mode digest of each file the closure selects, observed from the checkout before producers run and again at every effect ([Complete evidence](../20-quality-gate/complete-evidence.md)). Both observers established a file's identity by reading it whole through the bounded reader that producer captures, retained artifacts, and recovery manifests share. That reader's 16 MiB ceiling exists to bound protocol memory, and it refused with one anonymous sentence.

A checkout file above the ceiling, tracked or merely not ignored, made the checkout observer throw that sentence before any producer ran. No gate verb turned it into a refusal: `done` and `test` left through the crash frame with a report that named neither the file nor the bound, and `standards` recorded a nameless validation failure. The committed-tree observer refused blobs above the same ceiling during emergency planning.

A project storing a 700 MB database resource through Git LFS met this on every gate verb. The committed blob is a small pointer, so the committed-tree observer never noticed, while the checkout holds the smudged content. Excluding the file was not a remedy: the closure falls back to every non-ignored file when a job declares no inputs, input patterns carry no negation, and the resource is a legitimate input of the tests that read it.

## Decision

- One streaming accumulator ([`input_identity.ts`](../../../src/engine/validation/input_identity.ts)) computes every input's complete digest and byte count. It counts lines and words only where demanded extent denominators select that file. Lines are LF bytes; only word counts allocate a streaming decoder. Requested counts match a complete UTF-8 decode across chunk boundaries.
- Input, toolchain, and denominator applicability bind paths and content digests. Optional text observations do not change an unrelated receipt's identity. A missing requested count fails planning instead of becoming zero. The pre-launch applicability change invalidates prior receipt reuse without changing the public result or stored receipt schemas.
- The checkout observer reads each file through the accumulator in fixed steps and keeps the stability checks the bounded reader applied: the same file identity before and after, with size and timestamps unchanged through EOF.
- The committed-tree observer feeds `git cat-file --batch` frames through the same accumulator from the Git runner's stdout sink, verifying each object header against the requested id and size, so a blob of any size is observed without being retained.
- The bounded reader keeps its ceiling for the captures that are held in memory by design, and names its subject, observed size, and bound when it refuses.
- Every observation failure is a `ValidationInputError` that names the input. `done` and `test` present it through the `validation_inputs` failed stage with a diagnostic and a registered remedy; `standards` reports the named reason in its blocker.

## Consequences

- No size threshold remains in input observation, so this class cannot return through a ceiling. The regression tests size their fixture from the bounded reader's constant, so a changed constant moves the tests with it.
- Committed completion reads every byte of every selected input at planning, execution start, producer and extractor boundaries, and final verification. Standalone diagnostics take the planning observation only. Memory stays bounded by read steps and requested text processing; time grows with closure size. Repeated scans, metadata caching, Git identities, and input-declaration guidance remain post-launch work in [the ledger](../../TODO.md).
- A filtered path (Git LFS and other clean/smudge filters) is identified by its checkout bytes on the checkout side and by its clean blob on the committed side, so the two observers agree only for unfiltered paths. Emergency planning is the one path that compares them; it cannot reuse checkout evidence for a producer whose closure holds a filtered path. The open work is recorded in [the ledger](../../TODO.md).
- The Git runner gained a caller-owned stdout sink. Sunk bytes are exempt from the combined output ceiling, and a sink signals trouble by aborting the call rather than throwing through the stream reader.

## Alternatives considered

- **Refuse with a named diagnostic only.** Rejected: a project with one legitimate large input could never prove, because input patterns cannot exclude a path and the file belongs in the closure.
- **Cache identity by file metadata between the planning observation and each effect.** Deferred: it replaces a fresh content observation with a metadata assumption. Define the accepted guarantee and invalidation rules before making that trade-off.
- **Identify clean tracked files by their index object instead of their bytes.** It would align filtered paths between the two observers and skip reading unchanged files, but it needs the visibility-bit handling that [ADR 0273](0273-validation-comparisons-require-complete-keyed-semantic-evidence.md) describes and would change the identity of every existing receipt. Deferred to the ledger item above.
