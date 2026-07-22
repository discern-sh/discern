---
title: MCP tools & results
description: The public MCP tools, resources, DiscernResult envelope, generated schemas, and command exit-code contract.
order: 30
publish: true
aliases:
  - MCP
  - Model Context Protocol
  - DiscernResult
  - structuredContent
  - result envelope
  - JSON result
  - exit codes
  - discern_status
  - discern_start
  - discern_done
  - discern_prepare
  - discern_test
  - discern_update
  - discern_standards
  - discern_accept
  - discern_impact
  - discern_coupling
  - discern_patterns
  - discern_refresh
  - discern_map
  - discern_help
  - discern_doctor
  - discern_improvement
---

# MCP tools and result contracts

_The caller-visible contract shared by MCP tools and `discern <command> --json`, plus the CLI exit statuses around it._

## Choose a result surface

| Surface           | Result                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Human CLI         | Headings, progress, step summaries, diagnostics, and next actions rendered for a terminal.     |
| CLI with `--json` | One serialized `DiscernResult` object on stdout for commands with a published result contract. |
| MCP tool          | `{content, structuredContent, isError}` with the serialized `DiscernResult` in both channels.  |
| MCP resource      | A live data payload or Markdown document, without the surrounding result envelope.             |

The human, JSON, and MCP tool forms report the same settled result. `structuredContent` is the machine-readable value. `content[0].text` is that value formatted as JSON text. `isError` is `true` when `structuredContent.ok` is `false`.

## MCP tools

| Tool                  | Purpose                                                                      | Effect contract                                            |
| --------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `discern_status`      | Report the current branch, gate inputs, standards, receipt, and fleet state. | Read-only and idempotent.                                  |
| `discern_start`       | Create and set up a new isolated worktree, then re-aim the server to it.     | Mutating; each successful call creates a new worktree.     |
| `discern_done`        | Run the full gate and return steps, diagnostics, and an optional receipt.    | Runs project commands; fix-stage commands may rewrite.     |
| `discern_prepare`     | Run the fix and check stages for the fast inner loop.                        | Runs project commands; fix-stage commands may rewrite.     |
| `discern_test`        | Run the configured test job on its own.                                      | Runs a project command.                                    |
| `discern_update`      | Merge the selected base into this branch and re-materialize generated files. | Mutating and idempotent for the same inputs.               |
| `discern_standards`   | Measure standards, compare limits, and optionally pin improvements.          | Runs project commands; pinning changes and commits config. |
| `discern_accept`      | Land an authorized worktree and tear down its resources and branch.          | Destructive; requires owner confirmation.                  |
| `discern_impact`      | List the scopes the current change activates.                                | Read-only and idempotent.                                  |
| `discern_coupling`    | Report historical co-change partners for the current diff or named files.    | Read-only, idempotent, and advisory.                       |
| `discern_patterns`    | Report findings from the local logbook of discern's own verb runs.           | Read-only, idempotent, and advisory.                       |
| `discern_refresh`     | Rebuild generated guidance, skills, and provider integration artifacts.      | Mutating, closed-world, and idempotent.                    |
| `discern_map`         | Index, search, or read the project's agent-maintained map.                   | Read-only and idempotent.                                  |
| `discern_help`        | Index, search, or read discern's bundled public manual.                      | Read-only, idempotent, and project-independent.            |
| `discern_doctor`      | Check config, commands, repository shape, and integration health.            | Read-only and idempotent.                                  |
| `discern_improvement` | Rank the next improvement and return the supporting health audit.            | Read-only and idempotent.                                  |

Every project-operating tool accepts an optional `path` that selects the discern project or worktree for that call. Pass an absolute filesystem path anywhere inside the intended checkout, including another repository in a multi-repo workspace; discern resolves the project root. Omit it to use the checkout the MCP server currently targets. Relative paths are rejected because the server's process directory is not the caller's directory. `discern_help` needs no project. After a successful `discern_start`, later calls use the new worktree by default; after `discern_accept` removes that worktree, the server re-aims at the surviving main checkout.

Tools that require completed setup return a controlled `not_set_up` result until setup finishes. A tool rejects undeclared input keys instead of dropping them.

### Find a map or help page

`discern_map` and `discern_help` expose the same discovery funnel ([ADR 0173](../_adr/0173-agent-document-discovery-funnel.md)):

| Inputs                 | Result                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Neither                | The admitted document index; map also includes its top-level regions and file-linked freshness facts. |
| `target`               | One document's content, or a compact index when `target` names a top-level region.                    |
| `search`               | Up to five ranked documents from the admitted corpus.                                                 |
| `target` plus `search` | The same search limited to one exact region or document.                                              |

A search result carries `target`, `path`, `section`, `title`, `description`, an optional matching `heading`, and a contextual `snippet`. The enclosing payload carries `query`, optional `scope`, the full match `count`, `truncated`, and the returned `results`. A zero-match search is `ok: true` with an empty result list. Scores remain an implementation detail.

Map search covers every page visible to the agent-facing map, including a page marked `publish: false`. Help search covers the bundled public manual. Both run locally, and query values are not recorded in the logbook. The CLI equivalents are `discern map --search <query>` and `discern help --search <query>`; put a region or page target after the verb to narrow either search.

`path` and `target` answer different location questions. `path` chooses which project or worktree a project-operating MCP call uses. `target` chooses a region or document inside that project's map.

## The `DiscernResult` envelope

| Field         | Presence      | Caller-visible meaning                                                                |
| ------------- | ------------- | ------------------------------------------------------------------------------------- |
| `ok`          | Always        | The verb's success verdict.                                                           |
| `verb`        | Always        | The command or verb that produced the result.                                         |
| `dry_run`     | Preview       | `true` when the call planned work without applying it.                                |
| `plan`        | Preview       | The titled plan, context details, and steps that would run.                           |
| `steps`       | Applied calls | The operations attempted, with their disposition and outcome.                         |
| `diagnostics` | Failures      | Structured failure details and the exact command that reproduces each failure.        |
| `data`        | Verb-specific | The payload defined by that verb, such as status state, update overlap, or a receipt. |
| `hints`       | Advisory      | Next actions and caveats; hints do not change `ok`.                                   |
| `error`       | Refusals      | A machine-readable error slug.                                                        |
| `message`     | Refusals      | The human-readable refusal.                                                           |

Undefined fields are omitted. Callers must branch first on `ok`, then on the literal `verb` when they need the verb-specific `data` payload.

### Plans and executed steps

| Field              | Meaning                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `kind`             | Operation category such as `job`, `git`, `refresh`, `standard`, or `resource-destroy`. |
| `label`            | Stable name for the command, scope, resource, or lifecycle operation.                  |
| `disposition`      | `run`, `skip`, or `gate` for a read-only precondition.                                 |
| `note` / `group`   | Optional explanation and display group.                                                |
| `outcome`          | `ok`, `failed`, or `skipped` on an executed step.                                      |
| `duration_s`       | Whole-second duration when measured.                                                   |
| `output_path`      | Best-effort path to the full combined output artifact.                                 |
| `output_lines`     | Number of captured output lines.                                                       |
| `error_like_lines` | Number of lines shaped like compiler or linter diagnostics.                            |

Output metadata is advisory. A configured command's exit status decides the job verdict, except for standards: their `DISCERN_METRIC` value is the measurement contract.

### Diagnostics

Every diagnostic includes `tool`, `severity`, `message`, and `reproduce_cmd`. It may also include normalized `output`, `truncated`, `output_path`, `file`, `line`, `col`, `rule`, and `fix_available`. Use `reproduce_cmd` for the smallest direct rerun; use `output_path` when the inline capture was truncated.

## MCP resources

| URI                                             | Payload                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| `discern://status`                              | Live status data.                              |
| `discern://impact`                              | Current scope-impact data.                     |
| `discern://config`                              | Resolved `discern.toml` data.                  |
| `discern://help` and `discern://help/{+target}` | The manual index or one manual page.           |
| `discern://map` and `discern://map/{+target}`   | The project-map index or one project-map page. |

`{+target}` accepts a slug, `section/slug`, or a path. Resource reads are computed when requested; clients that do not auto-attach resources can call the corresponding tool.

## CLI exit codes

| Status                       | Meaning                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `0`                          | The command completed successfully, or a predicate such as `config has` / `impact --has` was true.         |
| `1`                          | A controlled failure or refusal, a false predicate, or an enforcement threshold that was not met.          |
| Project Script's own code    | `discern script <name>` passes through the script's exit code because the script owns its result contract. |
| Signal status (`130`, `143`) | An in-flight gate interrupted by Ctrl-C or SIGTERM terminates with the conventional signal status.         |

For commands with a published JSON result, exit `0` corresponds to `ok: true`; a controlled non-zero result corresponds to `ok: false`. Raw-value commands such as `discern identity` and the `discern config get|array|has|subsections|keys` helpers do not publish a `DiscernResult` data contract.

## Published schemas and types

| Artifact                                                                            | Contract                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`schema/discern-results.schema.json`](../../../schema/discern-results.schema.json) | JSON Schema for CLI result envelopes and MCP tool-result wrappers.            |
| [`types/discern-json.d.ts`](../../../types/discern-json.d.ts)                       | Standalone TypeScript types indexed by verb, command path, and MCP tool name. |

The JSON Schema exposes top-level entry points for the complete contracts plus per-contract definitions. The TypeScript file exposes `DiscernResultByVerb`, `DiscernResultByCommand`, `DiscernMcpStructuredContentByTool`, and `DiscernMcpToolResultByTool` lookup maps.
