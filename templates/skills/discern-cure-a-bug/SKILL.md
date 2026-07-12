---
name: discern-cure-a-bug
description: Cure a bug — fix every instance of the underlying defect and leave a permanent guard so it can never return; patching only the instance you were shown is symptomatic relief. Use when fixing any bug, or when asked to fix something "properly", "at the root cause", "everywhere", or "for good" — any time a fix should eliminate a class of defect, not a single occurrence. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Cure the bug — don't treat the symptom

A bug is rarely alone. Define its *class* by the **generative mechanism that permits the defect**, not by the name, container, feature, or location where it was first observed. Patching only what you were shown is symptomatic relief: the siblings resurface later, and "fixed at the root cause" becomes a claim nobody can check. A **cure** is different, and this skill makes it an executable one: characterize the class, ship a detector that fails on every current member and a plausible future sibling, fix to green, and leave the detector in the gate so the defect can never silently return.

A cure starts from a **proven cause**. If all you have is a symptom — the failure is reproducible but the mechanism behind it is still a guess — run the `discern-diagnose-a-bug` skill first; a cure prescribed before the diagnosis just treats the guess.

---

## 1. Name the class as a checkable predicate

Before touching code, state the defect as a precise predicate over the codebase — not "this function mishandles an empty input" but "every call site that does X to Y without first doing Z." A vague class can't be enumerated, and what you can't enumerate you can't finish.

### Pass the fresh-name test

Before accepting the predicate, ask:

> If someone introduced the same mechanism tomorrow under unrelated names, in a new parallel container or component, would the predicate and detector catch it without being updated?

If not, the predicate describes a population of known instances, not the defect class. Widen it before proceeding. Treat incident-specific names — identifiers, types, modules, directories, services, tables, registries, commands — as warning signs in the predicate. They are valid only when the architecture makes that named boundary the sole place the mechanism can exist.

State a **scope contract** before writing the detector:

- the generative mechanism that makes the defect possible;
- the project, dependency, runtime, or architectural universe to search;
- one independently named future sibling that must be caught;
- every deliberate exclusion, with the reason it cannot reproduce the same mechanism.

Separate **essential** sameness from **incidental** resemblance:

- *Essential* — instances of one decision that must stay in sync. That is the real class; fix it as one thing.
- *Incidental* — code that merely looks similar but has independent fate. That is **not** the same class. Don't force it into a shared abstraction to inflate the count — a false merge is its own future bug.

---

## 2. Write the detector first — before fixing anything

Author an executable check that fails on every current member of the class, and write it *before* you fix a single instance. The check can be:

- a **parameterized / table-driven test** that runs one assertion over a set of cases;
- a **structural-search or lint rule** (e.g. `semgrep`, `ast-grep`, a custom linter) that matches the offending shape;
- an **architectural / fitness test** that iterates a canonical set and asserts the property on each member.

Run it. The number of failures is the detector's **current population**, not proof of the class size. Recall is trustworthy only after the detector passes the fresh-name test and its search universe has been justified. If the detector fails on only the one instance you already knew about, treat that as a reason to challenge the predicate and search boundary — not as evidence by itself that the class is a singleton.

---

## 3. Choose the enrollment source only after proving the boundary

Drive the detector from the broadest source that necessarily contains every present and future member of the predicate. A registry, schema, manifest, type, module, inventory, or catalog is canonical only when a new manifestation of the defect **cannot exist without joining it**. If the same mechanism can return by creating a parallel container, component, source, or integration outside that set, the set is only one known population and is too narrow.

Choose the enrollment source according to the class: a registry-defined invariant can iterate the registry; a usage invariant must inspect every use; a structural invariant must scan the whole relevant source universe; an architectural invariant must inspect every component crossing that boundary; a cross-system invariant must enumerate every participating source of truth. A hand-maintained list relocates the recall failure instead of curing it.

Require both forms of automatic enrollment:

- **new members** inside an existing container enter the detector automatically;
- **new containers** capable of generating those members also enter automatically.

A detector that guarantees only the first property is a container-level guard, not a class-level cure.

---

## 4. Enumerate with structure, not just text

Find instances by their shape, not their spelling. A textual `grep` matches tokens, so it silently misses members that share no literal substring — a renamed variable, an alias, a wrapper. Use structural / AST-aware search to locate every instance regardless of identifiers, and treat a text search as a starting hint, never the enumeration itself.

Validate the detector with at least one **adversarial future-sibling fixture**: reproduce the unsafe mechanism using unrelated names and, where practical, a different enclosing context. The detector must reject it without adding those names to a case table, allowlist, or special rule. Use a synthetic fixture, mutation test, temporary controlled violation, or equivalent mechanism appropriate to the project; keep the proof repeatable in the detector's own tests where practical.

A table driven from one affected container proves completeness only within that container. It cannot establish a codebase-wide cure when the same mechanism can be recreated by declaring another container.

Structural search still has a blind spot: it finds members that share a *shape*, but a class can have siblings that share neither a name nor a shape — a value and the separate validator that must move with it, a constant and its mirror in another language, a registry and the switch over it. No textual or structural query reaches those, because the link is *behavioural, not syntactic*.

The project's own history closes that gap. Ask for the files that have historically changed *together* with the affected one — the `discern_coupling` MCP tool, or `discern coupling <file>` on the CLI. A habitual co-change partner that shares no token and no shape with the buggy file is exactly the sibling grep and AST search both miss. Treat the partners as **candidates to check**, not confirmed members: the signal is advisory and drawn from history, so weigh each against the class predicate from step 1 and keep only the ones that are genuinely the same defect.

---

## 5. Fix to green

Fix every instance until the detector passes. The green detector is the definition of done for the fix — not "I changed the file I was shown." If fixing surfaces sub-cases the predicate didn't cover, return to step 1 and tighten it: the predicate and the detector evolve together.

---

## 6. Leave the detector in the gate, and report the residual

Wire the detector into the project's gate over the full scope contract, so the class can't silently recur — including in code written later by someone who never saw the original bug. Confirm that newly added sources, components, and containers enter its search universe automatically. A fix without a guard is relief, not a cure; a guard scoped only to today's population has the same half-life.

Then make the completeness claim falsifiable. In your summary, state:

- the **class predicate** — what defect, precisely;
- **how you enumerated** it — what query or check, over what scope contract;
- the **current population** found by the detector, kept distinct from the class itself;
- the **future-sibling proof** — the unrelated synthetic or controlled instance the detector rejects;
- what lies **outside** that scope — what the detector does *not* cover.

"Fixed every case the detector iterates over *the canonical set*; cases reached only through *X* are out of scope" is a claim a reviewer can check. "Fixed at the root cause" is not.

---

## Done when

- the defect is stated as a **generative, checkable predicate**, with essential members separated from incidental look-alikes;
- the scope contract names the search universe, a fresh-name sibling, and every deliberate exclusion;
- an **executable detector** failed on every current member and on an adversarial future sibling, then passed after the cure;
- new members and new containers capable of reproducing the mechanism both auto-enroll;
- that detector is **wired into the gate** over the full scope contract;
- the summary reports the **predicate, current population, enumeration method, future-sibling proof, and residual scope** — a falsifiable completeness claim, not "fixed at the root cause."
