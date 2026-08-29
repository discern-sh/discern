---
id: guide-connect-a-coding-agent
title: "Connect a coding agent"
description: "Connect one supported coding agent using the shared setup path and the provider-specific facts it needs."
order: 120
publish: true
kind: guide
aliases:
  - "guide-connect-a-coding-agent"
  - "agent integrations"
  - "coding agents"
  - "providers"
redirect_from:
  - "/docs/agent-integrations"
---

# Connect a coding agent

Use this guide to add Claude Code, Codex, Gemini CLI, Cursor, or GitHub Copilot CLI to an existing discern project, or to recover when a configured provider cannot call discern. These providers follow one repository procedure. Their trust step, fresh-session action, and callable name differ.

Repository wiring and live activation are separate. `discern refresh` can prove the committed files are current. Only a fresh provider session that invokes its local discern action proves that provider loaded them.

## Starting state

- The discern binary is available on `PATH` and the project has completed setup.
- The coding agent works in an owned worktree for the config change.
- The person has installed the provider and chosen whether it should receive this project's instructions, Skills, hooks, and MCP connection.
- The person can complete provider trust or approval prompts. discern cannot grant vendor authority.

## 1. Select the provider once

**Person and coding agent:** Choose from the supported config ids: `claude_code`, `codex`, `gemini`, `cursor`, and `copilot`.

Set the complete desired list under `[project]`:

```toml
[project]
agents = ["codex", "cursor"]
```

Omitting `agents` uses the default pair, Claude Code and Codex. An explicit empty list selects no provider. Treat the configured list as the authority; do not maintain separate provider switches elsewhere.

On a fresh setup, discern recommends a list from installed command-line tools, editor commands, and conventional application locations. The person may change that list before setup completes.

## 2. Preview and apply the shared wiring

**Coding agent:** Run:

```sh
discern refresh --dry-run
```

Review each planned create, update, and removal. Provider config can be shared with the project or another provider, so refresh merges discern's entry while preserving unrelated content.

Apply the plan:

```sh
discern refresh
```

Inspect the result, run `discern doctor`, and review the Git diff. A complete result reports current compiled instructions, Skills, hooks, MCP registration, and any provider-specific worktree support. A partial refresh preserves completed writes and gives a retry; follow it until top-level `ok` is true.

Run `discern prepare`, commit the config and every tracked integration change, then run `discern done`. The provider will not load project-local changes from this branch until it opens that worktree or the change lands.

## 3. Complete the provider-specific activation

After the wiring is present in the checkout the provider will open, **person:** complete the applicable trust action. **Coding agent:** start the fresh session and invoke the listed callable.

| Provider           | Person's bounded action                                                                                                                                                                                                   | Fresh-session check                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code        | No separate project trust prompt is expected; discern pre-approves its MCP server in the generated settings.                                                                                                              | Close and reopen Claude Code in the project, inspect registered tools, then invoke `mcp__discern__discern_status`.                                          |
| Codex              | Trust the project directory and approve each committed hook hash before it runs.                                                                                                                                          | Open a new Codex task for this project, inspect registered tools, then invoke `mcp__discern__discern_status`. Restart the app if a new task still lacks it. |
| Gemini CLI         | Trust the workspace so project settings load. Confirm hooks are enabled in the committed settings.                                                                                                                        | Start a new Gemini CLI session in the trusted workspace, inspect tools, then invoke `discern_status`.                                                       |
| Cursor             | Trust the workspace and approve the discern MCP tools on first use. For Local sessions editing sibling worktrees, either allow external file edits in Cursor settings or start the session with Cursor's Worktree option. | Reload the Cursor window, start a new agent conversation in that workspace, inspect tools, then invoke `discern_status`.                                    |
| GitHub Copilot CLI | Add the project to the provider's trusted folders.                                                                                                                                                                        | Start a new Copilot CLI session in the trusted folder, inspect tools, then invoke `discern_status`.                                                         |

Use the exact action named by the refresh or setup handoff when it differs from a generic host display. MCP hosts may add their namespace to the callable name.

## 4. Recover a missing action locally

If the callable is absent, **coding agent or person:** follow this order:

1. Confirm the session opened the intended checkout, including its current branch and absolute path.
2. Complete the provider's trust or hook approval and start another fresh session.
3. Run `discern refresh --dry-run` to detect missing repository wiring.
4. Run `discern doctor` and apply its provider-specific recovery.
5. Use `discern status --json` as the local command-line fallback while repairing MCP.

Do not infer activation from generated files, a successful refresh, or a provider name in config. Those facts establish intent and repository state. The callable returning a local result establishes session activation.

If the provider cannot find `discern`, open a new shell and verify `which discern`. A non-interactive provider shell must receive the same `PATH` or an appropriate absolute command configured by the supported integration.

## 5. Remove a provider from the project

**Person:** approve the new complete provider list. **Coding agent:** remove the id from `[project].agents`, preview `discern refresh`, apply it, and review the planned integration removals. Refresh removes discern-owned entries while preserving shared file content owned by the project or another provider.

Commit the config and tracked output together and run the full Gate. This removes project wiring; uninstalling the provider application remains outside discern.

## Completion

Connection is complete when the provider id is in the committed config, refresh and doctor are green, the full Gate passes, and a fresh trusted session invokes its local status action successfully. Recovery is complete when that callable returns successfully; current files alone do not establish activation.

Use [Platforms and providers](../30-reference/platforms-and-providers.md) for exact files, trust facts, timeouts, and platform support. Use [Setup and integrations troubleshooting](../40-troubleshooting/setup-and-integrations.md) when activation or ownership fails, and [Write project instructions](write-project-instructions.md) for the shared instruction source.
