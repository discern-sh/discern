# ADR 0280: Agent results have one structured contract and an authored Markdown projection

**Status**: accepted. Extends [ADR 0028](0028-result-envelope-and-diagnostics.md), [ADR 0041](0041-self-describing-mcp-surface.md), [ADR 0097](0097-publish-json-result-contracts.md), and [ADR 0172](0172-hints-compile-from-a-registry.md).

## Context

Every verb already returns one `DiscernResult`. CLI `--json` and MCP `structuredContent` serialize that envelope, while the human terminal renderer reads the same result. The MCP renderer also serializes the complete object as indented JSON in `content[].text`. Agent hosts do not expose those two MCP channels consistently: some favor structured content, some expose text to the model, and some concatenate both. A result therefore has to remain useful through either channel, but mirroring the same JSON in both can charge an agent's context twice.

The duplication is most expensive for `status`, `done`, and `accept`. Their structured payloads can carry complete rendered Proof pages, sometimes repeated in compatibility fields, even though the current Proof state and one-line Proof carry the evidence an agent needs to choose its next action. The MCP recommendation to include serialized structured data in text protects text-only clients, but a literal mirror is a poor fit when hosts deliver both copies to the model.

CLI callers have a related need. `--json` is the integration contract, while an agent sometimes needs a concise textual result that preserves the same meaning without spending context on object syntax or a human dashboard. Markdown is the common agent-readable format, but deriving it mechanically from arbitrary JSON would preserve the noise and lose the prioritization the format is meant to provide.

## Decision

One registered result contract owns two agent projections of the same prepared `DiscernResult`:

- `discern <verb> --json` and MCP `structuredContent` receive the compact structured projection validated by that contract's output schema.
- `discern <verb> --markdown` and MCP `content[].text` receive the contract's authored Markdown presentation.
- The interactive terminal renderer remains a separate human projection of the same result.

Each representation is action-complete by itself. A host may deliver structured content, text content, or both without hiding the state or instruction the agent needs. When both reach the model, the Markdown adds prioritization instead of repeating JSON syntax.

Every result-contract entry must select a Markdown presenter. Presenters may share typed family helpers, but the registry has no implicit JSON-to-Markdown fallback for a registered contract. Adding a contract therefore fails compilation until its agent presentation is chosen. Unregistered router failures retain a small envelope presenter so a malformed or retired command can still produce a controlled machine result.

The renderer enforces this order when a part exists:

1. current state;
2. bounded supporting evidence;
3. authority or stop boundary;
4. next valid action.

The next action closes the presentation so a secondary instruction cannot displace it at the end of an agent's context. Registered hint categories feed the shared parts of that order: notices support the evidence, guardrails state boundaries, and next-step hints close the result. Per-contract presenters select the domain facts that deserve evidence and may supply a more specific action already present in the result data.

Agent wire projections omit rendered artifacts and repeated path inventories when compact evidence preserves the decision. `done` retains a compact `proof`, including its line, instead of the full Proof page. `status` retains Proof status and compact claims while removing nested Proof pages and compatibility copies; collision rows retain claimant identities and counts while their path lists remain in human `--verbose` and the later `update` result; landing authority retains the decision, six uncovered-path examples, and the total. `accept` retains `proof_line` and landing state while removing its paste-ready Proof body. Requested documentation and setup guidance remain intact because their authored Markdown is the requested result or a required instruction, not a duplicate rendering. Diagnostics keep structured detail, while the Markdown presentation bounds diagnostic output and names the reproduction command or saved artifact.

`--markdown` is the canonical global flag. The format is called Markdown in prose; `--md` is not an alias. `--markdown` and `--json` are mutually exclusive. Both use the existing quiet result path so subprocess narration and interactive decoration cannot leak around the one result. No `--full` mode is added: callers needing integration detail use the structured contract, and a new expansion mode must justify its own use case later.

The contract registry, its presenter selection, its optional wire projector, generated schemas, CLI tree, and MCP table form one mechanically reconciled set. Tests hold presenter coverage, projection-schema faithfulness, CLI flag placement and child-boundary behavior, MCP channel parity, presentation ordering, and representative combined context budgets.

## Consequences

- Gemini-class text-only hosts and structured-first hosts both receive enough state and guidance to act.
- Hosts that concatenate both channels spend tokens on complementary forms rather than pretty and compact copies of the same object.
- `--markdown` gives agents and shell callers the same text MCP uses, so that surface cannot drift into a third message.
- Structured results become smaller where a rendered Proof duplicated its compact evidence. Consumers that need the full human Proof fetch it through the named verbose status path.
- A presenter is now part of adding or changing a public result contract. This costs an explicit product-language decision and makes context quality reviewable at the same point as schema shape.
- Markdown presentations are intentionally selective. They preserve semantic parity and enough state to act. JSON remains the validated structured integration shape after its declared compact projection.
- The implementation departs from the MCP literal-mirror recommendation. That interoperability risk is accepted because both channels remain independently sufficient, while observed agent hosts make duplicate delivery a current context cost.

## Alternatives considered

- **Keep pretty JSON in MCP text.** Rejected because hosts that deliver both channels duplicate the payload, and text-only hosts receive syntax rather than an agent presentation.
- **Send structured content only.** Rejected because some supported hosts expose only text content to the model.
- **Send Markdown only.** Rejected because structured-first hosts and programmatic consumers need the validated object contract.
- **Generate Markdown from every JSON field.** Rejected because it preserves the payload's ordering and verbosity instead of expressing state, evidence, authority, and action.
- **Author a completely separate Markdown document at each call site.** Rejected because it would create a second source of truth for result semantics. Presenters remain projections at the shared result boundary.
- **Add `--full` now.** Rejected because no distinct caller need requires it; the structured projection and existing verbose human retrieval cover the known cases.
