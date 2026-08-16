# ADR 0285: Agent instructions replace Guidance throughout the live product

**Status**: accepted

## Context

discern called one concept by two related names. The public configuration and authored file used “Guidance”, while the implementation still exposed “Guidelines” in compiler names and result fields. Neither word described the artifact as directly as “instructions”: this is text a coding agent reads and follows, compiled into its Agent file.

The mismatch also made the source unnecessarily hard to find. A person looking for the ordinary word “guidelines” could miss `guidance.md`, while remembering one spelling did not reliably predict the other API and module names. The project is still pre-launch, so preserving this vocabulary as a permanent compatibility layer would spend complexity on a contract no public release has made.

The rename crosses authored paths, configuration, generated outputs, source-path registry membership, provider metadata, scopes, diagnostics, schemas, tests, documentation, and feature vocabulary. A partial rename would leave the same search and comprehension problem behind under a new mixture of names.

## Decision

The live concept is **agent instructions**, written as ordinary language rather than a branded product noun.

- Projects configure `[instructions].sources`; the default source is `discern/instructions.md`.
- The source-path registry member is `instructions`. The neutral scope is `[scopes.instructions]`.
- discern's bundled operating text lives under `templates/instructions/` and compiles with the project's instruction sources into Agent files.
- Implementation names use the same vocabulary: `compileInstructions`, `resolveInstructionSources`, `instruction_render.ts`, and related singular `instruction*` modifiers.
- Public documentation calls the subsystem “Agent instructions” and the authored inputs “instruction sources”. “Agent file” remains the name of a generated provider output.

This is a complete pre-launch break. `[guidance]` is rejected with a direct instruction to rename it to `[instructions]`; it is not parsed as an alias. discern does not move an existing `guidance.md` or rewrite a local config. Existing development installs make the small source-file and config edit explicitly.

The glossary retires the Guidance/Guideline word family from live surfaces, and the gate guards both its prose and structural forms. Dated ADRs and archived private records retain the vocabulary they originally recorded. Their filenames and historical statements do not become claims about the current interface.

## Consequences

The config key, default filename, code, docs, and generated artifacts now answer the same search. A new contributor can infer the subsystem's purpose without learning a product-specific synonym, and no plural/singular near-match remains between the public and internal APIs.

Existing pre-launch projects do not load until their `[guidance]` table is renamed, their authored file is moved, and any scope path that names the old file is updated. The refusal names the required config replacement, but there is deliberately no compatibility period in which both vocabularies remain live.

Historical links keep their original ADR filenames. Current documentation therefore sometimes links to a dated record whose slug contains the retired word; that is historical identity, not a live surface name.

## Alternatives considered

**Rename everything to Guidelines.** This preserves the same easy-to-mistype prefix and merely reverses which spelling a person must remember.

**Rules, policy, playbook, or handbook.** Each narrows or changes the artifact's meaning. The source contains commands, facts, conventions, and authority—not only rules or procedures—and “handbook” suggests a document for optional reading.

**Accept `[guidance]` as an alias.** An alias would make the old vocabulary permanent in parsing, tests, documentation, and support. Pre-launch installs can make the explicit edit more cheaply than discern can carry two names indefinitely.
