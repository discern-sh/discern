# ADR 0048: Rename the graduation landing-role `main` → `trunk`

> **Consolidated into
> [ADR 0046](0046-graduate-destination-and-skill-removal.md).** The `main` →
> `trunk` rename is folded into the configurable-destination ADR. Kept for
> history.

**Status**: accepted

## Context

[ADR 0046](0046-graduate-destination-and-skill-removal.md) gave
`discern graduate` a configurable destination through `[worktree].graduate_to`
(and `--to` per run). It took two values: `"branch"` (leave the work on its own
branch for review) and `"main"` (fast-forward the trunk to the branch tip, then
delete the merged branch).

`"main"` always named a **role**, never a literal branch. The executor
fast-forwards `[project].main_branch`, whatever a project calls it. The engine,
the dry-run plan steps (`fast-forward-trunk`), the human docs, and 0046's own
prose all call this landing "the trunk". Only the user-facing value borrowed the
default branch's name.

That borrowing is a footgun on any repo whose trunk is not `main`:

- A `master`-trunk user reads `graduate_to = "main"` as a literal branch that
  does not match their trunk, then instinctively writes
  `graduate_to = "master"`.
- The schema rejects it — `Invalid option: expected one of "branch"|"main"` —
  and never hints that `"main"` is the role that already means their trunk.

Reflex, not reasoning, picked the name. 0046's "Alternatives considered" weighed
rename-on-graduate and flipping the default, but never the role's own name.

## Decision

**Rename the value `"main"` → `"trunk"`.** The pair becomes `"branch"` (leave it
on its own branch) and `"trunk"` (land it on the integration branch) — two
roles, not a role beside a literal branch. `"trunk"` resolves to
`[project].main_branch` exactly as `"main"` did. Only the spelling changes.

The rename _removes_ a vocabulary split rather than adding one. "trunk" is
already the word the engine, the plan steps, and the docs use. It also reads as
a role, so a `master` (or `develop`) repo never types its own trunk name. The
shipped `discern.toml` comment now spells out that `"trunk"` resolves to
`[project].main_branch` (`main`, `master`, …). That closes the footgun right
where a user configures it.

A schema migration (11→12) carries an existing `graduate_to = "main"` to
`"trunk"`. It leaves `"branch"` and an absent key untouched. Without it, the new
enum would reject a `"main"` config on the next read.

## Consequences

- `GRADUATE_TARGETS` becomes `["branch", "trunk"]`. The CLI `--to`, the `to`
  tool parameter, the dry-run plan, the worktree guidance, and the generated
  config reference all read `trunk`.
- Migration 11→12 carries a legacy `"main"` value forward. It stays idempotent
  (a no-op once `"trunk"`, on `"branch"`, or when the key is absent) and never
  invents a key the user omitted.
- This repo's own `discern.toml`, which had adopted `graduate_to = "main"`, now
  reads `"trunk"`.

## Alternatives considered

- **Keep `"main"`; only improve the rejection message.** Rejected. A better
  error papers over the confusion but leaves the value reading as a literal
  branch in every config and doc.
- **Accept the literal trunk name (say, `"master"`) too.** Rejected. Two
  spellings for one role bring back ambiguity — on a `master` repo, does
  `"main"` mean the role or an error? — for no gain over one clear keyword.
- **Do nothing; the feature already works for any trunk.** Rejected. It works,
  yet the name misleads exactly the users whose trunk is not `main` — the ones
  the reflex name serves worst.
