# ADR 0203: Discern co-authors only commits it composes

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

One shared helper owns production `git commit` invocations for discern-composed diffs. It accepts the canonical commit site, subject, optional body, scoped pathspecs, and an injectable environment reader. It changes no surrounding workflow semantics: setup remains fail-open, standards pinning still rolls back after a failed commit, Git hooks and signing still run, and each commit remains limited to its declared paths.

Attribution is on by default. Setting `DISCERN_NO_ATTRIBUTION` to a non-empty value omits the trailer. This is a per-process operational escape hatch, with no `discern.toml` key. The canonical commit-site set and a repository-wide structural guard enroll future production callers; tests and the one release-smoke repository fixture stay outside the production boundary for stated reasons.

## Consequences

- Git history records the machine as a co-author on the 3 diffs it composes while preserving the user's author and committer identity.
- GitHub can associate the existing trailer email after the `discern-bot` account verifies it; commits made beforehand need no rewrite.
- Automated environments can suppress attribution without changing project configuration or committed files.
- Adding another discern-authored commit requires a canonical-set member, a call through the shared helper, and behavior coverage. A raw production commit fails the gate.
- The helper is an extra boundary around a small operation. Its narrow API and pathspec requirement are the cost of keeping provenance and scope consistent.

## Alternatives considered

- **Replace the author or committer identity.** Rejected because the user invoked the operation, and an override can disrupt signing, DCO, and author-sensitive automation.
- **Add attribution through hooks or agent guidance.** Rejected because those surfaces would also touch commits whose diffs discern did not compose.
- **Make attribution a config key or opt-in.** Rejected because provenance is the default behavior of the mutator. A process-local environment override covers automation without expanding the project schema.
- **Repeat the trailer at each call site.** Rejected because a new site could omit it or spell it differently. One helper and one canonical set make the boundary executable.
