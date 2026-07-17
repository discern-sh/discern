# ADR 0049: Ship the fix-the-class discipline as built-in guidance and a bundled skill

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current pointers use `ratchets` → `standards`, `finish` → `done`, `docs` → `map` where it names the command, config, or tree, the retired product-category wording → `discern`, the gate, or the bar; the decision and reasoning are unchanged.

**Status**: accepted

> **Renamed** — the `fix-a-bug-class` skill this ADR introduces ships as `discern-cure-a-bug` since [ADR 0087](0087-prefix-and-expand-bundled-skills.md), which prefixed and expanded the bundled skill set. The discipline is unchanged.

## Context

The dominant failure mode in agent-driven development is narrow. An agent fixes the _one_ instance of a defect in front of it, declares it fixed "at the root cause," and moves on. But its search missed the sibling instances of the same defect class, so the class resurfaces elsewhere later. The instance dies — the class lives on. The cure is a discipline, not a reminder. Characterize the whole class as a checkable predicate, ship an executable detector that fails on _every_ member, fix to green, and leave that detector in the gate forever. The detector — not prose — is what lets "done" mean the whole class cannot return unnoticed, not that you patched the one case in front of you.

discern already ships disciplines to every project it scaffolds: the quality gate, the worktree workflow, the map/ADR habit, and two bundled skills (`document-subsystem`, `write-adr`). But everything in the _built-in_ guidance under `templates/guidance/` so far describes how to operate discern itself — the gate, standards, worktrees. A general development discipline that is not about discern's own mechanics had never been part of the always-on surface. This decision answers a question of scope. **Does a universal engineering discipline belong in discern's built-in guidance, on by default for every project — or is that overreach for a stack-neutral development system?**

Three facts make the scope call:

- **The discipline is universal and stack-neutral.** "Name the class as a predicate, guard it with a detector" holds in any language, any domain, for any agent. It names nothing about a stack, so it does not strain the stay-stack-neutral principle the way a hardcoded test runner would.
- **It is the executable form of principles discern already holds.** "Make regression impossible — every fix carries a guard" and "drive checks off a single source of truth, never a hand-copied list" are already how this repo works. The discipline is those principles applied to bug-fixing, so shipping it is consistent with — not a departure from — the existing [design principles](../00-orientation/design-principles.md).
- **discern consumes its own distribution surface.** Whatever lands in `templates/guidance/` and `templates/skills/` reaches this repo's own agents through the compile step. A norm worth holding ourselves to is a norm worth shipping, and the reverse — the self-host principle makes the two inseparable.

## Decision

**The fix-the-class discipline ships as built-in, always-on guidance plus a bundled skill — the same default-on footprint every discern project receives.**

- **A short norm in the core built-in guidance.** `templates/guidance/base.md` carries a "Fix the class, not the instance" section, placed with the other always-on working norms and compiled into every agent file (`AGENTS.md`, imported by `CLAUDE.md`/`GEMINI.md`). It states the expectation in a few lines and points at the skill for the procedure — the norm sets the bar, the skill carries the substance.
- **A bundled skill, `fix-a-bug-class`.** A new built-in under `templates/skills/` walks the full procedure: name the class as a predicate, write the detector first, drive it off the single source of truth, enumerate by structure not text, fix to green, then leave the detector in the gate and report the residual scope. It triggers on any bug fix and on a request to fix something at the root cause, everywhere, or for good.
- **No gate-level enforcement.** discern does _not_ add a check that fails when a fix lacks a class-detector. No automated check can tell a class-detector from an ordinary single-instance test, so such a gate would be either trivially satisfied or wrong. Always-on guidance and an on-demand skill carry the discipline — the same way discern carries the map/ADR habit — not a new gate stage.
- **The bundled skills are themselves guarded by the discipline.** A class-level fitness test (`tests/skills_wellformed_test.ts`) iterates _every_ directory under `templates/skills/` — via `bundledSkillNames()`, the canonical set the skills system already drives off — and asserts each is a well-formed skill: a `SKILL.md` whose frontmatter parses (through the one shared `parseSkillFrontmatter` reader), with a non-empty `name`/`description` and a `name` equal to its directory. This is the discipline dogfooding itself — the guard is a class-detector over the bundled-skill class, so a new or malformed skill auto-enrolls and fails the gate rather than shipping broken.

## Consequences

- **Precedent: built-in guidance may carry a universal discipline, not only discern's own mechanics.** This is the first always-on norm about _how to work_ rather than _how to drive discern_. The bar it sets for future additions: a candidate must be stack-neutral, universal across domains, and consistent with the design principles — and it earns the always-on slot only if it clears that bar. A stack-specific or domain-specific habit does not; it belongs in a project's own `guidance.md`, never the bundled surface.
- **Every project's agents read the norm by default.** It costs a few lines in every compiled agent file. That is the intended price of a default-on discipline; a project that disagrees can shorten its own guidance but cannot drop the built-in section without turning the `guidance` feature off — the same trade every bundled-guidance section carries.
- **One more bundled skill to keep generic and well-formed.** `fix-a-bug-class` joins the distribution surface, so it must stay domain-neutral like the rest of `templates/`. The new guard makes part of that enforceable (structure, naming); domain-neutrality itself stays a review concern, as it is for the rest of `templates/`.
- **Removing it later is a distribution-surface change, not a local edit.** Like the skill removal in [ADR 0046](_superseded/0046-graduate-destination-and-skill-removal.md), pulling the norm or skill back out would change what every project receives on its next upgrade — which is exactly why recording the decision to add it is worth an ADR.

## Alternatives considered

- **Project-local guidance only — put it in this repo's `project/guidance.md`, not the bundled surface.** Rejected: it would hold only this repo to the discipline and leave every scaffolded project without it, when the whole point is that the failure mode is universal to agent-driven development. The discipline's value scales with reach.
- **Ship the skill but not the always-on norm.** Rejected: a skill is opt-in — it fires when its trigger phrases match. The instance-fixing failure happens precisely when the agent _doesn't_ think to reach for a bug-class skill. The always-on norm puts the expectation in front of the agent on every bug, with the skill as the deeper procedure behind it.
- **Gate-level enforcement — fail `done` when a fix lands without a new class-detector.** Rejected as out of scope and likely not feasible: no automated check separates a class-detector from a single-instance test, so the check would misfire on most fixes, or any test at all would satisfy it. The norm-plus-skill approach matches how discern already ships its other disciplines.
