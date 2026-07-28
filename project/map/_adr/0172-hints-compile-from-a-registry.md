# ADR 0172: Hints compile from a hint registry, and the envelope owns all advisory prose

> **Public-failure amendment (2026-07-28; [ADR 0208](0208-public-contracts-version-by-schema-major.md)):** The `hints: string[]` wire shape still stands, but every failed public result must now carry at least one fired, registered `next-step` hint. CLI and MCP pass results through `withFailureRecoveryHint`: a tailored registered next step passes unchanged; otherwise the boundary appends the `failure-recovery` entry, which tells the caller to correct the result's message or first diagnostic before retrying and invents no command. `serializeResult` rejects a failed envelope that still lacks registered actionable recovery; plain strings, notices, and guardrails do not satisfy the invariant. The prepared envelope is also the one recorded by the logbook.

**Status**: accepted

## Context

Every verb returns one result envelope, and its `hints[]` channel carries advisory next steps to the caller ([ADR 0028](0028-result-envelope-and-diagnostics.md)). That channel grew organically: roughly sixty emission sites across the engine and installer, concentrated in `status` but spread over the gate, standards, coupling, the logbook, the worktree lifecycle, setup, and the command router. A few sites matured into named constants or helper functions (`FLEET_OWNERSHIP_HINT`, `setupUnfinishedHint`, the router's did-you-mean pair in the vocabulary module); most remain inline string literals.

A July 2026 audit of the full hint surface, verified against the engine, found the costs of that growth:

- **Remedy prose exists that the primary surface never receives.** The gate's failed-stage remedy table (`failMessage` in `finish.ts`) attaches only on the human render path; a JSON or MCP caller — the surface this project declares primary — gets the failure without the stage's remedy sentence. `skills eject` has the same defect in miniature: its human renderer prints an advisory line that is in no envelope. ADR 0028's rule is that every surface renders the same result object; advisory prose that exists only renderer-side violates it.
- **Tests pin hint wording.** Around thirty-five test files assert on fragments of hint prose. Any rewording is a cross-suite find-and-fix, so wording calcifies — the instance-pinned coverage pattern the suite-audit discipline exists to cure.
- **Renderers filter by string reconstruction.** The human `status` renderer deliberately drops agent-facing hints, which is legitimate — but it identifies them by reconstructing the exact string and comparing for equality. A one-word edit silently breaks the filter.
- **Families drift.** One underlying fact is worded several ways: three restart-your-session variants, three setup-unfinished variants, six generated-file-drift variants. Nothing marks them as one family, so they diverge independently.
- **Nothing validates embedded command references.** Hint strings quote real commands (`discern update`, `discern refresh`). The map's fenced examples are validated against the live verb registry on every gate run; hint strings are not, so a verb rename leaves stale advice with no failing check. The launch rename train made this a demonstrated risk, not a hypothetical one.

The glossary work ([ADR 0164](0164-glossary-compiles-from-a-term-registry.md), [ADR 0167](0167-term-registry-polices-the-vocabulary.md), [ADR 0169](0169-the-launch-glossary-canon.md)) proved the shape that fixes this class: a closed registry as the single source, generated artifacts derived from it, and forcing-function guards that keep live usage honest ([ADR 0051](0051-canonical-set-parity.md)). Hints are the last large advisory surface outside that discipline, and the logbook ([ADR 0160](0160-local-logbook-advisory-readers.md), [ADR 0162](0162-logbook-day-one-vocabulary.md)) is ready to record which hints fire — impossible while a hint is an anonymous string.

## Decision

**Every hint is an entry in one closed registry of typed templates, the envelope owns all advisory prose, and fired hints are identified evidence.**

### The channel contract

The envelope's three prose-bearing fields have exclusive roles. `message` states what happened, and on a refusal or failure it carries the remedy. `data` carries machine-shaped facts. `hints[]` carries advisory guidance — next steps, guardrails, notices — and never decides success, never confirms an outcome `message` already states, and never substitutes for `data` as a data channel.

Renderers render the envelope. A renderer may drop envelope hints that do not suit its surface — the interactive `status` view dropping agent-facing guardrails stays correct — but it may not add advisory prose the envelope does not carry. The gate's failed-stage remedies therefore join the envelope on every failed run, and the `skills eject` advisory line moves into its result.

### The registry

One module, `src/shared/hints.ts`, defines every hint the engine and installer can emit. An entry carries a stable id, a category (`next-step`, `guardrail`, or `notice`), an audience (`all`, or `agent` for hints the interactive renderers drop), an optional family name grouping variants of one underlying fact, and a typed template function from named parameters to the rendered string. Entry documentation carries provenance and rationale; rendered text stays self-contained, because shipped strings cite no internal decision numbers.

In process, a fired hint is an id/text pair, so renderers filter by id and the logbook records ids. On the wire nothing changes: `hints` remains `string[]`, and no public contract or schema moves.

### The guards

Four forcing functions hold the set closed:

- **Closed set.** An architectural test forbids hint prose from reaching `hints[]` except through the registry. Adding a hint means adding an entry; an inline literal fails the gate.
- **Command references.** A test renders every template with placeholder parameters, extracts each `discern` command it quotes, and validates verb and subcommand against the live verb registry — the same check the map's fenced examples already pass. A rename now fails the hint corpus mechanically.
- **Renderer parity.** Renderers add no advisory prose absent from the envelope; the failed-stage remedy table is enrolled in the envelope and covered so the class cannot silently return.
- **Tests assert through the registry.** A test asserts a hint by rendering its entry with the case's parameters, never by hand-pinned prose fragments, so rewording flows through the suite without edits.

### Telemetry and inventory

Each logbook verb event records the ids of the hints that run fired — evidence recorded from day one even before a reader consumes it, per the logbook's vocabulary discipline. Pattern detectors over hint follow-through become possible without schema archaeology.

A generated inventory page under the map's `_internal` tier enumerates every registry entry — id, category, family, audience, trigger, and rendered example — replacing the hand-compiled audit that produced this decision. The audit becomes a regenerated artifact instead of a document that staled on its first edit.

### What this deliberately does not do

There is no public documentation page of hints: they are situational engine advice, and their reference audience is this repository's maintainers and auditors. There is no new verb and no wire-format change. Data-shaped prose currently rendered into `hints[]` (coupling's per-partner rows, `update`'s pagination lines) is not forced through templates as-is; the wording pass reclassifies it against the channel contract, keeping the advisory framing and leaving the rows to `data`. No count ceiling or corpus-size standard accompanies the registry — the closed set plus its guards is the enforcement.

## Consequences

- A verb rename or vocabulary change now fails hint prose mechanically, the same way it already fails the map. Stale advice cannot ship silently.
- Rewording becomes cheap: no test pins prose, so the voice pass and every future wording change touch the registry alone.
- The logbook gains hint-fire evidence at near-zero cost, opening follow-through detectors (a hint that fires repeatedly while its advice is never taken is a measurable loop, not an anecdote).
- The interactive renderers' drop-list keys on ids, removing the string-reconstruction equality filter.
- The audit inventory is reproducible on demand and can never drift from the code.
- Adding a hint costs two touches — the registry entry and the call site — instead of one inline string. That is the price of the closed set, and it is deliberate: the entry is where category, audience, and documentation are decided.
- The registry module is large by design; it is the one place to read the whole advisory voice.
- During the staged migration the old inline strings and the registry coexist on the programme branch; the closed-set guard lands only after the last site moves, so the branch, not the trunk, absorbs the transition.

## Alternatives considered

- **Keep hints scattered and fix the audit findings individually.** Rejected: each finding is an instance of a class (renderer-only prose, pinned wording, unchecked references, family drift), and instance fixes leave every class open. The forcing-function discipline exists precisely for this shape.
- **Extend the glossary term registry to hold hints.** Rejected: terms are display vocabulary with matching rules; hints are parameterized behavioral templates. The two share guard machinery but not shape, and one registry serving both would strain both schemas.
- **Carry hint ids on the wire.** Rejected: no external consumer needs ids, and changing the envelope's `hints` shape would churn every published contract for an internal benefit. Ids stay in-process where their consumers (renderers, logbook, tests) live.
- **A prose file format for hint templates outside TypeScript.** Rejected: typed parameters are the point. A template with named, compiler-checked slots cannot silently lose a parameter; a text DSL can.
