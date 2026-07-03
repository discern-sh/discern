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

The command surface is six verbs: `setup` (the staged, zero-config scaffold
handshake — welcome → verify → begin → done; the retired `init`/`bootstrap`
names redirect to it), `upgrade` (run pending migrations, re-materialize Skills,
recompile guidance), `doctor` (verify an install), `migrate` (report pending
Schema steps), `config` (comment-preserving `discern.toml` edits), and
`add-preset` (overlay a reusable preset). Routing lives in
[`main.ts`](../../src/main.ts); each verb's logic is in `src/commands/`.

Each human touchpoint of the handshake **serves a pre-composed, first-person
_message to your human_** the agent relays — the consent conversation at
`verify`, the started moment at `begin`, and the completion summary at `done` —
so a terse agent that only couriers discern's words still delivers a complete
first experience (rewording into the agent's own voice is allowed; dropping a
point is not). A fresh `setup begin` requires an explicit **`--confirmed`**
attestation that the consent conversation happened; without it — and outside the
declarative `--config` / `--allow-dirty` paths — `begin` refuses before writing
anything and re-serves that same consent message
([ADR 0086](../_adr/0086-setup-serves-relay-messages-and-a-consent-attestation.md)).
`setup done` then closes the handshake by proving the gate —
`refresh → doctor →
finish` in the main checkout, then a **throwaway worktree
probe** that runs the gate in a copy, so a project that passes here but breaks
in a worktree (an env-anchored app whose untracked `.env` or dependency dir
never travels) cannot complete setup silently
([ADR 0090](../_adr/0090-setup-proves-worktree-viability.md)).

The ideas worth understanding here: the **disposition**-driven scaffold, with
ownership in two buckets —
[yours](../00-orientation/glossary.md#your-files--yours) (committed seeds,
write-once) and [the binary's](../00-orientation/glossary.md#the-binarys-files)
(gitignored, re-published artifacts) — so `upgrade` overwrites the binary's
files but never touches yours; and the **Schema-version**
[Migration](../00-orientation/glossary.md#migration) chain that evolves an
install's shape, stamped into `[meta].schema_version` in `discern.toml` (the
`5 → 6` step dissolved the old `.discern/` namespace into this one root file —
[ADR 0020](../_adr/0020-dissolve-discern-dir.md)). `upgrade` validates the
migrated config before stamping that schema, and `upgrade` / `migrate` refuse a
config stamped by a newer binary rather than silently downgrading it
([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)).

Setup's documentation skeleton is also config-pointed. `[docs].dir` defaults to
`docs/`; `setup verify` asks for a separate location when that path already
holds human-written docs, and `setup begin --docs <path>` persists and scaffolds
the chosen root. The docs browser and quality-gate declarations resolve the same
field ([ADR 0080](../_adr/0080-configured-agent-docs-root.md)).

`setup begin` resolves its destination before writing: inside an existing
install it walks to the nearest ancestor with `discern.toml`; before install, in
a Git checkout, it uses the Git top-level; outside Git it stays in the current
directory.

## Config reference

[`config-reference.md`](config-reference.md) documents every `discern.toml`
section, key, type, and default. It is **generated** from the one canonical
config schema
([`src/shared/config_schema.ts`](../../src/shared/config_schema.ts),
[ADR 0026](../_adr/0026-typed-config-schema.md)) by `deno task codegen` — so the
reference, the editor [JSON Schema](../../schema/discern-config.schema.json),
and the rules the engine enforces all come from one source and cannot drift.
Edit the schema, not the generated files.

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`discern-document-subsystem`](../../templates/skills/discern-document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_ | What it will cover                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `command-surface.md`   | The six verbs, their flags, and the `--json` / exit-code contract.                           |
| `the-install-plan.md`  | How the bundled seeds become a plan of file ops by disposition (`fs_plan`, token rendering). |
| `migrations.md`        | The versioned Migration chain, the Schema version, and the idempotency contract (ADR 0014).  |
| `config-editing.md`    | Comment-preserving TOML edits behind `discern config` (`toml_edit`).                         |

## See also

- [concepts.md](../00-orientation/concepts.md) — where the Installer sits in the
  whole system.
- [install-surface.md](../80-development/install-surface.md) — the exact map of
  what `setup begin` lays down, by disposition.
