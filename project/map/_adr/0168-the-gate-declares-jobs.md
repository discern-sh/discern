# ADR 0168: The gate declares jobs

> **Amendments.**
>
> - **[ADR 0317](0317-gate-commands-and-setup-applicability-are-separate-facts.md) — execution and applicability remain separate:** `[jobs]` remains the only authority for Gate commands. Setup assurance distinguishes an applicable absence from a lifecycle that does not apply through `[assurance].not_applicable`, which cannot suppress a configured job.

**Status**: accepted

## Context

[ADR 0017](0017-capabilities-model.md) split declared gate work between a closed `[capabilities]` table and open `[checks.<name>]` tables. Its rejected alternative — fold checks into capabilities — would have made the closed table open-ended. That would have lost three properties the decision needed: the engine could enumerate every capability, an omitted capability was knowably absent for `doctor`, and an unknown key was a typo rather than a new command.

The product has since unified the runtime model while leaving that split exposed in configuration. Public gate results already call either kind a `job`; global timeouts apply to every job; the concurrency engine lives under `src/engine/jobs/`; and standards share the gate job pipeline ([ADR 0155](0155-standalone-standards-share-the-gate-job-pipeline.md)). The old nouns now obscure that model. “Check” names a config family, a gate stage, the full quality check, and several internal diagnostic types. “Capability” also collides with Model Context Protocol vocabulary.

The premises of ADR 0017's rejected alternative have changed. The desired merge is not an open set hidden inside a closed capabilities table. It is an honestly open jobs table with a closed subset of names that still carries the derivation and readiness properties ADR 0017 defended. Before launch, that correction costs less than teaching two nouns forever, per [ADR 0120](0120-launch-verb-canon.md).

## Decision

**Declare project gate work in one root `[jobs]` table. Known job names derive their stage; custom names declare one.**

### One namespace, two validated forms

The engine keeps an enumerable `KNOWN_JOBS` map from each built-in job name — `format`, `build`, `lint`, `typecheck`, `test`, and `smoke` — to its stage. A known name accepts a command string, a command list, or a `{ run, timeout }` table. Its name is the single source of its stage, so declaring `stage` on a known name is an error.

Any other legal name is custom. It must use a `[jobs.<name>]` table with `stage` and `run`, plus optional `provides` and `timeout`. Shorthand under an unknown name is an error that points to the table form and required `stage`. Consequently, `tset = "deno task test"` remains a typo, not a silently accepted custom job.

The table stays at `[jobs]`, not `[gate.jobs]`. Jobs are the declared work; `[gate]` holds execution ergonomics such as streaming, fail-fast behavior, and timeouts. Scope gates and standards keep their own tables because their declarations carry different semantics: change classification for scopes and never-loosen measurement for standards. When a run schedules them, they still become labeled jobs in that run.

`status` reports one `jobs` array for declared work. `doctor` retains the model's important distinction: it reports which known job names are wired and names custom jobs separately. Absence remains knowable because readiness iterates `KNOWN_JOBS`, not the keys that happen to exist in `[jobs]`.

### Retirement and migration

Schema 22 migrates `[capabilities]` values and `[checks.<name>]` tables into `[jobs]`, preserving command forms, options, and attached comments before validating the new config and stamping the schema, as required by [ADR 0085](0085-validate-migrations-before-schema-stamping.md). The migration is idempotent and refuses a mixed old/new namespace rather than guessing through a collision.

`discern config set-job` is the only setting command. `[capabilities]`, `[checks]`, `config set-capability`, and `config set-check` have no aliases. Each retired spelling hard-errors with a one-line redirect naming `[jobs]` or `config set-job`, following ADR 0120's no-alias policy. “Capability” and “check” remain ordinary English words; only their retired config and command positions are forbidden.

## Why this does not revive ADR 0017's rejected alternative

ADR 0017 rejected putting open custom names into a table whose contract was that its keys were closed. This decision reverses the direction of the merge: the table is openly `[jobs]`, while the known-name subset remains closed and machine-readable.

Everything ADR 0017 defended survives:

- `KNOWN_JOBS` enumerates the built-in names and derives their stages;
- `doctor` can report every known name whether present or absent;
- only a known name may use shorthand, so misspelled known names fail;
- custom work is visibly custom because it must declare a table and stage.

The two-table name-collision rule disappears for a stronger reason: one namespace makes two entries with the same name structurally impossible.

## Consequences

- A newcomer sees the ordinary continuous-integration model directly: jobs run in stages. The starter configuration keeps its flat known-name lines with only the header changed.
- The schema, generated types and references, status result, doctor output, setup coach, guidance, and glossary share one declared-work noun.
- Adding a known job remains a closed-set change. The compiler and parity guards force its stage, schema, setup, and glossary consumers to follow.
- Existing prelaunch installs must run `discern upgrade`. Retired spellings fail loudly and teach the successor; scripts receive no compatibility window.
- Historical decisions keep their original reasoning. This ADR records the reversal rather than rewriting ADR 0017's rejected alternative after the fact.

## Alternatives considered

- **Keep `[capabilities]` and `[checks.<name>]`** — preserves an implementation distinction the runtime and result model no longer expose, keeps the collision rule, and makes every explanation translate two names into “job.” Rejected.
- **Put custom names inside `[capabilities]`** — the alternative ADR 0017 rejected. It still falsely presents an open namespace as closed and weakens typo detection. Rejected.
- **Nest the table under `[gate.jobs]`** — confuses the work with its execution settings and makes the common starter declarations needlessly deep. Rejected.
- **Allow `stage` on known names** — creates two sources of truth that can disagree. The known-name mapping owns the stage. Rejected.
- **Accept shorthand for custom names and infer a stage** — there is no honest inference from an arbitrary name, and accepting it would turn typos into commands. Rejected.
- **Keep aliases for the retired tables and commands** — gives one concept two live spellings and lets old examples remain executable suggestions. Prelaunch redirects are cheaper and clearer. Rejected.
