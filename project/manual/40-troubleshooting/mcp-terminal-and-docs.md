---
id: troubleshoot-mcp-terminal-and-docs
title: "MCP, terminal, and docs"
description: "Recover missing or expiring MCP tool calls, continue an unfinished wait, resolve a docs target, and read results when the terminal, pager, or browser degrades."
order: 50
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-mcp-terminal-and-docs"
  - "Tool-call duration"
  - "MCP timeout"
  - "tool-call timeout"
  - "long MCP calls"
  - "mcp version mismatch"
  - "met false"
  - "exit 124"
  - "pager failed"
  - "docs target not found"
redirect_from:
  - "/docs/reference/mcp-call-duration"
---

# MCP, terminal, and docs

The agent surface and the reading surfaces are built to degrade politely: a tool call that can't finish returns a continuation instead of failing, a missing tool always has a command-line twin, and a broken pager falls back to plain output. So when something here looks wrong, the question is rarely "how do I force it" and almost always "which designed fallback applies." That keeps you working — and keeps the agent from inventing polling loops or retry counts that the product already made unnecessary.

## The discern tools are missing from the session

The agent's session doesn't list `discern_status` and its siblings, or calls to them fail as unknown. Which recovery applies depends on when the tools were last seen:

- **Never in this session.** The provider reads its MCP registration when a session starts, so files generated after the session began aren't loaded yet. Start a fresh session and have the agent invoke the exact callable by name — namespaced on hosts that namespace, such as `mcp__discern__discern_status`. If a fresh session still lacks the tools, `discern doctor` verifies the integration files exist and parse; [Setup and integrations](setup-and-integrations.md#the-tools-dont-appear-in-the-agents-session) covers first-time activation, including the provider-side trust approval discern can't grant.
- **Working earlier, failing now.** The MCP server process outlives upgrades, so after `discern upgrade` a session can keep talking to the old build. discern detects the mismatch and says so in results: restart the agent session (or reload its MCP servers) so the server matches the installed binary. Until then, results from the two builds can disagree — including rewriting generated files differently — so the restart is worth doing promptly.

Either way, work needn't stop: every discern MCP tool fronts a CLI verb, and `discern <verb> --json` (structured) or `--markdown` (prose) returns the same result envelope. The [MCP and results reference](../30-reference/mcp-and-results.md) lists the tool-to-verb registry.

## A long call ended without an answer

A `discern_await` watch can reach the end of its reliable transport window before its condition holds. The result is `ok: true` with `data.met: false` — an unfinished wait, not a failure (the CLI equivalent exits `124` for scripts). It carries a continuation that preserves the original condition and everything observed so far, including a change that happens between calls.

Follow the continuation rather than re-posing the watch. Through MCP:

```
discern_await
  path:   /absolute/path/to/the/worktree
  resume: C1-BKJD-X4GQ-05
```

The command-line result names its own form: `discern await --resume C1-BKJD-X4GQ-05`. Continue with the newest handle until `data.met` is `true` or the dependency stops mattering — there is no retry count to manage, and no reason to add sleeps between calls.

Neighboring states are commonly confused with this one:

- **A refusal (`ok: false`) has no continuation.** The watch as posed can't be answered — a branch name that doesn't resolve, a green watch on a worktree that's gone. Follow the refusal's recovery instead of resuming; [Wait for another task](../10-guides/wait-for-another-task.md#handle-a-refusal) covers the cases.
- **A slow call is not a stuck call.** discern sizes each generated tool's window to the provider's transport limits, reserving room to deliver the result — most providers get a call windowed a little under an hour; one strict surface is capped at seconds and leans on continuations instead. The exact per-provider durations and the timeout policy live in [MCP and results](../30-reference/mcp-and-results.md) and [Platforms and providers](../30-reference/platforms-and-providers.md).

## A docs or map target won't resolve

`discern docs <target>` (or `discern_docs`) reports no match, or more than one:

- **Ambiguous.** The result lists the candidates; rerun the same command with one exact listed path as the target.
- **Not found.** Use a suggested path when the result offers one. Otherwise run the command with no target to see the index, or search in task language — then retry with a path the result returned. Guessing variations of a path converges slower than reading the index once.

## The terminal output looks broken

Rendering degrades in layers, and each layer has a switch:

- **The pager failed.** Paged reading is opt-in; when the configured `$PAGER` (or the `less -R` default) can't run, discern says so and prints the document plainly instead. The content is complete — only the scrolling is gone. Fix or unset `$PAGER` to choose the path you want.
- **Color or width is wrong.** Set `NO_COLOR=1` to drop color entirely; discern also narrows to the terminal's reported width and prints plain output when not attached to a terminal.
- **An agent is reading decorated output.** Human terminal decoration doesn't belong in agent context. Agents pass `--markdown` or `--json`, which bypass the interactive presentation entirely.

## A browser didn't open

Commands that hand off to a browser (opening the hosted docs, a Desk link) report when the handoff fails or the platform has no launcher, and the URL stays printed in the result. Open it yourself in any browser; nothing else about the command's work depended on the handoff.

## When to stop

Stop resuming a wait when the dependency no longer matters: ending a watch early is a valid outcome. Stop working around a version mismatch once you've seen the restart notice; two builds writing the same files gets worse with patience. And transport limits belong to the providers: when a vendor's window changes, the durable fix is discern's generated configuration catching up, which is worth reporting.
