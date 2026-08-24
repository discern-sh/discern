# ADR 0321: Diagram geometry follows Markdown code-block semantics

**Status**: accepted; amends the geometry contract of [ADR 0187](0187-tidy-checks-diagram-geometry.md) without changing the `freeform` opt-out.

## Context

`discern tidy` validates box-drawing alignment in configured Markdown because a formatter can preserve syntactically valid text while leaving a diagram visually broken. The original scanner enrolled fenced code blocks. Markdown also defines indented code blocks, but box-drawing content there bypassed the geometry check. A misaligned diagram could therefore fail in fenced form and pass unchanged when represented with four-space indentation.

The distinction is syntax, not intent. Both block forms represent code-like literal content and preserve the same box-drawing geometry. An agent should not need to know that the validator's parser happened to recognize only one spelling.

Fenced blocks have an info string, which supports the existing `freeform` opt-out for content where column alignment is deliberately not structural. Indented blocks have no equivalent metadata channel.

## Decision

**Box-drawing geometry validation follows Markdown code-block semantics, covering both fenced and indented blocks.**

- The Markdown block scanner emits literal content for fenced and indented code blocks through one diagram validator. A box-drawing glyph in either form enrolls the block.
- Both forms use the same display-column alignment rule and the same `diagrams_misaligned` diagnostic with file, line, and column.
- The existing fenced `freeform` info-string tag remains the explicit opt-out. Because an indented block carries no info string, deliberately freeform box-drawing content must use a fenced block tagged `freeform`.
- Tidy's all-or-nothing planning remains unchanged: any misaligned diagram stops the run before a Markdown or TOML target is written.
- Fixtures cover aligned and misaligned examples in both forms and prove the `freeform` exemption remains limited to the tagged fenced form.

## Consequences

- Changing a diagram from fenced to indented syntax cannot bypass the Gate's geometry contract.
- Diagnostics and recovery remain identical across block forms; authors fix alignment or choose the visible `freeform` spelling.
- The scanner must implement Markdown indentation and blank-line boundaries accurately enough to identify the literal block without treating ordinary nested prose as code.
- A future Markdown literal-block form must join the same semantic scanner or carry a reasoned exception; syntax-specific enrollment is no longer sufficient.

## Alternatives considered

- **Normalize every indented block to a fence.** Rejected because tidy promises canonical formatting without rewriting literal block style or inventing info strings.
- **Leave indented diagrams unchecked.** Rejected because the same visual defect would keep two verdicts based only on Markdown spelling.
- **Treat every indented block as freeform.** Rejected because that preserves the bypass and makes the opt-out implicit.
- **Invent an adjacent comment opt-out.** Rejected because the existing fenced `freeform` tag is visible, local, and sufficient; a second mechanism would create competing authority.
