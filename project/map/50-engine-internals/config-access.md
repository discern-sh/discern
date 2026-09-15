---
aliases:
  - config parser
  - config schema
  - config editor
  - paths registry
---

# Config access

_How one schema, one paths registry, and one comment-preserving writer read, resolve, and edit `discern.toml`._

## One typed schema

The binary parses `discern.toml` with strict `@std/toml` and validates it against the Zod schema in [`config_schema.ts`](../../../src/shared/config_schema.ts) ([ADR 0026](../_adr/0026-typed-config-schema.md)). Everything that describes the config derives from that schema: the generated [config reference](https://discern.sh/docs/reference/config-reference), the editor JSON Schema, and the rules the engine enforces. `deno task codegen` rewrites the satellites. The project's final quality check (the gate) rejects drift.

## The config template and its prose

The shipped `templates/discern.toml.tmpl` is a generated file ([ADR 0363](../_adr/0363-the-config-template-is-generated-from-the-schema-and-a-prose-registry.md)). [`config_template_codegen.ts`](../../../src/shared/config_template_codegen.ts) renders it from the schema's per-key `describe()` prose and the [config prose registry](../../../src/shared/config_prose.ts), which owns each documented unit's what and why, an optional detail table, worked examples, seeded entries, and the per-key hints the scaffold shows. A section's schema description is the registry's `what`. `deno task codegen` writes the template; the codegen sync test and the repository's `[generated.codegen]` group hold the committed copy equal to the renderer.

Every unit renders in one shape: a ruled banner with What, Why, Params for a named-table family, and a Help line naming `discern config explain <unit>`, then the keys under their descriptions or the family's seeds and one commented example. [`config_prose_test.ts`](../../../tests/config_prose_test.ts) holds the registry's key set equal to the schema's documented units, validates every example and seed against the live schema, and holds each rendered description to three wrapped lines. The manual's config reference renders the same registry prose, and [`config_explain.ts`](../../../src/shared/config_explain.ts) serves it with the schema's reference facts and the project's current value.

## Setup config documents

The optional `meta.managed_version` records successful project adoption. Its [adoption boundary](managed-adoption.md) is separate from schema compatibility and byte-level currency. The first-public schema recognizes the key even when the initial scaffold omits it.

The bounded JSON recipe consumed only by `setup begin --config` derives from the config schema building blocks. Its strict `configDocSchema` generates the published authoring schema and is the runtime validator exported as `configDocRuntimeSchema`; unknown root or nested keys fail instead of being discarded. [`decodeConfigDoc`](../../../src/lib/config_doc.ts) is the setup path, and one version check refuses an unsupported major.

The recipe retains version 2's flat identity and setup inputs, plus bounded `setup` and `worktree` sections that reuse those live schemas. Standing acceptance policy stays outside it. `applyConfigDoc` derives each named-record write from `RECORD_ENTRY_SCHEMAS`, and its result reports every actual config leaf it filled or preserved. Tests bind every family fixture to its schema keys, every top-level recipe key to a consumer, and the runtime loader to its sole production caller. [Runtime data boundaries](../80-development/runtime-data-boundaries.md) records the decoder, error, caller-policy, and structural-enforcement contract ([ADR 0329](../_adr/0329-runtime-data-earns-types-at-validation-boundaries.md)).

## The paths registry and its resolvers

Every configurable source path has an entry in the [paths registry](../../../src/shared/paths_registry.ts): the instruction sources, map, authored skills, project scripts, ledger, and brief. Each entry records its config key, `discern/` default, file-or-directory kind, resolution mode, ownership, gate treatment, and description ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)). The Zod schema's path defaults derive from the registry. Code reads path keys through the resolvers in [`lib/paths.ts`](../../../src/lib/paths.ts) (`resolveMapDir`, `resolveSkillsDir`, `resolveTodoPath`, …), which turn an absolute or relative configured value into a project-absolute location. A registry default written as a literal anywhere else in `src/**` fails [`tests/paths_literal_ban_test.ts`](../../../tests/paths_literal_ban_test.ts); a rendered artifact that leaks one fails the sentinel-render guard.

Every source-path registry entry with `resolution = "configured"` automatically exposes a live `${<config-key>}` reference. The current set includes `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, and `${project.todo}`; instruction sources expose no scalar reference because `[instructions].sources` is a list, and the fixed setup brief has no config key. [`expandSourcePathReferences`](../../../src/shared/source_path_references.ts) resolves the derived set in scope paths and gates, generated paths and runs, job commands, Standard commands, inputs and `per` extents, and configured map exports. Unregistered braced forms remain untouched for the shell or another downstream consumer.

The fresh config renderer uses the same registry-derived references in its neutral scopes. Directory-prefix spelling follows the entry's registered path shape, so `${map.dir}` needs no appended slash while `${skills.dir}/` supplies one. Adding a configured source path therefore enrolls expansion automatically, and any neutral seed scope it joins renders the reference without another path-specific branch.

## The read surface

Project scripts and project tooling read config through the dispatcher: `discern config get|array|has|subsections|keys <dotted.key>`. A Project Script receives only the fixed root, config-path, scripts-directory, and trunk environment described in the [engine overview](README.md); it queries any other value explicitly. `discern config explain <path>` reads for a person or an agent instead: a section, a named-table family, a key, a knob, or a named entry, with its teaching, its reference facts, and the current value. This keeps the config format an implementation detail of the binary. A script stays a plain executable with no TOML parser or shell library to source.

## The write surface

All config writes go through the comment-preserving [`TomlEditor`](../../../src/lib/toml_edit.ts): the `discern config set-*` commands, `skills eject`'s `[skills].dir` recording, migrations, and `upgrade`'s scaffold reconciliation. Reconciliation restores missing values and preserves existing ones ([ADR 0092](../_adr/0092-upgrade-reconciles-config-scaffold.md)). The config writer is one of the few sanctioned write sites in the [write-surface contract](../80-development/install-surface.md#the-write-surface-contract).

Managed record banners compare their comment text independently of leading indentation. `discern tidy` owns hierarchy whitespace: a table is indented once for each ancestor table visibly represented in the document, while an implicit dotted namespace adds no visual level. A top-level named family such as `[scopes.<name>]` therefore aligns at the root; `[worktree.resources.<name>]` sits one level below the visible `[worktree]` table. Reconciliation preserves the config's current indent while replacing stale prose, so `upgrade --check` reports the formatted config as current.

Named record tables have one schema-driven layout rule across every writer. A new member follows the last live member of its family; the first member lands after the family's managed banner and examples, before the next ruled banner or non-family section. Missing fields are inserted in the order of that family's entry schema. Both the family set and field order derive from `RECORD_ENTRY_SCHEMAS`, so a future record family or knob auto-enrolls. Existing named tables and values stay where the project put them. The rule governs write-time placement and does not reformat them during upgrade ([ADR 0138](../_adr/0138-all-ruled-config-banners-are-managed.md)).

A programmatic write must leave a config that the next read accepts. `config set` renders the TOML type the schema expects at the path (`settableConfigValueKind`). A numeric-looking slug stays a string, a single value for an array-of-strings key lands as a one-element array, and an enum-typed key names its closed vocabulary on a miss. Value-based inference is reserved for union-typed keys such as a command-or-list or a standard `per`.

The path walk enforces the same record-key legality as the loader. A custom `[jobs.<name>]` entry's `<name>` must match the record-key pattern applied by the runtime `z.record` key schema, read back from the schema's `propertyNames`. This prevents `config set` from writing a header with a space, slash, or non-ASCII character that the next load would reject.

`configWriteIssues` validates every `config set*` edit before it touches disk. The edited text must parse and satisfy the schema, with one allowance for incremental table construction: a required key may still be missing inside a record-family entry (`[jobs.<n>]`, `[scopes.<n>]`, `[standards.<n>]`, `[worktree.resources.<n>]`). discern refuses an invalid edit with the specific issues and leaves the file untouched.

The value renderers apply the same read-after-write contract. `tomlNumber` probes candidate literals against `@std/toml`, the parser that later reads the file. It normalizes a JavaScript numeric spelling that TOML forbids, such as `.5` or `007`, before writing.

## See also

- [The manual's config reference](https://discern.sh/docs/reference/config-reference) — every section, key, type, and default (generated).
- [runtime-data-boundaries.md](../80-development/runtime-data-boundaries.md) — how JSON and subprocess values validate before acquiring runtime types.
- [the-templating-engine.md](the-templating-engine.md) — how rendered instructions and skills consume the same resolved config.
