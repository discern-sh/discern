---
title: Result formats & delivery
description: Choose terminal, Markdown, JSON, or MCP delivery for one prepared DiscernResult.
order: 30
aliases:
  - Markdown result
  - --markdown
  - JSON result
  - structuredContent
  - MCP content
---

# Result formats and delivery

_One prepared `DiscernResult` can be presented in the terminal, as authored Markdown, as compact JSON, or through MCP._

| Surface               | Result                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Terminal CLI          | Interactive or static terminal presentation.                                                |
| CLI with `--markdown` | One authored Markdown presentation on stdout.                                               |
| CLI with `--json`     | One compact structured `DiscernResult` on stdout.                                           |
| MCP tool              | Authored Markdown in `content`, the compact envelope in `structuredContent`, and `isError`. |
| MCP resource          | A live compact payload or requested Markdown document, without an envelope.                 |

Choose the representation by task and mode of consumption. People and coding agents can read the terminal presentation, Markdown, or JSON. Markdown favors concise, prioritized prose; JSON favors exact field access, selection, validation, scripts, and durable integration. An agent may benefit from JSON's structure, and a person may prefer Markdown for reading, quoting, or pasting.

MCP delivers both representations because supported hosts expose the channels differently. Either `content[0].text` or `structuredContent` is sufficient to understand the current state and choose the next action. A host that delivers both receives complementary representations instead of pretty and compact copies of the same JSON.

`--markdown` and `--json` are mutually exclusive. Both suppress terminal decoration and subprocess narration around the result. `--md` is not an alias.

An authored Markdown presentation selects facts from the registered result contract. It does not dump every JSON field. When present, sections occur in this order: current state, bounded evidence, authority and boundaries, then the next action. If several future actions matter, the immediate one closes the document. Requested map or manual pages and setup guidance remain intact inside the evidence section.

See [MCP tools and result contracts](mcp-and-results.md) for the tool registry, envelope fields, schemas, resources, and exit codes.
