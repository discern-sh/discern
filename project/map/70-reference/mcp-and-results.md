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
  - discern_await
  - discern_standards
  - discern_accept
  - discern_impact
  - discern_coupling
  - discern_patterns
  - discern_refresh
  - discern_map
  - discern_docs
  - discern_doctor
  - discern_improvement
---

# Model Context Protocol tools and result contracts

_Model Context Protocol (MCP) tools and `discern <command> --json` share one caller-visible result contract. The command-line interface (CLI) adds exit statuses around it._

## Choose a result surface

| Surface           | Result                                                                     |
| ----------------- | -------------------------------------------------------------------------- |
| Human CLI         | Terminal rendering.                                                        |
| CLI with `--json` | One `DiscernResult` on stdout.                                             |
| MCP tool          | The envelope in `content` and `structuredContent`; `isError` mirrors `ok`. |
| MCP resource      | Live payload or Markdown, without an envelope.                             |

Human, JSON, and MCP tool forms share one result. `structuredContent` is machine-readable; `content[0].text` is its JSON text.

## Model Context Protocol tools

| Tool                  | Purpose                                                                                                  | Effect contract                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `discern_status`      | Report the current branch, Gate inputs, Standards, Receipt, fleet state, and verified landing authority. | Read-only and idempotent.                                       |
| `discern_start`       | Create and set up a new isolated worktree, then report its prospective landing authority.                | Mutating; each successful call creates a new worktree.          |
| `discern_done`        | Run the full Gate and return steps, diagnostics, an optional Receipt, and verified landing authority.    | Runs project commands; fix-stage commands may rewrite.          |
| `discern_prepare`     | Run the fix stage, `[generated]` regenerations, and checks for the fast inner loop.                      | Runs project commands; fixers and regenerations may rewrite.    |
| `discern_test`        | Run the configured test job on its own.                                                                  | Runs a project command.                                         |
| `discern_update`      | Merge the selected base into this branch and re-materialize generated files.                             | Mutating and idempotent for the same inputs.                    |
| `discern_await`       | Block until a sibling branch is green, its work lands, or the trunk moves, then report the next step.    | Read-only and idempotent; timeouts return a normal result.      |
| `discern_standards`   | Measure Standards, compare limits, and optionally pin improvements.                                      | Runs project commands; pinning changes and commits config.      |
| `discern_accept`      | Land an authorized worktree and tear down its resources and branch.                                      | Destructive; requires conversation consent or a verified grant. |
| `discern_impact`      | List the scopes the current change activates.                                                            | Read-only and idempotent.                                       |
| `discern_coupling`    | Report historical co-change partners for the current diff or named files.                                | Read-only, idempotent, and advisory.                            |
| `discern_patterns`    | Report findings from the local Logbook of discern's own verb runs.                                       | Read-only, idempotent, and advisory.                            |
| `discern_refresh`     | Rebuild generated Guidance, Skills, integrations, and the ADR index.                                     | Mutating, closed-world, and idempotent.                         |
| `discern_map`         | Index, search, or read the project's agent-maintained Map.                                               | Read-only and idempotent.                                       |
| `discern_docs`        | Index, search, or read discern's bundled public manual.                                                  | Read-only, idempotent, and project-independent.                 |
| `discern_doctor`      | Check config, commands, repository shape, and integration health.                                        | Read-only and idempotent.                                       |
| `discern_improvement` | Rank the next improvement and return the supporting health audit.                                        | Read-only and idempotent.                                       |

Every project-operating tool accepts an optional `path` that selects the discern project or worktree for that call. Pass an absolute filesystem path anywhere inside the intended checkout, including another repository in a multi-repo workspace. discern resolves the project root. Omit `path` to use the checkout the MCP server currently targets. Relative paths are rejected because the server's process directory is not the caller's directory. `discern_docs` needs no project. After a successful `discern_start`, later calls use the new worktree by default. After `discern_accept` removes that worktree, the server re-aims at the surviving main checkout.

Tools that require completed setup return a controlled `not_set_up` result until setup finishes. A tool rejects undeclared input keys instead of dropping them.

### Startup discovery

MCP `tools/list` returns full definitions. Clients choose the startup context. discern's instructions stay under 2KB and lead with status, start, prepare/test, done, update/await, and accept.

### Find a map or manual page

`discern_map` and `discern_docs` expose the same discovery funnel ([ADR 0174](../_adr/0174-agent-document-discovery-funnel.md)):

| Inputs                 | Result                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Neither                | The indexed documents; Map also includes its top-level regions and file-linked freshness facts. |
| `target`               | One document's content, or a compact index when `target` names a top-level region.              |
| `search`               | Up to five ranked documents from the admitted corpus.                                           |
| `target` plus `search` | The same search limited to one exact region or document.                                        |

A search result carries `target`, `path`, `section`, `title`, `description`, `match`, an optional matching `heading`, and a contextual `snippet`. `match` is `complete`, `partial`, or `metadata`. The enclosing payload carries `query`, optional `scope`, the full match `count`, `truncated`, and the returned `results`. A zero-match search is `ok: true` with an empty result list. Scores remain an implementation detail.

Lexical matches with `match: "complete"` rank first. When fewer than five qualify, strong partial matches can fill the unused slots. Each must clear a query-length-scaled term-coverage floor. The ranker favors partials that add terms earlier results missed. Exact technical text and phrases in titles, aliases, headings, or code fields return phrase matches only. A longer lexical miss can fall back to a close title or alias. Queries shorter than four characters do not use edit-distance suggestions ([ADR 0183](../_adr/0183-agent-task-search-uses-an-audience-specific-ranker.md)).

Map search includes `publish: false`. Docs search covers the public manual. Both are local and omit queries from the Logbook. Use `discern map --search <query>` or `discern docs --search <query>`, optionally after a target.

`path` and `target` answer different location questions. `path` chooses which project or worktree a project-operating MCP call uses. `target` chooses a region or document inside that project's map.

## The `DiscernResult` envelope

| Field         | Presence      | Caller-visible meaning                                                             |
| ------------- | ------------- | ---------------------------------------------------------------------------------- |
| `ok`          | Always        | Success verdict.                                                                   |
| `verb`        | Always        | Producing command.                                                                 |
| `dry_run`     | Preview       | `true` for a preview.                                                              |
| `plan`        | Preview       | Context and steps that would run.                                                  |
| `steps`       | Applied calls | Attempted operations and outcomes.                                                 |
| `diagnostics` | Failures      | Failure details and reproduce command.                                             |
| `data`        | Verb-specific | The verb's payload.                                                                |
| `hints`       | Advisory      | Next actions for the current surface. Failures carry one. Hints never change `ok`. |
| `error`       | Refusals      | Machine-readable slug.                                                             |
| `message`     | Refusals      | Human-readable refusal.                                                            |

Undefined fields are omitted. Branch on `ok`, then `verb`, before reading `data`.

`start`, `status`, and green `done` results may carry `data.landing_authority`: `authorized` or `conversation-required`, with source, scopes, uncovered paths, and warnings. `start` grants are prospective. An absent fact stays absent. See [Landing authority](../30-worktrees/landing-authority.md).

`status` identifies the project in `data.project`. Every readable non-main `data.fleet` row carries `gate_receipt`, whose status is `honored`, `missing`, `stale`, `dirty`, `unavailable`, or `read_failed`. Honored rows retain the earlier `receipt_honored`, `receipt`, and `receipt_line` fields. When Git can read the latest landed Receipt's subject, `data.landed_receipt.commit_at` carries its committer timestamp. See [Status and session hints](../30-worktrees/status.md) for the human dashboard and structured result projections.

A successful `accept` reports the evidence it used in `data.consent`: `source` is `conversation`, `standing-grant`, or `effort-grant`, and `scopes` is present for standing-grant coverage. Its `data.receipt_line` derives from the validated Receipt line and appends that consent evidence.

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

Output metadata is advisory. A configured command's exit status decides the job verdict, except for Standards. Their `DISCERN_METRIC` value is the measurement contract.

`cancelled` marks a fail-fast sibling; `skipped` marks a configured step that did not run.

### Diagnostics

Every diagnostic includes `tool`, `severity`, `message`, and `reproduce_cmd`. It may also include normalized `output`, `truncated`, `output_path`, `file`, `line`, `col`, `rule`, and `fix_available`. Use `reproduce_cmd` for the smallest direct rerun; use `output_path` when the inline capture was truncated.

## Model Context Protocol resources

| URI                                             | Payload                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| `discern://status`                              | Live status data.                              |
| `discern://impact`                              | Current scope-impact data.                     |
| `discern://config`                              | Resolved `discern.toml` data.                  |
| `discern://docs` and `discern://docs/{+target}` | The manual index or one manual page.           |
| `discern://map` and `discern://map/{+target}`   | The project-map index or one project-map page. |

`{+target}` accepts a slug, `section/slug`, or a path. Resource reads are computed when requested; clients that do not auto-attach resources can call the corresponding tool.

## CLI exit codes

| Status                       | Meaning                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `0`                          | The command completed successfully, or a bare predicate such as `config has` / `impact --has` was true.      |
| `1`                          | A controlled failure or refusal, a false bare predicate, or an enforcement threshold that was not met.       |
| `70`                         | discern itself crashed on an unexpected error. See [crash reports](crash-reports.md) for the local evidence. |
| Project Script's own code    | `discern scripts <name>` passes through the script's exit code because the script owns its result contract.  |
| Signal status (`130`, `143`) | An in-flight gate interrupted by Ctrl-C or SIGTERM terminates with the conventional signal status.           |

Published JSON maps exit `0` to `ok: true` and controlled nonzero to `ok: false`. JSON predicates always exit `0`; their boolean is in `data`. Bare `config has` and `impact --has` stay silent, exiting `0` or `1`. `identity` and config reads are bare unless `--json` requests envelopes.

## Published schemas and types

<!-- BEGIN GENERATED: public schema publications -->
<!-- Generated by `deno task codegen` from `PUBLIC_SCHEMA_PUBLICATIONS`. -->

| Schema                       | Public `$id`                                                    | Repository artifact                                                                           | Contract                                                                                                                             | Same-major changes                                                                |
| ---------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `discern.toml` configuration | <https://discern.sh/schema/v1/discern-config.schema.json>       | [`schema/discern-config.schema.json`](../../../schema/discern-config.schema.json)             | Every section, key, and value type the engine validates.                                                                             | Same-major releases may add only optional keys and sections.                      |
| Setup config document        | <https://discern.sh/schema/v1/discern-setup-config.schema.json> | [`schema/discern-setup-config.schema.json`](../../../schema/discern-setup-config.schema.json) | The install document consumed by `setup --config` and presets.                                                                       | Same-major releases may add only optional keys and sections.                      |
| Result contracts             | <https://discern.sh/schema/v1/discern-results.schema.json>      | [`schema/discern-results.schema.json`](../../../schema/discern-results.schema.json)           | Every CLI `--json` and MCP tool result envelope.                                                                                     | Same-major releases may add only optional fields, new contracts, and error slugs. |
| Landing proof note           | <https://discern.sh/schema/v1/discern-proof-note.schema.json>   | [`schema/discern-proof-note.schema.json`](../../../schema/discern-proof-note.schema.json)     | The proof envelope acceptance attaches to a landed commit, using the Dead Simple Signing Envelope (DSSE) field and payload boundary. | Same-major releases may add only optional fields, new contracts, and error slugs. |

<!-- END GENERATED: public schema publications -->

[`types/discern-json.d.ts`](../../../types/discern-json.d.ts) provides standalone TypeScript types indexed by verb, command path, and MCP tool name.

### Compatibility by schema version

Package releases do not change public schema `$id`s; breaks require a new major. Runtime result schemas stay strict. Their published schema remains open to optional fields and unknown `error` slugs.

The append-only compatibility promise begins at the first release tag. Before that tag, a publication may still be corrected. Afterward, every registered path and identity remains covered on the trunk. Every generated artifact and trunk baseline must compile as JSON Schema Draft 2020-12. The artifact records its compatibility policy, and same-major comparisons use the policy from the trunk artifact. A breaking major adds a publication, artifact, and route while retaining the earlier major.

The comparison permits the table's additions, reordered contract unions, and the first MCP exposure of an existing CLI contract. In config schemas, a new named property must accept every value admitted for that name by the trunk object's `additionalProperties` schema. Its named schema may add members to the catchall's `type` set; `oneOf` stays under structural comparison. Tuple schemas compare `prefixItems` by position.

A result-role aggregate may widen only when its definition contains `oneOf` and annotation keywords, and the trunk exposes 1 acyclic same-instance route to it from the top-level branches. A recognized aggregate cannot add named properties. The route must be a pure top-level `$ref` to the aggregate. Constrained references and applicators such as `allOf` or `dependentSchemas` count as routes but cannot grant widening authority. Repeated references and wrapper branches count separately. An ambiguous aggregate and a nested union stay closed.

The same rule permits a role's first aggregate when the trunk has no registry references for that role, every current role reference introduces a definition, 1 new aggregate contains only `oneOf` and annotation keywords with the full current reference set, and 1 pure top-level entrypoint is its sole route. The comparison rejects policy drift, arbitrary metadata that tries to authorize a union change, removals, and changes to existing types, required result fields, or validation ([ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md)).

The config schema is a closed snapshot. Refresh a cached copy before validating newer optional keys.
