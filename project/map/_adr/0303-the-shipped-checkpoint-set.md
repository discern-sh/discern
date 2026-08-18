# ADR 0303: The shipped checkpoint set — four stops on the knowledge estate, five advisories on the change

**Status**: accepted; implements the built-in set required by [ADR 0293](0293-checkpoint-declarations-interlock-the-gate.md), classifies criteria under the conversion rule of [ADR 0295](0295-one-criterion-vocabulary-serves-two-memberships.md) and [ADR 0301](0301-the-coach-closes-the-checkpoint-loop.md), and uses the scalar reference of [ADR 0302](0302-configured-scalar-docs-join-the-live-path-reference-vocabulary.md).

## Context

Built-in checkpoints are the reason a new project feels the checkpoint contract on day one: each one catches a universal agentic failure mode at the moment a change introduces it. Two forces shape the set. Scarcity — a checkpoint taxes every matching change, so every member must earn its place against "a good human reviewer would raise this often enough to justify the stop". And the shipped-surface rule — every criterion must read correctly for any project in any domain, and discern never sniffs stacks: active built-ins may use only configured paths, scopes, and git-derived facts.

## Decision

**Nine active built-ins. The four `stop` members fire only on the knowledge estate — the surfaces that steer every future agent session. Code-facing members are all `advise`: no shipped default ever interlocks a code change.**

| id                        | mode   | trigger                                 | criterion                              |
| ------------------------- | ------ | --------------------------------------- | -------------------------------------- |
| `map-focus`               | stop   | `${map.dir}**`, ≥3 files                | `map.focus` (new)                      |
| `instruction-economy`     | stop   | the `instructions` scope                | `instructions.economy` (new)           |
| `skills-playbook`         | stop   | `${skills.dir}/`                        | `skills.executable` (shared)           |
| `gotchas-playbook`        | stop   | `${project.gotchas_doc}`                | `setup.failure-memory` (shared)        |
| `deletion-heavy-change`   | advise | deletion-dominant delta                 | `change.deletion-safety` (new)         |
| `parallel-implementation` | advise | name-similar new file                   | `change.parallel-implementation` (new) |
| `effort-sprawl`           | advise | ≥25 changed files                       | `change.effort-scope` (new)            |
| `docs-drift`              | advise | ≥5 files, unless `${map.dir}**` changed | `map.current` (shared, reclassified)   |
| `commit-story`            | advise | ≥15 changed files                       | `change.commit-story` (new)            |

**Selector policy.** Seeds prefer live path references over scope names: a reference resolves in every project, while a scope name governs only where the project defines that scope. `instruction-economy` is the one scope-named seed — the instruction surface is a glob list with no single scalar key to reference, and the `instructions` scope is the project's own declaration of it; where the scope is absent the checkpoint drops out with an advisory naming the fix. `gotchas-playbook` tracks the configured doc through the scalar reference and stays structurally quiet until the owner names one.

**Criterion classifications**, each made on the criterion's nature:

- `skills.executable` and `setup.failure-memory` were already diff-introduced; the checkpoint membership shares them — one authority per fact, and the improvement catalog's reviews gain the boundary mark wherever these checkpoints are configured.
- `map.current` is **reclassified** accrued → diff-introduced: a page goes stale only when a diff changes the documented subject without it; time alone never creates the violation. What accrues is the unnoticed backlog, which estate review keeps auditing through the unchanged improvement membership. The prose was reworded moment-neutrally so one authority serves both the estate audit and the boundary.
- Six new criteria are diff-introduced by construction: `map.focus`, `instructions.economy`, and the four `change.*` criteria that read the shape of the diff itself.

**`commit-story` measures breadth, not commits.** The closed trigger menu counts matched files; a commit-count predicate does not exist, and the seed vocabulary deliberately ships no executable `when`. Matched-set breadth is the deterministic stand-in: a change that wide carries a history worth telling however it was committed. If a commit-count predicate ever joins the menu, re-express the trigger.

**Active for fresh installs.** The config template ships the nine entries as bare references, ready to govern. Referencing an id is what enables a built-in; deleting or commenting out the entry disables it, and any field set on the entry overrides the seed. Existing projects are untouched — `discern.toml` is owner-authored and no upgrade rewrites it. The scarcity bar holds structurally: a fresh project's first substantial map, instructions, or skills change meets one batched stop moment, code changes meet at most advisories, and `gotchas-playbook` sleeps until a doc is named.

**One graduation route ships.** `giant-commit-landing → change.commit-story`: the detector's findings are recurring instances of exactly that class. The route recommends only where the criterion is not already boundary-guarded, so it speaks to projects that disabled or never enabled the shipped default. This supersedes the empty-registry consequence of [ADR 0301](0301-the-coach-closes-the-checkpoint-loop.md) — the honest target criterion arrived with this set.

## Consequences

- Day one delivers the contract's feel: documentation-estate changes meet a judgment at `discern done`; code changes are advised, never stopped, by shipped defaults.
- The composition is pinned by a double-entry test; changing an id, mode, or threshold is a conscious decision that fails a named guard first.
- Thresholds (3 map files, 25 sprawl, 15 story, 5 drift) are shipped defaults, tunable per project by field override; this repo's own tuning is a separate, deliberate adoption step.
- The engine test scaffolds inherit the active set, so the suite permanently exercises the fresh-install experience.

## Alternatives considered

- **Present-but-commented built-ins.** Rejected: a commented block is dead weight most owners never enable, and the launch story — feeling checkpoints on day one — is the point of shipping built-ins at all. Owners who want quiet delete nine lines.
- **Engine-side default-on without config entries.** Rejected: the governing policy is the committed config at the merge-base; invisible policy would contradict both the one-file footprint and the trunk-governs model.
- **A `stop` mode for any code-facing member.** Rejected on the scarcity invariant: the code-facing triggers are heuristics, and heuristics advise.
