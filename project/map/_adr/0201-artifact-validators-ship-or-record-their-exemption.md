# ADR 0201: Artifact validators ship or record their exemption

**Status**: accepted

## Context

A pre-launch audit found a class of defect: pure validators exported from `src/lib/` whose subject is a config-resolved authored artifact — the map, the guidance sources, skills, project scripts, ADR records — but whose only callers were this repository's `tests/` and `scripts/`. The binary carried the code; no shipped verb ever ran it. Discern held its own artifacts to standards end-user projects never got: the map-integrity corpus scan and the ADR-index currency check both lived that way until ADR 0199 and ADR 0200 wired them into the gate and refresh.

Closing the known instances leaves the class open. The next validator written the same way — authored in `src/lib`, exercised by a dogfood test over the live repo, never wired into a shipped surface — would reproduce the defect silently, and only another audit would find it.

## Decision

**Every `src/lib` validator of a configured authored artifact must have a shipped caller or a recorded, reasoned exemption, and an architectural test proves it on every gate run.**

- `tests/validator_registry.ts` is the registry. Each row names the module, the exported function, its artifact subjects, and its enforcement: `shipped` (with the surface, for the reader) or `repo-local` (with the reason).
- **Shipped is proven, not declared.** The guard (`tests/validator_enrolment_test.ts`) reads the import graph over the authored-TypeScript universe: a shipped use is a value import from a module reachable from `src/main.ts`, `src/engine/`, or `src/commands/` — type-only imports are erased and never count — or a comment-stripped intra-module reference outside the export's own declaration when the module itself is shipped (a shipped wrapper often applies a sibling export). A `shipped` row with no such use fails.
- **Membership is automatic through the dogfood signal.** A dogfood test — one importing `tests/repo_authored_paths.ts`, the one registry of this repo's configured authored trees — that value-imports a `src/lib` function marks that function as presumptively dogfooded. Unshipped ones must appear in the registry or in the `NON_VALIDATOR_IMPORTS` ledger (generators and classifiers a repo guard consumes that validate nothing), exactly one of the two. Forgetting both is a gate failure whose message carries the remedy: wire it and enrol it shipped, enrol it repo-local with the reason, or record it as a non-validator.
- **Exemptions retire loudly.** A `repo-local` row whose export gains a shipped caller fails (the exemption is stale); so does one no dogfood test applies any more (an exemption for a validator nothing runs is a dead export, not policy). Ledger records fail when the export vanishes, ships, or loses its dogfood importer. Blank reasons fail everywhere.
- The registry enrols in the canonical-sets meta-registry (`artifact-validators`), so the conventional-guard sweep and the registry atlas own it like every other closed set, and fixture-level controls prove each predicate discriminates.

The recorded exemptions at adoption: `validateFrontmatter` (the strict frontmatter tier is deliberate house style for this repo's map; the shipped tier is `frontmatterShapeIssues`, per ADR 0199) and `findMalformedAdrReferences` (the normalized citation form is this repo's own prose convention; shipped surfaces consume citations through `collectAdrCitations`/`stripAdrCitations`, which are wired).

## Consequences

- Unwiring a shipped validator — deleting the gate preflight that calls `checkDocsIntegrity`, say — fails this repo's own gate with the row that promised the wiring, so the enforcement ADRs 0199/0200 shipped cannot silently regress.
- The audit that found the class cannot find it again: its query ("library validators only tests call") is now a gate predicate with an exemption ledger, and every finding is either wired or explained in writing.
- The scope is deliberately the enforcement-parity question, not dead-code detection: `src/lib` exports no dogfood test touches are out of frame, and the shipped trees themselves need no rows because they are shipped by construction.
- The matcher is conservative and its residual named in the guard's header: static import clauses miss side-effect and dynamic imports (none under `src/` today), the intra-module rule can over-credit a reference from an unshipped sibling, and a dogfood test reaching artifacts without the authored-paths registry evades the signal — enrolment at authoring time remains the discipline the guard backs up.

## Alternatives considered

- **Sweep every `src/lib` export for shipped use.** Rejected: the measured universe has dozens of unshipped exports serving codegen, the site, and unit tests — a dead-code question, not the enforcement-parity question; the record burden would drown the signal this guard exists to raise.
- **A doc-comment marker on validator exports.** Rejected: joining by marker is silent — the defect is forgetting, and a forgotten marker skips enrolment entirely. The dogfood import already exists in every instance of the class and cannot be omitted without also losing the test.
- **Recognizing validators by name morphology** (`check*`, `validate*`, `*Issues`). Rejected: the live set already spans four naming shapes, and a rename would silently move a validator out of frame.
- **Full call-graph analysis for shipped reachability.** Rejected: import-graph plus the intra-module rule resolves every live case; the heavier analysis buys precision the class does not need at a complexity the guard could not keep honest.
