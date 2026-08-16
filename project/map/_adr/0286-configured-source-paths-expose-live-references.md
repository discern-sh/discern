# ADR 0286: Configured source paths expose registry-derived live references

**Status**: accepted; extends [ADR 0080](0080-configured-agent-map-root.md) and [ADR 0102](0102-paths-registry-and-rendered-artifacts.md)

## Context

ADR 0080 introduced `${map.dir}` so a later change to `[map].dir` could not separate the Map from the jobs, Scopes, and Standards that read it. The same drift remained possible for the other authored sources in `SOURCE_PATHS`: a scope or generator could name `discern/skills`, for example, while `[skills].dir` pointed elsewhere.

Treating each path as a new interpolation feature would recreate the duplication that the paths registry removed. It would also leave a future configurable source inert until every consumer learned another hand-written token. The registry already distinguishes stable scalar config paths (`resolution = "configured"`) from values resolved by another rule.

Instruction sources and the setup brief do not have the same shape. `[instructions].sources` is a list whose concrete seed target is derived from the first non-glob entry; the brief has no live config key. Giving either a scalar-looking reference would conceal that weaker authority.

## Decision

Every `SOURCE_PATHS` entry with `resolution = "configured"` and a non-null config key automatically exposes `${<config-key>}`. The current references are `${map.dir}`, `${skills.dir}`, `${scripts.dir}`, and `${project.todo}`. `SOURCE_PATH_REFERENCES` derives their membership and spelling directly from `SOURCE_PATHS`; no parallel token list is maintained.

`expandSourcePathReferences` resolves that complete set from the loaded config in every surface that already accepted the scope-glob dialect:

- Scope paths and scope-gate commands.
- Known and custom job commands.
- Generated artifact paths and generator commands.
- Standard commands, `inputs`, and built-in `per` extent globs.
- Configured Scope paths used by `discern map --export`.

Expansion is one simultaneous pass. Unregistered braced forms stay byte-for-byte intact, preserving ordinary shell expansion and leaving this a closed source-path vocabulary rather than a general-purpose config interpolation language.

Fresh-config scope rendering uses the same derived reference for every configured registry member. Whether a directory reference receives a trailing slash follows the entry's registered path shape, not its name. Instruction sources and the fixed brief continue to render their concrete paths; they expose no compatibility token or derived-seed alias.

This decision amends ADR 0080's restriction to the one exact `${map.dir}` reference. Its rejection of general-purpose variables remains: the closed set is now the configured scalar subset of `SOURCE_PATHS`.

## Consequences

Changing `[skills].dir`, `[scripts].dir`, `[project].todo`, or `[map].dir` keeps every enrolled declaration aligned without rewriting user-owned commands and globs. Fresh configs express live relationships instead of copying defaults.

A new configured source-path registry member enters reference expansion, schema documentation, and the parameterized regression guard automatically. If it belongs to a fresh neutral Scope, that renderer uses the same derived reference. Giving a configured entry no key fails at the registry boundary. The test covers every existing expansion surface with the whole derived set, so a new member cannot work in only one dialect position.

There is still no recursive interpolation and no arbitrary access to discern config. A configured path that happens to contain reference-shaped text remains literal after substitution.

## Alternatives considered

**Add `${skills.dir}`, `${scripts.dir}`, and `${project.todo}` individually beside `${map.dir}`.** Rejected because the next source path would repeat the same omission risk and require another hand-maintained list.

**Expose `${instructions.seed}` or `${instructions.sources}`.** Rejected because a list of globs has no single live scalar value, while the seed target is a setup-time derivation rather than its authority.

**Expose a brief-path reference.** Rejected because the brief is a fixed setup input with no config key. A token would imply that the path can be configured when it cannot.

**Allow `${any.config.key}`.** Rejected because arbitrary interpolation would widen the language beyond source paths, create type-to-string questions, and compete with shell variables.
