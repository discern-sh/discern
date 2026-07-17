# Standards

_Numbers that can never get worse: metric floors and ceilings that may only improve versus `main`, so quality can climb but never slide back._

A **standard** holds one measurable quality metric at a limit that a branch can never loosen. A coverage percentage that may only rise. A bundle size that may only fall. A count of lint suppressions that may only shrink. The limit is compared against `main`, so a floor may only rise and a ceiling may only fall on a branch — you cannot weaken the gate on the branch that would benefit from weakening it.

**The gate itself enforces standards**. Every `discern done` run does two things ([ADR 0133](../_adr/0133-standards-join-the-gate.md)):

- **Verifies every limit against the trunk** — always, in milliseconds, with no off switch. A limit loosened versus `main`, or a `[standards.<name>]` table deleted outright, fails the gate before anything expensive runs, with a diagnostic naming the standard and both values. When the gate cannot read the trunk at all (a CI clone that never fetched it), it proceeds **loudly** — a warning, an envelope disclosure, and a hint naming the fix — never silently. A fetched trunk config that does not parse fails hard.
- **Measures each standard by default**, as a job inside the same parallel group as the tests — the same fail-fast behaviour, output capture, and per-job `timeout` as every other gate job. A measured metric past its limit fails the gate like any failing check. A standard whose declared `inputs` nothing in the change touched **replays** its recorded value instead of re-measuring — a docs-only change pays seconds, not a coverage run — and a metric genuinely too slow for every gate run opts out of measurement alone with `measure = "on-demand"`.

The **inner loop stays fast**: `discern prepare` never measures a standard. The standalone `discern standards` remains the on-demand pass — it always measures (never replays), for deferred standards, explicit re-measurement, CI, and pinning. Its non-dry-run needs a clean worktree, because it records its measurements against the exact commit. `--dry-run` previews which standards would run without measuring anything.

Nothing about a standard you never define costs you anything — an undefined metric is not measured (design principle 9). You add a standard only where a number is worth defending.

## What a standard block looks like

Each standard is one `[standards.<name>]` table in `discern.toml`:

```toml
[standards.coverage]
direction = "up"                 # value should rise; the limit is a FLOOR
limit     = 89                   # the floor (up) or ceiling (down)
run       = "deno task coverage" # the command that measures it
```

The fields:

- **`direction`** — `"up"` when the value should rise (the `limit` is a floor, as for coverage), or `"down"` when it should fall (the `limit` is a ceiling, as for a size budget).
- **`limit`** — the floor or ceiling. It is compared against `main`: a floor may only rise, a ceiling may only fall, so a branch can tighten the gate but never loosen it.
- **`run`** — the command that measures the metric. The gate runs it alongside the tests on every `done`; `discern standards` runs it on demand.
- **`metric`** — the metric name the `run` command emits (defaults to the standard name). Naming it lets one command emit several metrics.
- **`margin`** — headroom `discern standards --pin` leaves when it tightens this limit to the measured value (default `0` — pin to the exact measurement; must be `≥ 0`, since margin is headroom, never a tightening). Give a metric that drifts on unrelated commits — a bundle size, a coverage percentage — a margin so a pinned limit is not tripped by ordinary fluctuation.
- **`inputs`** — the paths the metric reads, as scope-style globs. When every change since the last recorded measurement falls outside them — the committed diff plus dirty working-tree paths, renames counted on both sides — the gate replays that recorded value instead of re-measuring, and says so: the step and the receipt read "replayed from `<sha>` (inputs unchanged)". Omitted means always measure (the conservative default). The honest risk: a too-narrow `inputs` list delays detection until the next measured run.
- **`timeout`** — seconds; replaces the global `[gate].timeout` for this measurement job only (`0` disables its bound). The proportionate answer to one slow metric — never a slower global.
- **`measure`** — `"gate"` (the default) measures in every `done`; `"on-demand"` defers a metric genuinely too slow for every gate run to `discern standards`. Deferral covers the _measurement_ only — the never-loosen limit check has no opt-out — and the gate's hints name every deferred standard. Reach for the smaller reliefs first: declare `inputs` so unchanged trees replay without re-measuring, or raise this one job's `timeout`.

## How a measurement reports its number

The `run` command reports its metric by printing one line to stdout in the `DISCERN_METRIC` protocol — the metric name and its value, stack-neutral so any tool in any language can emit it:

```
DISCERN_METRIC coverage 91.4
```

A command whose own output already ends in that line needs no wrapper; one that does not is easy to wrap:

```toml
[standards.guidance]
metric    = "guidance_words"
direction = "down"
limit     = 803
run       = "echo DISCERN_METRIC guidance_words $(cat guidance/*.md | wc -w)"
```

discern reads the last `DISCERN_METRIC <name> <number>` line the command emits, compares the number to the limit, and asserts the limit was not loosened versus `main` ([ADR 0003](../_adr/0003-named-metric-standards.md)).

## Raw counts versus rates

A raw count is the wrong thing to hold when the project is growing. "No more than 16 documentation lint alerts" fails the moment the docs double in size, even if their _quality_ never dropped. The `per` denominator turns a raw count into a rate that does not rise just because the project grew:

```toml
[standards.prose]
direction = "down"
per       = { words = "map/**" }    # divide the count by the words under map/
scale     = 1000                    # express it per 1,000 words
limit     = 16                      # ≤ 16 alerts per 1,000 words
run       = "deno task prose \"map/\""
```

`per` divides the emitted metric by a denominator — a built-in word/line/file/byte count over one or more git pathspecs (an empty pathspec list is refused, so a `per` extent can never silently measure the whole repository), or a second metric the same command emits — and `scale` expresses the rate against a readable unit (per 1,000 words, per 10,000). The metric then measures density, not volume, so a branch that adds prose at the same quality holds the line ([ADR 0057](../_adr/0057-rate-standards.md)).

## Capturing a gain: `discern standards --pin`

When a change improves a metric protected by a standard, capture the gain so it cannot slide back. `discern standards --pin` measures every standard and tightens each limit that improved to the value just measured — a floor up, a ceiling down — then commits that one change with an audit message. Name standards to pin only those (`discern standards --pin coverage`); with none named it pins every standard that has slack. It only ever tightens: a regressed metric is a failing standard, not a limit to loosen, and pin refuses to run while any standard is red.

A green `discern standards` check already measured everything, so its hints name any pinnable slack — decided by the same rule a real pin applies — making the whole flow check → pin. The green check also records its values as a **measurement receipt** against the exact commit (the gate receipt marker's model — the commit is pinned before the measurements run and re-verified at record time, so a mid-measurement commit records nothing), and a pin on that same clean commit reuses the values instead of re-running every slow measurement: the flow measures once. A **green gate run over a clean committed tree records the same receipt** — durations included — so the everyday path is `done` → `--pin` → `accept` with the measurements paid for exactly once and the gate re-run zero times; the recorded values are also the baseline the next gate run's input-keyed replay stands on. Any new commit, uncommitted edit, or red check silently invalidates the receipt and the pin measures fresh; only the never-loosen comparison is always re-checked live, because `main` can advance while the branch stands still ([ADR 0112](../_adr/0112-standard-measurement-receipt.md)). `--dry-run` renders the plan and measures nothing, with or without `--pin`: what a pin would change is knowable only by measuring, and the check's hints are where that answer already lives.

Pin is the way to tighten a standard — never hand-edit the number. Because its commit changes only `[standards]` limits, which the gate never reads, pin carries a green `discern done` receipt forward onto it, so a follow-up `discern
accept` still skips the redundant gate re-run ([ADR 0106](../_adr/0106-standards-pin-carries-the-gate-receipt.md)).

For a metric that drifts on every commit — a bundle size, a coverage percentage — set a `margin` so pin leaves headroom instead of pinning to an exact value the next commit would breach; pin also skips a gain smaller than the margin.

## When a standard fires

Every failure reports its reason in the result envelope's `diagnostics[]` — the measured value against the limit, or which limit was loosened — with the standard's own `run` as the `reproduce_cmd` when the measurement is what fell short. Each measured step's note carries its value (`up, limit 80, measured
85`), held or not. An MCP or `--json` caller reads all of this directly; the CLI narrates the same words live.

A standard fails for one of two reasons, and they call for opposite responses.

- **The metric regressed** — coverage fell, the binary grew, the suppression count rose. Move the _metric_ back the right way: add the test, trim the code, remove the suppression. That is the standard doing its job.
- **You loosened the limit** — the `limit` in `discern.toml` is weaker than `main`'s, or the table was deleted. This is the regression a standard exists to catch, so **never loosen the limit to pass**. Raising a floor or lowering a ceiling is always allowed (you are tightening); relaxing one versus `main` fails every gate run on the branch — no path through the gate lands a loosening quietly.

## Deliberately loosening a limit

Sometimes a limit is genuinely mis-set — mis-measured at authoring time, or holding a number the project has since deliberately changed (a large dependency legitimately grew the binary). Correcting it is an **owner decision, taken on the trunk**: the owner decides in a sentence, and at their explicit instruction an agent working in the main checkout edits the `[standards.<name>]` limit in the trunk's `discern.toml` — in daylight, in trunk history, where the change is a visible commit rather than a quiet edit buried in a feature branch. The Tier-1 failure's hint says exactly this: an agent that hits it on a branch relays the finding to its owner rather than working around it. There is no annotation, reset, or loosening verb — deliberate loosening is rare enough that a plain trunk commit is the honest record of it.

## Authoring a standard

Adding a standard is choosing a defendable number and wiring the block above: measure the metric as it stands today, set the limit at that value, and let it only tighten from there — `discern standards --pin` captures each later gain. The bundled [`discern-standard-a-metric`](../40-agent-guidance/README.md) skill walks the whole procedure — picking the metric, wiring the table, and knowing what to do when it fires.

## See also

- [The quality gate](README.md) — where standards sit relative to `done`.
- [concepts.md](../00-orientation/concepts.md) — the Standard concept in the wider picture.
- [the-result-envelope.md](the-result-envelope.md) — the result shape `discern standards` returns.
