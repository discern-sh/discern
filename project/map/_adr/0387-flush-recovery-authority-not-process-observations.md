# ADR 0387: Flush recovery authority independently of process observations

**Status**: accepted

## Context

Native execution publishes planned, started and settled child receipts. The generic artifact publisher flushes each receipt and its graph-change marker to disk. A matched small completion journey requires 667 filesystem syncs, compared with 103 before native Git child enrollment. Repetition across independent test processes multiplies that work.

Process interruption and machine interruption have different recovery subjects. Completed writes remain visible through process death. A machine restart destroys every child process and every in-memory reclamation plan; restoration bytes and ownership records must still survive it.

## Decision

Recovery records, captures and ordinary environment artifacts retain their existing sync barriers. A narrow typed child-receipt publisher writes the existing immutable receipt format atomically without a disk flush. It accepts only enrollment and child lifecycle facts. The graph publication marker also requires atomic visibility, not a disk flush. Every publisher still invalidates that marker under the common lock before mutation. The operation lock's lease record is inert and is never flushed: exclusion comes from the operating-system lock on the open handle, and a reader only needs the record's current bytes.

Child inspection continues to refuse uncertain or corrupt evidence. Reclamation still requires a valid unchanged witness and the storage exclusion boundary. Missing or corrupt state never grants destructive recovery authority. This refines the witness durability described in ADR 0386; the reference graph and retained byte guarantees remain in force.

## Consequences

Child lifecycle recording avoids a disk barrier per fact without suppressing any record, isolation check or settlement check. The ordinary artifact API does not expose a caller-selected durability bypass. Its regression test verifies that unrelated future recovery artifacts still flush.

An abrupt machine failure may leave missing or corrupt observation files and require conservative reconciliation. A witness has no authority across a machine restart: planners must inventory again. Changing these files to hold restoration bytes, durable authority, or persisted plans would require revisiting this boundary.

## Alternatives considered

Removing child enrollment would leave interrupted spawn outcomes unaccounted for. A new append-only journal would also reduce publication overhead, but would change the recovery format and introduce partial-record handling. The existing atomic format preserves the tested recovery reader while removing unnecessary disk barriers.
