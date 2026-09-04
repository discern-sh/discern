---
id: reference-results-and-mcp
title: "MCP and results"
description: "Look up MCP tools/resources, DiscernResult, JSON/Markdown delivery, schemas, versions, exits, and continuation/duration policy."
order: 40
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

Look up MCP tools/resources, DiscernResult, JSON/Markdown delivery, schemas, versions, exits, and continuation/duration policy.

Prerequisite: the command, tool, resource URI, result field, or schema id you need to look up. A configured project is required for project-operating tools; `discern_docs` is project-independent.

## Result formats and delivery

_One policy-evaluated `DiscernResult` can be presented in the terminal, as authored Markdown, as compact JSON, or through MCP._

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

`--markdown`, `--json`, and `--render` are mutually exclusive. All suppress surrounding terminal decoration and subprocess narration; `--md` is not an alias. The convenience-only `--render` passes authored Markdown through discern's terminal renderer. It never prompts or pages, follows width, theme, color, and character support, and redirects without control sequences. JSON and Markdown remain the primary result formats.

An authored Markdown presentation selects facts from the registered result contract. It does not dump every JSON field. When present, sections occur in this order: current state, bounded evidence, authority and boundaries, owner attention, other actions, then the next action. Owner attention contains decisions reserved for the owner. If several caller actions matter, secondary actions come first and the immediate next action closes the document. Whitespace-significant supporting payloads retain their exact content inside the evidence section, including leading and trailing spaces. These payloads include requested map or manual pages, setup instructions, diagnostic output, and terminal art.

`status` has an additional size boundary. Its default CLI JSON, MCP `structuredContent`, and live resource are bounded orientation projections with true omitted counts. `discern status --verbose --json` and `discern_status` with `verbose: true` select full structured status. Both default command surfaces advertise that route in `hints`; [Status and session hints](worktrees-and-status.md) defines the fields and caps.

Default doctor JSON and `discern_doctor` return environment and actionable checks without `data.execution_model`. Their hint names `discern doctor --verbose --json`; MCP accepts `verbose: true`. Human doctor uses `--verbose` for per-step hints.

`setup begin` emits the operating contract and first page; `setup step <n>` emits one page. Each shares its parsed operational spine across structured, human, and Markdown surfaces. `setup done` returns Proof, assurance, derived inventory, and one phase-valid action.

See [MCP tools and result contracts](mcp-and-results.md) for the tool registry, envelope fields, schemas, resources, and exit codes.

## Model Context Protocol tools and result contracts

_Model Context Protocol (MCP) tools and quiet CLI results share one prepared `DiscernResult`. Structured and Markdown projections support different modes of consumption without changing the underlying verdict._

Choose among terminal, Markdown, JSON, and MCP delivery through [Result formats and delivery](mcp-and-results.md). Each projects the same prepared result in a different form; none is reserved for a particular reader.

### Model Context Protocol tools

| Tool                        | Purpose                                                                                                                                                                   | Effect contract                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `discern_status`            | Report the current branch, Gate inputs, Standards, Proof, fleet state, unfinished setup assurance, and verified landing authority.                                        | Read-only and idempotent.                                              |
| `discern_start`             | Create and set up a new isolated worktree, then report its prospective landing authority.                                                                                 | Mutating; each successful call creates a new worktree.                 |
| `discern_done`              | Run the full Gate and return steps, diagnostics, an optional Proof, and verified landing authority. `ci: true` explicitly reports checkpoint review without declarations. | Runs project commands; fix-stage commands may rewrite.                 |
| `discern_prepare`           | Run the fix stage, `[generated]` regenerations, and checks for the fast inner loop.                                                                                       | Runs project commands; fixers and regenerations may rewrite.           |
| `discern_test`              | Run the test stage on demand; `discern_done` includes it.                                                                                                                 | Runs project commands.                                                 |
| `discern_update`            | Merge the selected base into this branch and re-materialize generated files.                                                                                              | Mutating and idempotent for the same inputs.                           |
| `discern_await`             | Block until a sibling branch is green, its work lands, or the trunk moves, then report the next step.                                                                     | Read-only and idempotent; timeouts return a normal result.             |
| `discern_standards`         | Measure Standards, compare limits, and optionally pin improvements.                                                                                                       | Runs project commands; pinning changes and commits config.             |
| `discern_standards_propose` | Record or preview one exact, commit-bound proposal for an intrinsically breached Standard.                                                                                | Mutating, closed-world, and idempotent; commits only the config limit. |
| `discern_accept`            | Land an authorized worktree and tear down its resources and branch.                                                                                                       | Destructive; requires conversation consent or a verified grant.        |
| `discern_impact`            | List the scopes the current change activates.                                                                                                                             | Read-only and idempotent.                                              |
| `discern_coupling`          | Report historical co-change partners for the current diff or named files.                                                                                                 | Read-only, idempotent, and advisory.                                   |
| `discern_patterns`          | Report findings, investigation paths, or Stats from the active Logbook or a selected sealed archive.                                                                      | Read-only, idempotent, and advisory; lifecycle actions are CLI-only.   |
| `discern_refresh`           | Rebuild generated Instructions, Skills, integrations, and the ADR index, or return their complete preview.                                                                | Mutating, closed-world, and idempotent; `dry_run: true` is read-only.  |
| `discern_map`               | Index, search, or read the project's agent-maintained Map.                                                                                                                | Read-only and idempotent.                                              |
| `discern_docs`              | Index, search, or read discern's bundled public manual.                                                                                                                   | Read-only, idempotent, and project-independent.                        |
| `discern_doctor`            | Check config, commands, repository shape, and integration health.                                                                                                         | Read-only and idempotent.                                              |
| `discern_improvement`       | Rank the next improvement and return the supporting health audit.                                                                                                         | Read-only and idempotent.                                              |
| `discern_checkpoints`       | Report governing checkpoints, strict obligations, open-question declaration state, and structural evidence.                                                               | Read-only and idempotent.                                              |

The input object is strict: undeclared keys are rejected. Optional keys by tool are:

| Tool                        | Accepted input keys                                            |
| --------------------------- | -------------------------------------------------------------- |
| `discern_status`            | `all`, `local`, `verbose`, `path`                              |
| `discern_start`             | `name`, `title`, `brief`, `from`, `path`, `dry_run`            |
| `discern_prepare`           | `path`                                                         |
| `discern_done`              | `dry_run`, `ci`, `rerun`, `met`, `unmet`, `path`               |
| `discern_update`            | `from`, `dry_run`, `path`                                      |
| `discern_await`             | `green`, `landed`, `trunk_moved`, `resume`, `timeout`, `path`  |
| `discern_accept`            | `dry_run`, `confirmed`, `variance`, `approve_standard`, `path` |
| `discern_test`              | `path`                                                         |
| `discern_standards`         | `dry_run`, `force`, `pin`, `pin_names`, `path`                 |
| `discern_standards_propose` | `name`, `reason`, `dry_run`, `path`                            |
| `discern_impact`            | `path`                                                         |
| `discern_coupling`          | `file`, `with`, `path`                                         |
| `discern_patterns`          | `stats`, `all`, `logbook_file`, `path`                         |
| `discern_checkpoints`       | `path`                                                         |
| `discern_refresh`           | `dry_run`, `path`                                              |
| `discern_map`               | `target`, `search`, `path`                                     |
| `discern_docs`              | `target`, `search`                                             |
| `discern_doctor`            | `verbose`, `path`                                              |
| `discern_improvement`       | `category`, `min_score`, `path`                                |

Every project-operating tool accepts an optional `path` that selects the discern project or worktree for that call. Pass an absolute filesystem path anywhere inside the intended checkout, including another repository in a multi-repo workspace. discern resolves the project root. Omit `path` to use the checkout the MCP server currently targets. Relative paths are rejected because the server's process directory is not the caller's directory. `discern_docs` needs no project. After a successful `discern_start`, later calls use the new worktree by default. After `discern_accept` removes that worktree, the server re-aims at the surviving main checkout.

Tools that require completed setup return a controlled `not_set_up` result until setup finishes. A tool rejects undeclared input keys instead of dropping them.

`discern_refresh` accepts `dry_run: true`. Its plan covers agent files, materialized Skills, integrations, proof-note Git config, removals, and planning errors; preview has no `steps`. A normal call applies only those targets and reports `steps` ([ADR 0335](https://discern.sh/docs/decisions/0335-operation-policy-enrolls-faithful-previews)).

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

The long profile reserves 300 seconds for delivery and cancellation. The strict profile reserves 15 seconds against Cursor's shortest verified surface. A watch returns immediately when its condition holds. When the budget expires first, the result is `ok: true`, `data.met: false`, and includes a 15-character `data.resume` handle. Continue with that handle; do not rebuild the watch from observed state. Handles are repository-local, expire after 7 days, and share a 512-record cap. CLI reports the not-yet result with exit `124`; MCP returns a normal tool result. `timeout` may shorten a call but cannot extend its selected profile.

#### Find a map or manual page

`discern_map` and `discern_docs` expose the same discovery funnel ([ADR 0174](https://discern.sh/docs/decisions/0174-agent-document-discovery-funnel)):

| Inputs                 | Result                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Neither                | The indexed documents; Map also includes its top-level regions and file-linked freshness facts. |
| `target`               | One document's content, or a compact index when `target` names a top-level region.              |
| `search`               | Up to five ranked documents from the admitted corpus.                                           |
| `target` plus `search` | The same search limited to one exact region or document.                                        |

A search result carries `target`, `path`, `section`, `title`, `description`, `match`, an optional matching `heading`, and a contextual `snippet`. `match` is `complete`, `partial`, or `metadata`. The enclosing payload carries `query`, optional `scope`, the full match `count`, `truncated`, and the returned `results`. A zero-match search is `ok: true` with an empty result list. Scores remain an implementation detail.

Lexical matches with `match: "complete"` rank first. When fewer than five qualify, strong partial matches can fill the unused slots. Each must clear a query-length-scaled term-coverage floor. The ranker favors partials that add terms earlier results missed. Exact technical text and phrases in titles, aliases, headings, or code fields return phrase matches only. A longer lexical miss can fall back to a close title or alias. Queries shorter than four characters do not use edit-distance suggestions ([ADR 0183](https://discern.sh/docs/decisions/0183-agent-task-search-uses-an-audience-specific-ranker)).

Map search includes `publish: false`. Docs search covers the public manual. Both are local and omit queries from the Logbook. Use `discern map --search <query>` or `discern docs --search <query>`, optionally after a target.

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

#### Closed result vocabularies

- Step `kind`: `job`, `scope-gate`, `merge-check`, `standards-limits-check`, `tracked-artifacts-check`, `instructions-check`, `skills-check`, `tracked-refresh-check`, `resource-create`, `resource-destroy`, `git`, `task-metadata`, `setup-step`, `repository-ensure`, `checkout-clean-check`, `setup-ensure`, `env`, `refresh`, `tidy`, `standard`.
- Step `disposition`: `run`, `skip`, `gate`.
- Step `outcome`: `ok`, `failed`, `skipped`, `cancelled`.
- Diagnostic `severity`: `error`, `warning`.
- `failed_stage`: `fix`, `build`, `check`, `test`, `check/test`, `scope_gates`, `tree_drift`, `generated_drift`, `refresh_drift`, `tracked_artifacts`, `instructions`, `skills`, `skill_frontmatter`, `adr_numbers`, `adr_index`, `map_integrity`, `merge`, `standards`, `write_access`.
- Advisory `kind`: `acceptance-cleanup-incomplete`, `checkpoint-evidence-dropped`, `checkout-clean-observation-unavailable`, `doctor-warning`, `execution-cap-unavailable`, `generated-attribute-pattern-untranslated`, `ignored-file-observation-unavailable`, `landing-authority-unverified`, `optional-resource-unavailable`, `proof-recording-unavailable`, `setup-unproven-completion`, `setup-machinery-commit-failed`, `setup-marker-commit-failed`, `standards-limits-unverified`, `uninstall-strip-incomplete`.

The registered `error` slugs are: `active_worktrees`, `ambiguous`, `apply_failed`, `awaiting_consent`, `awaiting_declaration`, `awaiting_standard_approval`, `awaiting_variance`, `below_min_score`, `brief_unparseable`, `checkout_failed`, `checkpoint_evidence_unavailable`, `config_template_unavailable`, `confirmation_required`, `conflict`, `desk_already_active`, `detached_head`, `diagrams_misaligned`, `dirty_worktree`, `edit_error`, `gate_failed`, `gitignore_template_unavailable`, `identity_error`, `incomplete`, `internal_error`, `invalid_arguments`, `invalid_config`, `invalid_config_file`, `invalid_migrated_config`, `invalid_settings_file`, `invalid_toml`, `invalid_value`, `no_docs`, `no_map`, `no_repository`, `no_such_step`, `no_target`, `not_found`, `not_initialized`, `not_main_checkout`, `not_on_setup_branch`, `not_on_trunk`, `not_set_up`, `partial_acceptance`, `partial_materialization`, `partial_refresh`, `pin_failed`, `precondition_failed`, `proposal_failed`, `proposal_stale`, `provisioned_resources`, `read_error`, `renamed_command`, `renamed_config_key`, `report_only_proof`, `schema_version_too_new`, `script_not_a_command`, `script_not_executable`, `setup_plan_failed`, `skills_eject_failed`, `tables_malformed`, `templates_not_found`, `tidy_parse_failed`, `tidy_write_failed`, `unchanged_tree_rerun`, `unknown_category`, `unknown_command`, `unknown_key`, `unknown_standard`, and `write_access`.

`ok: true` means every required outcome in the producing verb's completion policy holds. Required writes, validation, compilation, cleanup, and final checks cannot fail under a successful envelope. An explicitly optional degradation remains successful only when `advisories[]` carries its permitted `kind`, non-empty `evidence`, and `next_action`. Hints do not waive required work ([ADR 0349](https://discern.sh/docs/decisions/0349-top-level-success-follows-completion-policies)).

`ok` and the execution state form independent discriminated contracts. A failed Gate run can carry diagnostics and completed steps beside its classified error. A required late failure can carry typed partial-effect data and recovery because `ok: false` does not imply rollback. A refusal can carry a review `plan` without claiming `dry_run: true`. Serialization omits undefined fields. Branch on `ok`, then `verb`, before reading `data` ([ADR 0334](https://discern.sh/docs/decisions/0334-result-envelopes-encode-valid-structural-states)).

A failed JSON, Markdown, or MCP result always includes a registered next action. JSON and `structuredContent` carry it in `hints`; Markdown places it at the end of the presentation. Owner decisions occupy a separate Owner attention section before caller actions. When `message` or the first `diagnostics` entry explains the correction, the hint points there. When recovery depends on a choice or reported state, the hint names the relevant state and action. Consent, partial operations, incomplete setup, document lookup, and improvement thresholds use these specific instructions. A caller therefore does not have to infer whether to retry, review, choose, or complete cleanup ([ADR 0266](https://discern.sh/docs/decisions/0266-public-failure-recovery-is-classified-by-error-family)).

`setup begin` and `accept` check for the required permission before changing anything. Without permission, they return `awaiting_consent` and leave the project unchanged. The result names what needs review and gives the confirmed command that continues the operation. `setup begin` provides this contract in terminal, JSON, and Markdown CLI output. `accept` also provides it through MCP. Dry runs need no permission because they only show the plan.

Setup consent is not write authority. Effectful commands probe plan-derived targets before mutation; denial returns `write_access`, the exact path and retry, with phase unchanged. Read-only commands do not probe ([Setup command boundaries](../40-troubleshooting/setup-and-integrations.md)).

Setup pages carry owner-facing semantic prose once. Compact `spine.owner_moments` projections preserve identity, kind, phase, purpose, recommendation, option ids, wait boundary, and relay protection. Compatibility fields derive from the same enrolled moments, so terminal, Markdown, JSON, and Model Context Protocol (MCP) share one authority without duplicating prose.

`start`, `status`, and green `done` results may carry `data.landing_authority`: `authorized` or `conversation-required`, with source, scopes, uncovered-path evidence, and warnings. Compact status and done results bound uncovered paths to six authored-first examples beside uncovered totals and scopes; `start` grants are prospective. An absent fact stays absent. See [Landing authority](../20-understand/proof.md).

`status` identifies the project in `data.project`. Its default structured projection retains the main fleet row and at most six non-main rows, selected by attention, current-checkout, recent-activity, and lexical priority. Every repeated collection is capped at six. `fleet_total` and positive `projection.omitted` counts preserve exact omissions under dotted paths with zero-based array indexes. Config refusals carry `projection`. Every sampled readable row carries one `gate_proof`, whose status is `honored`, `report_only`, `missing`, `stale`, `dirty`, `unavailable`, or `read_failed`. `report_only` is current for its commit but cannot authorize landing because checkpoint review was not enforced. An honored marker carries a compact `proof` with branch, trunk, validated commit, diff counts, and line. Rendered Proof pages and the earlier honored-only compatibility fields do not cross the structured-result boundary. Collision rows retain identities and shared-path counts. `discern status --verbose --json` and MCP `verbose: true` restore complete repeated collections and landing history with `projection: { mode: "full" }` and no omission map; terminal `--verbose` also holds collision paths and full Proof pages. See [Status and session hints](worktrees-and-status.md) for the dashboard and projections.

A green `done` result uses compact `data.proof`; `data.gate_ran` says whether Gate work ran or current Proof was reused. `data.mode = "report"` and checkpoint `review` are present only for the explicit CI lane; `checkpoint_drops` retains classified fail-open evidence. A successful `accept` carries only its consent-qualified `data.proof_line` plus any retained drops; the paste-ready review page remains available through terminal `discern status --verbose`. These projections remove repeated renderings while preserving the claim needed to report the result.

An unlanded successful `setup done` carries Proof, canonical completion inventory, qualitative `inventory.project_context`, and landing state. It carries no reactivation or improvement advice. Project context includes the derived primary-subsystem handoff, project principles, and instruction sources. After successful `setup accept`, registry-derived `data.reactivation` carries each provider's exact check, local recovery, and command-line fallback. `data.activation_context` explains why a fresh session is necessary. `data.optional_improvement` remains conditional on activation verification. An in-place completion already on the trunk projects the same ordered activation contract.

`setup done` failures distinguish unfinished authoring, uncommitted paths, and exact owned rollback. Transactions name `stage`, `rollback`, retained `state`, `next_action`, and `recovery`; nested diagnostics keep location, rule, and reproduce command.

Applied `setup` and `upgrade` results carry `data.instruction_refresh`. `status: "complete"` means the required instruction refresh completed, even when `compiled` is empty because every artifact was current. `status: "partial"` makes top-level `ok` false and carries the completed artifacts, non-empty failure evidence, `effects_preserved: true`, and `recovery: { command: "discern refresh", safe_to_retry: true }`. The partial result reports prior scaffold or migration effects rather than pretending they rolled back.

A successful `accept` reports the permission it used in `data.consent`: `source` is `conversation`, `standing-grant`, or `effort-grant`, and `scopes` is present for standing-grant coverage. The terminal proof line and `data.proof_line` repeat that evidence.

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

Output metadata is advisory. A configured command's exit status decides the job verdict, except for Standards. Their `DISCERN_METRIC` value is the measurement contract.

Gate and standalone Standards results carry each Standard's `direction`, `limit`, optional `margin`, `measurement`, value, and verdict. A measured or replayed value also carries the Gate-owned `pin_eligible` decision and, when true, its exact `pin_target`. Those fields describe mechanical eligibility. Patterns applies the project-history decision rule ([ADR 0276](https://discern.sh/docs/decisions/0276-patterns-recommendations-require-project-local-decision-evidence)).

Patterns results always carry `data.investigations`. Each entry cites source ids that remain present in `data.findings`, repeats their observations and denominators with numerical provenance, and states the shared evidence boundary, bounded interpretation, diagnostic action, and falsifier. An empty array means no registered relationship cleared its evidence requirements. Terminal, JSON, Model Context Protocol, and sealed-archive reads use the same synthesis arithmetic ([ADR 0277](https://discern.sh/docs/decisions/0277-patterns-investigations-preserve-source-findings)).

`cancelled` marks a fail-fast sibling and fails required completion. `skipped` marks a configured step that did not run. A policy can separately elect a user cancellation as successful no-effect completion.

#### Diagnostics

Every diagnostic includes `tool`, `severity`, `message`, and `reproduce_cmd`. It may also include normalized `output`, `truncated`, `output_path`, `file`, `line`, `col`, `rule`, and `fix_available`. Use `reproduce_cmd` for the smallest direct rerun; use `output_path` when the inline capture was truncated.

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
<!-- Generated by `deno task codegen` from `PUBLIC_SCHEMA_PUBLICATIONS`. -->

| Schema                       | Public `$id`                                                    | Repository artifact                                                                                                              | Contract                                                                                                                             | Same-major changes                                                                |
| ---------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `discern.toml` configuration | <https://discern.sh/schema/v1/discern-config.schema.json>       | [`schema/discern-config.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-config.schema.json)             | Every section, key, and value type the engine validates.                                                                             | Same-major releases may add only optional keys and sections.                      |
| Setup config document        | <https://discern.sh/schema/v1/discern-setup-config.schema.json> | [`schema/discern-setup-config.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-setup-config.schema.json) | The bounded setup recipe consumed only by `setup begin --config`.                                                                    | Same-major releases may add only optional keys and sections.                      |
| Result contracts             | <https://discern.sh/schema/v1/discern-results.schema.json>      | [`schema/discern-results.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-results.schema.json)           | Every CLI `--json` and MCP tool result envelope.                                                                                     | Same-major releases may add only optional fields, new contracts, and error slugs. |
| Landing proof note           | <https://discern.sh/schema/v1/discern-proof-note.schema.json>   | [`schema/discern-proof-note.schema.json`](https://github.com/jackwh/discern/blob/main/schema/discern-proof-note.schema.json)     | The proof envelope acceptance attaches to a landed commit, using the Dead Simple Signing Envelope (DSSE) field and payload boundary. | Same-major releases may add only optional fields, new contracts, and error slugs. |

<!-- END GENERATED: public schema publications -->

[`types/discern-json.d.ts`](https://github.com/jackwh/discern/blob/v1.0.0/types/discern-json.d.ts) provides release-pinned standalone TypeScript types indexed by verb, command path, and MCP tool name. Each per-verb type intersects with `DiscernResultState`, so narrowing `ok` also narrows `error`, and planned and completed steps cannot coexist. The result schema's `x-discern-contracts` metadata publishes each registered verb's `completion_policy`, including `required_postconditions`, `optional_advisories`, refusal, cancellation, partial-effect, no-op, and recovery-owner policy.

#### Compatibility by schema version

Package releases do not change public schema `$id`s; breaks require a new major. Runtime result schemas stay strict. Their published schema remains open to optional fields and unknown `error` slugs.

From v1.0.0, every public schema is append-only within its major version relative to the highest valid predecessor release tag. A release tag at `HEAD` excludes itself from selection; without a predecessor the first publication remains unarmed. Untagged trunk changes are provisional. Every generated artifact compiles strictly as JSON Schema Draft 2020-12. The artifact records its compatibility policy, and same-major comparisons use the policy from the tagged artifact. Existing configuration defaults are structural within a major. A breaking major adds a publication, artifact, and route while retaining the earlier major.

The v1 result publication uses discriminated envelopes and explicit completion contracts. Setup and upgrade consumers use `data.instruction_refresh`; a partial required refresh is a failed command even though its payload preserves completed effects. A successful `setup accept` that has nothing to land carries `data.completion = { status: "no_op", reason }` rather than omitting its landing outcome; `reason` distinguishes `no_git_repository` from `already_on_target`. Contradictory fixtures and lying success states are invalid ([ADR 0334](https://discern.sh/docs/decisions/0334-result-envelopes-encode-valid-structural-states), [ADR 0349](https://discern.sh/docs/decisions/0349-top-level-success-follows-completion-policies)).

The comparison permits the table's additions, reordered contract unions, and the first MCP exposure of an existing CLI contract. In config schemas, a new named property must accept every value admitted for that name by the trunk object's `additionalProperties` schema. Its named schema may add members to the catchall's `type` set; `oneOf` stays under structural comparison. Tuple schemas compare `prefixItems` by position.

A result-role aggregate may widen only when its definition contains `oneOf` and annotation keywords, and the trunk exposes 1 acyclic same-instance route to it from the top-level branches. A recognized aggregate cannot add named properties. The route must be a pure top-level `$ref` to the aggregate. Constrained references and applicators such as `allOf` or `dependentSchemas` count as routes but cannot grant widening authority. Repeated references and wrapper branches count separately. An ambiguous aggregate and a nested union stay closed.

The same rule permits a role's first aggregate when the trunk has no registry references for that role, every current role reference introduces a definition, 1 new aggregate contains only `oneOf` and annotation keywords with the full current reference set, and 1 pure top-level entrypoint is its sole route. The comparison rejects policy drift, arbitrary metadata that tries to authorize a union change, removals, and changes to existing types, required result fields, or validation ([ADR 0208](https://discern.sh/docs/decisions/0208-public-contracts-version-by-schema-major)).

The published config schemas are closed authoring snapshots. Refresh a cached copy before validating newer optional keys. At runtime, both live `discern.toml` and the bounded setup recipe are strict: an unknown or malformed key fails, and the recipe also refuses an unsupported declared major. See [Runtime data boundaries](https://discern.sh/map/development/runtime-data-boundaries).
