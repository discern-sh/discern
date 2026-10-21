# ADR 0427: Instruction sources compile in configured order

**Status**: accepted

## Context

`[instructions].sources` lists the files, or glob patterns, that `discern refresh` compiles into every agent file after the built-in sections. The resolver collected every match into one set and sorted it by absolute path. The configured list therefore chose which files compiled, never their order.

A project that compiles guidance from more than one source, such as its own rules beside another tool's generated guidance, could not put one ahead of the other. Moving a file or renaming a directory reordered the compiled agent file without any configuration change. The map already described configured order; the code and the config reference described path order.

[ADR 0246](0246-map-export-reads-scopes-as-reading-lists.md) settled the same question for scope exports: a list a person writes is a reading order.

## Decision

`resolveInstructionSources` in [`src/lib/paths.ts`](../../../src/lib/paths.ts) returns files in the order of the configured entries. The files one glob matches sort by path, which keeps a single pattern's output stable whatever order the filesystem returns. A file that several entries match keeps the position of the first. Agent-file outputs remain excluded, and an entry that matches nothing contributes nothing.

Every consumer of the resolver inherits the order: compilation, the currency check, map integrity, tidy, improvement rules, and doctor.

## Alternatives considered

- **Keep path order and document it.** Owners would have to rename files to control precedence, and a rename elsewhere in the tree could reorder guidance silently.
- **An explicit priority field per source.** It adds a second ordering mechanism to a list that already has one.

## Consequences

A project with several sources whose configured order differs from path order sees its agent files reorder once. `discern upgrade` and the next `discern refresh` recompile them, and `discern done` reports the stale copies until then. A project with one source, or with sources already listed in path order, sees no change.

The `sources` prose in the config schema, template, and reference now states the order rule.
