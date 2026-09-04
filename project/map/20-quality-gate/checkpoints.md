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

_A checkpoint serves a judgment at the moment a change makes it relevant, and the gate records the answer._

A [checkpoint](../00-orientation/glossary.md#checkpoint) is one configured rule under `[checkpoints]`: a deterministic trigger paired with a [question](../00-orientation/glossary.md#question), the judgment prose the agent evaluates against the matched change. Machine checks decide what a machine can decide; a checkpoint carries a question that still needs judgment — is this documentation worth its reading time, is this large cut proven safe, does a change in a risky region state what could break? discern verifies that the required conclusion exists and never verifies its truth. Every surface reports the answer as [declared met](../00-orientation/glossary.md#declared-met) or [declared unmet](../00-orientation/glossary.md#declared-unmet), kept apart from verified machine results and from owner authority. Terminal rows label either conclusion `Declared`; an unmet conclusion retains its separate attention and variance facts.

## What happens at the gate

When a fired [`stop`](../00-orientation/glossary.md#stop--advise) checkpoint awaits a conclusion, `discern done` refuses before any gate job with `error: "awaiting_declaration"`, batching every awaiting question with its matched paths in one refusal. No gate job ran and the project tree is unchanged; the [open question](../00-orientation/glossary.md#open-question) record and a logbook line are the writes. The refusal names both recoveries:

- `discern done --met <id>` (repeatable) records that the question is satisfied for the current subject.
- `discern done --unmet <id> --why "<rationale>"` (one per invocation) records that it is not.

A declaring invocation records every valid conclusion first, then continues into the gate in the same run. An `advise` checkpoint serves its question and evidence through the advisory channel and blocks nothing; its firings are still recorded for the observed economics. The questions arrive early: `discern prepare` and `discern status` project each required `stop` [declaration](../00-orientation/glossary.md#declaration) while the change is hot, and `discern done --dry-run` describes the same refusal-or-proceed decision without writing or refusing.

### CI reports review; it does not declare it

`discern done --ci` is the explicit pull-request lane. It resolves the same governing policy and obligations, runs `when` during an actual run, and runs every machine gate job. Fired stop questions appear as awaiting review, separately from declarations and machine results. Machine jobs alone determine the exit status.

The lane writes no open question, declaration, or checkpoint logbook observation. It rejects `--met`, `--unmet`, and `--why`; workflow YAML cannot stand in for an agent's judgment. `discern done --dry-run --ci` previews report mode without running `when`. The resulting Proof records that checkpoint review was reported and was not enforced, and acceptance requires a later ordinary `discern done` in the stateful worktree ([ADR 0307](../_adr/0307-ci-reports-checkpoint-review-and-proof-retains-drops.md)).

## Three kinds of evidence

| Evidence                | Source                  | Claim                                                    |
| ----------------------- | ----------------------- | -------------------------------------------------------- |
| Gate results, Standards | Machine                 | These checks passed.                                     |
| Declarations            | Agent                   | The agent judged each question met or unmet.             |
| Landing authority       | Owner or recorded grant | This work may land, with any named variances authorized. |

The Proof renders declared conclusions separately from machine results, carries unmet rationales and the policy identity, and states when a decision is still open — a Proof line carries `1 declared unmet — owner variance required to land`. Acceptance consumes the Proof and resolves the third row. The vocabulary stays disjoint: machine results are verified, conclusions are declared, and variances are authorized.

## Subjects and reopening

A fired `stop` checkpoint opens an effort-scoped open question in the worktree's Git administrative area; it survives session restarts and disappears with the worktree. The trigger opens the question but does not own its lifetime: once served, a readable governed question remains an obligation even if the current structural trigger becomes idle. An ungoverned historical question stays visible without interlocking.

A declaration binds to its subject: the resolved definition plus the matched paths' base and current content. Reopening is relevance-sensitive. An unrelated edit or an unrelated trunk advance leaves a conclusion standing; a change to matched content, to the matched set, or to the definition reopens it, and `discern checkpoints` reports `reopened` until a fresh declaration replaces it. Either conclusion may replace the other, and changed declaration evidence stales a recorded Proof at an unchanged `HEAD` without tripping the unchanged-tree rerun refusal. One read-only inspection combines this persisted lifetime and subject currency with the structural preview, so `checkpoints`, `prepare`, `status`, dry-run, and strict `done` agree on whether a conclusion is required.

## The trunk governs

The policy for an effort is the `[checkpoints]` configuration at its merge-base with the trunk, so a branch edit cannot govern its own gate and a trunk landing cannot change a running effort. `discern update` advances the merge-base and with it the policy, and the Proof records the merge-base commit as the policy identity. Editing these tables on a branch governs other efforts once the edit lands, and `discern.toml` sits outside every configured scope, so the edit reaches owner review at acceptance. Governing resolution fails open: an entry the engine cannot resolve drops out instead of wedging the effort, and a structured checkpoint-drop record preserves why.

## Question sources and references

A project checkpoint sets `question` or `question_file`; a built-in may inherit or override either. `.md` has no magic meaning in `question`. `reference` is a displayed, unloaded pointer.

`question_file` resolves from the governing merge-base Git tree ([ADR 0309](../_adr/0309-repository-question-files-are-governed-content.md)). It names a portable project-relative path outside `.git`: a regular blob, valid UTF-8, at most 65,536 bytes (64 KiB), with line endings retained. The repository is the boundary. The reader ignores the candidate worktree and rejects symlinks, environment variables, URLs, submodules, external paths, vaults, encryption, and remote transports. Resolved text becomes the ordinary question. Its path and content define the identity: candidate edits have no effect; a governing path or content update reopens it.

Live loading rejects bad sources. Historical failures drop only that checkpoint and record its id, mode, policy commit, and reason. Every review surface serves the resolved question and any source or reference.

Repository privacy is the only privacy: questions and references can appear in terminal, MCP, CI logs, Proof, and landing review. Never put secrets in either.

## Trigger composition

Trigger fields form one fixed conjunction. Values within `kinds`, `adds_matching`, `removes_matching`, and path lists use any-match semantics; every configured field must still hold. There is no Boolean expression language. Omit both selectors to watch the complete authored diff.

| Group                   | Field               | Effect                                                                                                                                                      |
| ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selector and filter     | `scope`             | Select the paths of one configured `[scopes.<name>]`; use either `scope` or `paths`.                                                                        |
| Selector and filter     | `paths`             | Select changed paths with scope-dialect globs; use either `paths` or `scope`.                                                                               |
| Selector and filter     | `include_generated` | Include paths owned by the governing `[generated]` model; generated paths are excluded by default.                                                          |
| Selector and filter     | `exclude_paths`     | Remove checkpoint-specific path noise before every later predicate, subject, evidence record, and command input.                                            |
| Narrowing predicate     | `kinds`             | Keep `added`, `modified`, or `deleted` changes.                                                                                                             |
| Narrowing predicate     | `adds_matching`     | Keep text files with an added line containing any configured case-sensitive literal UTF-8 substring.                                                        |
| Narrowing predicate     | `removes_matching`  | Keep text files with a removed line containing any configured case-sensitive literal UTF-8 substring.                                                       |
| Narrowing predicate     | `new_directory`     | Keep added files whose parent directory contained no admitted file at the merge-base.                                                                       |
| Narrowing predicate     | `binary`            | Keep binary changes when `true`, or text changes when `false`.                                                                                              |
| Narrowing predicate     | `similar_new_file`  | Keep an added file whose name resembles an existing sibling; the sibling is related evidence.                                                               |
| Condition or threshold  | `unless_changed`    | Veto when any filtered changed path matches a listed glob or configured scope, including a counterpart outside the selector.                                |
| Condition or threshold  | `min_changed_files` | Require a minimum number of narrowed changed files.                                                                                                         |
| Condition or threshold  | `min_changed_lines` | Require a minimum total of added and removed text lines across narrowed evidence; binary files contribute 0.                                                |
| Condition or threshold  | `deletion_dominant` | Require removals to clear the built-in floor and clearly outweigh additions.                                                                                |
| Condition or threshold  | `min_commits`       | Require the merge-base-to-`HEAD` history to contain a minimum number of commits, including merges; uncommitted work contributes 0.                          |
| Executable escape hatch | `when`              | Run a final repository command when structured fields cannot express the condition; exit 0 fires, exit 10 passes, and every other outcome is indeterminate. |

Evaluation follows that table's pipeline ([ADR 0308](../_adr/0308-checkpoint-triggers-use-bounded-facts-and-versioned-input.md)). The governing generated-path classification establishes the default authored universe. The selector runs next, followed by `exclude_paths`. Narrowing runs in this order: `kinds`, `adds_matching`, `removes_matching`, `new_directory`, `binary`, and `similar_new_file`. Conditions then run in this order: `unless_changed`, `min_changed_files`, `min_changed_lines`, `deletion_dominant`, and `min_commits`. `when` runs last. Thresholds count narrowed changed evidence; a similar unchanged sibling never enters file or line totals.

`adds_matching` and `removes_matching` use case-sensitive literal UTF-8 byte substrings on individual lines. Each field accepts up to 16 distinct patterns of 1–128 UTF-8 bytes. Content collection admits lines up to 8 KiB, 65,536 changed-line facts, files up to 256 KiB, and 2 MiB of attempted bytes across admitted paths. Comparison work stops above 64 MiB. If a needed fact is unreadable, inconsistent, or over a bound, that checkpoint fails open with a durable drop. Partial matches and raw source lines never reach Proof.

### Executable condition protocol

`when = "<command>"` delegates the final firing decision to a repository command under a 10-second budget. An actual strict or CI run creates a mode-`0600` UTF-8 JSON file and exposes its absolute path through [`DISCERN_CHECKPOINT_INPUT`](../70-reference/checkpoint-when-protocol.md). Version 1 carries the checkpoint id and mode, governing policy commit, and the final path-sorted `changed_files` facts: `path`, `kind`, `insertions`, `deletions`, and `binary`. Optional `history` carries the commit count and ordered-history fingerprint. The input contains no raw source, question, rationale, environment dump, or secret.

This repository's Git-backed Deno matchers may read only the input path. Their shared checkpoint adapter marks its bounded `rev-parse`, `show`, `ls-tree`, and `cat-file` queries as isolated and read-only; [`runGit`](../../../src/shared/subprocess.ts) refuses every other subcommand in that mode. When Deno denies access to the inherited environment, it clears the Git child's environment instead of trusting values it cannot inspect. Those queries invoke no hooks. Ordinary and commit Git paths still rebuild a complete sanitized environment, preserving owner configuration and hook context while preventing ambient hook variables from redirecting the command to another repository.

The command may print `DISCERN_MATCH <path>` lines to narrow the subject to paths already present in `changed_files`; it cannot admit another path. With no valid declared match, the structural matched set remains. Exit 0 fires and exit 10 passes. Every other exit, spawn/input/cleanup failure, cancellation, timeout, or output overflow is indeterminate and records a classified drop. When the structural trigger holds, an indeterminate stop serves its question over the complete structural match; advise remains non-blocking. The merge-base governs the command text, while its scripts, interpreters, dependencies, and configuration resolve from the candidate worktree. Read surfaces and dry runs create no input file and run no command, so they report the condition as undecided.

## Fail-open evidence

When uncertainty prevents enforcement, the gate may remain green, but the loss cannot disappear into transient copy. One typed checkpoint-drop registry covers policy-level uncertainty before an entry is knowable and entry-level uncertainty after resolution. Entry records carry checkpoint id, mode, governing policy commit, stable reason, and a bounded account. Policy records carry the policy commit when knowable and use `null` for unknowable id and mode.

Gate JSON and Markdown, the Proof, `status`, acceptance preview and consent review, and the landed DSSE note retain the same records. Missing historical configuration is the ordinary absence of policy, while unreadable Git/configuration is a drop. Trigger vetoes are ordinary decisions and never drops. A Proof carrying an indeterminate stop cannot take the reuse path; acceptance requires current-conversation confirmation, and standing or effort grants cannot cover that degraded evaluation. An indeterminate advise checkpoint remains an advisory rather than a variance.

## Declared unmet, and the owner's variance

Sometimes the truthful conclusion is that the question is not satisfied and satisfying it sits outside this effort. Record that with `discern done --unmet <id> --why "<rationale>"`. The rationale is required, one paragraph of 1–500 characters. Write it for the owner (the tradeoff that made the conclusion right) and put no secrets in it: it is durable Proof evidence, served at the landing review and never written into the metadata-only [logbook](../70-reference/the-logbook.md).

The gate still runs and can go green, and the work then waits for a decision. A current declared-unmet conclusion makes `discern accept` refuse with `error: "awaiting_variance"`, serving the question, the matched evidence, and the rationale. The owner authorizes each named [variance](../00-orientation/glossary.md#variance) in the current conversation with `discern accept --confirmed --variance <id>`; the id set must equal the declared-unmet set. Recorded standing and effort grants never authorize a variance. Each authorization binds to the exact declaration and the landed commit, and changes no future policy.

## The shipped set

A fresh install's config activates 10 built-ins. Four `stop` members guard knowledge surfaces that steer future sessions: `map-focus` (a broad map change must reduce future reading), `instruction-economy` (the configured instruction sources must earn their always-loaded cost), `skills-playbook` (a skill is an executable playbook), and `gotchas-playbook` (failure memory stays symptom, cause, and proven recovery; it remains inactive until `[project].gotchas_doc` names a document).

Six `advise` members read change facts without interlocking code changes: `deletion-heavy-change`, `parallel-implementation`, `new-binary-asset`, `effort-sprawl`, `map-drift` (a substantial change moved nothing in the map), and `commit-story`. `new-binary-asset` considers added binary files and asks about provenance, permission, need, size, and the review and update route. `commit-story` keeps matched-file breadth as its trigger because a change that wide carries a history worth preserving.

Referencing a built-in id enables it, any field set on the entry overrides the seed, and deleting the entry disables it. Setting `question` or `question_file` replaces the shipped judgment with authored prose. Stack-aware examples (`new-dependency`, `shrinking-tests`, `sensitive-paths`) ship commented out for the owner to point at real paths. `discern checkpoints` prints the governing table with each resolved question, source path and reference when present, trigger, and mode.

Copyable combinations live in [checkpoint recipes](checkpoint-recipes.md): nine common review moments with advice on `stop` versus `advise` and a realistic declared-unmet outcome.

## Scarcity and graduation

A `stop` checkpoint taxes every matching change, so each must earn its stop the way a good reviewer's interruption does. The placement ladder decides the rung: prose an agent needs while shaping most decisions belongs in the instructions; a recurring method belongs in a skill; a judgment caught as a narrow change completes belongs in a checkpoint; a rule a machine can decide belongs in a gate job or a standard; a decision only the owner may make belongs to consent or a recorded grant. A question earns a checkpoint when a diff introduces its violations; one that accrues by time or absence stays with the improvement review in [improvement](improvement.md). The loop closes in both directions: `discern improvement` recommends capturing a recurring finding class as a checkpoint when project-local evidence supports it, and a question that becomes mechanically decidable moves down the ladder through the `discern-set-the-standard` outlaw procedure. Review the observed economics in `discern checkpoints` and [`discern patterns`](patterns.md) — per-checkpoint fires and declared-unmet and variance shares, with hygiene advisories for a dead, noisy, or frequently varied checkpoint. To author one, reach for the bundled `discern-place-a-checkpoint` skill.

Open question states, declaration flags, and the command protocol are in [checkpoint state and declarations](../70-reference/checkpoint-state.md); the trigger fields are in the [config reference](https://discern.sh/docs/reference/config-reference).
