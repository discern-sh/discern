---
title: Checkpoints
description: Change-triggered judgment stops — a deterministic trigger serves a criterion, the agent records a conclusion, and the Proof carries it as agent evidence.
order: 30
aliases:
  - checkpoints guide
  - judgment stop
  - stop checkpoint
  - advise checkpoint
  - checkpoint criterion
  - checkpoint subject
  - checkpoint policy
  - owner variance
  - built-in checkpoints
  - when command
  - DISCERN_MATCH
  - awaiting_declaration
  - awaiting_variance
---

# Checkpoints

_A checkpoint serves a judgment at the moment a change makes it relevant, and the Gate records the answer._

A [checkpoint](../00-orientation/glossary.md#checkpoint) is one configured rule under `[checkpoints]`: a deterministic trigger paired with a [criterion](../00-orientation/glossary.md#criterion), the judgment prose the agent evaluates against the matched change. Machine checks decide what a machine can decide; a checkpoint carries a question that still needs judgment — is this documentation worth its reading time, is this large cut proven safe, does a change in a risky region state what could break? discern verifies that the required conclusion exists and never verifies its truth. Every surface reports the answer as [declared met](../00-orientation/glossary.md#declared-met) or [declared unmet](../00-orientation/glossary.md#declared-unmet), kept apart from verified machine results and from owner authority.

## What happens at the gate

When a fired [`stop`](../00-orientation/glossary.md#stop--advise) checkpoint awaits a conclusion, `discern done` refuses before any gate job with `error: "awaiting_declaration"`, batching every awaiting criterion with its matched paths in one refusal. No gate job ran and the project tree is unchanged; the [episode](../00-orientation/glossary.md#episode) record and a logbook line are the writes. The refusal names both recoveries:

- `discern done --met <id>` (repeatable) records that the criterion is satisfied for the current subject.
- `discern done --unmet <id> --why "<rationale>"` (one per invocation) records that it is not.

A declaring invocation records every valid conclusion first, then continues into the gate in the same run. An `advise` checkpoint serves its criterion and evidence through the advisory channel and blocks nothing; its firings are still recorded for the observed economics. The criteria arrive early: `discern prepare` and `discern status` preview each coming `stop` [declaration](../00-orientation/glossary.md#declaration) while the change is hot, and `discern done --dry-run` previews the same plan without refusing.

## Three kinds of evidence

| Evidence                | Source                  | Claim                                                    |
| ----------------------- | ----------------------- | -------------------------------------------------------- |
| Gate results, Standards | Machine                 | These checks passed.                                     |
| Declarations            | Agent                   | The agent judged each criterion met or unmet.            |
| Landing authority       | Owner or recorded grant | This work may land, with any named variances authorized. |

The Proof renders declared conclusions separately from machine results, carries unmet rationales and the policy identity, and states when a decision is still open — a proof line carries `1 declared unmet — owner variance required to land`. Acceptance consumes the Proof and resolves the third row. The vocabulary stays disjoint: machine results are verified, conclusions are declared, and variances are authorized.

## Subjects and reopening

A fired `stop` checkpoint opens an effort-scoped episode in the worktree's Git administrative area; it survives session restarts and disappears with the worktree. A declaration binds to its [subject](../00-orientation/glossary.md#subject): the resolved definition plus the matched paths' base and current content. Reopening is relevance-sensitive. An unrelated edit or an unrelated trunk advance leaves a conclusion standing; a change to matched content, to the matched set, or to the definition reopens it, and `discern checkpoints` reports `reopened` until a fresh declaration replaces it. Either conclusion may replace the other, and changed declaration evidence stales a recorded Proof at an unchanged `HEAD` without tripping the unchanged-tree rerun refusal.

## The trunk governs

The policy for an effort is the `[checkpoints]` configuration at its merge-base with the trunk, so a branch edit cannot govern its own gate and a trunk landing cannot change a running effort. `discern update` advances the merge-base and with it the policy, and the Proof records the merge-base commit as the policy identity. Editing these tables on a branch governs other efforts once the edit lands, and `discern.toml` sits outside every configured scope, so the edit reaches owner review at acceptance. Governing resolution fails open: an entry the engine cannot resolve drops out with an advisory instead of wedging the effort.

## The `when` escape hatch

`when = "<command>"` delegates a firing condition the structured trigger fields cannot express. The command runs pre-flight under a 10-second budget: exit 0 fires, exit 1 passes, and any other exit or a timeout fails open (no fire) with an advisory. It may print `DISCERN_MATCH <path>` lines to declare the subject precisely; without them the subject falls back to the full matched set, which reopens more coarsely. When selectors are present, they pre-scope the diff and `when` decides the firing. The v1 execution boundary is stated rather than implied: the merge-base governs the command text, while the command runs in the candidate worktree, so the scripts and interpreters it references resolve from that worktree. The policy identity proves where the text came from; it does not prove an executable dependency closure. Read surfaces run no `when` command — `discern checkpoints` reports such a trigger as "may fire at done".

## Declared unmet, and the owner's variance

Sometimes the truthful conclusion is that the criterion is not satisfied and satisfying it sits outside this effort. Record that with `discern done --unmet <id> --why "<rationale>"`. The rationale is required, one paragraph of 1–500 characters. Write it for the owner (the tradeoff that made the conclusion right) and put no secrets in it: it is durable Proof evidence, served at the landing review and never written into the metadata-only [Logbook](../70-reference/the-logbook.md).

The gate still runs and can go green, and the work then waits for a decision. A current declared-unmet conclusion makes `discern accept` refuse with `error: "awaiting_variance"`, serving the criterion, the matched evidence, and the rationale. The owner authorizes each named [variance](../00-orientation/glossary.md#variance) in the current conversation with `discern accept --confirmed --variance <id>`; the id set must equal the declared-unmet set. Recorded standing and effort grants never authorize a variance. Each authorization binds to the exact declaration and the landed commit, and changes no future policy.

## The shipped set

A fresh install's config activates nine built-ins; each catches a failure mode a good reviewer keeps raising. The four `stop` members guard the knowledge estate, the surfaces that steer every future session: `map-focus` (a broad map change must reduce future reading), `instruction-economy` (always-loaded prose pays rent in every session), `skills-playbook` (a skill is an executable playbook), and `gotchas-playbook` (failure memory stays symptom, cause, and proven recovery — structurally quiet until `[project].gotchas_doc` names a doc). Code-facing members are all `advise`, so no shipped default interlocks a code change: `deletion-heavy-change`, `parallel-implementation`, `effort-sprawl`, `docs-drift` (a substantial change moved nothing in the map), and `commit-story`. `commit-story` fires on matched-file breadth — the trigger menu counts files, and a change that wide carries a history worth telling however it was committed.

Referencing a built-in id enables it, any field set on the entry overrides the seed, and deleting the entry disables it. Overriding `criterion` replaces the shipped judgment with authored prose. Stack-aware examples (`new-dependency`, `shrinking-tests`, `sensitive-paths`) ship commented out for the owner to point at real paths. `discern checkpoints` prints the governing table with each criterion, trigger, and mode.

## Scarcity and graduation

A `stop` checkpoint taxes every matching change, so each must earn its stop the way a good reviewer's interruption does. The placement ladder decides the rung: prose an agent needs while shaping most decisions belongs in the instructions; a recurring method belongs in a skill; a judgment caught as a narrow change completes belongs in a checkpoint; a rule a machine can decide belongs in a gate job or a standard; a decision only the owner may make belongs to consent or a recorded grant. A criterion earns a checkpoint when a diff introduces its violations; one that accrues by time or absence stays with estate review in [improvement](improvement.md). The loop closes in both directions: `discern improvement` recommends capturing a recurring finding class as a checkpoint when project-local evidence supports it, and a criterion that becomes mechanically decidable moves down the ladder through the `discern-set-the-standard` outlaw procedure. Review the observed economics in `discern checkpoints` and [`discern patterns`](patterns.md) — per-checkpoint fires and declared-unmet and variance shares, with hygiene advisories for a dead, noisy, or frequently varied checkpoint. To author one, reach for the bundled `discern-set-a-checkpoint` skill.

Episode states, declaration flags, and the command surface are in [checkpoint state and declarations](../70-reference/checkpoint-state.md); the trigger fields are in the [config reference](../70-reference/config-reference.md).
