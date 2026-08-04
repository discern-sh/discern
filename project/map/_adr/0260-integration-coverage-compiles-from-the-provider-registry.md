# ADR 0260: The integration coverage compiles from the provider registry

**Status**: accepted

## Context

The private agent-integration coverage page is the behaviour reference's inward companion: per agent, what discern actually wires — guidance, skills, MCP, hooks, worktree-app, rules, trust, gitignore posture. It described itself as "derived by reading the live engine" and named the typed provider registry as where the data lives, yet every cell was a hand-executed transcription of `PROVIDERS` — and it had drifted on exactly the axes it claimed authority over: it predated the `projectRules` seam, the Cursor `binaries` narrowing, the tracked-guidance ignore posture (ADR 0128), the per-agent MCP call-duration flags, and four MCP tools. ADR 0257 already established the cure for this shape — compile the page from a canonical registry through the codegen chokepoint — and the sibling page differs only in where its truth lives: mostly in the engine itself rather than in researched vendor cells.

## Decision

`scripts/agent_integration_registry.ts` renders the page from two layers. The derived layer is a projection of the live engine — `PROVIDERS` plus its satellite registries (the agent catalogue, `DEFAULT_AGENTS`, the MCP timeout policy, the artifact posture, the MCP tool table) — computed at codegen: the coverage matrix, the per-agent fact tables, the `Provider` field table, and the tool surface can no longer disagree with the code they describe. The authored layer carries only judgment: per-agent verdict commentary typed as a total `Record<NativeAgentName, …>`, the seam narratives, and the gap sections. `PROVIDER_FIELD_NOTES` is held to the live field union of `PROVIDERS` at render time, so a new `Provider` field refuses to render until it is explained. Citations are tokens — `{{g:<id>}}` against this page's gap list, `{{x:<id>}}` against the behaviour reference's dimension order — so reordering either page cannot strand a section number. The page is declared as the `agent-integration-seams` canonical set (source `INTEGRATION_SEAMS`), enrolled in `[generated.codegen]` and the managed `.gitattributes`, and `tests/agent_integration_coverage_codegen_test.ts` holds the committed page to the renderer and both research matrices to the one native agent axis.

## Consequences

- A new provider extends every derived cell automatically (the total `PROVIDERS` record forces its declaration) and fails the compile until its verdict commentary exists — the same forced-completeness ADR 0257 gave the outward matrix, now on both axes of the pair.
- Registry changes propagate to the reference at the next codegen instead of waiting for a maintainer to notice; the gate diffs the committed copy, so the stale-page failure mode this migration found is now structurally impossible.
- The two research matrices share one agent axis (the native catalogue), so they can never cover different agent sets.
- The migration was a truth reconciliation, not a byte-identical port: derived cells corrected the stale claims above, and the authored prose was updated where it restated them. The page's researched vendor claims still defer to the behaviour reference and carry its freshness caveat.

## Alternatives considered

Typing the per-agent commentary per seam — a `Record` of cells like the behaviour reference's headline rows — was rejected: the engine already answers the per-seam facts, so a second typed transcription of them would reintroduce the drift this change removes; prose bodies keep the judgment while the derivation keeps the facts. Keeping the page authored with a link-only freshness note was rejected because the page's whole value is its claim to describe the live engine, and that claim was already false. Deriving the verdict layer too (generating prose from registry fields) was rejected: the commentary's value is exactly what the registry cannot say — trade-offs, vendor quirks, and product judgment.
