# ADR 0361: The Proof line is canonical CommonMark

**Status**: accepted. Amends the line presentation in [ADR 0188](0188-the-receipt-relays-as-one-line.md); its one-line relay, underlying facts, and owner-pulled page remain unchanged.

## Context

The Proof line is the only discern-authored evidence an agent puts in its final account. It previously arrived as one plain-text sentence after the agent's prose. That made the most important completion boundary visually indistinguishable from the surrounding transcript, even though the agent was instructed to copy it verbatim and the full Proof page was already Markdown.

Coding-agent transcripts generally interpret Markdown, but terminal, JSON, Model Context Protocol, stored markers, durable Proof notes, setup relays, and the Desk all consume the same `Proof.line` value. Improving only the chat example would create two formats or ask each consumer to reconstruct presentation independently. A vendor-specific presentation would make the contract less portable, and a success glyph could blur the distinction between machine-verified Gate success and the owner decisions that remain.

The existing line also compressed Git identities and prose into the same visual register. Its `@`, bare branch and commit, bare trunk, comma-separated Standard counts, and terse final command were readable but harder to scan than the facts warranted.

## Decision

`Proof.line` is canonical one-line CommonMark blockquote source. `renderProofLine` owns its wrapper, semantic inline markup, wording, separator, and escaped dynamic values. A normal line has this shape:

> **Proof:** The Gate passed for `agent/example` at `abc123def456` · 3 files changed (+21 −8) vs `main` · Standards held (2 improved) · 1 checkpoint declared met · View the full Proof: `discern status --verbose`

The contract uses only core CommonMark: a blockquote, strong label, and code spans. Branches, commits, trunk names, commands, and named Standard proposals are code. Words carry state; the line does not add emoji or a check glyph. The middle dot separates facts, the true minus sign distinguishes deletion counts, and the arrow remains reserved for proposal value transitions.

`renderLandingProofLine` rewrites open decision segments and appends consent evidence in the same source, using the same separator. JSON, Model Context Protocol, Gate markers, and Proof notes preserve the source exactly. Authored result Markdown includes it as a standalone block rather than a list item. Terminal and Desk views render it through the shared Markdown presenter; setup's agent-to-human message ends with the exact source.

There is no parallel plain-text field, presentation enum, or Proof-line abstract syntax tree. Older stored plain-text lines remain valid CommonMark and are relayed without migration; landing can still append or resolve their segments. Presentation changes do not alter durable Proof identity.

## Consequences

- In a Markdown-capable transcript, the Proof reads as a distinct quoted record, while its label and machine identifiers remain scannable.
- Every serialized surface continues to expose one `line` field. Consumers either preserve that source or render it at their presentation boundary.
- Colour terminals express strong and code styling directly. Colourless terminals retain the Markdown markers so the same semantics remain copyable.
- A long source line may wrap physically in a terminal or narrow Desk view, but its serialized value remains one line.
- Plain-text consumers that do not interpret CommonMark now display a leading `>` and inline delimiters. That is an intentional portable fallback, not a second format.

## Alternatives considered

- **Keep plain text and change only the wording.** Rejected because the completion boundary would still disappear into the surrounding transcript.
- **Prefix the line with a tick or another success glyph.** Rejected because glyph support varies and a visual success mark says less precisely than “The Gate passed”; it can also imply that landing authority or review has passed.
- **Use GitHub-style alerts, HTML, or a vendor-specific panel.** Rejected because coding-agent and terminal renderers do not share those extensions. Core CommonMark is the portable contract.
- **Add separate plain and Markdown fields.** Rejected because two authorities would drift and every consumer would need a selection policy. The existing field can carry CommonMark without a schema migration.
- **Introduce a structured Proof-line template or AST.** Rejected because the line has one producer and a small fixed grammar. Centralizing its wrapper, separator, and escaping captures the likely edits without creating a presentation framework.
