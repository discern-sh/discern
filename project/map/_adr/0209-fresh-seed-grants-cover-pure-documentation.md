# ADR 0209: Fresh seed grants cover pure documentation

> **Amendments.**
>
> - **Vocabulary ([ADR 0222](0222-frozen-contracts-complete-the-canon.md)):** the scope spelling is `[scopes.map]` (formerly `[scopes.docs]`); the split-seed policy below stands.

**Status**: accepted; extends [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md) and [ADR 0195](0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)

## Context

ADR 0194 made scope definitions consent-bearing: a scope named in `[acceptance].pre_authorized` can land without a per-landing conversation. The shipped config template placed every gate-neutral authored and materialized path in `[scopes.docs]`, then used `["docs"]` as the acceptance example. Following that example granted the map and deferred-work ledger together with the project brief, guidance source, authored skills, and materialized skills directories.

Those instruction surfaces steer later agent sessions and attract low-value additions. They need owner review even though their Markdown changes do not need the project gate. discern's own config already separates them, but fresh installs still received the combined seed.

Existing scope tables have a different ownership boundary. Config reconciliation treats every named `[scopes.<name>]` table as project-owned population. An existing `[scopes.docs].paths` value may have started from an older seed and then acquired local meaning, so its current bytes cannot prove that discern still owns the list.

## Decision

Fresh installs seed 2 neutral scopes. `[scopes.docs]` contains the configured map and deferred-work ledger. `[scopes.guidance]` contains every other gate-neutral authored source, currently the project brief, guidance source, and authored skills directory, plus every known agent's exact materialized skills directory.

The `[acceptance]` example continues to name `docs` only. Guidance remains outside the standing grant and reaches the owner for review.

New gate-neutral authored sources enroll in `guidance` unless they join the narrow documentation set. New materialized skills directories derive from the provider registry and enroll in `guidance`.

Existing installs receive no scope migration and config reconciliation does not add `[scopes.guidance]`. Upgrade may refresh discern-owned scope comments, but it leaves named scope tables and their values unchanged. An owner who wants the new boundary in an earlier install splits the existing scope manually.

## Consequences

- A new owner who copies the shipped `["docs"]` example grants only the map and deferred-work ledger.
- Agent instructions remain gate-neutral while every landing that changes them needs conversation or a separate verified grant.
- The project brief moves with the instruction surfaces because setup agents read it as authored intent.
- Existing installs keep their current classification and landing policy. They do not gain the safer split until their owner edits the scope definitions.
- The historical schema-23 neutral-scope migration keeps its combined target. Replaying an older migration does not acquire this fresh-install policy.

## Alternatives considered

- **Add `[scopes.guidance]` during upgrade and subtract its paths from `docs`.** Rejected because both writes would change owner-authored scope population and could narrow or widen a standing grant.
- **Add `guidance` while leaving `docs` unchanged.** Rejected because overlapping scopes would preserve the unsafe `docs` grant and give the new section no consent effect.
- **Put the project brief in `docs`.** Rejected because setup agents read it as authored intent. Grouping it with guidance preserves review at the point where that intent changes.
