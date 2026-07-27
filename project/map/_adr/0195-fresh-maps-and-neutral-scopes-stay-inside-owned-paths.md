# ADR 0195: Fresh maps and neutral scopes stay inside discern-owned paths

**Status**: accepted; amends [ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0100](0100-project-map-is-the-agents-map.md), [ADR 0120](0120-launch-verb-canon.md), and [ADR 0131](0131-setup-never-adopts-existing-docs.md)

## Context

ADR 0120 moved the fresh map from `discern/docs/` to root `map/` so the directory and command shared one noun. That fixed the collision with conventional `docs/`, but opened a new collision: a repository may already use `map/` for geographic code, data, or unrelated documentation. Setup treats any existing configured map directory as user content and skips its skeleton. A fresh install could therefore point the map discipline at a directory the owner never offered.

The generated neutral scope crossed the same ownership boundary. It covered all of `discern/`, `.claude/`, and `.agents/`. `discern/` also contains executable Project Scripts. Provider directories may contain project-owned commands, hooks, and settings alongside discern's materialized skills. The broad paths let changes to executable or provider-owned files skip classification as code.

Both defaults become expensive to correct after launch. Installed map locations must remain stable, and narrowing a generated scope later needs to distinguish discern's old list from a project-owned customization.

## Decision

Fresh maps default to `discern/map/`. The directory keeps the canonical map noun and returns to the visible namespace whose placement grants discern write authority. Existing installs do not move; `[map].dir` remains configurable.

Each source-path registry entry declares whether its authored content is gate-neutral. The map, guidance, authored skills, deferred-work ledger, and setup brief are neutral. Project Scripts are executable and remain gated. The fresh neutral scope derives its authored paths from that classification.

Provider neutral paths stop at the exact materialized-skills directories, `.claude/skills/` and `.agents/skills/`. Setup presentation may still group files by their top-level provider directory, but that broader grouping is not an execution policy.

Schema 23 replaces every recognized prerelease generated neutral list with the new registry-derived list. Any list with a project-added or removed path remains byte-for-byte unchanged.

## Consequences

- A fresh install creates all ongoing authored defaults beneath `discern/`.
- An unrelated root `map/`, Project Script, provider command, hook, or setting cannot acquire neutral treatment from a parent-directory default.
- The path registry gains one required policy field. A new authored source must declare whether its changes run the gate.
- The migration carries several historical generated lists because old installs reached schema 22 through different prerelease templates. That list is migration history and grows no further.
- Projects can still point `[map].dir` or a neutral scope at another path. Writing either value remains explicit consent.

## Alternatives considered

- **Keep root `map/` and refuse a collision during setup.** Rejected because a branded namespace prevents the collision before detection and preserves the one-visible-folder footprint.
- **Keep broad neutral parents and add exceptions.** Rejected because exceptions duplicate the provider and source-path registries, and a new executable sibling would begin neutral until somebody remembered the denylist.
