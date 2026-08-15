# ADR 0001: Adopt discern as the engineering practice

**Status**: accepted

## Context

<!-- setup fills this -->

<!--
  Completed by the agent that configured discern into this project. Replace
  this comment block with the real context, in a few honest sentences:

  - How quality was held before: the checks, review habits, and conventions
    that existed — and where they lived (a CI config, people's heads,
    scattered docs).
  - What made enforcement worth adopting now. For many projects it is that
    more of the work now flows through coding agents, so consistency has to
    come from the system rather than from anyone's vigilance.

  Stay specific to this project. A reader should feel why "carry on as we
  were" stopped being good enough.
-->

## Decision

This project adopts [discern](https://discern.sh) as its engineering practice. Three standing rules come into force with it:

- **"Done" means the gate passed.** No change is finished on anyone's word: `discern done` must run green on the final tree, and what it checks is wired into `discern.toml` for anyone to read.
- **Work happens in isolated worktrees.** Each effort gets its own linked worktree and branch; nothing lands on the trunk until its gate passes, so parallel work cannot trample the mainline or each other.
- **Significant decisions are recorded.** Choices that are hard to reverse and surprising without context are written down in this directory, so the reasoning survives the people and sessions that produced it. This record is itself the first of them — seeded by discern when the practice was adopted, then completed by the agent that configured it into this project. Every record after it is written the ordinary way, starting from [the template](0000-template.md).

<!-- setup fills this -->

<!--
  Replace this comment block with a short paragraph naming what the gate
  actually runs in this project — the real jobs wired into `discern.toml`
  during setup (the build, the checks, the test suite) — so a reader of this
  record knows concretely what "done" verifies and catches.
-->

## Consequences

Good and bad, stated plainly — a record that lists only upsides is not trustworthy:

- **Finishing gets stricter.** A change is complete when the gate says so, which is slower than declaring victory and firmer than habit. That is the trade: friction at the finish line, regressions caught before they land.
- **Some files stop being hand-editable.** The agent instruction files (`AGENTS.md`, `CLAUDE.md`, …) are compiled from authored sources; edits to the compiled copies are overwritten. Changes go to the source, which is recompiled for every agent at once.
- **The project commits to upkeep.** The map — the maintained account of how this codebase fits together — must stay current with the code, and a stale page is treated as a defect. Quality limits, once set, only tighten; a change cannot pass by quietly loosening one.
- **A tool joins the development loop.** discern runs in every working session and the project depends on it to enforce all of the above. It can be removed, but the rules above stop being enforced the moment it goes.
- **What becomes easy:** parallel efforts stop colliding, "is this actually done?" has one answer, and future sessions inherit the project's reasoning from the map and these records instead of re-deriving it.

<!-- setup fills this -->

<!--
  Add one to three consequences specific to this project — for example, what
  the gate's runtime means for iteration speed here, or which existing habit
  this changes the most. Then delete this comment block.
-->
