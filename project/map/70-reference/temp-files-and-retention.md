---
title: Temp files & retention
description: What discern writes to your OS temp directory, how long each file lives, where the self-shim resolves, and how everything leaves with the tool.
order: 140
publish: true
aliases:
  - temp files
  - temp directory
  - retention
  - discern-job files
  - self-shim
---

# Temp files & retention

_discern keeps selected temporary output for 24 hours so you can inspect it after a run. A registry defines each file family and its retention rule._

## Files in your temp directory

Every name carries its family's registered prefix, then the minting checkout's project slug and worktree id when the run can resolve them, then a random tail — for example `/tmp/discern-job-my-app-wt-feature-1a2b3c.log`. On a machine running several discern projects at once, the label says which checkout each file came from.

| Prefix                      | What it holds                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `discern-job-`              | A Gate job's full output. Results expose this file as `output_path` so it remains available after the run. |
| `discern-diag-`             | The full text behind a truncated diagnostic.                                                               |
| `discern-crash-`            | A crash report written outside any repository ([crash reports](crash-reports.md)).                         |
| `discern-checkpoint-input-` | Structured facts served to one checkpoint `when` command, removed with the run.                            |
| `discern-self-`             | A fallback self-shim for a run with no repository root.                                                    |
| `discern-test-`             | Scaffolds from discern's own test suite. Installed runtime commands do not create this family.             |

Each file remains for 24 hours after its run. Gate verbs remove expired files in pages of at most 500. A lock under the shared Git directory limits each repository to one page per hour. A burst of runs therefore scans the temp directory once, and each gate start performs at most one page of cleanup ([ADR 0216](../_adr/0216-temp-retention-is-repository-throttled-and-inspection-bounded.md), [ADR 0249](../_adr/0249-self-shims-cache-per-identity-sweep-pages-stay-budget-bounded.md)).

## The self-shim

Commands the gate runs resolve `discern` to the engine that started them through a small shim script ([ADR 0182](../_adr/0182-operator-commands-resolve-discern-to-the-running-engine.md)). The shim normally lives in one content-addressed directory per engine under the worktree's Git administrative area. Every process for that engine shares the directory, and worktree removal removes it. A run with no repository root instead uses a per-process temp directory that the retention sweep removes.

## Removal

Runtime state under `.git/discern/` includes the logbook, Proofs, locks, and shim. `discern uninstall` removes it, but refuses while the resource ledger still records provisioned resources. [Files and ownership](artifact-ownership.md) lists every registered path and its lifetime.
