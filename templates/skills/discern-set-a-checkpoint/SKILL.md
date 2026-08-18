---
name: discern-set-a-checkpoint
description: Set a checkpoint — a change-triggered judgment stop. A deterministic trigger serves a written criterion the agent judges and records before the gate runs. Decide whether the rule belongs here on the placement ladder, choose the trigger and the stop or advise mode, write a short criterion with a real unmet answer, wire it as [checkpoints.<id>] in discern.toml, and review its economics later. Use when the user wants changes to certain files reviewed or questioned before landing ("make agents check X", "flag risky changes to Y"), when a reviewer keeps raising the same non-mechanical point, when enabling or tuning the built-in checkpoints, or when one fires too often, never, or lands under frequent variances. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Set a checkpoint

A checkpoint is a change-triggered judgment stop: a deterministic **trigger** chooses the moment a diff makes a question relevant, and a written **criterion** puts that question to the agent at `discern done`, before any gate job runs. The agent records the conclusion — met, or unmet with a short rationale — and the record travels with the Proof as agent judgment, kept apart from machine-verified results. discern never verifies the conclusion's truth and never calls a model: the trigger is mechanical, the judgment is the agent's, and the record is what the owner reviews.

This skill is the judgement around the feature: whether a rule belongs here at all, how to choose the trigger and mode, how to write a criterion an agent can answer truthfully, and what to do with the record once real efforts have met it.

---

## 1. Does it belong here? The placement ladder

Every quality rule has a cheapest rung that still catches its violations:

> prose an agent needs while shaping most decisions → the instructions; a recurring method worth a playbook → a skill; a judgment catchable as a narrow change completes → a checkpoint; a rule a machine can decide → a gate job or a standard; a decision only the owner may make → consent or a recorded grant

A checkpoint earns the middle rung when three things hold:

- **A diff introduces the violation.** "This deletion may cut something live" arrives with a change. "The docs have gone stale" accrues over time and belongs to estate review (`discern improvement`) instead of a trigger.
- **No machine can decide it.** If a script could print pass or fail, wire a gate job or a standard; `discern-set-the-standard` holds that procedure, including the outlaw path that drives a pattern to zero.
- **A good reviewer would raise it** often enough to justify stopping every matching change. That is the scarcity bar: a `stop` checkpoint taxes each matching change with a required judgment, and twenty active stops is the failure mode. Heuristic patterns — a wide diff, a deletion-heavy change — belong in `advise` mode, which serves the criterion without blocking anything.

## 2. Choose the trigger

Triggers are deterministic and closed. A small menu, no expression language:

- `scope = "<name>"` or `paths = [globs]` — one selector chooses the matched set. Prefer a configured scope, or a live path reference such as `${map.dir}`, over repeating globs the config already knows.
- `unless_changed = [globs or scope]` — hold fire when the counterpart moved too ("flag a code change unless the docs moved with it").
- `min_changed_files = N` — fire only at real breadth, so a one-line touch stays quiet.
- `deletion_dominant = true` — removals clearly outweigh additions.
- `similar_new_file = true` — a new file whose name closely resembles a sibling, the signature of a parallel implementation.

Narrow beats broad: a trigger that fires on most changes turns its criterion into wallpaper. When the menu cannot express the condition, use the escape hatch in step 6.

Calibrate thresholds by replay, not intuition. Recent landed work already shows how this project changes: enumerate it with `git log --first-parent --merges -n 40 --format='%H'`, and for each merge diff its parents (`git diff --name-only <sha>^1...<sha>^2`) to count how often the candidate trigger would have fired. A `stop` that would have fired on most efforts is mis-calibrated before it ships; generated artifacts committed alongside a change inflate breadth counts, so a repo with heavy codegen usually wants higher file thresholds than the shipped defaults.

## 3. Write the criterion

The criterion is served verbatim to a capable agent mid-task, on the refusal, the previews, and `discern checkpoints`. Write it in second person, present tense, a few sentences:

- Ask a judgeable question about the matched change — "is every cut proven dead, with no remaining callers, references, or configuration reaching it?" — and skip general exhortations to be careful.
- Make unmet a real answer. A criterion no honest reading could ever conclude unmet is decoration; one that is unmet on every firing marks a trigger aimed too wide.
- Put "why this matters and what good looks like" in the optional `teach` field, and keep the criterion itself short.
- Include no secrets and no content you would not show on every future refusal and report.

## 4. Wire it in `discern.toml`

```toml
[checkpoints.migration-safety]
paths = ["migrations/**"]
criterion = """
A migration states what it locks and how it rolls back. If it cannot run
online, the commit body says so and names the maintenance window.
"""
```

`mode = "stop"` is the default: `discern done` refuses before any gate job until the agent declares the criterion met (`--met <id>`) or unmet with a rationale (`--unmet <id> --why "<rationale>"`). `mode = "advise"` delivers the criterion through the advisory channel and blocks nothing. A declared-unmet conclusion still gates the landing: the owner authorizes each named variance at `discern accept --confirmed --variance <id>`, in the current conversation. A variance is never yours to authorize — recorded grants do not cover one.

A shipped built-in is enabled by referencing its id alone (`[checkpoints.docs-drift]`); any field you set overrides the seed, and overriding `criterion` replaces the shipped judgment with your own authored prose.

**The trunk governs.** An effort's checkpoints come from the configuration at its merge-base with the trunk, so this entry governs new efforts once the change lands. Editing checkpoint tables inside a feature branch changes nothing for that branch's own gate; wire a checkpoint as its own owner-reviewed change.

## 5. Verify it governs

Prove the wiring live, detector-style:

- After the entry reaches the trunk, run `discern checkpoints` there: the entry appears in the governing table with its criterion, trigger summary, and mode.
- In a worktree with a matching change, `discern done --dry-run` previews the firing ("a declared conclusion will be required at done"), and `discern prepare` serves the criterion early. For a `stop` entry, a bare `discern done` refuses with the criterion and both recoveries — read that refusal once yourself, because it is the surface every future agent meets.

## 6. The escape hatch: `when`

For a condition the structured fields cannot express, `when = "<command>"` delegates the firing decision to a script kept in the repo: exit 0 fires, exit 1 passes, and any other exit or a timeout fails open — no fire, with an advisory recorded. Print `DISCERN_MATCH <path>` lines to declare which paths the judgment covers; without them the subject is the whole matched set, which reopens more coarsely after edits. Selectors still pre-scope the diff. Keep the probe fast (the budget is 10 seconds), deterministic, and free of side effects. One v1 boundary to know: the trunk governs the command text, while the command runs in the candidate worktree, so the scripts and interpreters it references resolve from that worktree.

## 7. Review the economics later

A checkpoint is a hypothesis about where review attention pays. Come back after real efforts have met it:

- `discern checkpoints` reports observed history per checkpoint: fires per effort, declared met and unmet shares, variances, time to declare.
- `discern patterns` raises the hygiene advisories: a dead checkpoint (never fires — likely mis-scoped), a noisy one (fires on most efforts), a frequently varied one (often lands under owner variance).
- Frequent variance points at the rule: tighten the trigger, rewrite the criterion, soften to advise, or delete the entry. The counts justify a review; declarations are the agent's recorded judgment, and none of these numbers grades an agent.
- When the criterion becomes mechanically decidable, move it down the ladder: the `discern-set-the-standard` outlaw procedure turns it into a measured ceiling, then a permanent gate rule.

Relay the wiring with the facts intact:

> Checkpoint <id> is wired: <trigger>, <mode>. It governs new efforts once the change lands on <trunk>. Review its economics later with <command>.

---

## Done when

- the rule sits on its cheapest rung — a diff introduces its violations, no machine can decide it, and a good reviewer would raise it often enough to stop for;
- the trigger is deterministic and narrow, and the mode matches the bar (`stop` for a question every matching change must answer, `advise` for heuristics);
- the criterion is a short, judgeable question with a real unmet answer, a `teach` where it helps, and no secrets;
- the entry is committed for the trunk, and `discern checkpoints` lists it in the governing table;
- the later economics review is a noted follow-up with the tuning levers understood — and a variance stays the owner's decision, never part of the wiring.
