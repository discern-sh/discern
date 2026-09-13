# ADR 0393: Separate operation ownership from publication

**Status**: accepted on 2026-09-13. Amends [ADR 0331](0331-common-repository-locks-precede-checkout-locks.md) and extends the short publication boundary established by [ADR 0391](0391-landings-compose-a-moved-trunk-in-an-integration-worktree.md).

## Context

Lifecycle commands coordinate shared worktree bookkeeping and run project-supplied setup and resource commands. Holding the common repository lock throughout that work prevents unrelated worktrees from publishing completion evidence. Releasing ownership around a slow command permits another cleaner or checkout writer to enter between the ownership check and its effect. A resource ledger comparison detects changed evidence but cannot exclude simultaneous cleaners.

The same duration problem affects observation. A proposal renewal may wait for shared test capacity while retaining its checkout. A journal opened only by selected gate cores leaves that operation unavailable to reconnect readers. A long-lived MCP server can own several invocations, so its process identity and the latest journal cannot identify a particular lease holder.

## Decision

The common publication lock encloses shared-state publications and transitions. Project commands and capacity admission refuse while that lock is held, including an authenticated common lease inherited by a child process.

Lifecycle commands retain a separate repository-wide lifecycle lock. It preserves ordering around shared lifecycle plans and bookkeeping without blocking completion publication. A worktree path reservation spans creation, setup, validation, and removal. Ordinary checkout writers acquire that reservation before their Git-admin lease. Paths resolve through existing ancestors so the reservation survives creation and deletion; calls from a subdirectory resolve the worktree root. A setup probe retains its parent checkout and explicitly owns its new path. It requires no parent common lock.

Resource create, ensure, and destroy retain a lease for the repository's external resource identity across their ownership check, project command, and ledger settlement. The identity remains exclusive when Git keys are recycled. Ownership comparisons and deletion checks remain necessary after the command.

CLI and MCP effectful execution enter the existing operation journal before lock acquisition. Previews and inactive observation forms retain their read-only behavior. Nested cores share the enclosing handle and record which operation is running. A child command inheriting a live lease joins its owner's journal; the parent remains its only writer, so a short child cannot replace the enclosing operation in default progress lookup. Completion, cancellation, and final results remain available through that handle. Transport progress notifications are optional delivery; they do not create the journal. Nested effects inherit the executor's cancellation signal, and the outer executor records settlement before re-raising a process signal. Cleanup that must finish after cancellation installs a fresh tracked scope while retaining subject ownership.

Each live lease records its invocation identity and available journal handle. A contention diagnostic reads that lease's owner record while the operating-system lock establishes contention. It does not infer ownership from the newest journal or a server PID. Cancellation belongs to the active caller; deleting an inert lock file is not recovery.

## Consequences

Unrelated worktrees can finish while lifecycle commands run. Competing lifecycle commands remain serialized, and writers or cleaners of the same subject remain excluded. Lifecycle parallelism can be considered separately after its shared bookkeeping has narrower transaction boundaries.

The public execution interceptor owns observation enrollment. Command-policy and subprocess-boundary guards enroll future members; behavioral tests cover public renewal, MCP requests without progress tokens, cancellation, nested execution, sibling completion, and competing cleaners. Lease records add diagnostic metadata but retain operating-system lifetime and token-authenticated delegation.

## Alternatives considered

- Change lifecycle policies to phased execution alone: this loses shared bookkeeping serialization and does not protect worktrees or external resources during commands.
- Hold publication while waiting for capacity: this makes a queued operation block independent completion evidence.
- Recover by selecting the latest journal or killing its PID: neither identifies the operation that owns the contended lease in a shared server.
