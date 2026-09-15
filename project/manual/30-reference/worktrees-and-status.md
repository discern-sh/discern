---
id: reference-worktrees-and-status
title: "Worktrees and status"
description: "Find the current state of a task, interpret a status field, or look up the identity and environment values for its workspace."
order: 100
publish: true
kind: reference
aliases:
  - "reference-worktrees-and-status"
  - "Checkout identity and environment"
  - "worktree identity"
  - "worktree port"
  - "inherit env"
  - "Status and session hints"
  - "worktree status"
  - "fleet status"
  - "session findings"
  - "data.queue"
---

# Worktrees and status

Find the current state of a task, interpret a status field, or look up the identity and environment values for its workspace.

| Find                                               | Go to                                                       |
| -------------------------------------------------- | ----------------------------------------------------------- |
| The next action for a task                         | [Status and session hints](#status-and-session-hints)       |
| Release information and reminders                  | [Release information](#release-information)                 |
| A status field or a missing result                 | [Structured result](#structured-result)                     |
| A task's port, branch, resource name, or test seed | [Read the derived identity](#read-the-derived-identity)     |
| Which environment values a new worktree receives   | [Inherit selected env values](#inherit-selected-env-values) |

Status requires a discern project. Linked-worktree lifecycle fields require a Git repository with at least one commit. For a practical introduction, read [Worktrees and the trunk](../20-understand/worktrees-and-trunk.md).

## Status and session hints

`discern status` reports the task's current state and next action. It runs no gate job, test, standard measurement, or setup action. Use it at the start of a session or when you need to understand what remains.

| Status option      | Use it to                                                 |
| ------------------ | --------------------------------------------------------- |
| No options         | Read the current checkout and its next action.            |
| `--all`            | Include other tasks when running from a worktree.         |
| `--local`          | Read only the current checkout.                           |
| `--verbose`        | Expand the terminal report, including stored Proof pages. |
| `--markdown`       | Read the authored Markdown summary.                       |
| `--json`           | Read the bounded structured result.                       |
| `--verbose --json` | Get complete structured collections and landing history.  |
| `--no-color`       | Keep the same facts without color.                        |

`--all` and `--local` conflict. MCP callers use `discern_status` with the matching options and an absolute `path` when selecting a particular worktree.

### Human dashboard

Worktrees default to a local view. The main checkout shows its state, fleet task rows, the **Landing queue**, **Owner attention**, **Landing risks**, and **Next action**. `--verbose` adds per-task evidence, configured checks, local environment, landing history, shared paths, and stored Proof pages.

The **Landing queue** lists every submission with honored Proof that has not landed: tasks a grant pre-authorizes first, in grant order, then tasks awaiting the owner, in submission order. Each line carries the task's branch and, when it cannot land yet, one sentence saying why: its branch moved on after the submission, so its agent runs `discern done` then `discern accept` for the new work; or its retained composition awaits a checkpoint decision, with the continuation named. A trunk that merely moved after its Proof is not a waiting reason — acceptance composes and checks the combined code itself. The current worktree's own task is marked. A failed or abandoned run, or a run its agent never submitted, has no line. The desk and the acceptance preview derive their lists from the same projection, so the surfaces show the same tasks in the same order.

The report uses stored task titles when available; `--verbose` reveals complete worktree and branch identities. Use the stable id or branch in commands, even when a friendlier title appears in the report.

Rows prioritize live, stale, or uncommitted work while still showing branch drift. Shared-file and Architecture Decision Record (ADR) number collisions remain separate landing risks.

The other fields explain that status:

- **Git** says `clean` or `6 files changed`; **DRIFT** keeps `↑8`, `↓3`, or both. Color reinforces the complete arrow-and-count text.
- **Proof** is honored, report-only, missing, stale, dirty worktree, unavailable, or unreadable. Report-only means the commit is current but CI reported checkpoint review without enforcing it; ordinary `discern done` is still required before landing. A clean branch with an honored strict Proof can be ready.
- **Activity** shows the most recent observed activity and recorded action. A live gate reads `Gate running · 2m`; `usually 4m` is historical context.
- **Landing** is granted, needs approval, or scope-limited on ready rows; detail wraps below it.

Text and glyphs carry every state; `--no-color` changes no facts.

**Owner attention** holds lifecycle and landing decisions; **Landing risks** holds file, trunk, and ADR conflicts; **Next action** holds the executable continuation. `--verbose` adds evidence.

In the expanded view, **Checks** shows configured changed scopes, each changed scope's configured preview command, planned gate jobs, and a standards count. It labels preview commands as not run. Derived `code` and `previewable` markers stay machine-only. Port and resources sit under **Local environment**. **Landing** shows pass, branch, files changed, diff size, commit, and age. **Proofs** contains stored Proof Markdown.

```sh
discern status
discern status --all
discern status --local
discern status --verbose
discern status --markdown
discern status --json
discern status --verbose --json
discern status --no-color
```

During setup, this read-only result reports the recorded phase, dedicated branch, and bounded continuation. It performs no write probe; the later effectful command checks its own targets ([Setup command boundaries](../40-troubleshooting/setup-and-integrations.md)).

### Structured result

CLI JSON, MCP `structuredContent`, and the status resource use the same structured fields. The default is a bounded view for orientation; request full collections when a decision depends on entries outside that sample.

| Field                                                 | Contract                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.project`, `location`, `root`, `worktree`, `git` | Identify the project, checkout, and observed Git state.                                                                                                                                                                                                 |
| `data.projection.mode`                                | `orientation` by default; `full` with verbose structured status.                                                                                                                                                                                        |
| `data.projection.omitted`                             | True overflow counts for capped collections, under dotted paths with zero-based indexes. Present omissions are positive.                                                                                                                                |
| `data.fleet`                                          | In orientation mode, the main row plus at most six non-main samples.                                                                                                                                                                                    |
| `data.fleet_total`                                    | The complete non-main task count, including omitted rows.                                                                                                                                                                                               |
| `data.queue`                                          | The landing queue in order: one row per submission with honored Proof that has not landed. Each row carries `effort`, `branch`, 1-based `position`, the submitted commit, whether a grant covers it, and one `reason` sentence when it cannot land yet. |
| `data.release_reminder`                               | Optional clone-local advisory; does not change health or establish update availability.                                                                                                                                                                 |
| `data.operation`                                      | Present while a long operation this checkout started is still running: its `verb`, `branch`, the `discern progress` `handle` that reads it back, and the `latest` sentence it recorded.                                                                 |
| `data.fleet[].landed_checkout`                        | Present when that task's submitted commit has landed and its worktree stayed: one `message` with why it stayed and the command that finishes cleanup.                                                                                                   |
| `data.pending_tracked_refresh`                        | Tracked paths that ordinary refresh would change.                                                                                                                                                                                                       |
| `data.tracked_refresh_plan_errors`                    | Failures deriving that refresh plan.                                                                                                                                                                                                                    |
| `data.gate_proof`                                     | The current Proof inspection and compact evidence when available.                                                                                                                                                                                       |
| `data.landed_proof`                                   | A readable local or fetched Proof note for the trunk tip.                                                                                                                                                                                               |
| `data.landed_exception`                               | The trunk tip landed as an emergency, with no passing Proof: the `reason`, the number of skipped checks (`exceptions`), and `validation` (`outstanding` until a later complete run settles them, then `resolved`).                                      |

Repeated orientation collections retain at most six members; landing history is omitted. `discern status --verbose --json` or MCP `verbose: true` selects `mode: "full"`, restores complete collections and landing history, and removes the omission map. Every default result includes this route to full detail.

Both structured modes omit rendered Proof pages. Terminal `--verbose` displays those pages. Full structured `landed_proof.proof` remains compact, and `landed_proof.commit_at` supplies the landing age when Git can read it.

MCP `content` and `discern status --markdown` provide an authored summary of the same state. Owner attention separates decisions for the owner from the reading agent's next action. An idle or clean task in the fleet remains a separate effort; its row grants no permission to take over its worktree.

#### Git and Proof states

Ahead and behind counts are non-negative integers when known, `"unknown"` after a failed or malformed count, and `null` on local status when the trunk is missing. Missing evidence cannot establish readiness or containment.

Proof inspection reports `honored`, `report_only`, `missing`, `stale`, `dirty`, `unavailable`, or `read_failed`. An honored marker includes compact facts: branch, trunk, validated commit, diff counts, and line. Report-only evidence cannot be used for landing. The validated commit is the worktree's own committed tip; [Proof](../20-understand/proof.md#the-exact-commit-it-covers) explains what it covers.

Dirty, behind, and missing-Proof states are observations and can still return `ok: true`. A status operation that cannot complete returns its own failure. Read the reported task state separately from whether the status command succeeded.

#### Fleet rows and activity

Each sampled fleet row carries its own available recovery facts: Git registration, branch reachability, filesystem presence, cleanliness, divergence, setup-ready marker, journal, and repair classification. A failed Git read retains the command and diagnostic. Unavailable facts stay absent or explicitly unavailable.

Readable rows also carry activity, one `gate_proof`, and authority. `task` holds the display title, `title_source`, optional brief, and creation ref and commit. `title_source: "identity-fallback"` identifies a worktree without stored task metadata. Structured fleet rows omit the earlier `proof_honored`, `proof`, and `proof_line` compatibility copies.

Authority includes the current decision, up to six authored-first path examples, uncovered totals, and scopes. This summary does not grant authority beyond the underlying recorded permission.

`last_action` records the newest completed action. `running` records a recent start with no matching completion. `last_activity` uses the later Git or logbook time. Disabling the logbook removes action fields while Git activity remains available.

`fleet_collisions` pairs branches with overlapping changed files and retains the shared-file count. `adr_collisions` identifies contested Architecture Decision Record numbers and claimant branches, including branches without worktrees. Structured results omit their path lists; terminal `--verbose` shows them. A later `discern update` names overlapping paths to re-read.

#### Recovery records

| Field                       | What it records                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `emergency_validation`      | Validation still owed after an explicitly approved emergency landing.                   |
| `parked_tasks`              | Retained branch commit, park time, and task wording for a later `discern start --from`. |
| `parked_tasks_unavailable`  | Failure reading parked-task records; the underlying unlanded branches remain visible.   |
| `recent_completed_tasks`    | A bounded tail from successful acceptance events and the latest landed Proof.           |
| `reappeared_worktree_paths` | Removed worktree paths that exist again without live Git registration.                  |

A reappeared-path row carries `path`, `removed_at`, `kind`, `entries`, a bounded `contents` sample, and `cleanup_blocked_reason` when prune must preserve it. Cleanup appears under Owner attention; status itself performs no cleanup. [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md) gives the practical procedure for an interrupted landing.

### Session findings

After setup, detectors can add recent logbook observations to `hints[]`. They inspect at most 200 events and exclude CI, previews, human activity, and other branches. Findings change no Git fact, gate result, Proof, exit code, or `ok`; setup in progress and a disabled logbook suppress them. Run `discern patterns` for retained evidence ([ADR 0160](https://discern.sh/docs/decisions/0160-local-logbook-advisory-readers)).

### Current state and gotchas

- `status` never runs the gate. A valid Proof links the current clean commit to its complete evidence.
- Fleet worktrees belong to separate efforts. A clean sibling remains occupied until its owner lands or discards it; its maintenance state appears under Owner attention.
- A reappeared worktree path is no longer an active fleet member. Review its contents and close any program still writing there before confirmed prune.
- The dashboard and Markdown result are projections. Default JSON and MCP are also bounded for orientation; request verbose structured status only when exact full collections are needed.

## Release information

In the desk, **Desk commands** includes **Check for updates**, including when no tasks exist. Selecting it opens release information in your browser and sends this running process's version number to `discern.sh`. Its result keeps the URL readable if the launcher fails. Escape returns to the live desk.

A clone-local reminder may appear beside the action after 14 UTC calendar days. It does not change task sorting or indicate that an update is available. Status routes the same eligibility as an agent hint; doctor keeps it advisory without changing health. [The maintenance guide](../10-guides/maintain-or-remove-discern.md#check-release-information) explains checking, installation, and local timestamps.

## Checkout identity and environment

A worktree has a stable identity used to derive its development port, resource names, and test-order seed. Moving the checkout preserves that identity.

### Read the derived identity

Run `discern identity` in the main checkout or a linked worktree and select the value you need:

| Selector            | Value                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| `--id`              | Stable checkout id.                                                                   |
| `--branch`          | Full branch name: `<branch_prefix><id>` for a worktree, the configured trunk on main. |
| `--port`            | `17290 + cksum(id) % 2000`.                                                           |
| `--seed`            | POSIX `cksum` of the full branch name, without a trailing newline.                    |
| `--site`            | Domain Name System (DNS)-safe `<project-slug>-<id>`, fitted to 63 characters.         |
| `--db`              | Database-safe `<project_slug>_<id>`.                                                  |
| `--worktree`        | Generic `<project-slug>-<id>` handle.                                                 |
| `--resource <name>` | `<project-slug>-<id>-<name>` for one declared resource.                               |
| `--resources`       | Every declared resource as `name=handle`.                                             |

| Identity limit                     | Exact boundary                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Generated name slug                | At most 40 characters before the six-hex-character uniqueness tail.                                      |
| `DISCERN_WORKTREE_ID` override     | 1–81 characters; first character alphanumeric, remainder letters, numbers, dots, dashes, or underscores. |
| Port band                          | 2,000 ports, `17290` through `19289`.                                                                    |
| `--site`                           | One DNS label of at most 63 characters; overlong id tails are hash-fitted.                               |
| `--db`, `--worktree`, `--resource` | No product length clamp. Apply the destination system's limit; use `--site` for a DNS label.             |

A linked worktree resolves its id from `DISCERN_WORKTREE_ID`, configured environment files, then Git metadata. Overrides accept letters, numbers, dots, dashes, and underscores. This read-only precedence never grants destructive ownership: cleanup uses the exact Git worktree entry plus discern's ready marker.

Main identity uses the configured trunk and preserves it in `--branch`. Its seed changes only with that setting. Worktree seeds stay stable by branch; branches rotate order. Neither uses the clock nor secure entropy.

`discern start` avoids trunk and live-sibling port collisions when possible. A crowded band or racing starts may collide; change `DISCERN_WORKTREE_ID` then.

### Task title and brief

A task's display title and optional brief are human metadata, kept separate from the stable identity above. New starts store them with the creation ref and resolved commit in the worktree's Git administrative directory (`discern/task-metadata.json`), and `discern worktree rename <title>` changes only the title. Status shows the stored title when one exists; a worktree from an older discern reports `title_source: "identity-fallback"` and keeps its id-derived label. Removing the worktree deletes its local record. A landing removes the worktree when its branch holds nothing beyond the landed submission. `discern worktree park` copies the wording into a branch-keyed record that a later `discern start --from` consumes ([ADR 0356](https://discern.sh/docs/decisions/0356-task-metadata-follows-the-worktree-identity), [ADR 0358](https://discern.sh/docs/decisions/0358-recovery-observes-before-repair-and-park-preserves-the-branch)).

### Inherit selected env values

`[worktree].env_files` lists env-style files in precedence order. The default is `[".env", ".env.local"]`. Reads use the last file that defines a key. Writes update that last definition or place a new key in the first existing listed file. When creation is requested and none exists, discern creates the first listed file.

Each entry may use any portable project-relative filename. It does not need an `.env` basename. discern removes leading `./` prefixes and refuses entries that name the same case-insensitive path.

Reads may follow a symbolic link when its target stays inside the project. A missing or stale checkout, an unreadable file, or a link that leaves the project behaves as an absent env file. Before writing, discern refuses every symbolic-link component instead of modifying its target; configure the target path directly or replace the link with a regular file.

`[worktree].inherit_env` names values copied from the main checkout into a new worktree. Inheritance creates the first env file when it is missing, so every declared value arrives. It copies only the named keys. The rest of the main checkout's local env stays there.

The configured env files can carry the values listed in the [environment-variable reference](environment-variables.md#worktree-environment). `[worktree].port` defaults to `false`; set it to `true` when project tooling reads the development-port value. The lifecycle records that value only when the setting is on and an env file exists. `discern identity --port` and the `@port@` setup token remain available either way. Resource handles are recorded when an env file exists. The id remains an optional override supplied by the project or user.

Identity commands work without an env file. Status, its Model Context Protocol (MCP) projection, and its resource expose the current checkout. Fleet rows derive each checkout's own id and port.

### Use tokens during setup

Resource and setup commands receive `@worktree@`, `@db@`, `@site@`, `@port@`, `@project_slug@`, and `@dir@`. Resource commands also receive `@resource@`. The setup lifecycle writes inherited values and identity handles before one-time setup commands, then writes them again afterward. A command such as `cp .env.example .env` cannot erase the values setup delivered ([ADR 0059](https://discern.sh/docs/decisions/0059-worktree-setup-ensure)).

### Current state and gotchas

- The port, site tail, database name, and test seed use the frozen Portable Operating System Interface (POSIX) `cksum` derivation. Changing it changes existing checkout coordinates or test order.
- `@resource@` has no DNS length limit. Use `@site@` for a 63-character DNS label.
- An env override applies only to the process's own worktree. Inspecting another path still resolves that target's identity.
- The seed provides deterministic test-order replay. It carries no randomness or security meaning.

## Implementation references

These source links are for readers extending or contributing to discern.

### Where it lives in code

| Concern                               | Source                                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Status facts and hints                | [`status.ts`](https://github.com/jackwh/discern/blob/main/src/engine/status/status.ts)                                 |
| Pure package-component adaptation     | [`tty.ts`](https://github.com/jackwh/discern/blob/main/src/engine/status/tty.ts)                                       |
| Shared terminal facts and safe text   | [`terminal.ts`](https://github.com/jackwh/discern/blob/main/src/lib/terminal.ts)                                       |
| Result and Proof schemas              | [`result_schemas.ts`](https://github.com/jackwh/discern/blob/main/src/shared/result_schemas.ts)                        |
| Human and machine hint routing        | [`hints.ts`](https://github.com/jackwh/discern/blob/main/src/shared/hints.ts)                                          |
| Width, degradation, and state matrix  | [`engine_status_tty_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_status_tty_test.ts)             |
| End-to-end status behavior            | [`engine_status_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_status_test.ts)                     |
| Terminal-observation structural guard | [`terminal_boundary_guard_test.ts`](https://github.com/jackwh/discern/blob/main/tests/terminal_boundary_guard_test.ts) |

### Where it lives in code

| Responsibility                        | Source                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity derivation and id resolution | [`src/engine/worktree/identity.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/identity.ts)                           |
| Destructive ownership predicate       | [`src/engine/worktree/ownership.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/ownership.ts)                         |
| Env-file precedence and writes        | [`src/engine/worktree/env_file.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/env_file.ts)                           |
| Contained read and write paths        | [`src/shared/project_path.ts`](https://github.com/jackwh/discern/blob/main/src/shared/project_path.ts)                                     |
| Runtime tokens                        | [`src/engine/worktree/tokens.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/tokens.ts)                               |
| Frozen parity fixtures                | [`tests/fixtures/parity/worktree-identity.json`](https://github.com/jackwh/discern/blob/main/tests/fixtures/parity/worktree-identity.json) |
