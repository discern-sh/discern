---
id: reference-results-and-mcp
title: "MCP and results"
description: "Find discern's agent tools and learn how to read their results, errors, and continuation instructions."
order: 130
publish: true
kind: reference
aliases:
  - "reference-results-and-mcp"
  - "Result formats and delivery"
  - "Markdown result"
  - "--markdown"
  - "--render"
  - "JSON result"
  - "structuredContent"
  - "MCP content"
  - "Model Context Protocol tools and result contracts"
  - "MCP"
  - "Model Context Protocol"
  - "DiscernResult"
  - "result envelope"
  - "exit codes"
  - "discern_status"
  - "discern_start"
  - "discern_done"
  - "discern_prepare"
  - "discern_test"
  - "discern_update"
  - "discern_await"
  - "discern_progress"
  - "discern_standards"
  - "discern_standards_propose"
  - "discern_accept"
  - "discern_impact"
  - "discern_coupling"
  - "discern_patterns"
  - "discern_refresh"
  - "discern_map"
  - "discern_docs"
  - "discern_doctor"
  - "discern_improvement"
  - "discern_checkpoints"
---

# MCP and results

Use this reference to understand what your agent can ask discern to do, which result confirms the outcome, and where your approval is required. It lists exact MCP inputs, result formats, schemas, exit codes, and continuation limits.

| Find                                           | Go to                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Choose Markdown, JSON, terminal, or MCP output | [Result formats and delivery](#result-formats-and-delivery)                                       |
| Tool names and accepted inputs                 | [Model Context Protocol tools](#model-context-protocol-tools)                                     |
| Read a success, failure, or partial result     | [The `DiscernResult` envelope](#the-discernresult-envelope)                                       |
| Interpret completion and landing evidence      | [Completion and landing results](#completion-and-landing-results)                                 |
| Resume a long-running watch                    | [Call duration and continuation](#call-duration-and-continuation)                                 |
| Resource URIs                                  | [Model Context Protocol resources](#model-context-protocol-resources)                             |
| Exit codes, schemas, or TypeScript types       | [CLI exit codes](#cli-exit-codes) and [Published schemas and types](#published-schemas-and-types) |

The gate is the project's final quality check. Proof records its evidence for one exact commit. The trunk is the project's shared branch. Checkpoints ask for judgment; grants record your permission to land changes.

Project-operating tools require a configured project. `discern_docs` can read the bundled manual without one. To connect an agent, follow [Connect a coding agent](../10-guides/connect-a-coding-agent.md).

## Result formats and delivery

Every result describes the same operation and verdict, whichever presentation you choose.

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

All surfaces preserve one completion verdict. `ok: true` means every required outcome declared for the verb holds. Optional degradation stays successful only as a typed `advisories[]` item with a kind, evidence, and next action. A required late failure remains false even when its steps or data show earlier effects, and MCP `isError` is the inverse of `structuredContent.ok`. Renderers select and arrange facts; they never reinterpret success ([ADR 0349](https://discern.sh/docs/decisions/0349-top-level-success-follows-completion-policies)).

`--markdown`, `--json`, and `--render` are mutually exclusive. All suppress surrounding terminal decoration and subprocess narration. The convenience-only `--render` passes authored Markdown through discern's terminal renderer. It never prompts or pages, follows width, theme, color, and character support, and redirects without control sequences. JSON and Markdown remain the primary result formats.

An authored Markdown presentation selects facts from the registered result contract. It does not dump every JSON field. When present, sections occur in this order: current state, bounded evidence, authority and boundaries, owner attention, other actions, then the next action. Owner attention contains decisions reserved for the owner. If several caller actions matter, secondary actions come first and the immediate next action closes the document. Whitespace-significant supporting payloads retain their exact content inside the evidence section, including leading and trailing spaces. These payloads include requested map or manual pages, setup instructions, diagnostic output, and terminal art.

`status` has an additional size boundary. Its default CLI JSON, MCP `structuredContent`, and live resource are bounded orientation projections with true omitted counts. `discern status --verbose --json` and `discern_status` with `verbose: true` select full structured status. Both default command surfaces advertise that route in `hints`; [Status and session hints](worktrees-and-status.md) defines the fields and caps.

Default doctor JSON and `discern_doctor` return environment and actionable checks without `data.execution_model`. Their hint names `discern doctor --verbose --json`; MCP accepts `verbose: true`. Human doctor uses `--verbose` for per-step hints.

`setup begin` emits the operating contract and first page; `setup step <n>` emits one page. Each shares its parsed operational spine across structured, human, and Markdown surfaces. `setup done` returns Proof, assurance, derived inventory, and one phase-valid action.

## Model Context Protocol tools and result contracts

Model Context Protocol (MCP) lets a coding agent call discern directly. The tools below use the same result contracts as the CLI. Use their structured fields for integrations and their Markdown for reading or relaying the outcome.

### Model Context Protocol tools

| Tool                        | Purpose                                                                                                                                                | Effect contract                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `discern_status`            | Report the current branch, gate inputs, standards, Proof, fleet state, unfinished setup assurance, and verified landing authority.                     | Read-only and idempotent.                                                                           |
| `discern_start`             | Create and set up a new isolated worktree, then report its prospective landing authority.                                                              | Mutating; each successful call creates a new worktree.                                              |
| `discern_done`              | Validate a completion candidate, collect required evidence, and return Proof when complete. `ci: true` reports checkpoint review without declarations. | Runs project commands; ordinary successful completion releases the checkout unless retained.        |
| `discern_prepare`           | Run the fix stage, `[generated]` regenerations, and checks for the fast inner loop.                                                                    | Runs project commands; fixers and regenerations may rewrite.                                        |
| `discern_test`              | Run the test stage on demand; `discern_done` includes it.                                                                                              | Runs project commands.                                                                              |
| `discern_update`            | Merge the selected base into this branch and re-materialize generated files.                                                                           | Mutating and idempotent for the same inputs.                                                        |
| `discern_await`             | Block until a sibling branch is green, its work lands, or the trunk moves, then report the next step.                                                  | Read-only and idempotent; timeouts return a normal result.                                          |
| `discern_progress`          | Read a long operation back after a lost call: its phase, the counts and failures known so far, and the retained result.                                | Read-only and idempotent; reading changes nothing.                                                  |
| `discern_standards`         | Measure standards, compare limits, and optionally pin improvements.                                                                                    | Runs project commands; pinning changes and commits config.                                          |
| `discern_standards_propose` | Record or preview one exact, commit-bound proposal for an intrinsically breached standard.                                                             | Mutating, closed-world, and idempotent; commits only the config limit.                              |
| `discern_accept`            | Land validated candidates with permission for each source; remove eligible released worktrees and resources.                                           | Ordinary landing requires consent or a verified grant; emergency requires fresh exact confirmation. |
| `discern_impact`            | List the scopes the current change activates.                                                                                                          | Read-only and idempotent.                                                                           |
| `discern_coupling`          | Report historical co-change partners for the current diff or named files.                                                                              | Read-only, idempotent, and advisory.                                                                |
| `discern_patterns`          | Report findings, investigation paths, or Stats from the active logbook or a selected sealed archive.                                                   | Read-only, idempotent, and advisory; lifecycle actions are CLI-only.                                |
| `discern_refresh`           | Rebuild generated Instructions, skills, integrations, and the ADR index, or return their complete preview.                                             | Mutating, closed-world, and idempotent; `dry_run: true` is read-only.                               |
| `discern_map`               | Index, search, or read the project's agent-maintained map.                                                                                             | Read-only and idempotent.                                                                           |
| `discern_docs`              | Index, search, or read discern's bundled public manual.                                                                                                | Read-only, idempotent, and project-independent.                                                     |
| `discern_doctor`            | Check config, commands, repository shape, and integration health.                                                                                      | Read-only and idempotent.                                                                           |
| `discern_improvement`       | Rank the next improvement and return the supporting health audit.                                                                                      | Read-only and idempotent.                                                                           |
| `discern_checkpoints`       | Report governing checkpoints, strict obligations, open-question declaration state, and structural evidence.                                            | Read-only and idempotent.                                                                           |

The input object is strict: undeclared keys are rejected. Optional keys by tool are:

| Tool                        | Accepted input keys                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern_status`            | `all`, `local`, `verbose`, `path`                                                                                                                                                                     |
| `discern_start`             | `name`, `title`, `brief`, `from`, `path`, `dry_run`                                                                                                                                                   |
| `discern_prepare`           | `path`                                                                                                                                                                                                |
| `discern_done`              | `dry_run`, `ci`, `rerun`, `met`, `unmet`, `path`, `standalone`, `recover`, `context`, `policy_base`, `retain_checkout`, `release_checkout`                                                            |
| `discern_update`            | `from`, `dry_run`, `path`                                                                                                                                                                             |
| `discern_await`             | `green`, `landed`, `trunk_moved`, `resume`, `timeout`, `path`                                                                                                                                         |
| `discern_progress`          | `handle`, `path`                                                                                                                                                                                      |
| `discern_accept`            | `action`, `target`, `order`, `expected`, `reconcile`, `prepare`, `preparation`, `met`, `reason`, `confirmation`, `recover`, `reclaim`, `dry_run`, `confirmed`, `variance`, `approve_standard`, `path` |
| `discern_test`              | `path`                                                                                                                                                                                                |
| `discern_standards`         | `dry_run`, `force`, `pin`, `names`, `path`                                                                                                                                                            |
| `discern_standards_propose` | `name`, `reason`, `dry_run`, `path`                                                                                                                                                                   |
| `discern_impact`            | `path`                                                                                                                                                                                                |
| `discern_coupling`          | `file`, `with`, `path`                                                                                                                                                                                |
| `discern_patterns`          | `stats`, `all`, `logbook_file`, `path`                                                                                                                                                                |
| `discern_checkpoints`       | `path`                                                                                                                                                                                                |
| `discern_refresh`           | `dry_run`, `path`                                                                                                                                                                                     |
| `discern_map`               | `target`, `search`, `path`                                                                                                                                                                            |
| `discern_docs`              | `target`, `search`                                                                                                                                                                                    |
| `discern_doctor`            | `verbose`, `path`                                                                                                                                                                                     |
| `discern_improvement`       | `category`, `min_score`, `path`                                                                                                                                                                       |

#### Completion options

For completion, `context` names the declared execution context supplied by the call and defaults to `local`. Every required context must supply applicable evidence before a candidate receives Proof. Ordinary completion requires a clean, committed tree. `standalone: true` provides transient diagnostics, including on dirty trees, without queue admission or Proof. `policy_base` accepts a fetched comparison ref only for a standalone CI report. `retain_checkout: true` keeps authoring control after completion; the default releases an eligible checkout for later validation and retirement. None of these options grants landing authority.

For checkout recovery, your agent calls `discern_done` with `recover` set to the owned environment id. The action returns the checkout and settles its reservation without validation or landing. Recovery cannot be combined with validation, release, policy, or judgment options.

After review, `release_checkout: true` releases a clean checkout covered by current Proof without rerunning producers. Stop active use first. Any later local work may require release again. For storage cleanup, `discern_accept` with `reclaim` set to an exact retirement id rechecks that retired effort's artifacts from a surviving checkout. Referenced, active, unknown, and incompatible recovery data remain preserved; reclamation grants no landing authority.

#### Acceptance options

Your agent omits `action`, `reconcile`, and `reclaim` for ordinary acceptance. The `target` selects a task by id, path, branch, or full local ref. The main checkout requires a target when several tasks are pending. Your agent continues with the same target. Consent covers only that unchanged source; predecessors require separate authority.

For individual queue decisions, your agent supplies `target` and an `action`: `hold`, `resume`, `withdraw`, or `revoke`. With `action: "reprioritize"`, `order` lists every eligible task, with source dependencies before their dependents. The agent previews either decision with `dry_run: true`. After you approve it, they pass `confirmed: true` and the returned `expected_state` token as `expected`. A changed plan requires another preview so the applied decision matches what you reviewed.

To reconcile an exact proven source already integrated externally, your agent previews with `reconcile: true`, `target`, and `dry_run: true`. They apply its `expected` token to reconcile matching queue state and eligible retirement. This neither advances refs nor creates a record of prior landing permission. Reconciliation stays separate from new approval.

#### Emergency integration

If checkpoint questions block emergency planning, your agent first supplies `action: "emergency"`, `prepare: true`, and the `reason`. Preparation runs checkpoint triggers and serves their questions without running validation jobs. The agent records satisfied served questions through `met`, an array of checkpoint ids, and receives a `preparation` receipt. That receipt goes into the later preview and confirmed call. Changed revisions or declarations require fresh preparation; an unmet question still blocks emergency integration. `dry_run: true` previews preparation without running triggers or recording answers. Preparation cannot be combined with confirmation or transition recovery.

For emergency integration, your agent calls `discern_accept` with `action: "emergency"` and a `reason`. You review the displayed trunk, repair revision, reason, and checks that failed, never ran, or have stale evidence before your agent supplies `confirmed` and the plan’s `confirmation` token. The token expires after 15 minutes; a changed plan needs fresh approval. The repair must include actual trunk and exclude other unlanded efforts. Checkpoint judgments and protected policy remain prerequisites. The exception has its own record type and cannot serve as passing Proof. This action does not push, deploy, or change external branch protections. `recover` resumes an interrupted emergency by landing id.

#### Choose a project or worktree

Every project-operating tool accepts an optional `path` that selects the discern project or worktree for that call. Pass an absolute filesystem path anywhere inside the intended checkout, including another repository in a multi-repo workspace. discern resolves the project root. Omit `path` to use the checkout the MCP server currently targets. Relative paths are rejected because the server's process directory is not the caller's directory. `discern_docs` needs no project. After a successful `discern_start`, later calls use the new worktree by default. After `discern_accept` removes that worktree, the server re-aims at the surviving main checkout.

Tools that require completed setup return a controlled `not_set_up` result until setup finishes. A tool rejects undeclared input keys instead of dropping them.

`discern_refresh` accepts `dry_run: true`. Its plan covers agent files, materialized skills, integrations, Proof note Git config, removals, and planning errors; preview has no `steps`. A normal call applies only those targets and reports `steps` ([ADR 0335](https://discern.sh/docs/decisions/0335-operation-policy-enrolls-faithful-previews)).

#### Startup discovery

MCP `tools/list` returns full definitions. Clients choose the startup context. discern's instructions stay under 2KB and lead with status, start, prepare, done, update/await, and accept; test remains on demand.

#### Call duration and continuation

| Caller or provider                 | Configured client/tool limit | `discern_await` call budget |
| ---------------------------------- | ---------------------------- | --------------------------- |
| Claude Code                        | 3,600 seconds                | 3,300 seconds               |
| Codex                              | 3,600 seconds                | 3,300 seconds               |
| Gemini                             | 3,600 seconds                | 3,300 seconds               |
| GitHub Copilot                     | 3,600 seconds                | 3,300 seconds               |
| Cursor's shortest verified surface | 60 seconds                   | 45 seconds                  |
| Unknown MCP client                 | Unknown                      | 45 seconds                  |
| CLI                                | No MCP client limit          | 3,300 seconds               |

Cursor's strict profile keeps `discern_await` below the Agent CLI's 60-second transport limit. Gate calls can take longer, so run `discern done --markdown` in a shell; use the corresponding `discern prepare --markdown` or `discern test --markdown` command when those stages are the intended operation.

The long profile reserves 300 seconds for delivery and cancellation. The strict profile reserves 15 seconds against Cursor's shortest verified surface. A watch returns immediately when its condition holds. When the budget expires first, the result is `ok: true`, `data.met: false`, and includes a 15-character `data.resume` handle. Continue with that handle; do not rebuild the watch from observed state. Handles are repository-local, expire after 7 days, and share a 512-record cap. CLI reports the not-yet result with exit `124`; MCP returns a normal tool result. `timeout` may shorten a call but cannot extend its selected profile.

#### Find a map or manual page

`discern_map` and `discern_docs` expose the same discovery funnel ([ADR 0174](https://discern.sh/docs/decisions/0174-agent-document-discovery-funnel)):

| Inputs                 | Result                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Neither                | The indexed documents; map also includes its top-level regions and file-linked freshness facts. |
| `target`               | One document's content, or a compact index when `target` names a top-level region.              |
| `search`               | Up to five ranked documents from the admitted corpus.                                           |
| `target` plus `search` | The same search limited to one exact region or document.                                        |

A search result carries `target`, `path`, `section`, `title`, `description`, `match`, an optional matching `heading`, and a contextual `snippet`. `match` is `complete`, `partial`, or `metadata`. The enclosing payload carries `query`, optional `scope`, the full match `count`, `truncated`, and the returned `results`. A zero-match search is `ok: true` with an empty result list. Scores remain an implementation detail.

Lexical matches with `match: "complete"` rank first. When fewer than five qualify, strong partial matches can fill the unused slots. Each must clear a query-length-scaled term-coverage floor. The ranker favors partials that add terms earlier results missed. Exact technical text and phrases in titles, aliases, headings, or code fields return phrase matches only. A longer lexical miss can fall back to a close title or alias. Queries shorter than four characters do not use edit-distance suggestions ([ADR 0183](https://discern.sh/docs/decisions/0183-agent-task-search-uses-an-audience-specific-ranker)).

Map search includes `publish: false`. Docs search covers the public manual. Both are local and omit queries from the logbook. Use `discern map --search <query>` or `discern docs --search <query>`, optionally after a target.

`path` and `target` answer different location questions. `path` chooses which project or worktree a project-operating MCP call uses. `target` chooses a region or document inside that project's map.

### The `DiscernResult` envelope

| Field         | Presence               | Caller-visible meaning                                                                                     |
| ------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ok`          | Always                 | Completion-policy success (`true`) or failure (`false`) discriminator.                                     |
| `verb`        | Always                 | Producing command.                                                                                         |
| `dry_run`     | Preview                | `true` for a preview.                                                                                      |
| `plan`        | Preview or review plan | Context and steps that would run. Never present with `steps`.                                              |
| `steps`       | Applied calls          | Attempted operations and outcomes. Never present with `plan` or `dry_run: true`.                           |
| `diagnostics` | Failures               | Failure details and reproduce command.                                                                     |
| `data`        | Verb-specific          | The verb's payload.                                                                                        |
| `advisories`  | Optional degradation   | Successful degradation records with a typed kind, evidence, and next action.                               |
| `hints`       | Advisory               | Notices, boundaries, owner attention, and next actions. Failures carry an action. Hints never change `ok`. |
| `error`       | Evaluated failures     | Stable classified-failure slug. Forbidden when `ok` is `true`.                                             |
| `message`     | Evaluated failures     | Explanatory failure or refusal.                                                                            |
| `waited_ms`   | Test-slot wait         | Milliseconds spent waiting for a configured concurrent-test slot.                                          |

`ok: true` means every required outcome in the producing verb's completion policy holds. Required writes, validation, compilation, cleanup, and final checks cannot fail under a successful envelope. An explicitly optional degradation remains successful only when `advisories[]` carries its permitted `kind`, non-empty `evidence`, and `next_action`. Hints do not waive required work ([ADR 0349](https://discern.sh/docs/decisions/0349-top-level-success-follows-completion-policies)).

`ok` and the execution state form independent discriminated contracts. A failed gate run can carry diagnostics and completed steps beside its classified error. A required late failure can carry typed partial-effect data and recovery because `ok: false` does not imply rollback. A refusal can carry a review `plan` without claiming `dry_run: true`. Serialization omits undefined fields. Branch on `ok`, then `verb`, before reading `data` ([ADR 0334](https://discern.sh/docs/decisions/0334-result-envelopes-encode-valid-structural-states)).

A failed JSON, Markdown, or MCP result always includes a registered next action. JSON and `structuredContent` carry it in `hints`; Markdown places it at the end of the presentation. Owner decisions occupy a separate Owner attention section before caller actions. When `message` or the first `diagnostics` entry explains the correction, the hint points there. When recovery depends on a choice or reported state, the hint names the relevant state and action. Consent, partial operations, incomplete setup, document lookup, and improvement thresholds use these specific instructions. A caller therefore does not have to infer whether to retry, review, choose, or complete cleanup ([ADR 0266](https://discern.sh/docs/decisions/0266-public-failure-recovery-is-classified-by-error-family)).

`setup begin` checks the required setup permission before applying its plan. Ordinary acceptance checks permission separately for each landing. A result awaiting consent can still describe earlier tasks that already landed, so read its per-task outcomes before retrying. The result names the decision and continuation command. Dry runs need no permission because they only show the plan.

Setup consent is not write authority. Effectful commands probe plan-derived targets before mutation; denial returns `write_access`, the exact path and retry, with phase unchanged. Read-only commands do not probe ([Setup command boundaries](../40-troubleshooting/setup-and-integrations.md)).

Setup pages carry owner-facing semantic prose once. Compact `spine.owner_moments` projections preserve identity, kind, phase, purpose, recommendation, option ids, wait boundary, and relay protection. Compatibility fields derive from the same enrolled moments, so terminal, Markdown, JSON, and Model Context Protocol (MCP) share one authority without duplicating prose.

`start`, `status`, and green `done` results may carry `data.landing_authority`: `authorized` or `conversation-required`, with source, scopes, uncovered-path evidence, and warnings. Compact status and done results bound uncovered paths to six authored-first examples beside uncovered totals and scopes; `start` grants are prospective. An absent fact stays absent. See [Landing authority](../20-understand/proof.md).

`status` identifies the project in `data.project`. Its default structured projection retains the main fleet row and at most six non-main rows, selected by attention, current-checkout, recent-activity, and lexical priority. Every repeated collection is capped at six. `fleet_total` and positive `projection.omitted` counts preserve exact omissions under dotted paths with zero-based array indexes. Config refusals carry `projection`. Every sampled readable row carries one `gate_proof`, whose status is `honored`, `report_only`, `missing`, `stale`, `dirty`, `unavailable`, or `read_failed`. `report_only` is current for its commit but cannot authorize landing because checkpoint review was not enforced. An honored marker carries a compact `proof` with branch, trunk, validated commit, diff counts, and line. Rendered Proof pages and the earlier honored-only compatibility fields do not cross the structured-result boundary. Collision rows retain identities and shared-path counts. `discern status --verbose --json` and MCP `verbose: true` restore complete repeated collections and landing history with `projection: { mode: "full" }` and no omission map; terminal `--verbose` also holds collision paths and full Proof pages. See [Status and session hints](worktrees-and-status.md) for the dashboard and projections.

#### Completion and landing results

Green means the required checks passed for the recorded commit; it does not mean the change landed. Later edits make Proof stale because the waiting code differs from what passed. Only you can approve an unmet checkpoint exception; a grant does not cover it.

For `done`, inspect `data.completion` as well as the top-level verdict:

| Field or value                          | Meaning                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `completion.kind: "complete"`           | Required candidate evidence is complete. Read the returned Proof and any landing decision.                                 |
| `completion.kind: "pending"`            | Evidence, judgment, environment readiness, or recovery remains unresolved.                                                 |
| `completion.kind: "diagnostic"`         | Standalone feedback; no queue admission or landing Proof.                                                                  |
| `completion.context`                    | Declared execution context supplied by this call.                                                                          |
| `completion.candidate_id`, `proof_id`   | Identities when available.                                                                                                 |
| `completion.pending`, `pending_reasons` | Structured conditions and explanations for unfinished completion.                                                          |
| `data.proof`                            | Compact Proof when completion produced it.                                                                                 |
| `data.gate_ran`                         | Whether gate work ran. `false` can indicate current-Proof reuse or a stop before gate work, such as a checkpoint question. |
| `data.producer_executions`              | Recorded execution counts by producer.                                                                                     |

Explicit CI reports use `data.mode: "report"` and report checkpoint review without answering questions. Their feedback does not provide landing Proof. `checkpoint_drops` preserves classified uncertainty about checkpoint enforcement.

Ordinary acceptance returns `data.queue`, with one row per queued task the call considered — the task the call was about always has a row, marked by `data.selected_effort`, and a preview also lists the tasks behind it with the single reason each waits. Inspect every row: a later pending task does not undo an earlier landing.

The Markdown and MCP presentations open with that task's verdict in one line (`Selected effort \`<branch>\`: landed`,`ready to land`,`not ready`,`not landed`, or`not validated`when the task has no row yet), followed by one sentence per condition and, for a landed task, what happened to its checkout. Other tasks follow under`Ahead of it in the queue`,`Behind it in the queue`, and`Other efforts in this call`, one sentence each. A dry run ends with`Read-only preview; nothing changed.`When the selected task did not land,`data.continuation` carries the command to run next.

| Queue-row field                            | Contract                                                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `effort`, `branch`, `source_head`          | Identify the authored source.                                                                                       |
| `candidate_id`, `expected_trunk`, `target` | Candidate and exact transition, or `null` when unavailable.                                                         |
| `state`                                    | `ready`, `pending`, or `landed`.                                                                                    |
| `relation`                                 | `selected`, `ahead`, `behind`, or `other`: the row's place relative to the task the call was about.                 |
| `pending`                                  | Conditions that still need attention.                                                                               |
| `consent`                                  | Permission source for the row, when available; `source` is `conversation`, `standing-grant`, or `effort-grant`.     |
| `authority_settlement`                     | `pending`, `consumed`, or `restored`, when recorded.                                                                |
| `note`                                     | `pending`, `published`, or `recovery`, when recorded.                                                               |
| `retirement`                               | `retained`, `retired`, or `recovery`.                                                                               |
| `retirement_reason`                        | Why a landed task's checkout stayed: `unreleased`, `active-use`, `moved-branch`, `dirty`, or `ownership-uncertain`. |
| `convergence`                              | `pending`, `passed`, or `failed`, when recorded for main-checkout convergence.                                      |
| `proof_line`                               | The row's consent-qualified Proof line, when available.                                                             |

`data.pending` carries outstanding conditions for the call. `data.root` names the surviving checkout, including after removal of the invoking worktree. A landed row may also carry `proof_note`, `variances`, `standard_approvals`, and retained checkpoint review or drops. The published schema defines every optional field.

When available, top-level `data.proof_line` is the final landing Proof line to relay. A single-row result may also expose `data.proof_note`. Older optional top-level fields, including `data.consent` and `data.landing`, remain in the schema; current ordinary acceptance uses the per-task queue account. See [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md#recover-an-interrupted-acceptance) for recovery.

#### Setup results

An unlanded successful `setup done` carries Proof, canonical completion inventory, qualitative `inventory.project_context`, and landing state. It carries no reactivation or improvement advice. Project context includes the derived primary-subsystem handoff, project principles, and instruction sources. After successful `setup accept`, registry-derived `data.reactivation` carries each provider's exact check, local recovery, and command-line fallback. `data.activation_context` explains why a fresh session is necessary. `data.optional_improvement` remains conditional on activation verification. An in-place completion already on the trunk projects the same ordered activation contract.

`setup done` failures distinguish unfinished authoring, uncommitted paths, and exact owned rollback. Transactions name `stage`, `rollback`, retained `state`, `next_action`, and `recovery`; nested diagnostics keep location, rule, and reproduce command.

Applied `setup` and `upgrade` results carry `data.instruction_refresh`. `status: "complete"` means the required instruction refresh completed, even when `compiled` is empty because every artifact was current. `status: "partial"` makes top-level `ok` false and carries the completed artifacts, non-empty failure evidence, `effects_preserved: true`, and `recovery: { command: "discern refresh", safe_to_retry: true }`. The partial result reports prior scaffold or migration effects rather than pretending they rolled back.

#### Plans and executed steps

| Field              | Meaning                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------- |
| `kind`             | Operation category such as `job`, `git`, `refresh`, `standard`, or `resource-destroy`.  |
| `label`            | Stable name for the command, scope, resource, or lifecycle operation.                   |
| `disposition`      | `run`, `skip`, or `gate` for a read-only precondition.                                  |
| `note` / `group`   | Optional explanation and display group.                                                 |
| `outcome`          | `ok`, `failed`, `skipped`, or `cancelled` on an executed step.                          |
| `advisory`         | Present on an explicitly optional failed step; carries kind, evidence, and next action. |
| `duration_s`       | Whole-second duration when measured.                                                    |
| `output_path`      | Best-effort path to the full combined output artifact.                                  |
| `output_lines`     | Number of captured output lines.                                                        |
| `error_like_lines` | Number of lines shaped like compiler or linter diagnostics.                             |

Output metadata is advisory. A configured command's exit status decides the job verdict, except for standards. Their `DISCERN_METRIC` value is the measurement contract.

Gate and standalone standards results carry each standard's `direction`, `limit`, optional `margin`, `measurement`, value, and verdict. A measured or replayed value also carries the gate-owned `pin_eligible` decision and, when true, its exact `pin_target`. Those fields describe mechanical eligibility. Patterns applies the project-history decision rule ([ADR 0276](https://discern.sh/docs/decisions/0276-patterns-recommendations-require-project-local-decision-evidence)).

Patterns results always carry `data.investigations`. Each entry cites source ids that remain present in `data.findings`, repeats their observations and denominators with numerical provenance, and states the shared evidence boundary, bounded interpretation, diagnostic action, and falsifier. An empty array means no registered relationship cleared its evidence requirements. Terminal, JSON, Model Context Protocol, and sealed-archive reads use the same synthesis arithmetic ([ADR 0277](https://discern.sh/docs/decisions/0277-patterns-investigations-preserve-source-findings)).

`cancelled` marks a fail-fast sibling and fails required completion. `skipped` marks a configured step that did not run. A policy can separately elect a user cancellation as successful no-effect completion.

#### Diagnostics

Every diagnostic includes `tool`, `severity`, `message`, and `reproduce_cmd`. It may also include normalized `output`, `truncated`, `output_path`, `file`, `line`, `col`, `rule`, and `fix_available`. Use `reproduce_cmd` for the smallest direct rerun; use `output_path` when the inline capture was truncated.

#### Closed result vocabularies

- Step `kind`: `job`, `scope-gate`, `merge-check`, `standards-limits-check`, `tracked-artifacts-check`, `instructions-check`, `skills-check`, `tracked-refresh-check`, `resource-create`, `resource-destroy`, `git`, `task-metadata`, `setup-step`, `repository-ensure`, `checkout-clean-check`, `setup-ensure`, `env`, `refresh`, `tidy`, `standard`.
- Step `disposition`: `run`, `skip`, `gate`.
- Step `outcome`: `ok`, `failed`, `skipped`, `cancelled`.
- Diagnostic `severity`: `error`, `warning`.
- `failed_stage`: `fix`, `build`, `check`, `test`, `check/test`, `scope_gates`, `tree_drift`, `generated_drift`, `refresh_drift`, `tracked_artifacts`, `instructions`, `skills`, `skill_frontmatter`, `adr_numbers`, `adr_index`, `map_integrity`, `merge`, `standards`, `write_access`.
- Advisory `kind`: `acceptance-cleanup-incomplete`, `checkpoint-evidence-dropped`, `checkout-clean-observation-unavailable`, `doctor-warning`, `execution-cap-unavailable`, `generated-attribute-pattern-untranslated`, `ignored-file-observation-unavailable`, `landing-authority-unverified`, `optional-resource-unavailable`, `proof-recording-unavailable`, `setup-unproven-completion`, `setup-machinery-commit-failed`, `setup-marker-commit-failed`, `standards-limits-unverified`, `uninstall-strip-incomplete`.

The registered `error` slugs are: `active_worktrees`, `ambiguous`, `apply_failed`, `awaiting_consent`, `awaiting_declaration`, `awaiting_standard_approval`, `awaiting_variance`, `below_min_score`, `brief_unparseable`, `checkout_failed`, `checkpoint_evidence_unavailable`, `config_template_unavailable`, `confirmation_required`, `conflict`, `desk_already_active`, `detached_head`, `diagrams_misaligned`, `dirty_worktree`, `edit_error`, `gate_failed`, `gitignore_template_unavailable`, `identity_error`, `incomplete`, `internal_error`, `invalid_arguments`, `invalid_config`, `invalid_config_file`, `invalid_migrated_config`, `invalid_settings_file`, `invalid_toml`, `invalid_value`, `no_docs`, `no_map`, `no_repository`, `no_such_step`, `no_target`, `not_found`, `not_initialized`, `not_main_checkout`, `not_on_setup_branch`, `not_on_trunk`, `not_set_up`, `partial_acceptance`, `partial_materialization`, `partial_refresh`, `pin_failed`, `precondition_failed`, `proposal_failed`, `proposal_stale`, `provisioned_resources`, `read_error`, `renamed_command`, `renamed_config_key`, `report_only_proof`, `schema_version_too_new`, `script_not_a_command`, `script_not_executable`, `setup_plan_failed`, `skills_eject_failed`, `tables_malformed`, `templates_not_found`, `tidy_parse_failed`, `tidy_write_failed`, `unchanged_tree_rerun`, `unknown_category`, `unknown_command`, `unknown_key`, `unknown_standard`, and `write_access`.

### Model Context Protocol resources

| URI                                             | Payload                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| `discern://status`                              | Live bounded status-orientation data.          |
| `discern://impact`                              | Current scope-impact data.                     |
| `discern://config`                              | Resolved `discern.toml` data.                  |
| `discern://docs` and `discern://docs/{+target}` | The manual index or one manual page.           |
| `discern://map` and `discern://map/{+target}`   | The project-map index or one project-map page. |

`{+target}` accepts a slug, `section/slug`, or a path. Resource reads are computed when requested; clients that do not auto-attach resources can call the corresponding tool.

### CLI exit codes

<!-- BEGIN GENERATED: CLI exit statuses -->

| Exit status         | Contract                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `0`                 | The command completed successfully. A bare predicate exits `0` when true.                                               |
| `1`                 | A controlled failure or refusal, a false bare predicate, or an unmet enforcement threshold.                             |
| `2`                 | The command grammar or arguments were invalid, including a bare quiet-result invocation.                                |
| `70`                | discern crashed on an unexpected internal error.                                                                        |
| `124`               | `discern await` reached its call budget before the watched condition held; its result includes the continuation handle. |
| `127`               | A child executable selected by an exec-style boundary could not be started.                                             |
| `129`               | An interrupted run preserved the conventional status derived from SIGHUP.                                               |
| `130`               | An interrupted run preserved the conventional status derived from SIGINT.                                               |
| `143`               | An interrupted run preserved the conventional status derived from SIGTERM.                                              |
| Child status        | `discern queue -- <command>` and `discern scripts <name>` preserve a started child's own exit status.                   |
| Other signal status | A platform-reported child signal preserves its conventional signal status when available.                               |

<!-- END GENERATED: CLI exit statuses -->

Quiet result modes map exit `0` to evaluated `ok: true` and controlled nonzero to evaluated `ok: false`; a verb's manually reported zero cannot override a failed completion contract. Predicates using `--json` or `--markdown` always exit `0`; their boolean is in `data`. Bare `config has` and `impact --has` stay silent, exiting `0` or `1`. `identity` and config reads are bare unless `--json` or `--markdown` requests a result.

### Published schemas and types

<!-- BEGIN GENERATED: public schema publications -->
<!-- This table is generated from the public-schema registry. -->

| Schema                       | Public `$id`                                                    | Repository artifact                                                                                                              | Contract                                                                                                                             | Same-major changes                                                                                                  |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `discern.toml` configuration | <https://discern.sh/schema/v1/discern-config.schema.json>       | [`schema/discern-config.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-config.schema.json)             | Every section, key, and value type the engine validates.                                                                             | Same-major releases may add only optional keys and sections.                                                        |
| Setup config document        | <https://discern.sh/schema/v1/discern-setup-config.schema.json> | [`schema/discern-setup-config.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-setup-config.schema.json) | The bounded setup recipe consumed only by `setup begin --config`.                                                                    | Same-major releases may add only optional keys and sections.                                                        |
| Result contracts             | <https://discern.sh/schema/v1/discern-results.schema.json>      | [`schema/discern-results.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-results.schema.json)           | Every CLI `--json` and MCP tool result envelope.                                                                                     | Same-major releases may add only optional fields, new contracts, and error slugs.                                   |
| Landing Proof note           | <https://discern.sh/schema/v1/discern-proof-note.schema.json>   | [`schema/discern-proof-note.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-proof-note.schema.json)     | The Proof envelope acceptance attaches to a landed commit, using the Dead Simple Signing Envelope (DSSE) field and payload boundary. | Same-major releases may add only optional fields, new contracts, and error slugs.                                   |
| MCP tools manifest           | <https://discern.sh/schema/v1/discern-mcp-tools.json>           | [`schema/discern-mcp-tools.json`](https://github.com/jackwh/discern/blob/main/schema/discern-mcp-tools.json)                     | Tool order, names, titles, descriptions, request schemas, and annotations.                                                           | Same-major releases may add tools or optional input properties; existing metadata and inputs remain compatible.     |
| CLI grammar manifest         | <https://discern.sh/schema/v1/discern-cli.json>                 | [`schema/discern-cli.json`](https://github.com/jackwh/discern/blob/main/schema/discern-cli.json)                                 | Command paths, aliases, positional arguments, flags, option value counts and types, defaults, and visibility.                        | Same-major releases may add commands, aliases, options, and positional arguments without changing existing grammar. |
| Conventions manifest         | <https://discern.sh/schema/v1/discern-conventions.json>         | [`schema/discern-conventions.json`](https://github.com/jackwh/discern/blob/main/schema/discern-conventions.json)                 | Frozen environment, skill, Git, checkpoint, identity, provider, hook, and local-format names.                                        | Same-major releases may add names; every published existing value is immutable.                                     |

<!-- END GENERATED: public schema publications -->

`types/discern-json.d.ts` in the matching release source archive provides release-pinned standalone TypeScript types indexed by verb, command path, and MCP tool name. Each per-verb type intersects with `DiscernResultState`, so narrowing `ok` also narrows `error`, and planned and completed steps cannot coexist. The result schema's `x-discern-contracts` metadata publishes each registered verb's `completion_policy`, including `required_postconditions`, `optional_advisories`, refusal, cancellation, partial-effect, no-op, and recovery-owner policy.

#### Compatibility by schema version

A package release can retain the same public schema `$id`. Breaking changes require a new schema major, with the earlier major still published. Within a major, use the additions permitted by each contract in the table above; consumers should tolerate optional result fields and newly introduced error slugs.

Runtime validation remains strict. Unknown or malformed configuration keys fail even though later releases may introduce new optional keys. The published configuration schema is an authoring snapshot: refresh a cached copy before validating configuration from a newer release. The bounded setup recipe also rejects an unsupported declared major.

The v1 result contract separates success, failure, previews, and applied effects. For example, `data.instruction_refresh.status: "partial"` means a required refresh failed even when earlier setup or upgrade effects remain. A successful `setup accept` with nothing to land carries `data.completion = { status: "no_op", reason }`; `reason` distinguishes `no_git_repository` from `already_on_target`.

Schemas use JSON Schema Draft 2020-12. The release source contains `types/discern-json.d.ts`, and the result schema publishes `x-discern-contracts` metadata for each verb's completion requirements and permitted advisories. Use these artifacts from the release you integrate with.

For the rules used to publish and compare schema versions, see [Runtime data boundaries](https://discern.sh/map/development/runtime-data-boundaries). The compatibility checks cover required fields, defaults, types, reference paths, and contract unions; those publication details do not change how callers interpret a result.
