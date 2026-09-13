# ADR 0393: Merge observations connect conflict recurrence across surfaces

**Status**: accepted on 2026-09-13

## Context

Independent efforts can repeatedly conflict in a shared file. Each update has a valid recovery route, yet repeating that recovery leaves the project's contention unchanged. Acceptance encounters the same conflict while composing a submitted revision in a disposable integration worktree.

The local logbook excludes command output. Error prose therefore cannot supply durable file evidence, and invocation success cannot describe a merge followed by failing regeneration or checks. Counting temporary branches or unchanged retries as separate efforts would overstate recurrence.

## Decision

The shared update core captures bounded, versioned merge observations before convergence and cleanup. Each caller supplies the originating effort and route. Git merges the observed incoming revision when it can resolve that revision. The observation retains that revision, the authoring revision, the merge outcome, and repository-relative conflict paths with their generated classification. Missing revisions and omitted metadata remain explicit. No file contents or error output enter the logbook.

The invocation accumulator follows the existing observed-result seam. CLI and MCP drain it into the verb event, independently of the eventual verdict. Its nested format has an independent version in the local-format registry; unknown evidence does not invalidate the containing event.

The detector groups observations by effort and revision pair. Repeated update and acceptance attempts share an episode; contradictory outcomes remain unresolved. Findings require recurrence across efforts and name authored conflict paths. Generated-only conflicts cannot establish an authored-file finding. The denominator contains complete observed merges, including successful ones.

Patterns and Improvement retain the project finding. Conflict recovery additionally reads the bounded inline history and the current executor observation, then projects the same finding and recommendation for a currently conflicting path. This is a targeted extension of the working routes in ADR 0160: users encounter the advice while resolving the relevant failure. Advisory collection never changes recovery, the gate, or landing authority.

## Consequences

Projects can identify files that obstruct parallel work and consider separate source entries with declared generated outputs. The advice names the output paths and regeneration command in a generated group; it preserves the need to review authored-source conflicts.

Older history cannot reconstruct missing paths. Inline history can miss recurrence that a full Patterns read finds. File recurrence alone cannot establish that the same section conflicted or that generation is suitable. The detector reports these evidence boundaries instead of prescribing a merge policy.
