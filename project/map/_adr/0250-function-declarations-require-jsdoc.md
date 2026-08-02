# ADR 0250: Every authored Deno function declaration carries JSDoc

**Status**: accepted

## Context

discern already required each TypeScript and JavaScript module to open with JSDoc, but it had no rule for the functions inside that module. Documentation was therefore incidental: an exported function might explain its contract while the private helper above it carried nothing. The first structural census found 838 undocumented function declarations across source, scripts, site code, and tests.

The first backfill proved that presence alone is not a documentation standard. Formulaic summaries such as “return the X” or “walk into” can satisfy the attachment rule while telling the reader less than the identifier already does. Repeating that filler across hundreds of helpers makes the code harder to trust, not easier to understand.

The boundary matters. A `function` declaration has a stable syntax node and one natural place for documentation, whether it is exported, nested, asynchronous, or a generator. Arrow callbacks, function expressions, methods, and type signatures do not share that attachment point. Treating every callable syntax as one class would require inline comments on callbacks and turn a useful convention into comment noise.

The repository also has 2 source universes. `deno lint` omits a few authored files for independent toolchain reasons. The Git-derived `AUTHORED_DENO_FILES` inventory includes those files and enrolls new TypeScript, TSX, and JavaScript trees without a maintained root list.

## Decision

Every `FunctionDeclaration` in the authored Deno source universe has a JSDoc block immediately before its declaration. An export wrapper may sit between the block and the `function` keyword. A `deno-lint-ignore` directive may follow the JSDoc because Deno requires that metadata to hug the declaration; no other comment or syntax may intervene.

The summary starts with prose that adds information unavailable from the function name. Useful information includes behavior, input or output contracts, side effects, failure semantics, safety boundaries, and the reason a non-obvious helper exists. Tags without a summary do not satisfy the rule. A comment that only turns `function resolveWidget` into “Resolve the widget” does not satisfy it either.

The invariant has 2 enforcement paths:

- [`scripts/function_docblock_lint.ts`](../../../scripts/function_docblock_lint.ts) is an AST-backed Deno lint plugin. It reports the function name at authoring time during the normal lint job.
- [`tests/function_docblock_lint_test.ts`](../../../tests/function_docblock_lint_test.ts) runs the same plugin over every file in `AUTHORED_DENO_FILES`. This covers authored files excluded from normal lint and enrolls both new declarations and new source trees.

The guard covers local, exported, default-exported, nested, async, and generator declarations. It excludes inert fixtures through the authored-source registry. Methods, arrow functions, function expressions, and type-only signatures remain outside this rule because they are separate syntax families without one consistent JSDoc position.

The plugin reports and does not invent documentation. Its low-information tripwire removes generic documentation scaffolding and normalized identifier words, then requires a concrete term to remain in the summary. That catches formulaic backfill; it does not prove that a comment is true or sufficient. The author and reviewer remain responsible for meaning.

## Consequences

- Every function declaration has a documentation point that editors and Deno's documentation tooling can attach to the declaration.
- Small helpers and test fixtures gain concise comments too. Those comments must explain their fixture role, boundary, or behavior; restating an already-clear name is not an accepted cost.
- A new Deno source tree enters the architectural guard through Git without a test edit. A new nested function enters through the AST visitor without a name registry.
- The lexical tripwire rejects obvious paraphrases but cannot judge semantic accuracy. Review still owns whether the prose describes the implementation and explains non-trivial intent.
- The rule does not claim that every JavaScript callable is documented. Expanding it to another callable syntax requires a separate attachment contract and detector.

## Alternatives considered

- **Require JSDoc only on exported functions.** Private helpers carry much of the repository's policy and parsing behavior. Export status is not a useful proxy for whether a future reader needs intent.
- **Scan source text for `function`.** Text matching confuses comments and strings with syntax and misses formatting variants. The Deno linter already exposes the parsed declaration nodes and attached comments.
- **Use only the lint plugin.** The normal lint exclusions would leave authored site functions outside the invariant.
- **Require comments on every callable syntax.** Inline arrows and callbacks have no uniform, readable “above” position. Grouping them with declarations would trade recall in one syntax family for noise across several unrelated ones.
