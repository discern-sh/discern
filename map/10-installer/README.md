# The Installer

_The Deno/TypeScript CLI that scaffolds discern into a project and keeps it
upgradable._

This subtree covers discern's scaffolding code under [`src/`](../../src/): the
[`commands/`](../../src/commands/) and [`lib/`](../../src/lib/) that drive an
install. The [Engine](../00-orientation/glossary.md#engine) under
[`src/engine/`](../../src/engine/) is the run-time half. The **Installer**
writes the bundled seeds from [`templates/`](../../templates/) into a project,
then refreshes binary-owned files **without clobbering** yours. It compiles to
standalone binaries in `dist/`; installed projects do not need Deno.

Five installer verbs form the surface: `setup` (welcome → verify → begin →
done), `upgrade` (migrate and refresh), `doctor` (verify the install), `config`
(comment-preserving `discern.toml` edits), and `preset` (apply a reusable
preset). [`main.ts`](../../src/main.ts) routes them to `src/commands/`.

Each handshake touchpoint serves a first-person message for the agent to relay:
consent at `verify`, the started moment at `begin`, and completion at `done`.
Even an agent acting only as courier therefore delivers the full experience; it
may reword, but not drop, a point. A fresh `setup begin` requires a
**`--confirmed`** attestation that consent happened. Without it — outside the
declarative `--config` / `--allow-dirty` paths and write-nothing `--dry-run` —
`begin` writes nothing and re-serves the consent message
([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).
`setup done` closes the handshake. It first requires committed setup work;
untracked files outside that footprint, such as a secret-bearing env file, do
not block. It then proves `refresh → doctor → done` in the main checkout and
repeats the gate in a **throwaway worktree** from the same HEAD. A project that
works here but breaks in a copy therefore cannot complete setup silently
([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)).

The ideas worth understanding here: the **disposition**-driven scaffold, with
ownership in three buckets —
[yours](../00-orientation/glossary.md#your-files--yours) (committed seeds,
write-once), a co-managed `discern.toml` scaffold, and
[the binary's](../00-orientation/glossary.md#the-binarys-files) (re-published
artifacts) — so `upgrade` overwrites the binary's files, restores missing fixed
config sections/keys, and leaves project-owned values alone; and the
**Schema-version** [Migration](../00-orientation/glossary.md#migration) chain
that evolves an install's shape, stamped into `[meta].schema_version` in
`discern.toml` (the `5 → 6` step dissolved the old hidden `.discern/` directory
into this one root file — [ADR 0020](../_adr/0020-dissolve-discern-dir.md) — and
the `14 → 15` step gathered the authored surface into the visible `discern/`
[Namespace](../00-orientation/glossary.md#namespace) —
[ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).
`upgrade` validates the migrated config before stamping that schema, and refuses
a config stamped by a newer binary rather than silently downgrading it
([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)). The
config-scaffold reconciliation is separate from behaviour-changing migrations:
it is additive and only-if-absent, and is recorded in
[ADR 0092](../_adr/0092-upgrade-reconciles-config-scaffold.md).

Setup's documentation skeleton is also config-pointed. `[map].dir` defaults to
`map/` — the [map](../00-orientation/glossary.md#map)'s own folder, colliding
with nothing; `setup verify`'s consent conversation asks whether discern should
instead manage the project's existing docs, and `setup begin --map <path>`
persists and scaffolds the chosen root
([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md)). The docs browser
and quality-gate declarations resolve the same field
([ADR 0080](../_adr/0080-configured-agent-map-root.md)).

`setup begin` resolves its destination before writing: inside an existing
install it walks to the nearest ancestor with `discern.toml`; before install, in
a Git checkout, it uses the Git top-level; outside Git it stays in the current
directory. `setup verify` shares the same resolution, so its previews describe
the tree `begin` will actually touch.

Setup also grounds itself in the repo's real state rather than assuming a
pristine one ([ADR 0103](../_adr/0103-setup-holds-up-on-imperfect-repos.md)):
`begin` detects the repository's actual trunk — the shared landing branch — and
stamps it into `[project].main_branch`, so the gate's merge check is armed on
`master` and unborn-default repos alike. Detection reads, in descending
reliability, `origin/HEAD`, then the branch setup started from, then — when
setup itself was re-run while already on the `discern-setup` branch (a retry
after a first attempt created the branch and failed before writing the config) —
the branch that `discern-setup` was forked from, recovered from the actual local
branches, and only as a last resort `init.defaultBranch` (which vendor git
builds bake to `main` in an unmaskable config, so it is never consulted ahead of
the real branches). A directory without git is served a git-init-first plan
whose consent message promises no isolation it can't deliver; a missing git
identity is named in `verify`'s findings with the exact `git config` commands;
and the first-contact welcome shows in non-git directories too, leading with the
`git init` step.

A first `begin` that failed before finishing is designed to converge on a re-run
rather than strand work: an abandoned half-finished setup (its config committed
only on the `discern-setup` branch) routes the welcome, `verify`, and a
re-`begin` back to the half-finished branch instead of re-scaffolding over it,
and a re-`begin` that lands back on `discern-setup` re-attempts the
discern-wiring commit the first run left uncommitted (a machinery commit that
failed on a missing identity or a rejecting hook is retried, not lost). A
`--force` re-scaffold reads the persisted `[guidance].agents` and lays exactly
those agents' seed files, never reverting to the built-in default pair. And
`setup done` never records completion for a run that then fails: it refuses a
`discern.toml` it cannot parse — the floor even `--force` cannot override — so
the `[meta].bootstrapped` marker is only ever written after every check that
could reject the run has passed.

## Config reference

[`config-reference.md`](config-reference.md) documents every `discern.toml`
section, key, type, and default. It is **generated** from the one canonical
config schema
([`src/shared/config_schema.ts`](../../src/shared/config_schema.ts),
[ADR 0026](../_adr/0026-typed-config-schema.md)) by `deno task codegen` — so the
reference, the editor [JSON Schema](../../schema/discern-config.schema.json),
and the rules the engine enforces all come from one source and cannot drift.
Edit the schema, not the generated files.

## Guides

- [walkthrough.md](walkthrough.md) — one honest session end to end: install →
  the setup conversation → shipping a first change → `done` → `accept`.
- [what-discern-writes.md](what-discern-writes.md) — the whole footprint (what
  discern creates, merges into, and keeps), what runs on your machine, and how
  `discern uninstall` removes it.
- [artifact-ownership.md](artifact-ownership.md) — the per-kind posture behind
  the managed `.gitignore` block: compiled guidance tracked, materialized and
  machine-local artifacts ignored.
- [faq.md](faq.md) — common questions and troubleshooting, fronted by
  `discern doctor`.

## Reference

- [migrations.md](migrations.md) — the versioned Migration chain, the Schema
  version, and the idempotency contract.
- [config-access.md](../50-engine-internals/config-access.md) — the typed
  schema, the paths registry, and the comment-preserving config writer.

## See also

- [concepts.md](../00-orientation/concepts.md) — where the Installer sits in the
  whole system.
- [install-surface.md](../80-development/install-surface.md) — the exact map of
  what `setup begin` lays down, by disposition.
