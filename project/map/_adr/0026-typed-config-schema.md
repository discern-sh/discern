# ADR 0026: One typed (Zod) config schema as the single source of truth

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md), [ADR 0137](0137-project-scripts-live-under-the-script-command.md), [ADR 0168](0168-the-gate-declares-jobs.md)):** current pointers use `standards` (formerly `ratchets`), `map` where `docs` names the command, config, or tree, Project Script for the former project Recipe surface, and `[jobs]` / `[jobs.<name>]`, known/custom `job` (formerly `[capabilities]` / `[checks.<name>]`, gate `capability` / custom `check`); the decisions below are unchanged.

**Status**: accepted

## Context

A project's entire discern footprint is one root `discern.toml`. The engine (`src/engine/**`), installer commands (`src/commands/**`), and shared core (`src/shared/**`) all read it. discern already lived by three principles that this file quietly violated:

- a **closed, enumerable vocabulary** beats an open stringly bag ([ADR 0017](0017-capabilities-model.md), applied to the known-name subset of `[jobs]`);
- **one source of truth, nothing to drift** ([ADR 0019](0019-single-binary-ts-engine.md));
- the strict TypeScript engine exists precisely so a tool that preaches typechecking doesn't ship an un-typechecked core.

Those principles stopped at the config boundary:

1. **A stringly-typed reader.** The live config was read through `config.get("worktree.resources.db.create")`, `config.bool(...)`, `config.array(...)` — 73 call sites across ~14 files. A typo'd key silently returned a default; a missing `bool` was silently `false`; nothing validated at load time. A mistake surfaced (if at all) as wrong behaviour far from its cause.

2. **The config's shape, defaults, and prose were defined nowhere canonical.** They were smeared across at least six hand-synced artifacts: the runtime reader, the wizard `DEFAULTS`, the init/preset document type, a hand-written editor JSON Schema, the closed vocabularies (`capabilities`/`features`), the `paths.ts` `DEFAULT_*` constants, `doctor`'s ad-hoc checks (which re-parsed the config ~10 times), plus the prose in `discern.toml.tmpl` and the docs.

3. **The copies had already drifted** — proof: the editor JSON Schema still described the config file as `.discern/config.toml` (abolished in [ADR 0020](0020-dissolve-discern-dir.md) — it is a root `discern.toml` now) and its `agents` enum listed only `["claude_code","codex"]`, missing `gemini`. Nobody noticed because nothing forced them to agree.

## Decision

**One Zod schema (`src/shared/config_schema.ts`) is the single source of truth for the live `discern.toml`, and everything else derives from it.** The schema defines every section, key, type, **default**, and **human description** (`.describe(...)`), and exports the inferred type `DiscernConfig`.

- **Load = parse + validate + default.** `parseConfig(text) → { config, issues }` runs `@std/toml` then `configSchema.safeParse`, collecting **every** problem; `parseConfigOrThrow` / `loadConfig` fail fast with a clear, path-qualified `ConfigValidationError`. A TOML _syntax_ error stays a `ConfigParseError`. Both surface through the one top-level CLI handler, human and `--json`. The engine reads a **fully-typed, fully-defaulted object** — typed field access (`cfg.gate.fail_fast`), autocompleted, no string keys. The old `get/array/bool/has/subsections/keys/getNumber` surface is gone.

- **Per-call-site defaults collapse into the schema.** `[skills].dir`, `gate.fail_fast` (ON), the features-default-ON rule, a resource's `required`/`gc`/`retries`, the `paths.ts` `DEFAULT_*` constants — each is one `.default(...)`, defined once.

- **Strict everywhere.** Unknown sections/keys, a dead `[worktree.db]`/`[worktree.dev_server]` adapter, a standard with no `run`, a non-boolean feature, a bad stage/direction — all fail at load with a path-qualified message. The closed known-job vocabulary ([ADR 0017](0017-capabilities-model.md)) is now enforced by the type system, not a bespoke check.

- **`doctor` folds its structural validation into the shared validator.** One "config schema" check reports the issue list; the config is parsed **once**, not ~10 times. Only the _semantic/liveness_ checks stay bespoke (is a command on PATH, does a Project Script source the retired shell library, does the gotchas doc exist, does another tool also automate worktrees).

- **The editor JSON Schema and the docs reference are GENERATED** (`deno task codegen`, `src/shared/config_codegen.ts`): `schema/discern-config.schema.json` from a `configDocSchema` that reuses the _same_ Zod building blocks as the live config, and `map/10-installer/config-reference.md` from the live schema's `.describe(...)` annotations. The two staleness bugs are gone **as a consequence of generation**, not patched by hand. The init/preset config document (`DiscernConfigDoc`) is `z.input<configDocSchema>` — a mechanically-derived subset, so it cannot diverge from the live shape.

- **The narrow exception: `RawConfig`.** Two jobs need un-validated, generic dotted-key access and must NOT trip the schema: the `discern config get/…` Project Script passthrough (a `jq`-for-the-config over arbitrary keys) and the standard "never-loosen vs main" baseline (which reads an _older_, possibly un-migrated `git show main:discern.toml` for one number). `RawConfig` carries no schema knowledge, so there is nothing in it to drift.

- **The template stays hand-authored; tests bind it to the schema.** See the boundary below.

- **No on-disk shape change, so no migration.** Nothing this change writes to disk moved: the template is byte-identical, `setup`/`upgrade` write the same bytes, and a correctly-migrated schema-8 config validates cleanly. This is a pure read/validation/generation refactor, so `SCHEMA_VERSION` stays **8**. The stricter _validation_ can reject a previously-_tolerated_ (never really valid) hand-edited config; that read-time behaviour change is documented in `MIGRATION_PROMPT.md`, and `discern doctor` now names each offending key.

## The template-generation boundary (and why)

The brief asked for the `discern.toml.tmpl` _prose_ to be generated from the schema's `.describe(...)` too. We deliberately did **not** fully generate the template, and instead **bound it to the schema with drift-guard tests**. The reason is [ADR 0005](0005-declarative-config.md): the legible, comment-annotated config is a _feature_. The template carries curated, domain-spanning examples (`# format = "prettier --write ."   # or "ruff format ." or "gofmt -w ."`), a known-job→stage table, a per-token reference block, and a deliberate mix of active and commented lines. Mechanically rendering that from one-line `.describe()` strings would either flatten the legibility or force paragraph-long descriptions and presentation metadata into a runtime schema — degrading the template to satisfy generation, the exact trade the principle forbids.

So the split is:

- **Fully generated** (cannot drift, regenerate with `deno task codegen`): the editor JSON Schema and the docs config-reference. Pure derived artifacts with no curation to lose.
- **Hand-authored, drift-guarded by tests**: `discern.toml.tmpl`. Two gate-stage tests bind it to the schema without flattening it — (a) the rendered template must **validate** under the schema (it can never drift into producing an invalid config), and (b) every schema section must appear in the template (a new section can't be silently undocumented). The per-key reference lives in the generated docs page; the template stays the legible, curated scaffold.

A schema change that isn't regenerated **fails the gate**: sync tests assert each committed generated artifact equals its generator output, in the test stage that CI runs (`deno task dev done`). That guard is what stops the drift from coming back.

## Consequences

- **Typos and malformed config fail loudly, at load, with the offending path** — not silently as a wrong default consumed somewhere downstream. `doctor` reads the same validator, so its report and the engine's enforcement agree by construction.
- **The drift class is closed.** The reader, the defaults, the editor schema, the docs, and the closed vocabularies are now one definition with generated/tested mirrors; the gemini/`.discern` staleness bugs cannot recur.
- **Zod is a new dependency** (`jsr:@zod/zod`, Zod 4), added the JSR-native way. Its inferred types stay internal (never on the package's exported API), so the `no-slow-types` lint rule is satisfied; it works under `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess`.
- **Stricter validation is a (documented) behaviour change.** A hand-edited config with an unknown key or a leftover dead adapter that the old reader silently tolerated now fails at load — including a config produced by `discern config set <unknown.key>`. `discern upgrade` already removes the known legacy tables; `discern doctor` names anything else. See `MIGRATION_PROMPT.md`.
- **Slightly more ceremony to add a key.** A new config key is one schema field (type + default + describe), then `deno task codegen` and a one-line note in the template — versus touching six files. The net is far less work and no drift.

## Alternatives considered

- **A hand-written TypeScript interface + a manual validator.** Rejected: that is what we had in spirit (six copies); it does not generate the JSON Schema or the docs, and offers no single place for defaults + prose.
- **Validate leniently (warn, don't fail).** Rejected: a tool that preaches a green gate should not quietly run on a config it can't fully understand. Failing at load, with the path, is the honest behaviour, and `doctor` exists to make the fix obvious.
- **Fully generate `discern.toml.tmpl` from the schema.** Rejected for now — see the boundary above; it fought ADR 0005's legible-config feature. The drift-guard tests get the "cannot diverge" guarantee without the cost.
- **Keep the stringly `Config` accessor for "flexibility."** Rejected: the flexibility was the bug. The one place that genuinely needs generic access (the Project Script passthrough) keeps it explicitly, as `RawConfig`.

This applies [ADR 0017](0017-capabilities-model.md) (closed vocabulary) and [ADR 0019](0019-single-binary-ts-engine.md) (one source, nothing to drift) at the config boundary, and respects [ADR 0005](0005-declarative-config.md) (the comment-preserving, legible config) by leaving the template hand-authored.
