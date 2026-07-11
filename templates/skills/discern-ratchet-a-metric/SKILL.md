---
name: discern-ratchet-a-metric
description: Put a quality metric behind a never-loosen ratchet — choose a defendable number, wire it into [ratchets] in discern.toml, set the limit at today's value, and know what to do when it fires. Use when the user wants to ratchet, defend, or hold the line on a metric (coverage, bundle size, lint suppressions, TODO count, uses of a deprecated pattern), wants to stop a number regressing, or when a ratchet has fired and the way forward is unclear. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Ratchet a metric

A ratchet is a one-way door for a number: a **floor that may only rise** or a **ceiling that may only fall**, compared against `main` so no branch can ever loosen it. It is not a target and not a nag — it is a *no-backsliding guarantee*: whatever quality the number represents, the project can only keep or improve it from here. This skill is the judgement around the feature: which numbers deserve one, how to wire it, where to set the limit, and what to do — and never do — when one fires.

---

## 1. Choose a metric worth defending

A ratchet blocks pushes, so the number behind it must be *defendable*:

- **Deterministic** — the same tree always yields the same number. Timing, network, and anything sampling-based will fire false alarms until the ratchet gets deleted, which is worse than never adding it.
- **Cheap to measure** — `discern ratchets` is on-demand and not part of the gate; a number that takes ten minutes to compute won't get checked often enough.
- **Meaningful** — it moves when the quality it stands for moves, and is hard to satisfy by gaming. "Count of `TODO` markers" is honest; "count of files containing the word test" is theatre.
- **Owned** — the user is willing to be *blocked* on this number. Confirm that before wiring; an unwanted ratchet teaches people to bypass ratchets.

Classic candidates: test coverage (floor), uses of a deprecated pattern (ceiling), lint/type suppressions (ceiling), build or bundle size (ceiling), documentation-lint density (ceiling).

---

## 2. Pick the direction — and ratchet a rate when the project grows

- `direction = "up"` — the limit is a **floor**; right for numbers where more is better (coverage).
- `direction = "down"` — the limit is a **ceiling**; right for counts of a thing you want less of.

Watch for metrics that rise just because the project grows: a raw count of TODOs, alerts, or type errors over a growing tree punishes growth, not regression. Ratchet the **rate** instead — the config's `per` divides the metric by a second number (one the run emits, or an extent discern measures itself: `files`, `lines`, `words`, or `bytes` over a git pathspec), with `scale` to keep the limit in human units (e.g. per 1,000 lines).

---

## 3. Wire it in `discern.toml`

Each ratchet is one `[ratchets.<name>]` table. The `run` command measures the metric and reports it by printing a line `DISCERN_METRIC <name> <number>` (the last such line wins):

```toml
[ratchets.suppressions]
direction = "down"                     # a ceiling: the count may only fall
limit     = 41                         # today's value on main — never aspirational
run       = "tools/count-suppressions" # prints: DISCERN_METRIC suppressions 41
```

Keep the `run` script in the repo like any other tool, and make it print *only* from what's in the tree — determinism (step 1) is a property of this command.

---

## 4. Set the limit at today's value — never at the aspiration

Measure the metric on `main` and set `limit` to exactly that. A ratchet holds ground; it doesn't seize it. An aspirational limit fails every branch immediately, and the "fix" people reach for is deleting the ratchet. Where the number *should* be is a goal — record it in the project's TODO — and tighten the limit as real improvements land (tightening is always allowed; that's the direction the door opens).

Capture a gain with **`discern ratchets --pin`** — never a hand-edit. It measures (reusing a green `discern ratchets` check's measurements when run on the same clean commit, so check → pin measures once), tightens each improved limit to the value just measured, commits that change on its own, and carries a green gate receipt forward so a follow-up `accept` call skips a needless re-run. For a metric that drifts on unrelated commits (bundle size, coverage), give the table a `margin` so pin leaves that much headroom instead of pinning to an exact number the next commit would breach; pin skips a gain smaller than the margin. Pass a name (`discern ratchets --pin coverage`) to pin just one.

Then prove the wiring is live, detector-style: run `discern_ratchets` (or `discern ratchets --json`) and see it green — and check the failure path once, e.g. by temporarily tightening the limit past the current value and watching the run refuse, so you know a real regression will actually be caught. Finally, leave a line near the table (a comment, or the docs) saying *what this number stands for and why it's held* — the ratchet outlives the session that added it.

---

## 5. When a ratchet fires

**Never loosen the limit to pass.** A limit loosened versus `main` is precisely the regression the ratchet exists to catch — move the *metric* the right way instead: remove the instances you added, cover what you uncovered, shrink what you grew. This holds even when the work that tripped it feels unrelated or urgent; the ratchet is doing its job.

The one legitimate exception is a limit that was *set wrong* — mis-measured, or measuring something the project has since deliberately changed. Correcting that is a real decision, not an escape hatch: make the case to the user, record it (an ADR, via `discern-write-adr`, when the correction is surprising), and adjust the limit in its own commit that says why. A quiet loosening buried in a feature branch is indistinguishable from the failure mode. (This hand-edit is only ever for *loosening* a mis-set limit — capturing a genuine improvement is `discern ratchets --pin`, step 4, which by construction can only tighten.)

---

## 6. Plan the end state

A `down` ratchet that reaches **zero** has finished its job as a ratchet — don't leave it idling there. Move the rule into the always-on gate (a check or test that fails on the *first* new instance) and retire the ratchet table: the ratchet was the transition, the gate is the law. This journey — detector, falling ceiling, permanent ban — is the `discern-outlaw-a-pattern` skill, when what you're driving to zero is a pattern in the code. A floor (coverage) usually has no end state; it just holds, rising as the project improves.

---

## Done when

- the metric is **defendable** — deterministic, cheap, meaningful, and the user agreed to be blocked on it;
- the `[ratchets.<name>]` table is wired with the right **direction** (a rate, via `per`, where growth would otherwise breach it) and the **limit set at today's value** on `main`;
- `discern ratchets` passes, the failure path has been seen to fire once, and what the number stands for is written down;
- the never-loosen rule and the end state (tighten over time; at zero, move a ceiling into the gate) are understood — and nothing in the change loosens any *existing* ratchet.
