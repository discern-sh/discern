# ADR 0372: V1 registries publish append-only generated manifests

**Status**: accepted; extends [ADR 0208](0208-public-contracts-version-by-schema-major.md), [ADR 0222](0222-frozen-contracts-complete-the-canon.md), and [ADR 0365](0365-the-v1-cli-has-one-command-model-and-one-spelling.md)

## Context

The engine already derives commands, MCP tools, environment variables, bundled skills, provider files, checkpoints, questions, local formats, and worktree identity from typed registries. Parity tests kept each registry aligned with its current projections, but they did not preserve yesterday's public members: a rename followed by regeneration could leave every test green while invalidating a caller's tool input, command invocation, configuration exclusion, local evidence path, provider file, or Git ref.

The first public release turns those spellings into durable contracts. The existing JSON Schema publications cover configuration and result envelopes, not the request-side MCP catalog, the CLI grammar, or cross-cutting repository conventions. A hand-maintained compatibility list would itself become another runtime authority and drift from the engine.

## Decision

Three versioned JSON manifests derive from the live authorities during `deno task codegen`:

- `discern-mcp-tools.json` records ordered tool names, titles, descriptions, input schemas, and annotations. Within a major, tools and optional input properties may be added; existing metadata and constraints stay fixed, while a required input may become optional.
- `discern-cli.json` records the attached command tree, aliases, positional arguments, flag spellings, option value counts and types, defaults, and visibility. Existing grammar is immutable within a major; new commands, aliases, positional arguments, and flags may join without displacing existing members.
- `discern-conventions.json` records environment and bundled-skill names, Git-admin state, checkpoint and question ids, hidden and shell-only commands, worktree identity derivation, provider and hook coordinates, local formats, and Git conventions. Existing values are immutable; new object members may join.

`PUBLIC_SCHEMA_PUBLICATIONS` gives each artifact its public v1 identity and compatibility policy. The tag-based comparison uses the recorded policy from the predecessor artifact. An incompatible change adds a new contract major or ships an explicit migration; regeneration alone cannot bless it.

Git-visible literals have one runtime authority in `src/shared/git_conventions.ts`. A deliberately hand-written test table pins those values, all Git-admin paths and bounds, and every publication major. The table is tripwire evidence only: runtime code and manifest generation never read it. Discern-authored commit message templates remain in their separate typed registry because message selection and literal repository coordinates are different authorities.

## Consequences

- The generated CLI manifest is intentionally large because it records the complete nested grammar, including inherited global flags. Reviewers inspect generator changes and compatibility diagnostics rather than editing the artifact.
- Existing MCP description wording, CLI grammar, provider paths, Git names, and identity derivation cannot change quietly inside v1. Corrections after publication carry the cost of a new major or migration.
- Compatible additions remain possible, but a new member must enter through its live registry and regenerate the manifest. The existing parity guards still catch same-tree drift; the tag ratchet catches drift across releases.
- The no-attribution override keeps one coupled effect matrix: a non-empty value removes the co-author trailer and product byline, uses the ambient Git identity for Proof notes, and never suppresses the Proof record.

## Alternatives considered

- **One hand-maintained compatibility manifest.** Rejected because it would duplicate every registry and could disagree with the engine it claims to describe.
- **Freeze only command and tool names.** Rejected because required inputs, aliases, provider paths, Git refs, and identity derivation are equally capable of breaking existing automation or orphaning state.
- **Treat regenerated output as automatically compatible.** Rejected because generation proves present-day faithfulness, not compatibility with a published predecessor.
