# Open work — {{project_name}}

The **deferred-work ledger**: the agent-maintained record of outstanding work — verified defects, deferred fixes, known dead code, and at-risk or unmerged work. The map at `{{map_dir}}` describes what _currently exists_; this file tracks what's _still owed_.

## For agents (any agent — and the maintainer)

- **When you defer something, descope, or find a real issue you won't fix this round, record it here.** Don't bury it in a private memory, a one-off chat reply, or a lone code comment — those are invisible to the next agent and to the maintainer. This file is the shared backlog.
- **Format:** one checkbox per item — a bold title, a one-line description, and `Evidence:` with `file:line` where it applies. Add an area tag if it helps. Keep entries terse and factual; link code with relative paths.
- **When you finish an item, delete its line** — the commit that resolves it is the record. Don't leave ticked boxes lying around.
- **Scope:** this file is for work that _outlives a single session_. For tracking the steps of the task you're doing right now, use your own in-session task tooling, not this file.
- This is a backlog, not documentation — modal verbs ("should", "could") are fine here, unlike in the map. Don't write that something was "finished this round" — that's meaningless to a future reader ("which round?"). Every item must be pickup-able at any later time with no session-specific context required.

---

## 📚 Documentation — finish the seeded map

`discern setup` lays the map at `{{map_dir}}` as a skeleton: `00-orientation/` and the numbered subsystem subtrees (`10-…` onward) ship as stubs, still to be written from the code. Filling them is the one piece of work a fresh project starts out owing.

- [ ] **Document each numbered doc subtree.** Use the `discern-document-subsystem` skill — one run per subsystem — to write that subtree's `README.md` and its leaves from the real code, replacing the placeholder stubs setup laid. Delete each subtree's line as you fill it, and delete this whole section once the tree is complete.

---

<!--
  The severity buckets below start empty by design — beyond the documentation
  item above, a fresh project owes nothing yet. Add items under the heading that
  fits; create a new bucket only if none do. Suggested order is most-urgent first.
-->

## 🔴 Performance & correctness

_Verified defects and correctness risks. Nothing outstanding._

## 🟠 Cleanup — known dead or slow code

_Dead code, N+1s, and known-slow paths worth removing or fixing. Nothing outstanding._

## 🟡 Smaller fixes & polish

_Lower-severity fixes, rough edges, and UX papercuts. Nothing outstanding._

## 🟢 Test & tooling hygiene

_Gaps in test coverage, gate, and developer tooling. Nothing outstanding._

## 🔵 Unmerged / at-risk work — decide: land or drop

_Work built but not merged, or otherwise at risk of being lost. Nothing outstanding._

## ⚪ Explorations / ideas (unscheduled)

_Ideas worth keeping but not yet scheduled. Nothing outstanding._
