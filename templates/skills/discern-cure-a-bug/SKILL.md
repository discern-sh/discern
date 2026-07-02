---
name: discern-cure-a-bug
description: Cure a bug — fix every instance of the underlying defect and leave a permanent guard so it can never return; patching only the instance you were shown is symptomatic relief. Use when fixing any bug, or when asked to fix something "properly", "at the root cause", "everywhere", or "for good" — any time a fix should eliminate a class of defect, not a single occurrence. Bundled with discern.
---

# Cure the bug — don't treat the symptom

A bug is rarely alone. The instance you were handed is one member of a *class* — every place the same mistake was made, or could be made. Patching only what you were shown is symptomatic relief: the siblings resurface later, and "fixed at the root cause" becomes a claim nobody can check. A **cure** is different, and this skill makes it an executable one: characterize the class, ship a detector that fails on **every** member, fix to green, and leave the detector in the gate so the defect can never silently return.

A cure starts from a **proven cause**. If all you have is a symptom — the failure is reproducible but the mechanism behind it is still a guess — run the `discern-diagnose-a-bug` skill first; a cure prescribed before the diagnosis just treats the guess.

---

## 1. Name the class as a checkable predicate

Before touching code, state the defect as a precise predicate over the codebase — not "this function mishandles an empty input" but "every call site that does X to Y without first doing Z." A vague class can't be enumerated, and what you can't enumerate you can't finish.

Separate **essential** sameness from **incidental** resemblance:

- *Essential* — instances of one decision that must stay in sync. That is the real class; fix it as one thing.
- *Incidental* — code that merely looks similar but has independent fate. That is **not** the same class. Don't force it into a shared abstraction to inflate the count — a false merge is its own future bug.

---

## 2. Write the detector first — before fixing anything

Author an executable check that fails on every current member of the class, and write it *before* you fix a single instance. The check can be:

- a **parameterized / table-driven test** that runs one assertion over a set of cases;
- a **structural-search or lint rule** (e.g. `semgrep`, `ast-grep`, a custom linter) that matches the offending shape;
- an **architectural / fitness test** that iterates a canonical set and asserts the property on each member.

Run it. The number of failures **is** the size of the class — recall is now measured, not guessed. If the detector fails on only the one instance you already knew about, either the class really is a singleton (fine — say so) or the predicate is too narrow (likely — widen it).

---

## 3. Drive the detector off the single source of truth

Point the check at the canonical registry, enum, or type that *defines* the set — never a hand-copied list. A hand-maintained list just relocates the recall failure up one level: "did I list every member?" is the same question you were trying to answer. Iterate the source of truth so a **new** member auto-enrolls in the check the moment it's added, with nobody having to remember to extend a list.

---

## 4. Enumerate with structure, not just text

Find instances by their shape, not their spelling. A textual `grep` matches tokens, so it silently misses members that share no literal substring — a renamed variable, an alias, a wrapper. Use structural / AST-aware search to locate every instance regardless of identifiers, and treat a text search as a starting hint, never the enumeration itself.

Structural search still has a blind spot: it finds members that share a *shape*, but a class can have siblings that share neither a name nor a shape — a value and the separate validator that must move with it, a constant and its mirror in another language, a registry and the switch over it. No textual or structural query reaches those, because the link is *behavioural, not syntactic*.

The project's own history closes that gap. Ask for the files that have historically changed *together* with the affected one — the `discern_coupling` MCP tool, or `discern coupling <file>` on the CLI. A habitual co-change partner that shares no token and no shape with the buggy file is exactly the sibling grep and AST search both miss. Treat the partners as **candidates to check**, not confirmed members: the signal is advisory and drawn from history, so weigh each against the class predicate from step 1 and keep only the ones that are genuinely the same defect.

---

## 5. Fix to green

Fix every instance until the detector passes. The green detector is the definition of done for the fix — not "I changed the file I was shown." If fixing surfaces sub-cases the predicate didn't cover, return to step 1 and tighten it: the predicate and the detector evolve together.

---

## 6. Leave the detector in the gate, and report the residual

Wire the detector into the project's gate as a permanent guard, so the class can't silently recur — including in code written later by someone who never saw the original bug. A fix without a guard is relief, not a cure; it has a half-life.

Then make the completeness claim falsifiable. In your summary, state:

- the **class predicate** — what defect, precisely;
- **how you enumerated** it — what query or check, over what scope;
- what lies **outside** that scope — what the detector does *not* cover.

"Fixed every case the detector iterates over *the canonical set*; cases reached only through *X* are out of scope" is a claim a reviewer can check. "Fixed at the root cause" is not.

---

## Done when

- the defect is stated as a **checkable predicate**, with essential members separated from incidental look-alikes;
- an **executable detector** failed on the whole class and now passes, driven off the single source of truth so a new member auto-enrolls;
- that detector is **wired into the gate** as a permanent guard;
- the summary reports the **predicate, the enumeration method, and the residual scope** — a falsifiable completeness claim, not "fixed at the root cause."
