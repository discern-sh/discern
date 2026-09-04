# ADR 0351: Setup completion replays Proof and rolls back only owned tips

**Status**: accepted. Amends the compensating-commit and prior-Proof behavior in [ADR 0313](0313-setup-completion-and-acceptance-bind-one-final-proof.md) and completes the bounded operational journey in [ADR 0322](0322-setup-is-one-bounded-operational-journey.md).

## Context

Setup completion is both a final-tree transaction and a result-retrieval boundary. A completed run can outlive the caller's first read: terminal output may be truncated, a session may compact context, or acceptance may happen later. Repeating `setup done` on the unchanged marker-bearing commit formerly re-entered mutation, cleared current Proof, and then refused to create a marker that already existed. Completion and acceptance could direct the caller back to one another even though the branch had already earned Proof.

Failure recovery had a second mismatch. A post-marker failure restored the setup flag through another commit. The tracked tree returned to an incomplete state, but the branch retained a marker/restore pair that belonged only to the failed transaction. A first-time user should not inherit implementation history or need raw Git to remove it.

The failure that exposed this behavior originated inside the structural worktree probe. Its outer result also dropped the nested Map file and rule and chose worktree-resource recovery for a content error. Safe transaction recovery and actionable failure projection therefore need one durable boundary: preserve canonical evidence and preserve the identity of the failing operation.

## Decision

**Setup classifies marker-bearing state before planning effects or changing Proof, and rollback may remove only an exact in-memory-owned marker tip.**

### Marker-bearing completion is a state table

`setup done` reads the clean-tree pin and canonical Proof before any mutation:

- A clean marker-bearing `HEAD` with honored current Proof returns `completion: "replayed"`. It re-derives the canonical setup inventory and landing choices from current committed authorities, re-serves the same Proof and line, and reports `effects_performed: false` and `gate_ran: false`.
- A clean marker-bearing `HEAD` with missing or stale Proof enters one ordinary validation route for that same commit. It never writes or commits a second marker. A green validation records canonical Proof and returns `completion: "validated"`.
- A dirty marker-bearing checkout refuses read-only. Existing Proof bytes and the marker stay in place, and the result names the paths and clean-state recovery.
- A marker with `setup_completion = "unproven"` remains visibly unproven. Only ordinary `setup done` can validate it, add Proof, and converge the persisted state to `"proven"`; the bypass never synthesizes evidence.
- A recorded red result for the unchanged tree remains visible. Repeating setup completion does not turn into retry-until-green; the caller changes the failing input or explicitly requests the Gate's bounded rerun path.

Proof remains the only completion evidence. The replay projection combines canonical Proof inspection with the derived setup inventory and landing state. There is no setup receipt, marker hash, or second result store.

### New-marker rollback requires exact ownership

The shared discern-authored commit boundary returns privately branded, in-memory evidence for a commit it just created: authoring site, checkout, branch, sampled parent, commit, tree, and exact path set. A setup failure may restore the predecessor only while all of these facts still hold:

- the checkout remains on the recorded branch;
- the branch and `HEAD` still name the owned commit;
- the checkout is clean;
- the commit object still has the sampled parent and tree; and
- its changed paths still equal the owned marker scope.

The ref move is an expected-old compare-and-swap from the owned commit to its parent. The checkout is restored from the same pair. A successful rollback then restores the pre-attempt Proof snapshot. If any ownership or preservation fact changed, discern moves no ref, retains the exact visible state, and reports the recovery. It never performs a broad reset, deletes unrelated history, or asks the caller to move refs manually.

An uncommitted marker whose commit failed has a narrower equivalent rule: restore its sampled bytes only while `HEAD` remains the sampled predecessor and `discern.toml` is the sole tracked difference.

### Nested diagnostics keep their identity

An outer setup failure carries each nested diagnostic's file, line, rule, message, reproduce command, and output metadata. Recovery classification follows the diagnostic: a content or integrity finding points to the source edit, while a worktree-survival resource failure points to the exact `[worktree.resources]` entry and lifecycle reproduce command. Aggregate counts may follow that diagnostic but cannot replace it. Human, Markdown, JSON, and Model Context Protocol result adapters consume the same fields.

## Consequences

- Repeating a successful completion is the supported way to recover Proof, inventory, and landing facts after a partial read. It performs no Gate, worktree probe, write, or Proof mutation.
- Acceptance can follow a harmless replay because the Proof identity and branch tip remain unchanged.
- A failed post-marker attempt normally leaves the predecessor's commit graph and tracked tree byte-equivalent to their pre-attempt state, with no transaction-owned history.
- Concurrent or user-authored changes make rollback refuse safely. The exact retained state remains inspectable instead of being overwritten in pursuit of a tidy history.
- Proof snapshots are restored only after the exact owned commit is removed. A refused replay or rollback cannot destroy honored evidence.
- Setup remains CLI-only, but its structured failure envelope retains semantic parity through the same Markdown and Model Context Protocol adapters used by registered result producers.

## Alternatives considered

- **Store a setup completion receipt.** Rejected because Gate Proof already binds the commit, review facts, declaration evidence, and durable landing note; another store would create competing evidence and replay identities.
- **Rerun every repeated completion.** Rejected because a successful unchanged result is already known, and an unchanged red result must not become retry-until-green.
- **Keep compensating commits for traceability.** Rejected because the commits describe failed implementation steps rather than authored project history. Exact ownership evidence leaves an audit trail without retaining transaction churn.
- **Reset the branch to the sampled predecessor.** Rejected because an unqualified reset can discard intervening work. Only an exact owned-tip compare-and-swap is permitted.
- **Infer recovery from the outer stage.** Rejected because a structural worktree probe can fail on project content or on worktree resources. The nested diagnostic, not the container stage, knows the remedy class.
