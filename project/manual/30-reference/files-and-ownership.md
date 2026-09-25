---
id: reference-files-and-ownership
title: "Files and ownership"
description: "Look up which files you can edit, which files discern maintains or rebuilds, where it keeps local records, and what uninstalling leaves behind."
order: 80
publish: true
kind: reference
aliases:
  - "reference-files-and-ownership"
  - "Files & ownership"
  - "files"
  - "ownership"
  - "footprint"
  - "install surface"
  - "gitattributes"
  - "gitignore"
  - "uninstall"
---

# Files and ownership

Before you or your agent edit a file discern put in your project, this page tells you whether the edit will last: which files are yours, which ones discern maintains a part of, and which ones it rebuilds from a source you edit instead. It also lists every record discern keeps inside `.git` and in temporary files, how long each one lasts, and what uninstalling removes and keeps.

Say you want every agent working on your recipe app to run the tests before it commits, so you open `AGENTS.md` to add that rule. `AGENTS.md` is a generated file: the next `discern refresh` rebuilds it from the project's instruction source, and your line would disappear. The rule belongs in `discern/instructions.md`, which is yours, and the refresh compiles it into every agent file.

| Find                                | Go to                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Whether you can edit a file         | [The ownership contract](#the-ownership-contract)                       |
| A particular file discern registers | [Registered project paths](#registered-project-paths)                   |
| How Git treats discern's files      | [How Git treats registered paths](#how-git-treats-registered-paths)     |
| Git settings discern writes         | [Clone-local Git configuration](#clone-local-git-configuration)         |
| Records inside `.git`               | [Runtime state inside `.git`](#runtime-state-inside-git)                |
| Refs discern creates                | [Git refs](#git-refs)                                                   |
| Temporary files and crash reports   | [Temporary files and crash records](#temporary-files-and-crash-records) |
| What uninstall removes and keeps    | [What uninstall removes and keeps](#what-uninstall-removes-and-keeps)   |

## The ownership contract

Every file discern registers has one kind of ownership, which decides who may change it:

| Ownership                                       | May you edit it?                                                              | Can discern overwrite it?                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Project-owned](glossary.md#project-owned-file) | Yes. Edit the file in place.                                                  | No. Setup may seed it, then discern leaves it alone, apart from the ADR index region described below. |
| [Shared](glossary.md#shared-file)               | Yes, outside discern's marked region or named entry.                          | It may replace its own region or entry, and keeps the rest.                                           |
| [Generated](glossary.md#generated-file)         | No. Edit its source, the instructions or a skill, then run `discern refresh`. | Yes. `refresh` and `upgrade` rebuild it from its reviewable source.                                   |

Project-owned files have one exception: the index of Architecture Decision Records (ADRs), the records of why the project made its significant design decisions. Setup seeds `_adr/README.md` in the project's [map](glossary.md#map) with a region between `BEGIN GENERATED` and `END GENERATED` markers. `discern refresh` rewrites that region from the record files, and `discern done` fails when the region has drifted from them, so the index stays in step with the records. Everything outside the markers stays yours.

A **provider-local** file belongs to a coding tool, which creates and maintains it: Claude Code's machine-local permission settings, for example. discern only keeps its registered path out of Git, and other untracked files a coding tool creates have no entry.

Ownership here decides who may edit or overwrite a file, and nothing more. It doesn't assign copyright or change a file's license, which authorship decides.

## Repository boundary

Each Git repository has one discern installation, with one `discern.toml` at the repository root. In a monorepo, that one file can set different checks for different folders. A folder that is itself a separate Git repository can have its own installation.

A `discern.toml` in an ordinary nested folder isn't a second installation, though commands you run beneath that folder use it as their project root. There, `discern doctor` fails its repository-shape check, and `discern start` and `discern accept` refuse, because a worktree, the separate copy of the project where one task happens, always checks out the repository from its root.

## License for discern-authored portions

The `discern-authored portions` column in the inventory below gives the license of the material discern wrote into each file: the [Apache-2.0 project-payload grant](licenses.md). Project, user, provider, and third-party portions of the same file keep their existing terms.

## Provenance classes

Each shared or generated file also has a provenance class, which decides whether it carries a marker saying where it came from:

- **Context-loaded:** no marker. Agents load agent files and skills in full, so a marker would take up space in every session's context, and coding tools render comments differently. Instructions and drift checks enforce ownership instead.
- **Comment-incapable:** no marker, because JSON doesn't allow comments.
- **Comment-capable non-context:** the marker names the file's source, as the second line of the [`.gitignore` block](#gitignore) below does. By default it also names discern and links to [discern.sh](https://discern.sh). A non-empty `DISCERN_NO_ATTRIBUTION` keeps the source and removes the product name and link.

A missing marker doesn't make a file project-owned, so look the file up in the inventory below before you edit it.

## Registered project paths

In this table, `/**` covers a directory. Provider-local files are listed too, so you don't mistake an ignored file for a generated one.

The table shows the paths of a fresh install. The `.env` and `.env.local` rows are the default `[worktree].env_files`. A project that sets its own list uses those files instead, with the same Shared and Apache-2.0 answers.

<!-- BEGIN GENERATED: project artifact ownership -->
<!-- This table is generated from the ownership registries. -->

| Path                                   | Ownership      | Provenance class            | discern-authored portions | What discern maintains                                                                                                                                         |
| -------------------------------------- | -------------- | --------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern/brief.md`                     | Project-owned  | —                           | Apache-2.0                | The project brief captured at setup — authored intent, read by the setup instructions.                                                                         |
| `discern/instructions.md`              | Project-owned  | —                           | Apache-2.0                | The project's instruction source, which discern compiles into the agent files.                                                                                 |
| `discern/map/**`                       | Project-owned  | —                           | Apache-2.0                | The project map — the agent-maintained documentation tree discern scaffolds, validates, and browses.                                                           |
| `discern/scripts/**`                   | Project-owned  | —                           | Apache-2.0                | Where the project's own executable scripts live.                                                                                                               |
| `discern/skills/**`                    | Project-owned  | —                           | Apache-2.0                | Where the project's authored skills live.                                                                                                                      |
| `discern/TODO.md`                      | Project-owned  | —                           | Apache-2.0                | The deferred-work ledger — the running TODO list agents read and maintain.                                                                                     |
| `.claude/settings.json`                | Shared         | Comment-incapable           | Apache-2.0                | Provider configuration. discern maintains its registered entries.                                                                                              |
| `.codex/config.toml`                   | Shared         | Comment-capable non-context | Apache-2.0                | Provider configuration. discern maintains its registered entries.                                                                                              |
| `.codex/environments/environment.toml` | Shared         | Comment-capable non-context | Apache-2.0                | Provider app configuration. discern maintains its setup and cleanup entries.                                                                                   |
| `.codex/hooks.json`                    | Shared         | Comment-incapable           | Apache-2.0                | Provider configuration. discern maintains its registered entries.                                                                                              |
| `.codex/rules/discern.rules`           | Shared         | Comment-capable non-context | Apache-2.0                | Provider rules entry maintained by discern. Neighboring rules remain the project's.                                                                            |
| `.cursor/hooks.json`                   | Shared         | Comment-incapable           | Apache-2.0                | Provider configuration. discern maintains its registered entries.                                                                                              |
| `.cursor/mcp.json`                     | Shared         | Comment-incapable           | Apache-2.0                | Provider configuration. discern maintains its registered entries.                                                                                              |
| `.env`                                 | Shared         | Comment-capable non-context | Apache-2.0                | Worktree environment file. discern maintains inherited entries plus DISCERN_* identity and resource entries; inheritance may create the first configured file. |
| `.env.local`                           | Shared         | Comment-capable non-context | Apache-2.0                | Worktree environment file. discern maintains inherited entries plus DISCERN_* identity and resource entries; inheritance may create the first configured file. |
| `.gemini/settings.json`                | Shared         | Comment-incapable           | Apache-2.0                | Provider configuration. discern maintains its registered entries.                                                                                              |
| `.gitattributes`                       | Shared         | Comment-capable non-context | Apache-2.0                | Project attributes. discern maintains its marked generated-artifact and Markdown-diff block.                                                                   |
| `.github/hooks/discern.json`           | Shared         | Comment-incapable           | Apache-2.0                | Provider configuration. discern maintains its registered entries.                                                                                              |
| `.gitignore`                           | Shared         | Comment-capable non-context | Apache-2.0                | Project ignore rules. discern maintains its marked block.                                                                                                      |
| `.mcp.json`                            | Shared         | Comment-incapable           | Apache-2.0                | Provider configuration. discern maintains its registered entries.                                                                                              |
| `discern.toml`                         | Shared         | Comment-capable non-context | Apache-2.0                | Project configuration. discern maintains its fixed scaffold and ruled banners.                                                                                 |
| `.agents/skills/**`                    | Generated      | Context-loaded              | Apache-2.0                | Materialized skills directory rebuilt by `discern refresh`.                                                                                                    |
| `.claude/skills/**`                    | Generated      | Context-loaded              | Apache-2.0                | Materialized skills directory rebuilt by `discern refresh`.                                                                                                    |
| `AGENTS.md`                            | Generated      | Context-loaded              | Apache-2.0                | Agent file compiled from the configured instruction sources.                                                                                                   |
| `CLAUDE.md`                            | Generated      | Context-loaded              | Apache-2.0                | Agent file compiled from the configured instruction sources.                                                                                                   |
| `GEMINI.md`                            | Generated      | Context-loaded              | Apache-2.0                | Agent file compiled from the configured instruction sources.                                                                                                   |
| `.claude/settings.local.json`          | Provider-local | —                           | —                         | Claude Code creates and maintains this per-machine override. discern only keeps it out of Git.                                                                 |

<!-- END GENERATED: project artifact ownership -->

Configuring a different path moves a file, but its ownership still decides who may edit or overwrite it ([ADR 0099](https://discern.sh/docs/decisions/0099-consolidate-authored-surface-under-discern-namespace)).

## How Git treats registered paths

### Agent files and the refresh plan

The agent files `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are tracked, so an agent in a fresh clone, including a cloud agent, reads its instructions before discern has run. `discern done` blocks a stale copy, and accepts a missing one ([ADR 0034](https://discern.sh/docs/decisions/0034-agents-md-untracked-currency-check), [ADR 0128](https://discern.sh/docs/decisions/0128-enumerated-ownership-tracked-guidance)).

The tracked-refresh plan, the changes an ordinary `discern refresh` would make to tracked files, also covers discern's portions of other tracked files: the generated attributes, the provider integrations, and the ADR index. `discern done` and `discern accept` require that plan to be empty before a change lands, so the landed commit already holds their current versions. After landing, acceptance materializes only ignored or local files ([ADR 0264](https://discern.sh/docs/decisions/0264-tracked-refresh-convergence-precedes-landing)).

Materialized skills and provider-local files stay out of Git: `discern done` fails at its `tracked_artifacts` stage if one of them has been force-added.

### `.gitattributes`

discern maintains one marked block in `.gitattributes`, and your rules outside the markers stay unchanged, including nested and Git-local attribute files. `setup`, `refresh`, and `upgrade` rebuild the block from `discern.toml`, the source-path registry, and the active agents, so a rebuild replaces any hand edit inside it ([ADR 0093](https://discern.sh/docs/decisions/0093-upgrade-reconciles-gitignore-block), [ADR 0259](https://discern.sh/docs/decisions/0259-generated-groups-opt-in-to-review-metadata)).

- **Merge driver:** the block requests `merge=discern-generated` for every tracked [generated artifact](glossary.md#generated-artifact) you declare, and for the live agent files, so a plain `git merge` keeps the current side of those files instead of stopping on conflict markers, and the next regeneration rebuilds them from the merged sources ([ADR 0247](https://discern.sh/docs/decisions/0247-generated-artifacts-regenerate-never-merge)). A `[generated]` pattern that `.gitattributes` can't express is left out, and refresh warns about it: whitespace, a leading `!`, `#`, or `"`, a backslash, a `.` or `..` segment, an empty segment, braces, or an extended glob group. `discern doctor` flags the tracked paths such a pattern leaves unprotected.
- **Checking protection:** `discern doctor` passes the same set of paths to `git check-attr --stdin -z merge`, so Git itself decides each path's protection. Doctor reports unsafe values without rewriting your rules.
- **GitHub's generated marking:** set `linguist_generated = true` inside one `[generated.<name>]` table to mark only that group's paths as generated for GitHub, which then hides them in diffs by default and leaves them out of language statistics. The default is `false`.
- **Markdown diffs:** Markdown in each of discern's registered locations that exists uses Git's built-in `markdown` diff driver. That covers the configured map, instructions, skills, scripts, TODO, and brief paths, and the active agent files. There's no rule for every `*.md` file, so your README and other Markdown follow your own attributes.

### `.gitignore`

discern ignores materialized skills and provider-local files by their exact registered paths, so neighboring files stay as they are. In the recipe app, which uses Claude Code and Codex, the block reads:

```text
# --- discern ---
# Generated automatically by discern via the bundled .gitignore fragment and provider registry | https://discern.sh
# discern's managed ignore rules: only the skills directories it
# materializes and machine-local provider state. discern owns this
# block alone and never touches your other rules. The compiled agent
# files (AGENTS.md and its mirrors) are tracked, so every agent —
# cloud included — reads them from a fresh clone. For the full list
# of discern-managed files, run `discern docs` or see https://discern.sh
/.claude/skills/
/.claude/settings.local.json
/.agents/skills/
# --- /discern ---
```

You can add ignore rules for the agent files outside discern's block if you prefer, since the stale-copy check accepts a missing agent file.

discern owns only its marked block, plus any standalone rule outside it that exactly matches one the current provider registry declares. Similar broad or retired rules outside the block stay yours. When `[worktree].root` resolves inside the repository, the block also ignores that exact directory. The default worktree location, beside the project, needs no rule.

## Clone-local Git configuration

discern writes only these Git configuration entries, all in the clone's own configuration:

| Key or keyed pattern                                            | Scope        | Writer                           | What uninstall does                                                              |
| --------------------------------------------------------------- | ------------ | -------------------------------- | -------------------------------------------------------------------------------- |
| `merge.discern-generated.driver`                                | Clone-local  | Setup and refresh reconciliation | Removes the shared value, and obsolete copies in worktree configuration.         |
| `extensions.worktreeConfig`                                     | Clone-local  | Generated-merge setup before 1.0 | Removes it only when no remaining checkout-specific configuration depends on it. |
| `discern.proofNotesFetchRemote`                                 | Clone-local  | Proof note fetch reconciliation  | Removes each recorded ownership marker.                                          |
| `remote.<name>.fetch with one exact discern Proof note mapping` | Remote entry | Proof note fetch reconciliation  | Removes only the exact mappings paired with discern's ownership marker.          |

The generated merge driver has one definition, in the shared clone configuration, which works from the main checkout and every linked worktree, and reconciliation moves redundant `config.worktree` copies into it. Git configuration doesn't travel with a clone, though: a fresh clone has the tracked attributes but not the driver, so its first setup or `discern refresh` installs it.

discern writes the [Proof note](glossary.md#proof-note) fetch mapping and its marker only when `[repository].proof_notes_mode` is `"fetch"`, so with the default, `"local"`, your remotes get no discern configuration. An identical fetch mapping without discern's marker belongs to the project, and stays unchanged.

## Runtime state inside `.git`

discern keeps these working records under `discern/` inside Git's administrative directories, outside your commits. Don't edit them by hand: your agent works with them only through discern's commands, which keeps checks, approvals, and recovery state consistent across sessions.

The Lifetime column says where each record lives. A **repository** record lives in the common Git directory, where every worktree shares it. A **worktree** record belongs to one worktree, and disappears with it ([ADR 0165](https://discern.sh/docs/decisions/0165-git-admin-state-namespaced-by-lifetime)).

| Registered path                                    | Lifetime   | Purpose                                                                                                                                                           |
| -------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discern/completion/records/`                      | repository | Candidate, attempt, evidence, Proof, presentation, and exception records that discern's commands use.                                                             |
| `discern/completion/artifacts/`                    | repository | Captured command output and extracted artifacts, used by standards and emergency review.                                                                          |
| `discern/resources/`                               | repository | The resource ledger.                                                                                                                                              |
| `discern/logbook/`                                 | repository | [Logbook](logbook.md) events.                                                                                                                                     |
| `discern/logbook-archives/`                        | repository | Sealed logbook history, for historical patterns and stats.                                                                                                        |
| `discern/logbook-recovery/`                        | repository | Detached logbook history kept when sealing or reset cleanup fails.                                                                                                |
| `discern/logbook-lifecycle.lock`                   | repository | Lock that lets only one logbook seal or reset run at a time.                                                                                                      |
| `discern/validation-hmac-key`                      | repository | Local key that makes validation digests opaque, but comparable across this repository's worktrees.                                                                |
| `discern/continuations/`                           | repository | State behind short continuation handles, kept for up to 7 days.                                                                                                   |
| `discern/operations/`                              | repository | Progress journals for long operations behind short reconnect handles, kept for up to 7 days.                                                                      |
| `discern/retired-worktree-paths/`                  | repository | Up to 256 removed-path records, which status ignores 90 days after removal, and branch records that let `discern worktree prune` finish a failed branch deletion. |
| `discern/drop-recovery.lock`                       | repository | Lock that serializes the bounded recovery-ref update when you drop a worktree.                                                                                    |
| `discern/crash/`                                   | repository | Crash reports.                                                                                                                                                    |
| `discern/test-slots/`                              | repository | Lock files for the cap on concurrent test runs.                                                                                                                   |
| `discern/release-check.json`                       | repository | First adoption time, and the time and version of the last release handoff.                                                                                        |
| `discern/desk/tips.json`                           | repository | Evidence for the [desk](glossary.md#desk)'s tips.                                                                                                                 |
| `discern/desk/preferences.json`                    | repository | Remembered desk defaults: the last agent, and the task-creation route.                                                                                            |
| `discern/parked-tasks/`                            | repository | Task wording, keyed by branch, kept while `discern worktree park` removes the checkout.                                                                           |
| `discern/temp-artifact-sweep`                      | repository | Timestamp and cursor for the temporary-file sweep.                                                                                                                |
| `discern/integration-landings/`                    | repository | One record per live or interrupted [integration worktree](glossary.md#integration-worktree): its owner, and the submission it composes.                           |
| `discern/gate-proof`                               | worktree   | Proof from a clean `discern done` run.                                                                                                                            |
| `discern/last-gate-run`                            | worktree   | The last gate verdict.                                                                                                                                            |
| `discern/standard-measurements`                    | worktree   | Reusable measurements.                                                                                                                                            |
| `discern/standard-measurement-evidence.json`       | worktree   | Fresh measurements of a clean commit, failures included, used only to propose a new limit.                                                                        |
| `discern/standard-limit-proposals.json`            | worktree   | Pending limit proposals, each bound to a commit.                                                                                                                  |
| `discern/standard-limit-proposal-transaction.json` | worktree   | Recovery state for one proposed-limit configuration edit, commit, and record change.                                                                              |
| `discern/ignored-baseline`                         | worktree   | Baseline of ignored files.                                                                                                                                        |
| `discern/effort-grant`                             | worktree   | A landing grant recorded from the desk.                                                                                                                           |
| `discern/effort-grant-claims/`                     | worktree   | Claims that acceptance holds on that grant.                                                                                                                       |
| `discern/submission`                               | worktree   | The submitted commit.                                                                                                                                             |
| `discern/acceptance-transaction.json`              | worktree   | Acceptance recovery journal.                                                                                                                                      |
| `discern/setup-machinery-commit-evidence.json`     | worktree   | Evidence for retrying setup.                                                                                                                                      |
| `discern/worktree-ready`                           | worktree   | Marker that worktree setup finished.                                                                                                                              |
| `discern/worktree-setup-steps.json`                | worktree   | Step journal for an interrupted worktree setup.                                                                                                                   |
| `discern/task-metadata.json`                       | worktree   | Display title, optional brief, and the ref and commit the task started from.                                                                                      |
| `discern/checkpoint-open-questions`                | worktree   | Served checkpoint questions, awaiting or holding a declared answer.                                                                                               |
| `discern/shim/`                                    | worktree   | discern's own shim for this worktree ([ADR 0249](https://discern.sh/docs/decisions/0249-self-shims-cache-per-identity-sweep-pages-stay-budget-bounded)).          |

discern replaces a durable record through one interruption-safe writer, so an interrupted write leaves the old record intact. Intentional moves, and records written once, follow their own rules ([ADR 0326](https://discern.sh/docs/decisions/0326-durable-replace-writes-use-one-atomic-writer)). Tests guard each record's namespace, lifetime, and reset behavior.

### Retention and recovery

- **Parked tasks:** `discern worktree park` copies the task's wording into `discern/parked-tasks/` before it removes the worktree record. A successful `discern start --from` at the parked commit moves the wording into the new worktree and removes the record ([ADR 0358](https://discern.sh/docs/decisions/0358-recovery-observes-before-repair-and-park-preserves-the-branch)).
- **Continuations:** records behind `discern await` resume handles have a 7-day time limit and a 512-record repository cap ([ADR 0243](https://discern.sh/docs/decisions/0243-await-continuations-use-short-repository-local-handles)).
- **Removed worktree paths:** each record has a 90-day limit, and the store has a 256-record cap. A record only lets discern offer an explicit prune of that recorded path ([ADR 0265](https://discern.sh/docs/decisions/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup)).

When you drop a worktree, discern keeps its committed tip reachable through an ordinary ref under `refs/discern/recovery/`, so Git doesn't discard the dropped task's commits. Because it's an ordinary ref, Git keeps it in its files or `reftable` storage like any other. discern keeps the newest 32 refs, and they stay local unless you configure a transport for them. `discern uninstall` leaves them in place, because a ref may be the only remaining name for commits you wrote. When you no longer need that recovery history, review each ref and delete it with `git update-ref -d <ref>` ([ADR 0271](https://discern.sh/docs/decisions/0271-destructive-drops-retain-bounded-recovery-refs)).

An ordinary landing moves the trunk, your project's shared branch, and creates its marker, `refs/worktree/discern/acceptance-transactions/<transaction-id>`, in the same ref transaction, so the marker exists only if the trunk moved. If a landing is interrupted, recovery reads that marker and the worktree's journal, and never replays the landing's authority:

- if the trunk already points at the landed commit, discern finishes the landing's cleanup;
- if the trunk was reset or moved somewhere else, recovery stops and asks you to inspect the trunk's reflog.

### The release-check record

`discern/release-check.json` supports update reminders, and every linked worktree shares it. It records when the project first adopted discern, and the time and version of the last release handoff.

- A setup that finishes with honored Proof, or a successful `discern upgrade`, creates the record when it doesn't exist. Neither resets an existing record.
- Any `discern releases` run that isn't a dry run records a handoff, which resets the reminder clock. That includes runs with `--json` or `--markdown`, where no browser opens.
- A reminder can appear 14 UTC calendar days after the last handoff, or after first adoption. Viewing the reminder leaves it in place.
- discern never overwrites a record in a newer format, or one it can't read.
- Turning off the logbook doesn't affect the record, and `discern uninstall` removes it.

## Git refs

| Ref or namespace                                                 | Writer                                              | Lifecycle                                                 | Uninstall |
| ---------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- | --------- |
| `refs/heads/discern-setup`                                       | `setup begin`                                       | Landed, or kept as an ordinary local branch.              | Kept      |
| `refs/heads/<repository.branch_prefix><worktree-id>`             | `start`                                             | Deleted only with positive evidence that discern owns it. | Kept      |
| `refs/notes/discern`                                             | `accept`                                            | Durable local landing evidence.                           | Kept      |
| `refs/discern/remotes/<remote>/notes`                            | Your own ordinary `git fetch`, once discern maps it | Durable fetched landing evidence.                         | Kept      |
| `refs/discern/recovery/<timestamp>-<worktree-id>-<nonce>`        | `worktree drop`                                     | Bounded recovery evidence.                                | Kept      |
| `refs/worktree/discern/acceptance-transactions/<transaction-id>` | `accept`                                            | Temporary recovery evidence for the trunk update.         | Kept      |

Uninstall never deletes a ref, because a ref can be the last name for commits or evidence you still need. Its result can suggest exact `git update-ref -d '<ref>'` commands for the private refs it kept, such as the Proof notes ref. Run one only once you've established you no longer need what it holds. Ordinary local branches stay visible as branches, and get no cleanup suggestion.

## Temporary files and crash records

discern writes temporary files in the operating system's temporary directory, outside the project and its commits.

| Family            | Name shape                                                   | Contents                                                                                  |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Gate output       | `discern-job-<project>-<worktree>-<random>.log`              | The full combined output of one gate job.                                                 |
| Diagnostic output | `discern-diag-<project>-<worktree>-<random>.log`             | The full text of a diagnostic that was shortened.                                         |
| Crash fallback    | `discern-crash-<project>-<worktree>-<random>.log`            | A crash report, when no crash directory in the repository is available.                   |
| Checkpoint input  | `discern-checkpoint-input-<project>-<worktree>-<random>.log` | Versioned JSON facts, mode `0600`, present only while one checkpoint `when` command runs. |
| Self shim         | `discern-self-<random>/`                                     | An abandoned shim directory from outside any repository.                                  |
| Test scaffold     | `discern-test-<random>/`                                     | An abandoned scaffold from discern's own development tests.                               |

A file's name includes the project and worktree when discern knows them. Without a checkout identity, the name is the family prefix, a random part, and `.log`.

Registered temporary files expire after 24 hours, and `discern prepare`, `discern done`, and `discern test` sweep them. One sweep inspects at most 500 matching entries and removes at most 500 expired entries. The repository runs at most one page per hour, and keeps a cursor, so later pages work through a large backlog. discern sweeps only its registered families: files with a registered prefix and the `.log` suffix, and directories with a registered prefix, which it removes with their contents. It never touches other temporary files.

A crash report in the repository is `<git-common-dir>/discern/crash/<timestamp>-<pid>-<unique>.txt`, with mode `0600`, and discern keeps the newest 20. A crash on the command line exits `70`, and JSON output reports `error: "internal_error"`. A crash inside a Model Context Protocol (MCP) tool returns an `internal_error` result, and the server keeps running. When the repository's crash directory isn't available, the report uses the crash fallback family above.

A report records the discern version, the timestamp, the command that ran, the platform, the runtime version, the error's name and message, and the stack. It's local diagnostic evidence, and it can contain local paths, so read it before you share it. For what to keep and what to clean up, see [Crashes and local state](../40-troubleshooting/crashes-and-local-state.md).

## What uninstall removes and keeps

`discern uninstall` removes discern from the repository ([ADR 0104](https://discern.sh/docs/decisions/0104-uninstall-is-the-exit-honesty-verb)). Preview it with `discern uninstall --dry-run`.

It removes:

- generated files;
- discern's entries in shared files;
- discern's blocks in `.gitignore` and `.gitattributes`;
- the whole `discern/` runtime-state namespace inside Git's administrative directories;
- the shared generated-merge driver, and its obsolete checkout-specific copies;
- only the Proof note fetch mappings that carry discern's marker.

It keeps:

- project-owned files and `discern.toml`;
- Git configuration without discern's marker, and checkout-specific configuration the project still needs;
- every ref. It reports the private refs it kept, with optional exact cleanup commands, and runs none of them.

In the recipe app, uninstalling removes the generated `AGENTS.md` and `CLAUDE.md` and keeps `discern/instructions.md`, so your test-before-commit rule stays in the repository, though no agent file carries it anymore.

It refuses, and changes nothing:

- when you run it from a linked worktree, rather than the main checkout;
- while any linked worktree is registered, including a finished checkout you kept;
- while the resource ledger records provisioned resources, because those entries hold their only destroy commands. Reclaim them with `discern worktree prune` first. An entry marked `prunable = false` needs the project's own teardown;
- when it can't plan the Git configuration cleanup.

In a terminal, uninstall asks you to confirm. Without terminal input, under `--plain`, in CI, or with `--json` or `--markdown`, it needs `--yes`, and otherwise refuses with `confirmation_required`. It cleans up the Git configuration first, and if that fails, it removes no project files and reports `apply_failed`.

Uninstall runs only from the command line, and makes no remote change. discern never installs Git hooks, so your hooks stay as they are. Remove the installed program separately, once no other project on the computer needs it. [Maintain or remove discern](../20-guides/maintain-or-remove-discern.md#remove-discern-from-the-repository) walks through the decision and the removal.

## See also

- [Proof](../10-understand/proof.md): what passing checks establish, and why later edits make that evidence stale.
- [Licenses](licenses.md): the authorship boundary, and what you're responsible for when you redistribute.
- [Platforms and providers](platforms-and-providers.md): the exact files for each coding tool.
- [What stays on your machine](../10-understand/local-control.md): what discern runs, records, and writes, and what never leaves your computer.
