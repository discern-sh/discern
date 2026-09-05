# ADR 0367: Worktree local state records intent before effects

**Status**: accepted. Tightens the resource lifecycle from [ADR 0025](0025-worktree-resources.md), the Project Script namespace from [ADR 0137](0137-project-scripts-live-under-the-script-command.md), and environment membership from [ADR 0258](0258-every-discern-environment-contract-has-one-membership-authority.md).

## Context

Several local contracts were individually deterministic but not replay-safe as a system. A resource ledger entry was treated as proof that create had completed even though the entry was written before the command. After a crash or optional failure, setup skipped the uncertain resource forever. Destroy lacked the worktree handle supplied to create and ensure. Shared env files received a marker that appeared to claim the whole file, and a newly inherited secret used the process file-creation mask. Project Scripts inherited their caller's directory, an open-ended `DISCERN_*` namespace, and a colon-to-dash name rewrite.

These boundaries become difficult to change once projects depend on them. Local state therefore needs explicit phases and exact process contracts before publication.

## Decision

Each managed resource ledger entry has an `intent` or `ready` phase. Before create, discern atomically persists ownership, the canonical worktree path, the worktree and resource handles, expanded token values, the retry policy, and the fully expanded destroy action. Only a successful create advances that exact entry to `ready`. Re-entry skips only `ready`. An `intent` runs its frozen destroy action and compare-and-swap removes the entry before create may run again. Missing, unsafe, failed, or changed cleanup evidence refuses the retry. Orphan garbage collection may reclaim either phase under its existing liveness, opt-out, unresolved-token, and compare-and-swap guards. Failed destroy evidence remains for another attempt.

Resources create in declaration order and destroy in reverse order. Create, ensure, explicit teardown, and orphan cleanup all derive their environment from one function: `DISCERN_WORKTREE` plus the concrete `DISCERN_RESOURCE_<NAME>`. Handles are deterministic coordination values. Input normalization, repeated project slugs, and the bounded port hash can collide; none is secret, authorization evidence, or a global uniqueness guarantee.

The configured worktree env-file order remains last-definition-wins. A new value uses the first existing file. Only declared inheritance may create the first configured file, at POSIX mode `0600`; an existing mode is never changed. Inheritance preserves a worktree-specific value and may replace the matching default from `<first-configured-env-file>.example`. Port and resource writers never create a file. Every write reconciles one attribution-aware marker whose scope is the discern-managed worktree values within the shared file.

Project Scripts resolve direct regular-file names literally and always run from the project root. They inherit ordinary process values after every ambient or supplied `DISCERN_*` name is removed. discern then exports four supported names: absolute `DISCERN_ROOT`, absolute `DISCERN_TOML`, absolute `DISCERN_SCRIPTS_DIR`, and `DISCERN_TRUNK`. The subprocess boundary may add the current recording invocation id as `DISCERN_SPAWNED_BY`, following [ADR 0282](0282-self-invocations-carry-recorded-provenance.md). This fresh private marker attributes nested discern runs without admitting an inherited value, lock lease, identity field, alias, or other internal diagnostic state. It is advisory provenance, not a supported script variable or a capability. Unknown, non-executable, and non-command paths each retain a registered JSON refusal when machine mode was selected before the name.

## Consequences

- A crash cannot masquerade as successful resource creation. Safe cleanup precedes every replay, including optional first failures.
- A create-only command that fails cannot be retried automatically because no frozen cleanup can prove the external state absent. The result asks for reconciliation instead of guessing.
- Fresh default setup writes no env file. Declared secret inheritance is private on creation and shared-file ownership remains honest.
- CLI and Desk Project Scripts have identical cwd, naming, environment, argument, exit, and refusal contracts.
- The environment registry contains supported contracts only. Doctor reports any Project Script reference outside the supported Project Script and worktree-environment families.

## Alternatives considered

- **Treat any ledger entry as provisioned.** Rejected because an intent written before a failed effect is not completion evidence.
- **Retry create directly after intent.** Rejected because create is allowed to be non-idempotent and may have completed before the crash.
- **Create a dedicated `.env.discern`.** Rejected because projects already configure their env-file order; an extra implicit file would change application loading behavior.
- **Pass all ambient discern variables to Project Scripts.** Rejected because internal diagnostics and lock capabilities would become accidental public contracts.
