# ADR 0313: Instruction compilation preserves location and prepare converges refresh

**Status**: accepted; extends [ADR 0034](0034-agents-md-untracked-currency-check.md), [ADR 0261](0261-prepare-runs-the-generated-regenerations.md), and [ADR 0264](0264-tracked-refresh-convergence-precedes-landing.md)

## Context

An authored instruction source and its compiled provider file can live in different directories. Copying Markdown verbatim across that boundary changes the base of every local link: a destination that resolves beside `discern/instructions.md` resolves beside root `AGENTS.md` after compilation. Rewriting the authored source to be root-relative only moves the defect to the source, while a broad regular expression cannot distinguish links from code or safely handle Markdown's destination grammar.

Preparation has a related convergence boundary. Its fix-stage and declared regeneration jobs can change inputs read by the instruction renderer, including the Map region list. Running those mutators and then checks without recompiling leaves a successful result whose tracked provider files no longer describe the tree the checks saw. The final Gate correctly rejects that drift, but only after the agent has been invited to commit a non-canonical state.

These are both ownership defects. The renderer already owns expected provider bytes, the compiler already owns materialization, and the preparation plan already owns the order of its mutating and read-only work. A repair belongs at those authorities rather than in setup-specific rewriting or a second Gate compiler.

## Decision

The pure instruction renderer preserves location-dependent Markdown meaning and owns the complete provider-file byte shape.

- Each authored source carries its project-relative source path into rendering. Each full-body output is rendered for its own provider-registry path; no global body string assumes `AGENTS.md` as the permanent location.
- `rebaseMarkdownLinks` parses CommonMark with the same GFM parser family already in the compile graph. It walks parser-recognized links, images, and reference definitions, then replaces only their destination byte spans in the original source. It never serializes the syntax tree. Code spans, fenced code, labels, titles, whitespace, and other source bytes remain authored.
- Local destinations resolve from the authored source directory and render relative to the full-body output directory. Query and fragment suffixes remain attached. Absolute URLs, `mailto:` and other schemes, root-absolute paths, query-only destinations, and fragment-only destinations remain unchanged.
- Setup adoption applies the same transformation in the opposite direction when it moves pre-existing provider instructions into the configured authored source. Compilation can therefore move the policy back out without changing the target of an adopted local link.
- Pointer-only files keep the provider registry's exact pointer contract. Every full body and pointer passes through one canonical ending function: trailing document whitespace is removed and exactly one line feed ends the file. The writer and currency checker consume the renderer's bytes without patching the ending downstream.

`buildPreparePlan` places one built-in complete-refresh step after the fix and declared-regeneration groups and before the check group. The executor calls `compileInstructions`, classifies partial failures through `instructionRefreshErrors`, and immediately re-runs the canonical instruction and Skills currency comparisons. The structured result reports the refresh step and any changed tracked paths. A provider or Skill materialization failure makes preparation red, skips later checks, and carries a `discern refresh` diagnostic naming the incomplete surface.

The final Gate remains read-only over tracked refresh effects. Preparation is the explicit effectful inner loop that creates the reviewable bytes before the final commit; `done` still proves that the committed tree is already converged.

## Consequences

- Moving an authored instruction into any registered full-body provider file preserves every parser-recognized local destination's normalized project target.
- A new provider path automatically joins output-specific rendering through the registry. A provider nested below the repository root gets destinations computed from that location without a filename special case.
- Source preservation costs a pinned Markdown parser dependency and a narrow positional scanner for destination tokens. The implementation fails rather than falling back to lossy tree serialization.
- `prepare` now performs complete refresh work even when no project fix or check job is configured. Its runtime includes Skill and provider reconciliation, and its execution model displays that built-in step.
- A successful preparation leaves refresh stable: rendering and currency comparison immediately afterward report no drift, and a second preparation produces no further tracked patch.
- Partial refresh remains honest. Successful writes are left visible for inspection, but one failed surface prevents a green result.

## Alternatives considered

- **Rewrite links in the authored source for root provider files.** Rejected because the source itself becomes wrong when read or rendered beside its own supporting files.
- **Match Markdown destinations with a regular expression.** Rejected because nested parentheses, escaped and angle-bracket destinations, reference definitions, titles, images, and code literals do not share a regex-safe grammar.
- **Parse and serialize the whole Markdown document.** Rejected because syntax-tree serialization can normalize unrelated authored bytes and cannot promise a source-preserving round trip.
- **Compile after the check group.** Rejected because check jobs would inspect stale generated context and could not validate the bytes preparation returns.
- **Teach `prepare` a separate instruction writer.** Rejected because it would split expected-content and partial-failure behavior from `compileInstructions`, recreating the drift class at a second authority.
- **Leave refresh exclusively to `done`.** Rejected because `done` is deliberately observational over tracked refresh effects; mutating there would invalidate its proof boundary.
