# ADR 0303: The shipped checkpoint set has four stops and six advisories

**Status**: accepted; implements the built-in set required by [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md), classifies questions under the conversion rule of [ADR 0295](0295-one-question-vocabulary-serves-two-memberships.md) and [ADR 0301](0301-the-coach-closes-the-checkpoint-loop.md), and uses the scalar reference of [ADR 0302](0302-configured-scalar-docs-join-the-live-path-reference-vocabulary.md).

## Context

Built-in checkpoints are the reason a new project feels the checkpoint contract on day one: each one catches a universal agentic failure mode at the moment a change introduces it. Two forces shape the set. Scarcity — a checkpoint taxes every matching change, so every member must earn its place against "a good human reviewer would raise this often enough to justify the stop". And the shipped-surface rule — every question must read correctly for any project in any domain, and discern never sniffs stacks: active built-ins may use only configured paths, scopes, and git-derived facts.

## Decision

**Ten active built-ins. The four `stop` members fire only on the knowledge surfaces that steer every future agent session. Six change-facing members use `advise`, so no shipped default interlocks a code change.**

| id                        | mode   | trigger                                 | question                               |
| ------------------------- | ------ | --------------------------------------- | -------------------------------------- |
| `map-focus`               | stop   | `${map.dir}**`, ≥3 files                | `map.focus` (new)                      |
| `instruction-economy`     | stop   | configured `[instructions].sources`     | `instructions.economy` (new)           |
| `skills-playbook`         | stop   | `${skills.dir}/`                        | `skills.executable` (shared)           |
| `gotchas-playbook`        | stop   | `${project.gotchas_doc}`                | `setup.failure-memory` (shared)        |
| `deletion-heavy-change`   | advise | deletion-dominant delta                 | `change.deletion-safety` (new)         |
| `parallel-implementation` | advise | name-similar new file                   | `change.parallel-implementation` (new) |
| `new-binary-asset`        | advise | added binary file                       | `change.binary-asset` (new)            |
| `effort-sprawl`           | advise | ≥25 changed files                       | `change.effort-scope` (new)            |
| `docs-drift`              | advise | ≥5 files, unless `${map.dir}**` changed | `map.current` (shared, reclassified)   |
| `commit-story`            | advise | ≥15 changed files                       | `change.commit-story` (new)            |

**Selector policy.** Seeds resolve from the configured path authority rather than copying paths. `instruction-economy` takes its complete default selector from the governing `[instructions].sources` list, so a broader scope that also owns skills or generated provider files cannot widen the stop; a project-authored checkpoint `scope` or `paths` still replaces that default. `gotchas-playbook` tracks the configured doc through the scalar reference and stays structurally quiet until the owner names one.

**Question classifications**, each made on the question's nature:

- `skills.executable` and `setup.failure-memory` were already diff-introduced; the checkpoint membership shares them — one authority per fact, and the improvement catalog's reviews gain the boundary mark wherever these checkpoints are configured.
- `map.current` is **reclassified** accrued → diff-introduced: a page goes stale only when a diff changes the documented subject without it; time alone never creates the violation. What accrues is the unnoticed backlog, which the improvement review keeps auditing through the unchanged improvement membership. The prose was reworded moment-neutrally so one authority serves both the improvement audit and the boundary.
- Seven questions are diff-introduced by construction: `map.focus`, `instructions.economy`, and the five `change.*` questions that read the change itself.
- `change.binary-asset` is diff-introduced and clears the universal bar: every project can add opaque bytes whose provenance, permission, necessity, size, and future review route need judgment. The exact added-and-binary predicates keep the advisory off text changes and edits to existing assets.

**`commit-story` measures breadth, not commits.** Authored rules may use `min_commits`, but the built-in deliberately keeps `min_changed_files = 15` and ships no executable `when`. Matched-set breadth identifies a change whose explanation spans many files; commit count also reflects authoring style and update history. A change that wide carries a story worth preserving however it was committed.

**Active for fresh installs.** The config template ships the ten entries as bare references, ready to govern. Referencing an id is what enables a built-in; deleting or commenting out the entry disables it, and any field set on the entry overrides the seed. Existing projects are untouched — `discern.toml` is owner-authored and no upgrade rewrites it. The scarcity bar holds structurally: a fresh project's first substantial map, instructions, or skills change meets one batched stop moment, code changes meet at most advisories, and `gotchas-playbook` sleeps until a doc is named.

**One graduation route ships.** `giant-commit-landing → change.commit-story`: the detector's findings are recurring instances of exactly that class. The route recommends only where the question is not already boundary-guarded, so it speaks to projects that disabled or never enabled the shipped default. This supersedes the empty-registry consequence of [ADR 0301](0301-the-coach-closes-the-checkpoint-loop.md) — the honest target question arrived with this set.

## Consequences

- Day one delivers the contract's feel: knowledge-surface changes meet a judgment at `discern done`; code changes are advised, never stopped, by shipped defaults.
- The composition and public guide inventory are pinned by registry-driven tests; changing an id, mode, threshold, or documented count fails a named guard first.
- Thresholds (3 map files, 25 sprawl, 15 story, 5 drift) are shipped defaults, tunable per project by field override; this repo's own tuning is a separate, deliberate adoption step.
- The engine test scaffolds inherit the active set, so the suite permanently exercises the fresh-install experience.

## Alternatives considered

- **Present-but-commented built-ins.** Rejected: a commented block is dead weight most owners never enable, and the launch story — feeling checkpoints on day one — is the point of shipping built-ins at all. Owners who want quiet delete ten lines.
- **Engine-side default-on without config entries.** Rejected: the governing policy is the committed config at the merge-base; invisible policy would contradict both the one-file footprint and the trunk-governs model.
- **A `stop` mode for any code-facing member.** Rejected on the scarcity invariant: the code-facing triggers are heuristics, and heuristics advise.
