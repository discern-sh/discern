# ADR 0086: setup serves ready-to-relay messages and gates a fresh scaffold on a `--confirmed` attestation

> **Amendments ([ADR 0322](0322-setup-is-one-bounded-operational-journey.md)).** Every must-survive consent fact occupies its own list item and every numbered confirmation is word-for-word protected. The model choice now carries the long-term outcome, a strongest-suitable-model recommendation, the coding tool's model-selector and fresh-session route, and an explicit current-agent stop boundary. Option labels remain neutral and never certify the agent. Completion derives qualitative project context as well as counts, and reactivation appears only after setup is on the trunk.

**Status**: accepted; revises the _emphasis_ of [ADR 0075](0075-setup-staged-handshake.md) (the staged, consent-driven handshake), [ADR 0077](0077-setup-agent-is-the-configuration-engine.md) (transparency over interrogation), and [ADR 0078](0078-setup-pages-and-per-step-proof.md) (stateless pages, the two-lane rule) — structure preserved, the prose lane's genre changed. Builds on [ADR 0028](0028-result-envelope-and-diagnostics.md) (one result envelope per verb) and [ADR 0041](0041-self-describing-mcp-surface.md) (schema-backed `data`).

## Context

Three iterations turned one advisory surface after another into a structural one — the staged handshake (ADR 0075), the configuration-engine reframe (ADR 0077), derived progress and per-step proof (ADR 0078) — and ADR 0077 states the governing lesson: **everything structurally enforced happened reliably; everything merely advised degraded.** What is still advisory is the conversation itself.

The prose lane — the load-bearing lane of ADR 0078's two-lane rule — carries **stage directions** ("open warmly and explain what discern is… a conversation, not a checklist") where it should carry **the script**. An agent with a warm temperament improvises well from stage directions. A terse one executes every command correctly, asks the verbatim model question, respects the write boundary — and compresses the onboarding into a three-line checklist, because composing warmth from instructions is exactly the transformation that fails under final-answer compression. Clean-room runs (agents with no prior discern knowledge, disposable target repos) reproduced this across vendors: the funnel is followed mechanically while the conversation it exists to stage is compressed away. The failure is the _genre_ — instructions _about_ a message — not insufficiently stern wording.

Two adjacent gaps travel with it. The journey framing — what happens, how long, what it costs in time and tokens — arrives only in the post-`begin` brief, after the user is already turns deep, so it informs none of the moments it was written for. And ADR 0075 left the `verify → begin` funnel deliberately soft, deferring a harder consent measure "until real use proves it insufficient" — the clean-room runs are that proof: agents reach `begin` and scaffold without ever holding the conversation `verify` staged.

## Decision

**discern authors every human-facing message of setup; the agent couriers it. And a fresh scaffold requires an explicit `--confirmed` attestation whose refusal re-serves the consent message.**

1. **The prose lane ships the script.** Each human touchpoint serves a pre-composed, first-person message the agent relays: consent at `verify`, stage-level progress at `begin`, enrolled decisions in each page, and the qualitative completion and activation handoff. `src/shared/setup_experience.ts` owns the fixed semantic contracts. Contextual builders derive repository paths, provider sets, inventory, and Proof from live authorities. Human, Markdown, JSON, and Model Context Protocol surfaces carry the resulting prose unchanged.

2. **The relay license preserves every semantic role.** Every block allows adaptive framing and requires each listed point to survive. The consent lists and numbered confirmations receive verbatim protection. A courier agent therefore preserves the owner outcome, reason, recommendation, option consequences, concrete action, and wait/proceed boundary.

   _Refined after the first post-change cold run (2026-07-02):_ the licence carries a **verbatim carve-out** — _"relay anything in quotation marks word for word"_ — because the bare licence licensed trimming the model question's second sentence. The same run showed **structure decides survival** under a courier agent's compression: opening sentences and short list items are kept; prose between lists and middle bullets are pruned. So every must-survive fact rides its own list item or the headline (the time/token expectation moved into the ready-to-begin confirmation; the fresh-session reactivation step moved from a middle bullet into the completion headline), one thought apiece.

3. **A `--confirmed` attestation gates a fresh scaffold.** `discern setup begin` requires `--confirmed` **exactly when** it would scaffold a fresh install outside the declarative paths — `freshInstall` **and** no `--config` **and** no `--allow-dirty`. Absent it, `begin` refuses before touching anything with a structured `awaiting_consent` error that **re-serves the same consent message** and the exact command to run after the conversation. The error path is the teaching path: an agent that skipped `verify` is handed the conversation, not silently proceeded past it. The attestation is **stateless** — it rides the invocation, records nothing — so ADR 0075's no-sidecar-marker invariant holds.

The journey framing, model rationale, switch route, time-and-tokens expectation, and roadmap live in the `verify` consent message before anything is written. The relay instruction also requires the current self-declared provider/model identifier, or `unreported`, as a separate fact before the owner chooses. `--confirmed` attests that the owner received those facts. If the owner switches models, the current agent stops and never runs `begin`.

The explicit **no**s:

- **No CLI interactivity.** Print-and-exit stands (ADR 0036/0044); the `awaiting_consent` refusal is itself a print-and-exit, never a prompt.
- **No hard `verify → begin` state gate.** ADR 0075 rejected a state marker because it needs a record before any config exists and breaks the read-only boundary before `begin`. The stateless attestation preserves that boundary without reintroducing the gate.
- **No vendor-sniffed output.** The served blocks are domain neutral and vendor neutral. The complete relay makes compensating for a terse agent unnecessary.
- **No duplicated full message in typed fields.** The prose lane carries the complete message. Typed owner-moment projections carry ids, kind, recommendation, option ids, and wait state for integrations.
- **Not a hard consent gate.** `--confirmed` is rubber-stampable by a determined agent — accepted; it is a speed bump with a payload (it re-serves the conversation), not proof.

## Consequences

- **The floor is raised without capping the ceiling.** A terse courier agent now delivers a complete first conversation — the novice learns what discern is, what it will do, what it costs, and what they are agreeing to, before anything is written — while a warm agent is still free to make it its own.
- **The refusal teaches.** An agent that ran `begin` too early is handed the consent conversation and the corrected command, rather than scaffolding past a step it skipped. This is ADR 0075's soft funnel gaining exactly one hard edge, at the read-only→destructive boundary, without a state machine.
- **Single-source discipline extends to the messages.** Fixed human moments live in one registry, contextual facts derive from repository and provider authorities, and every presentation carries the same prose. A future decision must satisfy the semantic schema before it can ship.
- **The attestation is honest about its limits.** A determined agent can pass `--confirmed` without holding the conversation. Accepted: the aim is a raised floor, and the flag's value is the served payload it withholds until asked, not a cryptographic guarantee.
- **More surface to keep coherent.** Three served blocks, a flag, and a done schema are new moving parts — held together by the same single-source disciplines the rest of setup uses, plus the parity/faithfulness tests.
- **Emphasis, not reversal.** The staged handshake, derived progress, the stateless pages, and the configuration-engine reframe all stand. ADR 0075 pre-authorized this revisit; the clean-room evidence is what it asked to wait for.

## Alternatives considered

- **Keep stage directions; sharpen the prose.** Rejected: the degradation was systemic across vendors and traces to the genre — instructions _about_ a message that a terse agent summarizes — not to wording. Sharper stage directions reproduce the same compression.
- **A hard `verify → begin` state gate.** Rejected as ADR 0075 rejected it: a pre-`begin` marker breaks the read-only boundary before `begin`. The stateless attestation respects that invariant.
- **Field-ize the messages for machine consumers.** Rejected by ADR 0078's two-lane finding: behavioral content delivered as JSON fields is treated as data to summarize and weakened. The relay blocks stay prose; only the machine lane (findings, spine, the structured `done` pieces) is field-ized.
- **Vendor-sniffed warmth (detect the terse agent and compensate).** Rejected: brittle, and the served-message floor makes it unnecessary — discern raises the floor for every agent rather than guessing which one needs help.
