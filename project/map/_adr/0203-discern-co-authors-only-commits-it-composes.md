# ADR 0203: Discern co-authors only commits it composes

> **Amendments.**
>
> - **Extension links (2026-07-28):** This record extends [ADR 0076](0076-engine-commits-scaffolded-machinery.md) for setup wiring and completion commits, and [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md) for standards-pin commits. Their commit ownership, failure, and receipt semantics stand; this record adds the shared attribution boundary.
> - **Resumed setup (2026-07-28):** A failed setup-wiring commit records its exact staged blobs and index tree in worktree Git-admin state. A later `setup begin` may reuse discern's attribution only while HEAD, branch, the whole index, and every candidate's worktree and index bytes still match that evidence. It commits the proven staged index without pathspecs. After normal hooks and signing run, the boundary verifies the resulting commit tree against the recorded tree. A mismatch moves the setup branch back with a compare-and-swap ref update, preserving the hook's index and worktree changes; the evidence remains. A matching commit clears the evidence. Missing or mismatched evidence skips the commit. This closes both places later user bytes could enter: re-staging current pathspecs before Git runs and a hook staging extra paths while Git runs.
> - **Enforcement (2026-07-28):** The commit boundary is now a runtime capability as well as a shared helper. The generic Git runner resolves and refuses the actual `commit` subcommand, rejects inline alias configuration, and neutralizes configured aliases; only `discern_commit.ts` owns the commit spawn. Each canonical site records its caller module, and a Deno-resolved production import-graph guard permits only those callers to reach the capability. Import aliases, re-exports, and helper indirection retain the same graph edge and fail the guard.
> - **Exact transition (2026-07-28):** Every commit spawn receives a unique reflog action and forces the local branch reflog on. The boundary uses that action to identify the exact commit Git created, then requires that commit to be the direct child of the branch and HEAD it proved before the spawn. A staged-index commit must still equal its proven tree; a pathspec commit must change only its declared paths. Rejection compare-and-swaps only that identified commit back to the parent Git observed. A hook or concurrent process that has already advanced the branch is never rolled back. Git's partial-commit index is separate from the real index, so an out-of-scope path a hook staged is restored using the exact blob in the rejected commit only while the real entry still matches both its pre-spawn value and the parent; existing or concurrent staged bytes win. If the exact commit cannot be identified or inspected after Git reports success, discern does not guess at a rollback and tells the operator to inspect the branch.
> - **Identity (2026-07-30):** The trailer identity below is now `discern <done@discern.sh>`. Pre-launch review rejected the `discern-bot` name and `bot@discern.sh` address: "bot" reads as an AI-assistant persona, which discern is not. The replacement carries no persona — the name is the product, and the address pairs with it to spell the terminal verb, `discern done`. `bot@discern.sh` remains a verified alias on the machine account, so trailers stamped before the rename keep their attribution. The commit boundary, `DISCERN_NO_ATTRIBUTION`, and all other semantics below are unchanged.
> - **[ADR 0211](0211-agent-context-artifacts-carry-no-provenance-marker.md) — generated-file markers:** `DISCERN_NO_ATTRIBUTION` now also removes the product byline and URL from comment-capable generated-file markers. The source-only marker remains. Commit attribution and the process-local, non-empty-value semantics are unchanged.

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

One shared helper owns production `git commit` invocations for discern-composed diffs. It accepts the canonical commit site, subject, optional body, a declared path set, the commit source, and an injectable environment reader. Most sites remain pathspec-scoped. A resumed setup-wiring commit uses its previously proven staged index. Before Git runs, the helper proves the branch and parent; staged-index mode also proves the exact tree, while pathspec mode records the real index and declared paths. A unique reflog action identifies the commit Git actually created after hooks and signing finish. That commit must be the direct child of the proven parent. Its tree must match the staged proof or its changed paths must stay within the declared path set.

An invalid direct child is removed only by a compare-and-swap from that exact commit to the parent Git observed. A later tip is left untouched. Partial-pathspec rejection restores hook-staged entries from the rejected commit without overwriting an index entry that changed before or during the invocation. If Git reports success but the exact commit cannot be identified or inspected, the helper refuses to guess at history and directs the operator to inspect the branch. Setup remains fail-open, standards pinning still rolls back after a failed commit, Git hooks and signing still run, and each commit remains limited to its declared paths.

Attribution is on by default. Setting `DISCERN_NO_ATTRIBUTION` to a non-empty value omits the trailer. This is a per-process operational escape hatch, with no `discern.toml` key.

The canonical commit-site set records both each workflow and its caller module. The generic Git runner parses global options before deciding whether the actual subcommand is `commit`; a later ref or path with that name remains ordinary data. It rejects inline `alias.*` configuration and overrides the resolved command's configured alias, so another command name cannot expand to `commit`. The shared helper owns the only production commit spawn, and the subprocess registry enrolls that exception. A guard derives the production module graph with Deno's parser and resolver, then permits only the registered caller modules to import or re-export the commit capability. Tests and the release-smoke repository fixture stay outside that production graph. The registered callers and the helper form the trusted authority container: changes inside them remain review-sensitive, while a new module edge fails the gate.

## Consequences

- Git history records the machine as a co-author on the 3 diffs it composes while preserving the user's author and committer identity.
- GitHub can associate the existing trailer email after the `discern-bot` account verifies it; commits made beforehand need no rewrite.
- Automated environments can suppress attribution without changing project configuration or committed files.
- Adding another discern-authored commit requires a canonical-set member with its caller module, a call through the shared helper, and behavior coverage. Generic commit requests fail at runtime; a new capability edge or subprocess home fails the gate.
- Hooks remain free to inspect, reject, and amend commit preparation, but they cannot silently widen an attributed pathspec commit or make a later branch tip eligible for rollback.
- The helper is an extra boundary around a small operation. Its narrow API and declared-scope proof are the cost of keeping provenance and scope consistent.

## Alternatives considered

- **Replace the author or committer identity.** Rejected because the user invoked the operation, and an override can disrupt signing, DCO, and author-sensitive automation.
- **Add attribution through hooks or agent guidance.** Rejected because those surfaces would also touch commits whose diffs discern did not compose.
- **Make attribution a config key or opt-in.** Rejected because provenance is the default behavior of the mutator. A process-local environment override covers automation without expanding the project schema.
- **Repeat the trailer at each call site.** Rejected because a new site could omit it or spell it differently. One helper and one canonical set make the boundary executable.
