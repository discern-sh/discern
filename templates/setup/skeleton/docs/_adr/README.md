# Architecture Decision Records

This directory holds the project's **Architecture Decision Records (ADRs)** — short documents that capture a significant decision, the context that forced it, and the reasoning behind it. An ADR answers the question a future reader will ask: _"why on earth was it done this way?"_

**This file is the canonical ADR format for the project.** Other guidance — the [design principles](../00-orientation/design-principles.md) (whose override mechanism is "write an ADR"), the `discern-write-adr` skill — points here rather than restating the format. There is exactly one home for "how we write ADRs", and it is this page.

To start a new ADR, copy [`0000-template.md`](0000-template.md).

---

## Location and naming

- ADRs live in **`_adr/` under the configured documentation root** (this directory). That is the single, settled location within the tree.
- Files are named `NNNN-short-slug.md`: a four-digit, zero-padded number, then a dash, then a short kebab-case slug, e.g. `0007-event-sourced-write-model.md`.

## Numbering

Scan this directory for the highest existing number and add one. Numbers are **continuous and never reused** — even a superseded ADR keeps its number and stays in the directory (it is marked superseded, not deleted). The number is a stable identifier other docs and commit messages can cite.

`0000-template.md` is the copy-paste template and is not itself a decision; the first real ADR is `0001`.

## Status

Record a status near the top of each ADR. The usual lifecycle:

- **proposed** — drafted, not yet agreed.
- **accepted** — the decision in force. Most ADRs you read are here.
- **deprecated** — no longer the rule, with nothing replacing it.
- **superseded by ADR-NNNN** — replaced by a later decision; link it. The old ADR stays in place as a record of what was once true and why it changed.

A decision that is revisited does not get its ADR edited into a new shape — write a new ADR that supersedes the old one, so the history of the decision is legible.

---

## The sections

An ADR can be short — a paragraph that names the decision and why is worth more than an empty form. But when a section earns its place, use this shape:

- **Title** — `# ADR NNNN: <short statement of the decision>`. State the decision in the title, not the problem.
- **Status** — as above.
- **Context** — the forces at play: the problem, the constraints, what was true before, what pushed a decision now. Enough that the reader feels the pressure you were under. This is usually the longest section.
- **Decision** — what you decided, stated plainly and in the present tense ("X is Y"). Include the explicit *no*s — the things you decided **not** to do are often the most valuable part.
- **Consequences** — what follows, good and bad: what becomes easy, what becomes hard, what you are now committed to, what you have foreclosed. Be honest about the costs; an ADR that lists only upsides is not trustworthy.
- **Alternatives considered** _(optional)_ — the options you rejected and why, but **only when the rejection is non-obvious**. If you weighed two reasonable approaches and picked one for subtle reasons, record it — otherwise someone will re-propose the loser in six months.

Include only the sections that add value. A trivial ADR may be Title + Status + a few sentences; a load-bearing one earns all of them.

---

## When to write one

Write an ADR when **all three** of these are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will look at the code and wonder why it was done this way.
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If a decision is easy to reverse, skip it — you will just reverse it. If it is not surprising, nobody will wonder why. If there was no real alternative, there is nothing to record beyond "we did the obvious thing".

There is one decision you should _always_ consider an ADR for: **overriding a [design principle](../00-orientation/design-principles.md)**. The principles are hard requirements; bending one on purpose is exactly the "hard to reverse, surprising, deliberate trade-off" case this directory exists for.

### What qualifies

- **Architectural shape.** "The write model is event-sourced; the read model is projected." "This is a monorepo."
- **Integration patterns between parts.** "These two components communicate via events, not synchronous calls."
- **Technology choices that carry lock-in.** The datastore, the message bus, the auth provider, the deployment target — the ones that would take a quarter to swap, not every library.
- **Boundary and scope decisions.** "This data is owned here; other parts reference it by ID only." The explicit *no*s are as valuable as the *yes*es.
- **Deliberate deviations from the obvious path.** Anything where a reasonable reader would assume the opposite. These stop the next person from "fixing" something that was intentional.
- **Constraints not visible in the code.** A compliance rule, a performance contract, a partner-API limit that shaped the design.
- **A principle override.** As above — the deliberate exception belongs on the record.

---

## After writing one

- Link the ADR from whatever it touches: the [design principle](../00-orientation/design-principles.md) it overrides or grounds, and the subsystem doc whose behaviour it explains. An ADR nobody can find from the code it governs is half-wasted.
- If the decision changes something the docs describe, update those docs too — the docs say what _is_, the ADR says _why_.
