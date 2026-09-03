# ADR 0137: Project Scripts live under the `script` command

> **Amendment ([ADR 0360](0360-the-project-script-namespace-holds-only-commands.md), [ADR 0367](0367-worktree-local-state-records-intent-before-effects.md)).** The canonical command is now the plural `scripts`. A name resolves literally and runs from the project root. The child inherits ordinary process values but receives exactly four `DISCERN_*` values from discern: absolute `DISCERN_ROOT`, `DISCERN_TOML`, and `DISCERN_SCRIPTS_DIR`, plus `DISCERN_TRUNK`. Every remaining argument belongs to the child; machine mode must therefore precede a name. These current contracts replace the singular spelling and two script-directory variables recorded below.

**Status**: accepted

**Supersedes**: [ADR 0001](_superseded/0001-project-owned-recipes.md)

## Context

discern lets a project add executable automation without extending the binary. Before this decision, discern called these files Project Recipes. An unknown root word fell through to a matching executable: `discern deploy` ran the file named `deploy`. Adding a file was convenient, but the root vocabulary became open-ended and context-dependent.

An open root creates three launch problems:

- A future built-in can claim a project's existing name.
- Help and typo handling must reconcile built-ins with discovered files.
- A misspelled built-in might run project code instead of rejecting the typo.

The collision rule gave the engine precedence, but left a colliding project file inert. "Recipe" also describes a reusable procedure more than the concrete artifact discern executes: a script.

The launch vocabulary now has one canonical spelling per command, with plural forms accepted only as grammatical forgiveness. Project-owned automation needs to fit that closed, predictable command surface without losing zero-registry discovery or raw argument forwarding.

## Decision

Call the concept a **Project Script** and give it the explicit `script` namespace.

- `discern script` lists every executable file in `[scripts].dir`, ordered by name. A leading `# desc: ...` line is optional and appears beside the name.
- `discern scripts` normalizes to the canonical singular command. It is grammatical forgiveness, not a second documented spelling.
- `discern script <name> [args...]` executes the named file and forwards every argument after its name unchanged.
- An unknown root word never executes a Project Script. If it matches or resembles one, the refusal suggests `discern script <name>`.
- Built-in names are legal Project Script names because the namespace removes the collision: `discern done` remains the gate while `discern script done` runs the project's file.
- The config section is `[scripts]`, defaulting to `discern/scripts`. The process receives `DISCERN_SCRIPTS` and `DISCERN_SCRIPTS_DIR` alongside the existing shared `DISCERN_*` values. The old config and environment names are not runtime aliases.
- Schema 19→20 renames the config section. It moves the old default `discern/recipes` directory to `discern/scripts`, preserves a custom directory. If both default paths contain files, it pins the old directory and overwrites neither tree.

`script` stays on the command-line interface. A named Project Script owns its arguments, output, and exit code, so it cannot promise discern's fixed result contract. The list form emits a convenience JSON result when `--json` appears before any Project Script name. Once a name appears, all remaining flags belong to the child.

## Consequences

The root command set has a fixed vocabulary and rejects typos. Projects can use any built-in name without shadowing. A future discern verb cannot disable their automation. Discovery remains file-driven, and Project Scripts remain ordinary executables in any language.

The command is one word longer to type. Existing direct invocations must change from `discern <name>` to `discern script <name>`. This intentional launch break has no compatibility spelling. The migration carries config and files, but it cannot rewrite arbitrary calls in a project's own CI, documentation, or scripts.

The singular command performs two related operations: bare means list, named means execute. That matches other resource commands and keeps the common execution form explicit. Callers must know that `discern script` without a name runs nothing.

## Alternatives considered

- **Keep Project Recipes at the root.** This preserves the shortest invocation, but retains an open command vocabulary, inert collisions, and unsafe fallback semantics.
- **Keep the Recipe name under `recipe`.** Namespacing fixes routing, but the name still describes a procedure rather than the executable artifact users add.
- **Use `run`, `task`, or another action word.** The list form makes `run` misleading. `task` collides conceptually with agent work and implies a richer task graph. `script` says exactly what the directory contains.
