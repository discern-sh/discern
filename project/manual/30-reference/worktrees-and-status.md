---
id: reference-worktrees-and-status
title: "Worktrees and status"
description: "Look up worktree identity, environment/resources, status fields, session findings, and shell-opening contracts."
order: 90
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
---

# Worktrees and status

Look up worktree identity, environment/resources, status fields, session findings, and shell-opening contracts.

Prerequisite: a discern project for status lookup, and a Git repository with at least one commit for linked-worktree lifecycle fields. `discern identity` can report the main checkout or a linked worktree.

## Checkout identity and environment

_Checkout state supplies stable local coordinates and repeatable test order._

Moving a checkout preserves its identity ([ADR 0025](https://discern.sh/docs/decisions/0025-worktree-resources), [ADR 0350](https://discern.sh/docs/decisions/0350-checkout-identity-supplies-test-order-seeds)).

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

A task's display title and optional brief are human metadata, kept separate from the stable identity above. New starts store them with the creation ref and resolved commit in the worktree's Git administrative directory (`discern/task-metadata.json`), and `discern worktree rename <title>` changes only the title. Status shows the stored title when one exists; a worktree from an older discern reports `title_source: "identity-fallback"` and keeps its id-derived label. Acceptance, drop, and Git worktree removal delete the record with the worktree, and `discern worktree park` copies the wording into a branch-keyed record that a later `discern start --from` consumes ([ADR 0356](https://discern.sh/docs/decisions/0356-task-metadata-follows-the-worktree-identity), [ADR 0358](https://discern.sh/docs/decisions/0358-recovery-observes-before-repair-and-park-preserves-the-branch)).

### Inherit selected env values

`[worktree].env_files` lists env-style files in precedence order. The default is `[".env", ".env.local"]`. Reads use the last file that defines a key. Writes update that last definition or place a new key in the first listed file.

Each entry may use any portable project-relative filename. It does not need an `.env` basename. discern removes leading `./` prefixes and refuses entries that name the same case-insensitive path.

Reads may follow a symbolic link when its target stays inside the project. A missing or stale checkout, an unreadable file, or a link that leaves the project behaves as an absent env file. Before writing, discern refuses every symbolic-link component instead of modifying its target; configure the target path directly or replace the link with a regular file.

`[worktree].inherit_env` names values copied from the main checkout into a new worktree. Inheritance creates the first env file when it is missing, so every declared value arrives. It copies only the named keys. The rest of the main checkout's local env stays there.

The configured env files can carry the values listed in the [environment-variable reference](environment-variables.md#worktree-environment). `[worktree].port` defaults to `false`; set it to `true` when project tooling reads the development-port value. The lifecycle records that value only when the setting is on and an env file exists. `discern identity --port` and the `@port@` setup token remain available either way. Resource handles are recorded when an env file exists. The id remains an optional override supplied by the project or user.

Identity commands work without an env file. Status, its Model Context Protocol (MCP) projection, and its resource expose the current checkout. Fleet rows derive each checkout's own id and port.

### Use tokens during setup

Resource and setup commands receive `@worktree@`, `@db@`, `@site@`, `@port@`, `@project_slug@`, and `@dir@`. Resource commands also receive `@resource@`. The setup lifecycle writes inherited values and identity handles before one-time setup commands, then writes them again afterward. A command such as `cp .env.example .env` cannot erase the values setup delivered ([ADR 0059](https://discern.sh/docs/decisions/0059-worktree-setup-ensure)).

### Where it lives in code

| Responsibility                        | Source                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity derivation and id resolution | [`src/engine/worktree/identity.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/identity.ts)                           |
| Destructive ownership predicate       | [`src/engine/worktree/ownership.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/ownership.ts)                         |
| Env-file precedence and writes        | [`src/engine/worktree/env_file.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/env_file.ts)                           |
| Contained read and write paths        | [`src/shared/project_path.ts`](https://github.com/jackwh/discern/blob/main/src/shared/project_path.ts)                                     |
| Runtime tokens                        | [`src/engine/worktree/tokens.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/tokens.ts)                               |
| Frozen parity fixtures                | [`tests/fixtures/parity/worktree-identity.json`](https://github.com/jackwh/discern/blob/main/tests/fixtures/parity/worktree-identity.json) |

### Current state and gotchas

- The port, site tail, database name, and test seed use the frozen Portable Operating System Interface (POSIX) `cksum` derivation. Changing it changes existing checkout coordinates or test order.
- `@resource@` has no DNS length limit. Use `@site@` for a 63-character DNS label.
- An env override applies only to the process's own worktree. Inspecting another path still resolves that target's identity.
- The seed provides deterministic test-order replay. It carries no randomness or security meaning.

## Status and session hints

_`discern status` reports what is true now and what deserves attention next. It runs no Gate job, test, Standard measurement, or setup action._

Run it when a session starts or the next move is unclear. Terminal, JSON, Markdown, and Model Context Protocol (MCP) forms share one result ([ADR 0255](https://discern.sh/docs/decisions/0255-status-is-a-measured-responsive-dashboard), [ADR 0281](https://discern.sh/docs/decisions/0281-main-fleet-status-is-a-decision-brief)).

### Human dashboard

Worktrees default to a local view. The main checkout shows its state, fleet task rows, **Owner attention**, **Landing risks**, and **Next action**. `--verbose` adds per-task evidence, configured checks, local environment, landing history, shared paths, and stored Proof pages.

`--all` explicitly adds the fleet to a worktree's detailed local view; `--local` suppresses it. The flags conflict.

One observation feeds every projection; shared CLI components render each terminal view.

The 104-column report uses stored task titles when available; `--verbose` reveals complete worktree and branch identities. A display title never replaces the id or branch in commands or structured results.

Rows prioritize live, stale, or uncommitted work while still showing branch drift. Shared-file and Architecture Decision Record (ADR) number collisions remain separate landing risks.

The other fields explain that status:

- **Git** says `clean` or `6 files changed`; **DRIFT** keeps `↑8`, `↓3`, or both. Color reinforces the complete arrow-and-count text.
- **Proof** is honored, report-only, missing, stale, dirty worktree, unavailable, or unreadable. Report-only means the commit is current but CI reported checkpoint review without enforcing it; ordinary `discern done` is still required before landing. A clean branch with an honored strict Proof can be ready.
- **Activity** combines the winning clock and completed action. A live Gate reads `Gate running · 2m`; `usually 4m` is historical context.
- **Landing** is granted, needs approval, or scope-limited on ready rows; detail wraps below it.

Text and glyphs carry every state; `--no-color` changes no facts.

**Owner attention** holds lifecycle and landing decisions; **Landing risks** holds file, trunk, and ADR conflicts; **Next action** holds the executable continuation. `--verbose` adds evidence.

In the expanded view, **Checks** shows configured changed scopes, each changed scope's configured preview command, planned Gate jobs, and a Standards count. It labels preview commands as not run. Derived `code` and `previewable` markers stay machine-only. Port and resources sit under **Local environment**. **Landing** shows pass, branch, files changed, diff size, commit, and age. **Proofs** contains stored Proof Markdown.

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

`discern status --json`, MCP `structuredContent`, and the status resource default to the bounded orientation projection. `data.projection.mode` is `orientation`; `data.projection.omitted` gives the true overflow for each capped collection. Repeated collections retain at most six members. Fleet uses a distinct bounded shape: the main row plus six non-main samples, while `data.fleet_total` records the complete non-main count. Landing history stays out of the orientation payload.

Every default result includes the route to full structured detail. Run `discern status --verbose --json`, or call `discern_status` with `verbose: true`. The resulting `data.projection.mode` is `full`; repeated collections and landing history are complete. The shared wire projection still removes rendered Proof pages and the fleet row's earlier compatibility copies. One serialization policy serves CLI JSON, MCP, and the live resource.

`discern status --markdown` and MCP `content` return the authored Markdown presentation. It leads with local state and bounded evidence, states authority, separates decisions that need **Owner attention**, lists secondary work under **Other actions**, and closes with the immediate **Next action**. Cross-effort lifecycle decisions never become the reading agent's next action. `data.project`, `location`, `root`, `worktree`, and `git` locate the structured result; local results can add scopes, jobs, currency, resources, Standards, Proof, and [landing authority](../20-understand/proof.md).

`data.pending_tracked_refresh` lists tracked paths an ordinary refresh would change. `data.tracked_refresh_plan_errors` lists problems that prevent the plan from being derived. Drift in ignored generated files remains visible through the corresponding registered hint.

Fleet retains the main row. Each sampled row carries independent recovery facts: Git registration and branch reachability, filesystem presence, clean state and divergence when readable, the failed Git command and diagnostic when a fact is unavailable, and setup-ready marker, journal, and repair classification. Missing facts stay absent or carry an explicit unavailable state; they never supply a clean fallback. Readable worktrees also carry activity, one `gate_proof`, and authority, and newer rows carry `task`: the display title, `title_source`, optional brief, and creation ref and commit (`title_source: "identity-fallback"` identifies an older worktree with no stored record). `gate_proof` always carries its inspection status. A current honored marker adds compact Proof facts and the one-line rendering; an older marker may add only `proof_line`. Every structured mode omits rendered Proof pages and the earlier `proof_honored`, `proof`, and `proof_line` compatibility copies at fleet-row level. Status authority keeps the exact decision, six authored-first path examples plus uncovered totals and scopes. In full mode, `landed_proof.proof` is compact and `landed_proof.commit_at` supplies landing age when Git can read it.

Ahead and behind are non-negative integers, `"unknown"` after a failed or malformed count, and `null` on local status when the trunk is missing. Only a number can support readiness or containment ([ADR 0328](https://discern.sh/docs/decisions/0328-absence-and-unknown-observations-stay-distinct)).

`last_action` records the newest completion. `running` records a recent start with no matching completion, and `last_activity` takes the later Git or Logbook time. Disabling the Logbook removes the action fields; Git activity remains available ([ADR 0210](https://discern.sh/docs/decisions/0210-effectful-verb-starts-are-paired-logbook-events)).

`fleet_collisions` pairs branches sharing changed files and retains the shared-file count; `adr_collisions` retains each contested number and its claimant branches, including branches without worktrees. Their path lists stay out of structured results. Terminal `--verbose` shows those paths, and a later `update` result names the shared paths that need re-reading. Full stored Proof pages appear only through terminal `--verbose`; structured modes carry the compact Proof claim ([ADR 0188](https://discern.sh/docs/decisions/0188-the-receipt-relays-as-one-line)). Dirty, behind, and missing-Proof states remain `ok: true`; operational refusals do not.

`parked_tasks` joins local Park records to the `unlanded_branches` population: each row carries the retained branch commit, Park time, and the task wording that `discern start --from` resumes with. When those records cannot be read, `parked_tasks_unavailable` names the failure while the underlying unlanded branches stay visible. `recent_completed_tasks` is a bounded local tail from successful acceptance events and the latest landed Proof. Each is a read-only view over existing lifecycle evidence ([ADR 0358](https://discern.sh/docs/decisions/0358-recovery-observes-before-repair-and-park-preserves-the-branch)).

`reappeared_worktree_paths` lists paths removed through discern's worktree lifecycle that currently exist without a live Git registration. Each row carries `path`, `removed_at`, `kind`, `entries`, a bounded `contents` sample, and `cleanup_blocked_reason` when prune must preserve it. The agent result places cleanup under Owner attention. The human dashboard retains the dry-run review route; status itself remains read-only ([ADR 0265](https://discern.sh/docs/decisions/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup)).

### Session findings

After setup, detectors can add recent Logbook observations to `hints[]`. They inspect at most 200 events and exclude CI, previews, human activity, and other branches. Findings change no Git fact, Gate result, Proof, exit code, or `ok`; setup in progress and a disabled Logbook suppress them. Run `discern patterns` for retained evidence ([ADR 0160](https://discern.sh/docs/decisions/0160-local-logbook-advisory-readers)).

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

### Current state and gotchas

- `status` never runs the Gate. A valid Proof is evidence from an earlier `done` run on the current clean `HEAD`.
- Fleet worktrees belong to separate efforts. A clean sibling remains occupied until its owner lands or discards it; its maintenance state appears under Owner attention.
- A reappeared worktree path is no longer an active fleet member. Review its contents and close any program still writing there before confirmed prune.
- The dashboard and Markdown result are projections. Default JSON and MCP are also bounded for orientation; request verbose structured status only when exact full collections are needed.
