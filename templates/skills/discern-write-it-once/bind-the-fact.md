# Bind the fact — one authority, every consumer tied to it

Use this procedure when one decision is expressed in several places — code, config, generated files, docs, tests, fixtures, user-facing strings — or is about to be. It elects a single owner for the fact and ties every other representation to it with a mechanism that fails on drift. The outcome to insist on: changing the fact means editing one place, and a missed consumer is a failing check rather than a production surprise.

## 1. Name the fact and find every copy

State the fact in one sentence: "the set of supported export formats", "the retry budget", "the list of lifecycle stages". Then enumerate where it currently lives — search code, config, docs, tests, fixtures, generated artifacts, and user-facing strings. Expect more copies than you predicted.

Separate true copies from look-alikes. Two representations belong to the same fact only when they express one decision and must change together. Similar-looking code with independent reasons to change is no copy; leave it alone, and note the resemblance in step 5 if a future reader could plausibly merge the two.

Write the invariant as a predicate a program can evaluate: "every registered format is accepted by the parser, has a serializer, appears in help output, and enters the contract test." "Keep the formats in sync" names a hope; the predicate names a check.

## 2. Elect the authority

Place the fact at the layer that owns its meaning, in a form a program can iterate: a registry, an enum, a schema, a config table, or a directory whose entries define the set. The authority answers membership questions; everything else consults it.

When a consumer intentionally covers a subset or superset, assert the relationship instead of duplicating the list — "the CLI exposes every format except the deprecated two" is an assertion with a named exception set. Give each exception a reason, and make the check fail when an exception no longer names a live member: retired exceptions leave, or they rot.

## 3. Bind each consumer with the strongest mechanism

Work down this ladder and stop at the first rung the consumer supports:

1. **Derive.** The consumer computes its representation from the authority at build or run time. Nothing exists to drift.
2. **Generate, and gate currency.** When the representation must exist as its own artifact (a docs table, a wire schema, boilerplate), generate it from the authority, commit the output, and add a check that regeneration produces no difference. Mark generated output as generated where the format permits a marker; where it doesn't, name the owning source in the generator or the docs. Either way the editing rule is the same: edit the authority, regenerate.
3. **Handle exhaustively.** Where the language can enforce exhaustiveness (a closed enum with a checked switch, a sealed hierarchy), let the compiler make a missing case a build failure. Don't add a catch-all default that absorbs future members without a decision — a closed vocabulary stays closed.
4. **Parity-check.** When judgment keeps the consumer hand-written (curated docs, an error catalog, translations), add a check that compares it to the authority in both directions: every member has its entry, and every entry names a live member. Never restate the member list inside the guard; iterate the authority.

## 4. Prove future members enroll

The binding is done when the next member is safe, and there's a direct way to know: add a throwaway member — in a fixture, a temp copy, or a scratch mutation — and watch what happens. Every derived and generated consumer should follow without edits; every exhaustive switch should fail to compile; every parity check should fail naming the missing entry. A consumer that stays green and stale is unbound; return to step 3.

Where the fact backs a broad rule ("no file under our source roots may X"), check the rule's universe too: it must read the project's declared authored-source set, so a new source root enrolls automatically. A sweep hand-rooted at one convenient directory covers a population, and the next root added to the project escapes it.

## 5. Record the ties

Add or update the fact's row in `{{map_dir}}80-development/canonical-sets.md`; create the page on first use with this header:

| Fact | Authority | Consumers & bindings | Fails on drift |
| ---- | --------- | -------------------- | -------------- |

One row per fact: what it is, the authority's path (file, symbol, or table), each consumer with its rung on the ladder, and the check that fails when they disagree. Note intentionally independent look-alikes beside the row when the resemblance could mislead. Offer `discern-write-adr` when the authority election was contested or hard to reverse.

## Done when

- one authority owns the fact, in an iterable form;
- every true copy derives, is generated with a currency check, is exhaustively handled, or is parity-checked in both directions;
- intentional subsets and supersets are asserted, with live-membered exception sets;
- a throwaway member proved enrollment: every consumer followed or failed usefully;
- the canonical-sets page carries the row;
- look-alikes with independent fates were left independent, and noted where confusable.
