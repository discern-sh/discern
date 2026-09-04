# Audit the suite — find the checks that guard less than they appear to

A test suite can look thorough while guarding almost nothing. The first tell is a _cluster_: several tests that each hand-check the **same property of a different member** of some enumerable class — one per command, one per output format, one per plugin — with no test that checks the property across the _whole_ class. Every existing member is covered; the class is wide open. The member added next month ships with zero coverage of the very property its siblings are all tested for, and the suite stays green.

The second tell is easier to miss because a guard _is_ present: the **under-scoped guard**. A past fix left a check behind — a regression test, a table of cases, a lint or structural rule — but scoped it to the population it was written against: the incident's identifiers, a hand-listed set of members, one container of the several that can host the same mistake. Every name the guard knows is covered; the _mechanism_ is wide open. The defect returns under a fresh name or in a new parallel container, the guard stays green, and the suite's history even records the class as cured.

Both are the test-suite face of "fix the class, not the instance" (the cure procedure in this skill's `SKILL.md`): the same recall failure, hiding inside the checks themselves. This procedure is the executable audit — sweep the suite for both, and close each finding with a guard the next member, however named and wherever placed, can't escape.

---

## 1. Memorize the finding predicates

There are two kinds of finding. A test case is an **uncovered invariant** exactly when all three hold:

1. It asserts a property _P_ about **one member** _x_ of an enumerable class _X_ (a command, a supported format, a registered handler, a lifecycle stage, …).
2. At least one **sibling test** asserts the same _P_ about a **different member** of _X_ — the two share a broader invariant: "for every member of _X_, _P_ holds."
3. **No test guards the invariant itself** — nothing derives _X_'s members from their single source of truth and asserts _P_ over all of them, so a new member auto-enrols in nothing.

A guard is an **under-scoped guard** exactly when both hold:

1. It exists to hold an invariant over a class — usually the residue of a past bug fix — but derives the cases it checks from something narrower than the class: a hand-maintained list, a denylist of specific tokens, the identifiers of one past incident, or a single container when a parallel container hosting the same mechanism can be created without joining it.
2. It fails the **fresh-name test** (the cure procedure, `SKILL.md` step 1): the same mechanism reintroduced tomorrow under unrelated names, or in a new container, would not make the guard fire without someone first editing the guard.

Just as important, a finding is **not**:

- **Shared mechanism.** Two tests using the same helper or scaffold while asserting genuinely different, member-specific behavior. Each member's _unique_ semantics deserves its own test — that is depth, keep it.
- **Depth on one feature.** Several tests probing different edge cases of a single member are not instances of a class property.
- **Already-iterating tests.** A test that walks the canonical set is the guard, not a finding.
- **Look-alike assertions.** Superficial resemblance (same assertion helper, similar names) without a shared ∀-statement. If you cannot phrase the invariant as "for every member of _X_, _P_", there is no cluster.
- **A demonstrated boundary.** A guard pinned to one named container is sound when the architecture makes that boundary the only place the mechanism can exist — but that claim must be demonstrated by enumeration, never inferred from the guard's own comment or the original fix's commit message.
- **A deliberate example.** A test that pins one member as documentation or a smoke check, alongside a class guard that already iterates the source of truth, duplicates coverage at worst — it is not an escape.

The acid test for either kind: name the concrete escape. For an uncovered invariant, one parameterized test iterating the canonical set would subsume the whole cluster, and _until it exists_ a new member of _X_ silently escapes _P_. For an under-scoped guard, describe the fresh-named sibling or new container that reproduces the mechanism while leaving the guard green. No nameable escape, no finding.

---

## 2. Inventory the canonical sets before reading a single test

List the project's enumerable classes first — they are what findings attach to:

- **Registries and tables** — command tables, handler registries, plugin lists;
- **Enums and closed unions** — stages, states, kinds, formats;
- **Config vocabularies** — the keys and sections a schema defines;
- **Directory-driven sets** — one subdirectory per template, migration, or rule, where the filesystem _is_ the registry.

Note where each set's single source of truth lives. When a shared invariant turns up whose class has **no** single source — the members exist only as scattered literals — record that too: it is a finding of a deeper kind, and creating the registry becomes step one of the fix.

## 3. Baseline the guards that already exist — then audit them

Find the tests that already iterate a canonical set (search for imports of the registries and loops or table-driven cases over them, and for directory walks over the set-defining folders). This baseline is what keeps the audit honest in both directions: a cluster whose invariant one of these already covers is **not** a finding, and a guard that covers it only partially turns the finding into "extend the guard" rather than "write one."

The baseline is also a worklist of its own: judge every existing guard against the under-scoped-guard predicate before trusting it. Read what the guard actually derives its cases from, not what its name or comment claims — a "class guard" that walks a hand-written array is a list wearing a guard's name. When a guard's intent is unclear, read the commit that introduced it: an under-scoped guard is usually the residue of a bug fix, and the incident's identifiers leaking from that commit into the guard's fixtures, cases, or match patterns is the signature of a class scoped to its first occurrence. The tells:

- a hand-maintained member list where a registry, schema, or directory-driven set exists (or should);
- a denylist of specific tokens or names standing in for a structural rule;
- iteration over one container — one registry, one directory, one component — when a sibling container hosting the same mechanism can be created without joining it;
- fixtures, cases, or test names carrying the identifiers of one past incident;
- a regression test asserting one exact reproduction where the fix that left it claimed to cure a class.

## 4. Sweep with a worklist, classify every test case

Walk the suite file by file, and for **every** test case record three things: the property _P_ it asserts, the member _x_ it pins, and the class _X_ the member belongs to. Read the assertions, not the test names — names advertise intent, assertions are the fact. Keep the worklist as running state (a scratch table of file → cases → classifications) so the pass is **interruptible and resumable**: a budget or context limit should cost you nothing but a pause, never a restart.

## 5. Cluster, then check for a guard before flagging

Group the classified cases by (_X_, _P_). Two or more members with the same property is a candidate cluster — including across files; the strongest clusters are usually the cross-file ones nobody sees side by side. Before flagging, search again for a class-level guard of that specific invariant (step 3's baseline, plus a targeted search for the set's source of truth appearing anywhere in the tests). Full coverage by a guard step 3 judged sound → drop the candidate. Coverage by an under-scoped guard, or partial coverage → keep it, and name exactly what the existing guard misses.

## 6. Verify every finding line-by-line

Re-read each member test before reporting it. Confirm the property really is the _same_ ∀-statement (not two properties that merely rhyme), the members really are _different_, and the escape is concrete: state which future member would dodge which check. Label each cluster's confidence honestly — a verified cluster with a named escape is a finding; anything less is a suspicion and must say so.

Verify an under-scoped guard the same way, with two extra obligations. First, the escape must be stated as a mechanism, not a hunch: describe the fresh-named sibling or new parallel container that reproduces what the guard exists to stop while leaving it green. Second, hunt for members _already_ outside the guard's scope: state the universe the mechanism can inhabit, then search it structurally — by shape, not spelling, since the siblings most worth finding share no token with the guarded cases (the cure procedure, step 4). A live, unguarded member found this way is the audit's highest-value result — not a coverage gap but an open defect — and it gets reported and fixed ahead of everything else.

## 7. Report so completeness can be checked

For each uncovered invariant, report: the **invariant** as a ∀-statement; the **class** and its **source of truth** (or "none exists yet"); the **existing-guard status** (none / partial and what it misses); every **member test** by file and line with its key assertion; the concrete **escape**; and a **confidence** label.

For each under-scoped guard, report: the **mechanism** the guard exists to stop; what it **currently derives its cases from**; the concrete **escape**; any **live members** found outside its scope; and a **confidence** label. Guards you judged sound get a line too, with the demonstrated boundary claim — a reviewer must be able to check the acquittals as well as the convictions.

Close with the tally — every file examined and its case count, every baseline guard and its verdict — so "audited the whole suite" is a falsifiable claim, the same discipline the cure procedure demands of a fix's residual scope.

## 8. Scale the sweep honestly

A small suite is a solo pass. For a large one, partition the files by subsystem — clusters concentrate inside subsystems, so this keeps most of them within one reader's view — and delegate each partition to a read-only auditor carrying both finding predicates, the not-a-finding list, and the report schemas **verbatim** (see `discern-delegate-work` for the handoff discipline). Two rules keep delegation from corrupting the audit:

- **Adjudicate centrally.** A delegate's claim enters the final report only after you re-verify it against the actual test code (step 6). Delegates raise recall; only verification supplies precision.
- **Join across partitions.** Have each auditor also flag _singletons_ — lone tests pinning one member of a property whose siblings plausibly live in other partitions — and match those suspects up during adjudication. Cross-partition clusters are the ones a partitioned sweep structurally misses.

## 9. Close each finding with a class guard

The fix for a verified cluster is one test that derives the members from the single source of truth and asserts the property over all of them — a new member then auto-enrols the moment it is registered. Where a member legitimately differs, record it in an explicit, named **exception set** that the guard also asserts is still honest (each exception must still _be_ a member, still differing for the stated reason) — an exception that can go stale is a second hand-copied list. Keep the member-specific tests that assert genuinely unique behavior; delete the ones the guard subsumes. Wire the guard into the gate, and if the class had no source of truth, create the registry first and point both the code and the guard at it — the full discipline is the cure procedure (`SKILL.md`), steps 2–6.

Close an under-scoped guard by **widening, never narrowing**: restate what it protects as a name-independent predicate that passes the fresh-name test, then rebuild the guard to derive its cases from the broadest set a new manifestation cannot avoid joining — so new members _and_ new containers both auto-enrol. Run the widened guard **before** fixing anything: its failures are the class's current population, and every live member it surfaces gets fixed to green as part of the close. Prove the widening with an adversarial future-sibling fixture — the mechanism rebuilt under unrelated names that the guard must reject without a case-table edit. If the widened guard reveals more than this pass can fix, fix what you can and hold the remainder behind an explicit ratchet that may only shrink — never a silent skip, and never a re-narrowed guard.

---

## Done when

- **every test case** in scope is classified (property, member, class) and the file tally is reported — completeness is checkable, not asserted;
- **every baseline guard** is judged against the fresh-name test — acquitted with its boundary demonstrated, or reported as under-scoped with a concrete escape;
- every candidate cluster is either **traced to a sound existing guard** or **reported** with its invariant, source of truth, members, escape, and confidence — verified line-by-line, never on a delegate's word;
- each verified cluster is **closed by a guard that iterates the single source of truth** (with honest, self-checking exception sets), wired into the gate so the next member of the class cannot ship untested;
- each under-scoped guard is **widened to a set new members and new containers cannot avoid joining**, proven by an adversarial future-sibling fixture, with every live member the widened guard surfaced fixed to green — and no guard anywhere narrowed to make a finding pass.
