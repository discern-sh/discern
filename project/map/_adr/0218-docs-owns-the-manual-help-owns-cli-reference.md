# ADR 0218: `docs` owns the manual; `help` owns CLI reference

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** The retired `[docs]` configuration spelling preserves its migration to `[map]`. `docs` is canonical again only as the bundled-manual command.

> **Pre-tag reset amendment (2026-07-29; applies [ADR 0219](0219-public-install-schema-starts-at-one.md)):** Before the first release tag, an owner decision extended ADR 0219's reasoning to the public schemas: no released consumer holds the version-1 `help` publication, so freezing it would publish prerelease history as a permanent contract. The result contract is squashed to a single schema v1 carrying the live `docs` shapes at `schema/discern-results.schema.json`; the frozen pre-rename artifact and the `schema/v2/` path are deleted. This overrides the last alternative below for the pre-tag window: the append-only baseline of [ADR 0208](0208-public-contracts-version-by-schema-major.md) now arms at the first release tag. The same reset makes `discern-config.schema.json` validate a real `discern.toml` — the live schema the engine enforces — and moves the `setup --config`/preset document to its own identity, `discern-setup-config.schema.json`.

**Status**: accepted

**Amends**: command naming in [ADR 0039](0039-bundled-help-docs.md), [ADR 0120](0120-launch-verb-canon.md), and [ADR 0130](0130-docs-site-renders-the-help-tree.md)

**Applies**: the schema-major policy of [ADR 0208](0208-public-contracts-version-by-schema-major.md)

## Context

`discern help` had two jobs. With no target, or with a documentation target, it opened discern's bundled manual. With a known command as its target, it forwarded to that command's Cliffy reference, so `discern help done` and `discern done --help` matched. `discern --help` separately showed the root command reference.

The overload came from an earlier collision. The project-maintained documentation command used `docs`, so discern's own manual needed another name. ADR 0120 renamed that project surface to `map`, but left the now-free `docs` spelling retired to `map`. The temporary constraint disappeared while the compromise remained.

The remaining names set the wrong expectations. `help` conventionally means command syntax. `docs` names a browsable manual, and the public site already serves that manual at `/docs`. Under the overload, `discern help done` depended on whether `done` was a command or a page. The command line, Model Context Protocol (MCP), resource URI, result discriminator, and web route also used different nouns for one product surface.

This decision lands before the first public release, so there is no installed command population to migrate. There is, however, already a version-1 result-schema publication on the configured trunk. ADR 0208 makes that artifact and identity append-only even before a package tag exists.

## Decision

**`docs` is discern's bundled-manual surface everywhere. `help` is CLI reference everywhere it is callable.**

- `discern docs [target]` owns the existing interactive browser, search, list, raw, JSON, export, and source-checkout `--adr` modes.
- `discern help` prints the same grouped root reference as `discern --help`.
- `discern help <command>` prints the same command reference as `discern <command> --help`.
- A command-shaped target passed to `docs` remains a documentation target. The manual browser never dispatches command help.
- MCP exposes the manual as `discern_docs`, with `discern://docs` and `discern://docs/{+target}` resources. There is no `discern_help` tool: MCP tool schemas already carry their own reference information.
- The manual result discriminator and missing-tree error become `docs` and `no_docs`.

`help` is not a second spelling for the manual, and `docs` does not redirect to `map`. The legacy `[docs]` configuration-key migration to `[map]` remains: configuration history is independent of the newly canonical command spelling.

The live result contract starts at schema version 2 because renaming the `help` contract to `docs` is breaking. The version-1 result artifact remains published unchanged at its existing path and identity. The current generated schema lives at `schema/v2/discern-results.schema.json` with the version-2 public identity. Configuration remains at schema version 1. Config and result schema majors are independent.

## Consequences

- The command grammar is unambiguous: `help` answers “how do I invoke this?”, `docs` answers “how does discern work?”, and `map` answers “what does this project know about itself?”
- Terminal, MCP, result, and website names now align around `docs`.
- `discern help --json` is intentionally not a result-envelope surface. It is human-readable CLI reference, enrolled beside the other explicit CLI JSON exclusions.
- Clients that discovered the pre-release `discern_help` tool or version-1 `help` result must move to `discern_docs` and the version-2 result schema. Retaining the version-1 artifact preserves the published contract without preserving the misleading runtime spelling.
- The first package release may therefore publish configuration schema v1 and result schema v2. Those numbers describe separate compatibility domains, not package maturity.

## Alternatives considered

- **Keep the overload.** Rejected because `help` would continue to mean both reference and manual, with target-dependent routing and a different noun on the website.
- **Keep `help` as a second spelling for `docs`.** Rejected because two working spellings would preserve the ambiguity and contradict `help <command>` as CLI reference.
- **Reset or weaken the version-1 result baseline because no package tag exists.** Rejected because ADR 0208 deliberately makes the configured trunk the publication baseline. A new major is cheap; making the compatibility promise conditional is not.
