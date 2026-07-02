# Co-change coupling

_`discern coupling` — surface the files that change together, so the sibling you
would otherwise forget gets named._

A coding agent has near-perfect recall of the file in front of it and almost
none of the file that, by the project's own history, almost always moves with it
— the schema and its validator, the registry and the switch over it, the verb
and its test. The `coupling` verb reconstructs a senior's "I bet there's another
one" instinct from data: it mines git history for files that change in the same
commits and reports the ones a change is likely missing. It is the **discovery**
layer that pairs with the **enforcement** discipline of
[ADR 0051](../_adr/0051-canonical-set-parity.md) — and the two are kept
deliberately apart ([ADR 0084](../_adr/0084-co-change-coupling-advisory.md)).

It is **purely advisory**. It points at where to look and **never blocks** —
never touches a gate's pass/fail, exit code, or `failed_stage`. The whole output
rides in the `DiscernResult` `hints[]` (the one advisory channel — human,
`--json`, and MCP alike), with each partner's evidence shown for transparency
and the list stated to be **not exhaustive**.

## Three modes

`coupling` is one verb, and the number of file paths you give it selects the
mode (mirroring `changed-scopes`):

- **diff-aware** (no argument) — the primary surface. The "change set" is your
  **branch's work** — everything committed since the fork from the integration
  branch, plus any uncommitted edits (the same set `changed-scopes` and the gate
  use). So it is non-empty even on a clean working tree when the branch is
  ahead; it is the unit that would graduate, not just the latest commit. It
  names the files that co-change with that set but are **missing** from it.
  _"You changed `result.ts`, but not `result_schemas.ts` — which changed in 5 of
  the 14 recent commits that touched `result.ts` (36%). Worth a look, or
  intentional?"_
- **query** (`discern coupling <path>`) — one file's top co-change partners, its
  blast radius. Useful before a change: _what tends to move when I touch this?_
- **evidence** (`discern coupling <a> <b>`) — the shared co-change history of
  two files: the commits where **both** changed, with their hashes, dates, and
  subjects, plus each file's own commit count (the "of N" denominators). The raw
  material to judge a coupling — _one deliberate decision, or a few incidental
  rides-along?_ — before you act on it. It reads the same window the other modes
  do, so its counts corroborate what `query` reports for the pair.

All three render the advisory as `hints[]`. `--json` adds `data`: `partners` for
diff/query (the ranked list, each entry an edge
`{ path, from, cochanges, of, confidence, lift }` — the evidence in plain
counts, `cochanges` of the `of` commits that touched `from`), and for evidence
the pair `a`/`b`, the `together`/`of_a`/`of_b` counts, and `commits`
(`{ sha, date,
subject }`, reusing `integrate`'s change-summary convention). The
MCP tool `discern_coupling` takes an optional `file` (query) and a second
optional `with` (evidence) argument; the working-root override keeps the name
`path`.

## The metric

`coupling` is **zero-config**: it self-calibrates to your repo, so there are no
thresholds to tune. Absolute thresholds don't transfer — a "support" floor tuned
on one repo's commit cadence surfaces nothing on another — so every gate is
expressed in units that mean the same thing at any scale.

Each non-merge commit is a **basket** of the files it changed. From a bounded
window of recent commits:

- **neutral paths are dropped** (the same classification
  `[scopes.<name>].neutral` drives), so docs, generated agent files, and
  materialized skills never create edges;
- a **sweeping commit is skipped** — `max_commit_size` is derived per-repo as
  the upper-outlier fence (Q3 + 1.5·IQR) of _your_ repo's own commit-size
  distribution, so a "format everything" or dependency bump can't manufacture
  coupling, and a repo of small commits and one of larger commits each judge a
  sweep against their own normal;
- a directional edge A→B is kept only when the two co-changed in at least a
  couple of commits (a fluke guard — a plain count, scale-free), A's changes
  include B often enough to be worth mentioning (a confidence ratio,
  scale-free), and the association is statistically **significant** — a
  log-likelihood-ratio test (a G-test over raw commit counts) that is unit-free
  and robust at the low counts a young repo has. This is the standard tool for
  "do these co-occur more than chance," and it's what lets one significance
  level transfer across repos where a raw support floor cannot.

Survivors are ranked strongest-first and **capped** (top-k), so the advisory
never floods. The broad survivor set feeds the direct `discern coupling` result:
explicit discovery is allowed to be exploratory. Automatic gate hints apply one
stricter presentation filter before speaking: a partner must either follow the
source at a high rate (75%+ confidence), or have repeated evidence (3+
co-changes) and a moderate follow-rate (40%+ confidence). Gate hints also show
fewer partner lines than the direct result. That extra bar is not a config knob;
it is the product boundary between _asked-for exploration_ and _unsolicited
interruption_.

The model is **recomputed on demand**, bounded by the window — there is no cache
in v1 (see [ADR 0084](../_adr/0084-co-change-coupling-advisory.md) for why a
persisted store is deferred). When git can't answer, the advisory stays
**silent** rather than failing into noise.

## Configuration

There is nothing to tune — the metric self-calibrates. The only setting is
whether the advisory also rides along with the gate:

| Key       | Default | Meaning                                                                                                                                       |
| --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `in_gate` | `false` | Surface the diff-aware advisory during the gate too — `discern finish` **and** the fast inner loop `discern prepare` (as hints, at the tail). |

The whole subsystem is the `coupling`
[Feature](../00-orientation/glossary.md#feature), inert when
`[features].coupling = false`. The full config reference is in
[config-reference.md](../10-installer/config-reference.md#coupling).

## In the gate

With `[coupling].in_gate = true`, **both** `discern finish` and the fast inner
loop `discern prepare` append the diff-aware advisory to their result as
`hints[]`, at the **tail** of the run — alongside strand detection, because it
reads the diff and is therefore dependency-bearing, never a fail-fast
precondition. Wiring it into `prepare` too means the nudge meets the change
while it is still hot, not as a surprise at the finish line. The gate path uses
the stricter presentation filter above, so a weak but real pair can remain
visible in `discern coupling` while staying out of automatic gate hints. The
500-commit name-only mine is cheap, so it never slows the loop. It is suppressed
entirely until the install is bootstrapped, so an agent's in-session setup stays
uncluttered, and is skipped on a failed run. It **never** changes pass/fail —
only adds advice. The flag is off by default: opt in when you want the nudge in
the gate as well as on demand.

## Discovery, not enforcement

A strong coupling is a finding, not a verdict. The advisory names one path back
to enforcement — _"if this is an essential invariant, lock it with a forcing
function (the
[`fix-a-bug-class`](../../templates/skills/fix-a-bug-class/SKILL.md) skill / ADR
0051)"_ — but the decision is yours: an **essential** invariant earns a forcing
function, an **incidental** co-change earns nothing. Promoting a coupling to an
enforced rule is always a separate, deliberate step
([ADR 0084](../_adr/0084-co-change-coupling-advisory.md)).

## See also

- [ADR 0084](../_adr/0084-co-change-coupling-advisory.md) — why the advisory is
  non-blocking and recomputed on demand.
- [ADR 0051](../_adr/0051-canonical-set-parity.md) — the enforcement discipline
  this feeds.
- [the-result-envelope.md](the-result-envelope.md) — the `hints[]` and `data`
  the verb returns.
