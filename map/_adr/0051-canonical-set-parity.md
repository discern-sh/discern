# ADR 0051: Every internal canonical set is tied to its satellites by a forcing function

> **Project Script vocabulary amendment
> ([ADR 0137](0137-project-scripts-live-under-the-script-command.md)):** Current
> pointers reflect the closed root vocabulary and explicit Project Script
> namespace; the decision and reasoning are unchanged.

**Status**: accepted; grounds design principle
[§2 "One source of truth"](../00-orientation/design-principles.md), generalizes
[ADR 0043](0043-registry-derived-agent-parity.md) (the agent registry) from one
set to all, and applies the discipline of
[ADR 0049](0049-bug-class-discipline-built-in.md).

## Context

discern has many **canonical sets** — closed vocabularies that must stay in sync
across the codebase: the CLI verbs (`KNOWN_ENGINE_VERBS`/`KNOWN_VERBS`), the
gate capabilities (`KNOWN_CAPABILITIES`) and stages (`STAGES`), the failed-stage
labels, the features (`FEATURES`), the agent providers (`AGENT_NAMES`), the
result vocabulary (`StepKind`/`StepDisposition`/`StepOutcome`, diagnostic
severity, status location), the MCP tool slugs, the worktree identity fields and
adapter tokens, the scope markers, the audit rule statuses, the helper verbs,
and more.

Each set has ONE source of truth — but many of its consumers ("satellites")
**re-listed its members by hand**: a Cliffy `.command()` registration per verb,
an MCP tool literal per slug, a `z.enum([...])` mirroring a TS union, a `switch`
over a vocabulary with a catch-all `default`, a `--<field>` flag per identity
field, a hand-copied `["build","format",…]` in a test, a hard-coded `4` for the
stage count. A hand-copied set has no mechanical tie back to its source, so
**adding or renaming a member silently leaves the satellite stale** — a dead MCP
tool, an orphaned feature mapping, a `failMessage` that falls through to a
generic "a stage failed", a help string that under-advertises an agent. The
drift is invisible until something breaks, which is exactly what design
principle §2 forbids.

[ADR 0043](0043-registry-derived-agent-parity.md) had already closed this for
ONE set — the agent registry — with registry-derived aggregators and a parity
test. But that left the _general_ defect class open: a canonical set
re-enumerated somewhere without a mechanical tie, so a new member does not
auto-enroll. The agent registry was the proof of concept; the class is broader.

## Decision

**Every internal canonical set must be tied to its satellites so that adding or
renaming a member is either impossible to get wrong (a compile error) or caught
by a test — never silently tolerated.** A new member auto-enrolls, or it fails
the gate.

Two tools, strongest first:

1. **Compile-time totality — the preferred tool.** Make the satellite a total
   `Record<Member, X>` keyed by the set's TYPE, or derive it from the set's
   constant tuple. A missing member then fails `deno check`. This is strictly
   stronger than a test (a runtime guard over a compile-total record would be
   theatre — it can't fail), so where it is achievable it is used _instead of_ a
   test, not alongside one. Examples shipped with this decision: the gate's
   `failMessage` became a total `Record<FailedStage, string>`; `[features]`'
   schema keys are pinned to `FEATURES` by `satisfies Record<Feature, …>`; the
   helper-verb dispatch became a total `Record<HelperVerb, handler>`;
   `identityField`'s `switch` over `WorktreeField` dropped its `default` so it
   is exhaustive; the result/diagnostic/location wire schemas now derive their
   `z.enum(...)` from the matching `result.ts` constant tuples.

2. **A forcing-function test — when compile-time is impossible.** Some
   satellites each need their own hand-wired handler and so cannot be a derived
   list (Cliffy command/option registrations, MCP tool literals), or live across
   a layer the source can't cross (a `shared/` Zod schema can't import an engine
   union). There, a test loops the canonical set and asserts each satellite
   covers it. `tests/engine_verb_parity_test.ts` is the keystone: one loop
   reconciles the verb SSOT against the Cliffy registrations, the MCP `TOOLS`,
   the setup gate, the feature gate, the suggestable-command list, and the
   identity flags.

The **derive-vs-tie** rule decides which per satellite:

- **Derive** when the satellite SHOULD equal the set — replace the hand-list
  with the constant (a test fixture's capability list becomes
  `Object.keys(KNOWN_CAPABILITIES)`).
- **Tie by test** when the satellite legitimately DIFFERS (an intentional
  subset/superset). Do NOT force equality — assert the RELATIONSHIP with
  **explicit, named, documented exception sets** (`ENGINE_VERBS_WITHOUT_TOOL`,
  `NON_ENGINE_TOOL_VERBS`, the suggestion-name drops/adds). A new member then
  forces a conscious choice — extend the satellite, or record why it is excepted
  — and can't silently drift. Collapsing a deliberate difference into false
  equality is a regression, not a fix.

Every guard must have teeth: it is confirmed to FAIL on a deliberate mismatch (a
bogus member, a renamed literal, a weakened schema) before it is trusted. A
comment that claims a guard must be made true by an actual mechanism — the
`features.ts` comment that promised a non-existent guard is now honest (the
`satisfies` tie).

The explicit *no*s: this is **not** a new gate stage, and **not** a lint rule
that bans domain words. Such a rule just relocates the same vocabulary into
tracked test history; the tie is applied _at the source_ (a derive or a
set-driven test), so a new member enrolls mechanically rather than being policed
by a banned-words list.

## Consequences

- **Drift is a failing build, not a latent bug.** Adding a member to any tied
  set is a compile error or a red test until every satellite learns it —
  consistency becomes a property of the system, not of reviewer vigilance
  (principle §2, now enforced beyond the agent registry).
- **The ceremony is real and deliberate.** A new canonical set now carries a
  cost: a constant tuple, a derived/total satellite or a parity test, and named
  exception sets for intentional differences. That cost buys the guarantee; it
  is paid once per set, at the source.
- **Compile-time beats tests where both are possible.** Re-typing a hop to the
  set's union or making a satellite a total `Record` removes the need for a
  runtime guard entirely — the type checker is the forcing function, and a
  redundant test would be theatre. Tests are reserved for the satellites that
  genuinely cannot be compile-coupled.
- **Intentional differences stay legible.** The exception sets document, in
  code, why a satellite diverges (which engine verbs have no MCP tool and why),
  so a future reader sees the deliberate gap instead of guessing whether it is a
  bug.
- **This ADR sets the bar for future code.** New verbs, capabilities, features,
  agents, result kinds, and any future closed vocabulary are held to it: tie the
  satellites at the source, or the gate says no.

## Alternatives considered

- **Trust the single-source-of-truth policy as prose.** Rejected: principle §2
  was already the policy, and the satellites drifted anyway (a `failMessage`
  catch-all `default`, a `--agents` help string two providers stale, two
  capability help strings already in different orders). A policy without a
  forcing function is a hope.
- **A lint rule banning the vocabulary's literals outside its source.**
  Rejected: such a rule is brittle (it can't tell a legitimate value comparison
  from a re-list), and it relocates the same hand-maintained vocabulary into the
  lint config — a second source to keep in sync, exactly what this set out to
  eliminate. Driving each tie off the set itself is self-maintaining.
- **One big parity test for everything.** Rejected in favour of preferring
  compile-time totality per set: a test that a total `Record` covers its key
  type can never fail, so it is theatre. The strongest tie a given set admits is
  used, and a test only where the compiler can't reach.
