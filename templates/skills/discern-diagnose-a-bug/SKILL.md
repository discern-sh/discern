---
name: discern-diagnose-a-bug
description: Diagnose a bug before fixing it — reproduce the failure, run a falsifying hypothesis loop, and prove the cause instead of patching a plausible guess. Use when investigating any bug, failure, or odd behaviour whose cause isn't proven yet, when a previous fix didn't hold, or when asked "why is this happening?", "what's causing this?", or to "look into" a defect. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Diagnose before you fix

The most expensive way to debug is to guess: change something plausible and see whether the symptom goes away. When it does, you've learned almost nothing — a symptom can vanish for the wrong reason (masked by a retry, shifted timing, an unrelated side effect) while the real defect ships on. This skill makes the cause **proven** before any fix is written: reproduce the failure on demand, run experiments designed to *falsify* your hypotheses, demonstrate cause and effect, and separate the incident-specific causal chain from the generative mechanism that could produce siblings — then hand both to the `discern-cure-a-bug` skill.

Diagnosis and treatment stay separate on purpose. The moment you catch yourself "trying a fix to see if it helps," you have stopped diagnosing and started guessing.

---

## 1. Reproduce it first

A failure you can't reproduce is a failure you can't prove fixed. Before theorising, get it happening on demand: **one runnable command** — a test, a script, a request — that fails now and will pass when the defect is gone. Record the command; it is the anchor for everything that follows, and later it becomes the regression test.

If you can't reproduce it, *that* is the investigation: vary the inputs, environment, ordering, and timing the report implies until it fires. What the failure needs in order to appear is your first hard evidence about the cause. Don't skip ahead — a diagnosis without a reproduction is a hypothesis with no way to test it.

---

## 2. Shrink the reproduction

Minimize while it still fails: fewer inputs, less configuration, a shorter path to the failure. Every element you remove without losing the failure is a suspect eliminated for free — the smaller the reproduction, the fewer places the cause can hide. Stop shrinking when removals start costing more than they rule out.

Do not confuse a minimal reproduction with the boundary of the defect class. Shrinking identifies what this incident needs; it does not prove where else the same mechanism can exist. Record which details proved **necessary**, which proved **incidental**, and which remain **untested** so the cure does not inherit the reproduction's names and boundaries as if they defined the class.

---

## 3. Run a hypothesis loop, not a fix loop

Work in explicit rounds, and keep a written trail:

1. **State a hypothesis** precisely enough to be falsified — "the cache returns a stale entry when X expires mid-request," not "something's wrong with the cache."
2. **Derive a prediction**: if this hypothesis is true, observation O must show it — a log line, an assertion, a debugger value, a variant of the minimized input that should flip the outcome.
3. **Run the cheapest experiment that could prove the hypothesis wrong.** Change one variable at a time; an experiment that varies two things rules out neither.
4. **Write down what got ruled out**, then loop.

The written trail is what prevents circular debugging — re-testing yesterday's guess because nobody recorded that it already failed. And keep the experiments *observations*, not fixes: an experiment shaped like a fix conflates diagnosis with treatment, and a disappearing symptom is not a confirmed cause.

Keep at least one live competing hypothesis until an experiment distinguishes it from the leader. The first explanation that fits the evidence often names a local participant while missing the more general mechanism that made its behaviour dangerous.

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

### Name every level of the causal chain

Before declaring the cause proven, distinguish:

- the **trigger** — the event or condition that exposes the failure;
- the **proximal mechanism** — the immediate sequence that produces the observed effect;
- the **enabling conditions** — the design or state that makes that sequence possible;
- the **generative mechanism** — the name-independent rule describing how the same defect could arise in a different context.

Do not stop at a statement whose subject is only the component first observed. Remove incident-specific names and ask whether the causal claim still identifies a checkable mechanism. If it does not, the diagnosis may explain this occurrence without yet providing a sound seed for the defect class.

Causal proof and scope proof are different: the forward/backward experiment proves why this incident happens; the cure workflow must still enumerate everywhere the generative mechanism exists or could be reintroduced. Preserve that distinction in the handoff.

---

## 6. Hand over to the cure

Hand over two falsifiable statements with the reproduction command attached:

1. **Incident diagnosis:** *specific cause → proximal mechanism → observed effect*.
2. **Class-predicate seed:** *whenever the name-independent enabling conditions hold, the generative mechanism can produce this failure*.

Include the necessary, incidental, and untested details from the minimized reproduction. The cure workflow decides the final class boundary and enumerates it, but it must not have to infer which parts of the diagnosis were merely names or circumstances of the first occurrence.

If the defect genuinely is a one-off — a lone typo with no siblings and no pattern — say so explicitly, fix it, and still keep the reproduction as a permanent regression test. That claim ("a singleton") is part of the diagnosis, and the cure skill's enumeration step is how it gets checked rather than assumed.

---

## Done when

- the failure **reproduces on demand** via a recorded command;
- hypotheses were tested by **falsifying experiments**, one variable at a time, with the ruled-out trail written down;
- the cause is **demonstrated both directions** — condition present → failure appears; only that condition changed → failure gone;
- the trigger, proximal mechanism, enabling conditions, and generative mechanism are stated separately;
- necessary, incidental, and untested reproduction details are recorded;
- the diagnosis is handed to `discern-cure-a-bug` as both an incident diagnosis and a name-independent class-predicate seed (or the one-off claim is stated explicitly, with the reproduction kept as a regression test).
