---
title: Temp files & retention
description: What discern writes to your OS temp directory, how long each file lives, where the self-shim resolves, and how everything leaves with the tool.
order: 120
publish: true
aliases:
  - temp files
  - temp directory
  - retention
  - discern-job files
  - self-shim
---

# Temp files & retention

_Gate output outlives its run so you can inspect it; a registry names every temp file discern mints, and an hourly sweep reaps them by age._

## What lands in your temp directory

Every family carries a registered prefix and a random name:

| Prefix           | What it holds                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `discern-job-`   | A gate job's full output — the `output_path` in results, kept so a loud-but-passing job stays inspectable after the run. |
| `discern-diag-`  | The full text behind a truncated diagnostic.                                                                             |
| `discern-crash-` | A crash report written outside any repository ([crash reports](crash-reports.md)).                                       |
| `discern-self-`  | A fallback self-shim for a run with no repository root.                                                                  |
| `discern-test-`  | Scaffolds from discern's own test suite; inert on your machine.                                                          |

Each file lives 24 hours past its run. Retention is bounded and repository-throttled: gate verbs reap expired files in pages of at most 500, one page per repository per hour, coordinated through a lock under the shared Git directory — so a burst of runs scans your temp directory once, and no single gate start pays more than one bounded page ([ADR 0216](../_adr/0216-temp-retention-is-repository-throttled-and-inspection-bounded.md), [ADR 0249](../_adr/0249-self-shims-cache-per-identity-sweep-pages-stay-budget-bounded.md)).

## The self-shim

Commands the gate runs resolve `discern` to the engine that spawned them through a small shim script ([ADR 0182](../_adr/0182-operator-commands-resolve-discern-to-the-running-engine.md)). It normally lives outside temp altogether: one content-addressed directory per engine under the worktree's Git administrative area, shared by every process of that engine and removed with the worktree. Only a run with no repository root falls back to a per-process temp directory the sweep reaps.

## Leaving

Runtime state under `.git/discern/` — the logbook, receipts, locks, the shim — exits with `discern uninstall`, which refuses while the resource ledger still records provisioned resources. [Files & ownership](artifact-ownership.md) lists every registered path and its lifetime.
