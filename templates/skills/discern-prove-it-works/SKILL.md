---
name: discern-prove-it-works
description: Prove a change works before calling it done — restate the ask as observable outcomes, exercise the real running artifact along the paths the change enables, and report an evidence dossier of what ran, what was seen, and what remains unverified. Use before claiming any feature, fix, or change complete, when the user asks "does it actually work?", "did you test it?", or to verify, demo, or confirm a change for real, or whenever a green gate is about to be offered as proof that a feature behaves. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Prove it works — earn the "done" before you claim it

The gate proves the tree is mechanically sound: it builds, it lints, the tests pass. It cannot prove the change *does what was asked* — a green gate will happily bless a feature that is stubbed out behind the demo path, wired to nothing, or correct only for the one input used while building it. Claiming "done" on the gate alone converts unfinished work into a confident claim, and the confidence is what makes it expensive: nobody re-checks work that says it works.

This skill makes "done" an **earned** claim. Restate the ask as observable outcomes, exercise the real artifact — not a proxy — along the paths the change enables, hunt the known ways "done" lies, and report an evidence dossier: what you ran, what you saw, what remains unverified. The gate is the mechanical bar for done; this is the semantic one. A change is done when it clears both.

---

## 1. Restate the ask as observable outcomes

Before running anything, write down what "works" would mean to the person who asked: the concrete behaviours the change was supposed to produce, each stated as an observation someone could make from outside the code — "doing X now produces Y", never "the logic is correct". If the work was shaped up front (`discern-shape-the-work`), the acceptance criteria *are* this list, already written; hold yourself to those, not to a friendlier rewording. An outcome you cannot state as an observation is a shaping gap — surface it to the user rather than proving something nobody asked for.

## 2. Exercise the real artifact, not a proxy

Tests are proxies — indispensable, but they check the pieces the author thought to check, through the seams the author chose. To prove the change, run the thing itself the way its user would: launch the program, invoke the command, call the interface, feed the pipeline — whatever form this project's artifact takes. Find the project's own way of running it (its documentation, its task runner, its Project Scripts) rather than inventing one.

If the artifact genuinely cannot be exercised where you are — it needs credentials you don't hold, hardware you don't have, a paid third party — say so **as the dossier's headline, not a footnote**: name exactly what could not be run, what it would take, and what the user must therefore verify by hand. An honest "unverifiable here" preserves the trust a quiet skip destroys.

## 3. Walk each outcome and record what you saw

For each outcome from step 1, perform the action and capture the observation: the exact command or interaction, and the output, response, or state change that came back. The discipline is first-person and past-tense — *"I ran X and observed Y"* — because everything else is prediction dressed as evidence. "The code should now…", "this will…", "the test covers…" are claims about the future, and futures don't go in a dossier. One honest observation outranks any amount of reasoning about what the code ought to do.

## 4. Probe just off the happy path

Stubbed and half-wired work reveals itself one step from the demo. So after each outcome's primary path, take a few deliberate steps off it: **repeat** the action (does it hold, or did the first run leave state the second trips over?); feed it **nothing and garbage** (does it fail *well* — a clear message rather than a crash or a silent wrong answer?); **restart** whatever holds state (does the change survive, or did it live only in memory?). These probes cost minutes each, and they are where "works" most often turns out to mean "worked once, for me, just now."

## 5. Hunt the unearned-done signatures

Some failure shapes recur in every domain — check each one deliberately, because they are precisely the ones a green gate and a happy-path demo both miss:

- **The stub behind the demo** — the primary path works; the branches beside it are placeholders, hardcoded values, or TODOs.
- **The orphaned change** — the new code is written, tested, green, and nothing in the running system actually reaches it.
- **The test-shaped truth** — it works for the exact data, fixture, or mock used while building it, and for nothing adjacent.
- **The untriggered error path** — failure handling exists and has never once fired; cause a real failure and watch it actually handle.
- **The local-only pass** — it works because of something on this machine: an environment variable, seeded data, a cached artifact a fresh install won't have.
- **The one-run wonder** — it works exactly once; repetition or restart breaks it.

Finding one is not a verdict on the work — it is the proof doing its job. Fix it, or report it; never sand it off the dossier.

## 6. Report the dossier — verdicts and residual

Close with the evidence dossier, one line per outcome: the action performed, the observation, and a verdict — **verified** (ran it, saw it), **failed** (ran it, saw otherwise — with what you saw), or **unverifiable here** (with what it would take). Then the residual: what this proof does *not* cover — paths not walked, states not reachable from here. "Verified A and B by running them and observing the results; C is unverifiable without live credentials and needs a manual check" is a claim the user can act on. "It works" is not.

---

## Done when

- every asked-for outcome is stated as an **observation someone could make from outside the code**, held to the original ask (or the shaped acceptance criteria) rather than a friendlier rewording;
- the **real artifact was exercised** along each outcome's path and just off it — or its unverifiability here is the dossier's headline, with what it would take spelled out;
- every claim in the dossier is **first-person and past-tense** — an action performed and a result observed, never a prediction about what the code should do;
- the **unearned-done signatures were hunted** deliberately, and anything found was fixed or reported — never omitted;
- the dossier pairs **verdicts with a residual** — what was proven, what failed, what remains for the user to check — so "it works" is a checkable claim, not a feeling.
