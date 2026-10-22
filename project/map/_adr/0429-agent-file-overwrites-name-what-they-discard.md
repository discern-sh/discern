# ADR 0429: Agent-file overwrites name what they discard

**Status**: accepted; amends [ADR 0065](0065-setup-keeps-its-promises.md) §3, since setup no longer imports every existing agent file

## Context

discern compiles each agent file, such as `AGENTS.md` or `CLAUDE.md`, whole from its built-in instructions and the project's instruction sources, and Git tracks the result ([ADR 0128](0128-enumerated-ownership-tracked-guidance.md)). A compatibility probe ran discern beside a tool that maintains a block of its own inside those files. Every layer handled the block badly:

- Setup copied the block into the instruction source as if the owner had written it. The tool kept rewriting its block, so every tool update made the agent files drift, and the gate failed.
- The gate's only remedy was `discern refresh`, which discards the block.
- Refresh, and every path that refreshes as it goes, overwrote the file and reported only that it wrote it.

## Decision

**Agent files stay whole-file generated outputs.** No region or block of an agent file belongs to another tool. Content another tool maintains reaches the agent files the way any content does: through a file listed in `[instructions].sources`, which a `[generated.<name>]` group regenerates with the tool's own command.

**[`agentFileDiscard`](../../../src/engine/instruction_render.ts) names what an overwrite throws away.** It aligns an agent file with its recompiled body. A lost line is _added_ when it stands where the compile wrote nothing, or when the file keeps none of the compiled text, as a body another tool wrote whole does. Every other lost line rewrites compiled text in place: a hand edit, a reflowing formatter, a stale source, or discern's own changed output. A line that survives in any compiled agent file has moved, not vanished, and link destinations are ignored because the compile rewrites them. The gate, status, and every refresh read its verdict.

**Added lines get the owner's choices; rewrites get a refresh.** When drift includes added lines, the gate's `instructions` diagnostic and hint, and the status hint, offer three choices: move lines you wrote into an instruction source; route a tool through a `[generated.<name>]` source; or refresh and discard them. An ordinary edit keeps the plain `discern refresh` remedy.

**Every overwrite reports the added lines it discards.** The refresh planner attaches the verdict to each agent-file write, and `applyRefreshPlan`, which applies every such write, records each file that lost added lines. `refresh` reports them in `data.agent_files_discarded` and a notice hint. `start`, `update`, `worktree ensure`, `upgrade`, `setup begin`, and `accept` carry the notice; `setup done` stops at its refresh stage and names the files. `prepare` keeps overwriting but adds a warning diagnostic whose output keeps every discarded line: the inner loop converges agent files so `done` finds nothing to rewrite, and refusing would stall every iteration on a decision that belongs to the owner. A guard ([`agent_file_writers.ts`](../../../tests/agent_file_writers.ts)) enrolls every call site that renders agent-file bytes or runs the writer, and each declares how its caller learns of a discard.

**The coding agent judges each existing agent file at setup.** `setup verify` asks the agent to decide, per file, whether the owner wrote it or another tool maintains it, asking the owner only when the file doesn't settle it. `setup begin` folds what the owner wrote into the instruction source, as before. For a file named with `--tool-maintained <file>`, it leaves the content out; the first compile replaces that file, and the result names it and how to route the tool through an instruction source. An imported body also drops provider pointer lines, since the compile writes its own pointers and an imported pointer would make the canonical file import itself.

## Alternatives considered

- **Let a tool own a block of an agent file.** It would add an ownership mode to every agent-file writer and currency check, for content the existing generated-source path can already carry.
- **Report every lost line, rewrites included.** Every source edit and every upgrade of discern's own instructions would raise the notice, so the one that matters would read as noise.
- **Judge a rewrite by shared vocabulary.** It was tried first. It misread discern's own changed output, such as the map's region list replacing its placeholder, as added content.
- **An owner decision at setup, with a refusal until answered.** [ADR 0428](0428-the-gitignore-block-re-includes-ignored-integration-files.md) recorded why setup avoids interrupting the owner at consent. The coding agent can read the file and usually settle it.
- **Recognize a tool from the file's content.** discern is stack-neutral, and the next tool would still fail.
- **Refuse in `prepare`.** The owner's decision would block every iteration, and `done` already refuses a committed drift.

## Consequences

A tool's block in an agent file is still overwritten until the owner routes the tool through an instruction source, but every overwrite now says so, with a count and a preview, and `prepare` keeps the full lines.

A paragraph deleted from an instruction source and not yet refreshed is reported as added: no source produces it any more, so the notice is accurate, and its last choice says nothing more is needed. A block that replaces compiled lines, rather than standing beside them, reads as an edit.

A new path that overwrites agent files fails the gate until its call site declares how the report reaches its caller.
