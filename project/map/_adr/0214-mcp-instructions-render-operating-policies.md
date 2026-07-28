# ADR 0214: MCP instructions render operating policies; guidance remains authored

**Status**: accepted; applies the canonical-set discipline of [ADR 0176](0176-the-closed-sets-are-a-closed-set.md) and [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md) to the routing model in [ADR 0192](0192-static-guidance-earns-delivery-by-the-routing-test.md).

## Context

discern states the same operating model in 2 places. The bundled guidance templates compile into each project's agent files. The MCP server instructions reach clients that connect without reading an agent file. That redundancy protects the client floor, but each surface had its own prose and the wording drifted.

The first parity guard named 6 policies and matched both surfaces with regular-expression probes. Its array lived inside the test, so the supposed canonical set had no declared source. It also left `buildInstructions()` authoring every policy independently.

The templates are shipped, config-aware Markdown under a word-count standard. Rendering TypeScript fragments into them would add another interpolation path and make the source-word measurement less legible. MCP instructions are a TypeScript renderer already and can consume a shared module without changing either authoring model.

## Decision

`src/shared/operating_policies.ts` is the canonical operating-policy registry. Each entry declares a stable id, its canonical statement, the authored surfaces that must carry it, and the probes that recognize a faithful restatement.

The MCP instructions use the **single-rendered** model. `buildInstructions()` renders every statement registered for `mcp-instructions`. The guidance templates remain authored Markdown, and `tests/agent_policy_parity_test.ts` applies each entry's probes to their combined source. The same guard requires every canonical statement to satisfy its own probes and requires the rendered MCP surface to contain the exact statement. A statement edit therefore changes MCP output immediately; a change outside the probes fails until the declaration and authored restatement agree.

The canonical-sets meta-registry enrolls the policy registry and its parity guard. Policy ids have no glossary entry because they are internal enforcement labels for existing terms. The set has no feature-canon node because it spans guidance, worktrees, standards, and the MCP surface without adding a product capability.

`buildInstructions()` keeps capability-existence pointers that a schema-on-demand client needs before choosing a tool. Tool-specific mechanics stay in the matching `TOOLS` description. The worktree re-root fallback remains in the `worktree-first` statement because the existing cross-surface guard treats both halves of that fallback as one safety rule.

The guidance templates, tool descriptions, and probes are deliberately not rendered from one prose fragment. Templates keep their Markdown and conditional context. Tool descriptions keep per-tool mechanics beside the schemas they explain. Probes allow the guidance to state the same rule in that context without requiring byte equality.

## Consequences

- Adding a core policy means adding one registry entry. MCP instructions gain it automatically, and the parity guard fails until every declared authored surface carries a faithful restatement.
- The templates keep their current words and authoring workflow. A policy wording change can still require a template edit, but the gate names the missing policy in the same change.
- MCP instructions lose repeated mechanics for refresh, gate diagnostics, standards, update, and acceptance. Their tool descriptions remain the source an agent reads when it selects the capability.
- Regular-expression probes remain a semantic boundary rather than a proof of identical wording. Each probe must match the canonical statement itself, which keeps a stale probe from blessing a statement it no longer describes.

## Alternatives considered

- **Both surfaces remain authored and probed.** Rejected because the registry would declare policy metadata while neither delivery surface consumed the canonical statement. The original drift path would remain open behind stronger tests.
- **Both surfaces render the canonical statements.** Rejected because the templates are human-edited Markdown with config conditionals and a source-word standard. Importing fragments from TypeScript would split their authoring and measurement model for no gain on the surface that already reads well as prose.
