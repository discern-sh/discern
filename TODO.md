# Open work — icculus

The single source of truth for **outstanding work**: verified defects, deferred
fixes, known dead code, and at-risk or unmerged work. The
[`docs/`](docs/README.md) tree describes what _currently exists_; this file
tracks what's _still owed_.

## For agents (any agent — and the maintainer)

- **When you defer something, descope, or find a real issue you won't fix this
  round, record it here.** Don't bury it in a private memory, a one-off chat
  reply, or a lone code comment — those are invisible to the next agent and to
  the maintainer. This file is the shared backlog.
- **Format:** one checkbox per item — a bold title, a one-line description, and
  `Evidence:` with `file:line` where it applies. Add an area tag if it helps.
  Keep entries terse and factual; link code with relative paths.
- **When you finish an item, delete its line** — the commit that resolves it is
  the record. Don't leave ticked boxes lying around.
- **Scope:** this file is for work that _outlives a single session_. For
  tracking the steps of the task you're doing right now, use your own in-session
  task tooling, not this file.
- This is a backlog, not documentation — modal verbs ("should", "could") are
  fine here, unlike in `docs/`. Don't write that something was "finished this
  round" — that's meaningless to a future reader ("which round?"). Every item
  must be pickup-able at any later time with no session-specific context
  required.

---

<!--
  The severity buckets below are empty by design — a fresh project owes nothing
  yet. Add items under the heading that fits; create a new bucket only if none
  do. Suggested order is most-urgent first.
-->

## 🔴 Performance & correctness

_Verified defects and correctness risks. Nothing outstanding._

## 🟠 Cleanup — known dead or slow code

- **Dead engine helper `assert-not-in-worktree`** — nothing invokes it: not the
  `bin/agent` dispatcher, no sibling recipe or engine lib, no `.claude`
  SessionStart/WorktreeCreate hook, no `src/` caller (only the generated
  `manifest.json` file-list mentions it). Its inverse `assert-in-worktree` is
  the one actually used (by `worktree-teardown` and `inherit-main-env-vars`).
  Decide: wire it into the main-checkout-only recipes that currently open-code
  their own guard, or remove it. Removal is a `templates/` edit (→
  `deno task selfsync`); on a consumer it is reconciled as an orphan on
  `upgrade`. Evidence: `templates/.icculus/engine/assert-not-in-worktree:1`.

## 🟡 Smaller fixes & polish

_Lower-severity fixes, rough edges, and UX papercuts. Nothing outstanding._

## 🟢 Test & tooling hygiene

_Test-suite and tooling hygiene. Nothing outstanding._

## 🔵 Unmerged / at-risk work — decide: land or drop

_Work built but not merged, or otherwise at risk of being lost. Nothing
outstanding._

## ⚪ Explorations / ideas (unscheduled)

_Unscheduled explorations and ideas. Nothing outstanding._
