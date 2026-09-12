---
id: reference-files-and-ownership
title: "Files and ownership"
description: "Find which files you can edit, what discern maintains, where local records live, and what removal keeps."
order: 80
publish: true
kind: reference
aliases:
  - "reference-files-and-ownership"
  - "Files & ownership"
  - "files"
  - "ownership"
  - "footprint"
  - "gitattributes"
  - "gitignore"
  - "uninstall"
---

# Files and ownership

Use this reference to decide which files you or your agent may edit, which discern may rewrite, and what remains after removal. Knowing those boundaries helps you protect the project's work while keeping generated files current.

Start with [the ownership table](#the-ownership-contract) for what to edit, or [registered project paths](#registered-project-paths) to find a particular file. For local records, use [Git configuration](#clone-local-git-configuration), [runtime state](#runtime-state-inside-git), [Git refs](#git-refs), or [temporary files](#temporary-files-and-crash-records). [Removing it all](#removing-it-all) explains what uninstall keeps.

Project-owned files remain yours to change. Shared files contain entries discern maintains alongside yours. Generated files are rebuilt from their source, so your agent changes the source to keep an edit from being overwritten.

File ownership is an operational term for edit and overwrite authority. It does not assign copyright or change a file's license.

## The ownership contract

| Bucket                                          | May you edit it?                                                                   | Can discern overwrite it?                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Project-owned](glossary.md#project-owned-file) | Yes. Edit the file in place.                                                       | No. Setup may seed it, then discern leaves it alone.                |
| [Shared](glossary.md#shared-file)               | Yes, outside discern's marked region or named entry.                               | It may replace its region or entry and preserves the rest.          |
| [Generated](glossary.md#generated-file)         | Ask your agent to edit the instructions or skill source and run `discern refresh`. | Yes. `refresh` and `upgrade` rebuild it from its reviewable source. |

The coding tool creates and maintains provider-local files, such as its machine-local permission settings. discern only ignores their registered paths. Other untracked provider files have no entry.

## Repository boundary

Each Git repository has one discern installation and one `discern.toml` at its root. In a monorepo, that file can assign different checks to different paths. A folder that is itself a separate Git repository can have its own installation. A second `discern.toml` in an ordinary nested folder has no effect.

## License for discern-authored portions

The `Discern-authored portions` column identifies material covered by the [Apache-2.0 project-payload grant](licenses.md). Project, user, provider, and third-party portions keep their existing terms. Ownership in this table tells you who may edit or overwrite a file; authorship determines its license.

## Provenance classes

Shared and generated artifacts also declare one provenance class:

- **Context-loaded:** unmarked. Agent files and skills load in full, so each marker would spend context tokens. Providers also render comments differently. Instructions and drift checks enforce ownership.
- **Comment-incapable:** no marker because JSON forbids comments.
- **Comment-capable non-context:** its marker identifies the source. By default, it also names discern and links to [discern.sh](https://discern.sh). `DISCERN_NO_ATTRIBUTION` keeps the source and removes the product byline and link.

A missing marker does not make an artifact project-owned. Use the inventory below to identify its source before editing.

## Registered project paths

`/**` covers a directory. Provider-local remains visible so ignored files are not mistaken for Generated ones.

The table uses fresh-install defaults. An isolated workspace for one task (a Git worktree) may use configured environment-file paths instead of `.env`; those files keep the same Shared and Apache-2.0 answers.

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

Path overrides change placement. The ownership bucket still determines edit and overwrite authority ([ADR 0099](https://discern.sh/docs/decisions/0099-consolidate-authored-surface-under-discern-namespace)).

## How Git treats registered paths

Agent files (`AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`) are tracked for bare clones. `discern done` blocks stale copies ([ADR 0034](https://discern.sh/docs/decisions/0034-agents-md-untracked-currency-check), [ADR 0128](https://discern.sh/docs/decisions/0128-enumerated-ownership-tracked-guidance)). The tracked-refresh plan also covers discern's managed portions of tracked shared files, including generated attributes and provider integrations. `done` and `accept` require an empty plan before landing. After landing, acceptance materializes only ignored or local artifacts ([ADR 0264](https://discern.sh/docs/decisions/0264-tracked-refresh-convergence-precedes-landing)).

Project rules outside `.gitattributes`' discern markers remain unchanged, including nested and Git-local attributes. `setup`, `refresh`, and `upgrade` rebuild the block from `discern.toml`, the source-path registry, and the active agent registry. A rebuild replaces hand edits inside the block ([ADR 0093](https://discern.sh/docs/decisions/0093-upgrade-reconciles-gitignore-block), [ADR 0259](https://discern.sh/docs/decisions/0259-generated-groups-opt-in-to-review-metadata)).

The managed block requests `merge=discern-generated` for every tracked declared [generated artifact](glossary.md#generated-artifact) and live agent-file output. Doctor passes that same canonical population to `git check-attr --stdin -z merge`; Git decides each path's protection instead of block inspection. It reports unsafe values without rewriting rules. Set `linguist_generated = true` inside one `[generated.<name>]` table to mark only that group's paths as generated for GitHub. GitHub then hides them in diffs by default and excludes them from language statistics. The default is false ([ADR 0247](https://discern.sh/docs/decisions/0247-generated-artifacts-regenerate-never-merge)).

Markdown inside discern's registered surfaces uses Git's built-in `markdown` diff driver. This covers configured map, instructions, skills, scripts, TODO, and brief paths plus active agent files. There is no repo-wide `*.md` rule: a project's README and other Markdown stay under the project's own attributes policy unless one of those paths is explicitly configured as a discern surface.

Materialized skills and provider-local state are ignored by exact registry path, leaving neighboring files unchanged. Add agent-file ignores outside the managed block if preferred. The currency check accepts a missing copy.

The ignore reconciler owns only its marked block and exact standalone rules that the current provider-artifact registry declares. Similar broad or retired rules outside the block remain project-owned. When `[worktree].root` resolves inside the repository, the managed block also ignores that exact nested directory; the default sibling worktree root needs no repository rule.

## Clone-local Git configuration

These are the only Git configuration entries discern writes. discern stores all of them in clone-local configuration.

| Key or keyed pattern                                            | Scope        | Writer                           | Uninstall behavior                                                               |
| --------------------------------------------------------------- | ------------ | -------------------------------- | -------------------------------------------------------------------------------- |
| `merge.discern-generated.driver`                                | Clone-local  | Setup and refresh reconciliation | Removes the common value and obsolete worktree-local copies.                     |
| `extensions.worktreeConfig`                                     | Clone-local  | Pre-v1 generated-merge setup     | Removes it only when no surviving checkout-specific configuration depends on it. |
| `discern.proofNotesFetchRemote`                                 | Clone-local  | Proof note fetch reconciliation  | Removes each recorded ownership marker.                                          |
| `remote.<name>.fetch with one exact discern Proof note mapping` | Remote entry | Proof note fetch reconciliation  | Removes only the exact mappings paired with discern's ownership marker.          |

The generated merge driver has one definition in the common clone config and is effective from the main checkout and every linked worktree. Reconciliation migrates redundant `config.worktree` copies. A fresh clone has the tracked attributes but not clone-local configuration; its first setup or `discern refresh` installs the shared driver. An identical unmarked remote fetch mapping is project-owned and remains unchanged.

## Runtime state inside `.git`

These local working records live under `discern/` inside Git's administrative directories. Your agent manages them through discern so checks, approvals, and recovery state stay consistent across sessions; leave them out of project commits and manual edits. A checkpoint is a question the agent must judge, and only the owner may authorize an unmet answer.

| Registered path                                    | Lifetime   | Purpose                                                                                                                                    |
| -------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `discern/completion/records/`                      | repository | Candidate, attempt, evidence, Proof, presentation, and exception records used by public commands.                                          |
| `discern/completion/artifacts/`                    | repository | Captured producer output and extraction artifacts consumed by standards and emergency review.                                              |
| `discern/resources/`                               | repository | Resource ledger.                                                                                                                           |
| `discern/logbook/`                                 | repository | [Logbook](../20-understand/local-control.md) events.                                                                                       |
| `discern/logbook-archives/`                        | repository | Sealed logbook event streams for historical patterns and Stats reads.                                                                      |
| `discern/logbook-recovery/`                        | repository | Detached logbook source retained if reset cleanup or archive sealing fails.                                                                |
| `discern/logbook-lifecycle.lock`                   | repository | Advisory lock serializing terminal-confirmed logbook reset and archive actions.                                                            |
| `discern/validation-hmac-key`                      | repository | Local key that makes validation-state and execution digests opaque but comparable across this repository's worktrees.                      |
| `discern/continuations/`                           | repository | Short-handle continuation state, kept for up to 7 days.                                                                                    |
| `discern/operations/`                              | repository | Progress journals for long operations behind short reconnect handles, kept for up to 7 days.                                               |
| `discern/retired-worktree-paths/`                  | repository | Up to 256 removed-path records; status ignores records 90 days after removal.                                                              |
| `discern/drop-recovery.lock`                       | repository | Advisory lock serializing the bounded drop-recovery ref transaction.                                                                       |
| `discern/crash/`                                   | repository | Crash reports.                                                                                                                             |
| `discern/test-slots/`                              | repository | Fleet test-run cap lock files.                                                                                                             |
| `discern/desk/tips.json`                           | repository | Desk tip evidence.                                                                                                                         |
| `discern/desk/preferences.json`                    | repository | Desk display preferences.                                                                                                                  |
| `discern/parked-tasks/`                            | repository | Branch-keyed task wording retained while `discern worktree park` removes the checkout.                                                     |
| `discern/temp-artifact-sweep`                      | repository | Temp-retention sweep stamp and cursor.                                                                                                     |
| `discern/integration-landings/`                    | repository | One record per live or interrupted integration worktree: its owner and the frozen submission it composes.                                  |
| `discern/gate-proof`                               | worktree   | Proof from a clean `done` run.                                                                                                             |
| `discern/last-gate-run`                            | worktree   | Last gate verdict.                                                                                                                         |
| `discern/standard-measurements`                    | worktree   | Reusable measurements.                                                                                                                     |
| `discern/standard-measurement-evidence.json`       | worktree   | Fresh clean-commit measurements, including failures, used only to propose a new limit.                                                     |
| `discern/standard-limit-proposals.json`            | worktree   | Pending commit-bound standard limit proposals.                                                                                             |
| `discern/standard-limit-proposal-transaction.json` | worktree   | Interruption recovery for one proposed-limit config edit, commit, and record transition.                                                   |
| `discern/ignored-baseline`                         | worktree   | Ignored-file baseline.                                                                                                                     |
| `discern/effort-grant`                             | worktree   | Desk landing grant.                                                                                                                        |
| `discern/effort-grant-claims/`                     | worktree   | Claims held by acceptance.                                                                                                                 |
| `discern/submission`                               | worktree   | The effort's submitted revision.                                                                                                           |
| `discern/acceptance-transaction.json`              | worktree   | Acceptance recovery journal.                                                                                                               |
| `discern/setup-machinery-commit-evidence.json`     | worktree   | Setup retry evidence.                                                                                                                      |
| `discern/worktree-ready`                           | worktree   | Completed-setup marker.                                                                                                                    |
| `discern/worktree-setup-steps.json`                | worktree   | Step journal for interrupted worktree setup.                                                                                               |
| `discern/task-metadata.json`                       | worktree   | Display title, optional brief, and creation source.                                                                                        |
| `discern/checkpoint-open-questions`                | worktree   | Served checkpoint questions awaiting or holding a declared conclusion.                                                                     |
| `discern/shim/`                                    | worktree   | Per-identity self-shim ([ADR 0249](https://discern.sh/docs/decisions/0249-self-shims-cache-per-identity-sweep-pages-stay-budget-bounded)). |

Durable state replacements share one interruption-safe policy; intentional moves and create-once publication remain separate ([ADR 0326](https://discern.sh/docs/decisions/0326-durable-replace-writes-use-one-atomic-writer)).

Repository records use the common Git directory; worktree records disappear with that worktree ([ADR 0165](https://discern.sh/docs/decisions/0165-git-admin-state-namespaced-by-lifetime)). `discern worktree park` copies the current task wording into `discern/parked-tasks/` before removing the worktree record; a successful `discern start --from` at the parked commit transfers the wording into the new worktree and removes the record ([ADR 0358](https://discern.sh/docs/decisions/0358-recovery-observes-before-repair-and-park-preserves-the-branch)). Await continuation records have a 7-day time limit and a 512-record repository cap ([ADR 0243](https://discern.sh/docs/decisions/0243-await-continuations-use-short-repository-local-handles)). Removed worktree path evidence has a 90-day limit and a 256-record cap; it authorizes only an explicit prune offer for the recorded path ([ADR 0265](https://discern.sh/docs/decisions/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup)). Guards enforce namespace, lifetime, and reset behavior.

Git stores drop recovery through ordinary refs under `refs/discern/recovery/`. Git can therefore choose its files-based or `reftable` storage format. The newest 32 refs keep committed tips reachable after their worktree branches are deleted. They remain local unless a person configures transport. `discern uninstall` leaves them in place because a ref may be the only remaining name for user-authored commits. Review and delete them with `git update-ref -d <ref>` when that recovery history is no longer needed ([ADR 0271](https://discern.sh/docs/decisions/0271-destructive-drops-retain-bounded-recovery-refs)).

Ordinary acceptance fast-forwards the trunk and creates its marker under `refs/worktree/discern/acceptance-transactions/<transaction-id>` in the same ref transaction. An interrupted landing resumes from that marker and the worktree's journal without repeating the landing.

## Git refs

| Ref or namespace                                                 | Writer                                              | Lifecycle                                                | Uninstall |
| ---------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- | --------- |
| `refs/heads/discern-setup`                                       | `setup begin`                                       | Landed or retained as an ordinary local branch.          | Retained  |
| `refs/heads/<repository.branch_prefix><worktree-id>`             | `start`                                             | Deleted only with positive lifecycle ownership evidence. | Retained  |
| `refs/notes/discern`                                             | `accept`                                            | Durable local landing evidence.                          | Retained  |
| `refs/discern/remotes/<remote>/notes`                            | An ordinary user-owned fetch after discern wires it | Durable fetched landing evidence.                        | Retained  |
| `refs/discern/recovery/<timestamp>-<worktree-id>-<nonce>`        | `worktree drop`                                     | Bounded recovery evidence.                               | Retained  |
| `refs/worktree/discern/acceptance-transactions/<transaction-id>` | `accept`                                            | Temporary compare-and-swap recovery evidence.            | Retained  |

Uninstall never deletes a ref. Its result can suggest exact `git update-ref -d '<ref>'` commands for retained private refs. Keep their recovery evidence unless you have established it is no longer needed. Ordinary local branches remain visible as branches and receive no automatic cleanup suggestion.

## Temporary files and crash records

Temporary artifacts use the operating system's temporary directory. They remain local evidence outside the project and its commits.

| Family            | Name shape                                                   | Contents                                                                                  |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Gate output       | `discern-job-<project>-<worktree>-<random>.log`              | Full combined output for one gate job.                                                    |
| Diagnostic output | `discern-diag-<project>-<worktree>-<random>.log`             | Full text offloaded from a truncated diagnostic.                                          |
| Crash fallback    | `discern-crash-<random>.log`                                 | Crash report when no repository-local crash directory is available.                       |
| Checkpoint input  | `discern-checkpoint-input-<project>-<worktree>-<random>.log` | Versioned JSON facts, mode `0600`, present only while one checkpoint `when` command runs. |
| Self shim         | `discern-self-<random>/`                                     | Abandoned no-repository self-shim directory.                                              |
| Test scaffold     | `discern-test-<random>/`                                     | Abandoned discern development-test scaffold.                                              |

Registered temporary artifacts expire after 24 hours. A sweep inspects at most 500 matching entries and removes at most 500 expired entries per page. The repository coordinator runs at most one page per hour and retains a cursor so later pages continue through a large population. Only registered prefix-and-suffix combinations are eligible; unrelated temporary files are not supported sweep targets.

Repository-local crash reports use `<git-common-dir>/discern/crash/<timestamp>-<pid>-<unique>.txt`, mode `0600`, with the newest 20 retained. A command-line crash exits `70`; JSON uses `error: "internal_error"`. An MCP tool crash returns an `internal_error` result without terminating the server. If repository-local storage is unavailable, the report uses the temporary crash family above. The report records the discern version, timestamp, attempted verb, platform, error name/message, and stack; it is local diagnostic evidence and can contain local paths.

For symptom-led preservation and cleanup, see [Crashes and local state](../40-troubleshooting/crashes-and-local-state.md).

## Removing it all

`discern uninstall` removes generated files, discern-owned Shared entries, the managed `.gitignore` and `.gitattributes` blocks, the whole `discern/` runtime-state namespace under Git's administrative directories, the common generated-merge driver and its obsolete checkout-local copies, and only marked Proof note fetch mappings ([ADR 0104](https://discern.sh/docs/decisions/0104-uninstall-is-the-exit-honesty-verb)). Preview with `discern uninstall --dry-run`.

It keeps project-owned files, `discern.toml`, unmarked Git configuration, checkout-specific configuration the project still needs, and every ref. It reports retained private refs and optional exact cleanup commands without running them. It names Shared settings that it cannot clean without bundled templates. It refuses while any linked Git worktree remains registered, including a completed checkout you retained, or while the resource ledger records provisioned resources. Those entries hold their only destroy commands, so reclaim them with `discern worktree prune` first. Uninstall is CLI-only, performs no remote operation, and leaves normal Git hooks to run with Git's usual exit semantics. Remove the installed binary separately only when no other project on the machine needs it. [Maintain or remove discern](../10-guides/maintain-or-remove-discern.md#remove-discern-from-the-repository) walks through the decision and removal.

## Where it lives in code

The [artifact ownership map](https://discern.sh/map/reference/artifact-ownership) links the registries and implementation behind this inventory. Use it when contributing to discern or checking how an ownership rule is enforced.

## See also

- [Proof](../20-understand/proof.md): what passing checks establishes and why later edits make that evidence stale.
- [Licenses for project payloads](licenses.md): the authorship boundary and downstream redistribution responsibility.
- [Platforms and providers](platforms-and-providers.md): the exact file table per coding tool.
- [Trust and your data](../20-understand/local-control.md): the network, telemetry, and execution contract on one screen.
