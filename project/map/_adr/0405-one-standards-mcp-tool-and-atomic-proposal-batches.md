# ADR 0405: One Standards MCP tool and atomic proposal batches

**Status**: accepted on 2026-09-16. Amends [ADR 0339](0339-proposed-standard-limits-and-shared-measurements.md) and [ADR 0354](0354-standard-proposals-renew-descendant-evidence.md).

## Context

The MCP surface exposed `discern_standards` for measurement and pinning beside `discern_standards_propose` for one proposal. The distinction made two closely related public tools compete for agent attention. The scalar proposal contract also turned simultaneous breaches into a sequence of config commits: every later proposal made earlier bindings stale and forced caller-managed renewal.

MCP clients may give only a leading portion of a server's tool list immediate attention. The server already orders its tools deliberately, but its seven-item lifecycle prefix left an expensive standalone test tool close to that boundary while map discovery was much later.

## Decision

The MCP surface has one `discern_standards` tool with a required `action` of `measure` or `propose`. Measurement retains `names`, `force`, and `pin`. Proposal accepts an ordered array of unique `{ name, reason }` entries. The existing scalar `discern standards propose` CLI command remains available as a compatibility surface, but it is not a separate MCP tool.

One proposal action validates every request before effects, measures every selected Standard against one clean committed `HEAD` through the shared producer planner, changes every selected limit in one config-only commit, and binds every proposal record to that commit. Reasons carry technical justification only; consent and landing authority remain separate exact evidence. A changed value or reason requires fresh owner agreement.

Atomic reconciliation with already recorded proposals and carrying gate Proof across the proposal commit remain separate follow-up work. Until reconciliation exists, a batch that would create a new proposal refuses any existing active or stale proposal state before measurement or writes rather than creating sibling staleness.

The MCP lifecycle prefix contains exactly eight tools in this order: status, start, prepare, done, update, await, accept, and map. Progress and the standalone test tool follow it. This is a bounded-client discovery invariant, not a claim about one client's fixed loading threshold.

## Consequences

Agents have one Standards entry point and can record simultaneous breaches without proposal-created sibling staleness. Shared producers execute once inside a batch, and a repeated identical batch is idempotent. The required action makes the tool's intent explicit at validation and in the logbook. Removing one MCP tool and moving map into the eight-tool prefix improves relative discovery without changing the complete tool inventory's behavior.

Existing proposals are deliberately not reconciled with new batches yet. Proposal commits still invalidate exact Proof in the ordinary way, so the documented post-proposal gate remains required until a separately proven carry-forward path exists.
