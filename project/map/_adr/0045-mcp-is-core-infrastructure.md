# ADR 0045: The MCP server is core infrastructure, not a feature toggle

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `finish` → `done`, `docs` → `map` where it names the command, config, or tree; the decision and reasoning are unchanged.

**Status**: accepted; revises the feature set from [ADR 0020](0020-dissolve-discern-dir.md) (which introduced `[features]`, `mcp` among them) and builds on [ADR 0041](0041-self-describing-mcp-surface.md) and [ADR 0031](0031-typed-provider-integration.md)

## Context

[ADR 0020](0020-dissolve-discern-dir.md) introduced `[features]` — per-subsystem on/off switches — and listed `mcp` among them, so a project could set `[features].mcp = false` to keep discern from wiring its MCP server into each agent's config. That made sense when the MCP integration was new and unproven.

Three things have since changed what `mcp` actually toggles:

- **The server is a zero-cost thin adapter.** It is bundled in the one binary, launched on demand (`discern mcp`), and every tool is a like-for-like call into the same verb cores the CLI runs ([ADR 0038](0038-official-mcp-sdk.md), [ADR 0041](0041-self-describing-mcp-surface.md)). Nothing is _installed_ and nothing runs until a client connects — "available" costs nothing.
- **The shipped guidance is now built around it.** The compiled agent files are MCP-first (prefer the `discern_*` tools), with a CLI fallback that already covers any client that does not connect. There is one operating model, and it assumes the tools exist.
- **The flag conflated two different questions.** _"Is the server available?"_ — now always, it is the spine — versus _"does this client connect?"_ — which varies and is handled entirely by the CLI fallback. A `[features].mcp = false` no longer expresses a coherent product state: it would force a second, conditional operating-model phrasing in `base.md` for a configuration that contradicts how discern now works.

The toggle also carried real machinery: `refresh` wired the server when the feature was on and **removed** it (`unwireProviderMcp` / the provider registry's `unregister` hook) when off, reporting the change as `mcp_removed`.

## Decision

**MCP is core infrastructure, like the quality gate, the config surface, and doctor — always on, never a `[features]` member.**

- **The feature is gone from the SSOT.** `mcp` is dropped from `FEATURES` (`shared/features.ts`) and from the schema's `[features]` block (`config_schema.ts`). Because the status feature snapshot, its `StatusFeaturesSchema`, and `doctor`'s "all features on" line all derive from `FEATURES`, they follow automatically; the result-schema faithfulness test (ADR 0041) is the guard that they stay in lockstep.
- **Wiring is unconditional.** `refresh` / `upgrade` / worktree-setup always (re-)establish the server for every configured agent (idempotently, best-effort). The `mcp` verb is registered unconditionally, like `done` and `status`.
- **The removal path goes with the toggle.** With no "off" state, the feature-off branch, the now permanently-empty `mcp_removed` result field, and the thereby-orphaned `unwireProviderMcp` / `unregisterClaudeCodeMcp` / registry `unregister` hook are dead code — kept only, they would misrepresent a capability discern no longer has. They are removed wholesale (single source of truth; no dead code). What stays gated is unchanged: the `map`- and `worktrees`-gated MCP **tools** still appear only when their own feature is on.
- **Schema 10 → 11 drops the key.** A migration deletes `[features].mcp` (comment-preserving, idempotent) so an existing `mcp = true|false` config is cleaned on the next `discern upgrade`.
- **The strict-schema transition is graceful.** `[features]` is a `z.strictObject`, so an un-migrated config still carrying `mcp` fails the typed load — but the failure is caught at the top-level config chokepoint and rendered as a friendly per-issue diagnostic, and a tailored message (mirroring the `[worktree]` dead-adapter precedent) tells the reader the MCP server is core now and to run `discern upgrade`. `upgrade`/`doctor` read through the raw, un-validated reader, so they are never blocked by the leftover key.

## Consequences

- **One operating model.** `base.md` is unconditionally MCP-first, which is now simply correct — there is no incoherent "MCP off" branch to phrase.
- **The shipped guidance needed no change.** It never referenced the toggle; it is now aligned with reality rather than ahead of it.
- **Less surface, less dead code.** The register/unregister symmetry is gone on purpose: the registry models only what the product does (register), and the refresh result no longer carries an always-empty `mcp_removed`.
- **First removal of a feature key.** Every prior schema change was additive, so an old config stayed valid against the new strict schema; this is the first that makes a leftover key invalid. The friendly diagnostic + the raw-reader upgrade path are what keep that transition from being a cryptic crash — a pattern future feature removals can reuse.
- **No way to opt out of wiring.** A project that genuinely does not want the `.mcp.json` entry no longer has a config switch. This is intended: the server is free unless a client connects, and the entry is the discoverability mechanism the MCP-first guidance assumes.

## Alternatives considered

- **Keep the toggle, leave it defaulting on.** Rejected: it still forces a conditional second operating model in the guidance for a state that no longer makes product sense, and it keeps the removal machinery alive for a path nothing triggers.
- **Make `[features]` non-strict so leftover keys are silently ignored.** Avoids the transition entirely, but throws away the write-time typo protection strict parsing buys (`features.bogus` should be an error). The friendly diagnostic plus the migration give a better transition without weakening the schema.
- **Drop the feature but keep `unwireProviderMcp` as a registry utility.** Rejected: with no caller it is dead code that only its own unit tests exercise; register/unregister symmetry is not worth retaining a capability the product never invokes.
