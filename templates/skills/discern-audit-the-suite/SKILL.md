---
name: discern-audit-the-suite
description: Audit the test suite for instance-pinned coverage — sibling test cases that each hand-check one member of a shared invariant no class-level test guards — and convert each cluster into a guard driven off the single source of truth so new members auto-enrol. Use when asked to audit or harden the test suite, hunt duplicated or copy-pasted tests, check whether tests guard the class rather than the instance, or after a defect shipped in a member whose siblings were all tested. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Audit the suite — find the invariants your tests only pin one member of

A test suite can look thorough while guarding almost nothing. The tell is a *cluster*: several tests that each hand-check the **same property of a different member** of some enumerable class — one per command, one per output format, one per plugin — with no test that checks the property across the *whole* class. Every existing member is covered; the class is wide open. The member added next month ships with zero coverage of the very property its siblings are all tested for, and the suite stays green.

This is the test-suite face of "fix the class, not the instance" (`discern-cure-a-bug`): the same recall failure, hiding inside the checks themselves. This skill is the executable audit — sweep the suite, find every such cluster, and close each one with a guard a new member can't escape.

---

## 1. Memorize the finding predicate

A test case is a **finding** exactly when all three hold:

1. It asserts a property *P* about **one member** *x* of an enumerable class *X* (a command, a supported format, a registered handler, a lifecycle stage, …).
2. At least one **sibling test** asserts the same *P* about a **different member** of *X* — the two share a broader invariant: "for every member of *X*, *P* holds."
3. **No test guards the invariant itself** — nothing derives *X*'s members from their single source of truth and asserts *P* over all of them, so a new member auto-enrols in nothing.

Just as important, a finding is **not**:

- **Shared mechanism.** Two tests using the same helper or scaffold while asserting genuinely different, member-specific behaviour. Each member's *unique* semantics deserves its own test — that is depth, keep it.
- **Depth on one feature.** Several tests probing different edge cases of a single member are not instances of a class property.
- **Already-iterating tests.** A test that walks the canonical set is the guard, not a finding.
- **Look-alike assertions.** Superficial resemblance (same assertion helper, similar names) without a shared ∀-statement. If you cannot phrase the invariant as "for every member of *X*, *P*", there is no cluster.

The acid test for a real finding: one parameterized test iterating the canonical set would subsume the whole cluster, and *until it exists* a new member of *X* silently escapes *P*.

---

## 2. Inventory the canonical sets before reading a single test

List the project's enumerable classes first — they are what findings attach to:

- **Registries and tables** — command tables, handler registries, plugin lists;
- **Enums and closed unions** — stages, states, kinds, formats;
- **Config vocabularies** — the keys and sections a schema defines;
- **Directory-driven sets** — one subdirectory per template, migration, or rule, where the filesystem *is* the registry.

Note where each set's single source of truth lives. When a shared invariant turns up whose class has **no** single source — the members exist only as scattered literals — record that too: it is a finding of a deeper kind, and creating the registry becomes step one of the fix.

## 3. Baseline the guards that already exist

Find the tests that already iterate a canonical set (search for imports of the registries and loops or table-driven cases over them, and for directory walks over the set-defining folders). This baseline is what keeps the audit honest in both directions: a cluster whose invariant one of these already covers is **not** a finding, and a guard that covers it only partially turns the finding into "extend the guard" rather than "write one."

## 4. Sweep with a worklist, classify every test case

Walk the suite file by file, and for **every** test case record three things: the property *P* it asserts, the member *x* it pins, and the class *X* the member belongs to. Read the assertions, not the test names — names advertise intent, assertions are the fact. Keep the worklist as running state (a scratch table of file → cases → classifications) so the pass is **interruptible and resumable**: a budget or context limit should cost you nothing but a pause, never a restart.

## 5. Cluster, then check for a guard before flagging

Group the classified cases by (*X*, *P*). Two or more members with the same property is a candidate cluster — including across files; the strongest clusters are usually the cross-file ones nobody sees side by side. Before flagging, search again for a class-level guard of that specific invariant (step 3's baseline, plus a targeted search for the set's source of truth appearing anywhere in the tests). Full coverage → drop the candidate. Partial coverage → keep it, and name exactly what the existing guard misses.

## 6. Verify every cluster line-by-line

Re-read each member test before reporting it. Confirm the property really is the *same* ∀-statement (not two properties that merely rhyme), the members really are *different*, and the escape is concrete: state which future member would dodge which check. Label each cluster's confidence honestly — a verified cluster with a named escape is a finding; anything less is a suspicion and must say so.

## 7. Report so completeness can be checked

For each finding, report: the **invariant** as a ∀-statement; the **class** and its **source of truth** (or "none exists yet"); the **existing-guard status** (none / partial and what it misses); every **member test** by file and line with its key assertion; the concrete **escape**; and a **confidence** label. Close with the tally — every file examined and its case count — so "audited the whole suite" is a falsifiable claim, the same discipline `discern-cure-a-bug` demands of a fix's residual scope.

## 8. Scale the sweep honestly

A small suite is a solo pass. For a large one, partition the files by subsystem — clusters concentrate inside subsystems, so this keeps most of them within one reader's view — and delegate each partition to a read-only auditor carrying the finding predicate, the not-a-finding list, and the report schema **verbatim** (see `discern-delegate-work` for the handoff discipline). Two rules keep delegation from corrupting the audit:

- **Adjudicate centrally.** A delegate's claim enters the final report only after you re-verify it against the actual test code (step 6). Delegates raise recall; only verification supplies precision.
- **Join across partitions.** Have each auditor also flag *singletons* — lone tests pinning one member of a property whose siblings plausibly live in other partitions — and match those suspects up during adjudication. Cross-partition clusters are the ones a partitioned sweep structurally misses.

## 9. Close each cluster with a class guard

The fix for a verified finding is one test that derives the members from the single source of truth and asserts the property over all of them — a new member then auto-enrols the moment it is registered. Where a member legitimately differs, record it in an explicit, named **exception set** that the guard also asserts is still honest (each exception must still *be* a member, still differing for the stated reason) — an exception that can go stale is a second hand-copied list. Keep the member-specific tests that assert genuinely unique behaviour; delete the ones the guard subsumes. Wire the guard into the gate, and if the class had no source of truth, create the registry first and point both the code and the guard at it — the full discipline is `discern-cure-a-bug`, steps 2–6.

---

## Done when

- **every test case** in scope is classified (property, member, class) and the file tally is reported — completeness is checkable, not asserted;
- every candidate cluster is either **traced to an existing guard** or **reported** with its invariant, source of truth, members, escape, and confidence — verified line-by-line, never on a delegate's word;
- each verified cluster is **closed by a guard that iterates the single source of truth** (with honest, self-checking exception sets), wired into the gate so the next member of the class cannot ship untested.
