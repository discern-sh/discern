# ADR 0170: File ownership is required registry data

**Status**: accepted; extends the write-surface contract ([ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md)), the paths registry ([ADR 0102](0102-paths-registry-and-rendered-artifacts.md)), enumerated provider artifacts ([ADR 0128](0128-enumerated-ownership-tracked-guidance.md)), and canonical-set parity ([ADR 0051](0051-canonical-set-parity.md)).

## Context

The project-tree write boundary derived configurable sources and provider paths from their registries, then added `discern.toml`, `.gitignore`, and `.env` in the test itself. The install-surface page repeated the resulting inventory in prose. A new path could therefore join the allowed write surface without choosing a File ownership bucket, and the documentation had no mechanical signal that it was incomplete.

Provider-created machine-local state exposed the opposite risk. discern declares such paths to keep them out of Git but does not generate them. Forcing those paths into Project-owned, Shared, or Generated would make the ownership model comprehensive by describing the path incorrectly.

## Decision

**File ownership becomes required data on every canonical project artifact declaration.**

- Configurable source entries and provider artifact entries carry one ownership declaration. A small fixed-path registry declares the config, ignore file, and existing worktree environment file.
- `projectArtifactPaths()` combines those existing sources, rejects missing or conflicting declarations, and deduplicates provider paths shared by several agents. It records `project-owned`, `shared`, or `generated`; a provider-local declaration instead carries the reason it sits outside File ownership.
- The ADR 0099 runtime boundary consumes that enumeration and excludes provider-local entries from its writable set. The static write funnel remains unchanged.
- A parameterized test validates every entry. Synthetic entries with no bucket and with two buckets prove the guard fails in both directions.
- `deno task codegen` renders the same inventory block into Files & ownership and the development install surface. A sync test prevents either page from drifting.

The registry covers project-tree paths. Discern-owned runtime records under Git's administrative directory retain their separate lifetime registry, while user-supplied output paths and OS temp artifacts remain outside the installed project surface.

## Consequences

- Adding a source, provider artifact, or fixed shim cannot leave ownership undecided. The declaration, boundary, and two inventories move together.
- Provider-local state remains visible in the inventory without implying that discern owns or produces it.
- The ownership marker permits malformed in-memory data so the positive controls can exercise zero and several buckets. The validator is therefore part of the invariant rather than a redundant test over a state the type cannot represent.
- The public inventory gains a generated section. Its surrounding explanation remains hand-authored.
- Setup, refresh, upgrade, and uninstall behavior does not change.

## Alternatives considered

- **Keep ownership in prose and add a completeness checklist.** Rejected because a new registry member would not enroll itself.
- **Infer ownership only from artifact kind.** Rejected because a new kind would receive an answer without a conscious ownership decision, and fixed shims would remain outside the source.
- **Treat provider-local state as Generated.** Rejected because discern neither creates it nor has a reviewable source from which to rebuild it.
