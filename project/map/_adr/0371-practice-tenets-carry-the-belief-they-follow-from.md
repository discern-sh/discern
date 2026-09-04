# ADR 0371: Practice tenets carry the belief they follow from

**Status**: accepted. Extends the practice canon of [ADR 0284](0284-the-practice-canon-enumerates-the-tenets.md); applies the claim altitudes of [ADR 0244](0244-brand-addresses-the-owner.md) the way [ADR 0370](0370-the-consequence-canon-records-second-order-effects.md) applied them to consequences.

## Context

ADR 0284 made the practice a registry: twelve tenets, each an obligation stated without naming a feature, tied to the features that implement it and the value it yields. The public page renders each tenet as a title, the obligation in a blockquote, and a short mechanism story. By word count the mechanism story is most of the page, and the feature canon already owns that account. The page reads as a list of mechanisms because that is mostly what it prints.

A practice has a layer the registry never recorded. An obligation says what must hold; the belief says why, and the belief is what transfers to the case no rule names. "Cure the class" as a rule tells an agent what to do with a defect a guard already covers. The belief under it, that a bug is one member of a pattern and fixing the member leaves the pattern alive, tells the agent what to do with the defect in a place no guard reaches. A map page exists to reduce the reading needed to make a correct decision, and for a tenet the belief is that compression.

The registry also records two facts the public page hid. Each tenet belongs to a rendering lens (`loop`, `craft`, `conduct`), and the flat page put "Plan, then apply", which obliges the tool, beside "You decide what lands", which obliges the change, with nothing to say they are different kinds. Each tenet records how it is upheld (enforced, automated, taught), which is the most honest metadata in the registry and the first thing a skeptical reader asks; the page omitted it.

The consequence canon (ADR 0370) already solved the same problem one registry over: it splits each entry into a line at headline altitude and a consequence at body altitude, so a page lifts one and supports it with the other. The practice registry predates that split.

Two titles failed the copy tests the messaging canon applies to every public line. "Only better" is a slogan any product could sign, and it reads as one aloud. "Plan, then apply" is the verb pair of a well-known infrastructure tool, so its logo fits under the title unchanged.

## Decision

**Every tenet carries a `why`: the belief the obligation follows from, in one or two plain sentences that name no carrier and no identifier. The public page renders the belief first, the obligation second, and how the tenet is upheld third, grouped under its lens; the mechanism story stays on the internal canon page.**

- `why` sits at body altitude. It must survive a hostile literal reading, so it states a reason rather than an aspiration, and it names none of the verbs, configuration tables, or skills that uphold any tenet. The enrolment guard (`tests/practice_canon_enrolment_test.ts`) holds every tenet's belief non-blank, free of code spans, at most two sentences, distinct from the obligation, and free of every carrier member the canon cites, so a belief that leans on product vocabulary fails the Gate.
- The lenses are data. `PRACTICE_ARCS` records each lens with the heading and the sentence a grouped page introduces it with, in canonical order, and the guard holds the canon's numbering to that order: loop tenets first, then craft, then conduct, with no lens empty. The flat numbering of ADR 0284 stands; a grouped rendering reads the number off the flat canon.
- The public page (`00-orientation/the-practice.md`) renders the frame, the upheld tiers in one sentence, then each lens as a heading with its tenets: title, belief, obligation, and the upheld line. It drops the mechanism story, which the internal canon page keeps beside the citations. Both pages derive the tiers sentence and the lens sentence from the registry.
- Two titles change. "Only better" becomes "Keep every gain"; "Plan, then apply" becomes "No unplanned effects", pairing it with "No dead ends" in the same grammar and echoing the boundary canon's own name for the structural absence. Tenet ids are stable identifiers and do not change with a title, so `only-better` and `plan-then-apply` keep their ids. The brand-altitude line "a project that only gets better" (ADR 0244) is unaffected; it was never the tenet's title, and the consequence canon carries it.
- Canon Editor edits `why` as public prose like the title and obligation.

## Consequences

- Every surface that lifts a practice line now has two altitudes to lift from: the belief for a reason, the obligation for the rule. A manifesto or homepage that argues the practice cites the belief and stops re-deriving it, which is the drift ADR 0284 exists to end.
- The public page loses its mechanism prose and gains three level-two headings, which raises its density under the public-doc leaf-density Standard rather than lowering it.
- A new tenet cannot enter the canon without a belief that passes the guard, so the layer cannot silently regress to obligations alone.
- A tenet whose belief cannot be written without product vocabulary is a tenet to question. That is a feature of the guard, and a reason a future tenet may be refused.
- The renamed titles change the anchors on the generated pages. Nothing in the map linked to them by anchor; a future citation should use the tenet number or id.

## Alternatives considered

- **Write the beliefs into the obligations.** Rejected: the obligation is the guarded, citable rule and must stay literal. A sentence that carries both a reason and a rule serves neither, which is the objection ADR 0370 recorded for consequences.
- **Keep the mechanism story on the public page below the belief.** Rejected: the page would grow rather than sharpen, and the feature canon already owns the account. The concepts page tours the mechanisms; the practice page states what they add up to.
- **Render the lenses as a two-part canon.** Rejected by ADR 0284 and still rejected: the flat numbering is the citable structure, and the lens field exists so renderers can group without spending it.
- **Reopen membership.** Considered whether the conduct tenets belong on an agent-ergonomics page instead. Rejected for now: ADR 0284's argument that they oblige the tool rather than the change is coherent, and the lens headings make the distinction visible without moving them.
- **Keep the failing titles for citation stability.** Rejected: nothing cites either title by anchor, the ids are unchanged, and a title a rival could sign says nothing about discern.
