# ADR 0399: Submit records a proven revision without starting landing

**Status**: accepted on 2026-09-14

## Context

Proof, landing permission, and a submitted revision are independent facts. An owner can grant an effort after its agent stops. That decision does not put a revision in the queue. Requiring an unauthorized acceptance just to create a submission makes the human journey depend on a refusal and hides the effect. The existing acceptance boundary already owns frozen revisions, complete Proof inspection, the submission store, and the canonical acceptance walk.

## Decision

`discern submit` and `discern_submit` expose the submission-only plan and apply operation from the acceptance core. The Desk calls that same operation for **Join the landing queue**. It records the current clean, proven revision; it performs no validation producers, landing, grant consumption, or scheduling. An active or later acceptance walk may consider it. `discern accept --target` starts a walk, and the existing `accept` behavior remains available.

The plan identifies the absolute checkout, branch, commit, complete Proof, any replaced submission, and observed authority. Apply owns the checkout and a short publication boundary, rereads those facts, and refuses changed evidence. The Desk passes its reviewed revision across consent. Same-revision submission preserves identity and order. Only an explicit submission operation replaces an older queued revision. Checkpoint and standard decisions retain their own requirements; an effort grant cannot supply them.

Each task effect in the Desk enters shared operation execution after review. Its journal starts before ownership or capacity waits and survives cancellation. The interactive caller requests return after interruption; ordinary CLI and MCP signal contracts remain unchanged. Reading and consent run outside ownership. The manual uses the existing docs browser during a suspended foreground route, so it retains one corpus, link resolver, search and reading state, and stdin owner.

## Alternatives

Keeping submission inside `accept` would require an unwanted landing attempt or deliberate refusal to queue stopped work. Writing a submission from Desk would duplicate the eligibility and locking boundary. A background queue service would add scheduling and ownership policy beyond the existing acceptance walk. The shared submission operation preserves one authority for admission and leaves starting a walk explicit.

## Consequences

A stopped agent is no obstacle to explicit queue admission. Permission alone still schedules nothing. Public result schemas and command references gain one verb, while the submission store and landing ordering remain singular. A queued revision can land immediately if a walk is active; queueing promises no delay.

Every reviewed effect must pay for fresh validation, and an unreadable or changed subject requires another review. The Desk composes package reading and choice regions instead of retaining terminal dumps above its controls.
