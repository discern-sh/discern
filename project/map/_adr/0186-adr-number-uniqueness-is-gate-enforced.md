# ADR 0186: ADR number uniqueness is gate-enforced, with an in-flight collision scan

**Status**: accepted

## Context

The record discipline allocates numbers at authoring time: list `_adr/`, take the highest number, add one. In the worktree workflow that allocation happens in isolation — so two in-flight efforts that each write an ADR both pick the same next number. The resulting records are different files with different slugs. Nothing in the machinery could see that state:

- The fleet collision scan is **path-keyed** — it intersects the fork diffs' changed paths, and two records sharing a number never share a path.
- The merge is clean. `discern update` brings the first-landed record into the second effort's tree without a conflict, and `discern done` passed with both `0184-*.md` files sitting side by side.
- The only safeguard was the convention "whoever lands second renumbers," recorded nowhere a tool could act on it.

July 2026 made the race concrete: two parallel unlanded branches each carried an ADR numbered 0184, with more efforts in flight around them. A number that gets cited — in commit messages, code comments, map pages — becomes costlier to renumber the longer the duplicate lives, so the defect wants catching at two moments: the instant both claims exist anywhere (advisory), and the instant both records reach one tree (hard).

## Decision

**The gate holds ADR-number uniqueness tree-wide, and status warns number-keyed while the collision is still in flight.**

- `discern done` runs an `adr_numbers` precondition beside the other shipped-artifact checks: a number claimed by more than one record file anywhere under the map's `_adr/` tree — `_superseded/` included, because a retired record keeps its number — fails the gate with a diagnostic naming each contested number and its claimants. The check is **tree-wide, not branch-relative**: a duplicate is wrong wherever it came from, and any branch can carry the renumber. It fires at exactly the right moment — the first `done` after `discern update` brings the rival record in — and makes the landed duplicate impossible.
- `discern status` scans every `[repository].branch_prefix` branch — worktree-backed and unlanded alike, since the second claimant is often a parked branch with no worktree — for record files their fork diffs **add**, groups them by number, and surfaces contested numbers as `data.adr_collisions` with one advisory hint. The fleet view carries every contested number; a worktree's local view carries only the collisions its own branch is party to. Each branch costs one merge-base plus one pathspec-scoped diff.
- One module (`src/lib/adr_numbers.ts`) defines what counts as a record file and how its number reads; both consumers share it, so they cannot drift on the definition.
- The bundled write-adr skill tells authors the picked number may be contested in flight and that whoever lands second takes the next free number — no fighting for a specific one.

## Consequences

- "Second lander renumbers" is now a mechanism, not a memory: update brings the rival record in, `done` refuses, the diagnostic says which files are in contention and what to do.
- The advisory scan shortens the expensive window — a renumber before anything cites the number is a file rename; the hint fires while that is still true.
- A project adopting discern with historical duplicate numbers is blocked at its first gate run until it renumbers once. Deliberate: the discipline ships as "a number identifies one decision forever," and a tree violating it should not pass.
- The gate pays one directory walk of `_adr/` per run; status pays a scoped diff per in-flight branch. Projects without an `_adr/` tree pay a single failed stat.
- The in-flight scan cannot see a collision with a record that landed on the trunk after a branch forked; the gate's tree-wide check covers that case on the branch's next update.

## Alternatives considered

- **Extend the path-keyed fleet collision scan.** Rejected: it can never intersect two different filenames. Number-keying is the point — this is an instance of the "same logical resource, different path" class the path scan is structurally blind to.
- **Central number reservation** — an index entry or counter file every new record must touch, making the collision a textual merge conflict. Rejected: it turns every pair of concurrent ADRs into a guaranteed conflict to hand-resolve, moves allocation into merge machinery, and still needs a tree-level guard for the hand-edited case.
- **A branch-relative check** (fail only duplicates the branch introduced, never-loosen style). Rejected: it lets a duplicate that reaches the trunk persist forever. Tree-wide with a clear renumber remedy keeps the invariant honest everywhere.
- **Advisory only, no gate stage.** Rejected: a hint can be missed; the invariant the discipline promises ("never reuse a number") deserves the same enforcement as every other shipped-artifact precondition.
