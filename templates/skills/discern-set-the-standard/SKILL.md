---
name: discern-set-the-standard
description: Set the standard — put a quality number behind a limit that can never get worse. Choose a defendable metric, wire it into [standards] in discern.toml, set the limit at today's value, and know what to do when it fires; includes the outlaw procedure for making a legacy pattern illegal — detector, falling ceiling, then a permanent gate rule at zero. Use when the user wants to set, defend, or hold a standard for a metric (coverage, bundle size, lint suppressions, TODO count), wants to stop a number regressing, when a standard has fired and the way forward is unclear, or to migrate off, phase out, ban, or eliminate a pattern, API, or dependency codebase-wide ("stop using X", "get rid of the old way"). Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Set the standard

Standards are **numbers that can never get worse**: each is a **floor that may only rise** or a **ceiling that may only fall**, compared against `main` so no branch can ever loosen it. A standard is not a target and not a nag — it is a _no-backsliding guarantee_: whatever quality the number represents, the project can only keep or improve it from here. This skill is the judgement around the feature: which numbers deserve one, how to wire it, where to set the limit, and what to do — and never do — when one fires.

Driving a legacy pattern out of the codebase entirely? That migration mode — the same standard machinery pointed at a pattern's count, ending in a permanent ban — is [outlaw-a-pattern.md](outlaw-a-pattern.md) in this skill.

---

## 1. Choose a metric worth defending

A standard blocks pushes, so the number behind it must be _defendable_:

- **Deterministic** — the same tree always yields the same number. Timing, network, and anything sampling-based will fire false alarms until the standard gets deleted, which is worse than never adding it.
- **Affordable in the gate** — the gate measures every standard alongside the tests on each `discern done`. For a slower metric, climb the relief ladder smallest-hammer-first: declare `inputs` (the paths the metric reads) so a change touching none of them replays the recorded value for free; give the one job its own `timeout` instead of a slower global; and only for a metric genuinely too slow for every gate run, set `measure = "on-demand"` to defer it to `discern standards` — its never-loosen limit check still runs on every gate.
- **Meaningful** — it moves when the quality it stands for moves, and is hard to satisfy by gaming. "Count of `TODO` markers" is honest; "count of files containing the word test" is theatre.
- **Owned** — the user is willing to be _blocked_ on this number. Confirm that before wiring; an unwanted standard teaches people to bypass standards.

Classic candidates: test coverage (floor), uses of a deprecated pattern (ceiling), lint/type suppressions (ceiling), build or bundle size (ceiling), documentation-lint density (ceiling).

A rule that needs judgment rather than measurement ("is this large cut proven safe?") belongs in a checkpoint — the `discern-place-a-checkpoint` skill walks that authoring; when a checkpoint's question later becomes mechanically decidable, it graduates here through the outlaw procedure.

---

## 2. Sort the number — invariant, rate, or growing total

Ask one question before wiring anything: **does this number move when the project healthily grows?** The answer decides the standard's shape:

- **An invariant** — a count of things a healthy project never adds: lint suppressions, uses of a banned pattern. Growth doesn't move it, so hold the raw count; no margin needed, and the end state is zero (step 6).
- **A quality that scales** — coverage, alert density. The raw count rises with the tree, so hold the **rate**: `per` divides the metric by a second number (one the run emits, or an extent discern measures itself: `files`, `lines`, `words`, or `bytes` over a git pathspec), with `scale` to keep the limit in human units (e.g. per 1,000 lines). Proportional growth passes; dilution fails.
- **A growing total** — an asset size, a word count, a page count: numbers that rise with every shipped feature because the product itself grew. A ceiling pinned at today's value fails the next legitimate change, and every exit from that failure is bad — an agent hunting stray bytes in unrelated code is the classic result. Prefer the rate that states the real claim (bytes per page, alerts per 1,000 words); where only the total will do, set a `margin`, and treat raising the limit as a routine owner decision when the product grows, never as a defeat.

`direction = "up"` makes the limit a **floor** (more is better); `direction = "down"` makes it a **ceiling** (less is better). Both directions take `per`.

---

## 3. Wire it in `discern.toml`

Each standard is one `[standards.<name>]` table. The `run` command measures the metric and reports it by printing a line `DISCERN_METRIC <name> <number>` (the last such line wins):

```toml
[standards.suppressions]
direction = "down"                     # a ceiling: the count may only fall
limit     = 41                         # today's value on main — never aspirational
run       = "tools/count-suppressions" # prints: DISCERN_METRIC suppressions 41
```

Keep the `run` script in the repo like any other tool, and make it print _only_ from what's in the tree — determinism (step 1) is a property of this command.

---

## 4. Set the limit at today's value — never at the aspiration

Measure the metric on `main` and set `limit` to exactly that. A standard holds ground; it doesn't seize it. An aspirational limit fails every branch immediately, and the "fix" people reach for is deleting the standard. Where the number _should_ be is a goal — record it in the project's TODO — and tighten the limit as real improvements land (tightening is always allowed; that's the direction the door opens).

Capture a gain with **`discern standards --pin`** — never a hand-edit. It reuses every available measurement from the same clean commit, measures selected values that are still missing, tightens each improved limit, commits that change on its own, and carries a valid gate Proof forward so a follow-up `accept` call skips a needless re-run. A named pin such as `discern standards --pin coverage` limits measurement to its targets only when an honored gate Proof already validates the complete clean tree. Without that Proof, discern still validates every standard before changing the named limit. For a metric that drifts on unrelated commits (bundle size, coverage), give the table a `margin` so pin leaves that much headroom instead of pinning to an exact number the next commit would breach; pin skips a gain smaller than the margin.

Then prove the wiring is live, detector-style: run `discern_standards` (or `discern standards --json`) and see it green — and check the failure path once, e.g. by temporarily tightening the limit past the current value and watching the run refuse, so you know a real regression will actually be caught. Finally, leave a line near the table (a comment, or the docs) saying _what this number stands for and why it's held_ — the standard outlives the session that added it.

---

## 5. When a standard fires

**Never loosen the limit to pass.** A limit loosened versus `main` — or a standard deleted outright — is precisely the regression the standard exists to catch, and every `discern done` run verifies it: a loosening cannot pass the gate on a branch at all. Move the _metric_ the right way instead, **within the scope of your task**: remove the instances you added, cover what you uncovered, shrink what you grew.

**A breach from the work itself is not yours to engineer away.** When the deliverable legitimately grew what the metric measures — a documented feature grew the docs, a needed dependency grew the binary — the fix is not to claw the number back from elsewhere. Shrinking unrelated content, trading readability for bytes, or replacing a dependency with a hand-rolled copy makes the codebase worse while the number reports it got better. Stop and report the breach to the owner: the measured value, the delta, and why the growth is intrinsic to the work. Moving the limit is their decision, and an offsetting edit buried in a feature branch hides the very growth they needed to see.

Relay that decision point with the measured facts intact:

> <standard> measured <value> with a <delta> change. <reason>. The next valid action is <next_action>.

When the owner agrees that the breach should become a proposal, finish the implementation and commit its final tree before running **`discern standards propose <name> --reason "…"`**. Proposal creation is a finalization step. The command measures only the named standard on that clean `HEAD`, creates the config-only proposal commit, and records the decision for Proof and acceptance. Do not use proposal creation as an intermediate checkpoint while files and commits are still changing.

If required follow-up work later creates a descendant and the standard definition, trunk baseline, reason, measured value, and proposed limit remain unchanged, repeat the same proposal command. discern measures the named standard again and renews the proposal's descendant binding without changing Git history. A changed tuple or value is a different decision: follow the refusal, restore the trunk limit when directed, and create the new proposal only after the tree is final.

The one legitimate exception is a limit that was _set wrong_ — mis-measured, or measuring something the project has since deliberately changed. Correcting that is an **owner decision, taken on the trunk**: relay the finding and make the case; at the owner's explicit instruction, an agent working in the main checkout adjusts the limit in the trunk's config, in its own commit that says why (an ADR, via `discern-write-adr`, when the correction is surprising). A quiet loosening buried in a feature branch is indistinguishable from the failure mode — which is exactly why the gate refuses it there. (This trunk edit is only ever for _loosening_ a mis-set limit — capturing a genuine improvement is `discern standards --pin`, step 4, which by construction can only tighten.)

---

## 6. Plan the end state

A `down` standard that reaches **zero** has finished its job as a standard — don't leave it idling there. Move the rule into the always-on gate (a check or test that fails on the _first_ new instance) and retire the standard table: the standard was the transition, the gate is the law. This journey — detector, falling ceiling, permanent ban — is this skill's [outlaw-a-pattern.md](outlaw-a-pattern.md) procedure, when what you're driving to zero is a pattern in the code. A floor (coverage) usually has no end state; it just holds, rising as the project improves.

---

## Done when

- the metric is **defendable** — deterministic, cheap, meaningful, and the user agreed to be blocked on it;
- the `[standards.<name>]` table is wired with the number **sorted** (invariant, rate, or growing total — with `per` and `margin` to match, step 2) and the **limit set at today's value** on `main`;
- `discern standards` passes, the failure path has been seen to fire once, and what the number stands for is written down;
- the never-loosen rule and the end state (tighten over time; at zero, move a ceiling into the gate) are understood — and nothing in the change loosens any _existing_ standard.
