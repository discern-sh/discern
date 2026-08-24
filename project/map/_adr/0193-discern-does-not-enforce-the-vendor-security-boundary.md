# ADR 0193: discern does not enforce at the vendor security boundary

> **Amendments.**
>
> - **[ADR 0320](0320-setup-plans-own-write-authority-and-activation-recovery.md) — point-in-time authority:** setup may exercise representative required writes and ask the host to authorize the retry, but success grants nothing, persists nothing, and does not prove that a fresh provider session loaded its integration.

**Status**: accepted — grounds the vendor-facing half of design principle 7 (sovereign inside, deferential outside). Builds on [ADR 0082](0082-codex-project-config-writable-root.md) (the Codex writable-root and narrow Git rules) and [ADR 0072](0072-typed-mcp-status-forcing-function.md)/[ADR 0074](0074-co-owned-mcp-json.md) (provider MCP wiring). [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md) leans on this record for one of its explicit *no*s.

## Context

discern writes into vendor configuration surfaces today, and both writes look like security decisions without their context:

- **Codex's exec-policy rules** (`prefix_rule` grants for `git add`/`git commit`, ADR 0082) exist because Codex's sandbox blocks linked worktrees from writing Git metadata under the main checkout's central `.git` directory — without them, a fresh Codex install cannot operate the worktree lifecycle discern scaffolds.
- **MCP pre-approval** (`enabledMcpjsonServers` in Claude Code's shared settings, and equivalents per provider) removes a manual approval step for discern's _own_ server — a step a non-technical user would otherwise hit as unexplained friction on first contact.

Each is workflow-smoothing: it unblocks discern's own documented workflow, nothing else. But the trust-model work ([ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md)) makes the boundary tempting: once discern records who may land what, the natural-seeming next step is _enforcing_ at the vendor boundary — intercepting tool calls, conditionally blocking Git operations, seeding permission allowlists, hardening sandbox defaults. Three forces argue against ever taking that step:

1. **Vendor security surfaces churn constantly.** Sandbox models, permission schemas, and approval flows change across providers on a cadence discern cannot track without making boundary enforcement a permanent maintenance treadmill — and a stale enforcement rule at a security boundary is worse than none, because it is trusted.
2. **discern cannot know a project's security requirements.** It is stack-neutral by design (principle 1) and makes no assumptions about the codebase it is installed into; a generic interception rule is either too loose to matter or breaks a legitimate workflow it never anticipated.
3. **discern's trust surfaces are legibility mechanisms, not security controls.** The consent gates are attestations, not proofs (ADR 0134 accepts this openly); the gate verifies quality, not intent. Presenting any of it as a security boundary would promise more than it delivers, exactly where an inflated promise is most dangerous.

## Decision

**The vendor security boundary is not discern's to enforce.** Vendor sandbox rules, permissions, and approval flows belong to the vendors; responsibility for a project's actual security stays with the user.

- **discern's writes into vendor configuration are workflow-smoothing only.** Each existing and future write must be justifiable as unblocking discern's own documented workflow — the two writes above are the shape of the ceiling, not a precedent for expansion.
- **discern never intercepts, filters, or conditionally blocks a vendor's tool calls**, never manages a vendor's security defaults, and never seeds permission rules beyond what its own workflow needs.
- **discern's trust surfaces are described as legibility, not prevention** — decisions made in daylight, recorded where the owner can audit them — and user-facing prose never presents them as a security control.

Reversing this stance takes a superseding record, not an incremental feature.

## Consequences

- Maintenance stays bounded: vendor security churn does not propagate into discern's enforcement obligations, because there are none.
- Users who want tool-call restrictions, push protection, or sandbox hardening are pointed at their vendor's native controls; this record is the reasoning behind that answer.
- The honest-marketing line survives contact with the feature roadmap: discern claims that agent decisions are on the record, never that agents cannot do wrong.
- The cost is real: some genuinely useful guardrails will not be built here, even when a user asks, and the refusal must be re-explained each time. This record exists so the re-explanation is a pointer, not a debate.

## Alternatives considered

- **Enforce at the boundary** (tool-call interception, conditional Git blocking). Rejected: the churn treadmill, the stack-neutrality conflict, and the false promise of security discern cannot deliver.
- **Write nothing into vendor config at all.** Rejected: ADR 0082's rules are required for the worktree lifecycle to function under Codex at all, and forcing manual approval steps onto users contradicts the zero-config setup contract (ADR 0077).
