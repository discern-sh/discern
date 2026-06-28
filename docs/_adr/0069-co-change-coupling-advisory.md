# ADR 0069: Co-change coupling detection is a non-blocking advisory, recomputed on demand

**Status**: accepted

## Context

A coding agent has near-perfect **local** recall and almost no **global**
recall: it fixes the file in front of it and misses the sibling that, by the
project's own history, almost always changes with it. A human senior carries
that "I bet there's another one" instinct as scar tissue; an agent has none. The
most common shape of this miss is a coupled pair where one half moved and the
other was forgotten — a schema and its validator, a registry and the switch over
it, a verb and its test.

discern already has the _enforcement_ end of this discipline.
[ADR 0051](0051-canonical-set-parity.md) locks the canonical sets that **must**
stay in sync with forcing functions, so a member added to one satellite fails
the gate until every other satellite learns it. But that discipline is applied
**reactively** — a human notices the coupling (often after the second bug) and
writes the guard. There is no _proactive discovery_ layer that says, from data,
"these files tend to move together; you touched one and not the other —
intentional?". The signal to build one already exists in every repo: files that
change in the same commits are coupled by the project's own behaviour.

Three forces bound the design:

- **It must never block.** A co-change graph is a heuristic over history; it
  will have false positives. A false positive that failed the gate would be
  intolerable and would quickly train an agent to ignore the whole surface. The
  cost of a wrong _advisory_ is a glance; the cost of a wrong _gate failure_ is
  a derailed task.
- **It must not cry wolf.** A naïve "files that ever co-occurred" graph is O(n²)
  noise: one "format everything" commit couples 200 files to each other. The
  metric has to actively suppress incidental churn, or the advisory is
  worthless.
- **It must be cheap and add no infrastructure.** discern's whole footprint is
  one `discern.toml` and a binary; a co-change feature must not drag in a data
  store.

## Decision

Add a read-only **`coupling`** verb (a CLI verb, an MCP tool, and a default-off
gate hint) that mines git history for files that change together. It is the
**discovery** layer for ADR 0051's **enforcement** discipline, and the two are
deliberately kept apart.

**It is strictly advisory.** Every result is surfaced through `hints[]` —
discern's one advisory channel, which renders to human, `--json`, and MCP alike.
The advisory:

- is **flat, with no severity tiers**
  ([ADR 0063](0063-doctor-execution-model.md): discern renders the facts and the
  evidence, it does not judge them) — each partner carries its confidence,
  support, and lift as transparency, and the framing states plainly that the
  list is **not exhaustive**;
- is **observation-plus-suggestion, never a verdict** — "you changed X; Y moved
  with it in N% of X's recent history but isn't in your change — intentional?",
  never "you forgot Y" or "you MUST";
- carries **one** pointer back to enforcement: when a pair couples tightly, it
  suggests that _if_ this is an essential invariant, it be locked with a forcing
  function (ADR 0051) — the discovery→enforcement bridge, with the human/agent
  deciding **essential** (lock it) or **incidental** (ignore);
- **never touches `ok`, the exit code, or `failed_stage`.** Behind
  `[coupling].in_gate` (default off) the diff-aware advisory rides at the
  **tail** of `discern finish`, with strand detection, because it reads the diff
  and is therefore dependency-bearing — never a fail-fast precondition. It is
  suppressed entirely until the install is bootstrapped, so the in-session setup
  an agent runs stays uncluttered.

**The metric** treats each non-merge commit as a basket of the files it changed:
neutral paths are dropped (the same `isNeutralPath` the scope classifier uses,
so generated artifacts and docs create no edges); each commit is weighted by
`1 / basket_size` and **skipped** above `max_commit_size`, so a sweeping change
is near-zero evidence per pair; co-occurrence is decayed by recency
(`half_life_days`), anchored to the newest commit in the window; and a
directional edge A→B is kept only when `support ≥ min_support` AND
`confidence ≥ min_confidence` AND **`lift > 1`** — lift being the discriminator
that drops a high-churn file co-occurring with everything.

**It recomputes on demand, bounded by `window` — there is NO cache in v1.** Each
call re-mines the history. The explicit *no*s: no persisted co-change graph, no
blocking, no auto-promotion of a coupling to an enforced rule, no function- or
hunk-level granularity (file-level only).

**It fails _silent_, not open.** When it cannot compute a change set (a git
hiccup, no diff base) it advises nothing — the deliberate opposite of the scope
classifier's fail-_open_ bias
([principle §5](../00-orientation/design-principles.md)). For a classifier,
failing toward "run more gates" is safe; for an advisory, failing toward noise
is worse than silence.

## Consequences

- **The agent gets the senior's "sibling" instinct from data, proactively** —
  before the second bug reveals the coupling, instead of after. The diff-aware
  mode earns its keep immediately: on a change to one half of a coupled pair it
  names the other half that is missing from the diff.
- **A wrong nudge costs a glance, never a task.** Because it only ever advises,
  the bar for surfacing a partner can be tuned for recall without the
  catastrophe budget a blocking check would demand.
- **No cache is a real, accepted limitation.** Repeated calls re-mine the
  window. At a 500-commit window over file names this is cheap, and the verb is
  on-demand / opt-in, so the cost is paid only when asked for. A persisted store
  would be discern's **first general derived-data cache** — a genuine
  architectural step (invalidation, staleness, where it lives relative to the
  one-file footprint) that deserves its own ADR, written when the recompute cost
  is actually felt, not pre-emptively.
- **The thresholds are tuning, and ship as starting points.** The `1/size`
  weighting compresses `support` into a small score (this repo's strongest
  coupling sits near 1.3, not an integer count), so `min_support` reads as a
  weighted score, not a raw count, and the shipped defaults are calibrated
  against real history rather than the brief's first-guess integers. A project
  tunes them in `[coupling]`.
- **Discovery and enforcement stay cleanly separated.** This tool answers _where
  do couplings exist?_; ADR 0051's forcing functions answer _which couplings are
  invariants?_. Conflating them — auto-locking a strong pair — would manufacture
  brittle guards from incidental churn. The bridge between them is a human
  decision the advisory points at, not an automation.

## Alternatives considered

- **Block the gate on a missing sibling.** Rejected: a heuristic false positive
  that fails the gate is intolerable and trains the agent to ignore the surface.
  The human/agent must judge essential-vs-incidental, which only an advisory
  permits.
- **Auto-promote a strong coupling to an enforced rule.** Rejected: it conflates
  discovery with enforcement. An essential invariant deserves a deliberate
  forcing function (ADR 0051); an incidental co-change deserves nothing.
  Automating the promotion would do the wrong thing for both.
- **Split the advisory into "high-risk" vs quiet tiers.** Rejected per ADR 0063:
  discern surfaces facts and evidence and leaves the judgement to the consumer.
  A flat list with each partner's confidence/support/lift lets the agent weigh
  it; a built-in "high-risk" verdict pretends to a certainty the heuristic
  doesn't have.
- **Persist a co-change graph / cache.** Deferred, not rejected: premature here.
  Recompute-on-demand is cheap enough at this scale, and a cache is its own
  decision (see Consequences).
- **Function- or hunk-level granularity.** Out of scope for v1. File-level
  coupling is the high-value, low-noise case; finer granularity multiplies both
  the cost and the noise and can be layered on the same pure core later.
