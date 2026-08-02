# ADR 0249: Every authored TypeScript function declaration carries JSDoc

**Status**: accepted

## Context

discern already required each TypeScript module to open with JSDoc, but it had no rule for the functions inside that module. Documentation was therefore incidental: an exported function might explain its contract while the private helper above it carried nothing. The first structural census found 838 undocumented function declarations across source, scripts, site code, and tests.

The boundary matters. A `function` declaration has a stable syntax node and one natural place for documentation, whether it is exported, nested, asynchronous, or a generator. Arrow callbacks, function expressions, methods, and type signatures do not share that attachment point. Treating every callable syntax as one class would require inline comments on callbacks and turn a useful convention into comment noise.

The repository also has 2 source universes. `deno lint` omits a few authored files for independent toolchain reasons. The Git-derived `AUTHORED_TS_FILES` inventory includes those files and enrolls new TypeScript trees without a maintained root list.

## Decision

Every `FunctionDeclaration` in the authored TypeScript universe has a JSDoc block immediately before its declaration. An export wrapper may sit between the block and the `function` keyword. A `deno-lint-ignore` directive may follow the JSDoc because Deno requires that metadata to hug the declaration; no other comment or syntax may intervene.

The invariant has 2 enforcement paths:

- [`scripts/function_docblock_lint.ts`](../../../scripts/function_docblock_lint.ts) is an AST-backed Deno lint plugin. It reports the function name at authoring time during the normal lint job.
- [`tests/function_docblock_lint_test.ts`](../../../tests/function_docblock_lint_test.ts) runs the same plugin over every file in `AUTHORED_TS_FILES`. This covers authored files excluded from normal lint and enrolls both new declarations and new source trees.

The guard covers local, exported, default-exported, nested, async, and generator declarations. It excludes inert fixtures through the authored-source registry. Methods, arrow functions, function expressions, and type-only signatures remain outside this rule because they are separate syntax families without one consistent JSDoc position.

The plugin reports and does not invent documentation. The author writes the block because its job is to explain the function, not repeat an identifier mechanically.

## Consequences

- Every function declaration has a documentation point that editors and Deno's documentation tooling can attach to the declaration.
- Small helpers and test fixtures gain comments too. That adds lines and can restate an already-clear name; uniform enrollment is the accepted cost.
- A new TypeScript tree enters the architectural guard through Git without a test edit. A new nested function enters through the AST visitor without a name registry.
- The rule does not claim that every JavaScript callable is documented. Expanding it to another callable syntax requires a separate attachment contract and detector.

## Alternatives considered

- **Require JSDoc only on exported functions.** Private helpers carry much of the repository's policy and parsing behavior. Export status is not a useful proxy for whether a future reader needs intent.
- **Scan source text for `function`.** Text matching confuses comments and strings with syntax and misses formatting variants. The Deno linter already exposes the parsed declaration nodes and attached comments.
- **Use only the lint plugin.** The normal lint exclusions would leave authored site functions outside the invariant.
- **Require comments on every callable syntax.** Inline arrows and callbacks have no uniform, readable “above” position. Grouping them with declarations would trade recall in one syntax family for noise across several unrelated ones.
