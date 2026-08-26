# ADR 0342: Git elects module coverage membership and LCOV supplies observations

**Status**: accepted. Applies the canonical-set forcing function in [ADR 0051](0051-canonical-set-parity.md), the structural-scope contract in [ADR 0324](0324-structural-guards-declare-git-derived-source-universes.md), the growth-proof Standard policy in [ADR 0161](0161-growth-proof-standards-and-breach-escalation.md), and shared measurements from [ADR 0339](0339-proposed-standard-limits-and-shared-measurements.md).

## Context

Aggregate coverage says how many reported executable lines ran, not whether every source module participated. LCOV records only files the reporter observes, so an unloaded module disappears from both numerator and denominator. Electing membership from LCOV would let complete absence improve or preserve the aggregate.

The product source tree also contains modules that erase to types and marker modules with no executable lines. They are valid source members but have no runtime denominator. Treating them as accidental zeroes would confuse distinct states and create decorative failures.

A useful per-module floor exposes legacy debt. Temporary exceptions need a cap or the registry becomes the loophole. The aggregate, module rule, and exception count all depend on the same expensive instrumented suite and LCOV rendering.

## Decision

Git and the declared `authored-deno` structural scope elect product-module membership. [`sourceModuleUniverse`](../../../scripts/source_module_universe.ts) narrows that Git-derived universe to `src/`; it does not maintain a filename list. [`classifyModuleSource`](../../../scripts/coverage_lib.ts) parses each member and records it as executable, type-only, or no-executable-lines before reading coverage.

LCOV supplies observations only. The coverage reader resolves every `SF:` path and joins observations to the elected universe. An elected executable module without an LCOV record measures zero and cannot be exempted. A type-only or no-executable-lines module remains explicit without entering a denominator. Records outside the universe, non-canonical paths, and kind mismatches are diagnosed rather than discarded. Product runtime modules use file names that do not match Deno's test-source exclusion; a future conflicting name remains elected and therefore fails as unloaded.

Every executable module must meet an 80% line-coverage floor. Four lines out of five requires a behavioral seam in ordinary modules while leaving a reviewable legacy tail. Line coverage maps directly to the aggregate claim and produces stable, actionable debts; branch coverage may later complement it.

Reviewed legacy debts live only in [`MODULE_COVERAGE_EXCEPTIONS`](../../../scripts/module_coverage_exceptions.ts). Each exact path binds its measured baseline, owner, reason, and recovery. A listed module may improve below the floor, but it may not regress; reaching the floor makes the entry stale. Unloaded modules, unlisted low modules, missing exception paths, duplicates, and invalid metadata fail.

The set-valued rule is enforced as a zero-ceiling violation count whose diagnostics retain every failed member. A separate falling Standard holds the registry population. Aggregate coverage remains the measured-line rate. All three metrics use an identical Standard execution identity and are emitted by one coverage process after one instrumented suite and one LCOV report pass.

## Consequences

- A new tracked runtime module joins the claim automatically, even when no test imports it. Complete absence is visible as zero rather than improving the aggregate.
- Type-only and no-line modules remain visible as different semantic classes without division by zero.
- Aggregate coverage keeps its established meaning and is complemented by a module boundary rather than replaced by one.
- Legacy debt can shrink through coverage improvement or deletion, but cannot grow or regress without the Standards transaction that approves a worse ceiling.
- The coverage command parses the product source tree and prints a module table, adding modest analysis cost after the dominant suite and LCOV work.
- Runtime modules cannot use Deno's test-source file names. Renaming such a module is preferable to excluding it or pretending the reporter observed it.

## Alternatives considered

- **Use LCOV as the module list.** Rejected because an unloaded module is precisely the member LCOV omits.
- **Maintain a canonical filename array.** Rejected because a new source subtree could escape until someone updated the second list.
- **Hold the lowest module percentage as one Standard.** Rejected because it loses the failed set and makes reviewed legacy debt indistinguishable from compliance.
- **Choose the highest floor every current module clears.** Rejected because that produces a decorative boundary and hides the existing testing tail.
- **Run aggregate and module coverage separately.** Rejected because the second instrumented suite adds cost without producing independent evidence.
