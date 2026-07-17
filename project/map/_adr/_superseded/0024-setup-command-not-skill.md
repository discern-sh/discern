# ADR 0024: Setup is a command, not a skill

> **Consolidated into [ADR 0036](../0036-unify-setup.md)** (unify init + setup under `discern setup`). The command-not-a-skill decision and the `[meta].bootstrapped` marker live on there. Kept for history.

**Status**: accepted

> **Amended by [ADR 0036](../0036-unify-setup.md):** the `setup` command was folded into a single `discern setup` (with `setup`), and the pre-setup "nudge, not gate" below became a **hard redirect** for the work verbs. The command-not-a-skill decision and the `[meta].bootstrapped` marker recorded here still stand.

## Context

The bundled `setup` skill seeded a fresh install from the project brief — drafting the docs tree, the orientation docs, the design principles and guidance, and proposing the `[capabilities]` fills. It shipped as a **materialized skill**: `discern refresh` copied `templates/skills/setup/` (instructions plus a `skel/` doc tree) into every project's `.claude/skills/`, where its description loaded into the agent's context for the life of the project.

Delivering a one-shot as a permanent skill has two costs:

- **Context pollution.** Bootstrap runs exactly once, but its skill description sat in _every_ agent session forever — a recurring context cost for a task that is done after the first day.
- **No completion signal.** Nothing recorded that a project had been bootstrapped, so neither the agent nor the harness could tell "freshly installed, seed me" from "seeded months ago." The skill lingered identically in both states.

The unlock: to the agent, a `SKILL.md` it reads and a CLI command's stdout it reads are the **same thing** — instructions. discern never authored anything during setup; the agent already in the loop did. So the instructions can be delivered by a command instead of a file, with no loss of capability, and the first call doubles as a smoke-test that the binary is on PATH (the agent will lean on it constantly thereafter).

## Decision

**Replace the setup skill with a `discern setup` command pair, recorded by a `[meta].bootstrapped` marker.**

- **`discern setup`** lays the doc skeletons — _only when the project has none_ (an existing `docs/` is never touched) — substituting the project name, then prints the setup instructions (`templates/setup/instructions.md`) for the agent to act on. The deterministic scaffolding is discern's job; all authoring stays with the agent.
- **`discern setup done`** validates that no skeleton markers remain (the `<!-- setup fills this -->` sentinels and the EXAMPLE principle), then records `[meta].bootstrapped = true`. It is also the **manual-setup escape hatch**: run it after wiring the config by hand to silence the reminder. `--force` records despite leftovers.
- **The marker drives two behaviours.** Until it is set, the engine work verbs print a one-line "not set up yet" reminder to stderr. Once set, the reminder retires and `discern setup` hides from `--help` (it stays callable with `--force` for a deliberate re-seed).
- **Nudge, not gate.** Other commands are _never blocked_ pre-setup. Nothing is unsafe before setup — an unconfigured gate passes trivially (the "green gate you grow into") — and a hard block would punish the manual-config path and the just-run-my-tests path. The reminder is suppressed in `--json` and on the setup/config verbs (setup, upgrade, doctor, preset, config), so it never spams a recipe's `config` reads.
- **Skeletons stay binary-embedded** under `templates/setup/skel/`, laid by discern rather than copied by the agent — strictly more robust than the old "agent copies the materialized setup-skill skeleton" step it replaces.
- **Schema 6→7 migration.** Prunes the stale materialized setup-skill copy (now a foreign directory `materializeSkills` would otherwise leave in place forever) and back-fills `[meta].bootstrapped = true` for an already-configured install (capabilities wired _or_ a `docs/` tree present), so an upgrade never nags a project that is effectively done. A bare install gets no marker — _absent ≡ not set up_ everywhere.

## Consequences

- `templates/skills/setup/` is gone. Its instructions live at `templates/setup/instructions.md` and its skeletons at `templates/setup/skel/`. The bundled skill set is now `document-subsystem`, `handoff-worktree`, `write-adr`.
- `SCHEMA_VERSION` is **7**; the migration chain gains a contiguous 6→7 step. The `[meta].bootstrapped` marker is **tracked** in `discern.toml`, so a fresh clone of a bootstrapped project correctly reads as done (you set up once per project, not once per clone).
- The `setup` outro points at `discern setup` (recommended) or manual `discern.toml` editing. The two sibling skills that referenced the old skill (`write-adr`, `document-subsystem`) now name the command, as do the gate, docs, and doctor pointers.
- Discoverability moved from skill-trigger heuristics to three always-present signals: the init outro, the per-command nudge, and the printed instructions — more reliable for a _fresh_ agent session (one that did not run `setup`) than a skill that may or may not trigger.
- Historical ADRs keep their point-in-time references to the `discern setup` skill; this ADR is the record of the change.

## Alternatives considered

- **Keep the skill, just add a completion marker.** Rejected: the recurring context cost of a one-shot skill is the core problem; a marker alone does not remove it.
- **Hard-block other commands until bootstrapped.** Rejected: hostile, and it contradicts the "green gate you grow into" stance — it would wall the manual-config user and anyone who just wants to run their tests. A reminder achieves the discoverability goal without the cost; `doctor` especially must never be blocked, since it is what you run to debug a broken install.
- **A conditional "not set up" banner compiled into `AGENTS.md`.** Rejected: `AGENTS.md` is tracked, so a marker-conditional banner would churn the committed file on every setup. The stderr nudge carries no git cost.
- **Always lay skeletons (even over existing docs), or never lay them.** Rejected both: always-lay imposes the skeleton structure on a project that already has its own docs; never-lay reintroduces the fragile "agent copies files" step. Laying only when `docs/` is absent is the seamless middle, and it honours the rule that discern never disturbs what the user already has.

This builds on the materialized-skills model from [ADR 0020](../0020-dissolve-discern-dir.md): setup simply stops being one of those skills and becomes a first-class command, which also frees it from the `[features].skills` toggle (setup should work even with skills off).
