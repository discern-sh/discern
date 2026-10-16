# ADR 0424: Generator-owned paths have one writer

**Status**: accepted

## Context

A `[generated.<name>]` group declares that its `run` command alone produces the bytes at its `paths` ([ADR 0247](0247-generated-artifacts-regenerate-never-merge.md)). discern's own fixers did not consult that declaration. `discern tidy` formatted every configured instruction source, every Markdown file under the map, the TODO file, and `discern.toml`. `discern refresh` rewrote the record lists inside the ADR README.

A project can compile an external generator's guidance as an extra instruction source, or let a generator own map pages. In that setup the gate's fix stage reformatted the generated file and `discern done` failed at `tree_drift`. When the generator owned the ADR README, the refresh inside `discern prepare` rewrote it, the build stage restored it, and `done` failed at `generated_drift`. `discern prepare` hid the first failure because its regeneration runs after the fixers. The only workaround was to run the generator again after `discern tidy` inside the format job.

The same setup exposed a resolution fault. A directory reference expands with its own trailing slash, so `${skills.dir}/**` became `discern/skills//**`. Ownership matching never matched that pattern, and the `.gitattributes` translator refused it, so the group's merge rule covered only its literal paths.

## Decision

A path a declared group owns has one writer: the group's `run` command. A discern fixer rewrites a file someone else authors so that it follows a discern convention. Fixers neither rewrite nor scan a generator-owned file. The fixers today are tidy's Markdown and TOML targets and the maintained ADR index region.

Every ownership decision uses one predicate, `generatedGroupOwnsPath`, over groups that `resolveGeneratedGroups` resolves once. That resolution expands live path references. A directory reference now absorbs the slashes written after it, so `${skills.dir}/**` and `${skills.dir}**` name the same files for every consumer.

This amends ADR 0247. The maintained ADR index belongs to discern's built-in generated group only while no declared group owns its README. Status, the gate's index check, refresh, and update's conflict policy treat an owned README as an index discern does not maintain.

discern's own whole-file outputs and managed entries are generators, not fixers, and this decision does not make them yield. These include the agent files, materialized skills, the `.gitattributes` block, and provider configuration. A declared group that claims one of them conflicts with another generator. That conflict needs its own decision.

## Alternatives considered

- **Run the generator again inside the format job.** It works for one project, but every project has to discover it, and the fix stage still rewrites bytes the generator then restores.
- **Require generators to emit discern's Markdown convention.** This ties external tools to discern's formatter, and a project cannot change a third-party generator's output.
- **Run tidy after the build stage.** Tidy would still rewrite generated files, so the drift would move to a later stage instead of going away.
- **Make every refresh writer skip owned paths.** If a group claimed an agent file, discern would stop compiling it without any notice, and the instruction currency check would then fail. That is the separate conflict described above.

## Consequences

A generator can own any authored surface, including an instruction source, a map region, or the ADR README, and the gate converges on its bytes. `discern tidy --dry-run` names each skipped file and its group. A TOML-only `discern tidy` now loads the config, as bare `discern tidy` already did.

An owned file gets no diagram or table scan, because only its generator can repair it. This repository's codegen-owned map pages lose that scan. Codegen writes them in canonical form.

A guard enumerates the fixers from their planners: every tidy type and every effect of the complete refresh plan. In its fixture, one generator owns every authored surface in the paths registry. A control run without that generator proves each fixer would otherwise write an owned path. A second guard keeps raw `[generated]` reads inside the resolver, so no consumer sees an unexpanded reference.
