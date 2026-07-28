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

| Surface           | Result                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| Human CLI         | Terminal rendering.                                                        |
| CLI with `--json` | One `DiscernResult` on stdout.                                             |
| MCP tool          | The envelope in `content` and `structuredContent`; `isError` mirrors `ok`. |
| MCP resource      | Live payload or Markdown, without an envelope.                             |

Human, JSON, and MCP tool forms share one result. `structuredContent` is machine-readable; `content[0].text` is its JSON text.

## MCP tools

| Tool                  | Purpose                                                                                                  | Effect contract                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `discern_status`      | Report the current branch, gate inputs, standards, receipt, fleet state, and verified landing authority. | Read-only and idempotent.                                       |
| `discern_start`       | Create and set up a new isolated worktree, then report its prospective landing authority.                | Mutating; each successful call creates a new worktree.          |
| `discern_done`        | Run the full gate and return steps, diagnostics, an optional receipt, and verified landing authority.    | Runs project commands; fix-stage commands may rewrite.          |
| `discern_prepare`     | Run the fix and check stages for the fast inner loop.                                                    | Runs project commands; fix-stage commands may rewrite.          |
| `discern_test`        | Run the configured test job on its own.                                                                  | Runs a project command.                                         |
| `discern_update`      | Merge the selected base into this branch and re-materialize generated files.                             | Mutating and idempotent for the same inputs.                    |
| `discern_standards`   | Measure standards, compare limits, and optionally pin improvements.                                      | Runs project commands; pinning changes and commits config.      |
| `discern_accept`      | Land an authorized worktree and tear down its resources and branch.                                      | Destructive; requires conversation consent or a verified grant. |
| `discern_impact`      | List the scopes the current change activates.                                                            | Read-only and idempotent.                                       |
| `discern_coupling`    | Report historical co-change partners for the current diff or named files.                                | Read-only, idempotent, and advisory.                            |
| `discern_patterns`    | Report findings from the local logbook of discern's own verb runs.                                       | Read-only, idempotent, and advisory.                            |
| `discern_refresh`     | Rebuild generated guidance, skills, integrations, and the ADR index.                                     | Mutating, closed-world, and idempotent.                         |
| `discern_map`         | Index, search, or read the project's agent-maintained map.                                               | Read-only and idempotent.                                       |
| `discern_help`        | Index, search, or read discern's bundled public manual.                                                  | Read-only, idempotent, and project-independent.                 |
| `discern_doctor`      | Check config, commands, repository shape, and integration health.                                        | Read-only and idempotent.                                       |
| `discern_improvement` | Rank the next improvement and return the supporting health audit.                                        | Read-only and idempotent.                                       |

Every project-operating tool accepts an optional `path` that selects the discern project or worktree for that call. Pass an absolute filesystem path anywhere inside the intended checkout, including another repository in a multi-repo workspace; discern resolves the project root. Omit it to use the checkout the MCP server currently targets. Relative paths are rejected because the server's process directory is not the caller's directory. `discern_help` needs no project. After a successful `discern_start`, later calls use the new worktree by default; after `discern_accept` removes that worktree, the server re-aims at the surviving main checkout.

Tools that require completed setup return a controlled `not_set_up` result until setup finishes. A tool rejects undeclared input keys instead of dropping them.

### Find a map or help page

`discern_map` and `discern_help` expose the same discovery funnel ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)):

| Inputs                 | Result                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Neither                | The admitted document index; map also includes its top-level regions and file-linked freshness facts. |
| `target`               | One document's content, or a compact index when `target` names a top-level region.                    |
| `search`               | Up to five ranked documents from the admitted corpus.                                                 |
| `target` plus `search` | The same search limited to one exact region or document.                                              |

A search result carries `target`, `path`, `section`, `title`, `description`, `match`, an optional matching `heading`, and a contextual `snippet`. `match` is `complete`, `partial`, or `metadata`. The enclosing payload carries `query`, optional `scope`, the full match `count`, `truncated`, and the returned `results`. A zero-match search is `ok: true` with an empty result list. Scores remain an implementation detail.

Complete lexical matches lead. When fewer than 5 qualify, strong partial matches can fill the unused slots. Each must clear a query-length-scaled term-coverage floor. The ranker favors partials that add terms earlier results missed. Exact technical text and exact phrases in titles, aliases, headings, or code fields return phrase matches only. A longer lexical miss can fall back to a close title or alias. Queries shorter than 4 characters do not use edit-distance suggestions ([ADR 0183](../_adr/0183-agent-task-search-uses-an-audience-specific-ranker.md)).

Map search covers every page visible to the agent-facing map, including a page marked `publish: false`. Help search covers the bundled public manual. Both run locally, and query values are not recorded in the logbook. The CLI equivalents are `discern map --search <query>` and `discern help --search <query>`; put a region or page target after the verb to narrow either search.

`path` and `target` answer different location questions. `path` chooses which project or worktree a project-operating MCP call uses. `target` chooses a region or document inside that project's map.

## The `DiscernResult` envelope

| Field         | Presence      | Caller-visible meaning                                |
| ------------- | ------------- | ----------------------------------------------------- |
| `ok`          | Always        | Success verdict.                                      |
| `verb`        | Always        | Producing command.                                    |
| `dry_run`     | Preview       | `true` for a preview.                                 |
| `plan`        | Preview       | Context and steps that would run.                     |
| `steps`       | Applied calls | Attempted operations and outcomes.                    |
| `diagnostics` | Failures      | Failure details and reproduce command.                |
| `data`        | Verb-specific | The verb's payload.                                   |
| `hints`       | Advisory      | Next actions; failures carry one; never changes `ok`. |
| `error`       | Refusals      | Machine-readable slug.                                |
| `message`     | Refusals      | Human-readable refusal.                               |

Undefined fields are omitted. Branch on `ok`, then `verb`, before reading `data`.

`start`, `status`, and green `done` results may carry `data.landing_authority`: `authorized` or `conversation-required`, with source, scopes, uncovered paths, and warnings. `start` grants are prospective; an absent fact stays absent. See [Landing authority](../30-worktrees/landing-authority.md).

A successful `accept` reports the evidence it used in `data.consent`: `source` is `conversation`, `standing-grant`, or `effort-grant`, and `scopes` is present for standing-grant coverage. Its `data.receipt_line` derives from the validated gate-receipt line and appends that consent evidence.

### Plans and executed steps

| Field              | Meaning                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `kind`             | Operation category such as `job`, `git`, `refresh`, `standard`, or `resource-destroy`. |
| `label`            | Stable name for the command, scope, resource, or lifecycle operation.                  |
| `disposition`      | `run`, `skip`, or `gate` for a read-only precondition.                                 |
| `note` / `group`   | Optional explanation and display group.                                                |
| `outcome`          | `ok`, `failed`, `skipped`, or `cancelled` on an executed step.                         |
| `duration_s`       | Whole-second duration when measured.                                                   |
| `output_path`      | Best-effort path to the full combined output artifact.                                 |
| `output_lines`     | Number of captured output lines.                                                       |
| `error_like_lines` | Number of lines shaped like compiler or linter diagnostics.                            |

Output metadata is advisory. A configured command's exit status decides the job verdict, except for standards: their `DISCERN_METRIC` value is the measurement contract.

`cancelled` marks a fail-fast sibling; `skipped` marks a configured step that did not run.

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

For a published JSON result, exit `0` means `ok: true`; a controlled non-zero result means `ok: false`. `identity` and config read helpers stay bare without `--json` and emit published envelopes with it.

## Published schemas and types

<!-- BEGIN GENERATED: public schema publications -->
<!-- Generated by `deno task codegen` from `PUBLIC_SCHEMA_PUBLICATIONS`. -->

| Schema                       | Public `$id`                                               | Repository artifact                                                                 | Contract                                             |
| ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `discern.toml` configuration | <https://discern.sh/schema/v1/discern-config.schema.json>  | [`schema/discern-config.schema.json`](../../../schema/discern-config.schema.json)   | Configuration file structure, keys, and value types. |
| CLI and MCP results          | <https://discern.sh/schema/v1/discern-results.schema.json> | [`schema/discern-results.schema.json`](../../../schema/discern-results.schema.json) | CLI result envelopes and MCP tool-result wrappers.   |

<!-- END GENERATED: public schema publications -->

[`types/discern-json.d.ts`](../../../types/discern-json.d.ts) provides standalone TypeScript types indexed by verb, command path, and MCP tool name.

### Version 1 compatibility

The result schema [`$id`](https://discern.sh/schema/v1/discern-results.schema.json) advances its major when the contract breaks. Discern package releases do not advance it. In version 1, fields keep their type and meaning; optional fields may be added. Consumers ignore unknown object fields and handle unknown `error` slugs. Removing or renaming fields or slugs, or changing a field's type or meaning, needs a new major.

Runtime schemas and `ERROR_SLUGS` stay strict. The public schema accepts unknown fields, treats `error` as a string, and lists known slugs in `x-discern-error-slugs`, so pinned version-1 schemas accept additions. There is no top-level `schema_version`: the URL owns identity, and a payload field would duplicate it ([ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md)).

The configuration schema shares the version-1 identity but validates the current closed input surface. A newer release may add optional keys without changing existing configuration; an older cached schema can reject those new keys, so refresh it when validating configuration written for a newer discern release.
