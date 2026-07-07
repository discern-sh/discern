---
name: discern-shape-the-work
description: Shape a vague ask into a buildable brief before any code is written — find the goal behind the ask, surface the open decisions as questions the user answers now instead of guesses they discover at review, and fix falsifiable acceptance criteria that later drive the tests and the proof of done. Use before starting any non-trivial feature or change, when an ask is ambiguous or admits several readings, when the user asks to spec, scope, plan out, or think through a piece of work, or whenever building would otherwise begin on a silent guess. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Shape the work — before a line of it is built

The most expensive defect in agent-built software is the faithfully-built wrong thing. It compiles, the tests pass, the gate is green — and it isn't what was wanted, because the ask left a dozen decisions open and every one was resolved silently. No gate catches it; mechanically, nothing is wrong.

A vague ask never stays vague. It gets resolved either by **questions asked now** or by **guesses discovered at review** — those are the only two options, and shaping is choosing the first. This skill turns an ask into a one-page brief: the goal behind it, every open decision either answered by the user or defaulted *visibly*, and acceptance criteria falsifiable enough to become the tests — and, when the work claims done, the proof (`discern-prove-it-works`).

---

## 1. Decide whether shaping is owed at all

Shaping has a cost, and the cost must fit the work. A mechanical ask with one reading — rename this, bump that, fix the reported typo — needs none; just do it. Shaping is owed when any of these hold: the ask admits **more than one plausible reading**; it hides **decisions with consequences** (anything touching data, money, permissions, or deletion); it changes **behaviour someone will see**; it is **hard to reverse** once built. And shaping is minutes, not a phase: the output is a page, not a specification document. If the brief is growing past a page you are designing, not shaping — stop and re-check the goal instead.

## 2. Find the goal behind the ask

An ask is often a proposed solution with its goal left implicit — and the proposal is not always the best servant of its own goal. Restate the outcome the ask exists to produce, in the user's terms, and confirm it: "you want X so that Y — is Y the point?" Two things fall out. Sometimes a smaller or different change serves Y better — offer it; the user can decline. And every judgment call later in the work now settles against Y, not against the literal phrasing of the ask.

## 3. Surface the open decisions — and split them honestly

Enumerate the decisions the ask leaves open. Walk the standard prompts — they apply in every domain: what happens with **nothing** (empty, missing, zero)? with **too much** (oversized, duplicated)? when the action is **repeated**? when **two actors act at once**? when a **dependency fails** partway through? **who is allowed** to do this, and what does everyone else see?

Then split the pile in two, honestly:

- **User-owned** — decisions whose consequences the user must choose between: anything visible, irreversible, or with more than one defensible answer. Ask these **now**. Every one you don't ask becomes your guess, and a guess surfaces at the worst possible time, wearing the costume of a finished feature.
- **Agent-owned** — decisions with a clearly sensible default. Don't interrupt the user; pick the default and **write it into the brief**. The line between a professional default and a silent guess is exactly that visibility: a recorded default can be vetoed in ten seconds at review; a silent one has to be *found* first.

## 4. Ask so a non-expert can answer

Put user-owned questions in terms of consequences, never mechanism. "If someone submits the same thing twice, should the second attempt be rejected, or replace the first?" is answerable by anyone who understands their own product; "should submission be idempotent?" is answerable only by an engineer — and an unanswerable question just relocates the guess back to you. Attach a recommendation to every question ("I'd reject it, because…") so the user can confirm in one word or push back with a reason.

Asked this way, shaping quietly compounds: each consequence-level question hands the user a category of concern — empty states, repeated actions, partial failure — that they will bring, unprompted, to their next ask. The questions grow the user's discernment as a side effect of using it.

## 5. Fix the acceptance criteria

Convert the shaped decisions into acceptance criteria: falsifiable outcomes stated from the user's side — "doing X produces Y", checkable by observation, never "works correctly". Pair the measurable with the semantic — the checklist that can be verified mechanically, plus the outcome-in-use it exists to serve — and keep the list short: five sharp criteria outrank twenty vague ones. These criteria are load-bearing downstream: they become the tests, and they are the exact list `discern-prove-it-works` walks when the work claims done. Write them as if you will be held to them, because you will be.

## 6. Name what is out of scope

State what this work will *not* do — the adjacent features not included, the behaviour deliberately unchanged, the readings of the ask that were considered and set aside. Non-goals prevent scope creep as reliably as goals direct the work, and they pre-answer review's most common question: "was leaving X out an oversight, or a decision?" It should always be a decision, and the brief should show it.

## 7. Keep the brief where the work can use it

The brief is the spec for the session that builds it. Hold the work to it: the criteria drive the tests, judgment calls resolve against the goal, and "done" means the criteria pass their proof. If the work will be handed to a fresh agent, the brief slots straight into the handoff (`discern-delegate-work`). If it is durable — one stage of something larger, or work for later — offer to save it in the project's planning spot.

---

## Done when

- shaping was **right-sized** — skipped for one-reading mechanical work, minutes-not-a-phase everywhere else, output no longer than a page;
- the **goal behind the ask** is restated and confirmed, and any smaller change that serves it better was offered;
- every open decision is either **answered by the user** (asked as consequences, with a recommendation attached) or **defaulted visibly in the brief** — no silent guesses anywhere;
- the **acceptance criteria are falsifiable observations** from the user's side, short and sharp, ready to become the tests and the final proof;
- **out-of-scope is named**, so review can tell decision from oversight;
- the brief is **where the work will use it** — driving this session, feeding a handoff, or saved for a later stage.
