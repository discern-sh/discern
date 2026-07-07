# Config access

_How `discern.toml` is read, resolved, and edited — one schema, one paths
registry, one comment-preserving writer._

## One typed schema

The binary parses `discern.toml` with strict `@std/toml` and validates it
against the one canonical Zod schema in
[`config_schema.ts`](../../src/shared/config_schema.ts)
([ADR 0026](../_adr/0026-typed-config-schema.md)). Everything that describes the
config derives from that schema: the generated
[config reference](../10-installer/config-reference.md), the editor JSON Schema,
and the rules the engine enforces — `deno task codegen` rewrites the satellites,
and a drift fails the gate.

## The paths registry and its resolvers

Every configurable source path — the guidance sources, the map, authored skills,
recipes, the ledger, the brief — is one entry in the
[paths registry](../../src/shared/paths_registry.ts): its config key, its
`discern/` default, its pre-namespace legacy location, and a description
([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)). The Zod
schema's path defaults derive from it, and code never reads a path key directly:
the resolvers in [`lib/paths.ts`](../../src/lib/paths.ts) (`resolveDocsDir`,
`resolveSkillsDir`, `resolveTodoPath`, …) turn a configured value into a
project-absolute location, honouring an absolute or relative pointing. A
registry default written as a literal anywhere else in `src/**` fails
[`tests/paths_literal_ban_test.ts`](../../tests/paths_literal_ban_test.ts); a
rendered artifact that leaks one fails the sentinel-render guard.

Gate commands get one substitution: `${docs.dir}` in a check, ratchet, or `per`
extent expands to the configured docs dir
([`expandDocsDirReference`](../../src/shared/docs_path.ts)) — how the shipped
`prose` check and the docs ratchets follow a re-pointed map with no edit.

## The read surface

Recipes and project tooling read config through the dispatcher, never by parsing
TOML themselves: `discern config get|array|has|subsections|keys <dotted.key>`.
The same values reach a Recipe's process as exported `DISCERN_*` variables. This
keeps the config format an implementation detail of the binary — a recipe stays
a plain executable with no TOML parser and no shell library to source.

## The write surface

All config writes go through the comment-preserving
[`TomlEditor`](../../src/lib/toml_edit.ts): the `discern config set-*` commands,
`preset`, `skills eject`'s `[skills].dir` recording, migrations, and `upgrade`'s
scaffold reconciliation (restore-if-absent, never rewrite a value —
[ADR 0092](../_adr/0092-upgrade-reconciles-config-scaffold.md)). The config
writer is one of the few sanctioned write sites in the
[write-surface contract](../80-development/install-surface.md#the-write-surface-contract).

## See also

- [config-reference.md](../10-installer/config-reference.md) — every section,
  key, type, and default (generated).
- [the-templating-engine.md](../40-agent-guidance/the-templating-engine.md) —
  how rendered guidance and skills consume the same resolved config.
