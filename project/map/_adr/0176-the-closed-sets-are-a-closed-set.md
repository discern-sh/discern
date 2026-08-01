# ADR 0176: The closed sets are a closed set

> **Member-list amendment (2026-08-01):** The atlas lists every resolvable member name in source order beneath its set. Authored sources without a member reader state that limit. The enrolment guard compares each rendered sequence with its live source, so additions, removals, renames, and changes in order appear in the generated diff.

> **Wire-registry amendment (2026-07-28; [ADR 0208](0208-public-contracts-version-by-schema-major.md)):** The meta-registry now enrolls `public-schema-publications` from `PUBLIC_SCHEMA_PUBLICATIONS`, plus `error-slugs` and `step-outcomes` from `ERROR_SLUGS` and `STEP_OUTCOMES`. Their declarations name the site/publication guards, strict-runtime and generated-contract guards, and the generated result schema and TypeScript artifacts where applicable. The registry atlas renders those memberships and guard edges, so a new publication, slug, or outcome must pass through its canonical authority and enrolled proofs.

> **Formatter amendment ([ADR 0178](0178-discern-tidy-is-the-embedded-convention-for-discern-owned-surfaces.md)):** Generated Markdown artifacts are now required to be canonical under the embedded formatter, and codegen formats them at its write chokepoint. The fmt-exclusion sweep described below retired with the four page-level exclusions; the meta-registry decision and its remaining sweeps stand.

**Status**: accepted

## Context

The forcing-function rule ([ADR 0051](0051-canonical-set-parity.md)) says every canonical set gets guards that tie it to its satellites. The rule has been applied ten-plus times — verbs, jobs, stages, config tables, skills, providers, the term registry ([ADR 0164](0164-glossary-compiles-from-a-term-registry.md), [ADR 0167](0167-term-registry-polices-the-vocabulary.md)), hints ([ADR 0172](0172-hints-compile-from-a-registry.md)), the feature canon ([ADR 0175](0175-the-feature-canon-compiles-from-a-feature-registry.md)) — but the word "every" has been enforced by culture, not code. Nothing forces the question when registry number eleven is born: who guards it? Which artifacts compile from it? Does the glossary name it, does the feature canon claim it, and if not, where is that decision recorded? Each enrolment edge so far was wired by hand, and each decision _not_ to wire one lives only in ADR prose.

The satellite checklist is lore, too, and lore gets re-learned the hard way. The feature-canon branch spent two commits rediscovering that a generated Markdown page whose renderer emits unformatted output fights `deno fmt` forever — a gotcha the glossary had already met and solved. The knowledge existed; no check delivered it.

The pattern has an observable footprint the repository already exhibits with striking regularity: guard tests matching five naming conventions (`*_parity_test`, `*_enrolment_test`, `*_codegen_test`, `*_drift_test`, `*_guard_test` — twenty-four files), codegen write targets (fifteen), and fmt-exclusions for generated map pages (four). That footprint is what a meta-guard can sweep.

## Decision

**One typed table — `scripts/canonical_sets.ts` — declares every canonical set, and an architectural test holds the declarations to the repository in both directions.**

### The registry

An entry carries a stable `id`, the set's single `source` (a module and export, or an authored file and a proof-of-presence string), its `guards` (the test files holding it to its satellites), its `artifacts` (committed files compiled from it, each a whole generated file with a banner or a maintained block between markers), and `enrolledIn` — for each enrolling registry, the glossary and the feature canon, either how the set is enrolled (a term, a per-member guard, a surface set, a canon node) or the recorded reason it is not. Module entries also carry a members thunk, so the meta-layer and the atlas read live member counts from the same source the first-order guards read.

Two side tables complete the exactly-one-of-two discipline at this level: `UNAFFILIATED_GUARDS` records conventionally named tests that hold no member set (behavioral invariants, vocabulary rules), and `UNAFFILIATED_CODEGEN_TARGETS` records generated files that compile from no registry — each with its reason.

### The checks

Forward, the declarations must hold: every source resolves to a non-empty member set, every guard exists and at least one per set references its source, every artifact is committed with its banner or markers, and every generated Markdown page is fmt-excluded or proven fmt-idempotent — the formatter-versus-generator loop, cured as a class. Every enrolment reference must name a live glossary term, surface set, or canon node, and each of the canon's six surface sets must be enrolled by exactly one entry.

Reverse, the sweeps: any conventionally named guard test, codegen write target, or fmt-excluded map page that no entry claims and no record explains fails the gate. The pattern's footprint cannot grow without enrolling in the pattern's own set. `scripts/codegen.ts` enforces the target half at run time too — its write helper refuses a path the meta-registry does not declare, and the gate's build stage runs codegen.

### The atlas

`deno task codegen` renders `_internal/registry-atlas.md` beside the other generated inventories: every set, source, live member count, guards, artifacts, and enrolments, plus the unaffiliated records with their reasons. For an agent it answers "where do I enrol a new member?" in one page; for documentation work it draws the generated-versus-authored boundary. A sync check in the enrolment guard keeps the page honest.

### The fixed point

The meta-registry enrols itself: `canonical-sets` is an entry, this module is its source, its own enrolment test is its guard, the atlas is its artifact, and the feature canon claims it through the `forcing-functions` node's new child. The recursion terminates because the entry is data like any other.

### What this deliberately does not do

The meta-layer is not an enrolment engine. The twenty-four existing guard tests stay exactly as written; the table references them, proves they exist, and proves they point at the right sources — it never runs them, generates them, or absorbs them into a framework. The moment a first-order guard has to import the meta-registry to do its job, this decision has been violated. The sweeps are convention-based and honest about their holes: a registry that grows no conventional test, no codegen target, and no fmt-exclusion is invisible to them, exactly as a shipped string evades a vocabulary scan — the conventions themselves are pinned by the meta-test, and enrolment at authoring time remains a discipline this rule documents rather than replaces.

## Consequences

- A new canonical set costs a third touch: the set, its guards, and now roughly ten declaration lines. In exchange, "does the feature canon claim it? does the glossary name it?" becomes a forced, recorded decision instead of a question nobody asks.
- The satellite checklist stops being lore. A generated Markdown artifact carries its banner, its codegen enrolment, and its formatter safety by check, not by memory; the next registry cannot re-learn the rewrite loop.
- A conventionally named test can no longer be added casually: it either belongs to a set or records why it does not. The suffix conventions become vocabulary with teeth.
- ADR 0051's "every" is now a checked invariant — the strongest internal proof of the discipline discern sells, and the dogfooding argument writes itself.
- The table duplicates facts that exist implicitly elsewhere (which tests import which sources, which pages codegen writes). Accepted: the duplication is the declaration, each copy is held to the other mechanically, and the alternative — inferring registry-ness from source code — is guesswork.

## Alternatives considered

- **A generic enrolment engine the existing guards migrate onto.** Rejected without hesitation: the guards' diversity is their strength — each speaks its set's language — and a framework would make every future set pay an abstraction tax to satisfy a meta-layer that exists to observe, not to govern.
- **Sweeping source code for registry-shaped exports.** Rejected: `export const FOO = [...] as const` is not a reliable signal, and false enrolment demands would teach agents to game the detector. The observable footprint — tests, targets, exclusions — is what the pattern actually leaves behind.
- **A hand-written registry inventory page.** Rejected for the reason ADR 0175 rejected a hand-written features document: a list nothing enforces is a list that is wrong.
- **Folding the table into the feature registry.** Rejected: the canon describes the product for readers of prose; this table describes the repository's enforcement topology for tests. One is voice-edited, the other is load-bearing data — different change rates, different consumers, different registers.
