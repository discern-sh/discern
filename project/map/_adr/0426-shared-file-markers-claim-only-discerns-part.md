# ADR 0426: Shared-file markers claim only discern's part

**Status**: accepted; amends the marker wording of [ADR 0211](0211-agent-context-artifacts-carry-no-provenance-marker.md)

## Context

A comment-capable artifact outside agent context carries a provenance marker. Every marker except the worktree environment file's opened with "Generated automatically by discern via …", whatever the file's ownership.

That wording fits a Generated file, which discern rebuilds whole. A Shared file is different: discern maintains one region, block, or set of entries, and the rest belongs to the project or to other tools. A compatibility probe ran discern beside another tool that writes the same provider configuration. `.codex/config.toml` held both tools' tables, yet its first line presented every table as discern's output. A reader, or the other tool, could fairly conclude that the file was generated and that edits outside discern's entries would be lost.

The worktree environment file already used a scoped form, "Worktree values managed by discern via …". That form lived beside the shared renderer instead of in it.

## Decision

**A marker's claim follows File ownership.** Each comment-capable artifact declares an `ArtifactProvenance` in [`src/shared/file_ownership.ts`](../../../src/shared/file_ownership.ts): its source, and for a Shared file, the scope the marker claims. One renderer, `artifactProvenanceMarker` in [`src/shared/brand.ts`](../../../src/shared/brand.ts), produces both forms:

- Generated: `Generated automatically by discern via <source> | https://discern.sh`.
- Shared: `<scope> managed by discern via <source> | https://discern.sh`, such as "This block managed by …" in `.gitignore` or "MCP server, writable-root, and doc-size entries managed by …" in `.codex/config.toml`.

`DISCERN_NO_ATTRIBUTION` still removes the byline and link from either form and keeps the claim and source.

**The registry enforces the pairing.** `writtenArtifactClass` refuses a Shared comment-capable declaration without a scope and a Generated one with a scope. The provenance test renders every registered comment-capable artifact, requires its declared marker, and rejects any file-wide claim in a Shared file.

**A rewrite recognizes either claim.** `isArtifactProvenanceMarker` matches both forms for the artifact's source in both attribution modes. A refresh or upgrade therefore replaces a marker written under the other claim with exactly one current marker.

## Alternatives considered

- **Reword only `.codex/config.toml`.** The same false claim sat at the top of the Codex environment and rules files and of `discern.toml`. Fixing one file leaves the class, and the next Shared artifact would copy the old wording.
- **Leave block markers as they were.** The `.gitignore` and `.gitattributes` markers sit inside discern's delimited block, so position already scopes them. A single rule is simpler to enforce than a placement exception, and "This block" says what position only implies.
- **Drop markers from Shared files.** A reader would then have no in-file pointer to the source of discern's entries, which ADR 0211 keeps for every comment-capable artifact outside agent context.

## Consequences

The next `discern refresh` rewrites the marker line in `.gitattributes` and the Codex files; the next `discern upgrade` does the same for `discern.toml` and the `.gitignore` block. Each is a one-line change.

The published `generated_marker_prefix` convention still identifies Generated files. A tool that recognized discern's files by that prefix no longer sees Shared files as generated, which matches their ownership.

A new Shared comment-capable artifact must declare the part of the file its marker claims before it can join the registry.
