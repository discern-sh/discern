---
name: discern-diagnose-a-bug
description: Diagnose a bug before fixing it — reproduce the failure, run a falsifying hypothesis loop, and prove the cause instead of patching a plausible guess. Use when investigating any bug, failure, or odd behaviour whose cause isn't proven yet, when a previous fix didn't hold, or when asked "why is this happening?", "what's causing this?", or to "look into" a defect. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Diagnose before you fix

The most expensive way to debug is to guess: change something plausible and see whether the symptom goes away. When it does, you've learned almost nothing — a symptom can vanish for the wrong reason (masked by a retry, shifted timing, an unrelated side effect) while the real defect ships on. This skill makes the cause **proven** before any fix is written: reproduce the failure on demand, run experiments designed to *falsify* your hypotheses, and demonstrate cause and effect — then hand the proven defect to the `discern-cure-a-bug` skill to eliminate it everywhere, permanently.

Diagnosis and treatment stay separate on purpose. The moment you catch yourself "trying a fix to see if it helps," you have stopped diagnosing and started guessing.

---

## 1. Reproduce it first

A failure you can't reproduce is a failure you can't prove fixed. Before theorising, get it happening on demand: **one runnable command** — a test, a script, a request — that fails now and will pass when the defect is gone. Record the command; it is the anchor for everything that follows, and later it becomes the regression test.

If you can't reproduce it, *that* is the investigation: vary the inputs, environment, ordering, and timing the report implies until it fires. What the failure needs in order to appear is your first hard evidence about the cause. Don't skip ahead — a diagnosis without a reproduction is a hypothesis with no way to test it.

---

## 2. Shrink the reproduction

Minimize while it still fails: fewer inputs, less configuration, a shorter path to the failure. Every element you remove without losing the failure is a suspect eliminated for free — the smaller the reproduction, the fewer places the cause can hide. Stop shrinking when removals start costing more than they rule out.

---

## 3. Run a hypothesis loop, not a fix loop

Work in explicit rounds, and keep a written trail:

1. **State a hypothesis** precisely enough to be falsified — "the cache returns a stale entry when X expires mid-request," not "something's wrong with the cache."
2. **Derive a prediction**: if this hypothesis is true, observation O must show it — a log line, an assertion, a debugger value, a variant of the minimized input that should flip the outcome.
3. **Run the cheapest experiment that could prove the hypothesis wrong.** Change one variable at a time; an experiment that varies two things rules out neither.
4. **Write down what got ruled out**, then loop.

The written trail is what prevents circular debugging — re-testing yesterday's guess because nobody recorded that it already failed. And keep the experiments *observations*, not fixes: an experiment shaped like a fix conflates diagnosis with treatment, and a disappearing symptom is not a confirmed cause.

---

## 4. Interrogate the history, not just the code

The defect got in somehow, and the project's history usually knows where:

- **`git log`** the failing area — what changed most recently, and did the failure start then?
- **`git bisect`**, with your reproduction command as the oracle, when pinpointing the introducing commit would settle the cause.
- **Co-change coupling** — ask which files have historically changed *together* with your suspect (the `discern_coupling` MCP tool, or `discern coupling <file>` on the CLI). A habitual partner that was *not* updated in a recent change is a classic cause: the half-applied change. Treat partners as leads to check, not verdicts.

---

## 5. Prove the cause — both directions

You are done diagnosing when you can demonstrate the mechanism, not merely narrate it:

- **Forward**: the minimal condition you identified produces the failure, on demand.
- **Backward**: with only that condition changed, the same reproduction passes.

If you can argue the cause is *plausible* but can't demonstrate both directions, you still hold a hypothesis — return to step 3. Beware the stopping-early trap: the first anomaly you find is often a co-symptom, not the cause. Ask "what causes *that*?" until the answer is a decision in code, not another symptom.

---

## 6. Hand over to the cure

State the diagnosis in one falsifiable sentence — *cause → mechanism → observed effect* — with the reproduction command attached. Then don't stop at the one instance: the proven cause is the seed of a class predicate ("every place that does X without Z"), and eliminating the class is the `discern-cure-a-bug` skill's job — continue there.

If the defect genuinely is a one-off — a lone typo with no siblings and no pattern — say so explicitly, fix it, and still keep the reproduction as a permanent regression test. That claim ("a singleton") is part of the diagnosis, and the cure skill's enumeration step is how it gets checked rather than assumed.

---

## Done when

- the failure **reproduces on demand** via a recorded command;
- hypotheses were tested by **falsifying experiments**, one variable at a time, with the ruled-out trail written down;
- the cause is **demonstrated both directions** — condition present → failure appears; only that condition changed → failure gone;
- the diagnosis is handed to `discern-cure-a-bug` as a class predicate seed (or the one-off claim is stated explicitly, with the reproduction kept as a regression test).
