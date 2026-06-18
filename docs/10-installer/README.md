# The Installer

_The Deno/TypeScript CLI that scaffolds a Harness into a project and keeps it
upgradable._

This subtree covers the half of icculus under [`src/`](../../src/) — the only
part written in TypeScript. The **Installer** reads
[`templates/`](../../templates/) (the source of truth) and writes a **Harness**
into a project, then refreshes it over time **without clobbering** local work.
It compiles to standalone binaries in `dist/` via `deno task build`; an
installed project never needs Deno.

The command surface is six verbs: `init` (scaffold), `upgrade` (refresh managed
files, hash-aware), `doctor` (verify an install), `migrate` (report pending
Schema steps), `config` (comment-preserving `.icculus/config.toml` edits), and
`add-adapter` (overlay a reference adapter). Routing lives in
[`main.ts`](../../src/main.ts); each verb's logic is in `src/commands/`.

The ideas worth understanding here: the **disposition**-driven copy (Managed /
Seed / Merged / Generated — see the [glossary](../00-orientation/glossary.md)),
the **hash-aware** upgrade plan that overwrites pristine files but preserves
edits as `<file>.new`, the **Manifest** that records what is pristine, and the
**Schema-version** [Migration](../00-orientation/glossary.md#migration) chain
that evolves an install's shape before the file sync.

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../.icculus/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_ | What it will cover                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `command-surface.md`   | The six verbs, their flags, and the `--json` / exit-code contract.                           |
| `the-install-plan.md`  | How `templates/` becomes a plan of file ops by disposition (`fs_plan`, the token rendering). |
| `the-manifest.md`      | `.icculus/manifest.json`: what it records and how pristine-vs-edited is decided.             |
| `migrations.md`        | The versioned Migration chain, the Schema version, and the idempotency contract (ADR 0014).  |
| `config-editing.md`    | Comment-preserving TOML edits behind `icculus config` (`toml_edit`).                         |

## See also

- [concepts.md](../00-orientation/concepts.md) — where the Installer sits in the
  whole system.
- [install-surface.md](../80-development/install-surface.md) — the exact map of
  what `init` lays down, by disposition.
