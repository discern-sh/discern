# Ratchets

_Never-loosen metric floors and ceilings — a number that may only improve versus
`main`, so quality can climb but never slide back._

A **Ratchet** holds one measurable quality metric at a limit that a branch can
never loosen. A coverage percentage that may only rise. A bundle size that may
only fall. A count of lint suppressions that may only shrink. The limit is
compared against `main`, so a floor may only rise and a ceiling may only fall on
a branch — you cannot weaken the gate on the branch that would benefit from
weakening it.

Ratchets are **slow and on demand**. They run their measurement commands (a full
coverage run, a release build), so they are deliberately **not** part of
`discern finish` — running them on every gate would make the inner loop crawl.
Run them yourself with `discern ratchets` when you want to check the line is
held: before landing a branch, in a pull-request-only CI job, or after a change
you expect to move a metric. A non-dry-run needs a clean worktree (the
measurement must reflect committed state); `--dry-run` previews which ratchets
would run without measuring anything.

Nothing about a ratchet you never define costs you anything — an undefined
metric is simply not measured (design principle 9). You add a ratchet only where
a number is worth defending.

## What a ratchet block looks like

Each ratchet is one `[ratchets.<name>]` table in `discern.toml`:

```toml
[ratchets.coverage]
direction = "up"                 # value should rise; the limit is a FLOOR
limit     = 89                   # the floor (up) or ceiling (down)
run       = "deno task coverage" # the command that measures it
```

The fields:

- **`direction`** — `"up"` when the value should rise (the `limit` is a floor,
  as for coverage), or `"down"` when it should fall (the `limit` is a ceiling,
  as for a size budget).
- **`limit`** — the floor or ceiling. It is compared against `main`: a floor may
  only rise, a ceiling may only fall, so a branch can tighten the gate but never
  loosen it.
- **`run`** — the command that measures the metric. It runs on demand under
  `discern ratchets`, never as part of `finish`.
- **`metric`** — the metric name the `run` command emits (defaults to the
  ratchet name). Naming it lets one command emit several metrics.
- **`margin`** — headroom `discern ratchets --pin` leaves when it tightens this
  limit to the measured value (default `0` — pin to the exact measurement). Give
  a metric that drifts on unrelated commits — a bundle size, a coverage
  percentage — a margin so a pinned limit is not tripped by ordinary
  fluctuation.

## How a measurement reports its number

The `run` command reports its metric by printing one line to stdout in the
`DISCERN_METRIC` protocol — the metric name and its value, stack-neutral so any
tool in any language can emit it:

```
DISCERN_METRIC coverage 91.4
```

A command whose own output already ends in that line needs no wrapper; one that
does not is easy to wrap:

```toml
[ratchets.guidance]
metric    = "guidance_words"
direction = "down"
limit     = 803
run       = "echo DISCERN_METRIC guidance_words $(cat guidance/*.md | wc -w)"
```

discern reads the last `DISCERN_METRIC <name> <number>` line the command emits,
compares the number to the limit, and asserts the limit was not loosened versus
`main` ([ADR 0003](../_adr/0003-named-metric-ratchets.md)).

## Raw counts versus rates

A raw count is the wrong thing to hold when the project is growing. "No more
than 16 documentation lint alerts" fails the moment the docs double in size,
even if their _quality_ never dropped. The `per` denominator turns a raw count
into a rate that does not rise just because the project grew:

```toml
[ratchets.prose]
direction = "down"
per       = { words = "docs/**" }   # divide the count by the words under docs/
scale     = 1000                    # express it per 1,000 words
limit     = 16                      # ≤ 16 alerts per 1,000 words
run       = "deno task prose \"docs/\""
```

`per` divides the emitted metric by a denominator — a built-in
word/line/file/byte count over a glob, or a second metric the same command emits
— and `scale` expresses the rate against a readable unit (per 1,000 words, per
10,000). The metric then measures density, not volume, so a branch that adds
prose at the same quality holds the line
([ADR 0057](../_adr/0057-rate-ratchets.md)).

## Capturing a gain: `discern ratchets --pin`

When a change improves a ratcheted metric, capture the gain so it cannot slide
back. `discern ratchets --pin` measures every ratchet and tightens each limit
that improved to the value just measured — a floor up, a ceiling down — then
commits that one change with an audit message. Name ratchets to pin only those
(`discern ratchets --pin coverage`); with none named it pins every ratchet that
has slack. It only ever tightens: a regressed metric is a failing ratchet, not a
limit to loosen, and pin refuses to run while any ratchet is red.

A green `discern ratchets` check already measured everything, so its hints name
any pinnable slack — decided by the same rule a real pin applies — making the
whole flow check → pin. The green check also records its values as a
**measurement receipt** against the exact commit (the gate receipt marker's
model — the commit is pinned before the measurements run and re-verified at
record time, so a mid-measurement commit records nothing), and a pin on that
same clean commit reuses the values instead of re-running every slow
measurement: the flow measures once. Any new commit, uncommitted edit, or red
check silently invalidates the receipt and the pin measures fresh; only the
never-loosen comparison is always re-checked live, because `main` can advance
while the branch stands still
([ADR 0112](../_adr/0112-ratchet-measurement-receipt.md)). `--dry-run` renders
the plan and measures nothing, with or without `--pin`: what a pin would change
is knowable only by measuring, and the check's hints are where that answer
already lives.

Pin is the way to re-pin a baseline — never hand-edit the number. Because its
commit changes only `[ratchets]` limits, which the gate never reads, pin carries
a green `discern finish` receipt forward onto it, so a follow-up
`discern
graduate` still skips the redundant gate re-run
([ADR 0106](../_adr/0106-ratchets-pin-carries-the-gate-receipt.md)).

For a metric that drifts on every commit — a bundle size, a coverage percentage
— set a `margin` so pin leaves headroom instead of pinning to an exact value the
next commit would breach; pin also skips a gain smaller than the margin.

## When a ratchet fires

Every failure reports its reason in the result envelope's `diagnostics[]` — the
measured value against the limit, or which limit was loosened — with the
ratchet's own `run` as the `reproduce_cmd` when the measurement is what fell
short. Each measured step's note carries its value
(`up, limit 80, measured
85`), held or not. An MCP or `--json` caller reads all
of this directly; the CLI narrates the same words live.

A ratchet fails for one of two reasons, and they call for opposite responses.

- **The metric regressed** — coverage fell, the binary grew, the suppression
  count rose. Move the _metric_ back the right way: add the test, trim the code,
  remove the suppression. That is the ratchet doing its job.
- **You loosened the limit** — the `limit` in `discern.toml` is weaker than
  `main`'s. This is the regression a ratchet exists to catch, so **never loosen
  the limit to pass**. Raising a floor or lowering a ceiling is always allowed
  (you are tightening); relaxing one versus `main` is refused. If a metric
  genuinely cannot be held — a large dependency legitimately grew the binary —
  that is a deliberate decision to record, not a quiet edit to slip through.

## Authoring a ratchet

Adding a ratchet is choosing a defendable number and wiring the block above:
measure the metric as it stands today, set the limit at that value, and let it
only tighten from there — `discern ratchets --pin` captures each later gain. The
bundled [`discern-ratchet-a-metric`](../40-agent-guidance/README.md) skill walks
the whole procedure — picking the metric, wiring the table, and knowing what to
do when it fires.

## See also

- [The quality gate](README.md) — where ratchets sit relative to `finish`.
- [concepts.md](../00-orientation/concepts.md) — the Ratchet concept in the
  wider picture.
- [the-result-envelope.md](the-result-envelope.md) — the result shape
  `discern ratchets` returns.
