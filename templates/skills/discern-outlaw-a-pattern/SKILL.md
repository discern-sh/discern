---
name: discern-outlaw-a-pattern
description: Make a legacy pattern illegal in the codebase — detector, falling ratchet, removal as fast as the work allows, then a permanent gate rule at zero. Use when the user wants to migrate off, phase out, deprecate, ban, or eliminate a pattern, API, idiom, or dependency codebase-wide ("stop using X", "move everything to Y", "get rid of the old way"), or when a half-finished migration keeps regressing. Bundled with discern.
---

# Outlaw a pattern

A codebase-wide migration fails in a predictable way: the sweep converts most of the instances, the stragglers hide, and next month someone pastes the old idiom back in — nothing made the old way *illegal*, so the migration never actually ends. This skill ends it by legislation: the pattern is outlawed **today** (a detector counts it, a ratchet forbids the count from ever rising), removal proceeds as fast as you can afford — one sweep if it fits, tranches if it doesn't — and at zero the ban becomes a permanent rule of the gate.

The ratchet's role here is not gradualism. It is a **one-way door**: from the moment it lands, no new instance can enter and no landing can be undone by a later one. Whether enforcement then takes one branch or six weeks is a scheduling choice the guarantee doesn't depend on.

---

## 1. Name the law: the outlawed pattern, and its replacement

State precisely **what is now illegal** — as a checkable predicate over the code, not a vibe ("every direct call to X outside module Y", not "the old style"). And state **what replaces it**, concretely enough that someone hitting the pattern knows exactly what to write instead. A ban with no sanctioned replacement just breeds creative new violations.

Separate the essential class from incidental look-alikes exactly as `discern-cure-a-bug` step 1 does — an over-broad law outlaws code that was never the problem, and the false positives will be used to argue the whole ban down.

---

## 2. Write the detector, and take the census

Author an executable check that **counts** current instances — a structural-search or lint rule (`semgrep`, `ast-grep`, a custom script) beats a text grep for the same reason it does in `discern-cure-a-bug` step 4: instances that share no literal substring. Run it; the number is the size of the job, measured rather than guessed. Sanity-check a sample of matches against the predicate from step 1 before trusting the count.

Make the detector runnable as one repo command — it's about to become the ratchet's measurement.

---

## 3. Pass the law: ratchet the count down

Wire the detector's count as a `direction = "down"` ratchet — the `discern-ratchet-a-metric` skill has the full procedure and the config shape; the short of it is a `[ratchets.<name>]` table whose `run` prints `DISCERN_METRIC <name> <count>`, with `limit` set to **today's census**, and `discern ratchets` checked before pushing.

This is the moment the pattern becomes illegal: any branch that *adds* an instance now fails the ratchet, whoever writes it, however unrelated their task. Announce the law where the next writer will look — the project guidance or conventions doc names the outlawed pattern and its replacement, so the ratchet is the enforcement and not the documentation.

---

## 4. Enforce as fast as you can afford

Now remove instances — at whatever pace the work and the budget allow, because the guarantee no longer depends on speed:

- **One sweep** when the conversion is mechanical or the count is small: a single branch that drives the count to zero. Prefer this when it fits — a migration that ends today needs no management.
- **Tranches on real seams** when it doesn't fit: split by directory, module, or subsystem into slices that share no files in flight, and land them independently — in parallel worktrees via `discern-delegate-work` if the streams are truly disjoint. As each tranche lands, **tighten the ratchet's limit to the new count** in the same change, locking the progress in; that falling number is the migration's honest progress bar.

Convert to the replacement from step 1 — resist "improving" each site along the way (a migration commit that also refactors is a review nobody can trust), and let the detector, not the diff, say when a tranche is done.

---

## 5. At zero, make the ban absolute

When the census hits zero, the ratchet has done its job — don't leave it holding an empty line:

- **Graduate the detector into the always-on gate** — a check or test that fails on the *first* new instance, so the ban now holds without anyone running the ratchets. Then retire the `[ratchets.<name>]` table.
- **Finish the paperwork** — the docs describe only the new way (the old pattern moves to history, not "both are supported"); if the ban's rationale is surprising or was contested, record it with `discern-write-adr`; delete any compatibility shims the migration needed in transit.

---

## Done when

- the law is written: the outlawed pattern is a **checkable predicate** and the sanctioned **replacement** is documented where the next writer will look;
- a **detector** counts instances structurally and runs as one repo command;
- the count sits behind a **`down` ratchet** whose limit tracks the real census — so no new instance can land and no landing can regress, regardless of how fast removal proceeds;
- removal is finished, or proceeding in tranches with the limit tightened at each landing;
- at **zero**, the detector is a permanent gate rule, the ratchet is retired, and the docs describe only the new way.
