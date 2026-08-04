# ADR 0257: The cross-agent reference compiles from a canonical registry

**Status**: accepted

## Context

The private cross-agent behaviour reference has become the most decision-driving research page in the map — the MCP working-root design (ADR 0062), the environment-only MCP experiment's scope (ADR 0254), and the sibling worktree placement all trace to its findings. It was also entirely hand-maintained: the headline matrix restated section facts by hand, column and section order were convention, cross-references cited literal section numbers, and nothing forced a new agent or a new behavioural dimension to be answered everywhere it applies. The repository's discipline for exactly this shape is the canonical set (ADR 0051, ADR 0176), and the pressure is not hypothetical — the research is expected to grow columns for the next tier of agents, and discern's own provider catalogue grows independently.

## Decision

`scripts/cross_agent_registry.ts` is the single source: the researched agents, the behaviour categories, and the classified dimensions, each carrying its typed headline cells (a `Record` keyed per agent, so an added column type-errors until every row answers) and its section body as verbatim Markdown in which `{{s:<id>}}` cites a sibling dimension. The reference page compiles through the codegen chokepoint, is declared in the canonical-sets meta-registry and `[generated.codegen]`, and renders the headline matrix by classification: rows group by category while sections keep declaration order, so a dimension's place in both projections follows from its entry alone. `tests/cross_agent_reference_codegen_test.ts` holds the committed page to the renderer and adds provider parity: every native provider in the agent catalogue must have a researched column, and no column may bind a retired provider. The migration was verified byte-identical to the authored page apart from the generated banner.

## Consequences

- Adding an agent or dimension is a typed, forced-completeness operation; a new native provider integration fails the gate until the research answers for it.
- Sections renumber themselves and citations follow, so inserting a dimension mid-list cannot strand a "§N" reference.
- Section prose now lives in TypeScript template literals — an editing-ergonomics cost accepted for the guarantees above; the fidelity check in the migration commit is the pattern for auditing future large prose moves.
- The page joins the generated surface: edits go to the registry followed by `deno task codegen`; the banner and drift guard catch hand edits.

## Alternatives considered

Typing the full document — every embedded table, sub-matrix, and confidence flag as structured data — was rejected: the research surface moves weekly and a document AST would tax every update for structure the guards don't need; verbatim bodies keep fidelity while the typed layer carries what must not drift. Keeping the page authored with lint-only checks was rejected because prose checks cannot force per-agent completeness or renumber citations. Housing the registry under `src/` was rejected: it is repository research, not shipped product code, and the shipped-strings guards would rightly object to its internal citations.
