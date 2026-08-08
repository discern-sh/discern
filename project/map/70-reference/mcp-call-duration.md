---
title: MCP call duration
description: How discern fits long-running tool calls inside each coding agent's MCP timeout.
order: 120
aliases:
  - MCP timeout
  - tool-call timeout
  - long MCP calls
---

# Tool-call duration

A long-running discern tool can wait only as long as the coding agent keeps its Model Context Protocol (MCP) call open. discern writes a provider-specific transport profile and reserves time below that limit for result delivery:

| Coding agent       | Client behavior                                                                                                    | Generated tool limit  | One `discern_await` call |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------ |
| Claude Code        | Configurable; no published maximum                                                                                 | 60 minutes            | 55 minutes               |
| Codex              | 60-second default; configurable per server                                                                         | 60 minutes            | 55 minutes               |
| Gemini CLI         | 10-minute default; configurable per server                                                                         | 60 minutes            | 55 minutes               |
| GitHub Copilot CLI | Configurable per server; no published default or maximum                                                           | 60 minutes            | 55 minutes               |
| Cursor             | CLI and Agent Client Protocol (ACP) stop at 60 seconds; Cursor support reports around 60 minutes for the IDE Agent | Strict shared profile | 45 seconds               |

discern chooses the one-hour values as a shared operating budget. Vendor maximums may be higher. See each provider's integration page for the generated configuration and primary sources.

Cursor needs the shorter profile because its editor and CLI read the same project `.cursor/mcp.json`, while their current call durations differ. discern does not choose behavior from advisory client names. The shared entry therefore fits the shortest verified surface: the current Agent CLI and ACP path. Other Cursor surfaces can have longer limits.

`discern_await` returns as soon as its condition holds. When the call reaches its limit first, the result includes a `--resume` command that preserves the original condition and observation state. Continue without a fixed retry count until the condition holds, the user stops the watch, or the task no longer needs the dependency. An `ok: false` refusal has no continuation. Follow its recovery hint.

The timeout policy covers discern's canonical provider set. Adding a native provider fails type-checking and registry tests until that provider declares a verified profile. Its integration page must then show the matching flag and duration.
