---
title: Agent result surfaces
description: Choose human, Markdown, JSON, or MCP delivery for one prepared DiscernResult.
order: 25
aliases:
  - Markdown result
  - --markdown
  - JSON result
  - structuredContent
  - MCP content
---

# Agent result surfaces

_One prepared `DiscernResult` has a human rendering, an authored agent presentation, and a compact structured projection._

| Surface               | Result                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Human CLI             | Interactive or static terminal rendering.                                                   |
| CLI with `--markdown` | One authored agent presentation on stdout.                                                  |
| CLI with `--json`     | One compact structured `DiscernResult` on stdout.                                           |
| MCP tool              | Authored Markdown in `content`, the compact envelope in `structuredContent`, and `isError`. |
| MCP resource          | A live compact payload or requested Markdown document, without an envelope.                 |

MCP delivers both agent representations because supported hosts expose the channels differently. Either `content[0].text` or `structuredContent` is sufficient to understand the current state and choose the next action. A host that delivers both receives complementary representations instead of pretty and compact copies of the same JSON.

Use `--markdown` when an agent will read the result directly. Use `--json` for field access, scripts, validation, or durable integration. The flags are mutually exclusive. Both suppress terminal decoration and subprocess narration around the result. `--md` is not an alias.

An authored Markdown presentation selects facts from the registered result contract. It does not dump every JSON field. When present, sections occur in this order: current state, bounded evidence, authority and boundaries, then the next action. If several future actions matter, the immediate one closes the document. Requested map or manual pages and setup guidance remain intact inside the evidence section.

See [MCP tools and result contracts](mcp-and-results.md) for the tool registry, envelope fields, schemas, resources, and exit codes.
