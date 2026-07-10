# The Installer

_The Deno/TypeScript CLI that scaffolds a Harness into a project and keeps it
upgradable._

This subtree covers the scaffolding face of discern under [`src/`](../../src/) —
the [`commands/`](../../src/commands/) and [`lib/`](../../src/lib/) that drive
an install (the [Engine](../00-orientation/glossary.md#engine) under
[`src/engine/`](../../src/engine/) is the run-time half). The **Installer** lays
down the seed and Skill files bundled into the binary (their source is
[`templates/`](../../templates/)) and writes a **Harness** into a project, then
refreshes it over time **without clobbering** the files you own. It compiles to
standalone binaries in `dist/` via `deno task build`; an installed project never
needs Deno.

The command surface is five installer verbs: `setup` (the staged, zero-config
scaffold handshake — welcome → verify → begin → done), `upgrade` (run pending
migrations, re-materialize Skills, reconcile the fixed `discern.toml` scaffold,
and recompile guidance), `doctor` (verify an install and report pending Schema
steps), `config` (comment-preserving `discern.toml` edits), and `preset`
(overlay a reusable preset). Routing lives in [`main.ts`](../../src/main.ts);
each verb's logic is in `src/commands/`.

Each human touchpoint of the handshake **serves a pre-composed, first-person
_message to your human_** the agent relays — the consent conversation at
`verify`, the started moment at `begin`, and the completion summary at `done` —
so a terse agent that only couriers discern's words still delivers a complete
first experience (rewording into the agent's own voice is allowed; dropping a
point is not). A fresh `setup begin` requires an explicit **`--confirmed`**
attestation that the consent conversation happened; without it — and outside the
declarative `--config` / `--allow-dirty` paths and the write-nothing `--dry-run`
preview — `begin` refuses before writing anything and re-serves that same
consent message
([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).
`setup done` then closes the handshake: it refuses while any tracked change or
untracked authored-setup file sits uncommitted (the proof runs on committed
history; untracked files outside the setup footprint — an env file with secrets
— never block), then proves the gate — `refresh → doctor →
finish` in the main
checkout, then a **throwaway worktree probe** that branches from the
now-complete HEAD and runs the gate in a copy, so a project that passes here but
breaks in a worktree (an env-anchored app whose untracked `.env` or dependency
dir never travels) cannot complete setup silently
([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)).

The ideas worth understanding here: the **disposition**-driven scaffold, with
ownership in three buckets —
[yours](../00-orientation/glossary.md#your-files--yours) (committed seeds,
write-once), a co-managed `discern.toml` scaffold, and
[the binary's](../00-orientation/glossary.md#the-binarys-files) (gitignored,
re-published artifacts) — so `upgrade` overwrites the binary's files, restores
missing fixed config sections/keys, and leaves project-owned values alone; and
the **Schema-version** [Migration](../00-orientation/glossary.md#migration)
chain that evolves an install's shape, stamped into `[meta].schema_version` in
`discern.toml` (the `5 → 6` step dissolved the old hidden `.discern/` directory
into this one root file — [ADR 0020](../_adr/0020-dissolve-discern-dir.md) — and
the `14 → 15` step gathered the authored surface into the visible `discern/`
[Namespace](../00-orientation/glossary.md#namespace) —
[ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).
`upgrade` validates the migrated config before stamping that schema, and
`upgrade` refuse a config stamped by a newer binary rather than silently
downgrading it
([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)). The
config-scaffold reconciliation is separate from behaviour-changing migrations:
it is additive and only-if-absent, and is recorded in
[ADR 0092](../_adr/0092-upgrade-reconciles-config-scaffold.md).

Setup's documentation skeleton is also config-pointed. `[docs].dir` defaults to
`discern/docs/` — the [map](../00-orientation/glossary.md#map)'s own folder,
colliding with nothing; `setup verify`'s consent conversation asks whether
discern should instead manage the project's existing docs, and
`setup begin --docs <path>` persists and scaffolds the chosen root
([ADR 0100](../_adr/0100-doctree-is-the-agents-map.md)). The docs browser and
quality-gate declarations resolve the same field
([ADR 0080](../_adr/0080-configured-agent-docs-root.md)).

`setup begin` resolves its destination before writing: inside an existing
install it walks to the nearest ancestor with `discern.toml`; before install, in
a Git checkout, it uses the Git top-level; outside Git it stays in the current
directory. `setup verify` shares the same resolution, so its previews describe
the tree `begin` will actually touch.

Setup also grounds itself in the repo's real state rather than assuming a
pristine one ([ADR 0103](../_adr/0103-setup-holds-up-on-imperfect-repos.md)):
`begin` detects the repository's actual integration branch (`origin/HEAD`, then
the branch setup started from, then `init.defaultBranch`) and stamps it into
`[project].main_branch`, so the gate's merge check is armed on `master` and
unborn-default repos alike; a directory without git is served a git-init-first
plan whose consent message promises no isolation it can't deliver; a missing git
identity is named in `verify`'s findings with the exact `git config` commands;
and the first-contact welcome shows in non-git directories too, leading with the
`git init` step. An abandoned half-finished setup (its config committed only on
the `discern-setup` branch) routes the welcome, `verify`, and a re-`begin` back
to the half-finished branch instead of re-scaffolding over it.

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
  the setup conversation → shipping a first change → `finish` → `graduate`.
- [what-discern-writes.md](what-discern-writes.md) — the whole footprint (what
  discern creates, merges into, and keeps), what runs on your machine, and how
  `discern uninstall` removes it.
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
