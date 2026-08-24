# ADR 0324: Structural guards declare Git-derived source universes

**Status**: accepted. Extends the canonical-set forcing functions in [ADR 0051](0051-canonical-set-parity.md) without widening the bounded filename heuristics in [ADR 0176](0176-the-closed-sets-are-a-closed-set.md) or [ADR 0181](0181-an-ssot-claim-must-anchor-a-declared-canonical-set.md).

## Context

A structural guard can enforce a valid invariant over the wrong population. A test may say “every authored source file” while recursively walking only `src/`, or it may preserve a list of the roots that happened to exist when the test was written. A new authored tree then sits outside the promise while the Gate remains green. The existing Git-derived source universes solve discovery for guards that choose them, but direct imports and local directory walks make enrollment optional.

Not every cross-file rule is repository-wide. A shipped-string rule protects shipped surfaces, a test-code rule may need inert executable fixtures, and a source-comment rule can deliberately exclude tests. Forcing every rule over the broadest universe would change valid invariants and turn fixture content into false positives. The required contract therefore has to distinguish an intentional semantic boundary from an accidental implementation boundary.

The class boundary also matters. Behavioral tests can walk a temporary fixture to exercise runtime behavior; generators enumerate their inputs; production code traverses user directories. Those operations do not define the membership of an authored lint or test invariant and must not acquire test-policy declarations merely because they enumerate files.

## Decision

**Every structural guard obtains its scan set through one call-site declaration backed by Git.**

A structural guard is authored test or lint code that enumerates source files, inspects their text or syntax, and enforces one invariant across files. Behavioral fixture walks, fixture walkers, code generators, and production directory traversal use enumeration as their input or behavior. They do not define the membership boundary of a cross-file rule and remain outside this class.

[`tests/structural_guard_scope.ts`](../../../tests/structural_guard_scope.ts) is the declaration capability. Each call names its owning module and a unique local id, then chooses one base universe:

- `authored-ts` for authored TypeScript and TSX;
- `authored-deno` for every authored JavaScript and TypeScript extension accepted by Deno lint;
- `tracked-markdown` for Markdown;
- `authored-text` for the repository's text contract.

Repository-wide claims return the complete matching universe from [`tests/repo_authored_paths.ts`](../../../tests/repo_authored_paths.ts). A narrower claim supplies an `include` predicate and a specific one-line reason stating the semantic boundary of the invariant. The declaration stays beside the guard; there is no central membership table of guards.

A specialized universe is permitted only when no canonical universe represents the syntax family. Git still supplies its members. The declaration names either a family of file extensions or the text contract including inert fixtures, and explains why the canonical universes do not fit. It cannot name paths, roots, globs, or individual files.

[`tests/structural_guard_scope_test.ts`](../../../tests/structural_guard_scope_test.ts) is the architectural enrollment guard. Its syntax-aware detector scans the complete authored TypeScript universe and rejects direct canonical-universe imports, repository-rooted source walks, local authored-file or root lists, malformed or duplicate declaration identities, and path-backed specialized universes. Injected Git repositories prove that an unrelated future tree enrolls automatically and that executable fixture source crosses the specialized boundary. A small exact map classifies modules that resemble the predicate but implement or behaviorally test the capability; every entry carries a reason and fails when its path becomes stale.

The enrollment guard does not execute first-order guards and does not change the filename-suffix heuristics used to recognize other closed-set conventions.

## Consequences

- A repository-wide TypeScript or Deno promise widens as soon as Git sees a source file in a new tree; the guard author does not maintain roots or members.
- A maintainer can read a narrow declaration beside the invariant and distinguish intended scope from an accidental omission.
- Test-only syntax families can include inert fixtures without contaminating the authored runtime universes.
- Adding a structural guard requires a declaration at its call site. Adding another canonical universe is a separate architecture decision and canonical-set enrollment, not a convenient local list.
- Syntax-aware enrollment catches the current enumeration forms, but a genuinely new abstraction for source discovery may require extending the detector. Exact classification exclusions remain visible and stale-checked rather than becoming a broad bypass.
- Behavioral walks, generators, and production traversal keep their natural APIs and do not inherit a declaration contract that says nothing about their behavior.

## Alternatives considered

- **Rely on project instructions and direct universe imports.** Rejected because a guard can still walk a familiar root or consume a local list, and no permanent check enrolls the next guard or catches incomplete coverage.
- **Keep one central registry of structural guards.** Rejected because adding a guard would require a second membership edit. Call-site declarations are discoverable by syntax and keep identity, universe, and narrowing reason together.
- **Require the broadest universe for every guard.** Rejected because shipped, production-only, and fixture-specific invariants have real narrower boundaries. False positives would encourage weakening the enforced rule itself.
- **Permit specialized root or file lists with a reason.** Rejected because prose does not make hand-maintained membership future-complete. Specialized families remain declarative while Git owns membership.
- **Make the enrollment test run every first-order guard.** Rejected because the architectural invariant is declaration and source discovery, not test orchestration; the normal Gate already executes the guards.
