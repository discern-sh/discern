# Design principles

The handful of rules the {{project_name}} codebase keeps coming back to. Each one shows up in dozens of decisions; together they explain why the system is shaped the way it is.

These are **hard requirements**. They apply to **every** change, in every area of the codebase — not just the part you happen to be touching. Read them once in full; the one-line forms exist for quick recall once you have.

If a change you are about to make violates one of these, treat that as a signal to **question the change, not the principle**. There is one escape hatch, and it is deliberate: to override a principle on purpose, **write an Architecture Decision Record** (see [`../_adr/`](../_adr/)) that states what you are overriding and why. A principle bent silently is a bug; a principle bent on the record is a decision.

---

<!-- bootstrap fills this -->

<!--
  The `discern bootstrap` command writes 3–7 principles here from `brief.md`.
  Delete this comment and the EXAMPLE block below once the real principles exist.

  Each principle follows the same shape:

    ## N. <Imperative one-liner — the name you'll say out loud>

    <1–3 sentences stating the rule precisely.>

    **Why it matters.** <The failure this rule prevents. What goes wrong without it.>

    **How it shows up.** <Where the rule is visible in the codebase — concrete,
    present-tense, file-pathed where useful. This is what makes the principle
    enforceable rather than aspirational.>

  Good principles are specific to THIS project, falsifiable (you can point at a
  change that would violate one), and few. Aim for the smallest set that
  actually governs decisions — 3–7, not a wish list.
-->

## 1. Keep one home for every fact _(EXAMPLE — replace during `discern bootstrap`)_

> This is a placeholder principle, here only to show the shape. `discern bootstrap` replaces it with principles drawn from this project's brief. It is deliberately generic — do not keep it as-is.

Every fact in the system — a piece of configuration, a documented convention, a unit of behaviour — lives in exactly one authoritative place. Where a second copy must exist, it is *generated* from the source, marked as generated, and never hand-edited.

**Why it matters.** Duplicated facts drift, and drift is silent until something breaks: a reader follows a stale doc, two copies of one behaviour diverge with every fix that lands in only one of them. With one source per fact, consistency is a property of the system rather than of human vigilance.

**How it shows up.** _(A real principle names concrete places: which file owns which fact, which artifacts are generated and from what, where the build regenerates rather than trusts a checked-in copy.)_

---

## What these add up to

<!-- bootstrap fills this -->

_(Once the principles exist, summarise how they reinforce each other — the few sentences that explain why this particular set, taken together, produces the system's character. Principles are rarely independent; this is where you show the reader how they interlock.)_

When you propose a change that violates one of these principles, that is a signal to question the change — not the principle. If you have a genuinely good reason to override one, write an ADR (see [`../_adr/`](../_adr/)).
