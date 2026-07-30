# ADR 0166: Coding-agent identity is advisory logbook evidence from one catalogue

**Status**: accepted. Amended 2026-07-30 to make retained raw client evidence effective at read time. Amends the no-vendor-attribution boundary in [ADR 0160](0160-local-logbook-advisory-readers.md) and [ADR 0162](0162-logbook-day-one-vocabulary.md), extends [ADR 0031](0031-typed-provider-integration.md) and [ADR 0043](0043-registry-derived-agent-parity.md), and preserves [ADR 0030](_superseded/0030-quiet-json-output.md)

## Context

ADR 0160 deferred agent-vendor attribution until a cheap, honest hint existed. ADR 0162 repeated that boundary because `surface` cannot distinguish a person from an agent: both can invoke the CLI, and agents are explicitly taught to do so. Its raw-driver design nevertheless left room for later evidence to accrete without storing a verdict.

Two useful evidence families now exist:

- [laravel/agent-detector](https://github.com/laravel/agent-detector) maintains practical, short-lived process-environment markers. Its catalogue covers Cursor, Claude Code and `Cowork`, Devin, `Replit`, Gemini, Codex, v0, Augment CLI, OpenCode, Amp, GitHub Copilot, Antigravity, Pi, and `Kiro CLI`.
- Model Context Protocol (MCP) clients declare `clientInfo` during initialization. The next protocol shape carries the same declaration per request under `_meta["io.modelcontextprotocol/clientInfo"]`.

Neither family proves identity. Parent processes pass environment variables to children, and wrappers can remove, change, or fake them. MCP identifies the client implementation, which may be an editor or proxy rather than the coding agent behind the request.

discern also had two nearby but different concepts. `PROVIDERS` describes the five native integrations. Setup scans their CLI binaries on `PATH` to choose a fresh project's default configuration. A PATH match answers “is this installed?” It does not answer “what is driving this invocation?” Copying the native names into a second detection table would create the drift ADR 0031 and ADR 0043 exist to prevent.

Devin adds a special ambiguity. Its upstream marker is `/opt/.devin`, a host-level existence check rather than an invocation-scoped variable. On a machine where that path persists, every invocation can carry a Devin match even when another agent is active. Dropping it loses upstream coverage; presenting it like a process marker overstates what it says.

ADR 0030 previously rejected using environment detection to switch output to JSON. That reasoning still holds: ambient identity guesses must not change a command's behavior, output, guidance, or route through the product. The logbook presents a different choice because it can retain the raw evidence without acting on it.

The first implementation retained raw MCP metadata but let readers consume only the normalized signal written beside it. Catalogue improvements therefore changed future events while historical events remained frozen to the writing release. A `cursor-vscode` event without a stored `mcp-client` signal exposed the gap: the evidence needed for reinterpretation existed, but no reader used it.

## Decision

**Coding-agent identity detection exists only as advisory logbook evidence, and one identity catalogue owns both its detection vocabulary and discern's native-provider subset.**

`AGENT_CATALOGUE` contains every known identity, its display label, its optional process/MCP/host markers, and an optional `nativeName`. Entries with a native name supply `AGENT_NAMES`. `PROVIDERS` remains a total record over that derived type and takes its labels from the catalogue. Adding native support therefore starts with one catalogue entry, then fails compilation until the provider integration is complete. Signal-only entries never become setup choices. Setup's PATH scan remains separate because it answers installation availability.

The detector runs only at the CLI and MCP logbook recording points. A structural test fixes those as its only production consumers. It returns every match and records each as `{agent, source, markers}`. The source is one of:

- `process-environment` — invocation-adjacent variables, recording their names only;
- `mcp-client` — a recognized client name or title;
- `host-filesystem` — ambient host state, initially `/opt/.devin`.

Matches coexist. There is no winner, priority, confidence, `is_agent` flag, or derived vendor field. Catalogue order is deterministic but carries no ranking. For an unknown non-empty `AI_AGENT`, the detector records `agent: "custom"` with marker `AI_AGENT` and drops the value. No environment value reaches the logbook.

On MCP calls, the driver also retains bounded raw client metadata as `mcp_client: {name, title?, version}`. Valid per-request metadata takes priority. Initialized `clientInfo` is the fallback. The recorder trims each untrusted string and caps it at 256 characters. This metadata describes a client implementation, not an authenticated agent identity.

One pure classifier derives MCP signals from `AGENT_CATALOGUE`. Recorders use it when writing a new event. Readers use it again when building an event's effective identity view, so new catalogue knowledge applies to retained history with no migration or rewrite. The catalogue explicitly recognizes Cursor's `cursor-vscode` MCP identifier. Prefix and fuzzy matching remain excluded.

The effective view preserves every stored non-MCP signal. When the current classifier recognizes the raw declaration, its MCP signals replace stored MCP signals because both interpretations derive from one source. Retaining both would manufacture corroboration. When the current classifier finds no match, stored MCP signals remain as evidence from the writer's release. Equivalent agent/source pairs merge in stable order. Independent sources naming different agents continue to void attribution rather than electing a winner.

The catalogue keeps Devin's `/opt/.devin` match for upstream parity and classifies it only as `host-filesystem`. It can sit beside Codex, Claude, or any other invocation-scoped signal. Readers can therefore discount ambient evidence, while the stored event never claims Devin drove the invocation.

The schema change is additive within logbook schema v1. Older minimal events remain readable. Quiet JSON remains one envelope, MCP remains vendor-neutral, and no detected signal can change guidance, setup, a gate path, a result, or an exit code.

## Consequences

- **The logbook can support provider-oriented readers without pretending to know more than it does.** A later reader can compare source classes, combine corroborating evidence, or ignore the Devin host marker across the entire corpus.
- **Catalogue improvements repair retained history.** Adding an exact MCP identifier changes both future recording and the next reading of old events that kept the raw declaration. Logbook lines remain immutable.
- **Native and detectable vocabularies cannot silently diverge.** Native support comes from the broader catalogue, while the total provider record still requires every integration surface.
- **False positives remain possible and visible.** A persistent `/opt/.devin`, inherited variables, an MCP proxy, or a spoofed declaration can all produce misleading evidence. Recording all sources instead of a verdict is the mitigation, not a claim that the ambiguity disappeared.
- **The privacy surface grows by a small, named amount.** Environment values remain excluded. The logbook stores MCP client name, optional title, and version locally in bounded form. Those fields join its read-aloud contract.
- **The external marker catalogue needs maintenance.** Vendor variables can change. Current knowledge cannot repair an event that retained no raw declaration or retained an incorrect one; readers must remain conservative.
- **Product neutrality becomes enforceable.** One guard confines the effectful detector to the two recording points. Another confines direct reads of stored identity signals to the canonical effective view.

## Alternatives considered

- **Exclude `/opt/.devin`.** Rejected: it would knowingly diverge from the upstream catalogue and lose a useful signal in Devin's hosted environment. Giving host state its own source class records its weaker lifetime honestly and lets readers ignore it when stronger invocation evidence exists.
- **Choose the strongest match and store one agent.** Rejected: strength is an inference that will change as markers and clients evolve. It would also turn the Devin ambiguity into a hidden classification error. All evidence must survive for future readers.
- **Reuse setup's PATH detection.** Rejected: an installed binary persists across unrelated sessions and answers availability, not invocation identity. Its current setup-only purpose remains sound.
- **Store only normalized MCP identity.** Rejected: an unknown client would become permanently unclassifiable in old events. Bounded raw metadata lets future readers revisit it.
- **Use identity detection to select output, guidance, or provider-specific behavior.** Rejected permanently on ADR 0030's reasoning. Ambient guesses are too mutable and surprising to steer the product; the logbook is the sole consumer precisely because it records without acting.
