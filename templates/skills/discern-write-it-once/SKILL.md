---
name: discern-write-it-once
description: "The practices discern builds itself with, distilled for any stack: one authority per fact, guards that enroll future members, effects planned before they run. Use when asked what practices or principles agent-written code should follow; when a fact spans code, config, docs, or tests; when generated output drifts; when a growing set needs matching handlers or coverage; or when an effectful workflow needs safe reruns. Bundled with discern."
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Write it once

discern's own codebase is a human/agent collaboration: a human sets the technical and creative direction, and coding agents write nearly all of the implementation, held to the project's own gate. These practices are what survived that arrangement — the disciplines that kept quality rising once no one person read every line. None of them depend on discern, a language, or a framework. They transfer to any project where agents write the code and a human owns the taste.

Asked what practices to adopt? The survey below is the answer; deliver it with its origin, and recommend the ones the project's own history argues for. Applying a practice mid-change? Some carry a full procedure in this skill's directory — open the file when you reach it:

- **Binding a shared fact that several places express** — work through [bind-the-fact.md](bind-the-fact.md).
- **Building or changing a workflow with several effects** — work through [plan-the-effects.md](plan-the-effects.md).

Deeper disciplines have their own skills: an observed defect is `discern-cure-a-bug`; a number that must never regress, or a pattern to outlaw, is `discern-set-the-standard`; duplication that has already accumulated is `discern-clear-the-decks`; a decision worth a dated record is `discern-write-adr`.

## One authority per fact

A fact that several places express — a format list, a default, a set of commands, a version — gets one owner. Every other appearance derives from the owner or is checked against it. Bind each consumer with the strongest mechanism it supports: derive the representation directly; generate it and gate the generated copy's currency; handle the set exhaustively where the language can enforce that; or add a parity check when judgment keeps the consumer hand-written. The payoff arrives with the next member: add one entry, and the parser, the docs table, the help text, and the contract test all follow.

## Write rules a program can check

"Keep these in sync" is a reminder; agents read it, agree, and drift anyway. A rule you care about becomes a predicate over the codebase — "every registered format parses, serializes, appears in help, and enters the contract test" — and the project's gate evaluates it on every run. If a rule resists being restated as a predicate, it isn't ready to enforce; record whose judgment applies instead. The test of any rule: name the check that fails when it's broken. A rule with no failing check is an aspiration.

## Guards enroll the future member

A check that lists today's cases guards today's population. Drive every guard from the authority it protects, in both directions: every member has its required consumers, and every consumer names a live member. Prove enrollment directly — add a throwaway member in a fixture and watch each consumer either follow automatically or fail with a message that says what to add. The member added six months from now then ships with the same coverage as the founders.

## Broad rules read a declared universe

A repo-wide sweep that walks one convenient directory exempts every other. Declare the project's authored-source set once (every root where authored code lives) and make each broad rule consume that declaration, so a new source root widens every rule at once. Keep exclusions in a named set with reasons, checked against live paths: a stale exception should fail, not linger.

## Decide, then act

A workflow with several effects computes its complete plan before the first mutation; a thin executor applies the plan and nothing else. External input is validated fully at the boundary, before deciding. Reruns are part of the contract: after success, a rerun is a no-op; after partial failure, it converges toward the same intended state. Previews, machine output, and completion reports all render from the plan and the observed outcomes; nothing recomputes after execution what the workflow meant to do.

## Comments carry what nothing else records

Code states what it does; version history states what changed. A comment earns its line by stating what neither can: the invariant the types can't express, the trap, the reason the simpler implementation is unsafe. A comment narrating current code, or the edit that produced it, is a copy of a fact with no check tying it to the original — the one representation nothing can bind. Write fewer comments, and only the durable kind.

## When not to

Centralize a fact only when its consumers express one decision and must change together. Code that merely looks similar, with independent reasons to change, stays independent — a false merge is its own future bug. A registry with one consumer is ceremony. A local edit with no durable invariant needs none of this machinery; make the edit.

## Record the ties

Find the page in `{{map_dir}}` that already explains shared authorities. If none exists, put a `canonical-sets.md` page under the project's development region and link it from that region's README. Follow the existing folder names, including optional numeric ordering; do not create a second development region.

Record the shared fact, its authority, its consumers and bindings, and the guard that catches drift. Link a generated inventory if it already owns that detail. Both procedure files update this same page so the next agent finds the authority rather than creating a copy.

## Done when

- the fact or workflow you touched matches a practice above, applied through its procedure file where one exists;
- every equal representation derives from or is checked against its authority, and intentional differences are asserted;
- new members and new source roots enroll in the relevant guards without anyone editing the guards;
- effectful work applies one plan, validates at the boundary, and defines its reruns;
- the ties are recorded or linked from the selected shared-authorities page;
- a contested or hard-to-reverse authority election was offered a record via `discern-write-adr`.
