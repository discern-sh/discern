---
title: Checkpoints
description: Change-triggered judgment stops — a deterministic trigger serves a question, the agent records a conclusion, and the Proof carries it as agent evidence.
order: 30
aliases:
  - checkpoints guide
  - judgment stop
  - stop checkpoint
  - advise checkpoint
  - checkpoint question
  - checkpoint subject
  - checkpoint policy
  - owner variance
  - built-in checkpoints
  - when command
  - DISCERN_CHECKPOINT_INPUT
  - DISCERN_MATCH
  - awaiting_declaration
  - awaiting_variance
---

# Checkpoints

_A checkpoint serves a judgment at the moment a change makes it relevant, and the Gate records the answer._

A [checkpoint](../00-orientation/glossary.md#checkpoint) is one configured rule under `[checkpoints]`: a deterministic trigger paired with a [question](../00-orientation/glossary.md#question), the judgment prose the agent evaluates against the matched change. Machine checks decide what a machine can decide; a checkpoint carries a question that still needs judgment — is this documentation worth its reading time, is this large cut proven safe, does a change in a risky region state what could break? discern verifies that the required conclusion exists and never verifies its truth. Every surface reports the answer as [declared met](../00-orientation/glossary.md#declared-met) or [declared unmet](../00-orientation/glossary.md#declared-unmet), kept apart from verified machine results and from owner authority.

## What happens at the gate

When a fired [`stop`](../00-orientation/glossary.md#stop--advise) checkpoint awaits a conclusion, `discern done` refuses before any gate job with `error: "awaiting_declaration"`, batching every awaiting question with its matched paths in one refusal. No gate job ran and the project tree is unchanged; the [open question](../00-orientation/glossary.md#open-question) record and a logbook line are the writes. The refusal names both recoveries:

- `discern done --met <id>` (repeatable) records that the question is satisfied for the current subject.
- `discern done --unmet <id> --why "<rationale>"` (one per invocation) records that it is not.

A declaring invocation records every valid conclusion first, then continues into the gate in the same run. An `advise` checkpoint serves its question and evidence through the advisory channel and blocks nothing; its firings are still recorded for the observed economics. The questions arrive early: `discern prepare` and `discern status` project each required `stop` [declaration](../00-orientation/glossary.md#declaration) while the change is hot, and `discern done --dry-run` describes the same refusal-or-proceed decision without writing or refusing.

### CI reports review; it does not declare it

`discern done --ci` is the explicit pull-request lane. It resolves the same governing policy and obligations, runs `when` during an actual run, and runs every machine Gate job. Fired stop questions appear as awaiting review, separately from declarations and machine results. Machine jobs alone determine the exit status.

The lane writes no open question, declaration, or checkpoint Logbook observation. It rejects `--met`, `--unmet`, and `--why`; workflow YAML cannot stand in for an agent's judgment. `discern done --dry-run --ci` previews report mode without running `when`. The resulting Proof records that checkpoint review was reported and was not enforced, and acceptance requires a later ordinary `discern done` in the stateful worktree ([ADR 0307](../_adr/0307-ci-reports-checkpoint-review-and-proof-retains-drops.md)).

## Three kinds of evidence

| Evidence                | Source                  | Claim                                                    |
| ----------------------- | ----------------------- | -------------------------------------------------------- |
| Gate results, Standards | Machine                 | These checks passed.                                     |
| Declarations            | Agent                   | The agent judged each question met or unmet.             |
| Landing authority       | Owner or recorded grant | This work may land, with any named variances authorized. |

The Proof renders declared conclusions separately from machine results, carries unmet rationales and the policy identity, and states when a decision is still open — a proof line carries `1 declared unmet — owner variance required to land`. Acceptance consumes the Proof and resolves the third row. The vocabulary stays disjoint: machine results are verified, conclusions are declared, and variances are authorized.

## Subjects and reopening

A fired `stop` checkpoint opens an effort-scoped open question in the worktree's Git administrative area; it survives session restarts and disappears with the worktree. The trigger opens the question but does not own its lifetime: once served, a readable governed question remains an obligation even if the current structural trigger becomes idle. An ungoverned historical question stays visible without interlocking.

A declaration binds to its subject: the resolved definition plus the matched paths' base and current content. Reopening is relevance-sensitive. An unrelated edit or an unrelated trunk advance leaves a conclusion standing; a change to matched content, to the matched set, or to the definition reopens it, and `discern checkpoints` reports `reopened` until a fresh declaration replaces it. Either conclusion may replace the other, and changed declaration evidence stales a recorded Proof at an unchanged `HEAD` without tripping the unchanged-tree rerun refusal. One read-only inspection combines this persisted lifetime and subject currency with the structural preview, so `checkpoints`, `prepare`, `status`, dry-run, and strict `done` agree on whether a conclusion is required.

## The trunk governs

The policy for an effort is the `[checkpoints]` configuration at its merge-base with the trunk, so a branch edit cannot govern its own gate and a trunk landing cannot change a running effort. `discern update` advances the merge-base and with it the policy, and the Proof records the merge-base commit as the policy identity. Editing these tables on a branch governs other efforts once the edit lands, and `discern.toml` sits outside every configured scope, so the edit reaches owner review at acceptance. Governing resolution fails open: an entry the engine cannot resolve drops out instead of wedging the effort, and a structured checkpoint-drop record preserves why.

## Question sources and references

A project checkpoint sets `question` or `question_file`; a built-in may inherit or override either. `.md` has no magic meaning in `question`. `reference` is a displayed, unloaded pointer.

`question_file` resolves from the governing merge-base Git tree ([ADR 0309](../_adr/0309-repository-question-files-are-governed-content.md)). It names a portable project-relative path outside `.git`: a regular blob, valid UTF-8, at most 65,536 bytes, with line endings retained. The reader ignores the candidate worktree and rejects symlinks, environment variables, URLs, submodules, external paths, vaults, encryption, and remote transports. Resolved text becomes the ordinary question. Its path and content define the identity: candidate edits have no effect; a governing path or content update reopens it.

Live loading rejects bad sources. Historical failures drop only that checkpoint and record its id, mode, policy commit, and reason. Every review surface serves the resolved question and any source or reference.

Repository privacy is the only privacy: questions and references can appear in terminal, MCP, CI logs, Proof, and landing review. Never put secrets in either.

## The `when` escape hatch

Structured triggers are conjunctive and ordered. The governing generated-file policy establishes the authored universe, `scope` or `paths` selects it, and `exclude_paths` removes local noise. The narrowing sequence is `kinds`, `adds_matching`, `removes_matching`, `new_directory`, `binary`, then `similar_new_file`. The surviving evidence then faces `unless_changed`, `min_changed_files`, `min_changed_lines`, `deletion_dominant`, and `min_commits`; `when` has the final word. Thresholds measure the narrowed changed evidence. Related unchanged evidence, such as a similar existing sibling, never enters changed-file or changed-line totals ([ADR 0308](../_adr/0308-checkpoint-triggers-use-bounded-facts-and-versioned-input.md)).

`adds_matching` and `removes_matching` use case-sensitive literal UTF-8 byte substrings on individual lines. Each field accepts up to 16 distinct patterns of 1–128 UTF-8 bytes. Content collection admits lines up to 8 KiB, 65,536 changed-line facts, files up to 256 KiB, and 2 MiB of attempted bytes across admitted paths. Comparison work charges each line's payload plus one separator unit per pattern and stops above 64 MiB. If a needed fact is unreadable, inconsistent, or over a bound, that checkpoint fails open with a durable drop; no partial match is used and no raw line reaches Proof.

`when = "<command>"` delegates a firing condition the structured trigger fields cannot express. The command runs pre-flight under a 10-second budget: exit 0 fires, exit 1 passes, and any other exit or a timeout fails open with a classified drop. It receives the final narrowed facts through [`DISCERN_CHECKPOINT_INPUT`](../70-reference/checkpoint-when-protocol.md) and may print `DISCERN_MATCH <path>` lines to narrow the subject to structurally admitted paths. The merge-base governs the command text, while the command runs in the candidate worktree, so its scripts, interpreters, dependencies, and configuration resolve from that worktree. The policy identity proves where the command text came from; it does not prove an executable dependency closure. Read surfaces run no `when` command and create no input file; `discern checkpoints` reports such a trigger as "may fire at done".

## Fail-open evidence

When uncertainty prevents enforcement, the Gate may remain green, but the loss cannot disappear into transient copy. One typed checkpoint-drop registry covers policy-level uncertainty before an entry is knowable and entry-level uncertainty after resolution. Entry records carry checkpoint id, mode, governing policy commit, stable reason, and a bounded account. Policy records carry the policy commit when knowable and use `null` for unknowable id and mode.

Gate JSON and Markdown, the Proof, `status`, acceptance preview and consent review, and the landed DSSE note retain the same records. Missing historical configuration is the ordinary absence of policy, while unreadable Git/configuration is a drop. Trigger vetoes are ordinary decisions and never drops. A drop remains fail-open evidence rather than becoming an undeclared variance.

## Declared unmet, and the owner's variance

Sometimes the truthful conclusion is that the question is not satisfied and satisfying it sits outside this effort. Record that with `discern done --unmet <id> --why "<rationale>"`. The rationale is required, one paragraph of 1–500 characters. Write it for the owner (the tradeoff that made the conclusion right) and put no secrets in it: it is durable Proof evidence, served at the landing review and never written into the metadata-only [Logbook](../70-reference/the-logbook.md).

The gate still runs and can go green, and the work then waits for a decision. A current declared-unmet conclusion makes `discern accept` refuse with `error: "awaiting_variance"`, serving the question, the matched evidence, and the rationale. The owner authorizes each named [variance](../00-orientation/glossary.md#variance) in the current conversation with `discern accept --confirmed --variance <id>`; the id set must equal the declared-unmet set. Recorded standing and effort grants never authorize a variance. Each authorization binds to the exact declaration and the landed commit, and changes no future policy.

## The shipped set

A fresh install's config activates nine built-ins; each catches a failure mode a good reviewer keeps raising. The four `stop` members guard the knowledge surfaces, the ones that steer every future session: `map-focus` (a broad map change must reduce future reading), `instruction-economy` (always-loaded prose pays rent in every session), `skills-playbook` (a skill is an executable playbook), and `gotchas-playbook` (failure memory stays symptom, cause, and proven recovery — structurally quiet until `[project].gotchas_doc` names a doc). Code-facing members are all `advise`, so no shipped default interlocks a code change: `deletion-heavy-change`, `parallel-implementation`, `effort-sprawl`, `docs-drift` (a substantial change moved nothing in the map), and `commit-story`. `commit-story` fires on matched-file breadth — the trigger menu counts files, and a change that wide carries a history worth telling however it was committed.

Referencing a built-in id enables it, any field set on the entry overrides the seed, and deleting the entry disables it. Setting `question` or `question_file` replaces the shipped judgment with authored prose. Stack-aware examples (`new-dependency`, `shrinking-tests`, `sensitive-paths`) ship commented out for the owner to point at real paths. `discern checkpoints` prints the governing table with each resolved question, source path and reference when present, trigger, and mode.

## Scarcity and graduation

A `stop` checkpoint taxes every matching change, so each must earn its stop the way a good reviewer's interruption does. The placement ladder decides the rung: prose an agent needs while shaping most decisions belongs in the instructions; a recurring method belongs in a skill; a judgment caught as a narrow change completes belongs in a checkpoint; a rule a machine can decide belongs in a gate job or a standard; a decision only the owner may make belongs to consent or a recorded grant. A question earns a checkpoint when a diff introduces its violations; one that accrues by time or absence stays with the improvement review in [improvement](improvement.md). The loop closes in both directions: `discern improvement` recommends capturing a recurring finding class as a checkpoint when project-local evidence supports it, and a question that becomes mechanically decidable moves down the ladder through the `discern-set-the-standard` outlaw procedure. Review the observed economics in `discern checkpoints` and [`discern patterns`](patterns.md) — per-checkpoint fires and declared-unmet and variance shares, with hygiene advisories for a dead, noisy, or frequently varied checkpoint. To author one, reach for the bundled `discern-place-a-checkpoint` skill.

Open question states, declaration flags, and the command protocol are in [checkpoint state and declarations](../70-reference/checkpoint-state.md); the trigger fields are in the [config reference](../70-reference/config-reference.md).
