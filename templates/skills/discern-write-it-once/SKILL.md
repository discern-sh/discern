---
name: discern-write-it-once
description: "Write each shared fact once, then derive every representation or bind it with a check that fails on drift. Use when asked for coding practices, principles, conventions, or house rules; when a fact spans config, commands, APIs, UI, docs, or tests; when a growing set needs matching handlers or coverage; when generated files drift; or when an effectful workflow needs one plan, safe reruns, and boundary-level proof. Bundled with discern."
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Write it once

One recurring discipline underlies discern's registries, generated files, commands, and tests: shared facts get one authority, and every consumer derives from it or carries a drift check. The procedure applies in any language or framework.

Use the full procedure when one decision crosses several consumers or effects. Skip it for a local edit with one consumer and no durable invariant. Similar code should share an authority only when both instances express the same decision and must change together. A registry with one consumer adds ceremony without protection.

For an observed defect, use `discern-cure-a-bug`. Use `discern-set-the-standard` for a number or legacy pattern that must never regress, and `discern-clear-the-decks` for duplication that has already accumulated.

## State the contract

Before editing, name:

- **Contract:** what a caller can observe, including failure behavior.
- **Invariant:** the predicate that must hold across every representation and path.
- **Authority:** the source that owns the fact.
- **Effects:** the files, state, processes, or remote resources the change may touch.
- **Proof:** the checks that fail for a broken current case and a future member.

Write a predicate the project can check. “Keep the formats in sync” is a reminder. “Every registered format is accepted, has a serializer, appears in help, and enters the contract test” is an invariant.

## Elect one authority

Place the shared fact at the layer that owns its meaning. Prefer a source a program can iterate: a registry, enum, schema, config table, or directory whose entries define the set.

Tie each consumer to that authority with the strongest available mechanism:

1. Derive an equal representation directly.
2. Generate a mechanical representation in another format.
3. Handle every member exhaustively when the language can enforce it.
4. Add a parity or architectural check when judgment keeps the consumer hand-written.

For an intentional subset or superset, assert the relationship. Keep exceptions in a named set with reasons, and fail when an exception no longer names a live member.

## Generate copies and gate their currency

Generate documentation tables, schemas, wire types, and boilerplate when their content is mechanical. Committed generated output is acceptable when the gate regenerates it and fails on a difference.

Mark generated output where its format permits a marker. When it cannot carry one, identify the owning source in the generator or project documentation. In both cases, edit the authority and regenerate. A generator without a currency check leaves the copy free to drift.

## Guard growing sets and broad rules

For judgment-written consumers, check parity in both directions: every authority member has its required consumer, and every consumer still names a live member. Drive the check from the authority. Never repeat its members inside the guard.

Test future enrollment by adding an unrelated member in a fixture or temporary mutation. Each required consumer should derive automatically or fail with a useful message.

A repo-wide structural rule also needs an authority for “repo-wide.” Declare the project's authored-source universe once and make every broad sweep consume it. A new source root then widens every rule. Narrow a rule only with a recorded reason, and keep exclusions live.

Treat closed vocabularies as closed. Reject catch-all handling that lets a future member inherit generic behavior without a decision.

## Split decisions from effects

Gather state at the boundary, pass ordinary data into a decision, and return a plan:

```text
inputs + observed state -> decide -> plan
plan -> apply -> observed outcomes -> result
```

Compute the complete plan before the first mutation. Let a thin executor apply only operations in that plan. Render previews and machine output from the plan; render completion from the plan plus observed outcomes. Do not recompute after execution what the workflow meant to do.

Use this seam when a workflow has several effects, needs a preview, can stop partway through, or serves several adapters. A small atomic write does not need a plan object.

## Validate boundaries and make reruns converge

Parse external input once. Validate its complete structure, normalize it, apply defaults, and pass a settled model inward. Reject invalid input before effects begin. Name the offending value and location, the violated rule, and one next action.

Preflight predictable failures before the first write. Route each mutation through a narrow boundary, write only when the intended state differs, and prefer atomic replacement or recoverable staging where the platform supports it. When ownership or safety is uncertain, perform fewer effects and run more checks.

Define rerun behavior as part of the contract. A rerun after success or partial failure should move toward the same intended state without duplicate entries, repeated external effects, or lost user-owned data. Record enough observed outcomes to resume or converge.

## Keep comments current

Comment what code and version history do not record: an invariant the type system cannot express, a hidden trap, or the reason a simpler implementation is unsafe. Do not narrate current code or the edit that produced it. Those copies age as soon as the code moves.

## Prove the ties

Use checks that cover the architecture from different seams:

- **Enrollment:** iterate the authority so a future member enters the contract without a copied case list.
- **Public boundary:** exercise the real command, API, library entry point, or generated artifact.
- **Failure:** cover malformed input, refused preconditions, partial progress, and uncertain ownership.
- **Rerun:** prove the second run is a true no-op when current and that representative partial state converges.

Use real schemas, templates, fixtures, and built artifacts where the contract depends on them. Do not add a runtime test for a relationship the compiler already makes exhaustive.

Before finishing, search for every representation of the fact and every write path the workflow can reach. Report the authority, its tied consumers, the effect boundary, the rerun behavior, the future-member proof, and any intentionally independent look-alikes.

## Done when

- the shared fact has one justified authority;
- equal representations derive, while intentional differences and hand-written consumers are checked;
- broad rules consume a declared universe;
- effectful workflows apply one plan and report observed outcomes;
- invalid input and unsafe uncertainty stop before mutation;
- first run, no-op rerun, and partial-state re-entry have defined behavior;
- proof reaches the public boundary and enrolls future members;
- comments carry only facts the code and history cannot.
