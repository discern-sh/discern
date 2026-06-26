# ADR 0057: Ratchet a rate, not a raw count (`per`)

**Status**: accepted. **Extends [ADR 0003](0003-named-metric-ratchets.md)**
(named metric ratchets) — the ratchet mechanism is unchanged; this adds an
optional denominator so the _measured value_ can be a rate.

## Context

ADR 0003 made any only-ever-improve number ratchetable: a `run` emits
`DISCERN_METRIC <name> <number>`, and the engine holds it against a `limit`
compared to `main`. The number it ratchets is a raw scalar.

That is correct for a **ratio** like line coverage (`covered / total`) and for a
true **budget** like shipped bytes — neither rises just because the project
grew. It is a trap for a raw **count over a corpus the project grows**: lint
alerts, TODOs, type errors, documentation nits. Such a count increases as you
add code or docs _even when nothing got worse_, so the ceiling is breached by
growth, not by regression. The only way to make the gate pass is to raise the
ceiling — i.e. to loosen the ratchet, the one thing it exists to forbid.

We hit this dogfooding the harness's own prose ratchet. The Vale alert count sat
at 1703 with the ceiling locked one above it (1704); the harness simultaneously
_tells_ agents to write ADRs and keep docs current, which drops new prose
straight into the scanned corpus. Every doc-writing branch breached the ceiling,
and agents "resolved" it by bumping the limit and rationalising the resulting
loosened-vs-main failure as a transient that resolves on graduate. The metric
was **extensive** (scales with size); a ratchet is only honest on an
**intensive** one (a rate or proportion, size divided out). The fix is to let a
ratchet _be_ a rate. A contributing cause was the guidance itself: "tighten the
limit to lock the gain in" is sound for a ratio but, applied to a count,
manufactures exactly the zero-headroom ceiling that forces the next branch to
loosen.

## Decision

Add two optional keys to a `[ratchets.<name>]` table. They change only the
**measured value**; the never-loosen-vs-`main` half (declared `limit` compared
to `main`'s) is untouched.

| key     | meaning                                                                |
| ------- | ---------------------------------------------------------------------- |
| `per`   | a denominator — divide the metric by it and ratchet the resulting rate |
| `scale` | multiply the rate so the limit reads in human units (default `1`)      |

The ratcheted value becomes `metric / per * scale`. `per` is one of:

- **A second emitted metric** (a string naming it): the `run` emits both the
  numerator and the denominator as `DISCERN_METRIC` lines. The engine only does
  arithmetic — fully faithful to ADR 0003's "the run owns measurement."
- **A built-in extent** (`{ files | lines | words | bytes = <git pathspec> }`):
  discern measures the denominator itself over the **tracked** tree
  (`git ls-files`, so `.gitignore` is honored and counts are deterministic). The
  `run` emits only the numerator. Counting files/lines/words/bytes is a
  universal, stack-neutral text operation, so owning it does not compromise
  neutrality, and it is the difference between "add one line to ratchet a rate"
  and "go rewrite your measurement script."

Omitting `per` is exactly ADR 0003's raw-count behavior, so the change is
backward-compatible.

### Teaching and detection

A mechanism users don't reach for changes nothing, so the decision also fixes
how ratcheting is _taught_:

- The shipped guidance leads with a test, not a term: _"does this number grow as
  the project grows, even when nothing got worse? then ratchet a rate."_ It
  drops the "lock the gain in" advice that built zero-margin ceilings, and
  states that a limit loosened versus `main` is the regression the ratchet
  exists to catch, never a baseline to reset.
- When a raw-count ceiling is breached, `discern ratchets` points at the fix in
  the failure message (add `per`). `discern audit` carries a subjective rule
  that surfaces un-normalized ceiling counts as candidates — never a hard fail,
  since a genuine budget (shipped bytes) is a valid raw count.

## Consequences

- A growing tree never breaches a normalized ratchet on its own; only a real
  quality regression (a worse-than-average rate) does. The recurring
  loosened-vs-`main` churn on the prose ratchet disappears.
- The harness's own prose ratchet converts to `per = { words = "docs/**" }`,
  `scale = 1000`, tracking ~18.7 alerts per 1,000 words instead of a raw 1703.
- **Converting an existing ratchet from count to rate changes the limit's
  units.** On the one conversion commit, the new rate-limit is compared to
  `main`'s old count-limit; if it happens to read as loosened, that is a
  legitimate one-time change that resolves on graduate (it did not for the prose
  conversion: 19 < 1704).
- The denominator is measured on the working tree only — no second checkout, no
  measuring `main`. The cheap declared-limit-vs-`main` comparison from ADR 0003
  still does the never-loosen work.

## Alternatives considered

- **Ratchet an arbitrary expression over emitted metrics**
  (`value = "a / b * 1000"`). Rejected: needs an expression parser and its
  safety surface. A quotient plus an optional scale covers the real cases; the
  second-metric form is the escape hatch for anything more exotic (compute it in
  the `run`).
- **Keep the engine arithmetic-only — `per` may name only an emitted metric.**
  Rejected as the default: it costs every user a second emitted number for the
  common case. Kept as one of the two `per` forms for full control.
- **Normalize automatically / forbid raw counts.** Rejected: a genuine budget
  (shipped bytes, binary size) is legitimately a raw count. The discrimination
  is the user's — "do you bound it, or grow it?" — so discern makes the rate
  easy and obvious, not mandatory.
- **Extents beyond text measures** (e.g. "lines of code" by language, AST
  nodes). Rejected as scope creep and stack-entangling.
  `files`/`lines`/`words`/`bytes` are universal; anything language-aware belongs
  in the `run` as a second metric.
