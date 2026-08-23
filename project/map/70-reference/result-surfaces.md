---
title: Result formats & delivery
description: Choose terminal, Markdown, JSON, or MCP delivery for one prepared DiscernResult.
order: 30
aliases:
  - Markdown result
  - --markdown
  - --render
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
| CLI with `--render`   | Authored Markdown rendered as static terminal output.                                       |
| CLI with `--json`     | One compact structured `DiscernResult` on stdout.                                           |
| MCP tool              | Authored Markdown in `content`, the compact envelope in `structuredContent`, and `isError`. |
| MCP resource          | A live compact payload or requested Markdown document, without an envelope.                 |

Choose by task and consumer. Markdown offers prioritized prose for reading and quoting; JSON offers exact fields for selection, validation, scripts, and durable integrations. Either may suit people or agents.

MCP carries both representations because hosts expose channels differently. Either `content[0].text` or `structuredContent` explains the current state and next action; together they remain complementary rather than duplicate JSON.

`--markdown`, `--json`, and `--render` are mutually exclusive. All suppress surrounding terminal decoration and subprocess narration; `--md` is not an alias. The convenience-only `--render` passes authored Markdown through discern's terminal renderer. It never prompts or pages, follows width, theme, color, and character support, and redirects without control sequences. JSON and Markdown remain the primary result formats.

An authored Markdown presentation selects facts from the registered result contract. It does not dump every JSON field. When present, sections occur in this order: current state, bounded evidence, authority and boundaries, owner attention, other actions, then the next action. Owner attention contains decisions reserved for the owner. If several caller actions matter, secondary actions come first and the immediate next action closes the document. Whitespace-significant supporting payloads retain their exact content inside the evidence section, including leading and trailing spaces. These payloads include requested map or manual pages, setup instructions, diagnostic output, and terminal art.

`status` has an additional size boundary. Its default CLI JSON, MCP `structuredContent`, and live resource are bounded orientation projections with true omitted counts. `discern status --verbose --json` and `discern_status` with `verbose: true` select full structured status. Both default command surfaces advertise that route in `hints`; [Status and session hints](../30-worktrees/status.md) defines the fields and caps.

See [MCP tools and result contracts](mcp-and-results.md) for the tool registry, envelope fields, schemas, resources, and exit codes.
