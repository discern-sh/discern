---
aliases:
  - config parser
  - config schema
  - config editor
  - paths registry
---

# Config access

_How `discern.toml` is read, resolved, and edited — one schema, one paths registry, one comment-preserving writer._

## One typed schema

The binary parses `discern.toml` with strict `@std/toml` and validates it against the Zod schema in [`config_schema.ts`](../../../src/shared/config_schema.ts) ([ADR 0026](../_adr/0026-typed-config-schema.md)). Everything that describes the config derives from that schema: the generated [config reference](../70-reference/config-reference.md), the editor JSON Schema, and the rules the engine enforces. `deno task codegen` rewrites the satellites, and a drift fails the gate.

## The paths registry and its resolvers

Every configurable source path has an entry in the [paths registry](../../../src/shared/paths_registry.ts): the guidance sources, map, authored skills, project scripts, ledger, and brief. Each entry records its config key, `discern/` default, pre-namespace legacy location, and description ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)). The Zod schema's path defaults derive from the registry. Code reads path keys through the resolvers in [`lib/paths.ts`](../../../src/lib/paths.ts) (`resolveMapDir`, `resolveSkillsDir`, `resolveTodoPath`, …), which turn an absolute or relative configured value into a project-absolute location. A registry default written as a literal anywhere else in `src/**` fails [`tests/paths_literal_ban_test.ts`](../../../tests/paths_literal_ban_test.ts); a rendered artifact that leaks one fails the sentinel-render guard.

Gate commands get one substitution: `${map.dir}` in a check, standard, or `per` extent expands to the configured docs dir ([`expandMapDirReference`](../../../src/shared/map_path.ts)) — how the shipped `prose` check and the docs standards follow a re-pointed map with no edit.

## The read surface

Project scripts and project tooling read config through the dispatcher: `discern config get|array|has|subsections|keys <dotted.key>`. The same values reach a project script's process as exported `DISCERN_*` variables. This keeps the config format an implementation detail of the binary. A script stays a plain executable with no TOML parser or shell library to source.

## The write surface

All config writes go through the comment-preserving [`TomlEditor`](../../../src/lib/toml_edit.ts): the `discern config set-*` commands, `preset`, `skills eject`'s `[skills].dir` recording, migrations, and `upgrade`'s scaffold reconciliation. Reconciliation restores missing values and preserves existing ones ([ADR 0092](../_adr/0092-upgrade-reconciles-config-scaffold.md)). The config writer is one of the few sanctioned write sites in the [write-surface contract](../80-development/install-surface.md#the-write-surface-contract).

Named record tables have one schema-driven layout rule across every writer. A new member follows the last live member of its family; the first member lands after the family's managed banner and examples, before the next ruled banner or non-family section. Missing fields are inserted in the order of that family's entry schema. Both the family set and field order derive from `RECORD_ENTRY_SCHEMAS`, so a future record family or knob auto-enrols. Existing named tables and values stay where the project put them. The rule governs write-time placement and does not reformat them during upgrade ([ADR 0138](../_adr/0138-all-ruled-config-banners-are-managed.md)).

A programmatic write must leave a config that the next read accepts. `config set` renders the TOML type the schema expects at the path (`settableConfigValueKind`). A numeric-looking slug stays a string, a single value for an array-of-strings key lands as a one-element array, and an enum-typed key names its closed vocabulary on a miss. Value-based inference is reserved for union-typed keys such as a command-or-list or a standard `per`.

The path walk enforces the same record-key legality as the loader. A custom `[jobs.<name>]` entry's `<name>` must match the record-key pattern applied by the runtime `z.record` key schema, read back from the schema's `propertyNames`. This prevents `config set` from writing a header with a space, slash, or non-ASCII character that the next load would reject.

Every `config set*` edit is validated by `configWriteIssues` before it touches disk. The edited text must parse and satisfy the schema, with one allowance for incremental table construction: a required key may still be missing inside a record-family entry (`[jobs.<n>]`, `[scopes.<n>]`, `[standards.<n>]`, `[worktree.resources.<n>]`). An edit that fails is refused with the specific issues and leaves the file untouched.

The value renderers meet the same bar one level down. `tomlNumber` probes candidate literals against `@std/toml`, the parser that later reads the file. A JavaScript numeric spelling that TOML forbids, such as `.5` or `007`, is normalized before writing.

## See also

- [config-reference.md](../70-reference/config-reference.md) — every section, key, type, and default (generated).
- [the-templating-engine.md](the-templating-engine.md) — how rendered guidance and skills consume the same resolved config.
