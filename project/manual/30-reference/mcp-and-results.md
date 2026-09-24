---
id: reference-results-and-mcp
title: "MCP and results"
description: "Look up the tools discern gives your agent, what each one accepts and returns, and the exit codes and schemas behind its results."
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

Look up what your agent can ask discern to do over the Model Context Protocol (MCP), and what comes back. This page lists the result formats, every tool and its inputs, the fields of each result, the exit codes, and the published schemas. Each tool's effect contract says whether it changes anything, and where your approval is required.

A few terms recur: the **gate** is the project's final quality check, **Proof** records what it established for one exact commit, and the **trunk** is the project's shared branch. A **worktree** is the separate copy of the project where one task happens. **Checkpoints** ask for judgment, **grants** record your permission to land changes, and a **variance** is your permission to land despite an unmet checkpoint.

Tools that work on a project need a configured project; `discern_docs` reads the bundled manual without one. To connect an agent, follow [Connect a coding agent](../10-guides/connect-a-coding-agent.md).

| Find                                           | Go to                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Choose Markdown, JSON, terminal, or MCP output | [Result formats and delivery](#result-formats-and-delivery)                                       |
| Tool names and accepted inputs                 | [Model Context Protocol tools](#model-context-protocol-tools)                                     |
| Read a success, failure, or partial result     | [The `DiscernResult` envelope](#the-discernresult-envelope)                                       |
| Interpret completion and landing evidence      | [Completion and landing results](#completion-and-landing-results)                                 |
| Resume a long-running watch                    | [Call duration and continuation](#call-duration-and-continuation)                                 |
| Resource URIs                                  | [Model Context Protocol resources](#model-context-protocol-resources)                             |
| Exit codes, schemas, or TypeScript types       | [CLI exit codes](#cli-exit-codes) and [Published schemas and types](#published-schemas-and-types) |

## Result formats and delivery

Every format describes the same operation and the same verdict.

| Surface               | Result                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------- |
| Terminal CLI          | An interactive or static terminal presentation.                                             |
| CLI with `--markdown` | One authored Markdown presentation on stdout.                                               |
| CLI with `--render`   | The authored Markdown, rendered as static terminal output.                                  |
| CLI with `--json`     | One compact structured `DiscernResult` on stdout.                                           |
| MCP tool              | Authored Markdown in `content`, the compact envelope in `structuredContent`, and `isError`. |
| MCP resource          | A live compact payload, or a requested Markdown document, without an envelope.              |

Choose by the task and whoever reads the result. Markdown gives prioritized prose for reading and quoting. JSON gives exact fields for selecting, validating, scripting, and lasting integrations. People and agents can use either.

MCP carries both, because hosts expose channels differently. `content[0].text` and `structuredContent` each explain the current state and the next action; they complement each other rather than repeat the same JSON.

Every surface keeps one completion verdict. `ok: true` means every outcome the command's completion policy requires holds. An optional degradation stays successful only as a typed `advisories[]` item, with a kind, evidence, and a next action. A required failure late in a run keeps `ok: false`, even when its steps or data show earlier effects. MCP `isError` is always the opposite of `structuredContent.ok`. Renderers choose and arrange facts, but never reinterpret success ([ADR 0349](https://discern.sh/docs/decisions/0349-top-level-success-follows-completion-policies)).

`--markdown`, `--json`, and `--render` can't be combined. Each leaves out the surrounding terminal decoration and the narration of subprocesses. `--render` is a convenience: it passes the authored Markdown through discern's terminal renderer. It never prompts or pages, follows the terminal's width, theme, color, and character support, and writes no control sequences when redirected. JSON and Markdown stay the main result formats.

An authored Markdown presentation selects facts from the result's registered contract; it doesn't dump every JSON field. When present, its sections come in this order: current state, bounded evidence, authority and boundaries, owner attention, other actions, then the next action. Owner attention holds the decisions reserved for you. When several actions matter, the secondary ones come first, and the immediate next action closes the document. Supporting payloads where whitespace matters keep their exact content in the evidence section, including leading and trailing spaces. They include requested map or manual pages, setup instructions, diagnostic output, and terminal art.

`status` has its own size limit. Its default CLI JSON, MCP `structuredContent`, and live resource are bounded orientation views, with true counts of what they left out. `discern status --verbose --json`, or `discern_status` with `verbose: true`, selects full structured status. Both default surfaces name that route in `hints`, and [Worktrees and status](worktrees-and-status.md) defines the fields and caps.

Default doctor JSON and `discern_doctor` return the environment and the actionable checks, without `data.execution_model`. Their hint names `discern doctor --verbose --json`, and MCP accepts `verbose: true`. The terminal doctor uses `--verbose` for per-step hints.

`setup begin` emits the operating contract and the first page, and `setup step <n>` emits one page. Each shares its parsed operational outline across its structured, terminal, and Markdown forms. `setup done` returns Proof, assurance, the derived inventory, and one action that's valid for the current phase.

## Model Context Protocol tools and result contracts

MCP lets a coding agent call discern directly. The tools below use the same result contracts as the CLI. Use their structured fields for integrations, and their Markdown for reading or relaying an outcome.

### Model Context Protocol tools

| Tool                  | Purpose                                                                                                                                                                                                                                                          | Effect contract                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `discern_status`      | Report the current branch, gate inputs, standards, Proof, fleet state, unfinished setup, and verified landing authority.                                                                                                                                         | Read-only and idempotent.                                                                           |
| `discern_start`       | Create and set up a new worktree, then report its prospective landing authority.                                                                                                                                                                                 | Changes files; each successful call creates a new worktree.                                         |
| `discern_done`        | Check the committed tip of the calling checkout against every configured check and standard, and return Proof for that exact commit. `ci: true` reports checkpoint review without declarations.                                                                  | Runs project commands in the calling checkout, which stays the agent's.                             |
| `discern_prepare`     | Run the fix stage, the `[generated]` regenerations, and the checks, for the fast inner loop.                                                                                                                                                                     | Runs project commands; fixers and regenerations may rewrite files.                                  |
| `discern_test`        | Run the test stage on demand. `discern_done` already includes it.                                                                                                                                                                                                | Runs project commands.                                                                              |
| `discern_update`      | Merge the selected base into this branch, and rebuild generated files.                                                                                                                                                                                           | Changes files; idempotent for the same inputs.                                                      |
| `discern_await`       | Wait until a sibling branch is green, its work lands, or the trunk moves, then report the next step.                                                                                                                                                             | Read-only and idempotent; a timeout returns a normal result.                                        |
| `discern_progress`    | Read a long operation back after a lost call: its phase, the counts and failures known so far, and the retained result.                                                                                                                                          | Read-only and idempotent; reading changes nothing.                                                  |
| `discern_standards`   | With `action: "measure"`, measure standards and optionally pin improvements. With `action: "propose"`, record one atomic batch of limit proposals, each bound to a commit.                                                                                       | Runs project commands; pinning or proposing changes the config and commits it.                      |
| `discern_accept`      | Record the selected effort's proven commit. `action: "queue"` returns once it's queued; the default starts landing under verified authority. A landing removes the effort's worktree, resources, and branch when the branch holds nothing beyond the submission. | Ordinary landing needs consent or a verified grant; an emergency needs a fresh, exact confirmation. |
| `discern_impact`      | List the scopes the current change activates.                                                                                                                                                                                                                    | Read-only and idempotent.                                                                           |
| `discern_coupling`    | Report files that historically change together with the current diff or the named files.                                                                                                                                                                         | Read-only, idempotent, and advisory.                                                                |
| `discern_patterns`    | Report findings, investigations, or stats from the active logbook or a selected sealed archive.                                                                                                                                                                  | Read-only, idempotent, and advisory; lifecycle actions are CLI-only.                                |
| `discern_refresh`     | Rebuild generated instructions, skills, integrations, and the ADR index, or return their complete preview.                                                                                                                                                       | Changes only the files in its plan, and is idempotent; `dry_run: true` is read-only.                |
| `discern_map`         | Index, search, or read the project's agent-maintained map.                                                                                                                                                                                                       | Read-only and idempotent.                                                                           |
| `discern_docs`        | Index, search, or read discern's bundled public manual.                                                                                                                                                                                                          | Read-only, idempotent, and needs no project.                                                        |
| `discern_doctor`      | Check the config, commands, repository shape, and integration health.                                                                                                                                                                                            | Read-only and idempotent.                                                                           |
| `discern_improvement` | Rank the next improvement, and return the health audit behind it.                                                                                                                                                                                                | Read-only and idempotent.                                                                           |
| `discern_checkpoints` | Report the governing checkpoints, their strict obligations, open-question declaration state, and structural evidence.                                                                                                                                            | Read-only and idempotent.                                                                           |

Each tool's input object is strict, so it rejects keys it doesn't declare, instead of dropping them. These are the accepted keys. Only `discern_standards` requires one, `action`.

| Tool                  | Accepted input keys                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern_status`      | `all`, `local`, `verbose`, `path`                                                                                                                                                                  |
| `discern_start`       | `name`, `title`, `brief`, `from`, `path`, `dry_run`                                                                                                                                                |
| `discern_prepare`     | `path`                                                                                                                                                                                             |
| `discern_done`        | `dry_run`, `ci`, `rerun`, `met`, `unmet`, `path`, `standalone`, `policy_base`                                                                                                                      |
| `discern_update`      | `from`, `dry_run`, `path`                                                                                                                                                                          |
| `discern_await`       | `green`, `landed`, `trunk_moved`, `resume`, `timeout`, `path`                                                                                                                                      |
| `discern_progress`    | `handle`, `path`                                                                                                                                                                                   |
| `discern_accept`      | `action`, `target`, `prepare`, `preparation_receipt`, `met`, `unmet`, `composition_receipt`, `reason`, `approval_token`, `recover`, `dry_run`, `confirmed`, `variance`, `approve_standard`, `path` |
| `discern_test`        | `path`                                                                                                                                                                                             |
| `discern_standards`   | `action`, `dry_run`, `force`, `pin`, `names`, `proposals`, `path`                                                                                                                                  |
| `discern_impact`      | `path`                                                                                                                                                                                             |
| `discern_coupling`    | `file`, `with`, `path`                                                                                                                                                                             |
| `discern_patterns`    | `stats`, `all`, `logbook_file`, `path`                                                                                                                                                             |
| `discern_checkpoints` | `path`                                                                                                                                                                                             |
| `discern_refresh`     | `dry_run`, `path`                                                                                                                                                                                  |
| `discern_map`         | `target`, `search`, `path`                                                                                                                                                                         |
| `discern_docs`        | `target`, `search`                                                                                                                                                                                 |
| `discern_doctor`      | `verbose`, `path`                                                                                                                                                                                  |
| `discern_improvement` | `category`, `min_score`, `path`                                                                                                                                                                    |

#### Completion options

An ordinary completion needs a clean, committed tree, and proves its `HEAD`.

- **`standalone: true`** gives transient diagnostics, including on a dirty tree, without Proof.
- **`policy_base`** takes a fetched comparison ref, only together with `ci: true` and `standalone: true`, for a hosted report.
- **`rerun: true`** checks an unchanged tree again.
- **`met` and `unmet`** record checkpoint conclusions, and can't be combined with `ci: true`.

None of these options grants landing authority, and none changes which checkout the agent works in.

#### Acceptance options

For an ordinary acceptance, your agent leaves out `action`. From the effort's worktree, the call records the effort's submission, meaning the exact `HEAD` and its Proof, and lands it when the authority checks out. Without authority, it refuses without changing anything, the submission waits in the landing queue for you, and the agent relays the Proof line.

- **`target`** selects a task by id, path, branch, or full local ref. A call from the main checkout must name one. With `target`, ordinary acceptance starts a walk: it lands the selected submission first, then other authorized submissions in queue order, and stops at the first refusal. `data.landings` records each attempt.
- **Consent** covers only the submitted commit. `confirmed: true` records consent you gave in the current conversation, and `variance` and `approve_standard` each require it.
- **`dry_run: true`** shows the landing queue and the selected task's verdict, and changes nothing.

When the trunk moved after the task's Proof, the call combines the change with the new trunk in an integration worktree, checks the combined code, and lands the exact result that passed. A conflict or a failed combined check goes back to the task's author. A checkpoint question about the combined result keeps the composition. Your agent answers it with `met`, or `unmet` with a rationale, on a follow-up call, and the same landing continues. The refusal serves a `composition_receipt`, which the answer, and any variance decision over the combined result, must name. So a decision can't drift onto a composition it wasn't served for.

#### Emergency integration

If checkpoint questions block an emergency plan, your agent first calls `discern_accept` with `action: "emergency"`, `prepare: true`, and the `reason`. Preparation runs the checkpoint triggers and serves their questions, without running validation jobs. The agent records the questions it judges satisfied through `met`, an array of checkpoint ids, and gets back a `preparation` receipt. That receipt goes in `preparation_receipt` on the later preview and on the confirmed call.

- A changed revision or declaration needs fresh preparation, and an unmet question still blocks emergency integration.
- `dry_run: true` previews preparation without running triggers or recording answers.
- Preparation can't be combined with confirmation, or with transition recovery.

For the emergency itself, your agent calls `discern_accept` with `action: "emergency"` and a `reason`. You review the displayed trunk, the repair revision, each commit it lands, the reason, and the checks that failed, never ran, or have out-of-date evidence. Then your agent supplies `confirmed` and the plan's `approval_token`. The token expires after 15 minutes, and a changed plan needs fresh approval. discern builds the repair on the actual trunk, and composes no other queued work into it. When the repair already contains another task's unlanded work, `data.emergency.carried` names each such task, its branch, and its newest revision in the repair, and approving the plan lands that work too. Checkpoint judgments still come first. A loosened standard limit lands only under its recorded proposal: the preview serves each one in `data.standard_approvals_required`, and the confirmed call passes each token you approved in `approve_standard`. A plan that redefines or deletes a standard is refused.

The exception has its own record type, and can't serve as passing Proof. This action doesn't push, deploy, or change external branch protections. `recover` resumes an interrupted emergency by its landing id.

#### Choose a project or worktree

Every tool that works on a project accepts an optional `path`, which selects the discern project or worktree for that call. Pass an absolute filesystem path anywhere inside the checkout you mean, including another repository in a multi-repo workspace, and discern resolves the project root. Leave `path` out to use the checkout the MCP server currently targets. A relative path is rejected, because the server's process directory isn't the caller's directory. `discern_docs` needs no project.

After a successful `discern_start`, later calls use the new worktree by default. After `discern_accept` removes that worktree, the server points back at the surviving main checkout. Tools that need finished setup return a controlled `setup_unfinished` result until setup finishes.

`discern_standards` requires an `action`. `action: "measure"` accepts `names`, `force`, and `pin`. `action: "propose"` accepts an ordered `proposals` array of unique `{ name, reason }` entries, and records every limit breach at once, in one transaction. A proposal's reason is a technical justification; it isn't approval or landing authority. The scalar `discern standards propose` CLI command stays available for terminal use.

`discern_refresh` accepts `dry_run: true`. Its plan covers the agent files, materialized skills, provider integrations, the Proof note fetch configuration, the clone-local merge driver, the generated `.gitattributes` metadata, the maintained ADR index, removals, and planning errors. A preview has no `steps`, and a preview with planning errors returns `ok: false` with `partial_refresh`. A normal call applies only those targets, and reports `steps` ([ADR 0335](https://discern.sh/docs/decisions/0335-operation-policy-enrolls-faithful-previews)).

#### Startup discovery

MCP `tools/list` returns the full definitions, and each client chooses what to load at startup. discern lists the tools a session needs to start first: status, start, prepare, done, update, await, accept, and map. Progress comes next. The standalone test tool, which is expensive, comes after progress, for use on demand.

#### Call duration and continuation

| Caller or provider                 | Configured client or tool limit | `discern_await` call budget |
| ---------------------------------- | ------------------------------- | --------------------------- |
| Claude Code                        | 3,600 seconds                   | 3,300 seconds               |
| Codex                              | 3,600 seconds                   | 3,300 seconds               |
| Gemini                             | 3,600 seconds                   | 3,300 seconds               |
| GitHub Copilot                     | 3,600 seconds                   | 3,300 seconds               |
| Cursor's shortest verified surface | 60 seconds                      | 45 seconds                  |
| Unknown MCP client                 | Unknown                         | 45 seconds                  |
| CLI                                | No MCP client limit             | 3,300 seconds               |

Cursor's strict profile keeps `discern_await` under the Agent CLI's 60-second transport limit. Gate calls can take longer, so run `discern done --markdown` in a shell there, and use `discern prepare --markdown` or `discern test --markdown` when you want those stages.

The long profile reserves 300 seconds for delivery and cancellation. The strict profile reserves 15 seconds against Cursor's shortest verified surface. A watch returns as soon as its condition holds. When the budget runs out first, the result has `ok: true` and `data.met: false`, with a 15-character `data.resume` handle. Continue with that handle rather than rebuilding the watch from what you observed. Handles are local to the repository, expire after 7 days, and share a 512-record cap. The CLI reports this not-yet result with exit `124`, and MCP returns a normal tool result.

Over MCP, `timeout` can shorten a call but can't extend its profile, and `timeout: 0` checks once without waiting. The CLI's `--timeout` isn't capped. The result reports `data.requested_timeout_s` and `data.timeout_basis`.

#### Progress handles and reconnect

A long `done`, `test`, `standards`, or `accept` run, and every `discern await` or `discern_await` call, announces a **progress handle** as its first progress fact, in the form `R1-XXXX-XXXX-XX`, with the command that reads it back. The same facts reach a live terminal, MCP `notifications/progress` messages when the client supplies a progress token, and a journal under the repository's Git administration. A `--json` or `--markdown` run prints nothing while it runs; its result envelope is its whole output.

Runs that don't do long work announce no handle: dry runs of `done`, `standards`, and `accept`, a `done` that refuses before its gate starts, a `standards` proposal, `accept` in queue mode, and an emergency acceptance. discern also announces no handle when it can't open its journal store.

An unfinished completion attempt holds a 60-second lease, which its live operation renews every 20 seconds. If another `done` reaches the same evidence while that lease is current, the result is `error: "incomplete"`, `failed_stage: null`, and `gate_ran: false`. `data.completion.pending` then holds one row for the shared attempt: its attempt id, effective expiry, progress handle when available, and next action. Read the existing operation with `discern_progress`, or `discern progress <handle>` on the command line, instead of starting another gate. A later call cancels the claim once its owner is gone or its lease has expired, then proceeds with a new, fenced attempt.

`discern progress [handle]`, or `discern_progress` with `handle` and `path`, reads that operation back at any time, and changes nothing. With no handle, it reads the most recently started operation of the calling checkout, and refuses another checkout's operation by name. Every worktree of the repository shares one store, which keeps records for up to 7 days. When the store is full, it evicts records in this order: unreadable records, finished `await` records, other finished operations, unfinished operations whose process is gone, and last, running operations.

Active waits stay visible when independent checks finish. The current state explains what can't start, why it's waiting, how long it has waited, and what happens next. A wait for capacity includes the configured limit on concurrent runs and the latest observed use. A live process alone doesn't prove the work is advancing. Older records without wait facts can't supply this information.

When your agent returns to a checkout with an operation still running, `discern_status` includes the same current-state summary and the command that reads it back. So a queued operation stays visible through status as well as progress.

An active `await` records its target, requested condition, latest observation, and continuation. If the call stops, the agent can use that continuation to keep the original watch. The agent reads the original call's progress before starting another watch. An elapsed observation window means the condition is still unmet; it doesn't mean the awaited work succeeded. Explicit cancellation ends automatic waiting.

| Field                                            | Contract                                                                                                                                                                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.waits`                                     | Independently identified waits, with their state, reason, elapsed time, next action, and available capacity or condition details. Finished waits keep their history.                                                                                    |
| `data.observed_at`, `data.last_activity_at`      | When this reading was made, and when the operation last recorded progress. These times don't estimate completion.                                                                                                                                       |
| `data.handle`, `data.operation`                  | The handle, and the operation's `verb`, `path`, `branch`, `started_at`, and `finished_at` once it ended.                                                                                                                                                |
| `data.record_path`                               | Where the journal record is stored.                                                                                                                                                                                                                     |
| `data.executor`                                  | `running`, `gone`, or `unknown`: whether a process with the recorded id still exists. `executor_reason` explains an unknown probe.                                                                                                                      |
| `data.outcome`                                   | `completed`, `failed`, or `cancelled`, once the executor closed the record. A gone executor with no outcome stopped without finishing.                                                                                                                  |
| `data.progress`                                  | The latest recorded fact: `phase`, `state`, `reason`, `next`, `owner_must_act`, and the producer `work` it carried, with the `candidate_id`, `operation_handle`, and `attempt_id` it belongs to.                                                        |
| `data.producers`                                 | Merged counts per `producer`, with its `state`: `units` with `completed` and a `total` that's `null` when unknown, `results` with only the counts reported, `active`, `elapsed_ms`, `partial`, and `output_path`.                                       |
| `data.failures`                                  | Each failure established so far: `producer`, `name`, `message`, `file`, `line`, `reproduce_cmd`, and `partial`.                                                                                                                                         |
| `data.timings`                                   | Named intervals, each with an `interval_id`, `category`, `started_at`, and `finished_at`. The category is `capacity-acquisition`, `capacity-wait`, `producer`, `extraction`, `validation`, or `validation-feedback`, and each interval is its own fact. |
| `data.result`, `result_truncated`, `result_path` | The retained result envelope. When the envelope is too large, `data.result` keeps a reduced account, and `result_path` holds the complete one. `result_retention_error` explains a result discern couldn't keep.                                        |
| `data.account`                                   | The sentences every surface presents, in order.                                                                                                                                                                                                         |

Observers and executors differ. A reconnect read, an `await` watch, or a second session can stop, time out, or die without touching the run. The MCP call that's itself running a command isn't a separate observer: its explicit cancellation, or its transport closing, cancels the executor, and the journal records the run as `cancelled` with its facts kept.

A read refuses, naming the condition, for a damaged or unknown handle, an empty store, another checkout's operation, an unreadable record, a record written by a newer discern, a store discern can't access, or no reachable repository.

#### Producer progress lines

A project's own check, such as its test or build command, can report its progress by printing lines to stdout or stderr:

```text
DISCERN_PROGRESS {"units":{"kind":"partitions","completed":3,"total":8},"results":{"passed":120,"failed":1,"skipped":2},"elapsed_ms":45210}
DISCERN_PROGRESS {"failure":{"name":"alpha holds","message":"expected 2, got 3","file":"tests/alpha_test.py","line":42,"reproduce":"tools/test --only 'alpha holds' --seed 7"}}
```

Each line holds one JSON object, and every top-level field is optional.

- **`units`** carries `kind` and `completed`, which it requires, and `total`, where `null` or a missing total means unknown.
- **`results`** carries only the counts the producer has established. A missing or empty `results` leaves the counts unknown.
- **`active`** lists the labels of running work, and **`elapsed_ms`** is the producer's own elapsed time.
- **`partial: true`** marks counts that cover only part of the completed units. Once a producer reports partial counts, they stay marked partial.
- **`failure`** names the failing test or obligation. It requires `name` and `message`, and can add `file`, `line`, and a focused `reproduce` command that carries the recorded seed and instrumentation.

discern shows the counts and failures live, and keeps them for reconnect. The lines change nothing about scheduling, verdicts, or evidence. discern ignores unknown keys, ignores a whole line that doesn't validate completely or carries no recognized fact, and drops lines over 16 KiB. The protocol is the same for any language or test runner.

#### Find a map or manual page

`discern_map` and `discern_docs` share one way to find documents ([ADR 0174](https://discern.sh/docs/decisions/0174-agent-document-discovery-funnel)):

| Inputs                 | Result                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| Neither                | The indexed documents. The map also includes its top-level regions and file-linked freshness facts. |
| `target`               | One document's content, or a compact index when `target` names a top-level region.                  |
| `search`               | Up to five ranked documents from the searchable pages.                                              |
| `target` plus `search` | The same search, limited to one exact region or document.                                           |

A search result carries `target`, `path`, `section`, `title`, `description`, `match`, an optional matching `heading`, a contextual `snippet`, and, where available, `page_id` and `manual_kind`. `match` is `complete`, `partial`, or `metadata`. The surrounding payload carries `query`, an optional `scope`, the full match `count`, `truncated`, and the returned `results`. A search with no matches is `ok: true` with an empty result list. Scores stay an implementation detail.

Results with `match: "complete"` rank first. When fewer than five qualify, strong partial matches can fill the unused slots, and each must cover enough of the query's terms, in proportion to its length. The ranker favors partial matches that add terms earlier results missed. Exact technical text, and phrases in titles, aliases, headings, or code, return only phrase matches. A longer query with no match can fall back to a close title or alias, but a query shorter than four characters gets no spelling suggestions ([ADR 0183](https://discern.sh/docs/decisions/0183-agent-task-search-uses-an-audience-specific-ranker)).

Map search includes pages with `publish: false`, and docs search covers the public manual. Both are local, and leave queries out of the logbook. On the command line, use `discern map --search <query>` or `discern docs --search <query>`, optionally after a target.

`path` and `target` answer different questions. `path` chooses which project or worktree a project-operating MCP call uses. `target` chooses a region or document inside that project's map.

### The `DiscernResult` envelope

| Field                 | Present                   | Meaning to the caller                                                                                                                                         |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`                  | Always                    | Whether the completion policy succeeded (`true`) or failed (`false`).                                                                                         |
| `verb`                | Always                    | The command that produced the result.                                                                                                                         |
| `dry_run`             | Preview                   | `true` for a preview.                                                                                                                                         |
| `plan`                | Preview, or a review plan | The context and steps that would run. Never present with `steps`.                                                                                             |
| `steps`               | Applied calls             | The operations attempted, and their outcomes. Never present with `plan` or `dry_run: true`.                                                                   |
| `diagnostics`         | Failures                  | Failure details, and the command that reproduces each one.                                                                                                    |
| `diagnostic_evidence` | Sampled diagnostics       | Where the complete diagnostics are kept: `path`, `digest`, and `bytes`, plus the `total` count, how many are `shown`, and how often each shown one `repeats`. |
| `data`                | Per command               | The command's payload.                                                                                                                                        |
| `advisories`          | Optional degradation      | Successful degradations, each with a typed kind, evidence, and next action.                                                                                   |
| `hints`               | Advisory                  | Notices, boundaries, owner attention, and next actions. Failures carry an action. Hints never change `ok`.                                                    |
| `error`               | Evaluated failures        | A stable, classified failure slug. Never present when `ok` is `true`.                                                                                         |
| `message`             | Evaluated failures        | An explanation of the failure or refusal.                                                                                                                     |
| `waited_ms`           | Test-slot wait            | Milliseconds spent waiting for a configured concurrent-test slot.                                                                                             |

`ok: true` means every outcome the command's completion policy requires holds. Required writes, validation, compilation, cleanup, and final checks can't fail under a successful envelope. An explicitly optional degradation stays successful only when `advisories[]` carries its permitted `kind`, non-empty `evidence`, and `next_action`. Hints don't waive required work ([ADR 0349](https://discern.sh/docs/decisions/0349-top-level-success-follows-completion-policies)).

When diagnostics are sampled, the envelope shows a summary sample, with long messages and outputs cut short, and `diagnostic_evidence` points to the complete set.

`ok` and the execution state are independent contracts. A failed gate run can carry diagnostics and completed steps beside its classified error. A required failure late in a run can carry typed data about partial effects, and recovery, because `ok: false` doesn't imply a rollback. A refusal can carry a review `plan` without claiming `dry_run: true`. Serialization leaves out undefined fields. Branch on `ok`, then `verb`, before reading `data` ([ADR 0334](https://discern.sh/docs/decisions/0334-result-envelopes-encode-valid-structural-states)).

A failed JSON, Markdown, or MCP result always includes a registered next action. JSON and `structuredContent` carry it in `hints`, and Markdown puts it at the end. Decisions for you sit in a separate Owner attention section, before the caller's actions. When `message` or the first `diagnostics` entry explains the fix, the hint points there. When recovery depends on a choice or a reported state, the hint names that state and the action. Consent, partial operations, unfinished setup, document lookup, and improvement thresholds use these specific instructions. So a caller never has to guess whether to retry, review, choose, or finish cleanup ([ADR 0266](https://discern.sh/docs/decisions/0266-public-failure-recovery-is-classified-by-error-family)).

`setup begin` checks for the setup permission it needs before applying its plan, and ordinary acceptance checks permission separately for each landing. A result awaiting consent can still describe earlier tasks that already landed, so read its per-task outcomes before you retry. The result names the decision and the continuation command. Dry runs need no permission, because they only show the plan.

Setup consent isn't permission to write. A command that changes files first checks that it can write the targets its plan names. If it can't, it returns `write_denied`, with the exact path and a retry, and the phase stays unchanged. Read-only commands make no such check ([Setup and integrations](../40-troubleshooting/setup-and-integrations.md)).

Setup pages carry the prose meant for you once. The compact `spine.owner_moments` projections keep each moment's identity, kind, phase, purpose, recommendation, option ids, wait boundary, and relay protection. Compatibility fields derive from the same moments, so the terminal, Markdown, JSON, and MCP share one authority without repeating the prose.

`start`, `status`, and green `done` results can carry `data.landing_authority`: `authorized` or `conversation-required`, with its source, scopes, evidence of uncovered paths, and warnings. Compact status and done results limit the uncovered paths to six examples, authored files first, beside the uncovered totals and scopes. A grant reported by `start` is prospective. A fact that's absent stays absent. [Proof](../20-understand/proof.md) explains landing authority.

`status` names the project in `data.project`. Its default structured view keeps the main fleet row and at most six other rows, chosen by attention, the current checkout, recent activity, and name. Every repeated collection is capped at six. `fleet_total` and positive `projection.omitted` counts record the exact number of entries left out, under dotted paths with zero-based array indexes. Config refusals carry `projection` too.

Every sampled readable row carries one `gate_proof`, whose status is `honored`, `report_only`, `missing`, `stale`, `dirty`, `unavailable`, or `read_failed`. `report_only` is current for its commit, but can't authorize landing, because checkpoint review wasn't enforced. An honored marker carries a compact `proof`, with the branch, trunk, validated commit, diff counts, and Proof line. Rendered Proof pages, and the older fields that copied an honored Proof, don't appear in structured results. Collision rows keep their identities and shared-path counts.

`discern status --verbose --json`, and MCP `verbose: true`, restore the complete repeated collections and landing history, with `projection: { mode: "full" }` and no omission map. Terminal `--verbose` also shows collision paths and full Proof pages. [Worktrees and status](worktrees-and-status.md) covers the terminal report and these views.

#### Completion and landing results

Green means the required checks passed for the recorded commit. It doesn't mean the change landed. A later edit makes Proof stale, because the code waiting to land differs from what passed. Only you can approve an exception for an unmet checkpoint, and no grant covers one.

For `done`, read `data.completion` as well as the top-level verdict:

| Field or value                          | Meaning                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `completion.kind: "complete"`           | The required evidence for the committed tip is complete. Read the returned Proof and any landing decision.                               |
| `completion.kind: "pending"`            | Evidence or judgment is still unresolved.                                                                                                |
| `completion.kind: "diagnostic"`         | Standalone feedback, with no landing Proof.                                                                                              |
| `completion.proof_id`                   | The Proof's identity, when available.                                                                                                    |
| `completion.pending`, `pending_reasons` | The structured conditions, and their explanations, for an unfinished completion.                                                         |
| `data.proof`                            | The compact Proof, when completion produced one.                                                                                         |
| `data.gate_ran`                         | Whether gate work ran. `false` can mean discern reused current Proof, or stopped before gate work, for example at a checkpoint question. |
| `data.producer_executions`              | Recorded execution counts, per producer.                                                                                                 |

An explicit CI report uses `data.mode: "report"`, and reports checkpoint review without answering questions. Its feedback provides no landing Proof. `checkpoint_drops` keeps classified uncertainty about checkpoint enforcement.

`discern_accept` with `action: "queue"` returns the reviewed `path`, `branch`, `head`, and complete `proof` pointer under `data.revision`. `data.submission` carries the observed `authority`, and its `state` is `planned` for a dry run and `queued` once recorded. A queued result includes `submission_id` and `submitted_at`, and `replaces`, when present, names the previously queued commit.

Queue mode accepts `target`, `path`, and `dry_run`. It refuses landing consent, exception approvals, and integration answers; use ordinary acceptance for those separate decisions. Applying it checks the clean tree, the current Proof, and any separate checkpoint or standard decisions again. Queueing the same revision again keeps its place in the queue. A later commit, or `done`, doesn't submit newer work by itself. To start landing, your agent calls `discern_accept` with `target`; queueing schedules nothing in the background.

Ordinary acceptance returns `data.queue`: the landing queue, a view derived from the submissions. Each row is one submission whose commit hasn't landed. Rows that are `pre-authorized` come first, in grant order, then rows `awaiting-owner`, in submission order. `discern status`, the desk, and a `dry_run: true` preview show the same rows in the same order, and a dry run changes nothing.

| Queue-row field                    | Contract                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effort`, `branch`, `path`, `head` | The submission: the task, its branch, its worktree path, and the exact submitted commit.                                                                                        |
| `submitted_at`                     | When the submission was recorded.                                                                                                                                               |
| `authority`                        | `pre-authorized`, when a recorded grant lands it once green without a further conversation, or `awaiting-owner`.                                                                |
| `authority_source`, `granted_at`   | Which grant pre-authorizes the row, `effort-grant` or `standing-grant`, and when it was recorded.                                                                               |
| `position`                         | The row's 1-based place in the landing order.                                                                                                                                   |
| `readiness`, `reason`              | `ready`, or `waiting` with one full sentence naming the single reason, such as a branch that moved on after the submission, or a composition waiting for a checkpoint decision. |
| `integration`                      | `true` when the trunk moved after the Proof, so the landing will combine and check the code in an integration worktree first. A moved trunk alone never makes a row wait.       |
| `operation_handle`                 | The running landing that's checking this submission now. Read it with `discern progress <handle>`.                                                                              |

After a landing, the top-level fields carry the outcome.

- **`data.landing`** records the exact effects: `recovery_performed`, `trunk_landed`, `worktree_removed`, and `branch_deleted`. Resource teardown appears as `resource-destroy` steps, and an unfinished cleanup as an `acceptance-cleanup-incomplete` advisory.
- **`data.landings`** records every landing the call attempted, with the selected submission first.
- **`data.consent`** names the consent source, and **`data.root`** names the surviving checkout, including when acceptance removed the calling worktree.
- **`data.proof_line`** is the landing's final Proof line, to relay word for word. JSON and MCP results carry only this line; the full Proof page appears in terminal output and in `discern status --verbose`.
- **`data.variances`** and **`data.standard_approvals`** list what the landing carried, and **`checkpoint_drops`** keeps classified uncertainty about checkpoint enforcement.
- **`data.scopes_changed`** names the configured scopes the landed paths matched, and **`data.proof_note`** reports the Proof note write and its fetch transport.

A refusal can carry **`data.integration_judgment`**, with the composition receipt under `composition`, the `decision`, and the ids it's `awaiting`. A refusal over a proposed limit change carries **`data.standard_approvals_required`**, with the exact approval tokens. The published schema defines every optional field. For recovery, see [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md#recover-an-interrupted-acceptance).

#### Setup results

An unlanded successful `setup done` carries Proof, the canonical completion inventory, the qualitative `inventory.project_context`, and the landing state. It carries no reactivation or improvement advice. Project context includes the derived handoff for the primary subsystem, the project principles, and the instruction sources.

After a successful `setup accept`, `data.reactivation` carries each provider's exact activation check, local recovery, and command-line fallback, from the provider registry. [Platforms and providers](platforms-and-providers.md#confirm-that-a-tool-loaded-discern) lists them. `data.activation_context` explains why a fresh session is needed, and `data.optional_improvement` depends on activation being verified. A completion already on the trunk shows the same activation steps, in the same order.

A failed `setup done` tells unfinished authoring, uncommitted paths, and an exact owned rollback apart. A transaction names its `stage`, `rollback`, retained `state`, `next_action`, and `recovery`, and nested diagnostics keep their location, rule, and reproduce command.

Applied `setup` and `upgrade` results carry `data.instruction_refresh`. `status: "complete"` means the required instruction refresh finished, even when `compiled` is empty because every file was current. `status: "partial"` makes the top-level `ok` false, and carries the completed files, non-empty failure evidence, `effects_preserved: true`, and `recovery: { command: "discern refresh", safe_to_retry: true }`. A partial result reports the earlier scaffold or migration effects, rather than pretending they rolled back.

#### Plans and executed steps

| Field              | Meaning                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `kind`             | The operation category, such as `job`, `git`, `refresh`, `standard`, or `resource-destroy`. |
| `label`            | A stable name for the command, scope, resource, or lifecycle operation.                     |
| `disposition`      | `run`, `skip`, or `gate` for a read-only precondition.                                      |
| `note` / `group`   | An optional explanation, and a display group.                                               |
| `outcome`          | `ok`, `failed`, `skipped`, or `cancelled`, on an executed step.                             |
| `advisory`         | Present on an explicitly optional failed step, with its kind, evidence, and next action.    |
| `duration_s`       | The duration in whole seconds, when measured.                                               |
| `output_path`      | A best-effort path to the full combined output.                                             |
| `output_lines`     | The number of captured output lines.                                                        |
| `error_like_lines` | The number of lines shaped like compiler or linter diagnostics.                             |

Output metadata is advisory. A configured command's exit status decides the job's verdict, except for standards, where the command's `DISCERN_METRIC` value is the measurement contract.

Gate and standalone standards results carry each standard's `direction`, `limit`, optional `margin`, `measurement`, value, and verdict. A measured or replayed value also carries the gate's `pin_eligible` decision and, when it's true, the exact `pin_target`. Those fields describe mechanical eligibility; patterns applies the decision rule from the project's own history ([ADR 0276](https://discern.sh/docs/decisions/0276-patterns-recommendations-require-project-local-decision-evidence)).

Patterns results always carry `data.investigations`. Each entry cites source ids that stay present in `data.findings`, repeats their observations and denominators with where the numbers came from, and states the shared evidence boundary, a bounded interpretation, a diagnostic action, and what would prove it wrong. An empty array means no registered relationship had enough evidence. Terminal, JSON, MCP, and sealed-archive reads use the same arithmetic ([ADR 0277](https://discern.sh/docs/decisions/0277-patterns-investigations-preserve-source-findings)).

`cancelled` marks a sibling stopped by a fail-fast failure, and fails a required completion. `skipped` marks a configured step that didn't run. A policy can separately treat a user's cancellation as a successful completion with no effect.

#### Diagnostics

Every diagnostic includes `tool`, `severity`, `message`, and `reproduce_cmd`. It can also include normalized `output`, `truncated`, `output_path`, `file`, `line`, `col`, `rule`, and `fix_available`. Use `reproduce_cmd` for the smallest direct rerun, and `output_path` when the inline capture was cut short.

#### Result vocabularies

The published schemas mark every fixed-set result value with `x-discern-vocabulary`. An open vocabulary is published as a string, with its known members at the schema root under the same key, and grows in ordinary releases: treat a value you don't recognize as opaque. A closed vocabulary is published as an enum, and changes only with a new major version of its schema.

The closed vocabularies are step outcome, diagnostic severity, validation mode, checkpoint mode, landing-authority kind, standard proposal direction, completion evidence purpose, requirement kind, and exception state, plus the release comparison's status and publication. Completion evidence purpose appears in the Proof note schema. Every other result vocabulary is open.

- Step `kind` (open): `job`, `scope-gate`, `merge-check`, `standards-limits-check`, `tracked-artifacts-check`, `instructions-check`, `skills-check`, `tracked-refresh-check`, `resource-create`, `resource-destroy`, `git`, `task-metadata`, `setup-step`, `repository-ensure`, `checkout-clean-check`, `setup-ensure`, `env`, `refresh`, `tidy`, `standard`.
- Step `disposition` (open): `run`, `skip`, `gate`.
- Step `outcome` (closed): `ok`, `failed`, `skipped`, `cancelled`.
- Diagnostic `severity` (closed): `error`, `warning`.
- `failed_stage` (open): `fix`, `build`, `check`, `test`, `check/test`, `scope_gates`, `tree_drift`, `generated_drift`, `refresh_drift`, `tracked_artifacts`, `instructions`, `skills`, `skill_frontmatter`, `adr_numbers`, `adr_index`, `map_integrity`, `merge`, `standards`, `write_denied`, `validation_inputs`.
- Advisory `kind` (open): `acceptance-cleanup-incomplete`, `checkpoint-evidence-dropped`, `checkout-clean-observation-unavailable`, `doctor-warning`, `execution-cap-unavailable`, `generated-attribute-pattern-untranslated`, `governing-config-key-ignored`, `ignored-file-observation-unavailable`, `landing-authority-unverified`, `optional-resource-unavailable`, `proof-recording-unavailable`, `setup-unproven-completion`, `setup-machinery-commit-failed`, `setup-marker-commit-failed`, `standards-limits-unverified`, `uninstall-strip-incomplete`.

The registered `error` slugs, published under `x-discern-error-slugs`, are: `active_worktrees`, `ambiguous`, `apply_failed`, `awaiting_consent`, `awaiting_declaration`, `awaiting_standard_approval`, `awaiting_variance`, `below_min_score`, `brief_unparseable`, `checkout_failed`, `checkpoint_evidence_unavailable`, `config_template_unavailable`, `confirmation_required`, `conflict`, `desk_already_active`, `detached_head`, `diagrams_misaligned`, `dirty_worktree`, `edit_failed`, `gate_failed`, `gitignore_template_unavailable`, `identity_failed`, `incomplete`, `internal_error`, `invalid_arguments`, `invalid_config`, `invalid_config_file`, `invalid_migrated_config`, `invalid_settings_file`, `invalid_toml`, `invalid_value`, `no_docs`, `no_map`, `no_project`, `no_repository`, `no_trunk`, `not_main_checkout`, `not_on_setup_branch`, `not_on_trunk`, `partial_acceptance`, `partial_materialization`, `partial_refresh`, `pin_failed`, `precondition_failed`, `proposal_failed`, `proposal_stale`, `provisioned_resources`, `read_failed`, `renamed_command`, `renamed_config_key`, `report_only_proof`, `schema_version_too_new`, `script_not_a_command`, `script_not_executable`, `setup_plan_failed`, `setup_unfinished`, `skills_eject_failed`, `tables_malformed`, `templates_not_found`, `tidy_parse_failed`, `tidy_write_failed`, `unchanged_tree_rerun`, `unknown_category`, `unknown_command`, `unknown_key`, `unknown_standard`, `unknown_step`, `unknown_target`, and `write_denied`.

### Model Context Protocol resources

| URI                                             | Payload                                           |
| ----------------------------------------------- | ------------------------------------------------- |
| `discern://status`                              | Live, bounded status orientation data.            |
| `discern://impact`                              | Current scope-impact data.                        |
| `discern://config`                              | The resolved `discern.toml` data.                 |
| `discern://docs` and `discern://docs/{+target}` | The manual's index, or one manual page.           |
| `discern://map` and `discern://map/{+target}`   | The project map's index, or one project-map page. |

`{+target}` accepts a slug, `section/slug`, or a path. discern computes a resource when it's read, and a client that doesn't attach resources automatically can call the matching tool instead. The MCP tools manifest lists every resource and resource template by name, kind, and URI, and none of those change within a major version.

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

In the quiet result modes, a result with `ok: false` always exits nonzero; a verb can't report exit `0` for a failed completion contract. A nonzero exit doesn't always mean `ok: false`: a `discern await --json` that reaches its budget exits `124` with `ok: true`. Predicates run with `--json` or `--markdown` always exit `0`, and their boolean is in `data`. Bare `config has` and `impact --has` stay silent, and exit `0` or `1`. `identity` and config reads are bare unless `--json` or `--markdown` asks for a result.

### Published schemas and types

<!-- BEGIN GENERATED: public schema publications -->
<!-- This table is generated from the public-schema registry. -->

| Schema                       | Public `$id`                                                    | Repository artifact                                                                                                                  | Contract                                                                                                                                                     | Same-major changes                                                                                                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release comparison           | <https://discern.sh/schema/v1/discern-releases.schema.json>     | [`schema/discern-releases.schema.json`](https://github.com/discern-sh/discern/blob/main/schema/discern-releases.schema.json)         | Stable recommendations and classified release history shared by HTML, text, and JSON.                                                                        | Same-major releases may add optional fields, new contracts, and members of any open vocabulary. A closed decision vocabulary changes only with a new major. Members marked evolving may change in any release.                                                                       |
| `discern.toml` configuration | <https://discern.sh/schema/v1/discern-config.schema.json>       | [`schema/discern-config.schema.json`](https://github.com/discern-sh/discern/blob/main/schema/discern-config.schema.json)             | Every section, key, and value type the engine validates, with evolving sections marked.                                                                      | Same-major releases may add optional keys, sections, and enum members. Existing keys, types, and defaults stay. Sections marked evolving may change in any release.                                                                                                                  |
| Setup config document        | <https://discern.sh/schema/v1/discern-setup-config.schema.json> | [`schema/discern-setup-config.schema.json`](https://github.com/discern-sh/discern/blob/main/schema/discern-setup-config.schema.json) | The bounded setup recipe consumed only by `setup begin --config`.                                                                                            | Same-major releases may add optional keys, sections, and enum members. Existing keys, types, and defaults stay. Sections marked evolving may change in any release.                                                                                                                  |
| Result contracts             | <https://discern.sh/schema/v1/discern-results.schema.json>      | [`schema/discern-results.schema.json`](https://github.com/discern-sh/discern/blob/main/schema/discern-results.schema.json)           | Every CLI `--json` and MCP tool result envelope, with open vocabularies published as strings, closed vocabularies enumerated, and evolving contracts marked. | Same-major releases may add optional fields, new contracts, and members of any open vocabulary. A closed decision vocabulary changes only with a new major. Members marked evolving may change in any release.                                                                       |
| Landing Proof note           | <https://discern.sh/schema/v1/discern-proof-note.schema.json>   | [`schema/discern-proof-note.schema.json`](https://github.com/discern-sh/discern/blob/main/schema/discern-proof-note.schema.json)     | The Proof envelope acceptance attaches to a landed commit, using the Dead Simple Signing Envelope (DSSE) field and payload boundary.                         | Same-major releases may add optional fields, new contracts, and members of any open vocabulary. A closed decision vocabulary changes only with a new major. Members marked evolving may change in any release.                                                                       |
| MCP tools manifest           | <https://discern.sh/schema/v1/discern-mcp-tools.json>           | [`schema/discern-mcp-tools.json`](https://github.com/discern-sh/discern/blob/main/schema/discern-mcp-tools.json)                     | Tool names, request schemas, and safety annotations, plus every resource name, kind, and URI; listing order and descriptive text are not promised.           | Same-major releases may update documentation, add tools, resources, and optional inputs, and add accepted input values. Existing identities, URIs, safety annotations, and requests stay compatible. Listing order is not promised. Tools marked evolving may change in any release. |
| CLI grammar manifest         | <https://discern.sh/schema/v1/discern-cli.json>                 | [`schema/discern-cli.json`](https://github.com/discern-sh/discern/blob/main/schema/discern-cli.json)                                 | Command paths, aliases, positional arguments, flags, option value counts and types, defaults, and visibility; listing order is not promised.                 | Same-major releases may update help, add commands, aliases, and options, add accepted values, and append optional positional arguments. Existing grammar stays. Listing order is not promised. Commands marked evolving may change in any release.                                   |
| Conventions manifest         | <https://discern.sh/schema/v1/discern-conventions.json>         | [`schema/discern-conventions.json`](https://github.com/discern-sh/discern/blob/main/schema/discern-conventions.json)                 | Frozen environment, skill, Git, checkpoint, identity, provider, hook, and format conventions; private format revisions are independent.                      | Same-major releases may add names; published existing values are immutable. Private format versions are not published here.                                                                                                                                                          |

<!-- END GENERATED: public schema publications -->

`types/discern-json.d.ts` in the matching release source archive provides release-pinned standalone TypeScript types, indexed by verb, command path, and MCP tool name. Each per-verb type intersects with `DiscernResultState`, so narrowing `ok` also narrows `error`, and planned and completed steps can't coexist. The result schema's `x-discern-contracts` metadata publishes each registered command's `completion_policy`, including its `required_postconditions`, `optional_advisories`, and its policy for refusal, cancellation, partial effects, no-ops, and who owns recovery.

#### Compatibility by schema version

The [Compatibility](compatibility.md) page explains what each published contract promises across releases: the schema majors, the evolving members, the open and closed vocabularies, and the retirement rule. This section keeps the result-shape facts that page doesn't carry.

`data.instruction_refresh.status: "partial"` means a required refresh failed, even when earlier setup or upgrade effects remain. A successful `setup accept` with nothing to land carries `data.completion = { status: "no_op", reason }`, where `reason` tells `no_git_repository` apart from `already_on_target`.

The schemas use JSON Schema Draft 2020-12. Use the artifacts from the release you integrate with: the release source contains `types/discern-json.d.ts`, and the result schema publishes the `x-discern-contracts` metadata.
