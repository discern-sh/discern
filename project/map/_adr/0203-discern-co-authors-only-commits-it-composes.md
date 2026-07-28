# ADR 0203: Discern co-authors only commits it composes

> **Extension links (2026-07-28):** This record extends [ADR 0076](0076-engine-commits-scaffolded-machinery.md) for setup wiring and completion commits, and [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md) for standards-pin commits. Their commit ownership, failure, and receipt semantics stand; this record adds the shared attribution boundary.

> **Resumed-setup amendment (2026-07-28):** A failed setup-wiring commit records its exact staged blobs and index tree in worktree Git-admin state. A later `setup begin` may reuse discern's attribution only while HEAD, branch, the whole index, and every candidate's worktree and index bytes still match that evidence. It commits the proven staged index without pathspecs. After normal hooks and signing run, the boundary verifies the resulting commit tree against the recorded tree. A mismatch moves the setup branch back with a compare-and-swap ref update, preserving the hook's index and worktree changes; the evidence remains. A matching commit clears the evidence. Missing or mismatched evidence skips the commit. This closes both places later user bytes could enter: re-staging current pathspecs before Git runs and a hook staging extra paths while Git runs.

**Status**: accepted

## Context

Discern composes and commits 3 diffs in a project: setup wiring, the setup-completion marker, and a standards pin. Those commits used the invoking user's Git identity without recording that discern composed the diff. Replacing the author or committer would misstate who invoked the command and can interfere with commit signing, DCO checks, and author-based automation.

The attribution boundary also needs to exclude commits discern does not compose. Agent-authored work, user-authored work, lifecycle fast-forwards, hooks, and test-fixture commits have independent authorship. A future production commit path must not bypass that distinction ([ADR 0051](0051-canonical-set-parity.md), [ADR 0076](0076-engine-commits-scaffolded-machinery.md), [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md)).

## Decision

Every commit whose diff discern composes carries this standard Git trailer:

```text
Co-Authored-By: discern-bot <bot@discern.sh>
```

The invoking user's configured Git identity remains both author and committer. Discern never adds the trailer to agent-authored or user-authored commits.

One shared helper owns production `git commit` invocations for discern-composed diffs. It accepts the canonical commit site, subject, optional body, a declared path set, the commit source, and an injectable environment reader. Most sites remain pathspec-scoped. A resumed setup-wiring commit uses its previously proven staged index. The helper verifies the staged path set before the commit and the committed tree afterward, rolling back an out-of-scope tree without resetting the index or worktree. Setup remains fail-open, standards pinning still rolls back after a failed commit, Git hooks and signing still run, and each commit remains limited to its declared paths.

Attribution is on by default. Setting `DISCERN_NO_ATTRIBUTION` to a non-empty value omits the trailer. This is a per-process operational escape hatch, with no `discern.toml` key. The canonical commit-site set and a repository-wide structural guard enroll future production callers; tests and the one release-smoke repository fixture stay outside the production boundary for stated reasons.

## Consequences

- Git history records the machine as a co-author on the 3 diffs it composes while preserving the user's author and committer identity.
- GitHub can associate the existing trailer email after the `discern-bot` account verifies it; commits made beforehand need no rewrite.
- Automated environments can suppress attribution without changing project configuration or committed files.
- Adding another discern-authored commit requires a canonical-set member, a call through the shared helper, and behavior coverage. A raw production commit fails the gate.
- The helper is an extra boundary around a small operation. Its narrow API and declared-scope requirement are the cost of keeping provenance and scope consistent.

## Alternatives considered

- **Replace the author or committer identity.** Rejected because the user invoked the operation, and an override can disrupt signing, DCO, and author-sensitive automation.
- **Add attribution through hooks or agent guidance.** Rejected because those surfaces would also touch commits whose diffs discern did not compose.
- **Make attribution a config key or opt-in.** Rejected because provenance is the default behavior of the mutator. A process-local environment override covers automation without expanding the project schema.
- **Repeat the trailer at each call site.** Rejected because a new site could omit it or spell it differently. One helper and one canonical set make the boundary executable.
