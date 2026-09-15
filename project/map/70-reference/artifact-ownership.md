---
title: Files & ownership
description: Every project path discern writes or maintains, its edit and overwrite contract, Git treatment, and uninstall behavior.
order: 60
publish: true
aliases:
  - files
  - ownership
  - footprint
  - gitattributes
  - gitignore
  - uninstall
---

# Files & ownership

_For every project path discern writes: who may edit it, and can discern overwrite it?_

One registry drives this inventory and its write-surface guard. A path without [file ownership](../00-orientation/glossary.md#file-ownership) fails the gate ([ADR 0170](../_adr/0170-file-ownership-is-registry-data.md)).

File ownership is an operational term for edit and overwrite authority. It does not assign copyright or change a file's license.

## The ownership contract

| Bucket                                                            | May you edit it?                                                     | Can discern overwrite it?                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [Project-owned](../00-orientation/glossary.md#project-owned-file) | Yes. Edit the file in place.                                         | No. Setup may seed it, then discern leaves it alone.                |
| [Shared](../00-orientation/glossary.md#shared-file)               | Yes, outside discern's marked region or named entry.                 | It may replace its region or entry and preserves the rest.          |
| [Generated](../00-orientation/glossary.md#generated-file)         | No. Edit the instructions or skill source and run `discern refresh`. | Yes. `refresh` and `upgrade` rebuild it from its reviewable source. |

The coding agent creates and maintains provider-local files. discern only ignores their registered paths. Other untracked provider files have no entry.

## License for discern-authored portions

The discern-authored portions of every canonical project artifact are available immediately under [Apache-2.0](https://discern.sh/docs/reference/licenses). The inventory's authored-portions column derives from the write-boundary registry, so a future registered destination joins the grant automatically. Project, user, provider, and third-party portions keep their existing terms.

## Provenance classes

Shared and generated artifacts also declare one provenance class:

- **Context-loaded:** unmarked. Agent files and Skills load in full, so each marker would spend context tokens. Providers also render comments differently. Instructions and drift checks enforce ownership.
- **Comment-incapable:** no marker because JSON forbids comments.
- **Comment-capable non-context:** its marker identifies the source. By default, it also names discern and links to [discern.sh](https://discern.sh). `DISCERN_NO_ATTRIBUTION` keeps the source and removes the product byline and link.

Registry tests enforce classification and both marker rules ([ADR 0211](../_adr/0211-agent-context-artifacts-carry-no-provenance-marker.md)).

## Registered project paths

The complete registered-path inventory is generated from the source-path and provider registries: the [install surface](../80-development/install-surface.md) carries the exhaustive engineering inventory, and the product manual's [Files and ownership](https://discern.sh/docs/reference/files-and-ownership) carries the public account. `/**` covers a directory; provider-local paths remain visible so ignored files are not mistaken for Generated ones, and configured worktree environment paths replace the default `.env` row while keeping the same Shared and Apache-2.0 answers.

Path overrides change placement. The ownership bucket still determines edit and overwrite authority ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).

## How Git treats registered paths

`meta.managed_version` is discern-written adoption evidence in the shared config. A successful setup or upgrade may advance it; the installer never writes it. The [adoption boundary](../50-engine-internals/managed-adoption.md) prevents an older binary from replacing newer managed material and prevents a branch from deleting or lowering trunk adoption. Matching versions still require the normal managed-file currency checks.

Agent files (`AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`) are tracked for bare clones. `discern done` blocks stale copies ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md), [ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). The tracked-refresh plan also covers discern's managed portions of tracked shared files, including generated attributes and provider integrations. `done` and `accept` require an empty plan before landing. After landing, acceptance materializes only ignored or local artifacts ([ADR 0264](../_adr/0264-tracked-refresh-convergence-precedes-landing.md)).

Project rules outside `.gitattributes`' discern markers remain unchanged, including nested and Git-local attributes. `setup`, `refresh`, and `upgrade` rebuild the block from `discern.toml`, the source-path registry, and the active agent registry. A rebuild replaces hand edits inside the block ([ADR 0093](../_adr/0093-upgrade-reconciles-gitignore-block.md), [ADR 0259](../_adr/0259-generated-groups-opt-in-to-review-metadata.md)).

The managed block requests `merge=discern-generated` for every tracked declared [generated artifact](../00-orientation/glossary.md#generated-artifact) and live agent-file output. Doctor passes that same canonical population to `git check-attr --stdin -z merge`; Git decides each path's protection instead of block inspection. It reports unsafe values without rewriting rules. Set `linguist_generated = true` inside one `[generated.<name>]` table to mark only that group's paths as generated for GitHub. GitHub then hides them in diffs by default and excludes them from language statistics. The default is false ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

Markdown inside discern's registered surfaces uses Git's built-in `markdown` diff driver. This covers configured map, instructions, skills, scripts, TODO, and brief paths plus active agent files. There is no repo-wide `*.md` rule: a project's README and other Markdown stay under the project's own attributes policy unless one of those paths is explicitly configured as a discern surface.

Materialized skills and provider-local state are ignored by exact registry path, leaving neighboring files unchanged. Add agent-file ignores outside the managed block if preferred. The currency check accepts a missing copy.

The ignore reconciler owns only its marked block and exact standalone rules that the current provider-artifact registry declares. Similar broad or retired rules outside the block remain project-owned. When `[worktree].root` resolves inside the repository, the managed block also ignores that exact nested directory; the default sibling worktree root needs no repository rule.

## Clone-local Git configuration

[`DISCERN_GIT_CONFIG_FOOTPRINT`](../../../src/engine/git_footprint.ts) is the authority for every Git configuration entry discern writes.

| Key or keyed pattern                                            | Scope        | Writer                           | Uninstall behavior                                                               |
| --------------------------------------------------------------- | ------------ | -------------------------------- | -------------------------------------------------------------------------------- |
| `merge.discern-generated.driver`                                | Clone-local  | Setup and refresh reconciliation | Removes the common value and obsolete worktree-local copies.                     |
| `extensions.worktreeConfig`                                     | Clone-local  | Pre-v1 generated-merge setup     | Removes it only when no surviving checkout-specific configuration depends on it. |
| `discern.proofNotesFetchRemote`                                 | Clone-local  | Proof note fetch reconciliation  | Removes each recorded ownership marker.                                          |
| `remote.<name>.fetch with one exact discern Proof note mapping` | Remote entry | Proof note fetch reconciliation  | Removes only the exact mappings paired with discern's ownership marker.          |

The generated merge driver has one definition in the common clone config and is effective from the main checkout and every linked worktree. Reconciliation migrates redundant `config.worktree` copies. A fresh clone has the tracked attributes but not clone-local configuration; its first setup or `discern refresh` installs the shared driver. An identical unmarked remote fetch mapping is project-owned and remains unchanged.

## Runtime state inside `.git`

Git-admin runtime records live under `discern/`; do not commit or edit them.

| Registered path                                    | Lifetime   | Purpose                                                                                                               |
| -------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `discern/completion/records/`                      | repository | Candidate, attempt, evidence, Proof, presentation, and exception records used by public commands.                     |
| `discern/completion/artifacts/`                    | repository | Captured producer output and extraction artifacts consumed by standards and emergency review.                         |
| `discern/resources/`                               | repository | Resource ledger.                                                                                                      |
| `discern/logbook/`                                 | repository | [Logbook](../00-orientation/trust-and-data.md) events.                                                                |
| `discern/logbook-archives/`                        | repository | Sealed Logbook event streams for historical Patterns and Stats reads.                                                 |
| `discern/logbook-recovery/`                        | repository | Detached Logbook source retained if reset cleanup or archive sealing fails.                                           |
| `discern/logbook-lifecycle.lock`                   | repository | Advisory lock serializing terminal-confirmed Logbook reset and archive actions.                                       |
| `discern/validation-hmac-key`                      | repository | Local key that makes validation-state and execution digests opaque but comparable across this repository's worktrees. |
| `discern/continuations/`                           | repository | Short-handle continuation state, kept for up to 7 days.                                                               |
| `discern/operations/`                              | repository | Progress journals for long operations behind short reconnect handles, kept for up to 7 days.                          |
| `discern/retired-worktree-paths/`                  | repository | Up to 256 removed-path records; status ignores records 90 days after removal.                                         |
| `discern/parked-tasks/`                            | repository | Branch-keyed task wording retained while Park removes the checkout.                                                   |
| `discern/drop-recovery.lock`                       | repository | Advisory lock serializing the bounded drop-recovery ref transaction.                                                  |
| `discern/crash/`                                   | repository | Crash reports.                                                                                                        |
| `discern/test-slots/`                              | repository | Fleet test-run cap lock files.                                                                                        |
| `discern/release-check.json`                       | repository | First adoption and optional last release-handoff timestamp and version.                                               |
| `discern/desk/tips.json`                           | repository | Desk tip evidence.                                                                                                    |
| `discern/desk/preferences.json`                    | repository | Last agent and task-creation path defaults.                                                                           |
| `discern/temp-artifact-sweep`                      | repository | Temp-retention sweep stamp and cursor.                                                                                |
| `discern/integration-landings/`                    | repository | One record per live or interrupted integration worktree: its owner and the frozen submission it composes.             |
| `discern/gate-proof`                               | worktree   | Proof from a clean `done` run.                                                                                        |
| `discern/last-gate-run`                            | worktree   | Last gate verdict.                                                                                                    |
| `discern/standard-measurements`                    | worktree   | Reusable measurements.                                                                                                |
| `discern/standard-measurement-evidence.json`       | worktree   | Fresh clean-commit measurements, including failures, used only to propose a new limit.                                |
| `discern/standard-limit-proposals.json`            | worktree   | Pending commit-bound Standard limit proposals.                                                                        |
| `discern/standard-limit-proposal-transaction.json` | worktree   | Interruption recovery for one proposed-limit config edit, commit, and record transition.                              |
| `discern/ignored-baseline`                         | worktree   | Ignored-file baseline.                                                                                                |
| `discern/effort-grant`                             | worktree   | Desk landing grant.                                                                                                   |
| `discern/effort-grant-claims/`                     | worktree   | Claims held by acceptance.                                                                                            |
| `discern/submission`                               | worktree   | The effort's submitted revision.                                                                                      |
| `discern/task-metadata.json`                       | worktree   | Display title, optional brief, and creation source.                                                                   |
| `discern/acceptance-transaction.json`              | worktree   | Acceptance recovery journal.                                                                                          |
| `discern/setup-machinery-commit-evidence.json`     | worktree   | Setup retry evidence.                                                                                                 |
| `discern/worktree-ready`                           | worktree   | Completed-setup marker.                                                                                               |
| `discern/worktree-setup-steps.json`                | worktree   | Step journal for interrupted worktree setup.                                                                          |
| `discern/checkpoint-open-questions`                | worktree   | Served checkpoint questions awaiting or holding a declared conclusion.                                                |
| `discern/shim/`                                    | worktree   | Per-identity self-shim ([ADR 0249](../_adr/0249-self-shims-cache-per-identity-sweep-pages-stay-budget-bounded.md)).   |

Durable state replacements share one interruption-safe policy; intentional moves and create-once publication remain separate ([ADR 0326](../_adr/0326-durable-replace-writes-use-one-atomic-writer.md)).

Repository records use the common Git directory; worktree records disappear with that worktree ([ADR 0165](../_adr/0165-git-admin-state-namespaced-by-lifetime.md)). Park copies the current task wording into `discern/parked-tasks/` before it removes the worktree record. The branch and commit identify the retained record; a successful `start --from` at that commit transfers its wording into the new worktree and removes the common record ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)). Await continuation records have a 7-day time limit and a 512-record repository cap ([ADR 0243](../_adr/0243-await-continuations-use-short-repository-local-handles.md)). Removed worktree path evidence has a 90-day limit and a 256-record cap; it authorizes only an explicit prune offer for the recorded path ([ADR 0265](../_adr/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md)). Guards enforce namespace, lifetime, and reset behavior.

Git stores drop recovery through ordinary refs under `refs/discern/recovery/`. Git can therefore choose its files-based or `reftable` storage format. The newest 32 refs keep committed tips reachable after their worktree branches are deleted. They remain local unless a person configures transport. `discern uninstall` leaves them in place because a ref may be the only remaining name for user-authored commits. Review and delete them with `git update-ref -d <ref>` when that recovery history is no longer needed ([ADR 0271](../_adr/0271-destructive-drops-retain-bounded-recovery-refs.md)).

Acceptance atomically moves the trunk and `refs/worktree/discern/acceptance-transactions/<id>` under an advisory lock. Rollback reverses both; Git reaps the ref with the worktree. The marker keeps landed authority spent after a trunk reset or reflog expiry.

Release reminders use this clone-local record independently of the logbook. The interval is 14 UTC calendar days from the last handoff, or first adoption when no handoff is recorded. Setup and upgrade seed first-seen evidence only on success. An applied release handoff records its timestamp and numeric version. Reading or showing an advisory writes nothing. Missing, invalid, unreadable, future, or newer-format evidence supplies no reminder age. State writes are best-effort; a newer schema remains intact. Uninstall removes this record with the common runtime namespace.

## Git refs

[`DISCERN_GIT_REF_FOOTPRINT`](../../../src/engine/git_footprint.ts) owns the complete ref inventory.

| Ref or namespace                                                 | Writer                                              | Lifecycle                                                | Uninstall |
| ---------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- | --------- |
| `refs/heads/discern-setup`                                       | `setup begin`                                       | Landed or retained as an ordinary local branch.          | Retained  |
| `refs/heads/<repository.branch_prefix><worktree-id>`             | `start`                                             | Deleted only with positive lifecycle ownership evidence. | Retained  |
| `refs/notes/discern`                                             | `accept`                                            | Durable local landing evidence.                          | Retained  |
| `refs/discern/remotes/<remote>/notes`                            | An ordinary user-owned fetch after discern wires it | Durable fetched landing evidence.                        | Retained  |
| `refs/discern/recovery/<timestamp>-<worktree-id>-<nonce>`        | `worktree drop`                                     | Bounded recovery evidence.                               | Retained  |
| `refs/worktree/discern/acceptance-transactions/<transaction-id>` | `accept`                                            | Temporary compare-and-swap recovery evidence.            | Retained  |

Uninstall never deletes a ref. Its result lists each concrete private discern ref that remains and gives one exact `git update-ref -d '<ref>'` command per ref as optional cleanup. Ordinary local branches remain visible as branches and receive no automatic cleanup suggestion.

## Removing it all

`discern uninstall` removes generated files, discern-owned Shared entries, the managed `.gitignore` and `.gitattributes` blocks, the whole `discern/` runtime-state namespace under Git's administrative directories, the common generated-merge driver and its obsolete checkout-local copies, and only marked Proof-note fetch mappings ([ADR 0104](../_adr/0104-uninstall-is-the-exit-honesty-verb.md)). Preview with `discern uninstall --dry-run`.

It keeps project-owned files, `discern.toml`, unmarked Git configuration, checkout-specific configuration the project still needs, and every ref. It reports retained private refs and optional exact cleanup commands without running them. It names Shared settings that it cannot clean without bundled templates. It refuses while a worktree is in flight or while the resource ledger records provisioned resources. Those entries hold their only destroy commands, so reclaim them with `discern worktree prune` first. Uninstall is CLI-only, performs no remote operation, and leaves normal Git hooks to run with Git's usual exit semantics. Delete the binary reported by `which discern`.

## Where it lives in code

| Concept                            | File                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| Ownership declarations             | [`src/lib/artifact_ownership.ts`](../../../src/lib/artifact_ownership.ts)               |
| Provenance classes                 | [`src/shared/file_ownership.ts`](../../../src/shared/file_ownership.ts)                 |
| Source paths                       | [`src/shared/paths_registry.ts`](../../../src/shared/paths_registry.ts)                 |
| Provider paths                     | [`src/lib/providers.ts`](../../../src/lib/providers.ts)                                 |
| Git-admin state                    | [`src/shared/git_admin_state.ts`](../../../src/shared/git_admin_state.ts)               |
| Atomic state replacement           | [`src/shared/atomic_write.ts`](../../../src/shared/atomic_write.ts)                     |
| Ownership forcing function         | [`tests/artifact_ownership_test.ts`](../../../tests/artifact_ownership_test.ts)         |
| Rename enrollment guard            | [`tests/atomic_write_enrolment_test.ts`](../../../tests/atomic_write_enrolment_test.ts) |
| Provenance guards                  | [`tests/artifact_provenance_test.ts`](../../../tests/artifact_provenance_test.ts)       |
| Write-surface guard                | [`tests/paths_write_surface_test.ts`](../../../tests/paths_write_surface_test.ts)       |
| The managed `.gitignore` block     | [`src/lib/agent_gitignore.ts`](../../../src/lib/agent_gitignore.ts)                     |
| The managed `.gitattributes` block | [`src/lib/agent_gitattributes.ts`](../../../src/lib/agent_gitattributes.ts)             |
| Git config and ref inventory       | [`src/engine/git_footprint.ts`](../../../src/engine/git_footprint.ts)                   |
| Uninstall                          | [`src/commands/uninstall.ts`](../../../src/commands/uninstall.ts)                       |

## See also

- [The install surface](../80-development/install-surface.md): the exhaustive engineering inventory by ownership bucket.
- [Licenses](https://discern.sh/docs/reference/licenses): the authorship boundary and downstream redistribution responsibility.
- [Agent integrations](../60-agent-integrations/): the exact file table per coding agent.
- [Trust and your data](../00-orientation/trust-and-data.md): the network, telemetry, and execution contract on one screen.
