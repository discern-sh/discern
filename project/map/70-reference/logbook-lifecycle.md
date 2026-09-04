---
title: Logbook lifecycle
description: How owners preview and confirm archive or reset, how sealed history stays recoverable, and how reports select it.
order: 150
aliases:
  - logbook archive
  - logbook reset
  - historical logbook
---

# Logbook lifecycle

_Archive preserves the active evidence for later reports. Reset permanently removes only the active evidence._

## Preview and authorize

```sh
discern patterns seal --dry-run
discern patterns reset --dry-run
discern patterns seal
discern patterns reset
```

The previews report the event count, date span, source files, bytes, and archive destination or deletion scope. They remain read-only under pipes, CI, `--plain`, `--json`, and `--markdown`.

Apply is a CLI-only owner action. It requires terminal input and output, operation outside CI and global `--plain`, and an explicit affirmative selection from a confirmation that defaults to **Keep**. Reset offers **Keep** or **Delete**; archive offers **Keep** or **Archive**. Pipes, `--json`, and `--markdown` apply refuse, and no flag or environment bypass exists. Declining changes no file or lifecycle state. Both actions refuse while active history contains another fresh unmatched invocation ([ADR 0272](../_adr/0272-logbook-lifecycle-actions-require-terminal-confirmation.md)).

## Archive boundary and recovery

Archive atomically detaches `logbook/`, then copies the month shards' raw JSON Lines into a synced UTC-named file under `logbook-archives/`. A numeric suffix prevents collisions. `epoch.json` remains recorder state and is omitted. The final name is published atomically; only then is the detached source removed. A sealing failure leaves that source under `logbook-recovery/` and reports its path.

A recorder arriving after detachment creates a fresh active directory. It never waits on the lifecycle lock, preserving fail-open recording. Archive and reset themselves record no begin or completion, so one invocation cannot straddle the old and new histories. Reset targets only active `logbook/`; archives and other Git-admin state survive.

## Find and read sealed history

```sh
discern patterns archives
discern patterns --logbook-file logbook-20260811T143015Z.jsonl
discern patterns --stats --logbook-file logbook-20260811T143015Z.jsonl
```

The selector accepts one listed regular-file basename inside `logbook-archives/`. It rejects paths, traversal, symbolic links, directories, active month files, and names outside the archive format. Historical reports never modify the archive; their own event goes to the active logbook when recording is enabled. `discern_patterns` accepts the same optional selector. Operational readers always use active history.
