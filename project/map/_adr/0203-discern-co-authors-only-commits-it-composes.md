# ADR 0203: Discern co-authors only commits it composes

> **Extension links (2026-07-28):** This record extends [ADR 0076](0076-engine-commits-scaffolded-machinery.md) for setup wiring and completion commits, and [ADR 0106](0106-standards-pin-carries-the-gate-receipt.md) for standards-pin commits. Their commit ownership, failure, and receipt semantics stand; this record adds the shared attribution boundary.

> **Enforcement amendment (2026-07-28):** The commit boundary is now a runtime capability as well as a shared helper. The generic Git runner resolves and refuses the actual `commit` subcommand, rejects inline alias configuration, and neutralizes configured aliases; only `discern_commit.ts` owns the commit spawn. Each canonical site records its caller module, and a Deno-resolved production import-graph guard permits only those callers to reach the capability. Import aliases, re-exports, and helper indirection retain the same graph edge and fail the guard.

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

Attribution is on by default. Setting `DISCERN_NO_ATTRIBUTION` to a non-empty value omits the trailer. This is a per-process operational escape hatch, with no `discern.toml` key.

The canonical commit-site set records both each workflow and its caller module. The generic Git runner parses global options before deciding whether the actual subcommand is `commit`; a later ref or path with that name remains ordinary data. It rejects inline `alias.*` configuration and overrides the resolved command's configured alias, so another command name cannot expand to `commit`. The shared helper owns the only production commit spawn, and the subprocess registry enrolls that exception. A guard derives the production module graph with Deno's parser and resolver, then permits only the registered caller modules to import or re-export the commit capability. Tests and the release-smoke repository fixture stay outside that production graph. The registered callers and the helper form the trusted authority container: changes inside them remain review-sensitive, while a new module edge fails the gate.

## Consequences

- Git history records the machine as a co-author on the 3 diffs it composes while preserving the user's author and committer identity.
- GitHub can associate the existing trailer email after the `discern-bot` account verifies it; commits made beforehand need no rewrite.
- Automated environments can suppress attribution without changing project configuration or committed files.
- Adding another discern-authored commit requires a canonical-set member with its caller module, a call through the shared helper, and behavior coverage. Generic commit requests fail at runtime; a new capability edge or subprocess home fails the gate.
- The helper is an extra boundary around a small operation. Its narrow API and pathspec requirement are the cost of keeping provenance and scope consistent.

## Alternatives considered

- **Replace the author or committer identity.** Rejected because the user invoked the operation, and an override can disrupt signing, DCO, and author-sensitive automation.
- **Add attribution through hooks or agent guidance.** Rejected because those surfaces would also touch commits whose diffs discern did not compose.
- **Make attribution a config key or opt-in.** Rejected because provenance is the default behavior of the mutator. A process-local environment override covers automation without expanding the project schema.
- **Repeat the trailer at each call site.** Rejected because a new site could omit it or spell it differently. One helper and one canonical set make the boundary executable.
