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

The command surface is six verbs: `init` (scaffold), `upgrade` (run pending
migrations, re-materialize Skills, recompile guidance), `doctor` (verify an
install), `migrate` (report pending Schema steps), `config` (comment-preserving
`discern.toml` edits), and `add-preset` (overlay a reusable preset). Routing
lives in [`main.ts`](../../src/main.ts); each verb's logic is in
`src/commands/`.

The ideas worth understanding here: the **disposition**-driven scaffold, with
ownership in two buckets —
[yours](../00-orientation/glossary.md#your-files--yours) (committed seeds,
write-once) and [the binary's](../00-orientation/glossary.md#the-binarys-files)
(gitignored, re-published artifacts) — so `upgrade` overwrites the binary's
files but never touches yours; and the **Schema-version**
[Migration](../00-orientation/glossary.md#migration) chain that evolves an
install's shape, stamped into `[meta].schema_version` in `discern.toml` (the
`5 → 6` step dissolved the old `.discern/` namespace into this one root file —
[ADR 0020](../_adr/0020-dissolve-discern-dir.md)).

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../templates/skills/document-subsystem/SKILL.md)
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
  what `init` lays down, by disposition.
