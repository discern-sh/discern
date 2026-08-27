---
id: guide-write-project-instructions
title: "Write project instructions"
description: "Put durable provider-neutral rules in one source and regenerate every supported agent surface safely."
order: 100
publish: true
kind: guide
aliases:
  - "instructions"
  - "guide-write-project-instructions"
  - "instruction sources"
  - "instructions.md"
  - "project instructions"
  - "remember this rule"
  - "Compile and check agent instructions"
  - "refresh instructions"
  - "agent files"
  - "generated instructions"
redirect_from:
  - "/docs/agent-instructions/write-project-instructions"
  - "/docs/agent-instructions/compile-and-check-instructions"
---

# Write project instructions

Put durable provider-neutral rules in one source and regenerate every supported agent surface safely.

## Write project instructions

_A Instruction source holds the project instructions that discern supplies to every configured coding agent._

The compiled file opens as your project's own document. Its heading names the project (`[project].name`, or the slug when it is unset), and its first line states that your instructions are the final authority ([ADR 0177](https://discern.sh/docs/decisions/0177-compiled-agent-file-opens-as-the-projects-own)). discern places its built-in operating instructions first, then adds your sources with project-specific facts. Your rules can therefore override the built-in instructions. Record how to run the project, which files discern generates, where decisions live, and which practices the Gate cannot infer from commands alone. The default source is `discern/instructions.md`.

### Configure the sources

`[instructions].sources` accepts project-relative files and globs. Keep one source when the project has one natural home for instructions. Use several sources when existing documents already own distinct rules.

```toml
[instructions]
sources = ["discern/instructions.md", "packages/*/AGENT-NOTES.md"]
agents = ["claude_code", "codex", "gemini"]
```

Omit `agents` for the default pair, Claude Code and Codex. Set an explicit list to choose integrations. An empty list emits no agent files.

Source discovery skips agent files. A glob such as `"*.md"` never feeds `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` back into the next compilation.

### Write provider-neutral rules

Write for a new agent session with no memory of the conversation that produced the rule. Use the command, path, or named project concept the agent can inspect. State when the rule applies and include the reason when the reason prevents a plausible mistake.

Keep each rule with the project source that owns the fact. Future edits then have one authoritative source.

Keep instructions provider-neutral. Agent-specific setup, trust prompts, and file behavior belong in the [agent integration guides](connect-a-coding-agent.md). A standing rule belongs here only when every session needs it. A repeatable procedure belongs in an [authored Skill](create-and-manage-skills.md), where it loads when relevant instead of occupying every session.

### Current state & gotchas

- Built-in instructions are additive. A project source cannot replace or suppress them.
- Compilation reads source files in configured order after the built-in sections.
- Source discovery protects agent files, but a broad glob can still collect unrelated Markdown. Prefer narrow patterns with clear ownership.
- You own the source. Edit it directly, then compile the generated files with `discern refresh`.

### Where it lives in code

| Concern                          | Source                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Instruction configuration        | [`config_schema.ts`](https://github.com/jackwh/discern/blob/main/src/shared/config_schema.ts) (`instructionSection`) |
| Source discovery and compilation | [`instructions.ts`](https://github.com/jackwh/discern/blob/main/src/engine/instructions.ts) (`compileInstructions`)  |
| Agent file registry              | [`providers.ts`](https://github.com/jackwh/discern/blob/main/src/lib/providers.ts)                                   |
| Compilation coverage             | [`instructions_test.ts`](https://github.com/jackwh/discern/blob/main/tests/instructions_test.ts)                     |

## Compile and check agent instructions

_After an instruction edit, run `discern refresh`, review the generated files, and commit the tracked outputs with their sources._

### Refresh the agent files

From the project root, run:

```sh
discern refresh --dry-run
discern refresh
discern status
```

`refresh` compiles built-in and `[instructions].sources` text, then reconciles Skills, integrations, and the maintained architecture decision record (ADR) index.

`--dry-run` lists create, update, and removal targets for agent files, merge attributes, integrations, materialized Skills, the ADR index, proof-note Git config, and planning errors without writing. Command-line interface (CLI) JSON/Markdown and Model Context Protocol (MCP) `discern_refresh` expose the same plan. Apply consumes it; `status` and the Gate use its tracked projection ([ADR 0335](https://discern.sh/docs/decisions/0335-operation-policy-enrolls-faithful-previews)).

For each full-body output, local Markdown destinations are rewritten to resolve to the same project target they had beside their source. The parser limits edits to destination bytes; external, root-absolute, fragment-only, and code-like text stays unchanged. Provider pointers remain registry-defined.

The renderer gives every full body and pointer one final line feed; writers and currency checks consume those bytes.

The ADR index is opt-in by construction: a README that carries the `BEGIN GENERATED` markers is maintained, one without them is never touched. Fresh installs receive the markers from the setup skeleton; an existing project adopts the index by adding them.

The built-in Map section also derives a compact region list from the configured Map ([ADR 0174](https://discern.sh/docs/decisions/0174-agent-document-discovery-funnel)). Each non-internal top-level directory contributes its region target and front-door title. Adding or renaming a region, or changing its front-door title, changes the agent files. Other changes within an existing region leave that list unchanged. Run `discern refresh` after either kind of source change; the currency check reports whether the tracked outputs changed.

`discern prepare` runs the complete refresh after fix and `[generated]` jobs, before checks. Green means provider files and Skills are current; partial materialization is red with a `discern refresh` reproduction.

The configured agent set decides which instruction files exist:

| Agent integration | File the agent reads |
| ----------------- | -------------------- |
| Claude Code       | `CLAUDE.md`          |
| Codex             | `AGENTS.md`          |
| Gemini            | `GEMINI.md`          |
| Cursor            | `AGENTS.md`          |
| GitHub Copilot    | `AGENTS.md`          |

`AGENTS.md` holds the canonical compiled body when an integration reads it. Claude Code and Gemini use their own files, which can point to that canonical body. Cursor and GitHub Copilot read `AGENTS.md` directly. The provider registry owns these mappings, so adding an integration updates every consumer from one record.

### Keep sources and outputs together

discern generates agent files, and Git tracks them by default. A bare clone then contains the current instructions before it can run `discern refresh` ([ADR 0128](https://discern.sh/docs/decisions/0128-enumerated-ownership-tracked-guidance)). Review and commit the source edit and generated files in the same change.

Do not edit a compiled file to fix its prose. The next refresh replaces that edit, and the Gate's currency check reports the drift. Edit the configured source, then refresh again.

`discern done` runs the same currency check before the slower Gate stages. A mismatch stops the Gate early and names the generated files that need refreshing ([ADR 0034](https://discern.sh/docs/decisions/0034-agents-md-untracked-currency-check)).

### Check each agent-copy source at its authority

Operational procedures derive from the Skill resolver and setup templates. A repository-only registry binds exact prose but never renders. Tests reject escaped metadata and apply generated `DiscernAgent` rules ([ADR 0267](https://discern.sh/docs/decisions/0267-operational-contracts-stay-outside-agent-copy)).

### Current state & gotchas

- An explicit empty `[project].agents` list emits no instruction files.
- discern generates a provider-specific pointer only when its canonical target exists. Otherwise that provider receives the full compiled body.
- Git ignores materialized Skills and tracks agent files unless your own `.gitignore` rules say otherwise.
- A successful `discern update` or `discern accept` refreshes its resulting checkout. After an ordinary source edit, run `discern refresh` directly or let `discern prepare` converge it before the Gate.

### Where it lives in code

| Concern                         | Source                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh plan and apply          | [`tracked_refresh.ts`](https://github.com/jackwh/discern/blob/main/src/engine/tracked_refresh.ts), [`instructions.ts`](https://github.com/jackwh/discern/blob/main/src/engine/instructions.ts) |
| Canonical and pointer rendering | [`instruction_render.ts`](https://github.com/jackwh/discern/blob/main/src/engine/instruction_render.ts)                                                                                        |
| Local Markdown link relocation  | [`markdown_links.ts`](https://github.com/jackwh/discern/blob/main/src/lib/markdown_links.ts)                                                                                                   |
| Region discovery                | [`docs.ts`](https://github.com/jackwh/discern/blob/main/src/lib/docs.ts)                                                                                                                       |
| Agent file mappings             | [`providers.ts`](https://github.com/jackwh/discern/blob/main/src/lib/providers.ts)                                                                                                             |
| Operational-copy universe       | [`agent_surface_contracts.ts`](https://github.com/jackwh/discern/blob/main/scripts/agent_surface_contracts.ts)                                                                                 |
| Operational-copy guard          | [`agent_surface_contracts_test.ts`](https://github.com/jackwh/discern/blob/main/tests/agent_surface_contracts_test.ts)                                                                         |
| Maintained ADR index            | [`adr_index.ts`](https://github.com/jackwh/discern/blob/main/src/lib/adr_index.ts)                                                                                                             |
| Refresh behavior                | [`engine_refresh_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_refresh_test.ts)                                                                                           |
| Preparation convergence         | [`prepare.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/prepare.ts)                                                                                                         |
| ADR index behavior              | [`engine_adr_index_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_adr_index_test.ts)                                                                                       |
