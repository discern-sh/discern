---
id: reference-worktrees-and-status
title: "Worktrees and status"
description: "Look up what discern status reports about each task, what every status field means, and the identity and environment values each worktree gets."
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

`discern status` shows you and your agent where every task stands and what it needs next, without running any of your project's commands. This page defines what it reports, and the identity and environment values each worktree gets, such as its own development port. A **worktree** is a separate copy of the project, on its own branch, where one task happens, and finished work lands on the **trunk**, your project's shared branch.

Say your agent is building recipe search in its own worktree while you work in the main checkout. The sections below follow that task through status, the landing queue, and the values its worktree derives. Status needs a discern project, and the worktree fields need a Git repository with at least one commit. For the ideas behind worktrees, read [Worktrees and trunk](../10-understand/worktrees-and-trunk.md).

| Find                                               | Go to                                                       |
| -------------------------------------------------- | ----------------------------------------------------------- |
| A task's next action                               | [Status and session hints](#status-and-session-hints)       |
| What the desk can do with a task                   | [Desk actions](#desk-actions)                               |
| A status field, or why a result left entries out   | [Structured result](#structured-result)                     |
| Release information and update reminders           | [Release information](#release-information)                 |
| A task's port, branch, resource name, or test seed | [Read the derived identity](#read-the-derived-identity)     |
| Which environment values a new worktree receives   | [Inherit selected env values](#inherit-selected-env-values) |

## Status and session hints

`discern status` reports the current state of each task and its next action. It runs no [gate](glossary.md#gate) job, test, standard measurement, or setup action, so it's cheap to run at the start of a session, or whenever you need to know what's left.

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

| Option             | Use it to                                                                              |
| ------------------ | -------------------------------------------------------------------------------------- |
| No options         | Read the current checkout and its next action.                                         |
| `--all`            | Include the other tasks when you run it from a worktree.                               |
| `--local`          | Read only the current checkout.                                                        |
| `--verbose`        | Expand the terminal report, including stored [Proof](../10-understand/proof.md) pages. |
| `--markdown`       | Read the authored Markdown summary.                                                    |
| `--json`           | Read the bounded structured result.                                                    |
| `--verbose --json` | Get complete structured collections and landing history.                               |
| `--no-color`       | See the same facts without color.                                                      |

`--all` and `--local` can't be combined. Over the Model Context Protocol (MCP), your agent calls `discern_status` with the matching options, plus an absolute `path` to select a particular worktree.

While setup is unfinished, status reports what's left in `data.setup_unfinished`: the setup markers still pending, which known jobs are wired, and the assurance counts, and its hint names the next setup command. Status doesn't test whether it could write anything, because the next command that changes files checks its own targets ([Setup and integrations](../40-troubleshooting/setup-and-integrations.md)).

### The terminal report

What the report shows depends on where you run it:

- **In the main checkout, with other tasks:** a row for each task, then the **Landing queue**, **Owner attention**, **Landing risks**, and **Next action** sections. `--verbose` adds the Checks, Local environment, and Landing sections, and the stored Proof pages. Here, Checks shows only the count of standards.
- **In a worktree, or in a main checkout with no other tasks:** the current checkout, with its Checks, Local environment, and Landing sections. `--verbose` adds the stored Proof pages.

| Section               | What it holds                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Landing queue**     | Submitted changes that haven't landed yet, in landing order.                                                                                           |
| **Owner attention**   | Lifecycle and landing decisions that need you.                                                                                                         |
| **Landing risks**     | Conflicts over files, the trunk, or Architecture Decision Record (ADR) numbers.                                                                        |
| **Next action**       | The command that continues the work.                                                                                                                   |
| **Checks**            | The changed scopes, each one's configured preview command, the planned gate jobs, and the count of standards. Preview commands are labeled as not run. |
| **Local environment** | The port and resources.                                                                                                                                |
| **Landing**           | The last landing: its pass, branch, files changed, diff size, commit, and age.                                                                         |
| **Proofs**            | The stored Proof pages.                                                                                                                                |

The derived `code` and `previewable` markers behind the Checks section appear only in structured results.

The **Landing queue** lists every submitted change, in a registered worktree, whose commit hasn't landed. Tasks that a **grant**, permission you recorded in advance, lets land once green come first, in grant order, and tasks waiting for you follow, in submission order. Each line shows the task's branch, and the current worktree's own task is marked. Once your agent submits the recipe search change, its line reads:

```text
• Queue 1: agent/recipe-search-0a7563 at 7e53aed63bb8 — awaiting the owner; ready.
```

It's ready, and it waits for your decision because no grant covers it. When a task can't land yet, its line adds one sentence saying why:

- a running landing is checking its combined code now, with the `discern progress` handle when there is one;
- its retained composition raised a [checkpoint](glossary.md#checkpoint) question, or carries an unmet checkpoint that needs your decision, and the line says to run `discern accept` from its worktree;
- the submission names a different commit from the branch's valid Proof, so its agent runs `discern accept queue` to queue the proven commit, or `discern accept` to submit and start landing;
- its Proof can't be read, so its agent runs `discern done`, then `discern accept`;
- its branch moved on after the submission, so its agent runs `discern done`, then `discern accept`, for the new work;
- a later strict gate run judged the submitted commit red, so its agent fixes the failure and runs `discern done --rerun`, then `discern accept`;
- the strict verdict for the submitted commit can't be read, so its agent runs `discern done`, then `discern accept`.

A trunk that only moved after the Proof isn't a reason to wait, because acceptance checks the combined code itself. A run its agent never submitted has no line. The desk and the acceptance preview build their lists from the same source, so every view shows the same tasks in the same order.

The report uses a task's stored title when it has one, like `recipe-search`, and `--verbose` shows the complete worktree and branch names. Use the stable id or the branch name in commands, even when the report shows a friendlier title.

Rows are ordered by status, so problems come first: broken, setup incomplete, unreadable, and failed. Then come blocked, behind, ready, running, stale, and in progress, then Proof unreadable, Proof unavailable, Proof stale, needs gate, and idle. Within a status, the current checkout comes first, then the most recent activity. Overlapping file changes and contested ADR numbers appear separately, as landing risks.

Once the recipe search task passes the gate, its row in the main checkout's report reads:

```text
• recipe-search · ✓ Ready · DRIFT ↑1 · Activity: just now · last action done ok
```

The row gives the task's title, its status, how far its branch has moved from the trunk (one commit ahead, none behind), and its latest activity.

Each task row reports:

- **Git:** `clean` or, for example, `6 files changed`. **DRIFT** shows `↑8`, `↓3`, or both. Color only reinforces the arrow and count.
- **Proof:** honored, report-only, missing, stale, dirty worktree, unavailable, or unreadable. Report-only means the commit is current, but CI reported checkpoint review without enforcing it, so the task still needs an ordinary `discern done` before it can land. A clean branch with honored strict Proof can be ready, like the recipe search row.
- **Activity:** the most recent observed activity and recorded action. A running gate reads `Gate running · 2m`, and `usually 4m` gives the usual time from history.
- **Landing:** on a ready row, granted, needs approval, or scope-limited, with the detail on the line below.

Text and symbols carry every state, so `--no-color` changes no facts.

### Desk actions

The **desk** is the interactive view that bare `discern` opens in the main checkout, and it offers these actions for a selected task. Each row names the command behind the action and the confirmation it asks for. Granting and revoking pre-authorization have no command outside `discern desk`, so you record a grant for one task from the desk.

<!-- BEGIN DESK ACTION REGISTRY -->

| Id             | Group  | Contextual label                                                       | Command evidence                     | Confirmation                                                     |
| -------------- | ------ | ---------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| `recovery`     | Work   | Show recovery steps                                                    | `discern status --all`               | None                                                             |
| `retry_setup`  | Manage | Retry setup                                                            | `discern worktree setup`             | No by default; Retry                                             |
| `done`         | Work   | Run final checks                                                       | `discern done`                       | No by default; Run                                               |
| `accept`       | Review | Accept and land now                                                    | `discern accept`                     | No by default; Land                                              |
| `submit`       | Review | Join the landing queue                                                 | `discern accept queue`               | No by default; Queue                                             |
| `update`       | Manage | Update branch from &lt;trunk&gt;                                       | `discern update`                     | No by default; Update                                            |
| `agent`        | Work   | Start or resume agent                                                  | `<configured-agent>`                 | None                                                             |
| `follow_up`    | Work   | Start a follow-up from this task                                       | `discern start --from <branch>`      | None                                                             |
| `scripts`      | Work   | Project Scripts                                                        | `discern scripts <name>`             | No by default; Run                                               |
| `jump`         | Work   | Open a shell                                                           | `<user-shell>`                       | None                                                             |
| `inspect`      | Review | Proof and changes                                                      | `git diff`                           | None                                                             |
| `rename`       | Manage | Change task title                                                      | `discern worktree rename <title>`    | No by default; Change                                            |
| `grant`        | Manage | Pre-authorize landing once green                                       | `discern desk`                       | No by default; Allow                                             |
| `revoke_grant` | Manage | Revoke pre-authorization                                               | `discern desk`                       | No by default; Revoke                                            |
| `reclaim`      | Manage | Reclaim checkout, keep branch (work contained in &lt;later-branch&gt;) | `discern worktree prune --contained` | No by default; Reclaim                                           |
| `park`         | Manage | Park checkout, keep branch                                             | `discern worktree park <path>`       | No by default; Park                                              |
| `drop`         | Danger | Drop                                                                   | `discern worktree drop <path>`       | No by default; Drop, then type the branch before discarding work |

<!-- END DESK ACTION REGISTRY -->

### Structured result

CLI JSON, MCP `structuredContent`, and the status resource carry the same structured fields. By default they give a bounded view for orientation, so when a decision depends on entries outside that sample, request the full collections.

| Field                                                 | Contract                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data.project`, `location`, `root`, `worktree`, `git` | The project, the checkout, and the observed Git state.                                                                                                                                                                                                                                                                                                                    |
| `data.projection.mode`                                | `orientation` by default; `full` with verbose structured status.                                                                                                                                                                                                                                                                                                          |
| `data.projection.omitted`                             | The true overflow count for each capped collection, under dotted paths with zero-based indexes. Every count present is positive.                                                                                                                                                                                                                                          |
| `data.fleet`                                          | In orientation mode, the main row plus at most six other rows.                                                                                                                                                                                                                                                                                                            |
| `data.fleet_total`                                    | In orientation mode, the complete count of tasks outside the main checkout, including omitted rows.                                                                                                                                                                                                                                                                       |
| `data.queue`                                          | The landing queue in order: one row per submitted change whose commit hasn't landed. Each row carries the task, its branch, worktree, and submitted commit, its 1-based `position`, whether a grant covers it, its `readiness`, and one `reason` sentence when it can't land yet. [MCP and results](mcp-and-results.md#completion-and-landing-results) lists every field. |
| `data.release_reminder`                               | Optional reminder recorded in this clone. It doesn't change health, and doesn't mean an update is available.                                                                                                                                                                                                                                                              |
| `data.managed_version`                                | The running version, the project's adoption version when recorded, and their SemVer comparison. A missing adoption version makes no claim.                                                                                                                                                                                                                                |
| `data.managed_currency_unavailable`                   | The running binary is older than the project's adoption, so discern can't verify that the managed templates are current. Advisory in status and doctor.                                                                                                                                                                                                                   |
| `data.operation`                                      | Present while a long operation this checkout started is still running: its `verb`, `branch`, the `discern progress` `handle` that reads it back, and the `latest` sentence it recorded.                                                                                                                                                                                   |
| `data.pending_tracked_refresh`                        | Tracked paths that an ordinary refresh would change.                                                                                                                                                                                                                                                                                                                      |
| `data.tracked_refresh_plan_errors`                    | Failures while working out that refresh plan.                                                                                                                                                                                                                                                                                                                             |
| `data.gate_proof`                                     | The current Proof inspection, with compact evidence when available.                                                                                                                                                                                                                                                                                                       |
| `data.landed_proof`                                   | In full mode only, a readable local or fetched Proof note for the trunk tip.                                                                                                                                                                                                                                                                                              |
| `data.landed_exception`                               | The trunk tip landed as an emergency, with no passing Proof: the `reason`, the number of skipped checks (`exceptions`), and `validation` (`outstanding` until a later complete run settles them, then `resolved`).                                                                                                                                                        |

In orientation mode, each repeated collection keeps at most six members, and the result leaves out landing history. `discern status --verbose --json`, or MCP `verbose: true`, selects `mode: "full"`. That restores the complete collections and landing history, and removes the omission map. Every default result names this route to full detail.

Neither structured mode includes rendered Proof pages, which only terminal `--verbose` shows. In full mode, `landed_proof.proof` stays compact, and `landed_proof.commit_at` gives the landing age when Git can read it.

MCP `content` and `discern status --markdown` give an authored summary of the same state. Its Owner attention section keeps decisions for you apart from the reading agent's next action.

Every task in the fleet is a separate [effort](glossary.md#effort), even when it's idle or clean, and its row grants no permission to take over its worktree. A clean sibling stays occupied until its owner lands or discards it, so an idle-looking recipe search worktree still belongs to that task, and no other agent should take it over. Its maintenance state appears under Owner attention.

#### Git and Proof states

Ahead and behind counts are non-negative integers when known, and `"unknown"` after a failed or malformed count. `git.behind_trunk` is `null` in the main checkout, and when the trunk branch doesn't exist locally. `git.ahead_trunk` is `null` when the trunk branch doesn't exist locally. Missing evidence can't establish that a task is ready or that its work is contained elsewhere.

Proof inspection reports `honored`, `report_only`, `missing`, `stale`, `dirty`, `unavailable`, or `read_failed`. An honored marker includes compact facts: the branch, the trunk, the validated commit, the diff counts, and the Proof line. Report-only evidence can't be used for landing. A valid Proof links the current clean commit, the worktree's own committed tip, to its complete evidence, and status never runs the gate to produce one. [Proof](../10-understand/proof.md#the-exact-commit-it-covers) explains what it covers.

Dirty, behind, and missing-Proof states are observations, so status can still return `ok: true`. A status command that can't complete returns its own failure, so read a task's state separately from whether the status command succeeded.

#### Fleet rows and activity

Each sampled fleet row carries the recovery facts available for it: Git registration, branch reachability, whether the folder exists, cleanliness, divergence, the setup-ready marker, the journal, and the repair classification. A failed Git read keeps the command and its diagnostic. A fact discern couldn't read stays absent, or is marked unavailable.

`read_failure` gives the reason for any other read that failed in a checkout, and marks that checkout unreadable. When an env file caused it, `file` names the file, and that row still shows its derived id and port but leaves out `resources`. The current checkout's `worktree` block carries the same field, with empty `resources`. One checkout's failed read never stops the rest of the fleet from reporting.

A readable row also carries its activity, one `gate_proof`, and its `landing_authority`.

- **`landing_authority`** holds the current decision, up to six example paths with authored files first, the uncovered totals, and the scopes. This summary grants nothing beyond the underlying recorded permission.
- **`task`**, in full mode only, holds the display title, `title_source`, the optional brief, and the ref and commit the task started from. `title_source` is `recorded`, `identity-fallback` for a worktree without stored task metadata, or `unavailable-fallback` when discern couldn't read the record.
- **`resources`**, in full mode only, holds the resource handles recorded in the checkout's env files.
- **`integration`**, in full mode only, marks a landing's own integration worktree, which belongs to discern and never to an agent. Its `owner` is `live` while the landing runs, or `interrupted` once the landing's process is gone, when `discern worktree prune` reclaims it. `for_branch` names the branch the landing composes, and `awaiting_judgment` marks a copy discern keeps for a served checkpoint decision.
- **`last_action`** is the newest completed action. **`running`** is a recent start with no matching completion. **`last_activity`** is the later of the Git time and the logbook time. Turning the logbook off removes the action fields, and Git activity stays.

Structured fleet rows leave out the older `proof_honored`, `proof`, and `proof_line` copies.

`fleet_collisions` pairs branches whose changed files overlap, with the count of overlapping files. `adr_collisions` names contested ADR numbers and the branches that claim them, including branches without worktrees. Structured results leave out their path lists. The terminal report shows them, though in the main checkout's fleet view only with `--verbose`. A later `discern update` names the overlapping paths to re-read.

#### Recovery records

| Field                       | What it records                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `emergency_validation`      | Validation still owed after an emergency landing you approved.                                |
| `parked_tasks`              | The kept branch commit, park time, and task wording, for a later `discern start --from`.      |
| `parked_tasks_unavailable`  | A failure reading parked-task records. The unlanded branches underneath stay visible.         |
| `recent_completed_tasks`    | Up to 8 recent successful acceptances, and the latest landed Proof. Kept in orientation mode. |
| `reappeared_worktree_paths` | Removed worktree paths that exist again without a live Git registration.                      |

A reappeared-path row carries `path`, `removed_at`, `kind`, `entries`, a bounded `contents` sample, and `cleanup_blocked_reason` when prune must keep it. A reappeared path is no longer an active fleet member: its cleanup appears under Owner attention, and status itself cleans nothing up. Review its contents, and close any program still writing there, before you confirm a prune. [Recover an interrupted task](../20-guides/recover-an-interrupted-task.md) walks through an interrupted landing.

### Session findings

After setup, discern can add up to 3 recent observations from the [logbook](logbook.md), its local record of how work goes, to `hints[]`. It inspects at most 200 events, and leaves out CI runs, previews, human activity, and other branches. Findings change no Git fact, gate result, Proof, exit code, or `ok`. Setup in progress, or a turned-off logbook, suppresses them. Run `discern patterns` for the retained evidence ([ADR 0160](https://discern.sh/docs/decisions/0160-local-logbook-advisory-readers)).

## Release information

In the desk, **Desk commands** includes **Check for updates**, even when there are no tasks. It opens the release notes in your browser, where you can see what's changed and whether an update is available. If the browser doesn't open, the result still shows the address. Escape returns to the live desk.

A reminder may appear after 14 days. It only invites you to check: it doesn't mean an update is available, or that anything is wrong with your installation. [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md#check-release-information) explains how to check and update.

## Checkout identity and environment

Each worktree has a stable identity, and discern derives the worktree's development port, resource names, and test-order seed from it, so parallel worktrees don't have to share one port or database. Moving the checkout keeps the identity.

### Read the derived identity

Run `discern identity` in the main checkout or a linked worktree, and select the value you need. In the recipe search worktree, `discern identity --db` prints `recipes_recipe_search_0a7563`.

| Selector            | Value                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--id`              | The stable checkout id.                                                                                                                  |
| `--branch`          | The full branch name: `<branch_prefix><id>` for a worktree, and the configured trunk on main.                                            |
| `--port`            | `17290 + cksum(id) % 2000`.                                                                                                              |
| `--seed`            | The POSIX `cksum` of the full branch name, without a trailing newline.                                                                   |
| `--site`            | A Domain Name System (DNS)-safe `<project-slug>-<id>`, fitted to 63 characters when the slug allows.                                     |
| `--db`              | A database-safe `<project_slug>_<id>`, lowercase, with each run of characters other than letters and numbers replaced by one underscore. |
| `--worktree`        | A general `<project-slug>-<id>` handle.                                                                                                  |
| `--resource <name>` | `<project-slug>-<id>-<name>` for one declared resource.                                                                                  |
| `--resources`       | Every declared resource, as `name=handle`.                                                                                               |

| Identity limit                     | Exact boundary                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generated name slug                | At most 40 characters, before the six-hex-character uniqueness tail.                                                                                         |
| `DISCERN_WORKTREE_ID` override     | 1–81 characters. The first is a letter or number, and the rest are letters, numbers, dots, dashes, or underscores.                                           |
| Port band                          | 2,000 ports, `17290` through `19289`.                                                                                                                        |
| `--site`                           | One DNS label. discern shortens an overlong id and adds a hash so the name fits 63 characters, which always works for a project slug of up to 50 characters. |
| `--db`, `--worktree`, `--resource` | No length limit from discern. Apply the destination system's limit, and use `--site` for a DNS label.                                                        |

A linked worktree resolves its id from `DISCERN_WORKTREE_ID`, then the configured env files, then Git metadata. An override accepts letters, numbers, dots, dashes, and underscores. discern converts it to lowercase and turns each run of characters other than letters and numbers into one dash, so `Recipe.Search_2` becomes `recipe-search-2`. An id from Git metadata gets a `wt-` prefix when it would match the project slug, or the slug followed by digits. This order only reads the id, and never decides what discern may remove: cleanup uses the exact Git worktree entry, plus discern's ready marker.

With no selector, `discern identity` prints the id. It takes one selector at a time, and reads the current checkout unless you name another worktree: `discern identity [worktree]`.

On main, the identity uses the configured trunk, and `--branch` reports it. The main seed changes only when that setting does. A worktree's seed stays the same for its branch, and different branches get different test orders. Neither seed uses the clock or secure randomness.

With `[worktree].export_port` on, `discern start` avoids port collisions with the trunk and live sibling worktrees when it can. A crowded band, or two starts at the same moment, can still collide. When that happens, change `DISCERN_WORKTREE_ID`. With `export_port` off, `discern start` doesn't check ports.

The port, the hash on an overlong site name, and the test seed use a frozen derivation based on POSIX `cksum`, because changing it would change existing checkouts' coordinates and test order. The database name uses no hash. The seed gives a repeatable test order, and carries no randomness or security meaning. An env override applies only to the process's own worktree: inspecting another path still resolves that path's identity.

### Task title and brief

A task's display title, such as `recipe-search`, and its optional brief are for people, and are separate from the stable identity above ([ADR 0356](https://discern.sh/docs/decisions/0356-task-metadata-follows-the-worktree-identity)).

- A new task stores them, with the ref and commit it started from, in the worktree's Git administrative directory, as `discern/task-metadata.json`.
- `discern worktree rename <title>` changes only the title.
- Status shows the stored title when one exists. A worktree from an older discern reports `title_source: "identity-fallback"`, and keeps its label from the id.
- Removing the worktree deletes its local record. A landing removes the worktree when its branch holds nothing beyond the landed submission.
- `discern worktree park` copies the wording into a record keyed by the branch, and a later `discern start --from` uses it ([ADR 0358](https://discern.sh/docs/decisions/0358-recovery-observes-before-repair-and-park-preserves-the-branch)).

### Inherit selected env values

`[worktree].env_files` lists env-style files, in precedence order. The default is `[".env", ".env.local"]`.

- **Reads** use the last listed file that defines a key.
- **Writes** update that last definition, or put a new key in the first listed file that exists. When a write asks for a file and none exists, discern creates the first listed file.

An entry can be any portable project-relative filename, with or without an `.env` name. discern removes any leading `./`, and refuses two entries that name the same path when case is ignored.

A read can follow a symbolic link whose target stays inside the project. A missing or stale checkout, a missing file, or a link that leaves the project counts as an absent env file. A listed file that exists but that discern can't read, such as a file without read permission or a folder at that path, could override any value, so identity commands, inheritance, and env writes stop and name that file. Status still runs, and marks that checkout unreadable, with its derived id and port. Before a write, discern refuses any path with a symbolic link in it instead of changing the link's target, so configure the target path directly, or replace the link with a regular file.

discern marks the values it writes with a "Worktree values" comment, and creates a new env file with mode `0600`.

`[worktree].inherit_env` names the values discern copies from the main checkout into a new worktree, such as an API key your app needs to run. It copies only the named keys, and the rest of the main checkout's local env stays there. For each named key:

- a value that's missing or blank in the main checkout is skipped, with a warning;
- the worktree's value is replaced when it's empty, or when it equals the default in `<first env file>.example`;
- any other worktree value is left alone, as worktree-specific.

When the worktree has no env file yet, inheritance creates the first listed one. When the main checkout has no env file, inheritance warns and copies nothing.

The configured env files can carry the values listed in [Environment variables](environment-variables.md#worktree-environment).

- **`[worktree].export_port`** defaults to `false`. Set it to `true` when your project's tools read the development port, such as a dev server that takes its port from `.env`. Worktree setup then writes `DISCERN_WORKTREE_PORT` into the configured env files when one exists, and otherwise reports the port and the `discern identity --port` route. The worktree hook warns when a sibling already uses the derived port, `discern start` avoids port collisions, and status shows each worktree's port. The port is always derived, so `discern identity --port` and the `@port@` token work either way.
- **Resource handles** are recorded when an env file exists.
- **The id** stays an optional override, supplied by the project or by you.

Identity commands work without an env file. Status, its MCP result, and its resource show the current checkout. Each fleet row derives its own checkout's id. A fleet row shows a port when `export_port` is on, or when the checkout's env files record `DISCERN_WORKTREE_PORT`.

### Use tokens during setup

A resource's `create`, `destroy`, and `ensure` commands receive `@worktree@`, `@db@`, `@site@`, `@port@`, `@project_slug@`, `@dir@`, and `@resource@`. discern replaces each token with the worktree's value before the command runs. `@resource@` has no DNS length limit, so use `@site@` for a 63-character DNS label.

`[worktree.setup].steps`, `[worktree.setup].ensure`, and `[repository].ensure` run exactly as written, with no token replacement, so to use a worktree value there, call `discern identity`, for example `discern identity --port`.

Setup writes the inherited values and identity handles before the one-time setup steps run, then writes them again afterward. So a step such as `cp .env.example .env` can't erase the values setup delivered ([ADR 0059](https://discern.sh/docs/decisions/0059-worktree-setup-ensure)).
